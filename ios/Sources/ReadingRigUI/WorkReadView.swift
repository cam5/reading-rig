import ReadingRigKit
import SwiftUI

/// GET /api/v1/read/:workId, rendered as a scrollable column of paragraphs,
/// with the ability to highlight one and attach a note — POST
/// /api/v1/read/:workId's `highlight`/`note` intents (`bookmark` isn't
/// wired here; there's no scroll-position tracking to hang it off yet).
///
/// Typography follows ReadingParagraph.tsx/.module.css as closely as
/// SwiftUI's Text allows: 17.5pt serif at an approximated 1.8 line-height
/// (SwiftUI has no line-height *multiplier* — `.lineSpacing` only adds a
/// flat extra gap, so this is a tuned approximation, not the same
/// computation), first-line indent as the only paragraph-break cue (no
/// gap between consecutive prose paragraphs, indent skipped for a
/// section's first paragraph), a left-border+italic blockquote, and scene
/// breaks as a centered "⁂" rather than any text. One real, permanent gap:
/// SwiftUI's Text has no text-justify — this stays leading-aligned rather
/// than faking justification.
///
/// Highlighting is whole-paragraph only, not an arbitrary text selection —
/// SwiftUI's `Text` has no selection-range API to build a drag-to-select
/// gesture on the way `SelectionHighlighter` (the web app's own) does. A
/// deliberate first-pass simplification, not a corner cut silently: the
/// server-side `spans` shape supports partial ranges just fine (see
/// HighlightSpanInput), so this only needs a richer gesture later, not a
/// backend change.
public struct WorkReadView: View {
    private let client: Client
    private let session: AuthSession
    private let workId: String
    private let title: String

    @State private var paragraphs: [ContentParagraph] = []
    @State private var errorMessage: String?
    @State private var actionError: String?
    @State private var composerTarget: NoteComposerTarget?

    public init(client: Client, session: AuthSession, workId: String, title: String) {
        self.client = client
        self.session = session
        self.workId = workId
        self.title = title
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: RigTheme.readingLineSpacing) {
                ForEach(Array(paragraphs.enumerated()), id: \.element.id) { index, paragraph in
                    let isFirstInSection = index == 0 || paragraphs[index - 1].sectionId != paragraph.sectionId
                    paragraphView(paragraph, isFirstInSection: isFirstInSection)
                }
            }
            .padding()
        }
        .background(RigTheme.background)
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink {
                    RigSessionsView(client: client, session: session, workId: workId)
                } label: {
                    Image(systemName: "bubble.left.and.bubble.right")
                }
            }
        }
        .overlay {
            if let errorMessage {
                ContentUnavailableView(
                    "Couldn't load this work",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else if paragraphs.isEmpty {
                ProgressView()
            }
        }
        .task { await load() }
        .sheet(item: $composerTarget) { target in
            NoteComposerView { body in
                await postNote(paragraph: target.paragraph, body: body)
            }
        }
        .alert(
            "Couldn't save",
            isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } }),
            actions: {},
            message: { Text(actionError ?? "") }
        )
    }

    @ViewBuilder
    private func paragraphView(_ paragraph: ContentParagraph, isFirstInSection: Bool) -> some View {
        if paragraph.kind == .sceneBreak {
            // No text of its own (source <hr/>) — a position marker, not
            // prose, same as ReadingParagraph.tsx's own early-return.
            Text("⁂")
                .font(.system(size: 14, design: .serif))
                .foregroundStyle(RigTheme.text.opacity(0.5))
                .kerning(4)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text(attributedText(paragraph, isFirstInSection: isFirstInSection))
                    .lineSpacing(RigTheme.readingLineSpacing)
                    .padding(.leading, paragraph.isBlockquote ? 16 : 0)
                    .overlay(alignment: .leading) {
                        if paragraph.isBlockquote {
                            Rectangle()
                                .fill(RigTheme.neutral400)
                                .frame(width: 2)
                        }
                    }
                    .contextMenu {
                        Button("Highlight Paragraph") {
                            Task { await highlightWholeParagraph(paragraph) }
                        }
                        Button("Add Note") {
                            composerTarget = NoteComposerTarget(paragraph: paragraph)
                        }
                    }

                ForEach(paragraph.entries, id: \.id) { entry in
                    Label(entry.body, systemImage: "text.bubble")
                        .font(.footnote)
                        .foregroundStyle(RigTheme.neutral600)
                        .padding(.leading, 8)
                }
            }
        }
    }

    /// Prose paragraphs with no active highlight get real inline
    /// formatting (bold/italic/footnote markers) via InlineHTML, parsed
    /// from `paragraph.html`. Paragraphs with a highlight still use the
    /// plain-text + background-tint path below — combining rich inline
    /// formatting with a highlight's character-offset overlay is a real
    /// follow-up (the two AttributedStrings aren't built the same way),
    /// not done here.
    private func attributedText(_ paragraph: ContentParagraph, isFirstInSection: Bool) -> AttributedString {
        let font = paragraph.isBlockquote ? RigTheme.readingFontItalic : RigTheme.readingFont
        var attributed =
            paragraph.highlightSpans.isEmpty
            ? InlineHTML.attributedString(from: paragraph.html, font: font, textColor: RigTheme.text)
            : highlightedText(paragraph, font: font)

        // SwiftUI's Text has no text-indent — approximated with leading
        // whitespace, roughly matching organic.css's 3ch indent (see this
        // view's own doc comment on why that's the closest available).
        // Non-breaking spaces, not plain ones: text layout engines
        // (SwiftUI's included) routinely trim or collapse plain leading
        // whitespace — inconsistently, since it can depend on line-wrap
        // recycling — which is exactly why the indent looked unreliable
        // before this; U+00A0 isn't eligible for that trimming.
        if !isFirstInSection {
            var indent = AttributedString("\u{00A0}\u{00A0}\u{00A0}")
            indent.font = font
            attributed = indent + attributed
        }
        return attributed
    }

    /// Renders `paragraph.highlightSpans` as background-tinted ranges over
    /// the plain text — offsets are UTF-16 code-unit indices (how the
    /// server computed them, from a JS string), not Swift's default
    /// Character-based `String.Index`, so this has to convert explicitly
    /// rather than use `text.index(_:offsetBy:)`.
    private func highlightedText(_ paragraph: ContentParagraph, font: Font) -> AttributedString {
        var attributed = AttributedString(paragraph.text)
        attributed.font = font
        attributed.foregroundColor = RigTheme.text
        guard !paragraph.highlightSpans.isEmpty else { return attributed }

        let utf16Count = paragraph.text.utf16.count
        for span in paragraph.highlightSpans {
            guard
                span.startOffset >= 0,
                span.endOffset <= utf16Count,
                span.startOffset <= span.endOffset
            else { continue }
            let start = String.Index(utf16Offset: span.startOffset, in: paragraph.text)
            let end = String.Index(utf16Offset: span.endOffset, in: paragraph.text)
            guard let range = Range(start..<end, in: attributed) else { continue }
            attributed[range].backgroundColor = RigTheme.accent.opacity(0.35)
        }
        return attributed
    }

    private func highlightWholeParagraph(_ paragraph: ContentParagraph) async {
        do {
            try await client.postHighlight(
                workId: workId,
                spans: [
                    HighlightSpanInput(
                        paragraphId: paragraph.id,
                        start: 0,
                        end: paragraph.text.utf16.count
                    )
                ]
            )
            await load()
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func postNote(paragraph: ContentParagraph, body: String) async {
        do {
            try await client.postNote(workId: workId, paragraphId: paragraph.id, body: body)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func load() async {
        do {
            let response = try await client.getRead(.init(path: .init(workId: workId)))
            switch try response.ok.body {
            case .json(let payload):
                paragraphs = payload.content.paragraphs
                errorMessage = nil
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct NoteComposerTarget: Identifiable {
    let paragraph: ContentParagraph
    var id: String { paragraph.id }
}
