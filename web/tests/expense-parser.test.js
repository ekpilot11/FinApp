import test from 'node:test';
import assert from 'node:assert/strict';

import { REVIEW_THRESHOLD, centsFromDigits, parse } from '../js/expense-parser.js';
import { isSameDay, weekdayOf, addDays } from '../js/dates.js';

// Every date here is built in the machine's own time zone, and every
// expectation is compared the same way, so the suite passes wherever it runs
// rather than only under TZ=UTC.

/** Tuesday 4 August 2026, 10:00 local. */
const REFERENCE = day(2026, 8, 4, 10);

function day(year, month, dayOfMonth, hour = 12) {
  return new Date(year, month - 1, dayOfMonth, hour);
}

function parseAt(text, currency = 'USD') {
  return parse(text, { referenceDate: REFERENCE, defaultCurrency: currency });
}

// MARK: - Amounts

test('spoken dollars and cents', () => {
  const result = parseAt('spent twelve fifty on coffee at Starbucks');
  assert.equal(result.amount, 1250);
  assert.equal(result.merchant, 'Starbucks');
  assert.equal(result.category, 'coffee');
});

test('spoken whole number with a currency word', () => {
  const result = parseAt('twenty five bucks on lunch');
  assert.equal(result.amount, 2500);
  assert.equal(result.currencyCode, 'USD');
  assert.equal(result.category, 'diningOut');
  assert.equal(result.note, 'Lunch');
});

test('spoken cents phrase', () => {
  assert.equal(parseAt('twelve dollars and fifty cents for parking').amount, 1250);
});

test('digit cents phrase', () => {
  const result = parseAt('12 dollars and 50 cents for parking');
  assert.equal(result.amount, 1250);
  assert.equal(result.category, 'transport');
});

test('digits with a symbol', () => {
  const result = parseAt('$45.99 at Whole Foods');
  assert.equal(result.amount, 4599);
  assert.equal(result.merchant, 'Whole Foods');
  assert.equal(result.category, 'groceries');
});

test('a foreign currency symbol overrides the default', () => {
  const result = parseAt('€30 on dinner');
  assert.equal(result.amount, 3000);
  assert.equal(result.currencyCode, 'EUR');
});

test('a currency word overrides the default', () => {
  const result = parseAt('spent 40 euros at the pharmacy');
  assert.equal(result.amount, 4000);
  assert.equal(result.currencyCode, 'EUR');
});

test('prefers the number carrying currency', () => {
  // The 3 belongs to the date phrase; the 20 is the money.
  assert.equal(parseAt('3 days ago I spent $20 on a taxi').amount, 2000);
});

test('a missing amount is not usable', () => {
  const result = parseAt('bought a coffee at the place downstairs');
  assert.equal(result.amount, null);
  assert.equal(result.isUsable, false);
  assert.ok(result.confidence < REVIEW_THRESHOLD);
});

// MARK: - Decimal separators

test('decimal separator handling', () => {
  assert.equal(centsFromDigits('12.50'), 1250);
  assert.equal(centsFromDigits('12,50'), 1250);
  assert.equal(centsFromDigits('1,250.75'), 125075);
  assert.equal(centsFromDigits('1.250,75'), 125075);
  // Three trailing digits are a thousands group, not a fraction.
  assert.equal(centsFromDigits('1.250'), 125000);
  assert.equal(centsFromDigits('1,250'), 125000);
});

// The whole reason amounts are integers: this is exact, and the obvious
// `parseFloat(x) * 100` is not.
test('cents arithmetic does not drift', () => {
  let sum = 0;
  for (let index = 0; index < 10; index += 1) sum += centsFromDigits('4.75');
  assert.equal(sum, 4750);
});

// MARK: - Dates

test('yesterday', () => {
  const result = parseAt('spent 10 dollars on coffee yesterday');
  assert.equal(result.dateWasExplicit, true);
  assert.ok(isSameDay(result.date, day(2026, 8, 3)));
});

test('last night is yesterday', () => {
  const result = parseAt('30 bucks on drinks last night');
  assert.ok(isSameDay(result.date, day(2026, 8, 3)));
});

test('n days ago', () => {
  const result = parseAt('paid 20 dollars for parking 3 days ago');
  assert.ok(isSameDay(result.date, day(2026, 8, 1)));
});

test('spelled days ago', () => {
  const result = parseAt('paid 20 dollars for parking two days ago');
  assert.ok(isSameDay(result.date, day(2026, 8, 2)));
});

// "a book two weeks ago" used to capture "book two" as the count and lose the
// date entirely.
test('weeks ago', () => {
  const result = parseAt('15 dollars on a book two weeks ago');
  assert.ok(isSameDay(result.date, day(2026, 7, 21)));
});

test('a weekday resolves into the past', () => {
  const result = parseAt('spent 25 dollars on groceries on friday');
  assert.equal(result.dateWasExplicit, true);
  assert.equal(weekdayOf(result.date), 6, 'Friday is weekday 6');
  assert.ok(result.date <= REFERENCE);
  assert.ok(result.date > addDays(REFERENCE, -8));
});

test('an explicit calendar date', () => {
  const result = parseAt('spent 60 dollars on July 12');
  assert.ok(isSameDay(result.date, day(2026, 7, 12)));
});

// A month later than today can only mean last year.
test('a future-looking date rolls back a year', () => {
  const result = parseAt('spent 60 dollars on December 12');
  assert.ok(isSameDay(result.date, day(2025, 12, 12)));
});

test('no date phrase means now', () => {
  const result = parseAt('spent 10 dollars on coffee');
  assert.equal(result.dateWasExplicit, false);
  assert.equal(result.date.getTime(), REFERENCE.getTime());
});

// MARK: - Merchants

test('merchant after "at"', () => {
  assert.equal(parseAt('15 dollars at Chipotle').merchant, 'Chipotle');
});

test('merchant after "from"', () => {
  assert.equal(parseAt('60 dollars from Ikea').merchant, 'Ikea');
});

test('merchant skips the article', () => {
  assert.equal(parseAt('8 dollars at the corner store').merchant, 'Corner Store');
});

test('merchant stops at time words', () => {
  assert.equal(parseAt('8 dollars at Pret yesterday').merchant, 'Pret');
});

test('no merchant when none was spoken', () => {
  assert.equal(parseAt('spent 8 dollars on coffee').merchant, null);
});

// MARK: - Refunds

test('a refund is negative', () => {
  const result = parseAt('got refunded 30 dollars from Zara');
  assert.equal(result.isRefund, true);
  assert.equal(result.amount, 3000);
  assert.equal(result.signedAmount, -3000);
  assert.equal(result.merchant, 'Zara');
});

// MARK: - Confidence

test('a complete sentence is confident', () => {
  const result = parseAt('spent twelve fifty on coffee at Starbucks yesterday');
  assert.ok(result.confidence >= REVIEW_THRESHOLD);
});

test('a bare number is not confident', () => {
  const result = parseAt('twelve');
  assert.equal(result.amount, 1200);
  assert.ok(result.confidence < REVIEW_THRESHOLD);
});

// MARK: - Notes

test('the note drops filler and consumed phrases', () => {
  const result = parseAt('I spent 20 dollars on lunch at Chipotle yesterday');
  assert.equal(result.note, 'Lunch');
});

// MARK: - Robustness

test('empty and nonsense input do not throw', () => {
  for (const input of ['', '   ', '!!!', 'aaaaaaaa']) {
    const result = parseAt(input);
    assert.equal(result.amount, null);
    assert.equal(result.isUsable, false);
  }
});
