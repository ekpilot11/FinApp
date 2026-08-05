import test from 'node:test';
import assert from 'node:assert/strict';

import * as SpelledNumber from '../js/spelled-number.js';

function runs(sentence) {
  return SpelledNumber.runs(sentence.split(' ')).map((run) => run.value);
}

test('composes tens and ones', () => {
  assert.deepEqual(runs('twenty five'), [25]);
  assert.deepEqual(runs('ninety nine'), [99]);
});

test('composes hundreds and thousands', () => {
  assert.deepEqual(runs('one hundred twenty five'), [125]);
  assert.deepEqual(runs('one hundred and twenty five'), [125]);
  assert.deepEqual(runs('two thousand five hundred'), [2500]);
  assert.deepEqual(runs('hundred'), [100]);
});

// The case that makes or breaks spoken money: "twelve fifty" is two numbers,
// and merging them into 1250 would be catastrophic.
test('adjacent numbers stay separate', () => {
  assert.deepEqual(runs('twelve fifty'), [12, 50]);
  assert.deepEqual(runs('five fifty'), [5, 50]);
  assert.deepEqual(runs('nineteen ninety nine'), [19, 99]);
});

test('ignores surrounding words', () => {
  assert.deepEqual(runs('i spent twenty on lunch'), [20]);
  assert.deepEqual(runs('no numbers at all here'), []);
});

test('a trailing "and" is not swallowed', () => {
  // "twenty and" — the "and" joins clauses, not digits.
  assert.deepEqual(runs('twenty and coffee'), [20]);
});

test('value of a whole phrase', () => {
  assert.equal(SpelledNumber.valueOf('twenty five'), 25);
  assert.equal(SpelledNumber.valueOf('three'), 3);
  // Two numbers is not one value.
  assert.equal(SpelledNumber.valueOf('twelve fifty'), null);
  assert.equal(SpelledNumber.valueOf('coffee'), null);
});
