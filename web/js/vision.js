// Reading purchases out of a screenshot.
//
// The one thing FinApp cannot do on iOS is see your bank's notifications: no
// API exposes another app's notifications to a web page, and Apple Wallet
// only fills in transaction details for Apple Card and Apple Cash. What is
// left is the screenshot — and a day's worth of notifications usually stack up
// in one, which is why this returns a *list* of purchases rather than one.
//
// Everything above `readScreenshot` is a pure function over plain data, so the
// request we build and the response we accept are both testable without a
// network or an API key.

import { CATEGORIES } from './categories.js';
import { centsFromDigits } from './expense-parser.js';
import { merchantsMatch } from './ledger.js';
import { isSameDay } from './dates.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Anthropic's most capable model. Reading a stack of half-overlapping
 * notification banners — in Portuguese, with the amount and the merchant on
 * different lines — is exactly the kind of thing a smaller model gets subtly
 * wrong, and a subtly wrong expense is worse than none.
 */
export const MODEL = 'claude-opus-5';

const CATEGORY_IDS = CATEGORIES.map((entry) => entry.id);

/**
 * What we will accept back.
 *
 * `amount` is a string on purpose. A JSON number would arrive as a float and
 * `4.75 * 100` is 474.99999999999994; keeping the digits as text lets
 * `centsFromDigits` do the same string arithmetic it does everywhere else,
 * and it copes with "1.234,56" as well as "1,234.56".
 *
 * Structured outputs reject `minimum`, `maxLength` and friends, so every
 * constraint that matters is re-checked in `purchasesFromMessage`.
 */
export const SCHEMA = {
  type: 'object',
  properties: {
    purchases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amount: {
            type: 'string',
            description: 'The amount exactly as printed, digits and separators only, no currency symbol. E.g. "12,90" or "1.234,56".'
          },
          currency: {
            type: 'string',
            description: 'ISO 4217 code for the symbol shown (R$ is BRL, $ is USD, € is EUR). Empty string if no symbol is visible.'
          },
          merchant: {
            type: 'string',
            description: 'The shop or company name, cleaned of card-network noise. Empty string if none is shown.'
          },
          at: {
            type: 'string',
            description: 'Local date and time as YYYY-MM-DDTHH:MM. Use 12:00 when only a date is shown, and today\'s date when only a time is shown.'
          },
          isRefund: {
            type: 'boolean',
            description: 'True for money coming back — a refund, reversal, estorno, or cancelled charge.'
          },
          category: { type: 'string', enum: CATEGORY_IDS },
          note: {
            type: 'string',
            description: 'Anything else worth keeping in one short phrase, such as "installment 2 of 6". Empty string if nothing.'
          }
        },
        required: ['amount', 'currency', 'merchant', 'at', 'isRefund', 'category', 'note'],
        additionalProperties: false
      }
    }
  },
  required: ['purchases'],
  additionalProperties: false
};

const INSTRUCTIONS = `You read screenshots of bank and credit-card notifications and turn them into expense records.

A single screenshot usually holds several stacked notifications. Return one entry per purchase, in the order they appear, top to bottom.

Notifications are often in Brazilian Portuguese. "Compra aprovada", "compra no débito", "compra no crédito" and "transação aprovada" are purchases. "Estorno", "cancelamento" and "reembolso" are refunds — set isRefund. "R$" is BRL.

Rules:
- Copy amounts digit for digit, keeping the separators as printed. Never convert, round, or re-punctuate them.
- Skip anything that is not a purchase: balances, available limits, statement totals, invoice reminders, payments made to the card itself, transfers between your own accounts, login alerts, promotions.
- Skip the same purchase appearing twice in one screenshot (banks often send both an approval and a posting).
- If a banner is cut off and you cannot read its amount, leave it out rather than guessing.
- Guess the category from the merchant name. Use "other" when nothing fits.
- Return an empty list if the image holds no purchases at all.`;

/**
 * The request body for one screenshot.
 *
 * The image goes before the text: the model reads the content blocks in order,
 * and asking the question after showing the picture measurably beats the other
 * way round.
 */
export function requestBody({ base64, mediaType }, { currencyCode = 'USD', now = new Date() } = {}) {
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  return {
    model: MODEL,
    max_tokens: 16000,
    system: INSTRUCTIONS,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        {
          type: 'text',
          text: `Today is ${weekday}, ${today}. Anything without a visible date happened today.`
            + ` The default currency is ${currencyCode}.`
            + ` List every purchase in this screenshot.`
        }
      ]
    }]
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Turns an API response into expense drafts.
 *
 * Nothing here trusts the model: a bad amount drops the row rather than
 * saving a zero, an unknown currency falls back to yours rather than inventing
 * a code, and a date it could not have seen falls back to now.
 *
 * @returns {{drafts: object[], skipped: number}}
 */
export function purchasesFromMessage(message, { currencyCode = 'USD', now = new Date() } = {}) {
  if (message?.stop_reason === 'refusal') {
    throw new Error('The model declined to read that image. Try a different screenshot.');
  }

  const block = (message?.content ?? []).find((entry) => entry?.type === 'text');
  if (!block) throw new Error('The API sent back nothing readable.');

  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    throw new Error('The API sent back something that was not the expected JSON.');
  }

  const rows = Array.isArray(parsed?.purchases) ? parsed.purchases : [];
  const drafts = [];
  let skipped = 0;

  for (const row of rows) {
    const draft = draftFrom(row, { currencyCode, now });
    if (draft) drafts.push(draft);
    else skipped += 1;
  }

  return { drafts, skipped };
}

function draftFrom(row, { currencyCode, now }) {
  const digits = String(row?.amount ?? '').replace(/[^\d.,]/g, '');
  const cents = centsFromDigits(digits);
  if (cents === null || cents === 0) return null;

  const code = /^[A-Za-z]{3}$/.test(String(row?.currency ?? ''))
    ? String(row.currency).toUpperCase()
    : currencyCode;

  return {
    amount: cents,
    isRefund: row?.isRefund === true,
    currencyCode: code,
    merchant: String(row?.merchant ?? '').trim(),
    note: String(row?.note ?? '').trim(),
    date: dateFrom(row?.at, now),
    category: CATEGORY_IDS.includes(row?.category) ? row.category : 'other'
  };
}

/**
 * "2026-08-11T14:30" in the phone's own time zone.
 *
 * Built field by field rather than handed to `new Date(string)`, which reads a
 * bare date as UTC and can land the purchase on the previous day.
 */
function dateFrom(text, now) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(text ?? ''));
  if (!match) return now;

  const date = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    match[4] ? Number(match[4]) : 12, match[5] ? Number(match[5]) : 0
  );
  if (Number.isNaN(date.getTime())) return now;

  // A notification is always about something that already happened. A date in
  // the future means it misread the year, and a purchase filed under next
  // month would quietly go missing from this month's total.
  return date > now && !isSameDay(date, now) ? now : date;
}

/**
 * Does the ledger already have this purchase?
 *
 * Used to pre-empt the obvious mistake: screenshotting the notification list
 * two days running, where the top half is everything you imported yesterday.
 * Only a hint — the review sheet unticks the row and the answer stays yours,
 * because two identical coffees on one day is a real thing that happens.
 */
export function looksAlreadyLogged(draft, expenses) {
  const signed = draft.isRefund ? -draft.amount : draft.amount;
  return expenses.find((row) => row.currencyCode === draft.currencyCode
    && row.amount === signed
    && isSameDay(row.date, draft.date)
    && merchantsMatch(row.merchant, draft.merchant)) ?? null;
}

/** Plain language for the handful of things that actually go wrong. */
export function messageForError(status, body) {
  const detail = body?.error?.message ? ` (${body.error.message})` : '';
  if (status === 401 || status === 403) {
    return 'Anthropic rejected that API key. Check it in Settings — it should start with "sk-ant-".';
  }
  if (status === 429) return 'Too many requests just now. Wait a minute and try again.';
  if (status === 400) return `Anthropic could not use that request${detail}`;
  if (status === 413) return 'That image is too big. Try a screenshot of one screen rather than a long capture.';
  if (status === 529 || status >= 500) return 'Anthropic is busy right now. Try again in a minute.';
  return `Anthropic replied ${status}${detail}`;
}

/**
 * Sends one screenshot and returns the drafts it found.
 *
 * `anthropic-dangerous-direct-browser-access` is what lets a page call the API
 * without a server in front of it. The danger it names is shipping *your* key
 * inside a public site; here the key is the user's own, typed into their own
 * phone, and never leaves this browser except to Anthropic.
 */
export async function readScreenshot({ base64, mediaType, apiKey, currencyCode, now, signal }) {
  if (!apiKey) throw new Error('No API key set yet.');

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody({ base64, mediaType }, { currencyCode, now }))
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('Could not reach Anthropic — check your connection.');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messageForError(response.status, body));

  return purchasesFromMessage(body, { currencyCode, now });
}
