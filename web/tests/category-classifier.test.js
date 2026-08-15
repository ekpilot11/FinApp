import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, normalize } from '../js/category-classifier.js';

test('a brand beats a keyword', () => {
  // "bar" is a dining keyword, but the merchant is unambiguous.
  assert.equal(classify('drinks at the bar', 'Starbucks'), 'coffee');
});

test('keywords from a spoken sentence', () => {
  assert.equal(classify('grabbed lunch downtown'), 'diningOut');
  assert.equal(classify('filled up the tank with petrol'), 'fuel');
  assert.equal(classify('monthly rent'), 'bills');
  assert.equal(classify('picked up a prescription'), 'health');
});

test('the longer keyword wins', () => {
  // "gym" alone is health; "gym membership" is a subscription.
  assert.equal(classify('gym membership'), 'subscriptions');
  assert.equal(classify('day pass at the gym'), 'health');
});

test('word boundaries are respected', () => {
  // "gas" must not fire on "gasket"; "bar" must not fire on "barber".
  assert.equal(classify('replacement gasket'), 'other');
  assert.equal(classify('haircut at the barbers'), 'other');
});

// Brand names outrank every keyword, so a brand matching inside an ordinary
// word is unrecoverable. "grabbed lunch" read as the Grab ride app is the case
// that caught this.
test('brands do not match inside ordinary words', () => {
  assert.equal(classify('grabbed lunch downtown'), 'diningOut');
  assert.equal(classify('mobile phone bill'), 'bills');
  assert.equal(classify('shellfish for dinner'), 'diningOut');
  assert.equal(classify('targeted ads course'), 'education');
});

// Brands whose name is itself a whole common word have to be left out
// entirely — word boundaries cannot save these.
test('common words are not treated as brands', () => {
  assert.equal(classify('grab a coffee'), 'coffee');
  assert.equal(classify('grab lunch with Ana'), 'diningOut');
});

test('real brands still match', () => {
  assert.equal(classify('BP', 'BP'), 'fuel');
  assert.equal(classify('MOBIL 4471'), 'fuel');
  assert.equal(classify('UBER TRIP'), 'transport');
  assert.equal(classify('H&M 0231'), 'shopping');
});

// Brands listed in stem form have to survive a statement descriptor that
// writes them plural — the exact thing a hard word boundary would break.
test('stem-form brands match plural descriptors', () => {
  assert.equal(classify('MCDONALDS 1234'), 'diningOut');
  assert.equal(classify('LOWES #22'), 'home');
  assert.equal(classify('TRADER JOES'), 'groceries');
  assert.equal(classify('AMC THEATRES 8'), 'entertainment');
});

test('noisy statement descriptors', () => {
  assert.equal(classify('SQ *BLUE BOTTLE 4471 OAKLAND CA'), 'coffee');
  assert.equal(classify('UBER   *TRIP HELP.UBER.COM'), 'transport');
});

test('unknown text falls back to other', () => {
  assert.equal(classify('zzzz qqqq'), 'other');
});

test('normalize strips processor prefixes', () => {
  assert.equal(normalize('SQ *Blue Bottle'), 'blue bottle');
  assert.equal(normalize('  Café   Corner  '), 'cafe corner');
});

// MARK: - Brazil
//
// Everything below came from real card notifications. Until these landed, the
// classifier knew only English words and every one of them fell into "Other",
// which made the Spending tab a single grey donut.

test('a payment processor prefix is not part of the shop name', () => {
  // "IFD*CEVAR ALIMENTOS LT" — the IFD is iFood's marker, and it is the only
  // thing in the whole string that says the purchase was a takeaway.
  assert.equal(classify('', 'IFD*CEVAR ALIMENTOS LT'), 'diningOut');
  assert.equal(classify('', 'UBR*UBER TRIP'), 'transport');
});

test('an unknown processor prefix is dropped, not guessed at', () => {
  // Mercado Pago says who took the payment, nothing about what was bought.
  assert.equal(classify('', 'MP*LOJADOJOAO'), 'other');
  assert.equal(normalize('MP*LOJADOJOAO'), 'lojadojoao');
});

test('a known processor leaves its brand behind for the brand table', () => {
  assert.equal(normalize('IFD*CEVAR ALIMENTOS LT'), 'ifood cevar alimentos lt');
});

test('Portuguese merchant names find their category', () => {
  const cases = [
    ['POSTO IPIRANGA CENTRO', 'fuel'],
    ['DROGARIA SAO PAULO 231', 'health'],
    ['PADARIA RAO LTDA', 'groceries'],
    ['SUPERMERCADO SONDA', 'groceries'],
    ['RESTAURANTE DA ESQUINA', 'diningOut'],
    ['CAFETERIA DO CENTRO', 'coffee'],
    ['ESTACIONAMENTO CENTRAL', 'transport'],
    ['FARMACIA POPULAR', 'health'],
    ['LIVRARIA CULTURA', 'shopping'],
    ['CINEMA ITAU', 'entertainment']
  ];
  for (const [merchant, expected] of cases) {
    assert.equal(classify('', merchant), expected, merchant);
  }
});

test('Brazilian chains are known by name', () => {
  assert.equal(classify('', 'MAGAZINE LUIZA SA'), 'shopping');
  assert.equal(classify('', 'ASSAI ATACADISTA'), 'groceries');
  assert.equal(classify('', 'SMART FIT ACADEMIA'), 'health');
  assert.equal(classify('', 'DROGARIA PACHECO'), 'health');
});

test('a Portuguese sentence still classifies', () => {
  assert.equal(classify('almoço no restaurante'), 'diningOut');
  assert.equal(classify('gasolina no posto'), 'fuel');
});
