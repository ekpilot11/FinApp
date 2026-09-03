import Foundation
import Security

/// Minimal keychain wrapper for the one secret the app holds: the token that
/// identifies this device to the sync backend.
///
/// Bank access tokens are deliberately *not* here — they never reach the phone.
/// The backend holds them and the app only ever sends this device token.
enum Keychain {

    private static let service = "com.example.FinApp"

    static func set(_ value: String, for key: String) {
        guard let data = value.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // Available after first unlock so a background sync can run, but
            // never synced to iCloud or included in a backup.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            SecItemAdd(query.merging(attributes) { current, _ in current } as CFDictionary, nil)
        }
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }

    /// Stable per-install identifier used as a bearer token against the backend.
    static var deviceToken: String {
        let key = "deviceToken"
        if let existing = get(key) { return existing }
        let generated = UUID().uuidString
        set(generated, for: key)
        return generated
    }
}
