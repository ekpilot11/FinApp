import Foundation
import SwiftData

/// How an expense got into the database. Useful for trusting (or distrusting)
/// the category we guessed, and for showing the user where a row came from.
enum ExpenseSource: String, Codable, CaseIterable, Sendable {
    /// Typed into the form by hand.
    case manual
    /// Dictated and parsed by `ExpenseParser`.
    case voice
    /// Pushed in by the Shortcuts "Transaction" automation (Apple Pay / Apple Card).
    case cardAutomation
    /// Pulled from a linked bank or card account.
    case bankSync

    var displayName: String {
        switch self {
        case .manual: return "Manual"
        case .voice: return "Voice"
        case .cardAutomation: return "Apple Pay"
        case .bankSync: return "Bank"
        }
    }

    var symbolName: String {
        switch self {
        case .manual: return "square.and.pencil"
        case .voice: return "waveform"
        case .cardAutomation: return "creditcard.fill"
        case .bankSync: return "building.columns.fill"
        }
    }

    /// True for rows a machine produced rather than a person.
    ///
    /// Only these participate in fuzzy de-duplication: two automatic feeds
    /// describing one purchase should collapse, but two entries a person made
    /// deliberately should not, however alike they look.
    var isAutomatic: Bool {
        self == .cardAutomation || self == .bankSync
    }

    /// Automatic rows land unreviewed so the History badge can surface them.
    var arrivesUnreviewed: Bool { isAutomatic }
}

@Model
final class Expense {
    /// Stable identifier, also used to build deep links.
    var id: UUID = UUID()

    /// Positive magnitude of money spent. Refunds are stored as negative.
    var amount: Decimal = Decimal.zero

    /// ISO 4217 code, e.g. "USD". Stored per row so travel spending stays honest.
    var currencyCode: String = "USD"

    var merchant: String = ""
    var note: String = ""

    /// When the money was spent (not when the row was created).
    var date: Date = Date.now

    /// Raw value of `ExpenseCategory`. Use `category` instead of touching this.
    var categoryRaw: String = ExpenseCategory.other.rawValue

    /// Raw value of `ExpenseSource`. Use `source` instead of touching this.
    var sourceRaw: String = ExpenseSource.manual.rawValue

    /// Identifier from the upstream feed (Plaid transaction id, Shortcuts
    /// fingerprint, …). Used to avoid importing the same purchase twice.
    var externalID: String?

    /// Card or bank feeds report purchases before they settle; the amount can
    /// still change while this is true.
    var isPending: Bool = false

    /// False for automatically imported rows until the user confirms them.
    var isReviewed: Bool = true

    /// What the user actually said, kept so a bad parse can be diagnosed.
    var transcript: String?

    var createdAt: Date = Date.now

    init(
        id: UUID = UUID(),
        amount: Decimal,
        currencyCode: String,
        merchant: String = "",
        note: String = "",
        date: Date = .now,
        category: ExpenseCategory = .other,
        source: ExpenseSource = .manual,
        externalID: String? = nil,
        isPending: Bool = false,
        isReviewed: Bool? = nil,
        transcript: String? = nil,
        createdAt: Date = .now
    ) {
        self.id = id
        self.amount = amount
        self.currencyCode = currencyCode
        self.merchant = merchant
        self.note = note
        self.date = date
        self.categoryRaw = category.rawValue
        self.sourceRaw = source.rawValue
        self.externalID = externalID
        self.isPending = isPending
        self.isReviewed = isReviewed ?? !source.arrivesUnreviewed
        self.transcript = transcript
        self.createdAt = createdAt
    }

    var category: ExpenseCategory {
        get { ExpenseCategory(rawValue: categoryRaw) ?? .other }
        set { categoryRaw = newValue.rawValue }
    }

    var source: ExpenseSource {
        get { ExpenseSource(rawValue: sourceRaw) ?? .manual }
        set { sourceRaw = newValue.rawValue }
    }

    /// Merchant if we have one, otherwise the note, otherwise the category name.
    var title: String {
        if !merchant.trimmingCharacters(in: .whitespaces).isEmpty { return merchant }
        if !note.trimmingCharacters(in: .whitespaces).isEmpty { return note }
        return category.displayName
    }

    var formattedAmount: String {
        amount.formatted(.currency(code: currencyCode))
    }
}
