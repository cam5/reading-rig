import ReadingRigKit
import SwiftUI

/// A first pass at the Rig conversation, deliberately narrow. The web
/// app's equivalent (toTranscriptItems.ts, RigLivePanel.tsx) renders
/// thinking beats with durations, tool calls with status/results, memory
/// read/write items, incremental `event_delta` streaming reveal, and a
/// pending/dimmed state for an unconfirmed send — none of that is here.
/// This only renders complete `user.message`/`agent.message` events as
/// chat bubbles and `agent.custom_tool_use` as a plain "used a tool" line;
/// everything else RigEvent doesn't even model (see its own doc comment).
/// A real transcript needs real design/effort parity with the web side —
/// this is "does the wire protocol work end to end," not that.
public struct RigChatView: View {
    private let client: Client
    private let session: AuthSession
    private let workId: String
    private let sessionId: String

    @State private var messages: [ChatMessage] = []
    @State private var composerText = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    public init(client: Client, session: AuthSession, workId: String, sessionId: String) {
        self.client = client
        self.session = session
        self.workId = workId
        self.sessionId = sessionId
    }

    public var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { message in
                            bubble(message).id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal)
            }
            composer
        }
        .background(RigTheme.background)
        .navigationTitle("Rig Session")
        .task { await listenForEvents() }
    }

    @ViewBuilder
    private func bubble(_ message: ChatMessage) -> some View {
        switch message.role {
        case .tool:
            Label(message.text, systemImage: "wrench.and.screwdriver")
                .font(.caption)
                .foregroundStyle(RigTheme.neutral600)
        case .user, .agent:
            HStack {
                if message.role == .user { Spacer(minLength: 40) }
                Text(message.text)
                    .font(RigTheme.readingFont)
                    .foregroundStyle(message.role == .user ? .white : RigTheme.text)
                    .padding(10)
                    .background(message.role == .user ? RigTheme.accent : RigTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                if message.role == .agent { Spacer(minLength: 40) }
            }
        }
    }

    private var composer: some View {
        HStack {
            TextField("Ask the Rig…", text: $composerText)
                .textFieldStyle(.roundedBorder)
            Button {
                Task { await send() }
            } label: {
                if isSending {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.up.circle.fill")
                }
            }
            .disabled(composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
        }
        .padding()
        .background(RigTheme.surface)
    }

    private func listenForEvents() async {
        guard let request = session.rigStreamRequest(workId: workId, sessionId: sessionId) else {
            errorMessage = "Not signed in."
            return
        }
        do {
            for try await event in RigSSE.events(for: request) {
                handle(event)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func handle(_ event: RigEvent) {
        switch event.type {
        case "user.message", "agent.message":
            let text = (event.content ?? []).map(\.text).joined()
            guard !text.isEmpty else { return }
            messages.append(
                ChatMessage(id: event.id, role: event.type == "user.message" ? .user : .agent, text: text)
            )
        case "agent.custom_tool_use":
            messages.append(ChatMessage(id: event.id, role: .tool, text: "Used \(event.name ?? "a tool")"))
        default:
            break
        }
    }

    /// Doesn't append the sent message locally — the SSE stream (already
    /// open from listenForEvents) echoes it back as its own `user.message`
    /// event, per rig.tsx's stream-first design; appending here too would
    /// double it up.
    private func send() async {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        composerText = ""
        isSending = true
        defer { isSending = false }
        do {
            _ = try await client.postRigMessage(
                path: .init(workId: workId),
                query: .init(session: sessionId),
                body: .urlEncodedForm(.init(message: text))
            ).ok
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct ChatMessage: Identifiable {
    enum Role { case user, agent, tool }
    let id: String
    let role: Role
    let text: String
}
