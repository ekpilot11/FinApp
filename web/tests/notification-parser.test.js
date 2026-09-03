import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { looksTruncated, readNotification } from '../js/notification-parser.js';
import {
  expenseFromParams, expenseFromText, importParams, notificationText, notificationTexts
} from '../js/card-import.js';

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

describe('readNotification — Pix and transfers', () => {
  // The other half of a Brazilian account's spending, and invisible to the card
  // automation because no card is involved.
  it('logs a Pix you sent', () => {
    const result = read('Pix enviado — Você enviou um Pix de R$ 150,00 para João Silva');
    assert.equal(result.amount, 15000);
    assert.equal(result.merchant, 'João Silva');
    assert.ok(result.confidence >= 0.85);
  });

  it('reads the wordings banks actually use', () => {
    assert.equal(read('Pix realizado com sucesso no valor de R$ 50,00 para MARIA SOUZA').amount, 5000);
    assert.equal(read('Pix enviado: R$ 89,90 para PADARIA RAO').amount, 8990);
    assert.equal(read('Transferência enviada de R$ 1.000,00 para CARLOS').amount, 100000);
    assert.equal(read('Débito automático de R$ 89,90 - VIVO').amount, 8990);
  });

  it('refuses a Pix you received', () => {
    // The one that must never slip through: money arriving is not money spent,
    // and "Pix" alone is therefore not a spending word.
    for (const text of [
      'Você recebeu um Pix de R$ 200,00 de PEDRO',
      'Pix recebido: R$ 200,00 de PEDRO ALVES'
    ]) {
      const result = read(text);
      assert.equal(result.ok, false, text);
      assert.equal(result.reason, 'notAPurchase');
    }
  });

  it('treats a returned Pix as money coming back', () => {
    assert.equal(read('Pix devolvido: R$ 50,00 de MARIA SOUZA').amount, -5000);
  });

  it('opens a Pix with no recipient for review rather than filing it nameless', () => {
    const result = read('Pix enviado no valor de R$ 75,00');
    assert.equal(result.amount, 7500);
    assert.ok(result.confidence < 0.85, `confidence was ${result.confidence}`);
  });

  it('logs a boleto that was paid, refuses one that is merely due', () => {
    // "boleto" alone reads as a reminder, so a payment has to say so.
    assert.equal(read('Pagamento de boleto realizado: R$ 320,00 - ENEL').amount, 32000);
    assert.equal(read('Seu boleto de R$ 320,00 vence amanhã').ok, false);
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

  it('carries a whole backlog in one link', () => {
    // What the automation hands over after the phone has been locked all
    // afternoon: everything it could not deliver at the time.
    const texts = [
      'Compra de R$ 33,50 APROVADA em Montana Viracopos Camp, às 21:02',
      'Compra de R$ 10,80 APROVADA em Deltaexpresso, às 07:48',
      'Compra de R$ 87,20 APROVADA em SUPERMERCADO PAGUE MENOS, às 10:15'
    ];
    const url = `${site}?add=1${texts.map((t) => `&text=${encodeURIComponent(t)}`).join('')}`;
    const params = importParams(url);

    const all = notificationTexts(params);
    assert.equal(all.length, 3);

    const amounts = all.map((text) =>
      expenseFromText(text, params, { defaultCurrency: 'BRL', now: new Date() }).amount);
    assert.deepEqual(amounts, [3350, 1080, 8720]);
  });

  it('reads each queued notification by the same path as a lone one', () => {
    const text = 'Compra de R$ 33,50 APROVADA em Montana Viracopos Camp, às 21:02';
    const context = { defaultCurrency: 'BRL', now: new Date(2026, 7, 15, 22, 0) };

    const alone = expenseFromParams(
      importParams(`${site}?add=1&text=${encodeURIComponent(text)}`), context);
    const queued = expenseFromText(text,
      importParams(`${site}?add=1&text=a&text=${encodeURIComponent(text)}`), context);

    assert.equal(alone.amount, queued.amount);
    assert.equal(alone.merchant, queued.merchant);
    assert.deepEqual(alone.date, queued.date);
    // Same fingerprint, so a purchase delivered twice is still one row.
    assert.equal(alone.externalID, queued.externalID);
  });

  it('keeps a single notification on the single-purchase path', () => {
    const params = importParams(`${site}?add=1&text=${encodeURIComponent('Compra R$ 5,00 em X')}`);
    assert.equal(notificationTexts(params).length, 1);
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
