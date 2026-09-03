// The Apple Pay bridge, web edition.
//
// iOS gives no app access to Wallet's transaction history — there is no API
// for reading what you spent, and a web page has even less reach than a native
// one. What iOS *does* give you is a personal automation that fires on a
// **Transaction** (Apple Card, Apple Cash, or any card in Wallet used with
// Apple Pay), and that automation can open a URL.
//
// So FinApp accepts a purchase as query parameters:
//
//   https://you.github.io/FinApp/?add=1&amount=4.75&merchant=Blue%20Bottle
//
// The page logs it, de-duplicates it, and shows what it recorded. Unlike the
// native App Intent this cannot run silently — Safari has to open — but it is
// still one tap-free automation rather than typing the purchase in.
//
// Set-up lives in docs/WEB.md.

import { classify, normalize } from './category-classifier.js';
import { centsFromDigits } from './expense-parser.js';
import { parseIncomingDate } from './dates.js';
import { decimalStringFromCents } from './money.js';
import { readNotification } from './notification-parser.js';

/**
 * A synthetic id for automations that cannot supply a real one.
 *
 * Deliberately day-granular: if the same automation fires twice for one tap —
 * which happens — both attempts produce the same fingerprint and the second is
 * merged away. Two genuinely separate identical purchases at the same merchant
 * on the same day will also collapse, which is the right trade: an undercount
 * the user can correct beats a silent double-count they will not notice.
 *
 * @param {number} amountCents
 */
export function fingerprint(amountCents, merchant, date) {
  const pad = (value) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const normalized = normalize(merchant ?? '').split(' ').join('-');
  return `applepay:${decimalStringFromCents(amountCents)}:${normalized}:${day}`;
}

/**
 * The address FinApp should be used at, when the current one is a per-deploy
 * preview link.
 *
 * Netlify (and Vercel, and Cloudflare) hand out permalinks pinned to a single
 * deploy — `6a751ad7...--your-site.netlify.app`. Browser storage is per
 * origin, so logging a purchase through one address and opening the app on
 * the other silently gives you two separate ledgers, each missing half your
 * spending. That is a bad way to find out.
 *
 * @returns {string|null} the stable address, or null if this one is already it
 */
export function canonicalSiteURL(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const match = /^[0-9a-f]{6,}--(.+)$/i.exec(url.hostname);
  if (!match) return null;
  return `${url.protocol}//${match[1]}${url.pathname}`;
}

/**
 * Reads an import request out of a URL's query string or hash.
 *
 * Both are accepted because Shortcuts users copy whichever example they find
 * first, and a purchase silently dropped because the link used `#` instead of
 * `?` is the kind of bug nobody ever reports.
 *
 * @param {string} href
 * @returns {URLSearchParams|null}
 */
export function importParams(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (carriesImport(url.searchParams)) return withRawText(url.searchParams, url.search);

  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const separator = hash.indexOf('?');
  if (separator !== -1) {
    const query = hash.slice(separator + 1);
    const params = new URLSearchParams(query);
    if (carriesImport(params)) return withRawText(params, query);
  }
  return null;
}

/** Everything a request can arrive as, so an unknown key is not mistaken for text. */
const KNOWN_PARAMS = new Set([
  'add', 'amount', 'merchant', 'currency', 'note', 'date', 'id', 'category',
  'text', 'title', 'subtitle', 'body'
]);

function carriesImport(params) {
  return params.has('amount') || params.has('text')
    || params.has('body') || params.has('title') || params.has('subtitle');
}

/**
 * Puts an `&` inside the notification text back where it belongs.
 *
 * Shortcuts drops a notification's Body into the URL as-is, and a message like
 * "Compra aprovada & estorno" then reads as the start of a new parameter, so
 * the merchant vanishes and only the front half of the text survives. Anything
 * following `text=` that is not a parameter FinApp knows about was never a
 * parameter — it is the rest of the sentence.
 */
function withRawText(params, query) {
  const marker = /(?:^|[?&])text=/.exec(query);
  if (!marker) return params;

  const tail = query.slice(marker.index + marker[0].length);
  const rejoined = tail.split('&').reduce((kept, piece, index) => {
    if (index === 0) return piece;
    const key = piece.split('=')[0].toLowerCase();
    // A real parameter ends the text; anything else was part of it.
    return KNOWN_PARAMS.has(key) ? kept : `${kept}&${piece}`;
  }, '');

  if (rejoined === tail.split('&')[0]) return params;

  // Decoded by hand rather than through URLSearchParams, which would split on
  // the very ampersand this function just put back.
  try {
    params.set('text', decodeURIComponent(rejoined.replace(/\+/g, ' ')));
  } catch {
    params.set('text', rejoined.replace(/\+/g, ' '));
  }
  return params;
}

/**
 * The notification text a request carries, however the automation spelled it.
 *
 * iOS 27 hands over Title, Subtitle and Body as three separate pieces of
 * Shortcut Input. Users wire up whichever ones their bank actually fills in,
 * so all three are accepted and joined in reading order.
 */
export function notificationText(params) {
  return notificationTexts(params)[0] ?? '';
}

/**
 * Every notification a single link carries.
 *
 * More than one because of the locked phone. iOS refuses to open Safari while
 * the phone is locked, and a web page that cannot open cannot log anything —
 * so a purchase made at a card reader with the phone in your pocket is lost
 * the moment the automation gives up. The way out is not to open anything: the
 * automation keeps a list, and hands over everything it has the next time it
 * gets a chance. `?add=1&text=…&text=…&text=…`
 */
export function notificationTexts(params) {
  const many = params.getAll('text').map((value) => value.trim()).filter(Boolean);
  if (many.length > 0) return many;

  const joined = ['title', 'subtitle', 'body']
    .map((key) => (params.get(key) ?? '').trim())
    .filter(Boolean)
    .join(' — ');
  return joined ? [joined] : [];
}

/**
 * Turns import parameters into expense fields.
 *
 * @param {URLSearchParams} params
 * @param {{defaultCurrency: string, now?: Date}} context
 * @returns {object|null} fields for `makeExpense`, or null when there is no
 *   usable amount — a card automation with no number in it is not a purchase.
 */
export function expenseFromParams(params, context) {
  const rawAmount = (params.get('amount') ?? '').trim();
  if (!rawAmount) return expenseFromNotification(params, context);
  // Shortcuts hands over whatever the card formatted: "4.75", "R$ 4,75",
  // "-4.75" for a refund. Strip everything that is not a number or separator
  // and let the parser's separator logic work out which is which.
  const negative = /^-|^\(.*\)$/.test(rawAmount);
  const digits = rawAmount.replace(/[^\d.,]/g, '');
  const magnitude = centsFromDigits(digits);
  if (magnitude === null || magnitude === 0) return null;

  const merchant = (params.get('merchant') ?? '').trim();
  const note = (params.get('note') ?? '').trim();
  const date = parseIncomingDate(params.get('date')) ?? context.now ?? new Date();
  const currencyCode = (params.get('currency') ?? '').trim().toUpperCase()
    || context.defaultCurrency;
  const suppliedID = (params.get('id') ?? '').trim();
  const amount = negative ? -magnitude : magnitude;

  return {
    amount,
    currencyCode,
    merchant,
    note,
    date,
    category: params.get('category') ?? classify(`${merchant} ${note}`, merchant || null),
    source: 'cardAutomation',
    externalID: suppliedID || fingerprint(amount, merchant, date)
  };
}

/**
 * Today, at the time the notification quoted.
 *
 * The guard is for the purchase just before midnight whose alert is read just
 * after it: 23:50 applied to the new day would put the coffee a day early and
 * in the wrong month twelve times a year. A quoted time in the future means it
 * belongs to yesterday.
 */
function atQuotedTime(time, now) {
  if (!time) return now;

  const dated = new Date(now);
  dated.setHours(time.hours, time.minutes, 0, 0);
  if (dated.getTime() > now.getTime() + 60 * 60 * 1000) dated.setDate(dated.getDate() - 1);
  return dated;
}

/**
 * The same thing, from a notification the bank sent.
 *
 * Shares `fingerprint` with the Apple Pay path on purpose. If both automations
 * are switched on they fire for one purchase and produce the same id, so the
 * ledger merges them instead of counting the coffee twice.
 *
 * @returns {object|null} fields for `makeExpense`, or null when the text held
 *   no purchase — plus `reason` and `confidence` on the returned object so the
 *   caller can tell "not a purchase" from "could not read it".
 */
export function expenseFromNotification(params, context) {
  return expenseFromText(notificationText(params), params, context);
}

/**
 * One queued notification, read on its own terms.
 *
 * Split out from `expenseFromNotification` so a link carrying five of them
 * runs the identical path five times — the batch is not a second
 * implementation that can drift from the single case.
 */
export function expenseFromText(text, params, context) {
  if (!text) {
    // A notification slot that arrived empty is a different thing from an
    // Apple Pay link with no amount, and the commonest cause is the play
    // button: testing an automation by hand runs it with no notification to
    // read, so the text is blank through no fault of the setup.
    const asked = ['text', 'title', 'subtitle', 'body'].some((key) => params.has(key));
    return asked ? { rejected: true, reason: 'empty', text: '' } : null;
  }

  const reading = readNotification(text, { defaultCurrency: context.defaultCurrency });
  if (!reading.ok) return { rejected: true, reason: reading.reason, text };

  const supplied = parseIncomingDate(params.get('date'));
  const date = supplied ?? atQuotedTime(reading.time, context.now ?? new Date());
  const merchant = (params.get('merchant') ?? '').trim() || reading.merchant;
  const suppliedID = (params.get('id') ?? '').trim();

  return {
    amount: reading.amount,
    currencyCode: reading.currencyCode,
    merchant,
    // The message itself is worth keeping: it is the only record of what the
    // bank actually said, and the first thing to look at when a row is wrong.
    note: text,
    date,
    category: params.get('category') ?? reading.category,
    source: 'cardAutomation',
    externalID: suppliedID || fingerprint(reading.amount, merchant, date),
    confidence: reading.confidence,
    text
  };
}
