// Writes the ledger out as CSV. Ported from CSVExporter.swift.
//
// Present because an expense tracker that cannot hand your data back is a
// trap: the file opens in Numbers, Excel or any other tool, so switching away
// from FinApp costs nothing.

import { categoryName, source as sourceInfo } from './categories.js';
import { decimalStringFromCents } from './money.js';

const HEADER = 'date,amount,currency,category,merchant,note,source,pending';

export function toCSV(expenses) {
  const rows = [...expenses]
    .sort((left, right) => left.date - right.date)
    .map((expense) => [
      expense.date.toISOString(),
      decimalStringFromCents(expense.amount),
      expense.currencyCode,
      categoryName(expense.category),
      escape(expense.merchant),
      escape(expense.note),
      sourceInfo(expense.source).name,
      expense.isPending ? 'yes' : 'no'
    ].join(','));

  return `${HEADER}\n${rows.join('\n')}\n`;
}

/**
 * RFC 4180: wrap in quotes when the value contains a comma, quote or newline,
 * and double any embedded quotes.
 */
function escape(value) {
  const text = value ?? '';
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function fileStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
