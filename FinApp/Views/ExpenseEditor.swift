import SwiftData
import SwiftUI

/// Add or edit one expense by hand.
struct ExpenseEditor: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSettings.self) private var settings

    /// nil when adding a new expense.
    let expense: Expense?

    @State private var draft: ExpenseDraft
    @State private var errorMessage: String?
    @FocusState private var amountFocused: Bool

    init(expense: Expense? = nil, currencyCode: String) {
        self.expense = expense
        _draft = State(initialValue: expense.map(ExpenseDraft.init(expense:))
                       ?? ExpenseDraft(currencyCode: currencyCode))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Amount") {
                    HStack {
                        Text(Locale.current.localizedCurrencySymbol(for: draft.currencyCode) ?? draft.currencyCode)
                            .foregroundStyle(.secondary)
                        TextField("0.00", text: $draft.amountText)
                            .keyboardType(.decimalPad)
                            .font(.title2.weight(.semibold))
                            .monospacedDigit()
                            .focused($amountFocused)
                    }
                    Toggle("This was a refund", isOn: $draft.isRefund)
                }

                Section("Details") {
                    TextField("Merchant", text: $draft.merchant)
                        .textInputAutocapitalization(.words)
                    TextField("Note", text: $draft.note)

                    Picker("Category", selection: $draft.category) {
                        ForEach(ExpenseCategory.selectable) { category in
                            Label(category.displayName, systemImage: category.symbolName)
                                .tag(category)
                        }
                    }

                    DatePicker("When", selection: $draft.date)
                }

                if let expense, expense.source != .manual {
                    Section("Source") {
                        LabeledContent("Added by") {
                            Label(expense.source.displayName, systemImage: expense.source.symbolName)
                        }
                        if let transcript = expense.transcript, !transcript.isEmpty {
                            LabeledContent("Heard") {
                                Text(transcript)
                                    .multilineTextAlignment(.trailing)
                            }
                            .font(.footnote)
                        }
                        if expense.isPending {
                            Label("Still pending — the amount may change", systemImage: "clock")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if expense != nil {
                    Section {
                        Button("Delete", role: .destructive) { delete() }
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .navigationTitle(expense == nil ? "New expense" : "Edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .fontWeight(.semibold)
                        .disabled(!draft.isValid)
                }
            }
            .onAppear {
                if expense == nil { amountFocused = true }
            }
            .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private func save() {
        draft.reclassifyIfNeeded()

        do {
            if let expense {
                draft.apply(to: expense)
                try modelContext.save()
            } else {
                guard let new = draft.makeExpense() else { return }
                try ExpenseStore.insert(new, into: modelContext)
            }
            Haptics.success()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete() {
        guard let expense else { return }
        do {
            try ExpenseStore.delete(expense, from: modelContext)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    ExpenseEditor(currencyCode: "USD")
        .environment(AppSettings.shared)
        .modelContainer(AppContainer.inMemory())
}
