import ReadingRigKit
import ReadingRigUI
import SwiftUI

#if canImport(AppKit)
import AppKit
#endif

@main
struct ReadingRigDevApp: App {
    init() {
        // `swift run` launches a bare executable with no .app bundle, so
        // macOS doesn't treat it as a foreground app by default — the
        // window can exist without ever coming to front. Forces both.
        #if canImport(AppKit)
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
        #endif
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                AppRootView()
            }
        }
    }
}

private struct AppRootView: View {
    @State private var session = AuthSession()

    var body: some View {
        if let client = session.makeClient() {
            ShelfListView(client: client, onSignOut: { session.signOut() })
        } else {
            SignInView(session: session)
        }
    }
}
