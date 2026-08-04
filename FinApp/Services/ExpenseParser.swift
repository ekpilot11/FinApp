import Foundation

/// The result of reading one spoken (or typed) sentence.
///
/// Every field has a usable value even when parsing goes badly — `amount` is
/// the only optional, because an expense without a number is the one thing the
/// app cannot invent. The UI shows this as an editable draft, never as a
/// finished entry, so a wrong guess costs a tap rather than a bad record.
struct ParsedExpense: Equatable {
    var amount: Decimal?
    var currencyCode: String
    var merchant: String?
    var category: ExpenseCategory
    var date: Date
    var note: String
    var isRefund: Bool

    /// True when the sentence actually said when it happened. When false,
    /// `date` is just "now".
    var dateWasExplicit: Bool

    /// 0...1. Below `ExpenseParser.reviewThreshold` the UI opens the editor
    /// instead of offering one-tap save.
    var confidence: Double

    /// Exactly what was heard, kept on the saved row for debugging bad parses.
    var transcript: String

    var isUsable: Bool { amount != nil }

    /// The amount as it should be stored: refunds are negative.
    var signedAmount: Decimal? {
        guard let amount else { return nil }
        return isRefund ? -amount : amount
    }
}

/// Reads sentences like "spent twelve fifty on coffee at Starbucks yesterday"
/// and turns them into a draft expense.
///
/// Entirely offline and deterministic — no network, no model, nothing that
/// needs an API key. That keeps voice logging fast (the whole point) and keeps
/// purchase history on the device.
enum ExpenseParser {

    /// Parses below this confidence open the edit sheet instead of saving.
    static let reviewThreshold = 0.6

    // MARK: - Entry point

    static func parse(
        _ rawText: String,
        referenceDate: Date = .now,
        defaultCurrency: String = "USD",
        calendar: Calendar = .autoupdatingCurrent
    ) -> ParsedExpense {
        let transcript = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        var consumed: [Range<String.Index>] = []

        let isRefund = detectRefund(in: transcript)

        let amountMatch = extractAmount(from: transcript, defaultCurrency: defaultCurrency)
        if let range = amountMatch?.range { consumed.append(range) }

        let dateMatch = extractDate(from: transcript, referenceDate: referenceDate, calendar: calendar)
        if let range = dateMatch?.range { consumed.append(range) }

        let merchantMatch = extractMerchant(from: transcript)
        if let range = merchantMatch?.range { consumed.append(range) }

        let note = buildNote(from: transcript, removing: consumed)

        let category = CategoryClassifier.classify(text: transcript, merchant: merchantMatch?.name)

        var confidence = 0.0
        if let amountMatch {
            confidence += amountMatch.hadExplicitCurrency ? 0.6 : 0.5
        }
        if merchantMatch != nil { confidence += 0.15 }
        if category != .other { confidence += 0.15 }
        if dateMatch != nil { confidence += 0.1 }

        return ParsedExpense(
            amount: amountMatch?.value,
            currencyCode: amountMatch?.currencyCode ?? defaultCurrency,
            merchant: merchantMatch?.name,
            category: category,
            date: dateMatch?.date ?? referenceDate,
            note: note,
            isRefund: isRefund,
            dateWasExplicit: dateMatch != nil,
            confidence: min(confidence, 1.0),
            transcript: transcript
        )
    }

    // MARK: - Refunds

    private static let refundPhrases = [
        "refund", "refunded", "returned", "got back", "gave me back",
        "reimbursed", "cash back", "chargeback"
    ]

    private static func detectRefund(in text: String) -> Bool {
        refundPhrases.contains { text.range(of: $0, options: searchOptions) != nil }
    }

    // MARK: - Amount

    struct AmountMatch: Equatable {
        var value: Decimal
        var currencyCode: String
        var hadExplicitCurrency: Bool
        var range: Range<String.Index>
    }

    /// Symbols that pin down a currency on their own.
    private static let symbolCurrencies: [(symbol: String, code: String?)] = [
        ("R$", "BRL"), ("€", "EUR"), ("£", "GBP"), ("¥", "JPY"), ("₹", "INR"),
        ("₽", "RUB"), ("₩", "KRW"), ("₺", "TRY"),
        // Bare "$" is whatever the user's own currency is — nil means "default".
        ("$", nil)
    ]

    /// Spoken currency names and codes.
    private static let currencyWords: [String: String] = [
        "dollar": "USD", "dollars": "USD", "buck": "USD", "bucks": "USD", "usd": "USD",
        "euro": "EUR", "euros": "EUR", "eur": "EUR",
        "pound": "GBP", "pounds": "GBP", "quid": "GBP", "gbp": "GBP",
        "real": "BRL", "reais": "BRL", "reals": "BRL", "brl": "BRL",
        "yen": "JPY", "jpy": "JPY",
        "rupee": "INR", "rupees": "INR", "inr": "INR",
        "peso": "MXN", "pesos": "MXN",
        "franc": "CHF", "francs": "CHF", "chf": "CHF",
        "krona": "SEK", "kronor": "SEK",
        "zloty": "PLN", "cad": "CAD", "aud": "AUD", "nzd": "NZD"
    ]

    /// Words that mean a nearby number is not money.
    private static let nonMoneyFollowers: Set<String> = [
        "days", "day", "weeks", "week", "months", "month", "years", "year",
        "hours", "hour", "minutes", "minute", "people", "person", "percent",
        "am", "pm", "oclock", "o'clock", "times", "kg", "lbs", "pounds"
    ]

    private static let digitAmountPattern = try? NSRegularExpression(
        pattern: #"(R\$|[$€£¥₹₽₩₺])?\s*(\d[\d.,]*)\s*(dollars?|bucks?|euros?|pounds?|quid|reais|reals?|rupees|yen|pesos?|francs?|usd|eur|gbp|brl|jpy|inr|mxn|chf|cad|aud|nzd|sek|pln)?"#,
        options: [.caseInsensitive]
    )

    static func extractAmount(from text: String, defaultCurrency: String) -> AmountMatch? {
        // "12 dollars and 50 cents" must be read as one amount before the
        // general digit scan gets a chance to return just the 12.
        if let split = extractDigitsAndCents(from: text, defaultCurrency: defaultCurrency) {
            return split
        }
        if let digits = extractDigitAmount(from: text, defaultCurrency: defaultCurrency) {
            return digits
        }
        return extractSpelledAmount(from: text, defaultCurrency: defaultCurrency)
    }

    private static let digitsAndCentsPattern = try? NSRegularExpression(
        pattern: #"(R\$|[$€£¥₹₽₩₺])?\s*(\d+)\s*(dollars?|bucks?|euros?|pounds?|reais|reals?)?\s*(?:and\s+)?(\d{1,2})\s*(?:cents?|centavos|pence)"#,
        options: [.caseInsensitive]
    )

    private static func extractDigitsAndCents(from text: String, defaultCurrency: String) -> AmountMatch? {
        guard let regex = digitsAndCentsPattern else { return nil }
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, options: [], range: NSRange(location: 0, length: ns.length)),
              let fullRange = Range(match.range(at: 0), in: text),
              let wholeRange = Range(match.range(at: 2), in: text),
              let centsRange = Range(match.range(at: 4), in: text),
              let whole = Int(text[wholeRange]),
              let cents = Int(text[centsRange]) else { return nil }

        var code = defaultCurrency

        if let symbolRange = Range(match.range(at: 1), in: text) {
            let symbol = String(text[symbolRange])
            if let entry = symbolCurrencies.first(where: {
                $0.symbol.compare(symbol, options: .caseInsensitive) == .orderedSame
            }) {
                code = entry.code ?? defaultCurrency
            }
        }
        if let unitRange = Range(match.range(at: 3), in: text),
           let mapped = currencyWords[String(text[unitRange]).lowercased()] {
            code = mapped
        }

        return AmountMatch(
            value: Decimal(whole) + Decimal(cents) / 100,
            currencyCode: code,
            // Saying "cents" is itself an explicit statement about money.
            hadExplicitCurrency: true,
            range: fullRange
        )
    }

    private static func extractDigitAmount(from text: String, defaultCurrency: String) -> AmountMatch? {
        guard let regex = digitAmountPattern else { return nil }
        let ns = text as NSString
        let matches = regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length))

        var best: (match: AmountMatch, score: Int)?

        for match in matches {
            guard let numberRange = Range(match.range(at: 2), in: text) else { continue }
            let numberText = String(text[numberRange])
            guard let value = decimalValue(fromDigits: numberText) else { continue }

            let symbol = Range(match.range(at: 1), in: text).map { String(text[$0]) }
            let unit = Range(match.range(at: 3), in: text).map { String(text[$0]).lowercased() }

            // "on the 5th", "3 days ago", "at 7 pm" are not amounts.
            if isOrdinal(at: numberRange.upperBound, in: text) { continue }
            if let next = nextWord(after: match.range(at: 0), in: text),
               unit == nil,
               nonMoneyFollowers.contains(next.lowercased()) { continue }

            var code = defaultCurrency
            var explicit = false

            if let symbol, !symbol.isEmpty {
                let normalizedSymbol = symbol.trimmingCharacters(in: .whitespaces)
                if let entry = symbolCurrencies.first(where: {
                    $0.symbol.compare(normalizedSymbol, options: .caseInsensitive) == .orderedSame
                }) {
                    code = entry.code ?? defaultCurrency
                    explicit = true
                }
            }
            if let unit, let mapped = currencyWords[unit] {
                code = mapped
                explicit = true
            }

            let score = explicit ? 3 : (hasSpendVerbNearby(match.range(at: 0), in: text) ? 2 : 1)
            let candidate = AmountMatch(
                value: value,
                currencyCode: code,
                hadExplicitCurrency: explicit,
                range: Range(match.range(at: 0), in: text) ?? numberRange
            )

            if best == nil || score > best!.score {
                best = (candidate, score)
            }
        }

        return best?.match
    }

    /// "twelve fifty", "twenty bucks", "one hundred and five euros".
    private static func extractSpelledAmount(from text: String, defaultCurrency: String) -> AmountMatch? {
        let tokens = tokenize(text)
        let words = tokens.map { $0.text }
        let runs = SpelledNumber.runs(in: words)
        guard !runs.isEmpty else { return nil }

        // Currency word anywhere in the sentence, e.g. "twelve fifty in euros".
        var code = defaultCurrency
        var explicit = false
        for word in words {
            if let mapped = currencyWords[word] {
                code = mapped
                explicit = true
                break
            }
        }

        /// Tokens allowed to sit between the dollars part and the cents part.
        let bridge = Set(["and", "point", "dot"]).union(currencyWords.keys)

        func makeMatch(_ value: Decimal, _ start: Int, _ end: Int) -> AmountMatch {
            AmountMatch(
                value: value,
                currencyCode: code,
                hadExplicitCurrency: explicit,
                range: tokens[start].range.lowerBound..<tokens[end - 1].range.upperBound
            )
        }

        // Dollars-and-cents: two runs separated only by bridge words.
        for index in runs.indices.dropLast() {
            let first = runs[index]
            let second = runs[index + 1]
            let between = words[first.range.upperBound..<second.range.lowerBound]
            guard between.allSatisfy({ bridge.contains($0) }) else { continue }
            guard second.value >= 1, second.value <= 99, first.value <= 9999 else { continue }

            let usesPoint = between.contains("point") || between.contains("dot")
            // "twelve point five" is 12.50, not 12.05.
            let cents = usesPoint && second.value < 10 ? second.value * 10 : second.value

            var end = second.range.upperBound
            if end < words.count, ["cents", "cent", "centavos", "pence", "p"].contains(words[end]) {
                end += 1
            }

            let value = Decimal(first.value) + Decimal(cents) / 100
            return makeMatch(value, first.range.lowerBound, end)
        }

        // Otherwise the run that sits next to a currency word, else the first.
        let chosen = runs.first { run in
            let after = run.range.upperBound
            return after < words.count && currencyWords[words[after]] != nil
        } ?? runs[0]

        var end = chosen.range.upperBound
        if end < words.count, currencyWords[words[end]] != nil { end += 1 }

        return makeMatch(Decimal(chosen.value), chosen.range.lowerBound, end)
    }

    /// Reads "1,250.75" / "1.250,75" / "12,50" / "12.50" without guessing wrong.
    static func decimalValue(fromDigits raw: String) -> Decimal? {
        var text = raw.trimmingCharacters(in: CharacterSet(charactersIn: ".,"))
        guard !text.isEmpty else { return nil }

        let lastDot = text.lastIndex(of: ".")
        let lastComma = text.lastIndex(of: ",")

        // Both separators present: the rightmost one is the decimal point.
        if let lastDot, let lastComma {
            let decimalSeparator: Character = lastDot > lastComma ? "." : ","
            let thousands: Character = decimalSeparator == "." ? "," : "."
            text = text.replacingOccurrences(of: String(thousands), with: "")
            text = text.replacingOccurrences(of: String(decimalSeparator), with: ".")
        } else if let separatorIndex = lastDot ?? lastComma {
            let separator = text[separatorIndex]
            let fractionDigits = text.distance(from: text.index(after: separatorIndex), to: text.endIndex)
            let occurrences = text.filter { $0 == separator }.count
            // "1.250" and "1,250" are thousands; "12.5" and "12,50" are decimals.
            if fractionDigits == 3 || occurrences > 1 {
                text = text.replacingOccurrences(of: String(separator), with: "")
            } else {
                text = text.replacingOccurrences(of: String(separator), with: ".")
            }
        }

        guard text.allSatisfy({ $0.isNumber || $0 == "." }) else { return nil }
        return Decimal(string: text, locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func isOrdinal(at index: String.Index, in text: String) -> Bool {
        guard index < text.endIndex else { return false }
        let remainder = text[index...].prefix(2).lowercased()
        return ["st", "nd", "rd", "th"].contains(remainder)
    }

    private static func nextWord(after range: NSRange, in text: String) -> String? {
        guard let end = Range(range, in: text)?.upperBound else { return nil }
        let rest = text[end...].drop(while: { $0.isWhitespace })
        let word = rest.prefix(while: { $0.isLetter || $0 == "'" })
        return word.isEmpty ? nil : String(word)
    }

    private static let spendVerbs = ["spent", "paid", "cost", "costs", "bought", "charged", "spend"]

    private static func hasSpendVerbNearby(_ range: NSRange, in text: String) -> Bool {
        guard let start = Range(range, in: text)?.lowerBound else { return false }
        let prefix = text[..<start].suffix(24)
        return spendVerbs.contains { prefix.range(of: $0, options: searchOptions) != nil }
    }

    // MARK: - Date

    struct DateMatch: Equatable {
        var date: Date
        var range: Range<String.Index>
    }

    private static let weekdayNames: [(name: String, index: Int)] = [
        ("sunday", 1), ("monday", 2), ("tuesday", 3), ("wednesday", 4),
        ("thursday", 5), ("friday", 6), ("saturday", 7)
    ]

    private static let monthNames: [(name: String, index: Int)] = [
        ("january", 1), ("jan", 1), ("february", 2), ("feb", 2), ("march", 3), ("mar", 3),
        ("april", 4), ("apr", 4), ("may", 5), ("june", 6), ("jun", 6), ("july", 7), ("jul", 7),
        ("august", 8), ("aug", 8), ("september", 9), ("sep", 9), ("sept", 9),
        ("october", 10), ("oct", 10), ("november", 11), ("nov", 11), ("december", 12), ("dec", 12)
    ]

    static func extractDate(
        from text: String,
        referenceDate: Date,
        calendar: Calendar
    ) -> DateMatch? {
        // Longest phrases first so "day before yesterday" beats "yesterday".
        let relativePhrases: [(phrase: String, days: Int)] = [
            ("day before yesterday", -2), ("the other day", -2),
            ("last night", -1), ("yesterday", -1),
            ("this morning", 0), ("this afternoon", 0), ("this evening", 0),
            ("tonight", 0), ("today", 0), ("just now", 0),
            ("last week", -7), ("a week ago", -7)
        ]

        for (phrase, days) in relativePhrases {
            if let range = text.range(of: phrase, options: searchOptions) {
                let date = calendar.date(byAdding: .day, value: days, to: referenceDate) ?? referenceDate
                return DateMatch(date: preserveTime(date, days: days, reference: referenceDate, calendar: calendar),
                                 range: range)
            }
        }

        if let match = extractNDaysAgo(from: text, referenceDate: referenceDate, calendar: calendar) {
            return match
        }
        if let match = extractWeekday(from: text, referenceDate: referenceDate, calendar: calendar) {
            return match
        }
        if let match = extractCalendarDate(from: text, referenceDate: referenceDate, calendar: calendar) {
            return match
        }

        return nil
    }

    /// Past dates land at midday so a later time-zone shift cannot slide them
    /// onto the wrong day; "today" keeps the real clock time.
    private static func preserveTime(_ date: Date, days: Int, reference: Date, calendar: Calendar) -> Date {
        guard days != 0 else { return reference }
        return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: date) ?? date
    }

    /// Vague quantities people actually say.
    private static let approximateCounts: [String: Int] = [
        "a": 1, "an": 1, "couple": 2, "few": 3, "several": 4
    ]

    /// Alternation of every word that can begin a count, longest first so the
    /// engine prefers "seventeen" over "seven".
    private static let countWordAlternation: String = {
        let words = Set(SpelledNumber.units.keys)
            .union(SpelledNumber.tens.keys)
            .union(["hundred", "thousand"])
            .union(approximateCounts.keys)
        return words.sorted { $0.count > $1.count }.joined(separator: "|")
    }()

    /// Matching `[a-z]+` here would let an ordinary word be read as the count —
    /// "a book two weeks ago" captured "book two" and then parsed as nothing at
    /// all, silently losing the date. Only real number words are allowed.
    private static let daysAgoPattern: NSRegularExpression? = {
        let words = countWordAlternation
        let count = "(\\d+|(?:\(words))(?:\\s+(?:\(words)))*)"
        return try? NSRegularExpression(
            pattern: "\(count)\\s+(?:days?|weeks?)\\s+ago",
            options: [.caseInsensitive]
        )
    }()

    private static func extractNDaysAgo(
        from text: String,
        referenceDate: Date,
        calendar: Calendar
    ) -> DateMatch? {
        guard let regex = daysAgoPattern else { return nil }
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, options: [], range: NSRange(location: 0, length: ns.length)),
              let fullRange = Range(match.range(at: 0), in: text),
              let numberRange = Range(match.range(at: 1), in: text) else { return nil }

        let numberText = String(text[numberRange])
        guard let count = countValue(of: numberText), count > 0, count < 3650 else { return nil }

        let isWeeks = text[fullRange].range(of: "week", options: searchOptions) != nil
        let days = isWeeks ? count * 7 : count
        guard let date = calendar.date(byAdding: .day, value: -days, to: referenceDate) else { return nil }

        return DateMatch(date: preserveTime(date, days: -days, reference: referenceDate, calendar: calendar),
                         range: fullRange)
    }

    /// "3", "three", "a couple", "a few".
    private static func countValue(of text: String) -> Int? {
        let normalized = text.lowercased().trimmingCharacters(in: .whitespaces)
        if let digits = Int(normalized) { return digits }
        if let spelled = SpelledNumber.value(of: normalized) { return spelled }
        if let approximate = approximateCounts[normalized] { return approximate }

        // "a few" / "a couple" — the article carries no count of its own.
        let words = normalized.split(separator: " ").map(String.init)
        if words.count == 2, words[0] == "a" || words[0] == "an" {
            return approximateCounts[words[1]]
        }
        return nil
    }

    private static func extractWeekday(
        from text: String,
        referenceDate: Date,
        calendar: Calendar
    ) -> DateMatch? {
        for (name, weekday) in weekdayNames {
            // Prefer "last friday" so the whole phrase gets stripped from the note.
            let lastPhrase = "last \(name)"
            if let range = text.range(of: lastPhrase, options: searchOptions) {
                guard let date = mostRecent(weekday: weekday, before: referenceDate,
                                            allowToday: false, calendar: calendar) else { continue }
                return DateMatch(date: date, range: range)
            }

            if let range = text.range(of: name, options: searchOptions) {
                guard isWholeWord(range, in: text) else { continue }
                guard let date = mostRecent(weekday: weekday, before: referenceDate,
                                            allowToday: true, calendar: calendar) else { continue }

                // Include a leading "on " so the note does not keep a dangling word.
                var fullRange = range
                let onPrefix = "on "
                if let onRange = text.range(of: onPrefix, options: [.caseInsensitive, .backwards],
                                            range: text.startIndex..<range.lowerBound),
                   onRange.upperBound == range.lowerBound {
                    fullRange = onRange.lowerBound..<range.upperBound
                }
                return DateMatch(date: date, range: fullRange)
            }
        }
        return nil
    }

    private static func mostRecent(
        weekday: Int,
        before reference: Date,
        allowToday: Bool,
        calendar: Calendar
    ) -> Date? {
        let referenceWeekday = calendar.component(.weekday, from: reference)
        var delta = referenceWeekday - weekday
        if delta < 0 { delta += 7 }
        if delta == 0 && !allowToday { delta = 7 }
        if delta == 0 { return reference }
        guard let date = calendar.date(byAdding: .day, value: -delta, to: reference) else { return nil }
        return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: date) ?? date
    }

    private static let calendarDatePattern = try? NSRegularExpression(
        pattern: #"(?:on\s+)?(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)|([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)"#,
        options: [.caseInsensitive]
    )

    private static func extractCalendarDate(
        from text: String,
        referenceDate: Date,
        calendar: Calendar
    ) -> DateMatch? {
        guard let regex = calendarDatePattern else { return nil }
        let ns = text as NSString

        for match in regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            var monthText: String?
            var dayText: String?

            if let dayRange = Range(match.range(at: 1), in: text),
               let monthRange = Range(match.range(at: 2), in: text) {
                dayText = String(text[dayRange])
                monthText = String(text[monthRange])
            } else if let monthRange = Range(match.range(at: 3), in: text),
                      let dayRange = Range(match.range(at: 4), in: text) {
                monthText = String(text[monthRange])
                dayText = String(text[dayRange])
            }

            guard let monthText, let dayText,
                  let day = Int(dayText), (1...31).contains(day),
                  let month = monthNames.first(where: {
                      $0.name.compare(monthText, options: .caseInsensitive) == .orderedSame
                  })?.index,
                  let fullRange = Range(match.range(at: 0), in: text) else { continue }

            var components = calendar.dateComponents([.year], from: referenceDate)
            components.month = month
            components.day = day
            components.hour = 12

            guard var date = calendar.date(from: components) else { continue }
            // A date later than today almost always means last year.
            if date > referenceDate, let previous = calendar.date(byAdding: .year, value: -1, to: date) {
                date = previous
            }
            return DateMatch(date: date, range: fullRange)
        }

        return nil
    }

    // MARK: - Merchant

    struct MerchantMatch: Equatable {
        var name: String
        var range: Range<String.Index>
    }

    private static let merchantStopWords: Set<String> = [
        "on", "for", "yesterday", "today", "tonight", "last", "this", "with",
        "using", "and", "because", "to", "about", "around", "it", "that", "was",
        "morning", "afternoon", "evening", "night", "just", "the", "a", "an",
        "cash", "card", "credit", "debit"
    ]

    private static let merchantMarkers: Set<String> = ["at", "from"]

    static func extractMerchant(from text: String) -> MerchantMatch? {
        let tokens = tokenize(text)
        let words = tokens.map(\.text)

        for (markerIndex, word) in words.enumerated() where merchantMarkers.contains(word) {
            var cursor = markerIndex + 1
            // "at the corner store" — the article is not part of the name.
            if cursor < words.count, words[cursor] == "the" { cursor += 1 }

            var kept: [String] = []
            var lastIndex = markerIndex

            while cursor < words.count, kept.count < 4 {
                let candidate = words[cursor]
                if merchantStopWords.contains(candidate) { break }
                if SpelledNumber.isNumberWord(candidate) { break }
                if candidate.first?.isNumber == true { break }
                kept.append(displayName(for: tokens[cursor]))
                lastIndex = cursor
                cursor += 1
            }

            guard !kept.isEmpty else { continue }
            return MerchantMatch(
                name: kept.joined(separator: " "),
                range: tokens[markerIndex].range.lowerBound..<tokens[lastIndex].range.upperBound
            )
        }
        return nil
    }

    /// Keeps the speaker's own capitalization when they had some ("McDonald's"
    /// from keyboard input), and title-cases what dictation lowercased.
    private static func displayName(for token: Token) -> String {
        let raw = token.raw
        if raw.contains(where: { $0.isUppercase }) { return raw }
        guard let first = raw.first else { return raw }
        return String(first).uppercased() + raw.dropFirst()
    }

    // MARK: - Note

    private static let leadingFiller: Set<String> = [
        "i", "just", "spent", "paid", "pay", "log", "logged", "add", "record",
        "put", "down", "bought", "buy", "for", "on", "a", "an", "the", "of",
        "some", "my", "me", "it", "was", "cost", "costs", "charged", "there",
        "and", "please", "expense", "refund", "refunded", "got", "back"
    ]

    private static func buildNote(from text: String, removing ranges: [Range<String.Index>]) -> String {
        // Built by copying the gaps rather than by mutating, so that every
        // range stays valid against the original string.
        var pieces: [Substring] = []
        var cursor = text.startIndex

        for range in ranges.sorted(by: { $0.lowerBound < $1.lowerBound }) {
            if range.lowerBound > cursor {
                pieces.append(text[cursor..<range.lowerBound])
            }
            cursor = Swift.max(cursor, range.upperBound)
        }
        if cursor < text.endIndex {
            pieces.append(text[cursor...])
        }

        var words = pieces.joined(separator: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .map { $0.trimmingCharacters(in: CharacterSet.punctuationCharacters) }
            .filter { !$0.isEmpty }

        while let first = words.first, leadingFiller.contains(first.lowercased()) {
            words.removeFirst()
        }
        while let last = words.last, leadingFiller.contains(last.lowercased()) {
            words.removeLast()
        }

        let note = words.joined(separator: " ")
        guard let first = note.first else { return "" }
        return String(first).uppercased() + note.dropFirst()
    }

    // MARK: - Shared helpers

    private static let searchOptions: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

    struct Token {
        /// Lowercased, diacritic-folded — what matching runs against.
        var text: String
        /// Exactly as written, for anything shown back to the user.
        var raw: String
        var range: Range<String.Index>
    }

    /// Splits on whitespace and strips edge punctuation, keeping each token's
    /// range in the original string so matches can be removed from the note.
    static func tokenize(_ text: String) -> [Token] {
        var tokens: [Token] = []
        var index = text.startIndex

        while index < text.endIndex {
            guard !text[index].isWhitespace else {
                index = text.index(after: index)
                continue
            }
            var end = index
            while end < text.endIndex, !text[end].isWhitespace {
                end = text.index(after: end)
            }

            var start = index
            var trimmedEnd = end
            while start < trimmedEnd, isEdgePunctuation(text[start]) {
                start = text.index(after: start)
            }
            while trimmedEnd > start, isEdgePunctuation(text[text.index(before: trimmedEnd)]) {
                trimmedEnd = text.index(before: trimmedEnd)
            }

            if start < trimmedEnd {
                let raw = String(text[start..<trimmedEnd])
                let clean = raw.folding(options: [.diacriticInsensitive, .caseInsensitive],
                                        locale: Locale(identifier: "en_US"))
                tokens.append(Token(text: clean, raw: raw, range: start..<trimmedEnd))
            }

            index = end
        }

        return tokens
    }

    private static func isEdgePunctuation(_ character: Character) -> Bool {
        character.isPunctuation || character.isSymbol
    }

    private static func isWholeWord(_ range: Range<String.Index>, in text: String) -> Bool {
        if range.lowerBound > text.startIndex {
            let before = text[text.index(before: range.lowerBound)]
            if before.isLetter || before.isNumber { return false }
        }
        if range.upperBound < text.endIndex {
            let after = text[range.upperBound]
            if after.isLetter || after.isNumber { return false }
        }
        return true
    }
}
