import test from 'node:test';
import assert from 'node:assert/strict';

import {
  insert,
  makeExpense,
  merchantsMatch,
  total,
  totalsByCategory,
  totalsByDay,
  unreviewedCount
} from '../js/ledger.js';
import { addDays, startOfDay } from '../js/dates.js';
import { fingerprint } from '../js/card-import.js';

function add(expenses, fields) {
  return insert(makeExpense(fields), expenses).expenses;
}

// MARK: - De-duplication

// Two coffees at the same price on the same day are two coffees. Only
// automatic sources get merged.
test('identical manual entries are both kept', () => {
  let rows = [];
  rows = add(rows, { amount: 475, currencyCode: 'USD', merchant: 'Blue Bottle', source: 'manual' });
  rows = add(rows, { amount: 475, currencyCode: 'USD', merchant: 'Blue Bottle', source: 'manual' });
  assert.equal(rows.length, 2);
});

test('the same external id is not imported twice', () => {
  let rows = [];
  const fields = {
    amount: 2000, currencyCode: 'USD', merchant: 'Shell',
    source: 'bankSync', externalID: 'txn_1'
  };
  rows = add(rows, fields);
  rows = add(rows, fields);
  assert.equal(rows.length, 1);
});

// The scenario this whole mechanism exists for: Apple Pay logs the coffee
// instantly, the bank reports the same coffee two days later.
test('Apple Pay and the bank feed collapse into one row', () => {
  const tapped = new Date(1770000000000);
  const settled = new Date(tapped.getTime() + 2 * 24 * 60 * 60 * 1000);

  let rows = [];
  rows = add(rows, {
    amount: 475, currencyCode: 'USD', merchant: 'Blue Bottle', date: tapped,
    category: 'coffee', source: 'cardAutomation',
    externalID: 'applepay:4.75:blue-bottle:2026-02-01'
  });
  rows = add(rows, {
    amount: 475, currencyCode: 'USD', merchant: 'SQ *BLUE BOTTLE 4471 OAKLAND CA',
    date: settled, category: 'coffee', source: 'bankSync', externalID: 'txn_bank_9'
  });

  assert.equal(rows.length, 1);
  // The bank's id must win, or a later settlement update could not find it.
  assert.equal(rows[0].externalID, 'txn_bank_9');
  assert.equal(rows[0].date.getTime(), settled.getTime());
});

test('different amounts are not merged', () => {
  const now = new Date();
  let rows = [];
  rows = add(rows, {
    amount: 475, currencyCode: 'USD', merchant: 'Blue Bottle', date: now, source: 'cardAutomation'
  });
  rows = add(rows, {
    amount: 525, currencyCode: 'USD', merchant: 'Blue Bottle', date: now,
    source: 'bankSync', externalID: 'txn_2'
  });
  assert.equal(rows.length, 2);
});

test('purchases far apart are not merged', () => {
  const now = new Date();
  let rows = [];
  rows = add(rows, {
    amount: 475, currencyCode: 'USD', merchant: 'Blue Bottle', date: now, source: 'cardAutomation'
  });
  rows = add(rows, {
    amount: 475, currencyCode: 'USD', merchant: 'Blue Bottle',
    date: addDays(now, 30), source: 'bankSync', externalID: 'txn_3'
  });
  assert.equal(rows.length, 2);
});

test('different currencies are not merged', () => {
  const now = new Date();
  let rows = [];
  rows = add(rows, {
    amount: 1000, currencyCode: 'USD', merchant: 'Cafe', date: now, source: 'cardAutomation'
  });
  rows = add(rows, {
    amount: 1000, currencyCode: 'EUR', merchant: 'Cafe', date: now,
    source: 'bankSync', externalID: 'txn_4'
  });
  assert.equal(rows.length, 2);
});

// MARK: - Merchant matching

test('merchant matching', () => {
  assert.equal(merchantsMatch('Blue Bottle', 'SQ *BLUE BOTTLE 4471 OAKLAND CA'), true);
  assert.equal(merchantsMatch('Starbucks', 'STARBUCKS STORE 1234'), true);
  // An automation that reported no merchant should still be matchable.
  assert.equal(merchantsMatch('', 'Whole Foods'), true);
  assert.equal(merchantsMatch('Whole Foods', 'Shell Gas Station'), false);
});

// MARK: - Review state

test('automatic entries arrive unreviewed', () => {
  const bank = makeExpense({ amount: 1200, currencyCode: 'USD', source: 'bankSync', externalID: 'txn_5' });
  const voice = makeExpense({ amount: 1200, currencyCode: 'USD', source: 'voice' });

  assert.equal(bank.isReviewed, false);
  assert.equal(voice.isReviewed, true);

  const rows = insert(voice, insert(bank, []).expenses).expenses;
  assert.equal(unreviewedCount(rows), 1);
});

// MARK: - Aggregation

test('totals ignore other currencies', () => {
  const rows = [
    makeExpense({ amount: 1000, currencyCode: 'USD' }),
    makeExpense({ amount: 2500, currencyCode: 'USD' }),
    makeExpense({ amount: 9900, currencyCode: 'EUR' })
  ];
  assert.equal(total(rows, 'USD'), 3500);
  assert.equal(total(rows, 'EUR'), 9900);
});

test('category totals are sorted and filtered', () => {
  const rows = [
    makeExpense({ amount: 1000, currencyCode: 'USD', category: 'coffee' }),
    makeExpense({ amount: 4000, currencyCode: 'USD', category: 'groceries' }),
    makeExpense({ amount: 500, currencyCode: 'USD', category: 'coffee' })
  ];
  const totals = totalsByCategory(rows, 'USD');

  assert.equal(totals.length, 2);
  assert.deepEqual(totals[0], { category: 'groceries', total: 4000 });
  assert.deepEqual(totals[1], { category: 'coffee', total: 1500 });
});

test('daily totals cover every day in range', () => {
  const start = startOfDay(new Date(1770000000000));
  const interval = { start, end: addDays(start, 3) };

  const rows = [
    makeExpense({ amount: 1000, currencyCode: 'USD', date: new Date(start.getTime() + 3600000) }),
    makeExpense({ amount: 500, currencyCode: 'USD', date: new Date(start.getTime() + 7200000) })
  ];

  const daily = totalsByDay(rows, interval, 'USD');

  assert.equal(daily.length, 3, 'Empty days must still appear so the chart has no gaps');
  assert.equal(daily[0].total, 1500);
  assert.equal(daily[1].total, 0);
  assert.equal(daily[2].total, 0);
});

// MARK: - Apple Pay fingerprint

test('the fingerprint is stable for the same purchase', () => {
  const date = new Date(1770000000000);
  assert.equal(
    fingerprint(475, 'Blue Bottle', date),
    fingerprint(475, 'BLUE BOTTLE', date),
    'Casing must not create a second fingerprint'
  );
});
