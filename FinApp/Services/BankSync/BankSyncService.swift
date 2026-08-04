import AuthenticationServices
import Foundation
import Observation
import SwiftData
import UIKit

/// Drives bank linking and pulls transactions into the local store.
@Observable
@MainActor
final class BankSyncService: NSObject {

    enum Phase: Equatable {
        case idle
        case linking
        case syncing
        case failed(String)
    }

    private(set) var phase: Phase = .idle

    /// Human-readable outcome of the last sync, shown under the button.
    private(set) var lastSummary: String?

    private let settings: AppSettings
    private var webAuthSession: ASWebAuthenticationSession?

    init(settings: AppSettings = .shared) {
        self.settings = settings
        super.init()
    }

    var isBusy: Bool { phase == .linking || phase == .syncing }

    private var provider: BankProvider? {
        SyncBackendProvider.configured(settings: settings)
    }

    // MARK: - Linking

    /// Opens the provider's hosted connect flow and records the account.
    func link(into context: ModelContext) async {
        guard let provider else {
            phase = .failed(BankSyncError.notConfigured.localizedDescription)
            return
        }

        phase = .linking
        do {
            let session = try await provider.startLink()
            await present(session.linkURL)

            // The redirect back into the app is best-effort — users routinely
            // dismiss the sheet themselves after finishing at the bank — so
            // completion is confirmed by asking the server, not by the callback.
            guard let result = try await pollLinkStatus(provider: provider, sessionID: session.sessionID),
                  let itemID = result.itemID else {
                phase = .failed(BankSyncError.linkFailed.localizedDescription)
                return
            }

            let institution = result.institutionName ?? "Bank"

            // A provider that reports no account detail still gives us a
            // syncable item — record one row for it rather than silently
            // linking nothing. `?? []` alone would not catch an empty array.
            var accounts = result.accounts ?? []
            if accounts.isEmpty {
                accounts = [BankAccountSummary(id: itemID, name: "", mask: nil,
                                               institutionName: institution)]
            }

            for account in accounts {
                context.insert(
                    LinkedAccount(
                        itemID: itemID,
                        institutionName: account.institutionName,
                        mask: account.mask ?? "",
                        accountName: account.name
                    )
                )
            }
            try context.save()

            phase = .idle
            await sync(into: context)
        } catch {
            phase = .failed(message(for: error))
        }
    }

    /// Polls until the bank hands control back, or ~90 seconds pass.
    private func pollLinkStatus(provider: BankProvider, sessionID: String) async throws -> BankLinkResult? {
        for _ in 0..<45 {
            let result = try await provider.linkResult(sessionID: sessionID)
            switch result.status {
            case .linked: return result
            case .failed: return nil
            case .pending: break
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
        return nil
    }

    private func present(_ url: URL) async {
        await withCheckedContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "finapp"
            ) { _, _ in
                // Both success and cancellation land here; the poll above is
                // what decides whether the link actually happened.
                continuation.resume()
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.webAuthSession = session

            if !session.start() {
                continuation.resume()
            }
        }
        webAuthSession = nil
    }

    // MARK: - Syncing

    /// Pulls new transactions for every linked account.
    func sync(into context: ModelContext) async {
        guard let provider else {
            phase = .failed(BankSyncError.notConfigured.localizedDescription)
            return
        }

        phase = .syncing
        var imported = 0
        var updated = 0
        var removed = 0

        do {
            let accounts = try context.fetch(FetchDescriptor<LinkedAccount>())
            guard !accounts.isEmpty else {
                phase = .idle
                lastSummary = "No accounts linked yet."
                return
            }

            // One item can back several accounts; sync each item once.
            var seenItems: Set<String> = []
            for account in accounts where !seenItems.contains(account.itemID) {
                seenItems.insert(account.itemID)

                var cursor = account.syncCursor
                var hasMore = true
                var pages = 0

                // Bounded so a provider that always reports `hasMore` cannot
                // spin here forever.
                while hasMore && pages < 20 {
                    let page = try await provider.sync(itemID: account.itemID, cursor: cursor)
                    pages += 1

                    for transaction in page.added {
                        if try apply(added: transaction, in: context) { imported += 1 }
                    }
                    for transaction in page.modified {
                        if try apply(modified: transaction, in: context) { updated += 1 }
                    }
                    for id in page.removed {
                        if try applyRemoval(externalID: id, in: context) { removed += 1 }
                    }

                    cursor = page.nextCursor
                    hasMore = page.hasMore && page.nextCursor != nil
                }

                account.syncCursor = cursor
                account.lastSyncedAt = .now
            }

            try context.save()
            settings.lastBankSync = .now
            phase = .idle
            lastSummary = Self.summary(imported: imported, updated: updated, removed: removed)
        } catch {
            phase = .failed(message(for: error))
        }
    }

    private static func summary(imported: Int, updated: Int, removed: Int) -> String {
        if imported == 0 && updated == 0 && removed == 0 {
            return "Already up to date."
        }
        var parts: [String] = []
        if imported > 0 { parts.append("\(imported) new") }
        if updated > 0 { parts.append("\(updated) updated") }
        if removed > 0 { parts.append("\(removed) removed") }
        return parts.joined(separator: ", ")
    }

    // MARK: - Applying provider changes

    /// - Returns: true when a new row was actually created.
    private func apply(added transaction: BankTransaction, in context: ModelContext) throws -> Bool {
        let expense = makeExpense(from: transaction)
        let stored = try ExpenseStore.insert(expense, into: context)
        // Merged into an existing row rather than inserted.
        return stored === expense
    }

    private func apply(modified transaction: BankTransaction, in context: ModelContext) throws -> Bool {
        guard let existing = try find(externalID: transaction.id, in: context) else {
            // Never saw the original; treat the update as an arrival.
            return try apply(added: transaction, in: context)
        }
        existing.amount = transaction.amount
        existing.isPending = transaction.pending
        existing.date = transaction.date
        if existing.merchant.isEmpty {
            existing.merchant = transaction.displayMerchant
        }
        return true
    }

    private func applyRemoval(externalID: String, in context: ModelContext) throws -> Bool {
        guard let existing = try find(externalID: externalID, in: context) else { return false }
        // A row the user already reviewed and kept is theirs, not the bank's.
        guard !existing.isReviewed else { return false }
        context.delete(existing)
        return true
    }

    private func find(externalID: String, in context: ModelContext) throws -> Expense? {
        var descriptor = FetchDescriptor<Expense>(predicate: #Predicate { $0.externalID == externalID })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    private func makeExpense(from transaction: BankTransaction) -> Expense {
        let merchant = transaction.displayMerchant
        return Expense(
            amount: transaction.amount,
            currencyCode: transaction.currencyCode,
            merchant: merchant,
            note: "",
            date: transaction.date,
            category: CategoryClassifier.classify(
                text: transaction.descriptor,
                merchant: transaction.merchantName
            ),
            source: .bankSync,
            externalID: transaction.id,
            isPending: transaction.pending
        )
    }

    // MARK: - Unlinking

    func unlink(_ account: LinkedAccount, from context: ModelContext) async {
        if let provider {
            try? await provider.unlink(itemID: account.itemID)
        }
        context.delete(account)
        try? context.save()
    }

    // MARK: - Errors

    private func message(for error: Error) -> String {
        (error as? BankSyncError)?.localizedDescription ?? error.localizedDescription
    }

    func clearError() {
        if case .failed = phase { phase = .idle }
    }
}

extension BankSyncService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }

            return scene?.keyWindow ?? ASPresentationAnchor()
        }
    }
}
