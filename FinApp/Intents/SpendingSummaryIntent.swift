import AppIntents
import Foundation
import SwiftData

enum SummaryPeriod: String, AppEnum, CaseIterable {
    case today
    case thisWeek
    case thisMonth

    // Stored, literal — see the note in ExpenseCategory+AppEnum.swift for why
    // these cannot be computed.
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Period")

    static var caseDisplayRepresentations: [SummaryPeriod: DisplayRepresentation] = [
        .today: DisplayRepresentation(title: "Today"),
        .thisWeek: DisplayRepresentation(title: "This week"),
        .thisMonth: DisplayRepresentation(title: "This month")
    ]

    var displayName: String {
        switch self {
        case .today: return "today"
        case .thisWeek: return "this week"
        case .thisMonth: return "this month"
        }
    }

    func interval(from date: Date, calendar: Calendar = .autoupdatingCurrent) -> DateInterval {
        switch self {
        case .today:
            return ExpenseStore.dayInterval(containing: date, calendar: calendar)
        case .thisWeek:
            return calendar.dateInterval(of: .weekOfYear, for: date)
                ?? ExpenseStore.dayInterval(containing: date, calendar: calendar)
        case .thisMonth:
            return ExpenseStore.monthInterval(containing: date, calendar: calendar)
        }
    }
}

/// "Hey Siri, how much have I spent today in FinApp?"
struct SpendingSummaryIntent: AppIntent {

    static var title: LocalizedStringResource = "Check spending"

    static var description = IntentDescription(
        "Asks FinApp how much you've spent so far.",
        categoryName: "Insights"
    )

    static var openAppWhenRun = false

    @Parameter(title: "Period", default: .today)
    var period: SummaryPeriod

    static var parameterSummary: some ParameterSummary {
        Summary("How much have I spent \(\.$period)?")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let settings = AppSettings.shared
        let context = AppContainer.newContext()
        let interval = period.interval(from: .now)

        let expenses = try ExpenseStore.expenses(in: interval, context: context)
        let total = ExpenseStore.total(of: expenses, currencyCode: settings.currencyCode)
        let formatted = total.formatted(.currency(code: settings.currencyCode))

        guard !expenses.isEmpty else {
            return .result(dialog: IntentDialog(stringLiteral: "Nothing logged \(period.displayName) yet."))
        }

        var message = "You've spent \(formatted) \(period.displayName)"

        let byCategory = ExpenseStore.totalsByCategory(expenses, currencyCode: settings.currencyCode)
        if let top = byCategory.first, byCategory.count > 1 {
            let topAmount = top.total.formatted(.currency(code: settings.currencyCode))
            message += ", mostly on \(top.category.displayName.lowercased()) at \(topAmount)."
        } else {
            message += "."
        }

        return .result(dialog: IntentDialog(stringLiteral: message))
    }
}

/// Registers the phrases Siri listens for without any setup by the user.
struct FinAppShortcuts: AppShortcutsProvider {

    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogSpokenExpenseIntent(),
            phrases: [
                "Log an expense in \(.applicationName)",
                "Add an expense to \(.applicationName)",
                "Log a purchase in \(.applicationName)",
                "Track a purchase in \(.applicationName)"
            ],
            shortTitle: "Log expense",
            systemImageName: "mic.fill"
        )

        AppShortcut(
            intent: SpendingSummaryIntent(),
            phrases: [
                "How much have I spent in \(.applicationName)",
                "Check my spending in \(.applicationName)",
                "What's my \(.applicationName) total"
            ],
            shortTitle: "Check spending",
            systemImageName: "chart.pie.fill"
        )
    }
}
