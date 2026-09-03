import Foundation
import Observation

/// User preferences, shared by the UI and by the App Intents that run outside it.
///
/// Backed by `UserDefaults` rather than SwiftData because intents read these
/// before the model container is touched, and because none of it is a record
/// worth versioning.
@Observable
final class AppSettings {
    static let shared = AppSettings()

    private let defaults: UserDefaults

    private enum Key {
        static let currency = "settings.currencyCode"
        static let monthlyBudget = "settings.monthlyBudget"
        static let autoSaveConfident = "settings.autoSaveConfident"
        static let syncBackendURL = "settings.syncBackendURL"
        static let lastBankSync = "settings.lastBankSync"
        static let hasSeenWelcome = "settings.hasSeenWelcome"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.currencyCode = defaults.string(forKey: Key.currency) ?? AppSettings.deviceCurrencyCode
        self.monthlyBudget = AppSettings.decimal(defaults.string(forKey: Key.monthlyBudget))
        self.autoSaveConfidentEntries = defaults.object(forKey: Key.autoSaveConfident) as? Bool ?? true
        self.syncBackendURLString = defaults.string(forKey: Key.syncBackendURL) ?? ""
        self.lastBankSync = defaults.object(forKey: Key.lastBankSync) as? Date
        self.hasSeenWelcome = defaults.bool(forKey: Key.hasSeenWelcome)
    }

    /// ISO 4217 code new expenses default to.
    var currencyCode: String {
        didSet { defaults.set(currencyCode, forKey: Key.currency) }
    }

    /// Overall monthly ceiling. Zero means "not set".
    var monthlyBudget: Decimal {
        didSet { defaults.set("\(monthlyBudget)", forKey: Key.monthlyBudget) }
    }

    /// When true, a clean parse saves straight away and offers undo. When
    /// false, every voice entry opens the editor first.
    var autoSaveConfidentEntries: Bool {
        didSet { defaults.set(autoSaveConfidentEntries, forKey: Key.autoSaveConfident) }
    }

    /// Base URL of the companion sync server (see `server/` in the repo).
    /// Empty means bank sync is switched off.
    var syncBackendURLString: String {
        didSet { defaults.set(syncBackendURLString, forKey: Key.syncBackendURL) }
    }

    var lastBankSync: Date? {
        didSet { defaults.set(lastBankSync, forKey: Key.lastBankSync) }
    }

    var hasSeenWelcome: Bool {
        didSet { defaults.set(hasSeenWelcome, forKey: Key.hasSeenWelcome) }
    }

    var syncBackendURL: URL? {
        let trimmed = syncBackendURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(string: trimmed)
    }

    var isBankSyncConfigured: Bool { syncBackendURL != nil }

    static var deviceCurrencyCode: String {
        Locale.current.currency?.identifier ?? "USD"
    }

    private static func decimal(_ string: String?) -> Decimal {
        guard let string, let value = Decimal(string: string, locale: Locale(identifier: "en_US_POSIX")) else {
            return .zero
        }
        return value
    }
}
