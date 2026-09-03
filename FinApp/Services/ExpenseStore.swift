import Foundation
import SwiftData

/// Reads and writes expenses, and keeps the same purchase from being recorded
/// twice.
///
/// Double-counting is the failure mode that matters here: a coffee bought with
/// Apple Pay can arrive from the Shortcuts automation within seconds, and again
/// from the bank feed two days later once it settles. Both describe one $4.75,
/// and a tracker that says $9.50 is worse than one that says nothing.
enum ExpenseStore {

    enum StoreError: LocalizedError {
        case duplicate

        var errorDescription: String? {
            switch self {
            case .duplicate: return "That purchase is already logged."
            }
        }
    }

    /// How far apart two records of the same purchase can be and still be
    /// recognised as one. Card networks routinely post a purchase two or three
    /// days after it happened.
    static let duplicateWindow: TimeInterval = 4 * 24 * 60 * 60

    // MARK: - Writing

    /// Inserts `expense`, merging it into an existing row when it looks like
    /// the same purchase arriving from a second source.
    ///
    /// - Returns: the row that now represents the purchase — either the newly
    ///   inserted one, or the existing one it was merged into.
    @discardableResult
    static func insert(_ expense: Expense, into context: ModelContext) throws -> Expense {
        if let existing = try findDuplicate(of: expense, in: context) {
            merge(expense, into: existing)
            try context.save()
            return existing
        }

        context.insert(expense)
        try context.save()
        return expense
    }

    /// Looks for a row already describing this purchase.
    static func findDuplicate(of expense: Expense, in context: ModelContext) throws -> Expense? {
        // Same upstream id is conclusive.
        if let externalID = expense.externalID, !externalID.isEmpty {
            var descriptor = FetchDescriptor<Expense>(
                predicate: #Predicate { $0.externalID == externalID }
            )
            descriptor.fetchLimit = 1
            if let match = try context.fetch(descriptor).first {
                return match
            }
        }

        // Otherwise: same money, near the same time, plausibly the same place.
        //
        // Restricted to automatic sources on both sides. Two entries a person
        // typed or dictated are far more likely to be two real purchases than
        // one duplicated — and silently swallowing something the user just
        // logged by hand is a much worse failure than showing them a duplicate
        // they can delete.
        guard expense.source.isAutomatic else { return nil }

        let lowerBound = expense.date.addingTimeInterval(-duplicateWindow)
        let upperBound = expense.date.addingTimeInterval(duplicateWindow)
        let descriptor = FetchDescriptor<Expense>(
            predicate: #Predicate { $0.date >= lowerBound && $0.date <= upperBound }
        )

        let candidates = try context.fetch(descriptor)
        return candidates.first { candidate in
            guard candidate.persistentModelID != expense.persistentModelID else { return false }
            guard candidate.source.isAutomatic else { return false }
            guard candidate.currencyCode == expense.currencyCode else { return false }
            guard candidate.amount == expense.amount else { return false }
            // A pending row later settles at a different amount, so an exact
            // match plus a compatible merchant is as far as we can go.
            return merchantsMatch(candidate.merchant, expense.merchant)
        }
    }

    /// True when two merchant strings plausibly name the same place.
    ///
    /// Statement descriptors are noisy ("SQ *BLUE BOTTLE 4471 OAKLAND CA" vs
    /// "Blue Bottle"), so this asks whether either name's significant words are
    /// contained in the other. An empty name matches anything, because the
    /// Shortcuts automation does not always provide one.
    static func merchantsMatch(_ lhs: String, _ rhs: String) -> Bool {
        let left = CategoryClassifier.normalize(lhs)
        let right = CategoryClassifier.normalize(rhs)
        if left.isEmpty || right.isEmpty { return true }
        if left == right { return true }

        let leftWords = significantWords(left)
        let rightWords = significantWords(right)
        guard !leftWords.isEmpty, !rightWords.isEmpty else { return false }

        return !leftWords.isDisjoint(with: rightWords)
    }

    private static func significantWords(_ text: String) -> Set<String> {
        Set(
            text.split(whereSeparator: { !$0.isLetter })
                .map(String.init)
                .filter { $0.count >= 4 }
        )
    }

    /// Folds a newly arrived record into the row already representing the purchase.
    ///
    /// The incoming row usually knows more about settlement, while the existing
    /// row usually knows more about intent (the note the user dictated), so each
    /// field is taken from whichever side is better informed.
    static func merge(_ incoming: Expense, into existing: Expense) {
        // Bank data is authoritative about money and timing.
        if incoming.source == .bankSync {
            existing.amount = incoming.amount
            existing.isPending = incoming.isPending
            existing.date = incoming.date
        }

        // Prefer the bank's id: later "modified" and "removed" events are keyed
        // by it, so a row still carrying an Apple Pay fingerprint would never be
        // found again when the purchase settles at a different amount.
        if let externalID = incoming.externalID,
           existing.externalID == nil || incoming.source == .bankSync {
            existing.externalID = externalID
        }
        if existing.merchant.isEmpty, !incoming.merchant.isEmpty {
            existing.merchant = incoming.merchant
        }
        if existing.note.isEmpty, !incoming.note.isEmpty {
            existing.note = incoming.note
        }
        // A category the user chose outranks one a feed guessed.
        if existing.category == .other, incoming.category != .other {
            existing.category = incoming.category
        }
    }

    static func delete(_ expense: Expense, from context: ModelContext) throws {
        context.delete(expense)
        try context.save()
    }

    // MARK: - Reading

    static func expenses(
        in interval: DateInterval,
        context: ModelContext
    ) throws -> [Expense] {
        let start = interval.start
        let end = interval.end
        let descriptor = FetchDescriptor<Expense>(
            predicate: #Predicate { $0.date >= start && $0.date < end },
            sortBy: [SortDescriptor(\.date, order: .reverse)]
        )
        return try context.fetch(descriptor)
    }

    static func unreviewedCount(context: ModelContext) throws -> Int {
        let descriptor = FetchDescriptor<Expense>(predicate: #Predicate { $0.isReviewed == false })
        return try context.fetchCount(descriptor)
    }

    // MARK: - Aggregation

    /// Total of `expenses`, ignoring rows in a different currency.
    ///
    /// FinApp deliberately does not convert currencies — it has no rate source
    /// it could trust offline, and a wrong total is worse than a partial one.
    static func total(of expenses: [Expense], currencyCode: String) -> Decimal {
        expenses
            .filter { $0.currencyCode == currencyCode }
            .reduce(Decimal.zero) { $0 + $1.amount }
    }

    static func totalsByCategory(
        _ expenses: [Expense],
        currencyCode: String
    ) -> [(category: ExpenseCategory, total: Decimal)] {
        var totals: [ExpenseCategory: Decimal] = [:]
        for expense in expenses where expense.currencyCode == currencyCode {
            totals[expense.category, default: .zero] += expense.amount
        }
        return totals
            .map { (category: $0.key, total: $0.value) }
            .filter { $0.total > 0 }
            .sorted { $0.total > $1.total }
    }

    static func totalsByDay(
        _ expenses: [Expense],
        in interval: DateInterval,
        currencyCode: String,
        calendar: Calendar = .autoupdatingCurrent
    ) -> [(date: Date, total: Decimal)] {
        var totals: [Date: Decimal] = [:]

        var day = calendar.startOfDay(for: interval.start)
        while day < interval.end {
            totals[day] = .zero
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }

        for expense in expenses where expense.currencyCode == currencyCode {
            let key = calendar.startOfDay(for: expense.date)
            guard totals[key] != nil else { continue }
            totals[key, default: .zero] += expense.amount
        }

        return totals
            .map { (date: $0.key, total: $0.value) }
            .sorted { $0.date < $1.date }
    }

    // MARK: - Calendar helpers

    static func monthInterval(containing date: Date, calendar: Calendar = .autoupdatingCurrent) -> DateInterval {
        calendar.dateInterval(of: .month, for: date)
            ?? DateInterval(start: calendar.startOfDay(for: date), duration: 86_400)
    }

    static func dayInterval(containing date: Date, calendar: Calendar = .autoupdatingCurrent) -> DateInterval {
        let start = calendar.startOfDay(for: date)
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        return DateInterval(start: start, end: end)
    }
}
