import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { looksTruncated, readNotification } from '../js/notification-parser.js';
import { expenseFromParams, importParams, notificationText } from '../js/card-import.js';

const read = (text, currency = 'BRL') => readNotification(text, { defaultCurrency: currency });

describe('readNotification — Portuguese purchases', () => {
  it('reads the common shape', () => {
    const result = read('Compra aprovada: R$ 12,90 em PADARIA RAO');
    assert.equal(result.ok, true);
    assert.equal(result.amount, 1290);
    assert.equal(result.currencyCode, 'BRL');
    assert.equal(result.merchant, 'PADARIA RAO');
    assert.equal(result.isRefund, false);
  });

  it('reads thousands without turning them into cents', () => {
    const result = read('Compra aprovada no crédito de R$ 1.234,56 em MAGAZINE LUIZA');
    assert.equal(result.amount, 123456);
    assert.equal(result.merchant, 'MAGAZINE LUIZA');
  });

  it('reads the amount-first wording', () => {
    const result = read('Você fez uma compra de R$ 45,00 no Uber');
    assert.equal(result.amount, 4500);
    assert.equal(result.merchant, 'Uber');
  });

  it('keeps accents in the shop name', () => {
    const result = read('Compra aprovada: R$ 30,00 em CAFÉ SÃO PAULO');
    assert.equal(result.merchant, 'CAFÉ SÃO PAULO');
  });

  it('treats an estorno as money coming back', () => {
    const result = read('Estorno de R$ 30,00 - RENNER');
    assert.equal(result.isRefund, true);
    assert.equal(result.amount, -3000);
  });

  it('reads a cancelled purchase as a refund too', () => {
    assert.equal(read('Compra cancelada: R$ 15,00 em SUBWAY').amount, -1500);
  });
});

// Copied character for character off the lock screen, accents, caps, sign-off
// and all. Every other case in this file is a guess; this one is evidence.
const REAL = {
  title: 'Compra no crédito aprovada',
  body: 'Compra de R$ 33,50 APROVADA em Montana Viracopos Camp, às 21:02 no cartão'
    + ' Master Black final 1114. Dúvidas, entre em contato com a gente'
};

describe('readNotification — a real notification from the bank', () => {
  const fromBody = read(REAL.body);
  const fromBoth = read(`${REAL.title} — ${REAL.body}`);

  it('reads the amount past the card number in the same sentence', () => {
    assert.equal(fromBody.amount, 3350);
    assert.equal(fromBoth.amount, 3350);
  });

  it('finds the shop name even with a word between it and the amount', () => {
    // "R$ 33,50 APROVADA em Montana…" — the lead-in is not adjacent.
    assert.equal(fromBody.merchant, 'Montana Viracopos Camp');
  });

  it('stops the name at the time, not at the sign-off', () => {
    assert.equal(fromBoth.merchant, 'Montana Viracopos Camp');
    // "entre em contato com a gente" also contains "em".
    assert.ok(!fromBody.merchant.includes('contato'));
  });

  it('keeps the time the bank quoted', () => {
    assert.deepEqual(fromBody.time, { hours: 21, minutes: 2 });
  });

  it('is sure enough to file without asking', () => {
    assert.ok(fromBody.confidence >= 0.85, `confidence was ${fromBody.confidence}`);
  });

  it('works the same whether you map Body alone or Title and Body', () => {
    assert.equal(fromBody.amount, fromBoth.amount);
    assert.equal(fromBody.merchant, fromBoth.merchant);
  });

  it('files it at the quoted time rather than whenever FinApp opened', () => {
    const now = new Date(2026, 7, 12, 23, 40);
    const fields = expenseFromParams(
      importParams(`https://finapp.example/?add=1&text=${encodeURIComponent(REAL.body)}`),
      { defaultCurrency: 'BRL', now }
    );
    assert.equal(fields.date.getHours(), 21);
    assert.equal(fields.date.getMinutes(), 2);
    assert.equal(fields.date.getDate(), 12);
  });

  it('puts a late-night purchase on the day it happened', () => {
    // Bought at 23:50, notification read at 00:05. Naively that lands the
    // purchase a day early — and in the wrong month twelve times a year.
    const text = REAL.body.replace('às 21:02', 'às 23:50');
    const now = new Date(2026, 7, 13, 0, 5);
    const fields = expenseFromParams(
      importParams(`https://finapp.example/?add=1&text=${encodeURIComponent(text)}`),
      { defaultCurrency: 'BRL', now }
    );
    assert.equal(fields.date.getDate(), 12);
    assert.equal(fields.date.getHours(), 23);
  });
});

describe('readNotification — a wider notification filter', () => {
  // The Shortcuts filter should be "Compra", not "Compra no crédito aprovada":
  // the narrow one silently drops every debit purchase, and silently dropping
  // purchases is the failure you cannot notice. Widening it means more kinds
  // of message reach the parser, so these are the ones that now arrive.
  it('reads a debit purchase the same as a credit one', () => {
    const result = read('Compra no débito aprovada — Compra de R$ 87,20 APROVADA em'
      + ' SUPERMERCADO PAGUE MENOS, às 10:15 no cartão final 1114');
    assert.equal(result.amount, 8720);
    assert.equal(result.merchant, 'SUPERMERCADO PAGUE MENOS');
  });

  it('refuses an advert that says "compra" and carries an amount', () => {
    // The one that got through: every purchase test passes on this text.
    const result = read('Compras parceladas — Aproveite compras de até R$ 500,00'
      + ' sem juros. Oferta válida hoje');
    assert.equal(result.ok, false, 'an advert must not become a R$ 500 purchase');
    assert.equal(result.reason, 'notAPurchase');
  });

  it('refuses a login code even when it mentions a purchase', () => {
    const result = read('Seu código para autorizar a compra é 448210');
    assert.equal(result.ok, false);
  });

  it('still logs a purchase that mentions the invoice or the limit', () => {
    // These legitimately appear in real alerts, so they must not refuse.
    assert.equal(read('Compra aprovada R$ 12,90 em PADARIA. Fatura atual R$ 800,00').amount, 1290);
    assert.equal(read('Compra aprovada R$ 12,90 em PADARIA. Limite disponível R$ 4.812,00').amount, 1290);
  });
});

describe('looksTruncated', () => {
  // Seen on the first real run: the panel reported It said: "Compra". Shortcuts
  // had pasted the Body into the address unencoded, and the address ended at
  // the first space.
  it('recognises the first word of a real alert', () => {
    assert.equal(looksTruncated('Compra'), true);
  });

  it('does not accuse a whole message', () => {
    assert.equal(looksTruncated(REAL.body), false);
    assert.equal(looksTruncated('Compra aprovada'), false);
  });

  it('does not accuse something carrying a number', () => {
    // If digits arrived, the address survived the spaces.
    assert.equal(looksTruncated('R$10,80'), false);
  });

  it('says nothing about an empty request', () => {
    assert.equal(looksTruncated(''), false);
    assert.equal(looksTruncated(undefined), false);
  });

  it('is what a truncated body actually produces end to end', () => {
    const params = importParams('https://finapp.example/?add=1&text=Compra');
    const fields = expenseFromParams(params, { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(fields.rejected, true);
    assert.equal(fields.reason, 'noAmount');
    assert.equal(looksTruncated(fields.text), true);
  });
});

describe('readNotification — declines', () => {
  it('refuses a declined purchase, which reads as approved on every other test', () => {
    const text = REAL.body.replace('APROVADA', 'NÃO APROVADA');
    const result = read(text);
    assert.equal(result.ok, false, 'a declined purchase must not be logged');
    assert.equal(result.reason, 'declined');
  });

  for (const wording of ['Compra negada', 'Compra recusada', 'Compra não autorizada']) {
    it(`refuses “${wording}”`, () => {
      assert.equal(read(`${wording}: R$ 33,50 em Montana Viracopos Camp`).reason, 'declined');
    });
  }

  it('still logs the approval that follows a decline', () => {
    assert.equal(read('Compra de R$ 33,50 APROVADA em Montana Viracopos Camp').amount, 3350);
  });
});

describe('readNotification — the numbers that are not money', () => {
  it('ignores the card number', () => {
    // The trap: "final 1234" is the most common number in these messages.
    const result = read('Compra aprovada no cartão final 1234: R$ 12,90 em PADARIA RAO');
    assert.equal(result.amount, 1290);
  });

  it('refuses a message with no currency marker at all', () => {
    const result = read('Compra aprovada no cartão final 1234');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'noAmount');
  });

  it('takes the purchase, not the limit left over', () => {
    const result = read('Compra aprovada de R$ 12,90 em PADARIA. Limite disponível: R$ 4.812,00');
    assert.equal(result.amount, 1290);
  });

  it('skips a leading balance to find the purchase', () => {
    const result = read('Saldo disponível R$ 4.812,00 — compra aprovada de R$ 12,90 em PADARIA');
    assert.equal(result.amount, 1290);
  });
});

describe('readNotification — things that are not purchases', () => {
  const refused = [
    'Seu saldo é de R$ 4.812,00',
    'Sua fatura fechada é de R$ 1.203,40. Vencimento em 10/09',
    'Você recebeu um Pix de R$ 250,00 de MARIA',
    'Seu código de acesso é 448210',
    'Aproveite nossa promoção de seguro por R$ 19,90 por mês'
  ];

  for (const text of refused) {
    it(`refuses “${text.slice(0, 38)}…”`, () => {
      const result = read(text);
      assert.equal(result.ok, false, 'should not have been logged as spending');
      assert.equal(result.reason, 'notAPurchase');
    });
  }

  it('still reads a purchase that happens to mention the invoice', () => {
    const result = read('Compra aprovada: R$ 12,90 em PADARIA. Fatura atual R$ 800,00');
    assert.equal(result.ok, true);
    assert.equal(result.amount, 1290);
  });
});

describe('readNotification — English', () => {
  it('reads a purchase alert', () => {
    const result = read('Purchase approved: $45.99 at AMAZON', 'USD');
    assert.equal(result.amount, 4599);
    assert.equal(result.merchant, 'AMAZON');
    assert.equal(result.currencyCode, 'USD');
  });

  it('reads "card was used"', () => {
    const result = read('Your card ending 4821 was used for $12.50 at STARBUCKS', 'USD');
    assert.equal(result.amount, 1250);
    assert.equal(result.merchant, 'STARBUCKS');
  });

  it('reads a refund', () => {
    assert.equal(read('Refund of $30.00 at ZARA', 'USD').amount, -3000);
  });
});

describe('readNotification — currency', () => {
  it('believes the symbol over your default', () => {
    assert.equal(read('Compra aprovada US$ 20,00 em STEAM', 'BRL').currencyCode, 'USD');
    assert.equal(read('Compra aprovada € 20,00 em RYANAIR', 'BRL').currencyCode, 'EUR');
  });

  it('falls back to your currency for a bare dollar sign', () => {
    // "$" alone is ambiguous across a dozen countries.
    assert.equal(read('Purchase approved $20.00 at STEAM', 'BRL').currencyCode, 'BRL');
  });

  it('reads the currency written as a word', () => {
    assert.equal(read('Compra aprovada de 25 reais em BAR DO ZE', 'USD').currencyCode, 'BRL');
  });
});

describe('readNotification — merchant tidying', () => {
  const merchantOf = (text) => read(text).merchant;

  it('drops the instalment tail', () => {
    assert.equal(merchantOf('Compra aprovada R$ 300,00 em CASAS BAHIA - parcela 1/3'), 'CASAS BAHIA');
  });

  it('drops the company suffix', () => {
    assert.equal(merchantOf('Compra aprovada R$ 12,90 em PADARIA RAO LTDA'), 'PADARIA RAO');
  });

  it('drops a trailing card reference', () => {
    assert.equal(merchantOf('Compra aprovada R$ 12,90 em PADARIA RAO cartão final 1234'), 'PADARIA RAO');
  });

  it('refuses a whole sentence as a shop name', () => {
    const long = 'Compra aprovada R$ 12,90 em uma loja que tem um nome muito longo e improvável';
    assert.equal(merchantOf(long), '');
  });

  it('leaves the merchant empty rather than guessing', () => {
    const result = read('Compra aprovada: R$ 12,90');
    assert.equal(result.ok, true);
    assert.equal(result.merchant, '');
    // Confident enough to be real, not confident enough to file unseen.
    assert.ok(result.confidence < 0.85, `confidence was ${result.confidence}`);
  });

  it('is confident when both halves arrived', () => {
    assert.ok(read('Compra aprovada: R$ 12,90 em PADARIA RAO').confidence >= 0.85);
  });
});

describe('the URL bridge', () => {
  const site = 'https://finapp.example/';

  it('accepts the notification as one blob of text', () => {
    const params = importParams(`${site}?add=1&text=${encodeURIComponent('Compra aprovada: R$ 12,90 em PADARIA RAO')}`);
    const fields = expenseFromParams(params, { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(fields.amount, 1290);
    assert.equal(fields.merchant, 'PADARIA RAO');
    assert.equal(fields.source, 'cardAutomation');
  });

  it('accepts title, subtitle and body as three pieces', () => {
    const params = importParams(`${site}?add=1&title=Nubank&subtitle=Compra%20aprovada&body=${encodeURIComponent('R$ 12,90 em PADARIA RAO')}`);
    assert.equal(notificationText(params), 'Nubank — Compra aprovada — R$ 12,90 em PADARIA RAO');
    const fields = expenseFromParams(params, { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(fields.amount, 1290);
    assert.equal(fields.merchant, 'PADARIA RAO');
  });

  it('survives an unencoded & in the notification', () => {
    // Shortcuts drops the body in raw; "Bar & Grill" would otherwise cut the
    // merchant off at the ampersand.
    const params = importParams(`${site}?add=1&text=Compra aprovada R$ 12,90 em BAR & GRILL`);
    const fields = expenseFromParams(params, { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(fields.merchant, 'BAR & GRILL');
  });

  it('still stops at a parameter it knows', () => {
    const params = importParams(`${site}?add=1&text=Compra R$ 12,90 em PADARIA&id=abc123`);
    assert.equal(params.get('id'), 'abc123');
    assert.equal(params.get('text'), 'Compra R$ 12,90 em PADARIA');
  });

  it('tells an empty notification apart from an Apple Pay link', () => {
    // Tapping play in Shortcuts runs the automation with no notification, so
    // Body is empty. That is a working automation, not a broken one.
    const empty = expenseFromParams(importParams(`${site}?add=1&text=`),
      { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(empty.rejected, true);
    assert.equal(empty.reason, 'empty');

    // Whereas an Apple Pay link with no amount is the old, different story.
    const applePay = expenseFromParams(importParams(`${site}?add=1&amount=&merchant=`),
      { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(applePay, null);
  });

  it('reports a non-purchase rather than logging one', () => {
    const params = importParams(`${site}?add=1&text=${encodeURIComponent('Seu saldo é de R$ 4.812,00')}`);
    const fields = expenseFromParams(params, { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(fields.rejected, true);
    assert.equal(fields.reason, 'notAPurchase');
  });

  it('keeps what the bank said, as the note', () => {
    const text = 'Compra aprovada: R$ 12,90 em PADARIA RAO';
    const params = importParams(`${site}?add=1&text=${encodeURIComponent(text)}`);
    const fields = expenseFromParams(params, { defaultCurrency: 'BRL', now: new Date() });
    assert.equal(fields.note, text);
  });

  it('gives both automations the same id, so one purchase is not counted twice', () => {
    const now = new Date(2026, 7, 12, 10, 0);
    const fromWallet = expenseFromParams(
      importParams(`${site}?add=1&amount=12.90&merchant=PADARIA%20RAO`),
      { defaultCurrency: 'BRL', now }
    );
    const fromNotification = expenseFromParams(
      importParams(`${site}?add=1&text=${encodeURIComponent('Compra aprovada: R$ 12,90 em PADARIA RAO')}`),
      { defaultCurrency: 'BRL', now }
    );
    assert.equal(fromWallet.externalID, fromNotification.externalID);
  });

  it('leaves the old Apple Pay link working exactly as before', () => {
    const params = importParams(`${site}?add=1&amount=4.75&merchant=Blue%20Bottle`);
    const fields = expenseFromParams(params, { defaultCurrency: 'USD', now: new Date() });
    assert.equal(fields.amount, 475);
    assert.equal(fields.merchant, 'Blue Bottle');
    assert.equal(fields.confidence, undefined);
  });
});
