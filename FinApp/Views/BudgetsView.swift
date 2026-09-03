import SwiftData
import SwiftUI

struct BudgetsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppSettings.self) private var settings

    @Query private var budgets: [Budget]
    @Query private var monthExpenses: [Expense]

    @State private var overallText: String = ""

    init() {
        let interval = ExpenseStore.monthInterval(containing: .now)
        let start = interval.start
        let end = interval.end
        _monthExpenses = Query(filter: #Predicate<Expense> { $0.date >= start && $0.date < end })
        _budgets = Query()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text(symbol)
                            .foregroundStyle(.secondary)
                        TextField("No limit", text: $overallText)
                            .keyboardType(.decimalPad)
                            .monospacedDigit()
                            .onSubmit(commitOverall)
                    }

                    if settings.monthlyBudget > 0 {
                        BudgetBar(
                            spent: monthTotal,
                            limit: settings.monthlyBudget,
                            currencyCode: settings.currencyCode
                        )
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Monthly limit")
                } footer: {
                    Text("Leave blank for no overall limit. Budgets reset on the first of each month.")
                }

                Section {
                    ForEach(ExpenseCategory.selectable) { category in
                        CategoryBudgetRow(
                            category: category,
                            spent: spent(in: category),
                            limit: limit(for: category),
                            currencyCode: settings.currencyCode,
                            onCommit: { newLimit in setLimit(newLimit, for: category) }
                        )
                    }
                } header: {
                    Text("By category")
                } footer: {
                    Text("Only categories with a limit appear on the Spending screen.")
                }
            }
            .navigationTitle("Budgets")
            .onAppear(perform: loadOverall)
            // Commit while typing so a limit is never lost by swiping away.
            .onChange(of: overallText) { _, _ in commitOverall() }
        }
    }

    private var symbol: String {
        Locale.current.localizedCurrencySymbol(for: settings.currencyCode) ?? settings.currencyCode
    }

    private var monthTotal: Decimal {
        ExpenseStore.total(of: monthExpenses, currencyCode: settings.currencyCode)
    }

    private func spent(in category: ExpenseCategory) -> Decimal {
        monthExpenses
            .filter { $0.category == category && $0.currencyCode == settings.currencyCode }
            .reduce(Decimal.zero) { $0 + $1.amount }
    }

    private func limit(for category: ExpenseCategory) -> Decimal {
        budgets.first { $0.category == category }?.monthlyLimit ?? 0
    }

    private func loadOverall() {
        guard overallText.isEmpty, settings.monthlyBudget > 0 else { return }
        overallText = settings.monthlyBudget
            .formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }

    private func commitOverall() {
        let trimmed = overallText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            settings.monthlyBudget = 0
            return
        }
        guard let value = ExpenseParser.decimalValue(fromDigits: trimmed), value >= 0 else { return }
        settings.monthlyBudget = value
    }

    private func setLimit(_ newLimit: Decimal, for category: ExpenseCategory) {
        if let existing = budgets.first(where: { $0.category == category }) {
            if newLimit <= 0 {
                modelContext.delete(existing)
            } else {
                existing.monthlyLimit = newLimit
                existing.currencyCode = settings.currencyCode
                existing.updatedAt = .now
            }
        } else if newLimit > 0 {
            modelContext.insert(
                Budget(category: category, monthlyLimit: newLimit, currencyCode: settings.currencyCode)
            )
        }
        try? modelContext.save()
    }
}

private struct CategoryBudgetRow: View {
    let category: ExpenseCategory
    let spent: Decimal
    let limit: Decimal
    let currencyCode: String
    let onCommit: (Decimal) -> Void

    @State private var text: String = ""
    @State private var hasLoaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                CategoryIcon(category: category, size: 28)
                Text(category.displayName)
                Spacer()
                TextField("None", text: $text)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(width: 90)
            }

            if limit > 0 {
                BudgetBar(spent: spent, limit: limit, currencyCode: currencyCode, tint: category.tint)
            }
        }
        .padding(.vertical, 2)
        .onAppear {
            guard !hasLoaded else { return }
            hasLoaded = true
            if limit > 0 {
                text = limit.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
            }
        }
        .onChange(of: text) { _, newValue in
            let trimmed = newValue.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                onCommit(0)
            } else if let value = ExpenseParser.decimalValue(fromDigits: trimmed) {
                onCommit(value)
            }
        }
    }
}

#Preview {
    BudgetsView()
        .environment(AppSettings.shared)
        .modelContainer(AppContainer.inMemory())
}
