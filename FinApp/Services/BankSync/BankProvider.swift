import Foundation

/// One transaction as a bank or card issuer reports it.
struct BankTransaction: Codable, Identifiable, Equatable {
    /// Provider-side identifier, stable across syncs. Used for de-duplication.
    let id: String
    let accountID: String

    /// Positive means money left the account. Refunds arrive negative.
    let amount: Decimal
    let currencyCode: String
    let date: Date

    /// Cleaned merchant name when the provider enriches it.
    let merchantName: String?

    /// Raw statement descriptor. Always present, often ugly.
    let descriptor: String

    /// Authorised but not settled — the amount can still change.
    let pending: Bool

    enum CodingKeys: String, CodingKey {
        case id, amount, date, pending
        case accountID = "accountId"
        case currencyCode = "currency"
        case merchantName = "merchant"
        case descriptor = "description"
    }

    init(
        id: String,
        accountID: String,
        amount: Decimal,
        currencyCode: String,
        date: Date,
        merchantName: String?,
        descriptor: String,
        pending: Bool
    ) {
        self.id = id
        self.accountID = accountID
        self.amount = amount
        self.currencyCode = currencyCode
        self.date = date
        self.merchantName = merchantName
        self.descriptor = descriptor
        self.pending = pending
    }

    /// Accepts `amount` as either a JSON string or a number.
    ///
    /// The companion server sends strings on purpose: decoding money through a
    /// binary `Double` is how 4.75 becomes 4.749999999999999, and that error
    /// then propagates into every total the app shows. A number is still
    /// accepted so a third-party server does not have to know this.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        accountID = try container.decode(String.self, forKey: .accountID)
        currencyCode = try container.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD"
        date = try container.decode(Date.self, forKey: .date)
        merchantName = try container.decodeIfPresent(String.self, forKey: .merchantName)
        descriptor = try container.decodeIfPresent(String.self, forKey: .descriptor) ?? ""
        pending = try container.decodeIfPresent(Bool.self, forKey: .pending) ?? false

        if let text = try? container.decode(String.self, forKey: .amount) {
            guard let value = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .amount,
                    in: container,
                    debugDescription: "Amount \"\(text)\" is not a number"
                )
            }
            amount = value
        } else {
            amount = try container.decode(Decimal.self, forKey: .amount)
        }
    }

    /// Best available human-readable name.
    var displayMerchant: String {
        if let merchantName, !merchantName.isEmpty { return merchantName }
        return descriptor
    }
}

struct BankAccountSummary: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let mask: String?
    let institutionName: String
}

/// The result of one incremental pull.
struct BankSyncPage: Codable, Equatable {
    let added: [BankTransaction]
    let modified: [BankTransaction]
    /// Provider ids of transactions that were reversed or never settled.
    let removed: [String]
    let nextCursor: String?
    let hasMore: Bool
}

/// A link flow that has been started but not yet completed.
struct BankLinkSession: Codable, Equatable {
    /// URL to open in a browser so the user can authenticate with their bank.
    let linkURL: URL
    /// Handle used to poll for completion.
    let sessionID: String

    enum CodingKeys: String, CodingKey {
        case linkURL = "linkUrl"
        case sessionID = "sessionId"
    }
}

struct BankLinkResult: Codable, Equatable {
    let status: Status
    let itemID: String?
    let institutionName: String?
    let accounts: [BankAccountSummary]?

    enum Status: String, Codable {
        case pending, linked, failed
    }

    enum CodingKeys: String, CodingKey {
        case status, accounts
        case itemID = "itemId"
        case institutionName
    }
}

/// Everything FinApp needs from an account-aggregation service.
///
/// Written as a protocol because the right provider depends on where you bank:
/// Plaid covers North America and parts of Europe, GoCardless Bank Account Data
/// covers EU/UK open banking for free, and neither covers everywhere. Swapping
/// one for another should not touch the app.
protocol BankProvider: Sendable {
    /// Begins a connection flow and returns a URL to present to the user.
    func startLink() async throws -> BankLinkSession

    /// Checks whether the user finished authenticating.
    func linkResult(sessionID: String) async throws -> BankLinkResult

    /// Fetches everything new since `cursor`.
    func sync(itemID: String, cursor: String?) async throws -> BankSyncPage

    /// Forgets the connection on the provider's side.
    func unlink(itemID: String) async throws
}

enum BankSyncError: LocalizedError {
    case notConfigured
    case badResponse(status: Int, message: String?)
    case decoding(Error)
    case transport(Error)
    case linkFailed

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "No sync server is set up yet. Add one in Settings › Bank sync."
        case .badResponse(let status, let message):
            if let message, !message.isEmpty { return message }
            return "The sync server returned an error (\(status))."
        case .decoding:
            return "The sync server sent something FinApp couldn't read."
        case .transport(let error):
            return error.localizedDescription
        case .linkFailed:
            return "The bank connection didn't complete."
        }
    }
}
