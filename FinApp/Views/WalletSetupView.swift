import SwiftUI

/// Explains how to make Apple Pay purchases log themselves.
///
/// The honesty here is deliberate. People expect "connect to Apple Wallet" to
/// be a switch, and when it silently is not, they assume the app is broken.
/// Saying plainly that Apple exposes no such API — and then showing the route
/// that does work — is the difference between a bug report and a working setup.
struct WalletSetupView: View {

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("There is no Wallet API", systemImage: "info.circle.fill")
                        .font(.headline)
                        .foregroundStyle(.orange)

                    Text("Apple does not let any third-party app read your Apple Wallet or Apple Pay history. No app on the App Store can do it, including this one.")
                        .font(.callout)

                    Text("What iOS does offer is a personal automation that fires the moment a card is used. Point it at FinApp and your Apple Pay purchases log themselves.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }

            Section("Set it up once") {
                ForEach(Array(Self.steps.enumerated()), id: \.offset) { index, step in
                    StepRow(number: index + 1, title: step.title, detail: step.detail)
                }
            }

            Section {
                Link(destination: URL(string: "shortcuts://")!) {
                    Label("Open Shortcuts", systemImage: "arrow.up.forward.app")
                }
            } footer: {
                Text("Automations live under the Automation tab in the Shortcuts app.")
            }

            Section("What gets covered") {
                CoverageRow(
                    symbol: "checkmark.circle.fill",
                    tint: .green,
                    title: "Apple Card, Apple Cash, Apple Pay",
                    detail: "Logged the instant you tap, through the automation above."
                )
                CoverageRow(
                    symbol: "checkmark.circle.fill",
                    tint: .green,
                    title: "Anything on a linked bank account",
                    detail: "Pulled in by bank sync, including the plastic card in your wallet and direct debits."
                )
                CoverageRow(
                    symbol: "mic.fill",
                    tint: .accentColor,
                    title: "Cash and everything else",
                    detail: "Say it out loud — that's what the microphone button is for."
                )
            }

            Section {
                Text("If both the automation and bank sync see the same purchase, FinApp merges them into one entry rather than counting it twice.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Apple Pay")
        .navigationBarTitleDisplayMode(.inline)
    }

    private struct Step {
        let title: String
        let detail: String
    }

    private static let steps: [Step] = [
        Step(
            title: "Open Shortcuts › Automation",
            detail: "Tap the Automation tab at the bottom, then the + button."
        ),
        Step(
            title: "Choose \u{201C}Transaction\u{201D}",
            detail: "Scroll to Transaction. Pick the card you want to track \u{2014} Apple Card, Apple Cash, or any card in Wallet."
        ),
        Step(
            title: "Turn off \u{201C}Ask Before Running\u{201D}",
            detail: "Otherwise every purchase waits on a notification tap, which defeats the point."
        ),
        Step(
            title: "Add the action \u{201C}Log a card transaction\u{201D}",
            detail: "Search for it by name; it belongs to FinApp."
        ),
        Step(
            title: "Map the fields",
            detail: "Set Amount to the trigger's Transaction Amount, and Merchant to Transaction Merchant. Tap the field, then pick the variable from the Shortcut Input."
        ),
        Step(
            title: "Done",
            detail: "New purchases land in History with a dot beside them until you glance at them."
        )
    ]
}

private struct StepRow: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Color.accentColor, in: Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }
}

private struct CoverageRow: View {
    let symbol: String
    let tint: Color
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }
}

#Preview {
    NavigationStack {
        WalletSetupView()
    }
}
