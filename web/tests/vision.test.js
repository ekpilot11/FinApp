import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeExpense } from '../js/ledger.js';
import {
  MODEL, SCHEMA, looksAlreadyLogged, messageForError, purchasesFromMessage, requestBody
} from '../js/vision.js';

/** A response shaped the way the API returns one. */
function reply(purchases, extra = {}) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ purchases }) }],
    ...extra
  };
}

const NOW = new Date(2026, 7, 11, 18, 30);

describe('requestBody', () => {
  const body = requestBody(
    { base64: 'AAAA', mediaType: 'image/jpeg' },
    { currencyCode: 'BRL', now: NOW }
  );

  it('asks the most capable model', () => {
    assert.equal(body.model, MODEL);
    assert.equal(MODEL, 'claude-opus-5');
  });

  it('puts the image before the question', () => {
    const [first, second] = body.messages[0].content;
    assert.equal(first.type, 'image');
    assert.equal(first.source.type, 'base64');
    assert.equal(first.source.media_type, 'image/jpeg');
    assert.equal(first.source.data, 'AAAA');
    assert.equal(second.type, 'text');
  });

  it('tells the model what day it is, so "today" resolves', () => {
    const { text } = body.messages[0].content[1];
    assert.match(text, /2026-08-11/);
    assert.match(text, /Tuesday/);
    assert.match(text, /BRL/);
  });

  it('constrains the reply to the schema', () => {
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.output_config.format.schema, SCHEMA);
  });

  it('sends no parameter Opus 5 rejects', () => {
    // budget_tokens, temperature, top_p and top_k are all 400s on this model.
    for (const key of ['budget_tokens', 'temperature', 'top_p', 'top_k']) {
      assert.equal(key in body, false, `${key} must not be sent`);
    }
    assert.equal('budget_tokens' in (body.thinking ?? {}), false);
  });
});

describe('SCHEMA', () => {
  const item = SCHEMA.properties.purchases.items;

  it('closes every object, which structured outputs require', () => {
    assert.equal(SCHEMA.additionalProperties, false);
    assert.equal(item.additionalProperties, false);
  });

  it('requires every property it declares', () => {
    assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
  });

  it('uses no keyword the API rejects', () => {
    const banned = ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'];
    const seen = JSON.stringify(SCHEMA);
    for (const keyword of banned) {
      assert.equal(seen.includes(`"${keyword}"`), false, `${keyword} is not supported`);
    }
  });

  it('keeps the amount a string, so no float ever touches it', () => {
    assert.equal(item.properties.amount.type, 'string');
  });
});

describe('purchasesFromMessage', () => {
  const read = (purchases) => purchasesFromMessage(reply(purchases), {
    currencyCode: 'BRL', now: NOW
  });

  it('reads a whole screenshot of stacked notifications', () => {
    const { drafts } = read([
      { amount: '12,90', currency: 'BRL', merchant: 'Padaria Rao', at: '2026-08-11T08:14', isRefund: false, category: 'coffee', note: '' },
      { amount: '89,00', currency: 'BRL', merchant: 'Drogasil', at: '2026-08-11T12:02', isRefund: false, category: 'health', note: '' },
      { amount: '1.234,56', currency: 'BRL', merchant: 'Magalu', at: '2026-08-11T19:40', isRefund: false, category: 'shopping', note: 'parcela 2 de 6' }
    ]);

    assert.equal(drafts.length, 3);
    assert.deepEqual(drafts.map((row) => row.amount), [1290, 8900, 123456]);
    assert.equal(drafts[2].note, 'parcela 2 de 6');
  });

  it('reads a US-style amount the same way', () => {
    const { drafts } = read([
      { amount: '1,234.56', currency: 'USD', merchant: 'Costco', at: '2026-08-11T10:00', isRefund: false, category: 'groceries', note: '' }
    ]);
    assert.equal(drafts[0].amount, 123456);
    assert.equal(drafts[0].currencyCode, 'USD');
  });

  it('keeps refunds as refunds without making the amount negative twice', () => {
    const { drafts } = read([
      { amount: '45,00', currency: 'BRL', merchant: 'Renner', at: '2026-08-10T15:00', isRefund: true, category: 'shopping', note: 'estorno' }
    ]);
    assert.equal(drafts[0].amount, 4500);
    assert.equal(drafts[0].isRefund, true);
  });

  it('builds the date in local time, not UTC', () => {
    const { drafts } = read([
      { amount: '10,00', currency: 'BRL', merchant: 'X', at: '2026-08-09T00:30', isRefund: false, category: 'other', note: '' }
    ]);
    assert.equal(drafts[0].date.getFullYear(), 2026);
    assert.equal(drafts[0].date.getMonth(), 7);
    assert.equal(drafts[0].date.getDate(), 9);
    assert.equal(drafts[0].date.getHours(), 0);
  });

  it('defaults a date-only value to midday rather than midnight', () => {
    const { drafts } = read([
      { amount: '10,00', currency: 'BRL', merchant: 'X', at: '2026-08-09', isRefund: false, category: 'other', note: '' }
    ]);
    assert.equal(drafts[0].date.getHours(), 12);
  });

  it('refuses a date in the future', () => {
    // A misread year would file the purchase under a month you never look at.
    const { drafts } = read([
      { amount: '10,00', currency: 'BRL', merchant: 'X', at: '2027-01-05T09:00', isRefund: false, category: 'other', note: '' }
    ]);
    assert.deepEqual(drafts[0].date, NOW);
  });

  it('keeps a time later today, because the clock is not the calendar', () => {
    const { drafts } = read([
      { amount: '10,00', currency: 'BRL', merchant: 'X', at: '2026-08-11T23:50', isRefund: false, category: 'other', note: '' }
    ]);
    assert.equal(drafts[0].date.getDate(), 11);
    assert.equal(drafts[0].date.getHours(), 23);
  });

  it('drops a row whose amount it could not read, and counts it', () => {
    const { drafts, skipped } = read([
      { amount: '', currency: 'BRL', merchant: 'Cut off', at: '2026-08-11T08:00', isRefund: false, category: 'other', note: '' },
      { amount: '0,00', currency: 'BRL', merchant: 'Zero', at: '2026-08-11T08:00', isRefund: false, category: 'other', note: '' },
      { amount: '7,50', currency: 'BRL', merchant: 'Good', at: '2026-08-11T08:00', isRefund: false, category: 'coffee', note: '' }
    ]);
    assert.equal(drafts.length, 1);
    assert.equal(skipped, 2);
  });

  it('falls back to your currency rather than inventing a code', () => {
    const { drafts } = read([
      { amount: '5,00', currency: '', merchant: 'X', at: '2026-08-11T08:00', isRefund: false, category: 'other', note: '' },
      { amount: '5,00', currency: 'reais', merchant: 'Y', at: '2026-08-11T08:00', isRefund: false, category: 'other', note: '' }
    ]);
    assert.deepEqual(drafts.map((row) => row.currencyCode), ['BRL', 'BRL']);
  });

  it('falls back to "other" for a category that is not one of ours', () => {
    const { drafts } = read([
      { amount: '5,00', currency: 'BRL', merchant: 'X', at: '2026-08-11T08:00', isRefund: false, category: 'petcare', note: '' }
    ]);
    assert.equal(drafts[0].category, 'other');
  });

  it('accepts an empty screenshot without complaining', () => {
    assert.deepEqual(read([]), { drafts: [], skipped: 0 });
  });

  it('finds the text block past a thinking block', () => {
    // Opus 5 thinks by default, so the JSON is never content[0].
    const message = {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'four banners, one is cut off…' },
        { type: 'text', text: JSON.stringify({ purchases: [] }) }
      ]
    };
    assert.deepEqual(purchasesFromMessage(message, { now: NOW }), { drafts: [], skipped: 0 });
  });

  it('reports a refusal instead of reading past it', () => {
    assert.throws(
      () => purchasesFromMessage({ stop_reason: 'refusal', content: [] }, { now: NOW }),
      /declined/
    );
  });

  it('reports a reply that is not JSON', () => {
    assert.throws(
      () => purchasesFromMessage({ content: [{ type: 'text', text: 'sorry!' }] }, { now: NOW }),
      /not the expected JSON/
    );
  });
});

describe('looksAlreadyLogged', () => {
  const existing = makeExpense({
    amount: 1290,
    currencyCode: 'BRL',
    merchant: 'Padaria Rao',
    date: new Date(2026, 7, 11, 8, 14),
    category: 'coffee'
  });

  const draft = (fields) => ({
    amount: 1290, isRefund: false, currencyCode: 'BRL',
    merchant: 'Padaria Rao', date: new Date(2026, 7, 11, 9, 0), ...fields
  });

  it('spots the same purchase re-read from a later screenshot', () => {
    assert.equal(looksAlreadyLogged(draft(), [existing]), existing);
  });

  it('ignores a different day', () => {
    assert.equal(looksAlreadyLogged(draft({ date: new Date(2026, 7, 10, 9, 0) }), [existing]), null);
  });

  it('ignores a different amount', () => {
    assert.equal(looksAlreadyLogged(draft({ amount: 1490 }), [existing]), null);
  });

  it('ignores a different currency', () => {
    assert.equal(looksAlreadyLogged(draft({ currencyCode: 'USD' }), [existing]), null);
  });

  it('does not confuse a refund with the purchase it reverses', () => {
    assert.equal(looksAlreadyLogged(draft({ isRefund: true }), [existing]), null);
  });

  it('sees through statement noise in the name', () => {
    assert.equal(looksAlreadyLogged(draft({ merchant: 'PADARIA RAO LTDA SAO PAULO' }), [existing]), existing);
  });
});

describe('messageForError', () => {
  it('says which key is wrong rather than showing a status code', () => {
    assert.match(messageForError(401, null), /API key/);
    assert.match(messageForError(401, null), /Settings/);
  });

  it('passes on what the API objected to', () => {
    assert.match(
      messageForError(400, { error: { message: 'image exceeds 8000 pixels' } }),
      /8000 pixels/
    );
  });

  it('tells you to wait rather than to retry now', () => {
    assert.match(messageForError(429, null), /Wait a minute/);
    assert.match(messageForError(529, null), /busy/);
    assert.match(messageForError(503, null), /busy/);
  });
});
