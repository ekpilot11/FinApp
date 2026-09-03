import Foundation

/// Editable form state for one expense.
///
/// Shared by the voice review sheet and the manual editor so both surfaces
/// validate identically — the amount field in particular, which has to accept
/// whatever a keyboard in any locale produces.
struct ExpenseDraft {
    var amountText: String = ""
    var merchant: String = ""
    var note: String = ""
    var category: ExpenseCategory = .other
    var date: Date = .now
    var currencyCode: String
    var isRefund: Bool = false
    var transcript: String?
    var source: ExpenseSource = .manual

    init(currencyCode: String) {
        self.currencyCode = currencyCode
    }

    init(parsed: ParsedExpense) {
        self.currencyCode = parsed.currencyCode
        self.amountText = parsed.amount.map { ExpenseDraft.format($0) } ?? ""
        self.merchant = parsed.merchant ?? ""
        self.note = parsed.note
        self.category = parsed.category
        self.date = parsed.date
        self.isRefund = parsed.isRefund
        self.transcript = parsed.transcript
        self.source = .voice
    }

    init(expense: Expense) {
        self.currencyCode = expense.currencyCode
        self.amountText = ExpenseDraft.format(abs(expense.amount))
        self.merchant = expense.merchant
        self.note = expense.note
        self.category = expense.category
        self.date = expense.date
        self.isRefund = expense.amount < 0
        self.transcript = expense.transcript
        self.source = expense.source
    }

    /// Parsed magnitude, or nil when the field is empty or nonsense.
    var amount: Decimal? {
        let trimmed = amountText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        guard let value = ExpenseParser.decimalValue(fromDigits: trimmed), value > 0 else { return nil }
        return value
    }

    /// The value to store: refunds are negative.
    var signedAmount: Decimal? {
        guard let amount else { return nil }
        return isRefund ? -amount : amount
    }

    var isValid: Bool { signedAmount != nil }

    func makeExpense() -> Expense? {
        guard let signedAmount else { return nil }
        return Expense(
            amount: signedAmount,
            currencyCode: currencyCode,
            merchant: merchant.trimmingCharacters(in: .whitespacesAndNewlines),
            note: note.trimmingCharacters(in: .whitespacesAndNewlines),
            date: date,
            category: category,
            source: source,
            transcript: transcript
        )
    }

    /// Writes the draft back onto an existing row.
    func apply(to expense: Expense) {
        guard let signedAmount else { return }
        expense.amount = signedAmount
        expense.currencyCode = currencyCode
        expense.merchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
        expense.note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        expense.date = date
        expense.category = category
        // Editing a row is the user vouching for it.
        expense.isReviewed = true
    }

    /// Re-runs the category guess unless the user already picked one.
    mutating func reclassifyIfNeeded() {
        guard category == .other else { return }
        category = CategoryClassifier.classify(text: note, merchant: merchant)
    }

    private static func format(_ value: Decimal) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }
}
