// Reads and writes expenses, and keeps the same purchase from being recorded
// twice. Ported from ExpenseStore.swift.
//
// Double-counting is the failure mode that matters here: a coffee bought with
// Apple Pay can arrive from the Shortcuts automation within seconds, and again
// from the bank feed two days later once it settles. Both describe one $4.75,
// and a tracker that says $9.50 is worse than one that says nothing.
//
// Everything in this file is a pure function over a plain array, so it runs
// unchanged in the browser and under `node --test`.

import { isAutomaticSource, source as sourceInfo } from './categories.js';
import { normalize } from './category-classifier.js';
import { addDays, startOfDay } from './dates.js';

/**
 * How far apart two records of the same purchase can be and still be
 * recognised as one. Card networks routinely post a purchase two or three
 * days after it happened.
 */
export const DUPLICATE_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} Expense
 * @property {string} id
 * @property {number} amount cents; refunds are negative
 * @property {string} currencyCode ISO 4217, stored per row so travel spending
 *   stays honest
 * @property {string} merchant
 * @property {string} note
 * @property {Date} date when the money was spent, not when the row was created
 * @property {string} category category id
 * @property {string} source source id
 * @property {string|null} externalID identifier from the upstream feed
 * @property {boolean} isPending
 * @property {boolean} isReviewed
 * @property {string|null} transcript what the user actually said
 * @property {Date} createdAt
 */

/** @returns {Expense} */
export function makeExpense(fields) {
  const sourceID = fields.source ?? 'manual';
  return {
    id: fields.id ?? newID(),
    amount: fields.amount ?? 0,
    currencyCode: fields.currencyCode ?? 'USD',
    merchant: fields.merchant ?? '',
    note: fields.note ?? '',
    date: fields.date ?? new Date(),
    category: fields.category ?? 'other',
    source: sourceID,
    externalID: fields.externalID ?? null,
    isPending: fields.isPending ?? false,
    // Automatic rows land unreviewed so the History badge can surface them.
    isReviewed: fields.isReviewed ?? !isAutomaticSource(sourceID),
    transcript: fields.transcript ?? null,
    createdAt: fields.createdAt ?? new Date()
  };
}

export function newID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Merchant if we have one, otherwise the note, otherwise the category name. */
export function title(expense, categoryName) {
  if (expense.merchant.trim()) return expense.merchant;
  if (expense.note.trim()) return expense.note;
  return categoryName;
}

export function sourceName(expense) {
  return sourceInfo(expense.source).name;
}

// MARK: - Writing

/**
 * Adds `expense` to `expenses`, merging it into an existing row when it looks
 * like the same purchase arriving from a second source.
 *
 * Returns a *new* array, plus the row that now represents the purchase —
 * either the newly inserted one or the existing one it was merged into.
 *
 * @returns {{expenses: Expense[], row: Expense, merged: boolean}}
 */
export function insert(expense, expenses) {
  const existing = findDuplicate(expense, expenses);
  if (existing) {
    const merged = merge(expense, existing);
    return {
      expenses: expenses.map((row) => (row.id === existing.id ? merged : row)),
      row: merged,
      merged: true
    };
  }
  return { expenses: [...expenses, expense], row: expense, merged: false };
}

/** Looks for a row already describing this purchase. */
export function findDuplicate(expense, expenses) {
  // Same upstream id is conclusive.
  if (expense.externalID) {
    const match = expenses.find(
      (row) => row.id !== expense.id && row.externalID === expense.externalID
    );
    if (match) return match;
  }

  // Otherwise: same money, near the same time, plausibly the same place.
  //
  // Restricted to automatic sources on both sides. Two entries a person typed
  // or dictated are far more likely to be two real purchases than one
  // duplicated — and silently swallowing something the user just logged by
  // hand is a much worse failure than showing them a duplicate they can
  // delete.
  if (!isAutomaticSource(expense.source)) return null;

  const lowerBound = expense.date.getTime() - DUPLICATE_WINDOW_MS;
  const upperBound = expense.date.getTime() + DUPLICATE_WINDOW_MS;

  return expenses.find((candidate) => {
    if (candidate.id === expense.id) return false;
    const stamp = candidate.date.getTime();
    if (stamp < lowerBound || stamp > upperBound) return false;
    if (!isAutomaticSource(candidate.source)) return false;
    if (candidate.currencyCode !== expense.currencyCode) return false;
    // A pending row later settles at a different amount, so an exact match
    // plus a compatible merchant is as far as we can go.
    if (candidate.amount !== expense.amount) return false;
    return merchantsMatch(candidate.merchant, expense.merchant);
  }) ?? null;
}

/**
 * True when two merchant strings plausibly name the same place.
 *
 * Statement descriptors are noisy ("SQ *BLUE BOTTLE 4471 OAKLAND CA" vs
 * "Blue Bottle"), so this asks whether either name's significant words are
 * contained in the other. An empty name matches anything, because the
 * Shortcuts automation does not always provide one.
 */
export function merchantsMatch(left, right) {
  const a = normalize(left ?? '');
  const b = normalize(right ?? '');
  if (!a || !b) return true;
  if (a === b) return true;

  const leftWords = significantWords(a);
  const rightWords = significantWords(b);
  if (leftWords.size === 0 || rightWords.size === 0) return false;

  for (const word of leftWords) {
    if (rightWords.has(word)) return true;
  }
  return false;
}

function significantWords(text) {
  return new Set(
    text.split(/[^\p{L}]+/u).filter((word) => word.length >= 4)
  );
}

/**
 * Folds a newly arrived record into the row already representing the purchase.
 *
 * The incoming row usually knows more about settlement, while the existing
 * row usually knows more about intent (the note the user dictated), so each
 * field is taken from whichever side is better informed.
 *
 * @returns {Expense} a new row; neither argument is mutated
 */
export function merge(incoming, existing) {
  const merged = { ...existing };

  // Bank data is authoritative about money and timing.
  if (incoming.source === 'bankSync') {
    merged.amount = incoming.amount;
    merged.isPending = incoming.isPending;
    merged.date = incoming.date;
  }

  // Prefer the bank's id: later "modified" and "removed" events are keyed by
  // it, so a row still carrying an Apple Pay fingerprint would never be found
  // again when the purchase settles at a different amount.
  if (incoming.externalID && (!merged.externalID || incoming.source === 'bankSync')) {
    merged.externalID = incoming.externalID;
  }
  if (!merged.merchant && incoming.merchant) merged.merchant = incoming.merchant;
  if (!merged.note && incoming.note) merged.note = incoming.note;
  // A category the user chose outranks one a feed guessed.
  if (merged.category === 'other' && incoming.category !== 'other') {
    merged.category = incoming.category;
  }

  return merged;
}

// MARK: - Reading

/** @param {{start: Date, end: Date}} interval half-open. */
export function expensesIn(expenses, interval) {
  return expenses
    .filter((expense) => expense.date >= interval.start && expense.date < interval.end)
    .sort((left, right) => right.date - left.date);
}

export function unreviewedCount(expenses) {
  return expenses.filter((expense) => !expense.isReviewed).length;
}

// MARK: - Aggregation

/**
 * Total of `expenses`, ignoring rows in a different currency.
 *
 * FinApp deliberately does not convert currencies — it has no rate source it
 * could trust offline, and a wrong total is worse than a partial one.
 */
export function total(expenses, currencyCode) {
  return expenses
    .filter((expense) => expense.currencyCode === currencyCode)
    .reduce((sum, expense) => sum + expense.amount, 0);
}

/** @returns {{category: string, total: number}[]} biggest first. */
export function totalsByCategory(expenses, currencyCode) {
  const totals = new Map();
  for (const expense of expenses) {
    if (expense.currencyCode !== currencyCode) continue;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
  }
  return [...totals]
    .map(([category, amount]) => ({ category, total: amount }))
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total);
}

/** One entry per day in `interval`, zero-filled. */
export function totalsByDay(expenses, interval, currencyCode) {
  const totals = new Map();

  let day = startOfDay(interval.start);
  while (day < interval.end) {
    totals.set(day.getTime(), 0);
    day = addDays(day, 1);
  }

  for (const expense of expenses) {
    if (expense.currencyCode !== currencyCode) continue;
    const key = startOfDay(expense.date).getTime();
    if (!totals.has(key)) continue;
    totals.set(key, totals.get(key) + expense.amount);
  }

  return [...totals]
    .map(([stamp, amount]) => ({ date: new Date(stamp), total: amount }))
    .sort((left, right) => left.date - right.date);
}

/** All currencies present in the ledger, commonest first. */
export function currenciesUsed(expenses) {
  const counts = new Map();
  for (const expense of expenses) {
    counts.set(expense.currencyCode, (counts.get(expense.currencyCode) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1]).map(([code]) => code);
}
