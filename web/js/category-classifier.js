// Guesses a category from free text. Ported from CategoryClassifier.swift.
//
// Used by both the voice parser (whole spoken sentence) and the bank importer
// (merchant name plus whatever description the provider gives us), so it has
// to cope with "grabbed a latte at the place downstairs" and with
// "SQ *BLUE BOTTLE 4471 OAKLAND CA" alike.

import { CATEGORIES } from './categories.js';
import { fold, isAlphanumeric } from './text.js';

/**
 * Merchants specific enough to beat any keyword match.
 *
 * Matched on word boundaries against normalized text, so a brand name that
 * happens to be an English word cannot fire from inside a longer one. A brand
 * whose name is a *whole* common word still has to be left out — see the
 * notes below.
 */
const BRANDS = [
  // Coffee
  ['starbucks', 'coffee'], ['blue bottle', 'coffee'], ['dunkin', 'coffee'],
  ['costa coffee', 'coffee'], ['peet', 'coffee'], ['tim hortons', 'coffee'],
  ['caribou coffee', 'coffee'], ['pret a manger', 'coffee'],

  // Dining
  ['mcdonald', 'diningOut'], ['burger king', 'diningOut'], ['kfc', 'diningOut'],
  ['subway sandwich', 'diningOut'], ['chipotle', 'diningOut'], ['taco bell', 'diningOut'],
  ['wendy', 'diningOut'], ['domino', 'diningOut'], ['pizza hut', 'diningOut'],
  ['papa john', 'diningOut'], ['five guys', 'diningOut'], ['shake shack', 'diningOut'],
  ['doordash', 'diningOut'], ['grubhub', 'diningOut'], ['ubereats', 'diningOut'],
  ['uber eats', 'diningOut'], ['deliveroo', 'diningOut'], ['just eat', 'diningOut'],
  ['ifood', 'diningOut'], ['nando', 'diningOut'], ['panera', 'diningOut'],

  // Groceries
  ['whole foods', 'groceries'], ['trader joe', 'groceries'], ['safeway', 'groceries'],
  ['kroger', 'groceries'], ['aldi', 'groceries'], ['lidl', 'groceries'],
  ['tesco', 'groceries'], ['sainsbury', 'groceries'], ['carrefour', 'groceries'],
  ['walmart', 'groceries'], ['costco', 'groceries'], ['publix', 'groceries'],
  ['wegmans', 'groceries'], ['mercadona', 'groceries'], ['pao de acucar', 'groceries'],
  ['instacart', 'groceries'],

  // Transport
  ['uber', 'transport'], ['lyft', 'transport'], ['bolt', 'transport'],
  ['cabify', 'transport'], ['99 taxi', 'transport'], ['citi bike', 'transport'],
  // No "grab", "lime" or "bird". Each is a whole common word — "grab a
  // coffee", "bought limes" — and because brands outrank every keyword, a
  // false match here cannot be recovered from.
  ['mta', 'transport'], ['tfl', 'transport'], ['bart', 'transport'],
  ['amtrak', 'transport'], ['trainline', 'transport'], ['sixt', 'transport'],

  // Fuel
  ['shell', 'fuel'], ['chevron', 'fuel'], ['exxon', 'fuel'], ['mobil', 'fuel'],
  ['bp', 'fuel'], ['texaco', 'fuel'], ['petrobras', 'fuel'], ['ipiranga', 'fuel'],
  ['repsol', 'fuel'], ['electrify america', 'fuel'], ['chargepoint', 'fuel'],
  ['supercharger', 'fuel'],

  // Subscriptions
  ['netflix', 'subscriptions'], ['spotify', 'subscriptions'], ['hulu', 'subscriptions'],
  ['disney+', 'subscriptions'], ['disney plus', 'subscriptions'],
  ['apple.com/bill', 'subscriptions'], ['icloud', 'subscriptions'],
  ['youtube premium', 'subscriptions'], ['hbo', 'subscriptions'],
  ['audible', 'subscriptions'], ['patreon', 'subscriptions'],
  ['openai', 'subscriptions'], ['anthropic', 'subscriptions'],
  ['adobe', 'subscriptions'], ['dropbox', 'subscriptions'],

  // Shopping
  ['amazon', 'shopping'], ['ebay', 'shopping'], ['etsy', 'shopping'],
  ['aliexpress', 'shopping'], ['shein', 'shopping'], ['zara', 'shopping'],
  ['h&m', 'shopping'], ['uniqlo', 'shopping'], ['nike', 'shopping'],
  ['adidas', 'shopping'], ['best buy', 'shopping'], ['target', 'shopping'],
  ['apple store', 'shopping'],

  // Health
  // No "boots": the UK pharmacy is region-specific, footwear is not.
  ['cvs', 'health'], ['walgreens', 'health'],
  ['rite aid', 'health'], ['droga raia', 'health'], ['drogasil', 'health'],

  // Home
  ['ikea', 'home'], ['home depot', 'home'], ['lowe', 'home'], ['b&q', 'home'],
  ['leroy merlin', 'home'],

  // Travel
  ['airbnb', 'travel'], ['booking.com', 'travel'], ['expedia', 'travel'],
  ['hotels.com', 'travel'], ['marriott', 'travel'], ['hilton', 'travel'],
  ['delta air', 'travel'], ['united airlines', 'travel'], ['american airlines', 'travel'],
  ['ryanair', 'travel'], ['easyjet', 'travel'], ['lufthansa', 'travel'],
  ['latam', 'travel'], ['gol linhas', 'travel'],

  // Entertainment
  ['steam', 'entertainment'], ['playstation', 'entertainment'],
  ['xbox', 'entertainment'], ['nintendo', 'entertainment'],
  ['amc theatre', 'entertainment'], ['amc theater', 'entertainment'],
  ['cinemark', 'entertainment'], ['ticketmaster', 'entertainment'],

  // Bills
  ['verizon', 'bills'], ['at&t', 'bills'], ['t-mobile', 'bills'],
  ['vodafone', 'bills'], ['comcast', 'bills'], ['xfinity', 'bills'],
  ['state farm', 'bills'], ['geico', 'bills']
];

/**
 * Keyword table flattened once, longest keyword first so that
 * "gym membership" wins over "gym".
 */
const RANKED_KEYWORDS = CATEGORIES
  .flatMap((entry) => entry.keywords.map((keyword) => [fold(keyword), entry.id]))
  .sort((left, right) => right[0].length - left[0].length);

/**
 * Best-guess category id, or 'other' when nothing matches.
 *
 * @param {string} text the full sentence or transaction description
 * @param {string|null} merchant merchant name if extracted separately;
 *   weighted more heavily than the rest of the text
 */
export function classify(text, merchant = null) {
  const haystack = normalize(text ?? '');
  const merchantHaystack = merchant ? normalize(merchant) : '';

  // 1. A known brand anywhere wins outright.
  //
  // Matched on word boundaries, exactly like keywords. A plain substring
  // search reads "grabbed lunch" as the Grab ride app and "mobile phone bill"
  // as a Mobil petrol station — and because brands outrank everything, that
  // wrong answer is final.
  for (const [needle, id] of BRANDS) {
    if (containsWord(needle, merchantHaystack)) return id;
  }
  for (const [needle, id] of BRANDS) {
    if (containsWord(needle, haystack)) return id;
  }

  // 2. Otherwise the most specific keyword, merchant text first.
  if (merchantHaystack) {
    const match = firstKeywordMatch(merchantHaystack);
    if (match) return match;
  }
  const match = firstKeywordMatch(haystack);
  if (match) return match;

  return 'other';
}

function firstKeywordMatch(haystack) {
  for (const [keyword, id] of RANKED_KEYWORDS) {
    if (containsWord(keyword, haystack)) return id;
  }
  return null;
}

/**
 * Substring match that respects word boundaries, so "bar" does not fire on
 * "barber" and "gas" does not fire on "gasket".
 */
export function containsWord(needle, haystack) {
  if (!needle) return false;

  let searchStart = 0;
  for (;;) {
    const index = haystack.indexOf(needle, searchStart);
    if (index === -1) return false;
    const end = index + needle.length;
    if (startsAtBoundary(index, haystack) && endsAtBoundary(end, haystack)) return true;
    searchStart = index + 1;
  }
}

function startsAtBoundary(index, haystack) {
  if (index === 0) return true;
  return !isAlphanumeric(haystack[index - 1]);
}

/**
 * A match may run on into a plural "s" or a possessive "'s".
 *
 * Several brands are listed in stem form because that is what survives across
 * spellings — "mcdonald" covers both "McDonald's" and the "MCDONALDS" a card
 * statement prints, and "lowe" covers "Lowe's" and "LOWES". Demanding a hard
 * boundary would break every one of them.
 *
 * Nothing else is allowed through, so "grab" still does not fire on "grabbed"
 * and "mobil" still does not fire on "mobile".
 */
function endsAtBoundary(index, haystack) {
  let cursor = index;
  if (cursor < haystack.length && haystack[cursor] === "'") cursor += 1;
  if (cursor < haystack.length && haystack[cursor] === 's') cursor += 1;
  if (cursor >= haystack.length) return true;
  return !isAlphanumeric(haystack[cursor]);
}

const PROCESSOR_PREFIXES = ['sq *', 'sq*', 'tst*', 'tst *', 'sp *', 'sp*', 'pos ', 'purchase '];

/**
 * Lowercase, strip diacritics, collapse whitespace. Statement descriptors
 * arrive in shouty ASCII with store numbers glued on, so this also drops the
 * `SQ *` / `TST*` style prefixes payment processors add.
 */
export function normalize(input) {
  let text = fold(input);
  for (const prefix of PROCESSOR_PREFIXES) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }
  return text.split(/\s+/).filter(Boolean).join(' ');
}
