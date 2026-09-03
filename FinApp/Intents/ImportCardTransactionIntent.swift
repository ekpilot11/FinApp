import AppIntents
import Foundation
import SwiftData

/// The Apple Pay bridge.
///
/// iOS gives no app access to Wallet's transaction history — there is no
/// PassKit API for reading what you spent, and there is no way around that.
/// What iOS *does* give you is a personal automation that fires on a
/// **Transaction** (Apple Card, Apple Cash, or any card in Wallet used with
/// Apple Pay). That automation can call this action and hand it the amount and
/// merchant, which is as close to an automatic Wallet feed as the platform
/// allows.
///
/// Set-up lives in `docs/APPLE_WALLET.md`; `SettingsView` links to it.
struct ImportCardTransactionIntent: AppIntent {

    static var title: LocalizedStringResource = "Log a card transaction"

    static var description = IntentDescription(
        "Records a card purchase in FinApp. Designed to be called from a Shortcuts \"Transaction\" automation so Apple Pay purchases log themselves.",
        categoryName: "Automation"
    )

    /// Automations must never steal focus — this one runs silently in the
    /// background the instant a card is tapped.
    static var openAppWhenRun = false

    @Parameter(title: "Amount")
    var amount: Double

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Date")
    var date: Date?

    @Parameter(title: "Currency code")
    var currencyCode: String?

    @Parameter(
        title: "Transaction ID",
        description: "Optional. If your automation can supply a stable id, FinApp uses it to avoid logging the same purchase twice."
    )
    var transactionID: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log card transaction of \(\.$amount) at \(\.$merchant)") {
            \.$date
            \.$currencyCode
            \.$transactionID
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let settings = AppSettings.shared
        let merchantName = merchant?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let when = date ?? .now
        let currency = IntentSupport.currencyCode(currencyCode, default: settings.currencyCode)
        let value = IntentSupport.decimal(from: amount)

        let expense = Expense(
            amount: value,
            currencyCode: currency,
            merchant: merchantName,
            note: "",
            date: when,
            category: CategoryClassifier.classify(text: merchantName, merchant: merchantName),
            source: .cardAutomation,
            externalID: transactionID?.isEmpty == false
                ? transactionID
                : Self.fingerprint(amount: value, merchant: merchantName, date: when)
        )

        let context = AppContainer.newContext()
        try ExpenseStore.insert(expense, into: context)

        return .result()
    }

    /// A synthetic id for automations that cannot supply a real one.
    ///
    /// Deliberately day-granular: if the same automation fires twice for one
    /// tap — which happens — both attempts produce the same fingerprint and the
    /// second is merged away. Two genuinely separate identical purchases at the
    /// same merchant on the same day will also collapse, which is the right
    /// trade: an undercount the user can correct beats a silent double-count
    /// they will not notice.
    static func fingerprint(amount: Decimal, merchant: String, date: Date) -> String {
        let day = ISO8601DateFormatter.fingerprintDay.string(from: date)
        let normalizedMerchant = CategoryClassifier.normalize(merchant)
            .replacingOccurrences(of: " ", with: "-")
        return "applepay:\(amount):\(normalizedMerchant):\(day)"
    }
}

private extension ISO8601DateFormatter {
    static let fingerprintDay: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = .current
        return formatter
    }()
}
