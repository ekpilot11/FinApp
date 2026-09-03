/**
 * FinApp sync server.
 *
 * Exists for one reason: Plaid (like every bank aggregator) issues a secret
 * that must never be shipped inside an app. Anyone can unzip an .ipa and read
 * it. So the secret — and the per-bank access tokens Plaid hands back — live
 * here, and the phone only ever holds a device token it can revoke.
 *
 * Deliberately small. It stores state in a JSON file rather than a database
 * because this is meant to run as one personal instance, for one person, on the
 * cheapest box or free tier you can find.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.json');

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

/**
 * Comma-separated allowlist of device tokens. Leave unset and the first device
 * to call the server claims it (trust on first use) — fine for a server only
 * you know the address of, but set it explicitly if the URL is guessable.
 */
const ALLOWED_TOKENS = (process.env.ALLOWED_DEVICE_TOKENS || '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);

if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
  console.error('Missing PLAID_CLIENT_ID / PLAID_SECRET. Copy .env.example and fill it in.');
  process.exit(1);
}

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
        'PLAID-SECRET': PLAID_SECRET,
      },
    },
  })
);

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** @type {{ owner: string|null, items: Record<string, any>, sessions: Record<string, any> }} */
let db = { owner: null, items: {}, sessions: {} };

function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    db.items ||= {};
    db.sessions ||= {};
  } catch {
    // First run, or the file was removed. Start clean.
  }
}

function saveDB() {
  // Write-then-rename so a crash mid-write cannot truncate the store and lose
  // every bank connection.
  const temporary = `${DB_PATH}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(db, null, 2));
  fs.renameSync(temporary, DB_PATH);
}

loadDB();

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/** Bearer-token gate. */
app.use((req, res, next) => {
  if (req.path === '/health') return next();

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing device token.' });
  }

  if (ALLOWED_TOKENS.length > 0) {
    if (!ALLOWED_TOKENS.includes(token)) {
      return res.status(403).json({ error: 'forbidden', message: 'This device is not allowed.' });
    }
  } else if (!db.owner) {
    db.owner = token;
    saveDB();
    console.log('Claimed by first device.');
  } else if (db.owner !== token) {
    return res.status(403).json({ error: 'forbidden', message: 'This server already belongs to another device.' });
  }

  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: PLAID_ENV });
});

/**
 * Starts a Hosted Link session.
 *
 * Hosted Link is used rather than the native Plaid SDK so the iOS app needs no
 * third-party dependency at all — it just opens a URL.
 */
app.post('/link/start', async (_req, res) => {
  try {
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: db.owner || 'finapp-user' },
      client_name: 'FinApp',
      products: [Products.Transactions],
      country_codes: resolveCountryCodes(),
      language: 'en',
      hosted_link: {
        // Where the bank sends the browser when the user is done. The app
        // intercepts this scheme; it does not need to resolve to anything.
        completion_redirect_uri: 'finapp://link-complete',
      },
    });

    const { link_token: linkToken, hosted_link_url: hostedLinkUrl } = response.data;

    db.sessions[linkToken] = { createdAt: Date.now(), status: 'pending' };
    saveDB();

    res.json({ linkUrl: hostedLinkUrl, sessionId: linkToken });
  } catch (error) {
    sendPlaidError(res, error);
  }
});

/**
 * Polls a link session. Once the user finishes at their bank, Plaid exposes a
 * public token on the session, which is exchanged here for the long-lived
 * access token that never leaves this server.
 */
app.get('/link/status', async (req, res) => {
  const sessionId = req.query.session;
  if (!sessionId || !db.sessions[sessionId]) {
    return res.status(404).json({ error: 'not_found', message: 'Unknown link session.' });
  }

  const session = db.sessions[sessionId];
  if (session.status === 'linked') {
    const item = db.items[session.itemId];
    return res.json({
      status: 'linked',
      itemId: session.itemId,
      institutionName: item?.institutionName ?? 'Bank',
      accounts: item?.accounts ?? [],
    });
  }

  try {
    const response = await plaid.linkTokenGet({ link_token: sessionId });
    const sessions = response.data.link_sessions || [];

    const publicToken = sessions
      .flatMap((entry) => entry.results?.item_add_results || [])
      .map((result) => result.public_token)
      .find(Boolean);

    if (!publicToken) {
      return res.json({ status: 'pending' });
    }

    const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    const { institutionName, accounts } = await describeItem(accessToken, itemId);

    db.items[itemId] = { accessToken, itemId, institutionName, accounts, cursor: null };
    session.status = 'linked';
    session.itemId = itemId;
    saveDB();

    res.json({ status: 'linked', itemId, institutionName, accounts });
  } catch (error) {
    sendPlaidError(res, error);
  }
});

/** Incremental transaction pull. */
app.get('/transactions/sync', async (req, res) => {
  const itemId = req.query.itemId;
  const item = db.items[itemId];

  if (!item) {
    return res.status(404).json({ error: 'not_found', message: 'That account is no longer linked.' });
  }

  try {
    const response = await plaid.transactionsSync({
      access_token: item.accessToken,
      cursor: req.query.cursor || undefined,
      count: 250,
    });

    const { added, modified, removed, next_cursor: nextCursor, has_more: hasMore } = response.data;

    item.cursor = nextCursor;
    saveDB();

    res.json({
      added: added.map(toTransaction),
      modified: modified.map(toTransaction),
      removed: removed.map((entry) => entry.transaction_id),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    sendPlaidError(res, error);
  }
});

app.post('/link/remove', async (req, res) => {
  const { itemId } = req.body || {};
  const item = db.items[itemId];
  if (!item) return res.json({});

  try {
    await plaid.itemRemove({ access_token: item.accessToken });
  } catch (error) {
    // Already gone on Plaid's side is not a failure worth surfacing — the
    // point of the call is that we stop holding the token either way.
    console.warn('itemRemove failed, dropping locally anyway:', error?.message);
  }

  delete db.items[itemId];
  saveDB();
  res.json({});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCountryCodes() {
  const configured = (process.env.PLAID_COUNTRY_CODES || 'US').split(',').map((code) => code.trim());
  return configured.map((code) => CountryCode[code] || code);
}

async function describeItem(accessToken, itemId) {
  let institutionName = 'Bank';
  let accounts = [];

  try {
    const accountsResponse = await plaid.accountsGet({ access_token: accessToken });
    const institutionId = accountsResponse.data.item.institution_id;

    if (institutionId) {
      const institution = await plaid.institutionsGetById({
        institution_id: institutionId,
        country_codes: resolveCountryCodes(),
      });
      institutionName = institution.data.institution.name;
    }

    accounts = accountsResponse.data.accounts.map((account) => ({
      id: account.account_id,
      name: account.name,
      mask: account.mask || null,
      institutionName,
    }));
  } catch (error) {
    console.warn('Could not describe item', itemId, error?.message);
  }

  return { institutionName, accounts };
}

/**
 * Maps Plaid's shape onto what the app expects.
 *
 * `amount` goes over the wire as a string on purpose: JSON numbers are
 * IEEE doubles, and the app stores money as a decimal. Sending "4.75" keeps it
 * exactly 4.75 on the other side.
 */
function toTransaction(transaction) {
  return {
    id: transaction.transaction_id,
    accountId: transaction.account_id,
    // Plaid is already positive-for-money-out, which is FinApp's convention too.
    amount: String(transaction.amount),
    currency: transaction.iso_currency_code || transaction.unofficial_currency_code || 'USD',
    // authorized_date is when you actually tapped; date is when it posted.
    date: transaction.authorized_date || transaction.date,
    merchant: transaction.merchant_name || null,
    description: transaction.name || '',
    pending: Boolean(transaction.pending),
  };
}

function sendPlaidError(res, error) {
  const details = error?.response?.data;
  console.error('Plaid error:', details || error?.message || error);
  res.status(502).json({
    error: details?.error_code || 'upstream_error',
    message: details?.error_message || 'The bank service could not be reached.',
  });
}

app.listen(PORT, () => {
  console.log(`FinApp sync server listening on :${PORT} (Plaid ${PLAID_ENV})`);
});
