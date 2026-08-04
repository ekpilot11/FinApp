import AppIntents
import SwiftData
import SwiftUI

@main
struct FinAppApp: App {

    @State private var settings = AppSettings.shared

    init() {
        // Makes the Siri phrases and Shortcuts actions discoverable without
        // the user opening the Shortcuts app first.
        FinAppShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
                .tint(.accentColor)
        }
        .modelContainer(AppContainer.shared)
    }
}
