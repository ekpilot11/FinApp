import Foundation
import SwiftData

/// The one `ModelContainer` for the process.
///
/// App Intents invoked by Siri or by a Shortcuts automation run in this same
/// process, so they must not build a second container over the same store file
/// — two containers means two write-ahead logs over one database.
enum AppContainer {

    static let schema = Schema([
        Expense.self,
        Budget.self,
        LinkedAccount.self
    ])

    static let shared: ModelContainer = {
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            // A container that cannot open means the store is unreadable — most
            // often a schema change without a migration during development.
            // Fall back to memory so the app still launches and says so, rather
            // than crashing on a user's device with their history intact on disk.
            assertionFailure("Falling back to an in-memory store: \(error)")
            let fallback = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            // swiftlint:disable:next force_try
            return try! ModelContainer(for: schema, configurations: [fallback])
        }
    }()

    /// A fresh context for background work such as an intent or a bank sync.
    @MainActor
    static func newContext() -> ModelContext {
        ModelContext(shared)
    }

    /// In-memory container for previews and tests.
    static func inMemory() -> ModelContainer {
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        // Previews are developer-only surfaces; a throw here is a programmer error.
        // swiftlint:disable:next force_try
        return try! ModelContainer(for: schema, configurations: [configuration])
    }
}
