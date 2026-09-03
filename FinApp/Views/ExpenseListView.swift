import SwiftData
import SwiftUI

struct ExpenseListView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppSettings.self) private var settings

    @Query(sort: [SortDescriptor(\Expense.date, order: .reverse)])
    private var expenses: [Expense]

    @State private var searchText = ""
    @State private var scope: Scope = .all
    @State private var editing: Expense?

    private enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case review = "Needs review"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            Group {
                if filtered.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("History")
            .searchable(text: $searchText, prompt: "Merchant, note or category")
            .toolbar {
                if unreviewedCount > 0 {
                    ToolbarItem(placement: .topBarTrailing) {
                        Picker("Filter", selection: $scope) {
                            ForEach(Scope.allCases) { scope in
                                Text(scope.rawValue).tag(scope)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
            }
            .sheet(item: $editing) { expense in
                ExpenseEditor(expense: expense, currencyCode: settings.currencyCode)
                    .environment(settings)
            }
        }
    }

    private var list: some View {
        List {
            ForEach(groupedDays, id: \.day) { group in
                Section {
                    ForEach(group.expenses) { expense in
                        Button {
                            editing = expense
                        } label: {
                            ExpenseRow(expense: expense)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                delete(expense)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .leading) {
                            if !expense.isReviewed {
                                Button {
                                    markReviewed(expense)
                                } label: {
                                    Label("Keep", systemImage: "checkmark")
                                }
                                .tint(.green)
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text(headerTitle(for: group.day))
                        Spacer()
                        Text(ExpenseStore.total(of: group.expenses, currencyCode: settings.currencyCode)
                            .formatted(.currency(code: settings.currencyCode)))
                            .monospacedDigit()
                    }
                    .font(.footnote)
                    .textCase(nil)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(searchText.isEmpty ? "No expenses yet" : "No matches",
                  systemImage: searchText.isEmpty ? "list.bullet" : "magnifyingglass")
        } description: {
            Text(searchText.isEmpty
                 ? "Everything you log will show up here."
                 : "Nothing matches \u{201C}\(searchText)\u{201D}.")
        }
    }

    // MARK: - Data

    private var unreviewedCount: Int {
        expenses.filter { !$0.isReviewed }.count
    }

    private var filtered: [Expense] {
        var result = expenses

        if scope == .review {
            result = result.filter { !$0.isReviewed }
        }

        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return result }

        let needle = CategoryClassifier.normalize(query)
        return result.filter { expense in
            CategoryClassifier.normalize(expense.merchant).contains(needle)
                || CategoryClassifier.normalize(expense.note).contains(needle)
                || CategoryClassifier.normalize(expense.category.displayName).contains(needle)
        }
    }

    private var groupedDays: [(day: Date, expenses: [Expense])] {
        let calendar = Calendar.autoupdatingCurrent
        let groups = Dictionary(grouping: filtered) { calendar.startOfDay(for: $0.date) }
        return groups
            .map { (day: $0.key, expenses: $0.value.sorted { $0.date > $1.date }) }
            .sorted { $0.day > $1.day }
    }

    private func headerTitle(for day: Date) -> String {
        let calendar = Calendar.autoupdatingCurrent
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }

        let sameYear = calendar.isDate(day, equalTo: .now, toGranularity: .year)
        return day.formatted(sameYear
                             ? .dateTime.weekday(.abbreviated).day().month(.abbreviated)
                             : .dateTime.day().month(.abbreviated).year())
    }

    // MARK: - Actions

    private func delete(_ expense: Expense) {
        try? ExpenseStore.delete(expense, from: modelContext)
    }

    private func markReviewed(_ expense: Expense) {
        expense.isReviewed = true
        try? modelContext.save()
        Haptics.tap()
    }
}

#Preview {
    ExpenseListView()
        .environment(AppSettings.shared)
        .modelContainer(AppContainer.inMemory())
}
