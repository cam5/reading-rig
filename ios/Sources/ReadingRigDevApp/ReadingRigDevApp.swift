import Foundation
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

/// Reads connection details from the environment rather than hardcoding
/// them, since this target only exists for pointing `swift run` at
/// whatever's running locally — set READING_RIG_API_TOKEN (mint one with
/// `npm run api-token create <email>` in the repo root) and optionally
/// READING_RIG_BASE_URL (defaults to http://localhost:3000).
private struct AppRootView: View {
    var body: some View {
        if let client = Self.makeClient() {
            ShelfListView(client: client)
        } else {
            ContentUnavailableView(
                "Set READING_RIG_API_TOKEN",
                systemImage: "key.slash",
                description: Text(
                    """
                    Mint one with `npm run api-token create <email>` in the \
                    reading-rig repo, then run this target with \
                    READING_RIG_API_TOKEN set (and READING_RIG_BASE_URL, if \
                    the dev server isn't on http://localhost:3000).
                    """
                )
            )
        }
    }

    private static func makeClient() -> Client? {
        let env = ProcessInfo.processInfo.environment
        guard let token = env["READING_RIG_API_TOKEN"], !token.isEmpty else { return nil }
        guard let serverURL = URL(string: env["READING_RIG_BASE_URL"] ?? "http://localhost:3000") else {
            return nil
        }
        return ReadingRigClient.make(serverURL: serverURL, token: { token })
    }
}
