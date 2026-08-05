// Text helpers shared by the parser and the classifier.
//
// The Swift original leaned on Foundation's `.diacriticInsensitive` string
// search, which has no equivalent in JavaScript. The replacement here folds
// the text *without changing its length*, so an index into the folded string
// is still a valid index into the original — which is what lets the parser
// remove a matched phrase from the note afterwards.

const COMBINING_MARK = /\p{M}/gu;
const LETTER = /\p{L}/u;
const NUMBER = /\p{N}/u;
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;

export function isLetter(character) {
  return LETTER.test(character);
}

export function isDigit(character) {
  return NUMBER.test(character);
}

export function isAlphanumeric(character) {
  return isLetter(character) || isDigit(character);
}

export function isWhitespace(character) {
  return WHITESPACE.test(character);
}

export function isEdgePunctuation(character) {
  return PUNCTUATION_OR_SYMBOL.test(character);
}

/**
 * Lowercase and strip diacritics, one UTF-16 unit in, one unit out.
 *
 * "Café" folds to "cafe" with the same length, so `folded.indexOf(needle)`
 * gives an offset that can be applied straight back to the original string.
 * Anything that would change length (surrogate halves, ß, İ) is passed
 * through unchanged rather than expanded.
 */
export function fold(text) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdfff) {
      out += character;
      continue;
    }

    const stripped = character.normalize('NFD').replace(COMBINING_MARK, '').toLowerCase();
    if (stripped.length === 1) {
      out += stripped;
      continue;
    }
    const lowered = character.toLowerCase();
    out += lowered.length === 1 ? lowered : character;
  }
  return out;
}

/**
 * Case- and diacritic-insensitive search.
 * @returns {{start: number, end: number}|null} range in the *original* string.
 */
export function findPhrase(text, phrase, fromIndex = 0) {
  if (!phrase) return null;
  const index = fold(text).indexOf(fold(phrase), fromIndex);
  return index === -1 ? null : { start: index, end: index + phrase.length };
}

/** True when `range` is not sitting inside a longer word. */
export function isWholeWord(text, range) {
  if (range.start > 0 && isAlphanumeric(text[range.start - 1])) return false;
  if (range.end < text.length && isAlphanumeric(text[range.end])) return false;
  return true;
}

/**
 * Splits on whitespace and strips edge punctuation, keeping each token's
 * offsets in the original string so matches can be removed from the note.
 *
 * @returns {{text: string, raw: string, start: number, end: number}[]}
 *   `text` is folded (what matching runs against); `raw` is exactly as
 *   written, for anything shown back to the user.
 */
export function tokenize(text) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    if (isWhitespace(text[index])) {
      index += 1;
      continue;
    }

    let end = index;
    while (end < text.length && !isWhitespace(text[end])) end += 1;

    let start = index;
    let trimmedEnd = end;
    while (start < trimmedEnd && isEdgePunctuation(text[start])) start += 1;
    while (trimmedEnd > start && isEdgePunctuation(text[trimmedEnd - 1])) trimmedEnd -= 1;

    if (start < trimmedEnd) {
      const raw = text.slice(start, trimmedEnd);
      tokens.push({ text: fold(raw), raw, start, end: trimmedEnd });
    }

    index = end;
  }

  return tokens;
}

/** Capitalises the first character, leaving the rest alone. */
export function capitalizeFirst(text) {
  if (!text) return text;
  return text[0].toUpperCase() + text.slice(1);
}
