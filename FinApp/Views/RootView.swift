import SwiftData
import SwiftUI

struct RootView: View {
    @Environment(AppSettings.self) private var settings

    @Query(filter: #Predicate<Expense> { $0.isReviewed == false })
    private var unreviewed: [Expense]

    @State private var selectedTab: Tab = .spending
    @State private var showingVoiceLog = false
    @State private var showingManualEntry = false
    @State private var toast: String?

    private enum Tab: Hashable {
        case spending, history, budgets, settings
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                DashboardView()
                    .tabItem { Label("Spending", systemImage: "chart.pie.fill") }
                    .tag(Tab.spending)

                ExpenseListView()
                    .tabItem { Label("History", systemImage: "list.bullet") }
                    .tag(Tab.history)
                    .badge(unreviewed.count)

                BudgetsView()
                    .tabItem { Label("Budgets", systemImage: "target") }
                    .tag(Tab.budgets)

                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                    .tag(Tab.settings)
            }

            micButton
            toastView
        }
        .sheet(isPresented: $showingVoiceLog) {
            VoiceLogView { message in
                show(toast: message)
            }
            .environment(settings)
            .presentationDetents([.large])
        }
        .sheet(isPresented: $showingManualEntry) {
            ExpenseEditor(currencyCode: settings.currencyCode)
                .environment(settings)
        }
    }

    // MARK: - Microphone

    /// Floats above the tab bar on every screen: logging is the one thing this
    /// app exists to make fast, so it is never more than one tap away.
    private var micButton: some View {
        Button {
            Haptics.tap()
            showingVoiceLog = true
        } label: {
            Image(systemName: "mic.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 58, height: 58)
                .background(Color.accentColor, in: Circle())
                .shadow(color: .black.opacity(0.22), radius: 10, y: 4)
        }
        .accessibilityLabel("Log an expense by voice")
        .contextMenu {
            Button {
                showingManualEntry = true
            } label: {
                Label("Type it instead", systemImage: "square.and.pencil")
            }
        }
        .padding(.bottom, 62)
    }

    // MARK: - Toast

    @ViewBuilder
    private var toastView: some View {
        if let toast {
            Text(toast)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.black.opacity(0.82), in: Capsule())
                .padding(.bottom, 140)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .accessibilityAddTraits(.isStaticText)
        }
    }

    private func show(toast message: String) {
        withAnimation(.snappy) { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            withAnimation(.snappy) { toast = nil }
        }
    }
}

#Preview {
    RootView()
        .environment(AppSettings.shared)
        .modelContainer(AppContainer.inMemory())
}
