import Foundation

/// Talks to the companion sync server in `server/`.
///
/// The server exists because aggregators such as Plaid require a secret that
/// must never ship inside an app binary — anyone can extract it from an `.ipa`.
/// It also keeps bank access tokens off the phone, so a lost device leaks
/// nothing but a revocable device token.
struct SyncBackendProvider: BankProvider {

    let baseURL: URL
    let deviceToken: String
    private let session: URLSession

    init(baseURL: URL, deviceToken: String = Keychain.deviceToken, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.deviceToken = deviceToken
        self.session = session
    }

    /// Built from `AppSettings`, or `nil` when the user has not set a server.
    static func configured(settings: AppSettings = .shared) -> SyncBackendProvider? {
        guard let url = settings.syncBackendURL else { return nil }
        return SyncBackendProvider(baseURL: url)
    }

    // MARK: - BankProvider

    func startLink() async throws -> BankLinkSession {
        try await send(path: "link/start", method: "POST", bodyData: Data("{}".utf8))
    }

    func linkResult(sessionID: String) async throws -> BankLinkResult {
        try await send(path: "link/status", method: "GET", query: ["session": sessionID])
    }

    func sync(itemID: String, cursor: String?) async throws -> BankSyncPage {
        var query = ["itemId": itemID]
        if let cursor { query["cursor"] = cursor }
        return try await send(path: "transactions/sync", method: "GET", query: query)
    }

    func unlink(itemID: String) async throws {
        let body = try JSONEncoder().encode(["itemId": itemID])
        let _: EmptyBody = try await send(path: "link/remove", method: "POST", bodyData: body)
    }

    // MARK: - Transport

    private struct EmptyBody: Codable {}

    private struct ServerError: Decodable {
        let error: String?
        let message: String?
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        query: [String: String] = [:],
        bodyData: Data? = nil
    ) async throws -> Response {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else { throw BankSyncError.notConfigured }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let bodyData {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BankSyncError.transport(error)
        }

        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(statusCode) else {
            let serverError = try? JSONDecoder().decode(ServerError.self, from: data)
            throw BankSyncError.badResponse(
                status: statusCode,
                message: serverError?.message ?? serverError?.error
            )
        }

        // `unlink` and friends legitimately return an empty body.
        if data.isEmpty, let empty = EmptyBody() as? Response { return empty }

        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw BankSyncError.decoding(error)
        }
    }

    /// Dates come over the wire as `YYYY-MM-DD` (what card networks report) or
    /// as full ISO 8601 timestamps, depending on the provider.
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)

            if let date = dayFormatter.date(from: raw) { return date }
            if let date = isoFormatter.date(from: raw) { return date }
            if let date = isoFractionalFormatter.date(from: raw) { return date }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unrecognised date format: \(raw)"
            )
        }
        return decoder
    }()

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        // Midday keeps a date-only value on the right day in every time zone.
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current
        formatter.defaultDate = Calendar.current.date(
            bySettingHour: 12, minute: 0, second: 0, of: Date()
        )
        return formatter
    }()

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let isoFractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
