import ReadingRigKit
import SwiftUI

#if os(macOS)
import AppKit
#endif

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
/// On macOS, a paragraph is drag-selectable (SelectableParagraphText) and
/// the context menu offers "Highlight Selection" for exactly what's
/// selected, falling back to "Highlight Paragraph" for the whole thing —
/// on iOS (no runtime to verify a UITextView equivalent against yet) it's
/// still plain `Text`, whole-paragraph-only, the original first-pass
/// simplification: the server-side `spans` shape already supports partial
/// ranges (see HighlightSpanInput), so this was always a client-side gap
/// to close, not a backend one.
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
                    rowView(paragraph, isFirstInSection: isFirstInSection)
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
    private func rowView(_ paragraph: ContentParagraph, isFirstInSection: Bool) -> some View {
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
            ParagraphRow(
                paragraph: paragraph,
                isFirstInSection: isFirstInSection,
                onHighlightWholeParagraph: { Task { await highlightWholeParagraph(paragraph) } },
                onHighlightRange: { range in Task { await highlightRange(paragraph, range: range) } },
                onAddNote: { composerTarget = NoteComposerTarget(paragraph: paragraph) }
            )
        }
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

    /// `range` comes off `NSTextView.selectedRange()` (SelectableParagraphText),
    /// already adjusted by ParagraphRow to strip the leading-indent offset
    /// (see its own doc comment) — by the time it gets here it's in the
    /// same UTF-16 coordinate space as `paragraph.text` the server expects.
    private func highlightRange(_ paragraph: ContentParagraph, range: NSRange) async {
        do {
            try await client.postHighlight(
                workId: workId,
                spans: [
                    HighlightSpanInput(
                        paragraphId: paragraph.id,
                        start: range.location,
                        end: range.location + range.length
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

/// One paragraph's text plus its notes — a dedicated View (not a plain
/// function) so it can hold selection/measured-height state per row,
/// which a `LazyVStack` of function calls has nowhere to put.
private struct ParagraphRow: View {
    let paragraph: ContentParagraph
    let isFirstInSection: Bool
    let onHighlightWholeParagraph: () -> Void
    let onHighlightRange: (NSRange) -> Void
    let onAddNote: () -> Void

    @State private var selectedRange: NSRange?
    @State private var measuredHeight: CGFloat = 24

    /// The `attributedText` indent (see that function) is 3 non-breaking
    /// spaces prepended for every paragraph but a section's first —
    /// `NSTextView`'s selection is measured against that prefixed string,
    /// not `paragraph.text` the server expects, so this has to be
    /// subtracted back out before a selected range means anything to
    /// `HighlightSpanInput`.
    private var indentLength: Int { isFirstInSection ? 0 : 3 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            textView
                .padding(.leading, paragraph.isBlockquote ? 16 : 0)
                .overlay(alignment: .leading) {
                    if paragraph.isBlockquote {
                        Rectangle()
                            .fill(RigTheme.neutral400)
                            .frame(width: 2)
                    }
                }
                .contextMenu {
                    if let selectedRange {
                        Button("Highlight Selection") {
                            onHighlightRange(adjusted(selectedRange))
                        }
                    }
                    Button("Highlight Paragraph") {
                        onHighlightWholeParagraph()
                    }
                    Button("Add Note") {
                        onAddNote()
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

    @ViewBuilder
    private var textView: some View {
        #if os(macOS)
        SelectableParagraphText(
            attributedString: nsAttributedString(attributedText),
            selectedRange: $selectedRange,
            measuredHeight: $measuredHeight
        )
        .frame(height: measuredHeight)
        #else
        Text(attributedText)
            .lineSpacing(RigTheme.readingLineSpacing)
        #endif
    }

    private func adjusted(_ range: NSRange) -> NSRange {
        let start = max(0, range.location - indentLength)
        let end = max(0, range.location + range.length - indentLength)
        return NSRange(location: start, length: end - start)
    }

    #if os(macOS)
    /// `NSMutableAttributedString(AttributedString)` bridges the
    /// characters fine but not reliably the visual attributes this view
    /// actually cares about — confirmed piloting the real app: both
    /// Fraunces (a custom `Font.custom`) and the highlight background
    /// tint silently disappeared through this exact conversion, even
    /// though the same `AttributedString` renders both correctly via
    /// plain SwiftUI `Text`. Every visual attribute is therefore reapplied
    /// natively here instead of trusted from the bridge — including
    /// `.lineSpacing`, which is a `Text` view modifier with no effect on
    /// `NSTextView` regardless (it reads line spacing off the attributed
    /// string's own paragraph style).
    ///
    /// Trade-off: this flattens InlineHTML's own per-run inline
    /// `<em>`/`<strong>` fonts back to one uniform font across the whole
    /// paragraph, since the blanket `.font` below overwrites whatever
    /// per-run font the bridge did or didn't carry. Losing rare inline
    /// emphasis is a smaller regression than losing the reading font or
    /// highlights entirely; revisit together if the bridging can be made
    /// to carry per-run custom fonts reliably.
    private func nsAttributedString(_ attributed: AttributedString) -> NSAttributedString {
        let mutable = NSMutableAttributedString(attributed)
        let fullRange = NSRange(location: 0, length: mutable.length)

        let style = NSMutableParagraphStyle()
        style.lineSpacing = RigTheme.readingLineSpacing
        mutable.addAttribute(.paragraphStyle, value: style, range: fullRange)

        FrauncesFont.ensureRegistered()
        let postScriptName =
            paragraph.isBlockquote ? FrauncesFont.italicPostScriptName : FrauncesFont.regularPostScriptName
        let font = NSFont(name: postScriptName, size: 17.5) ?? NSFont.systemFont(ofSize: 17.5)
        mutable.addAttribute(.font, value: font, range: fullRange)
        mutable.addAttribute(.foregroundColor, value: NSColor(RigTheme.text), range: fullRange)

        let utf16Count = paragraph.text.utf16.count
        for span in paragraph.highlightSpans {
            guard
                span.startOffset >= 0,
                span.endOffset <= utf16Count,
                span.startOffset <= span.endOffset
            else { continue }
            let range = NSRange(
                location: span.startOffset + indentLength,
                length: span.endOffset - span.startOffset
            )
            mutable.addAttribute(.backgroundColor, value: NSColor(RigTheme.accent.opacity(0.35)), range: range)
        }

        return mutable
    }
    #endif

    /// Prose paragraphs with no active highlight get real inline
    /// formatting (bold/italic/footnote markers) via InlineHTML, parsed
    /// from `paragraph.html`. Paragraphs with a highlight still use the
    /// plain-text + background-tint path below — combining rich inline
    /// formatting with a highlight's character-offset overlay is a real
    /// follow-up (the two AttributedStrings aren't built the same way),
    /// not done here.
    private var attributedText: AttributedString {
        let font = paragraph.isBlockquote ? RigTheme.readingFontItalic : RigTheme.readingFont
        var attributed =
            paragraph.highlightSpans.isEmpty
            ? InlineHTML.attributedString(from: paragraph.html, font: font, textColor: RigTheme.text)
            : highlightedText(font: font)

        // SwiftUI's Text has no text-indent — approximated with leading
        // whitespace, roughly matching organic.css's 3ch indent. Non-breaking
        // spaces, not plain ones: text layout engines routinely trim or
        // collapse plain leading whitespace at line-wrap boundaries; U+00A0
        // isn't eligible for that trimming. indentLength above has to stay
        // in sync with the count here.
        if indentLength > 0 {
            var indent = AttributedString(String(repeating: "\u{00A0}", count: indentLength))
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
    private func highlightedText(font: Font) -> AttributedString {
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
}

private struct NoteComposerTarget: Identifiable {
    let paragraph: ContentParagraph
    var id: String { paragraph.id }
}
