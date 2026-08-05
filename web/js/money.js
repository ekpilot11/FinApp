// Money, as whole minor units.
//
// The iOS app used `Decimal` for every amount. JavaScript has no decimal type
// and `0.1 + 0.2 !== 0.3`, so amounts are integers of cents everywhere —
// stored, summed, compared. Floating point appears exactly once, in
// `format`, where the value is already about to become a string.

/** Minor units per major unit. Two everywhere FinApp is used. */
export const MINOR_UNITS = 100;

/**
 * Reads a plain decimal string ("1250.75") into cents.
 *
 * Deliberately string arithmetic rather than `parseFloat(text) * 100`:
 * `4.75 * 100` is 474.99999999999994, and rounding that back is a coin flip
 * on values you cannot predict in advance.
 *
 * @returns {number|null} cents, or null when the text is not a plain number.
 */
export function centsFromDecimalString(text) {
  const trimmed = String(text ?? '').trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(trimmed)) return null;

  const [whole = '', fraction = ''] = trimmed.split('.');
  const kept = (fraction + '00').slice(0, 2);
  const dropped = fraction.slice(2);

  let cents = (whole === '' ? 0 : Number(whole)) * MINOR_UNITS + Number(kept);
  // Round half up on anything past two places.
  if (dropped && Number(dropped[0]) >= 5) cents += 1;

  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cents back to a bare decimal string ("1250.75"), for CSV and URLs. */
export function decimalStringFromCents(cents) {
  const negative = cents < 0;
  const absolute = Math.abs(Math.round(cents));
  const whole = Math.floor(absolute / MINOR_UNITS);
  const fraction = String(absolute % MINOR_UNITS).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function centsFromParts(whole, cents) {
  return whole * MINOR_UNITS + cents;
}

/**
 * Localised currency string. Falls back to a bare number when the browser
 * rejects the currency code, which is better than throwing mid-render.
 */
export function format(cents, currencyCode, locale = undefined) {
  const value = cents / MINOR_UNITS;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode
    }).format(value);
  } catch {
    return `${decimalStringFromCents(cents)} ${currencyCode}`;
  }
}

/** Just the symbol, for compact labels. */
export function currencySymbol(currencyCode, locale = undefined) {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}
