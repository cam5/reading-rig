import Foundation

public struct RigContentBlock: Decodable, Sendable {
    public let type: String
    public let text: String
}

/// A loosely-typed mirror of app/rig/sessionSource.ts's RigSessionEvent —
/// deliberately narrow, the same posture that file's own OtherSessionEvent
/// takes (only `type`/`id` guaranteed). Only the fields this client
/// actually renders are modeled (content, live, a tool call's name); every
/// other field the real stream carries (span.*, session.thread_status_*,
/// model_usage, thinking beats, memory ops...) is simply absent from this
/// type and ignored by Decodable, not modeled at all. See RigChatView's
/// own doc comment for what that leaves out.
public struct RigEvent: Decodable, Sendable, Identifiable {
    public let type: String
    public let id: String
    public let content: [RigContentBlock]?
    public let live: Bool?
    /// agent.custom_tool_use's tool name.
    public let name: String?
}

/// Opens GET /api/v1/rig/:workId (Server-Sent Events) and yields each
/// `data: {...}` frame decoded as a RigEvent. Not part of the generated
/// OpenAPI client — streamRigSession's response has no JSON schema (it's
/// `text/event-stream`, see openapi.server.ts's own comment on why), so
/// there's nothing for swift-openapi-generator to generate a typed method
/// for. Bypasses it by hand the same way AuthSession.coverImageRequest /
/// CoverImageView do for GET /cover/*.
///
/// A minimal SSE parser, not a general one: only handles `data: ` lines
/// terminated by a blank line, which is all this one server ever sends
/// (rig.tsx's loader) other than an `event: error` frame on a terminal
/// failure — that frame's `data: {message}` payload doesn't decode as a
/// RigEvent (no `type`/`id`), so it's silently dropped rather than
/// surfaced; the stream simply ends. A real error-frame UI is a follow-up.
public enum RigSSE {
    public static func events(for request: URLRequest) -> AsyncThrowingStream<RigEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                        continuation.finish(throwing: URLError(.badServerResponse))
                        return
                    }

                    var pendingData: String?
                    for try await line in bytes.lines {
                        if line.hasPrefix("data: ") {
                            pendingData = String(line.dropFirst(6))
                        } else if line.isEmpty, let payload = pendingData {
                            pendingData = nil
                            if let data = payload.data(using: .utf8),
                                let event = try? JSONDecoder().decode(RigEvent.self, from: data)
                            {
                                continuation.yield(event)
                            }
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
