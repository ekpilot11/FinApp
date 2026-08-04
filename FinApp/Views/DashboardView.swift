import Charts
import SwiftData
import SwiftUI

struct DashboardView: View {
    @Environment(AppSettings.self) private var settings
    @State private var monthAnchor: Date = .now

    var body: some View {
        NavigationStack {
            // Re-created when the month changes so the @Query inside can be
            // built against that month's date range instead of filtering
            // every expense ever recorded in memory.
            MonthDashboard(monthAnchor: monthAnchor)
                .id(monthAnchor)
                .navigationTitle("Spending")
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            shiftMonth(by: -1)
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .accessibilityLabel("Previous month")
                    }
                    ToolbarItem(placement: .principal) {
                        Text(monthAnchor, format: .dateTime.month(.wide).year())
                            .font(.subheadline.weight(.semibold))
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            shiftMonth(by: 1)
                        } label: {
                            Image(systemName: "chevron.right")
                        }
                        .accessibilityLabel("Next month")
                        .disabled(isCurrentMonth)
                    }
                }
        }
    }

    private var isCurrentMonth: Bool {
        Calendar.autoupdatingCurrent.isDate(monthAnchor, equalTo: .now, toGranularity: .month)
    }

    private func shiftMonth(by delta: Int) {
        guard let shifted = Calendar.autoupdatingCurrent.date(byAdding: .month, value: delta, to: monthAnchor) else {
            return
        }
        withAnimation(.snappy) { monthAnchor = shifted }
    }
}

private struct MonthDashboard: View {
    @Environment(AppSettings.self) private var settings
    @Query private var expenses: [Expense]
    @Query private var budgets: [Budget]

    private let interval: DateInterval
    private let monthAnchor: Date

    init(monthAnchor: Date) {
        self.monthAnchor = monthAnchor
        let interval = ExpenseStore.monthInterval(containing: monthAnchor)
        self.interval = interval

        let start = interval.start
        let end = interval.end
        _expenses = Query(
            filter: #Predicate<Expense> { $0.date >= start && $0.date < end },
            sort: [SortDescriptor(\.date, order: .reverse)]
        )
        _budgets = Query()
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                totalCard
                if !expenses.isEmpty {
                    dailyChart
                    categoryBreakdown
                    if !categoryBudgets.isEmpty { budgetSection }
                    recentSection
                } else {
                    emptyState
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 96)
        }
        .scrollIndicators(.hidden)
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Derived values

    private var currency: String { settings.currencyCode }

    private var total: Decimal {
        ExpenseStore.total(of: expenses, currencyCode: currency)
    }

    private var dailyTotals: [(date: Date, total: Decimal)] {
        ExpenseStore.totalsByDay(expenses, in: interval, currencyCode: currency)
    }

    private var categoryTotals: [(category: ExpenseCategory, total: Decimal)] {
        ExpenseStore.totalsByCategory(expenses, currencyCode: currency)
    }

    private var categoryBudgets: [Budget] {
        budgets.filter { $0.monthlyLimit > 0 }
    }

    /// Averaged over days that have already happened, so early in the month the
    /// figure is not divided by days nobody has spent anything in yet.
    private var dailyAverage: Decimal {
        let calendar = Calendar.autoupdatingCurrent
        let now = Date.now
        let lastDay = min(now, interval.end.addingTimeInterval(-1))
        let elapsed = calendar.dateComponents([.day], from: interval.start, to: lastDay).day ?? 0
        let days = max(1, elapsed + 1)
        return total / Decimal(days)
    }

    // MARK: - Sections

    private var totalCard: some View {
        VStack(spacing: 10) {
            Text("Total spent")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text(total.formatted(.currency(code: currency)))
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())

            if settings.monthlyBudget > 0 {
                BudgetBar(spent: total, limit: settings.monthlyBudget, currencyCode: currency)
                    .padding(.top, 4)
            }

            HStack(spacing: 16) {
                stat("Per day", dailyAverage.formatted(.currency(code: currency)))
                Divider().frame(height: 26)
                stat("Purchases", "\(expenses.count)")
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.callout.weight(.semibold))
                .monospacedDigit()
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var dailyChart: some View {
        card(title: "By day") {
            Chart(dailyTotals, id: \.date) { entry in
                BarMark(
                    x: .value("Day", entry.date, unit: .day),
                    y: .value("Spent", entry.total.doubleValue)
                )
                .foregroundStyle(Color.accentColor.gradient)
                .cornerRadius(3)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 7)) { value in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.day())
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let amount = value.as(Double.self) {
                            Text(amount.formatted(.number.notation(.compactName)))
                        }
                    }
                }
            }
            .frame(height: 150)
        }
    }

    private var categoryBreakdown: some View {
        card(title: "Where it went") {
            VStack(spacing: 16) {
                Chart(categoryTotals, id: \.category) { entry in
                    SectorMark(
                        angle: .value("Spent", entry.total.doubleValue),
                        innerRadius: .ratio(0.62),
                        angularInset: 1.5
                    )
                    .foregroundStyle(entry.category.tint)
                    .cornerRadius(4)
                }
                .frame(height: 170)

                VStack(spacing: 10) {
                    ForEach(categoryTotals.prefix(5), id: \.category) { entry in
                        HStack(spacing: 10) {
                            CategoryIcon(category: entry.category, size: 28)
                            Text(entry.category.displayName)
                                .font(.subheadline)
                            Spacer()
                            Text(entry.total.formatted(.currency(code: currency)))
                                .font(.subheadline.weight(.medium))
                                .monospacedDigit()
                            Text(share(of: entry.total))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .frame(width: 42, alignment: .trailing)
                        }
                    }
                }
            }
        }
    }

    private func share(of amount: Decimal) -> String {
        guard total > 0 else { return "0%" }
        return (amount / total).formatted(.percent.precision(.fractionLength(0)))
    }

    private var budgetSection: some View {
        card(title: "Budgets") {
            VStack(spacing: 16) {
                ForEach(categoryBudgets.sorted(by: { $0.category.displayName < $1.category.displayName })) { budget in
                    let spent = categoryTotals.first { $0.category == budget.category }?.total ?? 0
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            CategoryIcon(category: budget.category, size: 24)
                            Text(budget.category.displayName)
                                .font(.subheadline)
                            Spacer()
                        }
                        BudgetBar(
                            spent: spent,
                            limit: budget.monthlyLimit,
                            currencyCode: currency,
                            tint: budget.category.tint
                        )
                    }
                }
            }
        }
    }

    private var recentSection: some View {
        card(title: "Latest") {
            VStack(spacing: 0) {
                ForEach(Array(expenses.prefix(5))) { expense in
                    ExpenseRow(expense: expense)
                    if expense.id != expenses.prefix(5).last?.id {
                        Divider().padding(.leading, 50)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Nothing logged yet", systemImage: "sparkles")
        } description: {
            Text("Tap the microphone and say something like \u{201C}twelve fifty on coffee at Blue Bottle\u{201D}.")
        }
        .padding(.top, 40)
    }

    private func card<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.headline)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }
}

#Preview {
    DashboardView()
        .environment(AppSettings.shared)
        .modelContainer(AppContainer.inMemory())
}
