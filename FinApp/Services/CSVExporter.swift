import Foundation

/// Writes the ledger out as CSV.
///
/// Present because an expense tracker that cannot hand your data back is a
/// trap: the file opens in Numbers, Excel or any other tool, so switching away
/// from FinApp costs nothing.
enum CSVExporter {

    static func write(_ expenses: [Expense]) throws -> URL {
        let header = "date,amount,currency,category,merchant,note,source,pending\n"

        let rows = expenses
            .sorted { $0.date < $1.date }
            .map { expense in
                [
                    isoFormatter.string(from: expense.date),
                    "\(expense.amount)",
                    expense.currencyCode,
                    expense.category.displayName,
                    escape(expense.merchant),
                    escape(expense.note),
                    expense.source.displayName,
                    expense.isPending ? "yes" : "no"
                ].joined(separator: ",")
            }
            .joined(separator: "\n")

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("FinApp-\(fileStamp()).csv")

        try (header + rows + "\n").write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    /// RFC 4180: wrap in quotes when the value contains a comma, quote or
    /// newline, and double any embedded quotes.
    private static func escape(_ value: String) -> String {
        guard value.contains(where: { $0 == "," || $0 == "\"" || $0.isNewline }) else {
            return value
        }
        return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static func fileStamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: .now)
    }
}
