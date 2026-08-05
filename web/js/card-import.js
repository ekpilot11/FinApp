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

  if (url.searchParams.has('amount')) return url.searchParams;

  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const separator = hash.indexOf('?');
  if (separator !== -1) {
    const params = new URLSearchParams(hash.slice(separator + 1));
    if (params.has('amount')) return params;
  }
  return null;
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
