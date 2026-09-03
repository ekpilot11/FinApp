// Turns number words into numbers. Ported from SpelledNumber.swift.
//
// Speech recognition is inconsistent about this: "I spent twelve fifty" often
// comes back as words while "I spent 12.50" comes back as digits, and the same
// sentence can flip between the two mid-session. The parser tries digits first
// and falls back to this.

export const UNITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};

export const TENS = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

export function isNumberWord(token) {
  return Object.hasOwn(UNITS, token)
    || Object.hasOwn(TENS, token)
    || token === 'hundred'
    || token === 'thousand';
}

/**
 * Every number spelled out in `tokens`, left to right, without overlaps.
 *
 * Adjacent numbers are kept separate rather than being merged: "twelve fifty"
 * yields [12, 50], not 1250, because deciding that it means $12.50 is the
 * caller's job — it needs the currency context to be sure.
 *
 * @param {string[]} tokens folded, lowercase words
 * @returns {{value: number, start: number, end: number}[]} half-open token ranges
 */
export function runs(tokens) {
  const results = [];
  let index = 0;

  while (index < tokens.length) {
    if (!isNumberWord(tokens[index])) {
      index += 1;
      continue;
    }

    const start = index;
    let total = 0;
    let current = 0;
    let hasOnes = false;
    let hasTens = false;
    let cursor = index;

    scan: while (cursor < tokens.length) {
      const token = tokens[cursor];

      if (token === 'and') {
        // "one hundred and twenty" — a connector only if a number word
        // follows and we are already mid-number.
        const next = cursor + 1;
        if (next >= tokens.length || !isNumberWord(tokens[next]) || (total === 0 && current === 0)) {
          break scan;
        }
        cursor += 1;
        continue;
      }

      if (Object.hasOwn(UNITS, token)) {
        // A second ones-place digit means a new number started.
        if (hasOnes) break scan;
        current += UNITS[token];
        hasOnes = true;
      } else if (Object.hasOwn(TENS, token)) {
        // "twelve fifty" — tens after ones is a new number.
        if (hasTens || hasOnes) break scan;
        current += TENS[token];
        hasTens = true;
      } else if (token === 'hundred') {
        current = (current === 0 ? 1 : current) * 100;
        hasOnes = false;
        hasTens = false;
      } else if (token === 'thousand') {
        total += (current === 0 ? 1 : current) * 1000;
        current = 0;
        hasOnes = false;
        hasTens = false;
      } else {
        break scan;
      }

      cursor += 1;
    }

    const value = total + current;
    // `cursor` can sit on a trailing "and" we peeked at but rejected.
    let end = cursor;
    while (end > start && tokens[end - 1] === 'and') end -= 1;

    if (end > start) {
      results.push({ value, start, end });
      index = end;
    } else {
      index = start + 1;
    }
  }

  return results;
}

/** Convenience for a string that is expected to be nothing but a number. */
export function valueOf(phrase) {
  const tokens = phrase.toLowerCase().split(/[^a-z]+/i).filter(Boolean);
  const found = runs(tokens);
  if (found.length !== 1) return null;
  if (found[0].start !== 0 || found[0].end !== tokens.length) return null;
  return found[0].value;
}
