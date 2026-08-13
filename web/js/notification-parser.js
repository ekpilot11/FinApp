// Reading a bank's own notification.
//
// For most of this project's life the answer to "can FinApp see the purchase
// notification my bank just sent?" was flatly no: iOS exposed no way for
// anything to read another app's notifications. iOS 27 changed it. Shortcuts
// gained a **When I receive a notification from** trigger that hands the
// notification's Title, Subtitle and Body to the automation as Shortcut Input,
// and those can be pushed straight into a URL.
//
// Which means the text below is the thing FinApp could never get at before:
// the real amount and the real merchant, from the bank itself, at the moment
// of purchase. Apple Wallet's Transaction trigger never carried them for
// anything but Apple Card and Apple Cash.
//
// This parser is deliberately not the sentence parser. A dictated sentence is
// a person talking; a notification is a template with a card number in it, and
// the two fail in opposite directions. The rules here are built around that:
//
//   - An amount must carry a currency marker. "final 1234" and "cartão 5678"
//     are the most common numbers in these messages and neither is money.
//   - An amount sitting behind "limite" or "saldo" is what you have left, not
//     what you spent.
//   - A notification that is not about a purchase at all — a balance, a bill
//     due, a login code — must be refused rather than filed as spending.
//
// Portuguese first, because that is what the bank in question sends, and
// English alongside it.

import { classify } from './category-classifier.js';
import { centsFromDigits } from './expense-parser.js';
import { fold } from './text.js';

/** Money, with something naming the currency attached. */
const SYMBOL_FIRST = /(R\$|US\$|USD|BRL|EUR|GBP|\$|€|£)\s*(\d[\d.,]*)/gi;
const WORD_LAST = /(\d[\d.,]*)\s*(reais|real|dolares|dollars|euros|libras|pounds)\b/gi;

const SYMBOL_CURRENCIES = {
  'r$': 'BRL', brl: 'BRL', 'us$': 'USD', usd: 'USD',
  $: null, eur: 'EUR', '€': 'EUR', gbp: 'GBP', '£': 'GBP'
};

const WORD_CURRENCIES = {
  reais: 'BRL', real: 'BRL', dolares: 'USD', dollars: 'USD',
  euros: 'EUR', libras: 'GBP', pounds: 'GBP'
};

/** What the number means when one of these sits just before it. */
const NOT_THE_PURCHASE = [
  'limite', 'saldo', 'disponivel', 'disponivel de', 'total da fatura', 'fatura de',
  'minimo', 'restante', 'available', 'balance', 'limit', 'remaining', 'statement'
];

/** Signs this is money going out. */
const PURCHASE_WORDS = [
  'compra', 'aprovad', 'transacao', 'debito', 'credito', 'gasto', 'gastou',
  'pagamento aprovado', 'voce fez', 'foi utilizado', 'utilizado em',
  'purchase', 'transaction', 'approved', 'charged', 'spent', 'was used', 'payment of'
];

/**
 * Signs no money moved at all.
 *
 * Checked before everything else, because these read as purchases on every
 * other test: "Compra de R$ 33,50 NÃO APROVADA" contains both "compra" and
 * "aprovada". A declined purchase filed as spending is money you never spent.
 */
const DECLINED_WORDS = [
  'nao aprovada', 'nao aprovado', 'negada', 'negado', 'recusada', 'recusado',
  'nao autorizada', 'nao autorizado', 'nao foi aprovada', 'sem saldo',
  'declined', 'denied', 'not approved', 'was not authorized', 'unauthorized attempt'
];

/** Signs this is money coming back. */
const REFUND_WORDS = [
  'estorno', 'estornad', 'cancelad', 'reembols', 'devolv', 'extorno',
  'refund', 'reversal', 'reversed', 'credited back', 'chargeback'
];

/**
 * Never a purchase, whatever else the message happens to say.
 *
 * Separate from the list below because of one real message: "Compras
 * parceladas — aproveite compras de até R$ 500,00 sem juros" says *compra* and
 * carries an amount, so every purchase test passes and an advert lands in your
 * spending as R$ 500. Nothing in this list ever appears in a genuine
 * transaction alert, so it wins outright.
 */
const NEVER_A_PURCHASE = [
  'codigo', 'senha', 'login', 'acesso', 'promocao', 'promocional', 'oferta',
  'aproveite', 'convite', 'sem juros', 'parceladas',
  'verification code', 'sign in', 'promotion', 'special offer', 'invite'
];

/**
 * Not a purchase unless the message also says it is.
 *
 * These *do* legitimately turn up in real alerts — "compra aprovada … fatura
 * atual R$ 800,00" — so they only refuse when nothing else says spending.
 *
 * The iOS 27 trigger can filter on the notification text, so ideally none of
 * this reaches us. But a filter is one typo from letting everything through,
 * and a balance alert filed as a R$ 4.812,00 purchase is exactly the kind of
 * wrong number that hides in a monthly total.
 */
const NOT_A_PURCHASE_WORDS = [
  'saldo', 'limite disponivel', 'fatura fechada', 'fatura disponivel', 'vencimento',
  'vence em', 'boleto', 'pagamento recebido', 'pix recebido', 'voce recebeu',
  'transferencia recebida', 'deposito', 'rendimento', 'atualiz', 'entrega', 'seguro',
  'desconto', 'cashback',
  'balance', 'statement is', 'due', 'payment received', 'you received',
  'transfer received', 'deposit', 'delivery', 'discount'
];

/**
 * The word that introduces the shop name.
 *
 * Not anchored to the start, because banks put things between the amount and
 * the name: "R$ 33,50 APROVADA em Montana Viracopos Camp" has a whole word in
 * the way. Searched within a short window so that a stray "em" in the sign-off
 * ("entre em contato com a gente") cannot be mistaken for the real one.
 */
const MERCHANT_LEAD = /\b(?:em|no|na|nos|nas|para|at|in|to|de|do|da)\s+/;
const LEAD_WINDOW = 40;

/** "R$ 30,00 - RENNER": some banks use a dash where others use a word. */
const MERCHANT_DASH = /^\s*[-–—|:]\s*/;

/**
 * Everything after the shop name that is not the shop name.
 *
 * Matched against the folded text so "às 21:02" is caught by a plain `as`.
 * `fold` preserves length, so an index found here still points at the right
 * character in the original — which is what keeps the accents in "CAFÉ SÃO
 * PAULO" while still cutting at the right place.
 */
const MERCHANT_TAILS = [
  /[\s,;]*\bas \d{1,2}[:h]\d{2}/,
  /[\s,;]*\b(?:no |na |em )?cartao\b/,
  /[\s,;]*\b(?:final|ending)\b/,
  /[\s,;]*\b(?:parcela|parc\.|installment|em \d+x)\b/,
  /[\s,;]*\b\d+\s*\/\s*\d+/,
  /[\s,;]*\b(?:limite|saldo|duvidas|fatura)\b/,
  /[\s,;]*\bem \d{2}\//,
  /[\s,;]*\b(?:hoje|ontem)\b/,
  /\.\s/,
  /[\n\r]/
];

/** "às 21:02" — the moment the bank says it happened. */
const TIME = /\b(?:as|at)\s*(\d{1,2})[:h](\d{2})\b|\b(\d{1,2}):(\d{2})\b/;

/**
 * @typedef {object} NotificationReading
 * @property {boolean} ok
 * @property {'notAPurchase'|'noAmount'|'declined'} [reason]
 * @property {number} [amount] signed cents — negative for a refund
 * @property {string} [currencyCode]
 * @property {string} [merchant]
 * @property {boolean} [isRefund]
 * @property {number} [confidence] 0–1
 */

/**
 * Reads one notification.
 *
 * @param {string} raw the notification text, or title/subtitle/body joined
 * @param {{defaultCurrency?: string}} [context]
 * @returns {NotificationReading}
 */
export function readNotification(raw, { defaultCurrency = 'USD' } = {}) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'noAmount' };

  // Folded for matching only. `fold` is length-preserving, so an index into
  // the folded string is still valid in the original — which is what lets the
  // merchant be sliced out of the text the user actually saw, accents intact.
  const folded = fold(text).toLowerCase();

  if (DECLINED_WORDS.some((word) => folded.includes(word))) {
    return { ok: false, reason: 'declined' };
  }
  if (NEVER_A_PURCHASE.some((word) => folded.includes(word))) {
    return { ok: false, reason: 'notAPurchase' };
  }

  const isRefund = REFUND_WORDS.some((word) => folded.includes(word));
  const looksLikeSpending = isRefund || PURCHASE_WORDS.some((word) => folded.includes(word));

  if (!looksLikeSpending && NOT_A_PURCHASE_WORDS.some((word) => folded.includes(word))) {
    return { ok: false, reason: 'notAPurchase' };
  }

  const money = firstSpendAmount(text, folded, defaultCurrency);
  if (!money) return { ok: false, reason: looksLikeSpending ? 'noAmount' : 'notAPurchase' };

  const merchant = extractMerchant(text, money.end);

  // Both halves present and the message says "purchase" — that is as good as
  // this gets, and good enough to file without asking.
  let confidence = 0.5;
  if (money.explicitCurrency) confidence += 0.1;
  if (looksLikeSpending) confidence += 0.15;
  if (merchant) confidence += 0.25;

  return {
    ok: true,
    amount: isRefund ? -money.cents : money.cents,
    currencyCode: money.currencyCode,
    merchant,
    isRefund,
    category: classify(merchant, merchant || null),
    time: extractTime(folded),
    confidence: Math.min(confidence, 1)
  };
}

/**
 * The first amount in the message that is actually the purchase.
 *
 * First, because banks lead with what you spent and mention the remaining
 * limit afterwards — but only after skipping any amount that is introduced as
 * a limit or balance, since some of them lead with that instead.
 */
function firstSpendAmount(text, folded, defaultCurrency) {
  const found = [];

  for (const match of text.matchAll(SYMBOL_FIRST)) {
    const marker = match[1].toLowerCase();
    found.push({
      index: match.index,
      end: match.index + match[0].length,
      digits: match[2],
      currencyCode: SYMBOL_CURRENCIES[marker] ?? defaultCurrency,
      explicitCurrency: SYMBOL_CURRENCIES[marker] !== null
    });
  }

  for (const match of text.matchAll(WORD_LAST)) {
    found.push({
      index: match.index,
      end: match.index + match[0].length,
      digits: match[1],
      currencyCode: WORD_CURRENCIES[fold(match[2]).toLowerCase()] ?? defaultCurrency,
      explicitCurrency: true
    });
  }

  found.sort((left, right) => left.index - right.index);

  for (const candidate of found) {
    const before = folded.slice(Math.max(0, candidate.index - 28), candidate.index);
    if (NOT_THE_PURCHASE.some((word) => before.includes(word))) continue;

    const cents = centsFromDigits(candidate.digits);
    if (cents === null || cents === 0) continue;
    return { ...candidate, cents };
  }

  return null;
}

/**
 * The shop name, taken from after the amount.
 *
 * "R$ 12,90 em PADARIA RAO LTDA - parcela 1/3" is the shape to beat: a lead-in
 * word, the name, then a tail of things that are not the name.
 */
function extractMerchant(text, amountEnd) {
  const after = text.slice(amountEnd);
  const foldedAfter = fold(after).toLowerCase();

  let start;
  const dash = MERCHANT_DASH.exec(after);
  const lead = MERCHANT_LEAD.exec(foldedAfter);

  if (lead && lead.index < LEAD_WINDOW) {
    start = lead.index + lead[0].length;
  } else if (dash) {
    start = dash[0].length;
  } else {
    // Nothing introduces a name here, and guessing produces "aprovada".
    return '';
  }

  const body = after.slice(start);
  const foldedBody = foldedAfter.slice(start);

  let end = body.length;
  for (const pattern of MERCHANT_TAILS) {
    const match = pattern.exec(foldedBody);
    if (match && match.index < end) end = match.index;
  }

  let name = body.slice(0, end).replace(/[\s,.;:\-–—]+$/, '').trim();
  // Company-registry noise nobody thinks of as the shop's name.
  name = name.replace(/\s+(ltda|me|epp|eireli|s\.?\/?a|inc|llc)\.?$/i, '').trim();

  // A whole sentence is not a merchant; something went wrong upstream.
  if (name.split(' ').length > 6 || name.length > 48) return '';
  return name;
}

/**
 * The clock time the bank quoted, as {hours, minutes}.
 *
 * Worth having because the notification and the purchase are not always the
 * same moment — the alert can arrive late, or sit on the lock screen until you
 * unlock. Filing the purchase at 21:02 rather than whenever FinApp happened to
 * open puts it in the right place on the daily chart.
 */
function extractTime(folded) {
  const match = TIME.exec(folded);
  if (!match) return null;

  const hours = Number(match[1] ?? match[3]);
  const minutes = Number(match[2] ?? match[4]);
  if (!Number.isInteger(hours) || hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}
