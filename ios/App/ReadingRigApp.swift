import ReadingRigKit
import ReadingRigUI
import SwiftUI

/// The real iOS app entry point — thin on purpose, same `AppRootView`
/// logic `ReadingRigDevApp` (the macOS `swift run` dev shell) has, minus
/// the AppKit-specific window-activation/state-restoration workarounds
/// that shell needed and a real app bundle doesn't. See ios/README.md for
/// how this target is generated (XcodeGen, project.yml) rather than a
/// committed .xcodeproj.
@main
struct ReadingRigApp: App {
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
