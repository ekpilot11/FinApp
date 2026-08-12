import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readNotification } from '../js/notification-parser.js';
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
