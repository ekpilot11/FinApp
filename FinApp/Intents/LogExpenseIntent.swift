import AppIntents
import Foundation
import SwiftData

/// "Hey Siri, log an expense in FinApp."
///
/// Takes the sentence as one parameter and runs it through `ExpenseParser`, so
/// the spoken flow is a single breath — "twelve fifty on coffee at Starbucks" —
/// rather than Siri interrogating you field by field.
struct LogSpokenExpenseIntent: AppIntent {

    static var title: LocalizedStringResource = "Log a spoken expense"

    static var description = IntentDescription(
        "Say what you spent in plain language and FinApp works out the amount, merchant, category and date.",
        categoryName: "Logging",
        searchKeywords: ["expense", "spend", "purchase", "money", "log"]
    )

    /// Stays out of the app so logging from the Lock Screen or a Watch face
    /// does not yank you into a UI you did not ask for.
    static var openAppWhenRun = false

    @Parameter(
        title: "What did you spend?",
        description: "For example: twelve fifty on coffee at Starbucks",
        requestValueDialog: "What did you spend?"
    )
    var phrase: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let settings = AppSettings.shared
        let parsed = ExpenseParser.parse(phrase, defaultCurrency: settings.currencyCode)

        guard let amount = parsed.signedAmount else {
            throw AppIntentError.noAmount
        }

        let expense = Expense(
            amount: amount,
            currencyCode: parsed.currencyCode,
            merchant: parsed.merchant ?? "",
            note: parsed.note,
            date: parsed.date,
            category: parsed.category,
            source: .voice,
            transcript: parsed.transcript
        )

        let context = AppContainer.newContext()
        try ExpenseStore.insert(expense, into: context)

        return .result(dialog: IntentDialog(stringLiteral: Self.confirmation(for: expense)))
    }

    static func confirmation(for expense: Expense) -> String {
        let amount = expense.formattedAmount
        if expense.merchant.isEmpty {
            return "Logged \(amount) under \(expense.category.displayName)."
        }
        return "Logged \(amount) at \(expense.merchant)."
    }
}

/// The structured version, for Shortcuts users who want to build their own flow.
struct LogExpenseIntent: AppIntent {

    static var title: LocalizedStringResource = "Log an expense"

    static var description = IntentDescription(
        "Adds a purchase to FinApp with an exact amount and category.",
        categoryName: "Logging"
    )

    static var openAppWhenRun = false

    @Parameter(title: "Amount", requestValueDialog: "How much did you spend?")
    var amount: Double

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Category")
    var category: ExpenseCategory?

    @Parameter(title: "Date")
    var date: Date?

    @Parameter(title: "Note")
    var note: String?

    @Parameter(title: "Currency code", description: "Three-letter code such as USD. Defaults to your FinApp currency.")
    var currencyCode: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$amount) at \(\.$merchant)") {
            \.$category
            \.$date
            \.$note
            \.$currencyCode
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let settings = AppSettings.shared
        let merchantName = merchant?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        let expense = Expense(
            amount: IntentSupport.decimal(from: amount),
            currencyCode: IntentSupport.currencyCode(currencyCode, default: settings.currencyCode),
            merchant: merchantName,
            note: note ?? "",
            date: date ?? .now,
            category: category ?? CategoryClassifier.classify(text: note ?? "", merchant: merchantName),
            source: .manual
        )

        let context = AppContainer.newContext()
        try ExpenseStore.insert(expense, into: context)

        return .result(dialog: IntentDialog(stringLiteral: LogSpokenExpenseIntent.confirmation(for: expense)))
    }
}

enum AppIntentError: Error, CustomLocalizedStringResourceConvertible {
    case noAmount
    case duplicate

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .noAmount:
            return "I couldn't hear an amount in that. Try something like \"twelve fifty on coffee\"."
        case .duplicate:
            return "That purchase is already logged."
        }
    }
}

enum IntentSupport {

    /// Converts through a fixed-point string so that a Double like 4.7499999
    /// does not become 4.7499999 in the ledger.
    static func decimal(from value: Double) -> Decimal {
        Decimal(string: String(format: "%.2f", value), locale: Locale(identifier: "en_US_POSIX"))
            ?? Decimal(value)
    }

    /// Accepts "usd", "USD", "$12" style junk and falls back when unsure.
    static func currencyCode(_ raw: String?, default fallback: String) -> String {
        guard let raw else { return fallback }
        let letters = raw.uppercased().filter { $0.isLetter }
        return letters.count == 3 ? letters : fallback
    }
}
