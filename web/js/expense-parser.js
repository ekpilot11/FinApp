// Reads sentences like "spent twelve fifty on coffee at Starbucks yesterday"
// and turns them into a draft expense. Ported from ExpenseParser.swift.
//
// Entirely offline and deterministic — no model, no API key, no network on the
// logging path. That keeps voice logging fast (the whole point) and keeps
// purchase history in the browser.
//
// Amounts are integer cents throughout; see money.js for why.

import { classify } from './category-classifier.js';
import { centsFromDecimalString } from './money.js';
import * as SpelledNumber from './spelled-number.js';
import { addDays, atMidday, weekdayOf } from './dates.js';
import { capitalizeFirst, findPhrase, fold, isWholeWord, tokenize } from './text.js';

/** Parses below this confidence open the editor instead of saving. */
export const REVIEW_THRESHOLD = 0.6;

/**
 * @typedef {object} ParsedExpense
 * @property {number|null} amount cents; the only field that can be missing,
 *   because an expense without a number is the one thing the app cannot invent
 * @property {string} currencyCode
 * @property {string|null} merchant
 * @property {string} category category id
 * @property {Date} date
 * @property {string} note
 * @property {boolean} isRefund
 * @property {boolean} dateWasExplicit true when the sentence actually said
 *   when it happened; when false, `date` is just "now"
 * @property {number} confidence 0...1
 * @property {string} transcript exactly what was heard
 * @property {boolean} isUsable
 * @property {number|null} signedAmount cents, negative for refunds
 * @property {number|null} alternativeAmount the other plausible reading of a
 *   dictated bare number, in cents; null when the amount is unambiguous
 */

/**
 * @param {string} rawText
 * @param {{referenceDate?: Date, defaultCurrency?: string}} [options]
 * @returns {ParsedExpense}
 */
export function parse(rawText, options = {}) {
  const referenceDate = options.referenceDate ?? new Date();
  const defaultCurrency = options.defaultCurrency ?? 'USD';

  const transcript = String(rawText ?? '').trim();
  const consumed = [];

  const isRefund = detectRefund(transcript);

  const amountMatch = extractAmount(transcript, defaultCurrency);
  if (amountMatch) consumed.push(amountMatch.range);

  const dateMatch = extractDate(transcript, referenceDate);
  if (dateMatch) consumed.push(dateMatch.range);

  const merchantMatch = extractMerchant(transcript);
  if (merchantMatch) consumed.push(merchantMatch.range);

  const note = buildNote(transcript, consumed);
  const category = classify(transcript, merchantMatch?.name ?? null);

  let confidence = 0;
  if (amountMatch) confidence += amountMatch.hadExplicitCurrency ? 0.6 : 0.5;
  if (merchantMatch) confidence += 0.15;
  if (category !== 'other') confidence += 0.15;
  if (dateMatch) confidence += 0.1;

  const amount = amountMatch ? amountMatch.value : null;

  return {
    amount,
    currencyCode: amountMatch?.currencyCode ?? defaultCurrency,
    merchant: merchantMatch?.name ?? null,
    category,
    date: dateMatch?.date ?? referenceDate,
    note,
    isRefund,
    dateWasExplicit: dateMatch !== null,
    confidence: Math.min(confidence, 1),
    transcript,
    isUsable: amount !== null,
    signedAmount: amount === null ? null : (isRefund ? -amount : amount),
    alternativeAmount: amountMatch?.alternative ?? null
  };
}

// MARK: - Refunds

const REFUND_PHRASES = [
  'refund', 'refunded', 'returned', 'got back', 'gave me back',
  'reimbursed', 'cash back', 'chargeback'
];

function detectRefund(text) {
  return REFUND_PHRASES.some((phrase) => findPhrase(text, phrase) !== null);
}

// MARK: - Amount

/** Symbols that pin down a currency on their own. `null` means "the default". */
const SYMBOL_CURRENCIES = [
  ['R$', 'BRL'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'],
  ['₽', 'RUB'], ['₩', 'KRW'], ['₺', 'TRY'],
  ['$', null]
];

/** Spoken currency names and codes. */
const CURRENCY_WORDS = {
  dollar: 'USD', dollars: 'USD', buck: 'USD', bucks: 'USD', usd: 'USD',
  euro: 'EUR', euros: 'EUR', eur: 'EUR',
  pound: 'GBP', pounds: 'GBP', quid: 'GBP', gbp: 'GBP',
  real: 'BRL', reais: 'BRL', reals: 'BRL', brl: 'BRL',
  yen: 'JPY', jpy: 'JPY',
  rupee: 'INR', rupees: 'INR', inr: 'INR',
  peso: 'MXN', pesos: 'MXN',
  franc: 'CHF', francs: 'CHF', chf: 'CHF',
  krona: 'SEK', kronor: 'SEK',
  zloty: 'PLN', cad: 'CAD', aud: 'AUD', nzd: 'NZD'
};

/** Words that mean a nearby number is not money. */
const NON_MONEY_FOLLOWERS = new Set([
  'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year',
  'hours', 'hour', 'minutes', 'minute', 'people', 'person', 'percent',
  'am', 'pm', 'oclock', "o'clock", 'times', 'kg', 'lbs', 'pounds'
]);

const DIGIT_AMOUNT_PATTERN = /(R\$|[$€£¥₹₽₩₺])?\s*(\d[\d.,]*)\s*(dollars?|bucks?|euros?|pounds?|quid|reais|reals?|rupees|yen|pesos?|francs?|usd|eur|gbp|brl|jpy|inr|mxn|chf|cad|aud|nzd|sek|pln)?/gid;

const DIGITS_AND_CENTS_PATTERN = /(R\$|[$€£¥₹₽₩₺])?\s*(\d+)\s*(dollars?|bucks?|euros?|pounds?|reais|reals?)?\s*(?:and\s+)?(\d{1,2})\s*(?:cents?|centavos|pence)/i;

/**
 * @typedef {object} AmountMatch
 * @property {number} value cents
 * @property {string} currencyCode
 * @property {boolean} hadExplicitCurrency
 * @property {number|null} alternative the other plausible reading, in cents
 * @property {{start: number, end: number}} range
 */

/**
 * The other way a bare number could be read, when dictation has already
 * thrown away the distinction.
 *
 * Saying "twelve fifty" into Safari does not produce the words — it produces
 * `1250`, which is equally "twelve fifty" and "twelve hundred and fifty".
 * Nothing downstream can recover which was meant, so guessing silently is how
 * a coffee gets filed at a hundred times its price and every total after it
 * is wrong.
 *
 * Only bare integers qualify. A spoken separator ("twelve point five",
 * "45.99") settles the question, and so does a round hundred: nobody says
 * "twelve hundred" meaning twelve.
 *
 * @param {string} numberText exactly as it appeared
 * @param {number} cents the literal reading
 * @returns {number|null} the alternative in cents, or null when unambiguous
 */
function alternativeReading(numberText, cents) {
  if (/[.,]/.test(numberText)) return null;
  if (cents % 100 !== 0) return null;

  const major = cents / 100;
  if (major < 100 || major > 9999) return null;
  if (major % 100 === 0) return null;

  return major;
}

/** @returns {AmountMatch|null} */
export function extractAmount(text, defaultCurrency) {
  // "12 dollars and 50 cents" must be read as one amount before the general
  // digit scan gets a chance to return just the 12.
  return extractDigitsAndCents(text, defaultCurrency)
    ?? extractDigitAmount(text, defaultCurrency)
    ?? extractSpelledAmount(text, defaultCurrency);
}

function currencyForSymbol(symbol, defaultCurrency) {
  const trimmed = symbol.trim().toLowerCase();
  const entry = SYMBOL_CURRENCIES.find(([candidate]) => candidate.toLowerCase() === trimmed);
  if (!entry) return null;
  return entry[1] ?? defaultCurrency;
}

function extractDigitsAndCents(text, defaultCurrency) {
  const match = DIGITS_AND_CENTS_PATTERN.exec(text);
  if (!match) return null;

  const whole = Number(match[2]);
  const cents = Number(match[4]);
  if (!Number.isFinite(whole) || !Number.isFinite(cents)) return null;

  let code = defaultCurrency;
  if (match[1]) {
    code = currencyForSymbol(match[1], defaultCurrency) ?? code;
  }
  if (match[3]) {
    const mapped = CURRENCY_WORDS[match[3].toLowerCase()];
    if (mapped) code = mapped;
  }

  return {
    value: whole * 100 + cents,
    currencyCode: code,
    // Saying "cents" is itself an explicit statement about money.
    hadExplicitCurrency: true,
    alternative: null,
    range: { start: match.index, end: match.index + match[0].length }
  };
}

function extractDigitAmount(text, defaultCurrency) {
  DIGIT_AMOUNT_PATTERN.lastIndex = 0;
  let best = null;

  for (const match of text.matchAll(DIGIT_AMOUNT_PATTERN)) {
    const numberText = match[2];
    if (numberText === undefined) continue;
    const value = centsFromDigits(numberText);
    if (value === null) continue;

    const numberEnd = match.indices[2][1];
    const fullStart = match.index;
    const fullEnd = match.index + match[0].length;
    const unit = match[3] ? match[3].toLowerCase() : null;

    // "on the 5th", "3 days ago", "at 7 pm" are not amounts.
    if (isOrdinal(numberEnd, text)) continue;
    if (!unit) {
      const next = nextWord(fullEnd, text);
      if (next && NON_MONEY_FOLLOWERS.has(next.toLowerCase())) continue;
    }

    let code = defaultCurrency;
    let explicit = false;

    if (match[1]) {
      const mapped = currencyForSymbol(match[1], defaultCurrency);
      if (mapped) {
        code = mapped;
        explicit = true;
      }
    }
    if (unit && CURRENCY_WORDS[unit]) {
      code = CURRENCY_WORDS[unit];
      explicit = true;
    }

    const score = explicit ? 3 : (hasSpendVerbNearby(fullStart, text) ? 2 : 1);
    if (best === null || score > best.score) {
      best = {
        score,
        match: {
          value,
          currencyCode: code,
          hadExplicitCurrency: explicit,
          alternative: alternativeReading(numberText, value),
          range: { start: fullStart, end: fullEnd }
        }
      };
    }
  }

  return best ? best.match : null;
}

/** "twelve fifty", "twenty bucks", "one hundred and five euros". */
function extractSpelledAmount(text, defaultCurrency) {
  const tokens = tokenize(text);
  const words = tokens.map((token) => token.text);
  const runs = SpelledNumber.runs(words);
  if (runs.length === 0) return null;

  // Currency word anywhere in the sentence, e.g. "twelve fifty in euros".
  let code = defaultCurrency;
  let explicit = false;
  for (const word of words) {
    if (CURRENCY_WORDS[word]) {
      code = CURRENCY_WORDS[word];
      explicit = true;
      break;
    }
  }

  /** Tokens allowed to sit between the dollars part and the cents part. */
  const bridge = new Set(['and', 'point', 'dot', ...Object.keys(CURRENCY_WORDS)]);

  // Spelled-out numbers are never ambiguous: the speaker said the words, and
  // "twelve fifty" and "twelve hundred fifty" are different words.
  const makeMatch = (value, start, end) => ({
    value,
    currencyCode: code,
    hadExplicitCurrency: explicit,
    alternative: null,
    range: { start: tokens[start].start, end: tokens[end - 1].end }
  });

  // Dollars-and-cents: two runs separated only by bridge words.
  for (let index = 0; index < runs.length - 1; index += 1) {
    const first = runs[index];
    const second = runs[index + 1];
    const between = words.slice(first.end, second.start);
    if (!between.every((word) => bridge.has(word))) continue;
    if (second.value < 1 || second.value > 99 || first.value > 9999) continue;

    const usesPoint = between.includes('point') || between.includes('dot');
    // "twelve point five" is 12.50, not 12.05.
    const cents = usesPoint && second.value < 10 ? second.value * 10 : second.value;

    let end = second.end;
    if (end < words.length && ['cents', 'cent', 'centavos', 'pence', 'p'].includes(words[end])) {
      end += 1;
    }

    return makeMatch(first.value * 100 + cents, first.start, end);
  }

  // Otherwise the run that sits next to a currency word, else the first.
  const chosen = runs.find((run) => run.end < words.length && CURRENCY_WORDS[words[run.end]])
    ?? runs[0];

  let end = chosen.end;
  if (end < words.length && CURRENCY_WORDS[words[end]]) end += 1;

  return makeMatch(chosen.value * 100, chosen.start, end);
}

/**
 * Reads "1,250.75" / "1.250,75" / "12,50" / "12.50" into cents without
 * guessing wrong about which separator is which.
 *
 * @returns {number|null} cents
 */
export function centsFromDigits(raw) {
  let text = String(raw).replace(/^[.,]+/, '').replace(/[.,]+$/, '');
  if (!text) return null;

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    // Both separators present: the rightmost one is the decimal point.
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const thousands = decimalSeparator === '.' ? ',' : '.';
    text = text.split(thousands).join('');
    text = text.split(decimalSeparator).join('.');
  } else if (lastDot !== -1 || lastComma !== -1) {
    const separator = lastDot !== -1 ? '.' : ',';
    const separatorIndex = lastDot !== -1 ? lastDot : lastComma;
    const fractionDigits = text.length - separatorIndex - 1;
    const occurrences = text.split(separator).length - 1;
    // "1.250" and "1,250" are thousands; "12.5" and "12,50" are decimals.
    if (fractionDigits === 3 || occurrences > 1) {
      text = text.split(separator).join('');
    } else {
      text = text.split(separator).join('.');
    }
  }

  if (!/^[0-9.]+$/.test(text)) return null;
  return centsFromDecimalString(text);
}

function isOrdinal(index, text) {
  if (index >= text.length) return false;
  return ['st', 'nd', 'rd', 'th'].includes(text.slice(index, index + 2).toLowerCase());
}

function nextWord(index, text) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  let end = cursor;
  while (end < text.length && (/\p{L}/u.test(text[end]) || text[end] === "'")) end += 1;
  return end > cursor ? text.slice(cursor, end) : null;
}

const SPEND_VERBS = ['spent', 'paid', 'cost', 'costs', 'bought', 'charged', 'spend'];

function hasSpendVerbNearby(start, text) {
  const prefix = text.slice(Math.max(0, start - 24), start);
  return SPEND_VERBS.some((verb) => findPhrase(prefix, verb) !== null);
}

// MARK: - Date

const WEEKDAY_NAMES = [
  ['sunday', 1], ['monday', 2], ['tuesday', 3], ['wednesday', 4],
  ['thursday', 5], ['friday', 6], ['saturday', 7]
];

const MONTH_NAMES = [
  ['january', 1], ['jan', 1], ['february', 2], ['feb', 2], ['march', 3], ['mar', 3],
  ['april', 4], ['apr', 4], ['may', 5], ['june', 6], ['jun', 6], ['july', 7], ['jul', 7],
  ['august', 8], ['aug', 8], ['september', 9], ['sep', 9], ['sept', 9],
  ['october', 10], ['oct', 10], ['november', 11], ['nov', 11], ['december', 12], ['dec', 12]
];

/** Longest phrases first so "day before yesterday" beats "yesterday". */
const RELATIVE_PHRASES = [
  ['day before yesterday', -2], ['the other day', -2],
  ['last night', -1], ['yesterday', -1],
  ['this morning', 0], ['this afternoon', 0], ['this evening', 0],
  ['tonight', 0], ['today', 0], ['just now', 0],
  ['last week', -7], ['a week ago', -7]
];

/**
 * @typedef {object} DateMatch
 * @property {Date} date
 * @property {{start: number, end: number}} range
 */

/** @returns {DateMatch|null} */
export function extractDate(text, referenceDate) {
  for (const [phrase, days] of RELATIVE_PHRASES) {
    const range = findPhrase(text, phrase);
    if (range) {
      return { date: preserveTime(addDays(referenceDate, days), days, referenceDate), range };
    }
  }

  return extractNDaysAgo(text, referenceDate)
    ?? extractWeekday(text, referenceDate)
    ?? extractCalendarDate(text, referenceDate);
}

/**
 * Past dates land at midday so a later time-zone shift cannot slide them onto
 * the wrong day; "today" keeps the real clock time.
 */
function preserveTime(date, days, reference) {
  return days === 0 ? reference : atMidday(date);
}

/** Vague quantities people actually say. */
const APPROXIMATE_COUNTS = { a: 1, an: 1, couple: 2, few: 3, several: 4 };

/**
 * Alternation of every word that can begin a count, longest first so the
 * engine prefers "seventeen" over "seven".
 */
const COUNT_WORD_ALTERNATION = [...new Set([
  ...Object.keys(SpelledNumber.UNITS),
  ...Object.keys(SpelledNumber.TENS),
  'hundred', 'thousand',
  ...Object.keys(APPROXIMATE_COUNTS)
])].sort((left, right) => right.length - left.length).join('|');

/**
 * Matching `[a-z]+` here would let an ordinary word be read as the count —
 * "a book two weeks ago" captured "book two" and then parsed as nothing at
 * all, silently losing the date. Only real number words are allowed.
 */
const DAYS_AGO_PATTERN = new RegExp(
  `(\\d+|(?:${COUNT_WORD_ALTERNATION})(?:\\s+(?:${COUNT_WORD_ALTERNATION}))*)\\s+(?:days?|weeks?)\\s+ago`,
  'i'
);

function extractNDaysAgo(text, referenceDate) {
  const match = DAYS_AGO_PATTERN.exec(text);
  if (!match) return null;

  const count = countValue(match[1]);
  if (count === null || count <= 0 || count >= 3650) return null;

  const isWeeks = findPhrase(match[0], 'week') !== null;
  const days = isWeeks ? count * 7 : count;

  return {
    date: preserveTime(addDays(referenceDate, -days), -days, referenceDate),
    range: { start: match.index, end: match.index + match[0].length }
  };
}

/** "3", "three", "a couple", "a few". */
function countValue(text) {
  const normalized = text.toLowerCase().trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const spelled = SpelledNumber.valueOf(normalized);
  if (spelled !== null) return spelled;

  if (Object.hasOwn(APPROXIMATE_COUNTS, normalized)) return APPROXIMATE_COUNTS[normalized];

  // "a few" / "a couple" — the article carries no count of its own.
  const words = normalized.split(/\s+/);
  if (words.length === 2 && (words[0] === 'a' || words[0] === 'an')) {
    return APPROXIMATE_COUNTS[words[1]] ?? null;
  }
  return null;
}

function extractWeekday(text, referenceDate) {
  const folded = fold(text);

  for (const [name, weekday] of WEEKDAY_NAMES) {
    // Prefer "last friday" so the whole phrase gets stripped from the note.
    const lastRange = findPhrase(text, `last ${name}`);
    if (lastRange) {
      return { date: mostRecent(weekday, referenceDate, false), range: lastRange };
    }

    const range = findPhrase(text, name);
    if (!range) continue;
    if (!isWholeWord(text, range)) continue;

    // Include a leading "on " so the note does not keep a dangling word.
    let fullRange = range;
    if (range.start >= 3 && folded.slice(range.start - 3, range.start) === 'on ') {
      fullRange = { start: range.start - 3, end: range.end };
    }
    return { date: mostRecent(weekday, referenceDate, true), range: fullRange };
  }
  return null;
}

function mostRecent(weekday, reference, allowToday) {
  const referenceWeekday = weekdayOf(reference);
  let delta = referenceWeekday - weekday;
  if (delta < 0) delta += 7;
  if (delta === 0 && !allowToday) delta = 7;
  if (delta === 0) return reference;
  return atMidday(addDays(reference, -delta));
}

const CALENDAR_DATE_PATTERN = /(?:on\s+)?(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)|([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)/gi;

function extractCalendarDate(text, referenceDate) {
  CALENDAR_DATE_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(CALENDAR_DATE_PATTERN)) {
    let monthText = null;
    let dayText = null;

    if (match[1] !== undefined && match[2] !== undefined) {
      dayText = match[1];
      monthText = match[2];
    } else if (match[3] !== undefined && match[4] !== undefined) {
      monthText = match[3];
      dayText = match[4];
    }
    if (monthText === null || dayText === null) continue;

    const day = Number(dayText);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    const lowered = monthText.toLowerCase();
    const month = MONTH_NAMES.find(([name]) => name === lowered)?.[1];
    if (month === undefined) continue;

    let date = new Date(referenceDate.getFullYear(), month - 1, day, 12);
    // "February 31" rolls forward into March; reject it rather than file the
    // expense three days late.
    if (date.getMonth() !== month - 1) continue;

    // A date later than today almost always means last year.
    if (date > referenceDate) {
      date = new Date(date.getFullYear() - 1, month - 1, day, 12);
    }

    return { date, range: { start: match.index, end: match.index + match[0].length } };
  }

  return null;
}

// MARK: - Merchant

const MERCHANT_STOP_WORDS = new Set([
  'on', 'for', 'yesterday', 'today', 'tonight', 'last', 'this', 'with',
  'using', 'and', 'because', 'to', 'about', 'around', 'it', 'that', 'was',
  'morning', 'afternoon', 'evening', 'night', 'just', 'the', 'a', 'an',
  'cash', 'card', 'credit', 'debit'
]);

const MERCHANT_MARKERS = new Set(['at', 'from']);

/** @returns {{name: string, range: {start: number, end: number}}|null} */
export function extractMerchant(text) {
  const tokens = tokenize(text);
  const words = tokens.map((token) => token.text);

  for (let markerIndex = 0; markerIndex < words.length; markerIndex += 1) {
    if (!MERCHANT_MARKERS.has(words[markerIndex])) continue;

    let cursor = markerIndex + 1;
    // "at the corner store" — the article is not part of the name.
    if (cursor < words.length && words[cursor] === 'the') cursor += 1;

    const kept = [];
    let lastIndex = markerIndex;

    while (cursor < words.length && kept.length < 4) {
      const candidate = words[cursor];
      if (MERCHANT_STOP_WORDS.has(candidate)) break;
      if (SpelledNumber.isNumberWord(candidate)) break;
      if (candidate.length > 0 && /\p{N}/u.test(candidate[0])) break;
      kept.push(displayName(tokens[cursor]));
      lastIndex = cursor;
      cursor += 1;
    }

    if (kept.length === 0) continue;
    return {
      name: kept.join(' '),
      range: { start: tokens[markerIndex].start, end: tokens[lastIndex].end }
    };
  }
  return null;
}

/**
 * Keeps the speaker's own capitalization when they had some ("McDonald's"
 * from keyboard input), and title-cases what dictation lowercased.
 */
function displayName(token) {
  const raw = token.raw;
  if (/\p{Lu}/u.test(raw)) return raw;
  return capitalizeFirst(raw);
}

// MARK: - Note

const LEADING_FILLER = new Set([
  'i', 'just', 'spent', 'paid', 'pay', 'log', 'logged', 'add', 'record',
  'put', 'down', 'bought', 'buy', 'for', 'on', 'a', 'an', 'the', 'of',
  'some', 'my', 'me', 'it', 'was', 'cost', 'costs', 'charged', 'there',
  'and', 'please', 'expense', 'refund', 'refunded', 'got', 'back'
]);

function buildNote(text, ranges) {
  // Built by copying the gaps rather than by mutating, so that every range
  // stays valid against the original string.
  const pieces = [];
  let cursor = 0;

  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    if (range.start > cursor) pieces.push(text.slice(cursor, range.start));
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));

  const words = pieces
    .join(' ')
    .split(/\s+/)
    .map((word) => trimEdgePunctuation(word))
    .filter(Boolean);

  while (words.length && LEADING_FILLER.has(words[0].toLowerCase())) words.shift();
  while (words.length && LEADING_FILLER.has(words[words.length - 1].toLowerCase())) words.pop();

  return capitalizeFirst(words.join(' '));
}

function trimEdgePunctuation(word) {
  let start = 0;
  let end = word.length;
  while (start < end && /\p{P}/u.test(word[start])) start += 1;
  while (end > start && /\p{P}/u.test(word[end - 1])) end -= 1;
  return word.slice(start, end);
}
