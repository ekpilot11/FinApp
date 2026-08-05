// Calendar arithmetic, in the browser's own time zone.
//
// Everything here goes through the local-time `Date` setters rather than
// millisecond maths, because "yesterday" is a calendar question, not a
// duration one: subtracting 86,400,000 ms across a daylight-saving boundary
// lands on the wrong day, and an expense filed on the wrong day is exactly
// the bug people notice.

export function startOfDay(date) {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function atMidday(date) {
  const copy = new Date(date.getTime());
  copy.setHours(12, 0, 0, 0);
  return copy;
}

export function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(date, months) {
  const copy = new Date(date.getTime());
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/** 1 = Sunday, matching Foundation's `Calendar.component(.weekday:)`. */
export function weekdayOf(date) {
  return date.getDay() + 1;
}

/** @returns {{start: Date, end: Date}} half-open interval. */
export function monthInterval(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

/** @returns {{start: Date, end: Date}} half-open interval. */
export function dayInterval(date) {
  const start = startOfDay(date);
  return { start, end: addDays(start, 1) };
}

export function daysBetween(from, to) {
  const start = startOfDay(from);
  const end = startOfDay(to);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/** `YYYY-MM-DDTHH:mm` in local time, for `<input type="datetime-local">`. */
export function toDateTimeLocalValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Reads a `<input type="datetime-local">` value back as local time. */
export function fromDateTimeLocalValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

/**
 * Reads a date the Shortcuts automation (or a bank feed) supplied.
 * Accepts ISO 8601 and anything else `Date` understands; returns null rather
 * than an Invalid Date, so callers can fall back to "now" deliberately.
 */
export function parseIncomingDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
