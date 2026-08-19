import ReadingRigKit
import ReadingRigUI
import SwiftUI

#if canImport(AppKit)
import AppKit

/// Without this, repeated `swift run` launches eventually stop opening a
/// window at all — confirmed via `log show`: AppKit's window-state
/// restoration machinery decides `shouldRestoreState=1
/// hasPersistentStateToRestore=0` and then never falls back to creating
/// WindowGroup's default window, since an unbundled executable has no
/// Info.plist declaring it doesn't participate in that machinery the way
/// a real .app would. `applicationSupportsSecureRestorableState(_:)`
/// (macOS 12+) is Apple's own opt-out for exactly this failure mode.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { false }
}
#endif

@main
struct ReadingRigDevApp: App {
    #if canImport(AppKit)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

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
            ShelfListView(
                client: client,
                session: session,
                onSignOut: { session.signOut() },
                coverImageRequest: { workId in session.coverImageRequest(workId: workId) }
            )
        } else {
            SignInView(session: session)
        }
    }
}
