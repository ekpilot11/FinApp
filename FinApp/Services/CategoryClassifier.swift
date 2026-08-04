import Foundation

/// Guesses a category from free text.
///
/// Used by both the voice parser (whole spoken sentence) and the bank importer
/// (merchant name plus whatever description the provider gives us), so it has
/// to cope with "grabbed a latte at the place downstairs" and with
/// "SQ *BLUE BOTTLE 4471 OAKLAND CA" alike.
enum CategoryClassifier {

    /// Merchants specific enough to beat any keyword match.
    ///
    /// Matched on word boundaries against normalized text, so a brand name that
    /// happens to be an English word cannot fire from inside a longer one. A
    /// brand whose name is a *whole* common word still has to be left out —
    /// see the notes below.
    private static let brands: [(needle: String, category: ExpenseCategory)] = [
        // Coffee
        ("starbucks", .coffee), ("blue bottle", .coffee), ("dunkin", .coffee),
        ("costa coffee", .coffee), ("peet", .coffee), ("tim hortons", .coffee),
        ("caribou coffee", .coffee), ("pret a manger", .coffee),

        // Dining
        ("mcdonald", .diningOut), ("burger king", .diningOut), ("kfc", .diningOut),
        ("subway sandwich", .diningOut), ("chipotle", .diningOut), ("taco bell", .diningOut),
        ("wendy", .diningOut), ("domino", .diningOut), ("pizza hut", .diningOut),
        ("papa john", .diningOut), ("five guys", .diningOut), ("shake shack", .diningOut),
        ("doordash", .diningOut), ("grubhub", .diningOut), ("ubereats", .diningOut),
        ("uber eats", .diningOut), ("deliveroo", .diningOut), ("just eat", .diningOut),
        ("ifood", .diningOut), ("nando", .diningOut), ("panera", .diningOut),

        // Groceries
        ("whole foods", .groceries), ("trader joe", .groceries), ("safeway", .groceries),
        ("kroger", .groceries), ("aldi", .groceries), ("lidl", .groceries),
        ("tesco", .groceries), ("sainsbury", .groceries), ("carrefour", .groceries),
        ("walmart", .groceries), ("costco", .groceries), ("publix", .groceries),
        ("wegmans", .groceries), ("mercadona", .groceries), ("pao de acucar", .groceries),
        ("instacart", .groceries),

        // Transport
        ("uber", .transport), ("lyft", .transport), ("bolt", .transport),
        ("cabify", .transport), ("99 taxi", .transport), ("citi bike", .transport),
        // No "grab", "lime" or "bird". Each is a whole common word — "grab a
        // coffee", "bought limes" — and because brands outrank every keyword,
        // a false match here cannot be recovered from.
        ("mta", .transport), ("tfl", .transport), ("bart", .transport),
        ("amtrak", .transport), ("trainline", .transport), ("sixt", .transport),

        // Fuel
        ("shell", .fuel), ("chevron", .fuel), ("exxon", .fuel), ("mobil", .fuel),
        ("bp", .fuel), ("texaco", .fuel), ("petrobras", .fuel), ("ipiranga", .fuel),
        ("repsol", .fuel), ("electrify america", .fuel), ("chargepoint", .fuel),
        ("supercharger", .fuel),

        // Subscriptions
        ("netflix", .subscriptions), ("spotify", .subscriptions), ("hulu", .subscriptions),
        ("disney+", .subscriptions), ("disney plus", .subscriptions),
        ("apple.com/bill", .subscriptions), ("icloud", .subscriptions),
        ("youtube premium", .subscriptions), ("hbo", .subscriptions),
        ("audible", .subscriptions), ("patreon", .subscriptions),
        ("openai", .subscriptions), ("anthropic", .subscriptions),
        ("adobe", .subscriptions), ("dropbox", .subscriptions),

        // Shopping
        ("amazon", .shopping), ("ebay", .shopping), ("etsy", .shopping),
        ("aliexpress", .shopping), ("shein", .shopping), ("zara", .shopping),
        ("h&m", .shopping), ("uniqlo", .shopping), ("nike", .shopping),
        ("adidas", .shopping), ("best buy", .shopping), ("target", .shopping),
        ("apple store", .shopping),

        // Health
        // No "boots": the UK pharmacy is region-specific, footwear is not.
        ("cvs", .health), ("walgreens", .health),
        ("rite aid", .health), ("droga raia", .health), ("drogasil", .health),

        // Home
        ("ikea", .home), ("home depot", .home), ("lowe", .home), ("b&q", .home),
        ("leroy merlin", .home),

        // Travel
        ("airbnb", .travel), ("booking.com", .travel), ("expedia", .travel),
        ("hotels.com", .travel), ("marriott", .travel), ("hilton", .travel),
        ("delta air", .travel), ("united airlines", .travel), ("american airlines", .travel),
        ("ryanair", .travel), ("easyjet", .travel), ("lufthansa", .travel),
        ("latam", .travel), ("gol linhas", .travel),

        // Entertainment
        ("steam", .entertainment), ("playstation", .entertainment),
        ("xbox", .entertainment), ("nintendo", .entertainment),
        ("amc theatre", .entertainment), ("amc theater", .entertainment),
        ("cinemark", .entertainment), ("ticketmaster", .entertainment),

        // Bills
        ("verizon", .bills), ("at&t", .bills), ("t-mobile", .bills),
        ("vodafone", .bills), ("comcast", .bills), ("xfinity", .bills),
        ("state farm", .bills), ("geico", .bills)
    ]

    /// Keyword table flattened once, longest keyword first so that
    /// "gym membership" wins over "gym".
    private static let rankedKeywords: [(keyword: String, category: ExpenseCategory)] = {
        var pairs: [(String, ExpenseCategory)] = []
        for category in ExpenseCategory.allCases {
            for keyword in category.keywords {
                pairs.append((keyword, category))
            }
        }
        return pairs.sorted { $0.0.count > $1.0.count }
    }()

    /// Best-guess category, or `.other` when nothing matches.
    ///
    /// - Parameters:
    ///   - text: the full sentence or transaction description.
    ///   - merchant: merchant name, if it was extracted separately. Weighted
    ///     more heavily than the rest of the text.
    static func classify(text: String, merchant: String? = nil) -> ExpenseCategory {
        let haystack = normalize(text)
        let merchantHaystack = merchant.map(normalize) ?? ""

        // 1. A known brand anywhere wins outright.
        //
        // Matched on word boundaries, exactly like keywords. A plain substring
        // search reads "grabbed lunch" as the Grab ride app and "mobile phone
        // bill" as a Mobil petrol station — and because brands outrank
        // everything, that wrong answer is final.
        for (needle, category) in brands {
            if containsWord(needle, in: merchantHaystack) { return category }
        }
        for (needle, category) in brands {
            if containsWord(needle, in: haystack) { return category }
        }

        // 2. Otherwise the most specific keyword, merchant text first.
        if !merchantHaystack.isEmpty,
           let match = firstKeywordMatch(in: merchantHaystack) {
            return match
        }
        if let match = firstKeywordMatch(in: haystack) {
            return match
        }

        return .other
    }

    private static func firstKeywordMatch(in haystack: String) -> ExpenseCategory? {
        for (keyword, category) in rankedKeywords {
            if containsWord(keyword, in: haystack) { return category }
        }
        return nil
    }

    /// Substring match that respects word boundaries, so "bar" does not fire on
    /// "barber" and "gas" does not fire on "gasket".
    private static func containsWord(_ needle: String, in haystack: String) -> Bool {
        guard !needle.isEmpty else { return false }
        var searchStart = haystack.startIndex

        while searchStart < haystack.endIndex,
              let range = haystack.range(of: needle, range: searchStart..<haystack.endIndex) {
            if startsAtBoundary(range.lowerBound, in: haystack),
               endsAtBoundary(range.upperBound, in: haystack) {
                return true
            }
            searchStart = haystack.index(after: range.lowerBound)
        }

        return false
    }

    private static func startsAtBoundary(_ index: String.Index, in haystack: String) -> Bool {
        guard index > haystack.startIndex else { return true }
        let previous = haystack[haystack.index(before: index)]
        return !previous.isLetter && !previous.isNumber
    }

    /// A match may run on into a plural "s" or a possessive "'s".
    ///
    /// Several brands are listed in stem form because that is what survives
    /// across spellings — "mcdonald" covers both "McDonald's" and the
    /// "MCDONALDS" a card statement prints, and "lowe" covers "Lowe's" and
    /// "LOWES". Demanding a hard boundary would break every one of them.
    ///
    /// Nothing else is allowed through, so "grab" still does not fire on
    /// "grabbed" and "mobil" still does not fire on "mobile".
    private static func endsAtBoundary(_ index: String.Index, in haystack: String) -> Bool {
        var cursor = index
        if cursor < haystack.endIndex, haystack[cursor] == "'" {
            cursor = haystack.index(after: cursor)
        }
        if cursor < haystack.endIndex, haystack[cursor] == "s" {
            cursor = haystack.index(after: cursor)
        }
        guard cursor < haystack.endIndex else { return true }
        let next = haystack[cursor]
        return !next.isLetter && !next.isNumber
    }

    /// Lowercase, strip diacritics, collapse whitespace. Statement descriptors
    /// arrive in shouty ASCII with store numbers glued on, so this also drops
    /// the `SQ *` / `TST*` style prefixes payment processors add.
    static func normalize(_ input: String) -> String {
        var text = input.folding(options: [.diacriticInsensitive, .caseInsensitive],
                                 locale: Locale(identifier: "en_US"))
        for prefix in ["sq *", "sq*", "tst*", "tst *", "sp *", "sp*", "pos ", "purchase "] {
            if text.hasPrefix(prefix) {
                text = String(text.dropFirst(prefix.count))
                break
            }
        }
        let collapsed = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
