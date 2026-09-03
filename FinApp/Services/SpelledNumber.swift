import Foundation

/// Turns number words into numbers.
///
/// Speech recognition is inconsistent about this: "I spent twelve fifty" often
/// comes back as words while "I spent 12.50" comes back as digits, and the same
/// sentence can flip between the two mid-session. `ExpenseParser` tries digits
/// first and falls back to this.
enum SpelledNumber {

    /// A maximal span of tokens that reads as one number.
    ///
    /// `range` indexes into the token array that was passed in, so callers can
    /// tell whether two numbers were adjacent ("twelve fifty") or merely both
    /// present ("twelve euros on the fifty bus").
    struct Run: Equatable {
        var value: Int
        /// Half-open range of token indices covered by this run.
        var range: Range<Int>
    }

    static let units: [String: Int] = [
        "zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
        "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
        "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19
    ]

    static let tens: [String: Int] = [
        "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50,
        "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90
    ]

    static func isNumberWord(_ token: String) -> Bool {
        units[token] != nil || tens[token] != nil || token == "hundred" || token == "thousand"
    }

    /// Every number spelled out in `tokens`, left to right, without overlaps.
    ///
    /// Adjacent numbers are kept separate rather than being merged: "twelve
    /// fifty" yields `[12, 50]`, not `1250`, because deciding that it means
    /// $12.50 is the caller's job (it needs the currency context to be sure).
    static func runs(in tokens: [String]) -> [Run] {
        var results: [Run] = []
        var index = 0

        while index < tokens.count {
            guard isNumberWord(tokens[index]) else {
                index += 1
                continue
            }

            let start = index
            var total = 0
            var current = 0
            var hasOnes = false
            var hasTens = false
            var cursor = index

            scan: while cursor < tokens.count {
                let token = tokens[cursor]

                if token == "and" {
                    // "one hundred and twenty" — a connector only if a number
                    // word follows and we are already mid-number.
                    let next = cursor + 1
                    guard next < tokens.count,
                          isNumberWord(tokens[next]),
                          total > 0 || current > 0 else { break scan }
                    cursor += 1
                    continue
                }

                if let unit = units[token] {
                    // A second ones-place digit means a new number started.
                    if hasOnes { break scan }
                    current += unit
                    hasOnes = true
                } else if let ten = tens[token] {
                    // "twelve fifty" — tens after ones is a new number.
                    if hasTens || hasOnes { break scan }
                    current += ten
                    hasTens = true
                } else if token == "hundred" {
                    current = (current == 0 ? 1 : current) * 100
                    hasOnes = false
                    hasTens = false
                } else if token == "thousand" {
                    total += (current == 0 ? 1 : current) * 1000
                    current = 0
                    hasOnes = false
                    hasTens = false
                } else {
                    break scan
                }

                cursor += 1
            }

            let value = total + current
            // `cursor` can sit on a trailing "and" we peeked at but rejected.
            var end = cursor
            while end > start, tokens[end - 1] == "and" { end -= 1 }

            if end > start {
                results.append(Run(value: value, range: start..<end))
                index = end
            } else {
                index = start + 1
            }
        }

        return results
    }

    /// Convenience for a string that is expected to be nothing but a number.
    static func value(of phrase: String) -> Int? {
        let tokens = phrase.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init)
        let found = runs(in: tokens)
        guard found.count == 1, found[0].range == 0..<tokens.count else { return nil }
        return found[0].value
    }
}
