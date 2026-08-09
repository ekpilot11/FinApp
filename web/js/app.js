// FinApp for the browser.
//
// Plain DOM, no framework, no build step: the files you edit are the files
// that run. That matters more than usual here, because the person maintaining
// this has a Windows PC and no way to compile anything Apple-shaped.

import { CATEGORIES, categoryIcon, categoryName, source as sourceInfo } from './categories.js';
import { categoryDonut, dailyBars, progressBar } from './charts.js';
import { canonicalSiteURL, expenseFromParams, importParams } from './card-import.js';
import { fileStamp, toCSV } from './csv.js';
import {
  addMonths, dayInterval, fromDateTimeLocalValue, isSameDay,
  monthInterval, startOfDay, toDateTimeLocalValue
} from './dates.js';
import { REVIEW_THRESHOLD, centsFromDigits, parse } from './expense-parser.js';
import {
  currenciesUsed, expensesIn, insert, makeExpense,
  title as rowTitle, total, totalsByCategory, totalsByDay, unreviewedCount
} from './ledger.js';
import { decimalStringFromCents, format } from './money.js';
import { Dictation, LANGUAGES, isSupported as speechIsSupported } from './speech.js';
import {
  clearEverything, exportBackup, importBackup, loadBudgets, loadExpenses,
  loadLastImport, loadSettings, saveBudgets, saveExpenses, saveLastImport,
  saveSettings
} from './storage.js';

const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'BRL', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'CNY',
  'INR', 'MXN', 'ARS', 'CLP', 'COP', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
  'ZAR', 'AED', 'TRY', 'KRW', 'SGD'
];

const state = {
  expenses: [],
  settings: loadSettings(),
  budgets: {},
  tab: 'log',
  month: new Date(),
  transcript: '',
  listening: false,
  editing: null,
  lastAction: null,
  lastImport: null
};

const dictation = new Dictation();
let toastTimer = null;
let toastActions = [];

// MARK: - Boot

function boot() {
  state.expenses = loadExpenses();
  state.budgets = loadBudgets();

  handleImportRequest();
  route();
  window.addEventListener('hashchange', () => {
    route();
    render();
  });

  document.getElementById('app').addEventListener('click', onClick);
  document.getElementById('app').addEventListener('change', onChange);
  document.getElementById('app').addEventListener('submit', onSubmit);
  document.getElementById('sheet').addEventListener('click', onClick);
  document.getElementById('sheet').addEventListener('submit', onSubmit);

  render();
  registerServiceWorker();
}

const TABS = ['log', 'spending', 'history', 'settings'];

function route() {
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  state.tab = TABS.includes(hash) ? hash : 'log';
}

function go(tab) {
  window.location.hash = `#/${tab}`;
}

/**
 * A purchase handed over by a Shortcuts automation.
 *
 * Runs before the first render so the arriving expense is already in the list
 * the user sees, rather than appearing a frame later.
 */
function handleImportRequest() {
  const params = importParams(window.location.href);
  if (!params) return;

  // Recorded before anything is interpreted. If the automation delivered an
  // empty amount, this is the only evidence that survives — the page opens
  // while the phone is going back into a pocket.
  const received = {
    at: new Date().toISOString(),
    amount: params.get('amount') ?? '',
    merchant: params.get('merchant') ?? '',
    currency: params.get('currency') ?? '',
    id: params.get('id') ?? ''
  };

  const fields = expenseFromParams(params, { defaultCurrency: state.settings.currencyCode });
  // Strip the parameters either way, so a reload cannot log the purchase twice.
  window.history.replaceState(null, '', `${window.location.pathname}#/log`);

  if (!fields) {
    recordImport({ ...received, outcome: 'rejected' });
    return;
  }

  const result = insert(makeExpense(fields), state.expenses);
  state.expenses = result.expenses;
  persistExpenses();
  recordImport({
    ...received,
    outcome: result.merged ? 'duplicate' : 'logged',
    stored: format(result.row.amount, result.row.currencyCode)
  });
}

function recordImport(record) {
  state.lastImport = record;
  saveLastImport(record);
}

/**
 * The result of a card import, as a panel that stays put.
 *
 * A toast was wrong for this: the automation runs unattended, Safari is still
 * opening as it fires, and three seconds later the one thing that would
 * explain a missing purchase is gone.
 */
function importReport(record, { dismissable }) {
  if (!record) return '';

  const when = new Date(record.at).toLocaleString();
  const quote = (value) => (value ? `“${esc(value)}”` : '<em>empty</em>');

  const headline = {
    logged: `Logged ${esc(record.stored ?? '')}`,
    duplicate: `Already had ${esc(record.stored ?? '')} — not counted twice`,
    rejected: 'Nothing logged: no usable amount arrived'
  }[record.outcome] ?? 'Card link received';

  const explanation = record.outcome === 'rejected' ? `
    <p class="hint hint--warn">The link opened but carried no amount, so there was
      nothing to record. In Shortcuts, open the automation and check that the
      <strong>Amount</strong> variable sits immediately after
      <code>amount=</code> — a chip, not the word. If it looks right, the card
      may not report an amount until the purchase settles.</p>` : '';

  return `
    <section class="card">
      <h2 class="card__title">
        Last card purchase
        ${dismissable ? '<button type="button" class="link" data-action="dismiss-import">Dismiss</button>' : ''}
      </h2>
      <p><strong>${headline}</strong></p>
      <p class="hint">${esc(when)}</p>
      <p class="hint">Received — amount: ${quote(record.amount)},
        merchant: ${quote(record.merchant)}${record.currency ? `, currency: ${quote(record.currency)}` : ''}</p>
      ${explanation}
    </section>`;
}

// MARK: - Rendering

function render() {
  document.body.dataset.tab = state.tab;
  document.getElementById('screen').innerHTML = screenHTML();
  document.getElementById('tabbar').innerHTML = tabbarHTML();

  if (state.tab === 'log') {
    const input = document.getElementById('sentence');
    if (input && state.transcript && document.activeElement !== input) {
      input.value = state.transcript;
    }
  }
}

function screenHTML() {
  switch (state.tab) {
    case 'spending': return spendingScreen();
    case 'history': return historyScreen();
    case 'settings': return settingsScreen();
    default: return logScreen();
  }
}

function tabbarHTML() {
  const unreviewed = unreviewedCount(state.expenses);
  const items = [
    ['log', 'Log', '🎙️'],
    ['spending', 'Spending', '📊'],
    ['history', 'History', '🧾'],
    ['settings', 'Settings', '⚙️']
  ];
  return items.map(([id, label, icon]) => {
    const badge = id === 'history' && unreviewed > 0
      ? `<span class="badge">${unreviewed}</span>` : '';
    return `<button type="button" class="tab${state.tab === id ? ' tab--on' : ''}"`
      + ` data-action="tab" data-tab="${id}" aria-current="${state.tab === id}">`
      + `<span class="tab__icon">${icon}${badge}</span><span>${label}</span></button>`;
  }).join('');
}

// MARK: - Log screen

function logScreen() {
  const { currencyCode } = state.settings;
  const today = expensesIn(state.expenses, dayInterval(new Date()));
  const todayTotal = total(today, currencyCode);
  const recent = [...state.expenses].sort((left, right) => right.date - left.date).slice(0, 6);

  const micNote = speechIsSupported()
    ? `<p class="hint">Tap and say it in one breath — <em>“twelve fifty on coffee at Starbucks yesterday”</em>.</p>`
    : `<p class="hint hint--warn">This browser has no voice input — on iPhone, open FinApp
       in Safari. Typing the same sentence below runs through exactly the same parser.</p>`;

  return `
    ${importReport(state.lastImport, { dismissable: true })}

    <section class="hero">
      <p class="hero__label">Spent today</p>
      <p class="hero__value">${esc(format(todayTotal, currencyCode))}</p>
    </section>

    <section class="mic-area">
      <button type="button" id="mic" class="mic${state.listening ? ' mic--live' : ''}"
              data-action="mic" ${speechIsSupported() ? '' : 'disabled'}
              aria-label="${state.listening ? 'Stop listening' : 'Start voice logging'}">
        <span class="mic__glyph">${state.listening ? '■' : '🎙️'}</span>
      </button>
      <p class="mic__status" id="mic-status">${state.listening ? 'Listening…' : ''}</p>
      ${micNote}
    </section>

    <form class="sentence" data-form="sentence">
      <input type="text" id="sentence" name="sentence" autocomplete="off"
             enterkeyhint="done" placeholder="…or type it here"
             value="${esc(state.transcript)}">
      <button type="submit" class="button button--primary">Log</button>
    </form>

    <div class="row-actions">
      <button type="button" class="button button--quiet" data-action="new">Add by hand</button>
    </div>

    ${recent.length ? `
      <section class="card">
        <h2 class="card__title">Recent</h2>
        <ul class="list">${recent.map(expenseRow).join('')}</ul>
      </section>` : `
      <section class="card card--empty">
        <p>Nothing logged yet.</p>
        <p class="hint">Everything stays in this browser. Nothing is uploaded anywhere.</p>
      </section>`}
  `;
}

// MARK: - Spending screen

function spendingScreen() {
  const { currencyCode, monthlyBudget } = state.settings;
  const interval = monthInterval(state.month);
  const rows = expensesIn(state.expenses, interval);
  const monthTotal = total(rows, currencyCode);
  const byCategory = totalsByCategory(rows, currencyCode);
  const byDay = totalsByDay(rows, interval, currencyCode);
  const now = new Date();
  const todayIndex = byDay.findIndex((day) => isSameDay(day.date, now));

  const monthLabel = state.month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const isCurrentMonth = state.month.getFullYear() === now.getFullYear()
    && state.month.getMonth() === now.getMonth();

  const budgetBlock = monthlyBudget > 0 ? `
    <div class="budget">
      ${progressBar(monthTotal, monthlyBudget)}
      <p class="budget__caption">
        ${esc(format(monthTotal, currencyCode))} of ${esc(format(monthlyBudget, currencyCode))}
        &middot;
        ${monthTotal > monthlyBudget
          ? `<strong class="over">${esc(format(monthTotal - monthlyBudget, currencyCode))} over</strong>`
          : `<span class="muted">${esc(format(monthlyBudget - monthTotal, currencyCode))} left</span>`}
      </p>
    </div>` : `
    <p class="hint">No monthly limit set — <button type="button" class="link"
       data-action="tab" data-tab="settings">add one</button>.</p>`;

  return `
    <section class="monthbar">
      <button type="button" class="stepper" data-action="month" data-delta="-1"
              aria-label="Previous month">‹</button>
      <h1>${esc(monthLabel)}</h1>
      <button type="button" class="stepper" data-action="month" data-delta="1"
              aria-label="Next month" ${isCurrentMonth ? 'disabled' : ''}>›</button>
    </section>

    <section class="hero hero--tight">
      <p class="hero__label">Total</p>
      <p class="hero__value">${esc(format(monthTotal, currencyCode))}</p>
      ${budgetBlock}
    </section>

    ${monthTotal !== 0 ? `
      <section class="card">
        <h2 class="card__title">By day</h2>
        ${dailyBars(byDay, { currencyCode, todayIndex })}
      </section>

      <section class="card">
        <h2 class="card__title">By category</h2>
        <div class="split">
          ${categoryDonut(byCategory, { currencyCode })}
          <ul class="legend">
            ${byCategory.map((slice) => `
              <li>
                <span class="dot" style="background:${categoryColorOf(slice.category)}"></span>
                <span class="legend__name">${esc(categoryName(slice.category))}</span>
                <span class="legend__value">${esc(format(slice.total, currencyCode))}</span>
              </li>`).join('')}
          </ul>
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Category limits</h2>
        <p class="hint">A monthly ceiling per category. Leave blank for no limit.</p>
        <ul class="limits">
          ${byCategory.map((slice) => categoryLimitRow(slice, currencyCode)).join('')}
        </ul>
      </section>
    ` : `<section class="card card--empty"><p>Nothing spent this month.</p></section>`}
  `;
}

function categoryLimitRow(slice, currencyCode) {
  const limit = state.budgets[slice.category] ?? 0;
  return `
    <li class="limit">
      <div class="limit__head">
        <span>${categoryIcon(slice.category)} ${esc(categoryName(slice.category))}</span>
        <span class="muted">${esc(format(slice.total, currencyCode))}</span>
      </div>
      ${limit > 0 ? progressBar(slice.total, limit) : ''}
      <input type="text" inputmode="decimal" class="limit__input"
             data-input="limit" data-category="${slice.category}"
             placeholder="No limit" value="${limit > 0 ? decimalStringFromCents(limit) : ''}"
             aria-label="Monthly limit for ${esc(categoryName(slice.category))}">
    </li>`;
}

/**
 * True when running as an installed home-screen app rather than in a browser
 * tab. iOS can give the two separate storage, so which one you are in decides
 * which expenses you can see — worth saying out loud rather than leaving
 * someone to conclude their data vanished.
 */
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function categoryColorOf(id) {
  return CATEGORIES.find((entry) => entry.id === id)?.color ?? '#8E8E93';
}

// MARK: - History screen

function historyScreen() {
  const sorted = [...state.expenses].sort((left, right) => right.date - left.date);
  if (sorted.length === 0) {
    return `<section class="card card--empty"><p>No expenses yet.</p></section>`;
  }

  const groups = [];
  for (const expense of sorted) {
    const key = startOfDay(expense.date).getTime();
    if (groups.length === 0 || groups.at(-1).key !== key) {
      groups.push({ key, date: expense.date, rows: [] });
    }
    groups.at(-1).rows.push(expense);
  }

  return groups.map((group) => `
    <section class="card">
      <h2 class="card__title">
        ${esc(dayLabel(group.date))}
        <span class="muted">${esc(format(total(group.rows, state.settings.currencyCode),
          state.settings.currencyCode))}</span>
      </h2>
      <ul class="list">${group.rows.map(expenseRow).join('')}</ul>
    </section>`).join('');
}

function dayLabel(date) {
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' });
}

function expenseRow(expense) {
  const flag = expense.isReviewed ? '' : '<span class="pip" title="Not reviewed yet"></span>';
  const pending = expense.isPending ? '<span class="chip">pending</span>' : '';
  return `
    <li>
      <button type="button" class="row" data-action="edit" data-id="${expense.id}">
        <span class="row__icon" style="background:${categoryColorOf(expense.category)}22">
          ${categoryIcon(expense.category)}
        </span>
        <span class="row__body">
          <span class="row__title">${esc(rowTitle(expense, categoryName(expense.category)))}${flag}</span>
          <span class="row__meta">
            ${esc(categoryName(expense.category))} · ${esc(sourceInfo(expense.source).name)} ${pending}
          </span>
        </span>
        <span class="row__amount${expense.amount < 0 ? ' row__amount--refund' : ''}">
          ${esc(format(expense.amount, expense.currencyCode))}
        </span>
      </button>
    </li>`;
}

// MARK: - Settings screen

function settingsScreen() {
  const { settings } = state;
  const codes = [...new Set([...currenciesUsed(state.expenses), ...COMMON_CURRENCIES])];
  const here = `${window.location.origin}${window.location.pathname}`;
  const canonical = canonicalSiteURL(window.location.href);
  const shortcutURL = `${canonical ?? here}?add=1&amount=AMOUNT&merchant=MERCHANT`;

  // A per-deploy preview link gets its own storage, so a ledger built here is
  // invisible from the real address. Say so at the top of Settings, before
  // anything is logged into the wrong one.
  const previewWarning = canonical ? `
    <section class="card">
      <h2 class="card__title">Wrong address</h2>
      <p class="hint hint--warn">You are on a preview link that belongs to one
        particular deploy. Expenses are stored per address, so anything logged
        here will be missing when you open the real one. Use this instead, and
        add <em>that</em> to your home screen:</p>
      <code class="code">${esc(canonical)}</code>
      <div class="row-actions">
        <a class="button button--primary" href="${esc(canonical)}">Go there now</a>
      </div>
    </section>` : '';

  return `
    ${previewWarning}
    <section class="card">
      <h2 class="card__title">Money</h2>
      <label class="field">
        <span>Default currency</span>
        <select data-input="currency">
          ${codes.map((code) => `<option value="${code}"${code === settings.currencyCode
            ? ' selected' : ''}>${code}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span>Monthly limit</span>
        <input type="text" inputmode="decimal" data-input="monthlyBudget"
               placeholder="No limit"
               value="${settings.monthlyBudget > 0 ? decimalStringFromCents(settings.monthlyBudget) : ''}">
      </label>
      <p class="hint">FinApp never converts between currencies. Totals only add up rows
        that already share one, because a total built from a guessed rate is wrong in a
        way you cannot see.</p>
    </section>

    <section class="card">
      <h2 class="card__title">Voice</h2>
      <label class="field">
        <span>Dictation language</span>
        <select data-input="speechLanguage">
          ${LANGUAGES.map((language) => `<option value="${language.tag}"${
            language.tag === settings.speechLanguage ? ' selected' : ''
          }>${esc(language.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field field--switch">
        <span>Save confident entries straight away</span>
        <input type="checkbox" data-input="autoSaveConfident"
               ${settings.autoSaveConfident ? 'checked' : ''}>
      </label>
      <p class="hint">Anything the parser is unsure of opens the editor instead.</p>
      <p class="hint hint--warn">The sentence parser understands <strong>English</strong>
        phrasing only. Dictating in another language transcribes fine, but the amount,
        date and merchant will usually need correcting — so switch auto-save off if you
        log in one.</p>
      <p class="hint">Speech is transcribed by the browser's own service (on iPhone, by
        Apple), so audio leaves the device. Everything after that — parsing, storing,
        totalling — happens here.</p>
    </section>

    <section class="card">
      <h2 class="card__title">Apple Pay</h2>
      <p class="hint">No app or website can read Apple Wallet — Apple exposes no API for
        it. What does work is a Shortcuts <strong>Transaction</strong> automation that
        opens this address after a card is used:</p>
      <code class="code" id="shortcut-url">${esc(shortcutURL)}</code>
      <div class="row-actions">
        <button type="button" class="button" data-action="copy-url">Copy address</button>
      </div>
      <p class="hint">Full walkthrough in <code>docs/WEB.md</code> in the repository.</p>
    </section>

    ${importReport(loadLastImport(), { dismissable: false })}

    <section class="card">
      <h2 class="card__title">Your data</h2>
      <p class="hint"><strong>${state.expenses.length}
        expense${state.expenses.length === 1 ? '' : 's'} here</strong>, and you are
        ${isStandalone()
          ? 'running FinApp <strong>from the home screen</strong>'
          : 'running FinApp <strong>in the browser</strong>'}.</p>
      <p class="hint hint--warn">iOS can keep these two as separate stores. If a
        purchase you logged one way is missing from the other, that is why — the
        data is not lost, it is in the other one. Open both, see which has the
        higher count, and keep using that one. Use <strong>Download backup</strong>
        here and <strong>Restore backup</strong> there to bring them together.</p>
      <p class="hint">Nothing is uploaded anywhere. Clearing website data erases
        it all, so keep a backup.</p>
      <div class="row-actions row-actions--wrap">
        <button type="button" class="button" data-action="export-csv">Export CSV</button>
        <button type="button" class="button" data-action="export-backup">Download backup</button>
        <button type="button" class="button" data-action="import-backup">Restore backup</button>
        <button type="button" class="button button--danger" data-action="erase">Erase everything</button>
      </div>
      <input type="file" id="restore-file" accept="application/json,.json" hidden>
    </section>

    <section class="card">
      <h2 class="card__title">Install it</h2>
      <p class="hint">In Safari on your iPhone: <strong>Share → Add to Home Screen</strong>.
        It then opens full-screen with its own icon, and works offline.</p>
    </section>
  `;
}

// MARK: - Editor sheet

function openEditor(expense, { isNew = false, warning = '', alternative = null } = {}) {
  state.editing = { expense, isNew };
  const sheet = document.getElementById('sheet');

  sheet.innerHTML = `
    <div class="sheet__scrim" data-action="close-sheet"></div>
    <form class="sheet__panel" data-form="editor">
      <header class="sheet__head">
        <button type="button" class="button button--quiet" data-action="close-sheet">Cancel</button>
        <h2>${isNew ? 'New expense' : 'Edit expense'}</h2>
        <button type="submit" class="button button--primary">Save</button>
      </header>

      ${warning ? `<p class="hint hint--warn">${esc(warning)}</p>` : ''}

      <label class="field">
        <span>Amount</span>
        <input type="text" inputmode="decimal" name="amount" required
               value="${expense.amount ? decimalStringFromCents(Math.abs(expense.amount)) : ''}">
      </label>

      ${alternative !== null ? `
        <p class="hint">Dictation cannot tell “twelve fifty” from “twelve hundred
          fifty” — both come through as the same digits.
          <button type="button" class="link" data-action="use-alternative"
                  data-amount="${decimalStringFromCents(alternative)}">Use
            ${esc(format(alternative, expense.currencyCode))} instead</button></p>` : ''}

      <label class="field field--switch">
        <span>This was a refund</span>
        <input type="checkbox" name="refund" ${expense.amount < 0 ? 'checked' : ''}>
      </label>

      <label class="field">
        <span>Currency</span>
        <select name="currencyCode">
          ${[...new Set([expense.currencyCode, ...COMMON_CURRENCIES])].map((code) =>
            `<option value="${code}"${code === expense.currencyCode ? ' selected' : ''}>${code}</option>`
          ).join('')}
        </select>
      </label>

      <label class="field">
        <span>Merchant</span>
        <input type="text" name="merchant" autocomplete="off" value="${esc(expense.merchant)}">
      </label>

      <label class="field">
        <span>Note</span>
        <input type="text" name="note" autocomplete="off" value="${esc(expense.note)}">
      </label>

      <label class="field">
        <span>When</span>
        <input type="datetime-local" name="date" value="${toDateTimeLocalValue(expense.date)}">
      </label>

      <fieldset class="field field--chips">
        <legend>Category</legend>
        <div class="chips">
          ${CATEGORIES.map((entry) => `
            <label class="chip-option">
              <input type="radio" name="category" value="${entry.id}"
                     ${entry.id === expense.category ? 'checked' : ''}>
              <span style="--tint:${entry.color}">${entry.icon} ${esc(entry.name)}</span>
            </label>`).join('')}
        </div>
      </fieldset>

      ${expense.transcript ? `<p class="hint">Heard: “${esc(expense.transcript)}”</p>` : ''}

      ${isNew ? '' : `
        <div class="row-actions">
          <button type="button" class="button button--danger" data-action="delete">Delete</button>
        </div>`}
    </form>`;

  sheet.hidden = false;
  document.body.classList.add('sheet-open');
  sheet.querySelector('input[name="amount"]')?.focus();
}

function closeEditor() {
  state.editing = null;
  const sheet = document.getElementById('sheet');
  sheet.hidden = true;
  sheet.innerHTML = '';
  document.body.classList.remove('sheet-open');
}

function readEditor(form) {
  const data = new FormData(form);
  const magnitude = centsFromDigits(String(data.get('amount') ?? '').replace(/[^\d.,]/g, ''));
  if (magnitude === null || magnitude === 0) return null;

  const base = state.editing.expense;
  return {
    ...base,
    amount: data.get('refund') ? -magnitude : magnitude,
    currencyCode: String(data.get('currencyCode') ?? base.currencyCode),
    merchant: String(data.get('merchant') ?? '').trim(),
    note: String(data.get('note') ?? '').trim(),
    date: fromDateTimeLocalValue(String(data.get('date') ?? '')) ?? base.date,
    category: String(data.get('category') ?? base.category),
    // Editing is a review.
    isReviewed: true
  };
}

// MARK: - Events

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;

  switch (action) {
    case 'tab':
      go(target.dataset.tab);
      break;
    case 'mic':
      toggleDictation();
      break;
    case 'new':
      openEditor(makeExpense({
        amount: 0,
        currencyCode: state.settings.currencyCode,
        date: new Date(),
        source: 'manual'
      }), { isNew: true });
      break;
    case 'edit': {
      const expense = state.expenses.find((row) => row.id === target.dataset.id);
      if (expense) openEditor(expense);
      break;
    }
    case 'close-sheet':
      closeEditor();
      break;
    case 'dismiss-import':
      // Cleared from the Log screen only; Settings keeps the record.
      state.lastImport = null;
      render();
      break;
    case 'use-alternative': {
      const field = document.querySelector('.sheet__panel input[name="amount"]');
      if (field) field.value = target.dataset.amount;
      target.closest('.hint')?.remove();
      break;
    }
    case 'delete':
      deleteEditing();
      break;
    case 'month':
      state.month = addMonths(state.month, Number(target.dataset.delta));
      render();
      break;
    case 'undo':
      undoLast();
      break;
    case 'copy-url':
      copyShortcutURL();
      break;
    case 'export-csv':
      download(`FinApp-${fileStamp()}.csv`, toCSV(state.expenses), 'text/csv');
      break;
    case 'export-backup':
      download(`FinApp-backup-${fileStamp()}.json`,
        exportBackup(state.expenses, state.settings, state.budgets), 'application/json');
      break;
    case 'import-backup':
      pickBackupFile();
      break;
    case 'erase':
      eraseEverything();
      break;
    default:
      break;
  }
}

function onChange(event) {
  const input = event.target.closest('[data-input]');
  if (!input) return;

  switch (input.dataset.input) {
    case 'currency':
      state.settings.currencyCode = input.value;
      persistSettings();
      render();
      break;
    case 'monthlyBudget': {
      const cents = centsFromDigits(input.value.replace(/[^\d.,]/g, ''));
      state.settings.monthlyBudget = cents ?? 0;
      persistSettings();
      render();
      break;
    }
    case 'speechLanguage':
      state.settings.speechLanguage = input.value;
      persistSettings();
      break;
    case 'autoSaveConfident':
      state.settings.autoSaveConfident = input.checked;
      persistSettings();
      break;
    case 'limit': {
      const cents = centsFromDigits(input.value.replace(/[^\d.,]/g, ''));
      if (cents && cents > 0) state.budgets[input.dataset.category] = cents;
      else delete state.budgets[input.dataset.category];
      saveBudgets(state.budgets);
      render();
      break;
    }
    default:
      break;
  }
}

function onSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.dataset.form === 'sentence') {
    const input = form.querySelector('#sentence');
    logSentence(input.value);
    input.value = '';
    state.transcript = '';
    return;
  }

  if (form.dataset.form === 'editor') {
    const edited = readEditor(form);
    if (!edited) {
      showToast('That amount is not a number.');
      return;
    }
    const { isNew } = state.editing;
    closeEditor();

    if (isNew) {
      const result = insert(edited, state.expenses);
      state.expenses = result.expenses;
      showToast(result.merged ? 'Merged into an existing purchase.' : 'Saved.');
    } else {
      state.expenses = state.expenses.map((row) => (row.id === edited.id ? edited : row));
      showToast('Updated.');
    }
    persistExpenses();
    render();
  }
}

// MARK: - Logging

function logSentence(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const parsed = parse(trimmed, { defaultCurrency: state.settings.currencyCode });
  const expense = makeExpense({
    amount: parsed.signedAmount ?? 0,
    currencyCode: parsed.currencyCode,
    merchant: parsed.merchant ?? '',
    note: parsed.note,
    date: parsed.date,
    category: parsed.category,
    source: 'voice',
    transcript: parsed.transcript
  });

  // A wrong guess should cost a tap, not produce a bad record.
  const confident = parsed.isUsable
    && parsed.confidence >= REVIEW_THRESHOLD
    && state.settings.autoSaveConfident;

  if (!confident) {
    openEditor(expense, {
      isNew: true,
      alternative: parsed.alternativeAmount,
      warning: parsed.isUsable
        ? 'Check this over — I was not sure I heard it right.'
        : 'I could not hear an amount. Fill it in and save.'
    });
    render();
    return;
  }

  const result = insert(expense, state.expenses);
  state.expenses = result.expenses;
  state.lastAction = result.merged ? null : { type: 'insert', id: result.row.id };
  persistExpenses();
  render();

  const label = `${format(result.row.amount, result.row.currencyCode)}`
    + `${result.row.merchant ? ` at ${result.row.merchant}` : ''}`;

  const actions = [];
  if (!result.merged) {
    // Dictation turns "twelve fifty" into 1250 and there is no way to tell
    // that from twelve hundred fifty. Offer the other reading right where the
    // mistake would otherwise go unnoticed — one tap, no editor.
    if (parsed.alternativeAmount !== null) {
      const other = parsed.isRefund ? -parsed.alternativeAmount : parsed.alternativeAmount;
      actions.push({
        label: `No, ${format(other, result.row.currencyCode)}`,
        run: () => correctAmount(result.row.id, other)
      });
    }
    actions.push({ label: 'Undo', run: undoLast });
  }

  showToast(result.merged ? `Already logged ${label}.` : `Logged ${label}.`, actions);
}

/** Rewrites a just-saved row's amount, for the "did you mean" offer. */
function correctAmount(id, amount) {
  const row = state.expenses.find((candidate) => candidate.id === id);
  if (!row) return;
  state.expenses = state.expenses.map(
    (candidate) => (candidate.id === id ? { ...candidate, amount } : candidate)
  );
  state.lastAction = null;
  persistExpenses();
  render();
  showToast(`Changed to ${format(amount, row.currencyCode)}.`);
}

function undoLast() {
  if (state.lastAction?.type !== 'insert') return;
  state.expenses = state.expenses.filter((row) => row.id !== state.lastAction.id);
  state.lastAction = null;
  persistExpenses();
  render();
  showToast('Removed.');
}

function deleteEditing() {
  const { expense } = state.editing;
  closeEditor();
  state.expenses = state.expenses.filter((row) => row.id !== expense.id);
  persistExpenses();
  render();
  showToast('Deleted.');
}

// MARK: - Dictation

function toggleDictation() {
  if (state.listening) {
    dictation.stop();
    return;
  }

  const started = dictation.start(state.settings.speechLanguage, {
    onPartial: (text) => {
      state.transcript = text;
      const field = document.getElementById('sentence');
      if (field) field.value = text;
      const status = document.getElementById('mic-status');
      if (status) status.textContent = text || 'Listening…';
    },
    onFinal: (text) => {
      state.transcript = '';
      logSentence(text);
    },
    onError: (message) => {
      state.listening = false;
      render();
      showToast(message);
    },
    onEnd: () => {
      state.listening = false;
      render();
    }
  });

  if (started) {
    state.listening = true;
    state.transcript = '';
    render();
  }
}

// MARK: - Data actions

function persistExpenses() {
  if (!saveExpenses(state.expenses)) {
    showToast('Could not save — this browser is blocking storage.');
  }
}

function persistSettings() {
  saveSettings(state.settings);
}

function download(filename, text, mimeType) {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickBackupFile() {
  const picker = document.getElementById('restore-file');
  if (!picker) return;
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const restored = importBackup(await file.text());
      state.expenses = restored.expenses;
      state.settings = { ...state.settings, ...restored.settings };
      state.budgets = restored.budgets;
      persistExpenses();
      persistSettings();
      saveBudgets(state.budgets);
      render();
      showToast(`Restored ${restored.expenses.length} expenses.`);
    } catch (error) {
      showToast(error.message ?? 'That backup could not be read.');
    }
    picker.value = '';
  };
  picker.click();
}

function eraseEverything() {
  const count = state.expenses.length;
  if (!window.confirm(`Delete all ${count} expenses from this browser? This cannot be undone.`)) {
    return;
  }
  clearEverything();
  state.expenses = [];
  state.budgets = {};
  state.settings = loadSettings();
  render();
  showToast('Everything erased.');
}

async function copyShortcutURL() {
  const text = document.getElementById('shortcut-url')?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    showToast('Address copied.');
  } catch {
    showToast('Copy it by hand — this browser blocked the clipboard.');
  }
}

// MARK: - Chrome

/**
 * @param {{label: string, run: () => void}[]} actions
 */
function showToast(message, actions = []) {
  const toast = document.getElementById('toast');
  toastActions = actions;

  toast.innerHTML = `<span>${esc(message)}</span>`
    + actions.map((action, index) =>
      `<button type="button" class="link" data-toast="${index}">${esc(action.label)}</button>`
    ).join('');
  toast.hidden = false;

  toast.onclick = (event) => {
    const button = event.target.closest('[data-toast]');
    if (!button) return;
    toast.hidden = true;
    toastActions[Number(button.dataset.toast)]?.run();
  };

  clearTimeout(toastTimer);
  // Long enough to read and act on an offer to fix a hundred-times error.
  toastTimer = setTimeout(() => { toast.hidden = true; }, actions.length ? 9000 : 3200);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Only over https / localhost; a file:// open just skips offline support.
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is a bonus, not a requirement */
  });
}

boot();
