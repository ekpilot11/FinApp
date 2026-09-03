import SwiftData
import SwiftUI

struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppSettings.self) private var settings

    @Query(sort: [SortDescriptor(\LinkedAccount.linkedAt)])
    private var accounts: [LinkedAccount]

    @Query private var allExpenses: [Expense]

    @State private var syncService = BankSyncService()
    @State private var exportURL: URL?
    @State private var showingEraseConfirmation = false

    var body: some View {
        @Bindable var settings = settings

        return NavigationStack {
            Form {
                Section("Currency") {
                    Picker("Default currency", selection: $settings.currencyCode) {
                        ForEach(Self.commonCurrencies, id: \.self) { code in
                            Text("\(code) \u{2014} \(Locale.current.localizedString(forCurrencyCode: code) ?? code)")
                                .tag(code)
                        }
                    }
                }

                Section {
                    Toggle("Save confident entries instantly", isOn: $settings.autoSaveConfidentEntries)
                } header: {
                    Text("Voice")
                } footer: {
                    Text("When FinApp is sure it understood you, the expense is saved without asking. Anything unclear still opens for review.")
                }

                automaticSection
                bankSyncSection
                dataSection
                aboutSection
            }
            .navigationTitle("Settings")
            .sheet(item: Binding(
                get: { exportURL.map { IdentifiableURL(url: $0) } },
                set: { exportURL = $0?.url }
            )) { wrapper in
                ShareSheet(url: wrapper.url)
            }
            .confirmationDialog(
                "Delete every expense?",
                isPresented: $showingEraseConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete everything", role: .destructive, action: eraseAll)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This cannot be undone. Export first if you want a copy.")
            }
        }
    }

    // MARK: - Automatic logging

    private var automaticSection: some View {
        Section {
            NavigationLink {
                WalletSetupView()
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Apple Pay auto-logging")
                        Text("Set up the Shortcuts automation")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "creditcard.fill")
                }
            }
        } header: {
            Text("Automatic")
        } footer: {
            Text("iOS does not let any app read Apple Wallet directly. A Shortcuts automation is the supported way to have Apple Pay purchases log themselves.")
        }
    }

    // MARK: - Bank sync

    private var bankSyncSection: some View {
        @Bindable var settings = settings

        return Section {
            TextField("https://your-server.example.com", text: $settings.syncBackendURLString)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)

            ForEach(accounts) { account in
                HStack {
                    Label(account.displayName, systemImage: "building.columns.fill")
                    Spacer()
                    if let last = account.lastSyncedAt {
                        Text(last, format: .relative(presentation: .numeric))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    Button("Unlink", role: .destructive) {
                        Task { await syncService.unlink(account, from: modelContext) }
                    }
                }
            }

            Button {
                Task { await syncService.link(into: modelContext) }
            } label: {
                Label("Connect a bank or card", systemImage: "link")
            }
            .disabled(!settings.isBankSyncConfigured || syncService.isBusy)

            if !accounts.isEmpty {
                Button {
                    Task { await syncService.sync(into: modelContext) }
                } label: {
                    HStack {
                        Label("Sync now", systemImage: "arrow.clockwise")
                        if syncService.phase == .syncing {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(syncService.isBusy)
            }

            if case .failed(let message) = syncService.phase {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            } else if let summary = syncService.lastSummary {
                Text(summary)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Bank sync")
        } footer: {
            Text("Bank aggregators require a server-side secret that cannot ship inside an app. Deploy the companion server in this project's `server/` folder and paste its address here. See docs/BANK_SYNC.md.")
        }
    }

    // MARK: - Data

    private var dataSection: some View {
        Section("Your data") {
            Button {
                exportURL = try? CSVExporter.write(allExpenses)
            } label: {
                Label("Export as CSV", systemImage: "square.and.arrow.up")
            }
            .disabled(allExpenses.isEmpty)

            Button(role: .destructive) {
                showingEraseConfirmation = true
            } label: {
                Label("Delete all expenses", systemImage: "trash")
            }
            .disabled(allExpenses.isEmpty)
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledContent("Expenses", value: "\(allExpenses.count)")
            LabeledContent("Version", value: Bundle.main.shortVersion)
        } header: {
            Text("About")
        } footer: {
            Text("Expenses are stored on this device. Nothing is uploaded unless you connect a bank.")
        }
    }

    private func eraseAll() {
        for expense in allExpenses {
            modelContext.delete(expense)
        }
        try? modelContext.save()
    }

    static let commonCurrencies = [
        "USD", "EUR", "GBP", "BRL", "CAD", "AUD", "NZD", "CHF", "JPY", "CNY",
        "INR", "MXN", "ARS", "CLP", "COP", "SEK", "NOK", "DKK", "PLN", "CZK",
        "ZAR", "SGD", "HKD", "KRW", "TRY", "AED", "ILS"
    ]
}

private struct IdentifiableURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// `ShareLink` cannot be built lazily from a file that is written on tap, so
/// the share sheet is presented directly.
private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension Bundle {
    var shortVersion: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}

#Preview {
    SettingsView()
        .environment(AppSettings.shared)
        .modelContainer(AppContainer.inMemory())
}
