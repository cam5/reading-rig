import Foundation

/// The wire shape `spansJsonSchema` (read.server.ts) parses back out of —
/// a highlight span is sent as a JSON-encoded string field, not a nested
/// form value, so this only needs to round-trip through `JSONEncoder`, not
/// match `ContentParagraph`'s own (richer, server-computed) `highlightSpan`
/// shape.
public struct HighlightSpanInput: Encodable, Sendable {
    public let paragraphId: String
    public let start: Int
    public let end: Int

    public init(paragraphId: String, start: Int, end: Int) {
        self.paragraphId = paragraphId
        self.start = start
        self.end = end
    }
}

private func encodeSpans(_ spans: [HighlightSpanInput]) throws -> String {
    let data = try JSONEncoder().encode(spans)
    return String(decoding: data, as: UTF8.self)
}

extension Client {
    /// Only ever sends `application/x-www-form-urlencoded` — the other
    /// content type this route accepts (`multipart/form-data`) is a
    /// generator gap of its own: the same `oneOf` that now produces a real
    /// enum for urlEncodedForm still gets skipped for multipart (visible as
    /// a build warning), a narrower version of the "not a reference" gap
    /// that used to block both. Not worth chasing further — this route
    /// never receives a file upload, so multipart was never the form this
    /// client needed.
    public func postHighlight(workId: String, spans: [HighlightSpanInput]) async throws {
        _ = try await postReadAction(
            path: .init(workId: workId),
            body: .urlEncodedForm(
                .highlight(.init(intent: .highlight, spans: try encodeSpans(spans)))
            )
        ).ok
    }

    public func postNote(
        workId: String,
        paragraphId: String,
        body: String,
        highlightId: String? = nil,
        excerpt: String? = nil
    ) async throws {
        _ = try await postReadAction(
            path: .init(workId: workId),
            body: .urlEncodedForm(
                .note(
                    .init(
                        intent: .note,
                        paragraphId: paragraphId,
                        highlightId: highlightId,
                        body: body,
                        excerpt: excerpt
                    )
                )
            )
        ).ok
    }

    public func postBookmark(workId: String, paragraphId: String) async throws {
        _ = try await postReadAction(
            path: .init(workId: workId),
            body: .urlEncodedForm(.bookmark(.init(intent: .bookmark, paragraphId: paragraphId)))
        ).ok
    }
}
