import Foundation
import SwiftData

/// A monthly spending limit for a single category.
///
/// The overall (all-categories) limit is a single number and lives in
/// `AppSettings` instead — it is not a `Budget`.
@Model
final class Budget {
    var id: UUID = UUID()

    /// Raw value of `ExpenseCategory`. One budget per category, enforced by
    /// `BudgetStore.setLimit(_:for:)` rather than by a unique constraint.
    var categoryRaw: String = ExpenseCategory.other.rawValue

    var monthlyLimit: Decimal = Decimal.zero
    var currencyCode: String = "USD"
    var updatedAt: Date = Date.now

    init(
        id: UUID = UUID(),
        category: ExpenseCategory,
        monthlyLimit: Decimal,
        currencyCode: String,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.categoryRaw = category.rawValue
        self.monthlyLimit = monthlyLimit
        self.currencyCode = currencyCode
        self.updatedAt = updatedAt
    }

    var category: ExpenseCategory {
        get { ExpenseCategory(rawValue: categoryRaw) ?? .other }
        set { categoryRaw = newValue.rawValue }
    }
}

/// A bank or card account the user connected through a `BankProvider`.
///
/// Deliberately holds no credentials: the access token stays on the sync
/// backend, and this row only keeps the opaque item id needed to ask for it.
@Model
final class LinkedAccount {
    var id: UUID = UUID()

    /// Opaque handle issued by the sync backend (Plaid item id, GoCardless
    /// requisition id, …).
    var itemID: String = ""

    var institutionName: String = ""

    /// Last four digits, when the provider gives them to us.
    var mask: String = ""

    var accountName: String = ""

    /// Provider-side pagination cursor so each sync only fetches what is new.
    var syncCursor: String?

    var lastSyncedAt: Date?
    var linkedAt: Date = Date.now

    init(
        id: UUID = UUID(),
        itemID: String,
        institutionName: String,
        mask: String = "",
        accountName: String = "",
        syncCursor: String? = nil,
        lastSyncedAt: Date? = nil,
        linkedAt: Date = .now
    ) {
        self.id = id
        self.itemID = itemID
        self.institutionName = institutionName
        self.mask = mask
        self.accountName = accountName
        self.syncCursor = syncCursor
        self.lastSyncedAt = lastSyncedAt
        self.linkedAt = linkedAt
    }

    var displayName: String {
        var parts: [String] = []
        if !institutionName.isEmpty { parts.append(institutionName) }
        if !accountName.isEmpty { parts.append(accountName) }
        let name = parts.joined(separator: " · ")
        return mask.isEmpty ? name : "\(name) ••\(mask)"
    }
}
