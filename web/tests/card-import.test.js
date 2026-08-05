import test from 'node:test';
import assert from 'node:assert/strict';

import { expenseFromParams, importParams } from '../js/card-import.js';

const BASE = 'https://example.github.io/FinApp/';
const CONTEXT = { defaultCurrency: 'USD', now: new Date(2026, 7, 4, 10) };

function fields(query) {
  const params = importParams(BASE + query);
  assert.ok(params, `no import params found in ${query}`);
  return expenseFromParams(params, CONTEXT);
}

test('reads a query-string import', () => {
  const expense = fields('?add=1&amount=4.75&merchant=Blue%20Bottle');
  assert.equal(expense.amount, 475);
  assert.equal(expense.merchant, 'Blue Bottle');
  assert.equal(expense.category, 'coffee');
  assert.equal(expense.source, 'cardAutomation');
});

// Both forms are accepted because Shortcuts users copy whichever example they
// find first, and a purchase silently dropped over `#` vs `?` is the kind of
// bug nobody reports.
test('reads a hash import', () => {
  const expense = fields('#import?amount=12.30&merchant=Shell');
  assert.equal(expense.amount, 1230);
  assert.equal(expense.category, 'fuel');
});

test('ignores a URL with no amount', () => {
  assert.equal(importParams(BASE), null);
  assert.equal(importParams(`${BASE}#/history`), null);
});

test('copes with a formatted amount', () => {
  // Shortcuts hands over whatever the card formatted.
  assert.equal(fields('?amount=R%24%204%2C75&merchant=Padaria').amount, 475);
  assert.equal(fields('?amount=%241%2C250.75').amount, 125075);
});

test('a negative amount is a refund', () => {
  assert.equal(fields('?amount=-30.00&merchant=Zara').amount, -3000);
});

test('an explicit currency and id win', () => {
  const expense = fields('?amount=30&currency=eur&id=txn_9&merchant=Lidl');
  assert.equal(expense.currencyCode, 'EUR');
  assert.equal(expense.externalID, 'txn_9');
  assert.equal(expense.category, 'groceries');
});

test('a fingerprint stands in when no id is supplied', () => {
  const expense = fields('?amount=4.75&merchant=Blue%20Bottle&date=2026-02-01T09:00:00Z');
  assert.match(expense.externalID, /^applepay:4\.75:blue-bottle:\d{4}-\d{2}-\d{2}$/);
});

test('an unusable amount is rejected rather than logged as zero', () => {
  const params = importParams(`${BASE}?amount=abc`);
  assert.ok(params);
  assert.equal(expenseFromParams(params, CONTEXT), null);
});
