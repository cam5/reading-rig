import ReadingRigKit
import SwiftUI

/// GET/POST /api/v1/rig-sessions/:workId — the session picker (see
/// api.v1.rig-sessions.tsx), browsable and creatable here, and now
/// openable into RigChatView, a first-pass conversation view — see that
/// view's own doc comment for how much of the web app's real transcript
/// rendering it deliberately doesn't attempt yet.
public struct RigSessionsView: View {
    private let client: Client
    private let session: AuthSession
    private let workId: String

    @State private var sessions: [RigSessionSummary] = []
    @State private var rigUnavailableReason: String?
    @State private var errorMessage: String?
    @State private var isCreating = false

    public init(client: Client, session: AuthSession, workId: String) {
        self.client = client
        self.session = session
        self.workId = workId
    }

    public var body: some View {
        List(sessions, id: \.id) { rigSession in
            NavigationLink {
                RigChatView(client: client, session: session, workId: workId, sessionId: rigSession.id)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(rigSession.id)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(RigTheme.text)
                    Text(rigSession.createdAt)
                        .font(.caption)
                        .foregroundStyle(RigTheme.neutral600)
                }
            }
            .listRowBackground(RigTheme.background)
        }
        .tint(RigTheme.accent)
        .scrollContentBackground(.hidden)
        .background(RigTheme.background)
        .navigationTitle("Rig Sessions")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await createSession() }
                } label: {
                    if isCreating {
                        ProgressView()
                    } else {
                        Image(systemName: "plus")
                    }
                }
                .disabled(isCreating || rigUnavailableReason != nil)
            }
        }
        .overlay {
            if let errorMessage {
                ContentUnavailableView(
                    "Couldn't load sessions",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else if let rigUnavailableReason {
                ContentUnavailableView(
                    "The Rig isn't available",
                    systemImage: "sparkles.slash",
                    description: Text(rigUnavailableReason)
                )
            } else if sessions.isEmpty {
                ContentUnavailableView(
                    "No sessions yet",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Tap + to start one.")
                )
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            let response = try await client.listRigSessions(.init(path: .init(workId: workId)))
            switch try response.ok.body {
            case .json(let payload):
                sessions = payload.sessions
                rigUnavailableReason = payload.rigUnavailableReason
                errorMessage = nil
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func createSession() async {
        isCreating = true
        defer { isCreating = false }
        do {
            _ = try await client.createRigSession(.init(path: .init(workId: workId)))
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
