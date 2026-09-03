import test from 'node:test';
import assert from 'node:assert/strict';

import { centsFromDecimalString, decimalStringFromCents, format } from '../js/money.js';

test('reads decimal strings exactly', () => {
  assert.equal(centsFromDecimalString('0'), 0);
  assert.equal(centsFromDecimalString('4.75'), 475);
  assert.equal(centsFromDecimalString('4.7'), 470);
  assert.equal(centsFromDecimalString('4'), 400);
  assert.equal(centsFromDecimalString('1250.75'), 125075);
  assert.equal(centsFromDecimalString('.5'), 50);
});

// The reason this is string arithmetic: `4.75 * 100` is 474.99999999999994.
test('reading is exact where floating point is not', () => {
  assert.equal(centsFromDecimalString('4.75'), 475);
  assert.equal(centsFromDecimalString('0.29'), 29);
  assert.equal(centsFromDecimalString('1.005'), 101);
});

test('rejects things that are not plain numbers', () => {
  for (const input of ['', 'abc', '1,250', '$4.75', '4.75.5', '-3']) {
    assert.equal(centsFromDecimalString(input), null, `expected null for ${input}`);
  }
});

test('round-trips back to a decimal string', () => {
  assert.equal(decimalStringFromCents(475), '4.75');
  assert.equal(decimalStringFromCents(400), '4.00');
  assert.equal(decimalStringFromCents(5), '0.05');
  assert.equal(decimalStringFromCents(-3000), '-30.00');
});

test('formatting survives a nonsense currency code', () => {
  // Better a plain number than a thrown exception mid-render.
  assert.match(format(475, 'NOTACODE'), /4\.75/);
});
