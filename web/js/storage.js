// Persistence. Everything lives in this browser's localStorage and goes
// nowhere else — there is no account, no server, no sync.
//
// Dates are stored as ISO strings and hydrated back into `Date` on load, so
// the rest of the app never has to think about the wire format.

import { makeExpense } from './ledger.js';

const EXPENSES_KEY = 'finapp.expenses.v1';
const SETTINGS_KEY = 'finapp.settings.v1';
const BUDGETS_KEY = 'finapp.budgets.v1';
const LAST_IMPORT_KEY = 'finapp.lastImport.v1';

/** Region → currency. Enough to make the first run feel right; editable in Settings. */
const REGION_CURRENCIES = {
  US: 'USD', CA: 'CAD', GB: 'GBP', IE: 'EUR', BR: 'BRL', PT: 'EUR', ES: 'EUR',
  FR: 'EUR', DE: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR',
  GR: 'EUR', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', CN: 'CNY', IN: 'INR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', CZ: 'CZK', ZA: 'ZAR', AE: 'AED', TR: 'TRY', KR: 'KRW', SG: 'SGD'
};

export function deviceCurrencyCode() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return REGION_CURRENCIES[region] ?? 'USD';
  } catch {
    return 'USD';
  }
}

export const DEFAULT_SETTINGS = {
  /** ISO 4217 code new expenses default to. */
  currencyCode: 'USD',
  /** Overall monthly ceiling, in cents. Zero means "not set". */
  monthlyBudget: 0,
  /**
   * When true, a clean parse saves straight away and offers undo. When false,
   * every voice entry opens the editor first.
   */
  autoSaveConfident: true,
  /** BCP 47 tag handed to the speech recogniser. */
  speechLanguage: 'en-US',
  hasSeenWelcome: false
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    // Private-mode Safari and a full quota both land here. The caller shows a
    // message rather than pretending the save worked.
    console.warn('FinApp: could not write to localStorage', error);
    return false;
  }
}

export function loadExpenses() {
  const rows = readJSON(EXPENSES_KEY, []);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => makeExpense({
    ...row,
    date: new Date(row.date),
    createdAt: new Date(row.createdAt ?? row.date)
  })).filter((row) => !Number.isNaN(row.date.getTime()));
}

export function saveExpenses(expenses) {
  return writeJSON(EXPENSES_KEY, expenses.map((expense) => ({
    ...expense,
    date: expense.date.toISOString(),
    createdAt: expense.createdAt.toISOString()
  })));
}

export function loadSettings() {
  const stored = readJSON(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    currencyCode: deviceCurrencyCode(),
    ...(stored && typeof stored === 'object' ? stored : {})
  };
}

export function saveSettings(settings) {
  return writeJSON(SETTINGS_KEY, settings);
}

/** @returns {Record<string, number>} category id → monthly limit in cents. */
export function loadBudgets() {
  const stored = readJSON(BUDGETS_KEY, {});
  if (!stored || typeof stored !== 'object') return {};
  const budgets = {};
  for (const [category, limit] of Object.entries(stored)) {
    if (Number.isFinite(limit) && limit > 0) budgets[category] = Math.round(limit);
  }
  return budgets;
}

export function saveBudgets(budgets) {
  return writeJSON(BUDGETS_KEY, budgets);
}

/**
 * What the last Shortcuts link actually delivered.
 *
 * Kept because a card automation fires while you are putting your phone away:
 * whatever the app says on screen is gone before you look, and if the values
 * arrived empty there is otherwise nothing left to diagnose. One record,
 * overwritten each time.
 */
export function saveLastImport(record) {
  return writeJSON(LAST_IMPORT_KEY, record);
}

export function loadLastImport() {
  const stored = readJSON(LAST_IMPORT_KEY, null);
  return stored && typeof stored === 'object' ? stored : null;
}

export function clearEverything() {
  for (const key of [EXPENSES_KEY, SETTINGS_KEY, BUDGETS_KEY, LAST_IMPORT_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing useful to do */
    }
  }
}

/** Whole ledger as a JSON blob, for the backup button. */
export function exportBackup(expenses, settings, budgets) {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    budgets,
    expenses: expenses.map((expense) => ({
      ...expense,
      date: expense.date.toISOString(),
      createdAt: expense.createdAt.toISOString()
    }))
  }, null, 2);
}

/**
 * Reads a backup produced by `exportBackup`.
 * @returns {{expenses: import('./ledger.js').Expense[], settings: object, budgets: object}}
 * @throws if the file is not a FinApp backup
 */
export function importBackup(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.expenses)) {
    throw new Error('That file does not look like a FinApp backup.');
  }
  const expenses = parsed.expenses
    .map((row) => makeExpense({
      ...row,
      date: new Date(row.date),
      createdAt: new Date(row.createdAt ?? row.date)
    }))
    .filter((row) => !Number.isNaN(row.date.getTime()));

  return {
    expenses,
    settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
    budgets: parsed.budgets && typeof parsed.budgets === 'object' ? parsed.budgets : {}
  };
}
