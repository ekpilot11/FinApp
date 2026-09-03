import SwiftData
import SwiftUI

/// The dictation sheet: hold a thought, say it, done.
struct VoiceLogView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSettings.self) private var settings

    @State private var recognizer = SpeechRecognizer()
    @State private var draft: ExpenseDraft?
    @State private var parsed: ParsedExpense?
    @State private var errorMessage: String?

    /// Called after a successful save so the caller can show a confirmation.
    var onSaved: (String) -> Void = { _ in }

    var body: some View {
        NavigationStack {
            Group {
                if let draft {
                    reviewForm(draft)
                } else {
                    listeningView
                }
            }
            .navigationTitle(draft == nil ? "Listening" : "Check this")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        recognizer.cancel()
                        dismiss()
                    }
                }
                if draft != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { save() }
                            .fontWeight(.semibold)
                            .disabled(draft?.isValid != true)
                    }
                }
            }
        }
        .task {
            recognizer.onFinish = { transcript in
                handle(transcript: transcript)
            }
            await recognizer.start()
        }
        .onDisappear { recognizer.cancel() }
        .alert("Couldn't save", isPresented: .constant(errorMessage != nil)) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: - Listening

    private var listeningView: some View {
        VStack(spacing: 28) {
            Spacer()

            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.12))
                    .frame(width: 150, height: 150)
                    .scaleEffect(1 + recognizer.audioLevel * 0.18)
                    .animation(.easeOut(duration: 0.15), value: recognizer.audioLevel)

                if recognizer.isListening {
                    WaveformView(level: recognizer.audioLevel, barCount: 5)
                } else {
                    Image(systemName: "mic.slash.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)
                }
            }

            transcriptView

            Spacer()

            statusFooter
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.systemGroupedBackground))
    }

    @ViewBuilder
    private var transcriptView: some View {
        switch recognizer.status {
        case .denied(let message), .unavailable(let message):
            VStack(spacing: 14) {
                Text(message)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Button("Type it instead") {
                    draft = ExpenseDraft(currencyCode: settings.currencyCode)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal)

        default:
            VStack(spacing: 8) {
                Text(recognizer.transcript.isEmpty ? "Say what you spent…" : recognizer.transcript)
                    .font(.title3)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(recognizer.transcript.isEmpty ? .secondary : .primary)
                    .animation(.default, value: recognizer.transcript)

                if recognizer.transcript.isEmpty {
                    Text("\u{201C}Twelve fifty on coffee at Blue Bottle\u{201D}")
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(minHeight: 90)
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    private var statusFooter: some View {
        VStack(spacing: 12) {
            if recognizer.isListening {
                Button {
                    recognizer.stop()
                } label: {
                    Label("Done", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Label(
                    recognizer.isOnDevice ? "Transcribed on device" : "Transcribed by Apple",
                    systemImage: recognizer.isOnDevice ? "iphone" : "icloud"
                )
                .font(.caption2)
                .foregroundStyle(.tertiary)
            } else if case .idle = recognizer.status {
                Button {
                    Task { await recognizer.start() }
                } label: {
                    Label("Listen again", systemImage: "mic.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Review

    private func reviewForm(_ current: ExpenseDraft) -> some View {
        let binding = Binding(
            get: { draft ?? current },
            set: { draft = $0 }
        )

        return Form {
            if let parsed, parsed.confidence < ExpenseParser.reviewThreshold {
                Section {
                    Label(
                        "I wasn't sure about this one — worth a glance.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .font(.footnote)
                    .foregroundStyle(.orange)
                }
            }

            Section("Amount") {
                HStack {
                    Text(currencySymbol)
                        .foregroundStyle(.secondary)
                    TextField("0.00", text: binding.amountText)
                        .keyboardType(.decimalPad)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                }
                Toggle("This was a refund", isOn: binding.isRefund)
            }

            Section("Details") {
                TextField("Merchant", text: binding.merchant)
                    .textInputAutocapitalization(.words)
                TextField("Note", text: binding.note)

                Picker("Category", selection: binding.category) {
                    ForEach(ExpenseCategory.selectable) { category in
                        Label(category.displayName, systemImage: category.symbolName)
                            .tag(category)
                    }
                }

                DatePicker("When", selection: binding.date, in: ...Date.now)
            }

            if let transcript = current.transcript, !transcript.isEmpty {
                Section("Heard") {
                    Text(transcript)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button {
                    draft = nil
                    parsed = nil
                    Task { await recognizer.start() }
                } label: {
                    Label("Say it again", systemImage: "arrow.counterclockwise")
                }
            }
        }
    }

    private var currencySymbol: String {
        let code = draft?.currencyCode ?? settings.currencyCode
        return Locale.current.localizedCurrencySymbol(for: code) ?? code
    }

    // MARK: - Actions

    private func handle(transcript: String) {
        let result = ExpenseParser.parse(transcript, defaultCurrency: settings.currencyCode)
        parsed = result

        // A clean parse is saved outright — the whole point is not to make you
        // confirm a coffee. Anything doubtful goes to the form instead.
        if settings.autoSaveConfidentEntries,
           result.confidence >= ExpenseParser.reviewThreshold,
           result.isUsable {
            saveDirectly(result)
        } else {
            draft = ExpenseDraft(parsed: result)
        }
    }

    private func saveDirectly(_ result: ParsedExpense) {
        var newDraft = ExpenseDraft(parsed: result)
        newDraft.reclassifyIfNeeded()
        guard let expense = newDraft.makeExpense() else {
            draft = newDraft
            return
        }

        do {
            let stored = try ExpenseStore.insert(expense, into: modelContext)
            Haptics.success()
            onSaved("Logged \(stored.formattedAmount)\(stored.merchant.isEmpty ? "" : " at \(stored.merchant)")")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            draft = newDraft
        }
    }

    private func save() {
        guard var current = draft else { return }
        current.reclassifyIfNeeded()
        guard let expense = current.makeExpense() else { return }

        do {
            let stored = try ExpenseStore.insert(expense, into: modelContext)
            Haptics.success()
            onSaved("Logged \(stored.formattedAmount)")
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

extension Locale {
    /// The symbol a given currency code should display with, independent of
    /// the device's own currency.
    func localizedCurrencySymbol(for code: String) -> String? {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        formatter.locale = self
        return formatter.currencySymbol
    }
}

#Preview {
    VoiceLogView()
        .environment(AppSettings.shared)
        .modelContainer(AppContainer.inMemory())
}
