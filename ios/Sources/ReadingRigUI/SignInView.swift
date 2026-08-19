import ReadingRigKit
import SwiftUI

/// The paste-a-token stand-in for a real sign-in flow — see AuthSession's
/// doc comment for why. Prefills from READING_RIG_BASE_URL /
/// READING_RIG_API_TOKEN if set, purely as a local-dev convenience so
/// `swift run` doesn't require retyping a token already sitting in the
/// shell environment; the value it actually persists always comes from the
/// form fields, saved to the Keychain via AuthSession.
public struct SignInView: View {
    private let session: AuthSession

    @State private var baseURLText: String
    @State private var tokenText: String

    public init(session: AuthSession) {
        self.session = session
        let env = ProcessInfo.processInfo.environment
        _baseURLText = State(initialValue: env["READING_RIG_BASE_URL"] ?? "http://localhost:3000")
        _tokenText = State(initialValue: env["READING_RIG_API_TOKEN"] ?? "")
    }

    public var body: some View {
        Form {
            Section {
                TextField("Server URL", text: $baseURLText)
                    #if os(iOS)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                SecureField("API token", text: $tokenText)
                    .autocorrectionDisabled()
            } footer: {
                Text("Mint one with `npm run api-token create <email>` in the reading-rig repo, then paste it here.")
            }
            Button("Sign In") {
                guard let url = URL(string: baseURLText), !tokenText.isEmpty else { return }
                session.signIn(baseURL: url, token: tokenText)
            }
            .disabled(URL(string: baseURLText) == nil || tokenText.isEmpty)
        }
        .background(RigTheme.background)
        .navigationTitle("Sign In")
    }
}
