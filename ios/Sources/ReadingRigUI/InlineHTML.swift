import Foundation
import SwiftUI

/// Renders `ContentParagraph.html`'s inline markup as an `AttributedString`
/// — not general HTML: sanitizeHtml.ts (app/domain/epub/sanitizeHtml.ts)
/// strips everything down to a deliberately narrow allow-list before this
/// ever sees it (`em`, `i`, `strong`, `b`, `sup`, `sub` — its own
/// `ALLOWED_TAGS`), the same trust boundary ReadingParagraph.tsx's doc
/// comment states for its `dangerouslySetInnerHTML`. A hand-rolled
/// `XMLParser` walk over that narrow set is simpler and cheaper than
/// pulling in `NSAttributedString`'s full HTML importer, which brings its
/// own default fonts/paragraph styles that would fight `RigTheme`.
///
/// Footnote markers (`<sup data-footnote-ref>`) render as plain
/// superscript text here, not the web app's interactive popover
/// (`FootnoteMarkerLazy`) — that's a real UI feature of its own, out of
/// scope for matching text formatting.
enum InlineHTML {
    static func attributedString(from html: String, font: Font, textColor: Color) -> AttributedString {
        // XMLParser only accepts well-formed XML — sanitizeHtml.ts's output
        // is real HTML, which can carry named entities (`&nbsp;` etc.)
        // that aren't valid XML entities. The allow-listed tags never nest
        // attributes XMLParser would choke on otherwise, so this
        // substitution is the only pre-processing needed.
        let xmlSafe =
            html
            .replacingOccurrences(of: "&nbsp;", with: "\u{00A0}")
            .replacingOccurrences(of: "&mdash;", with: "\u{2014}")
            .replacingOccurrences(of: "&ndash;", with: "\u{2013}")
            .replacingOccurrences(of: "&hellip;", with: "\u{2026}")
            .replacingOccurrences(of: "&lsquo;", with: "\u{2018}")
            .replacingOccurrences(of: "&rsquo;", with: "\u{2019}")
            .replacingOccurrences(of: "&ldquo;", with: "\u{201C}")
            .replacingOccurrences(of: "&rdquo;", with: "\u{201D}")

        guard let data = "<root>\(xmlSafe)</root>".data(using: .utf8) else {
            return AttributedString(html)
        }

        let delegate = InlineHTMLParserDelegate(font: font, textColor: textColor)
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse() else {
            // Malformed markup somehow survived sanitization — fall back to
            // the tags-stripped plain text rather than showing nothing.
            return AttributedString(
                html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            )
        }
        return delegate.result
    }
}

private final class InlineHTMLParserDelegate: NSObject, XMLParserDelegate {
    private(set) var result = AttributedString()
    private var styleStack: [String] = []
    private let font: Font
    private let textColor: Color

    init(font: Font, textColor: Color) {
        self.font = font
        self.textColor = textColor
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        guard elementName != "root" else { return }
        styleStack.append(elementName)
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        guard elementName != "root" else { return }
        styleStack.removeLast()
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        var chunk = AttributedString(string)
        chunk.foregroundColor = textColor

        let isSuperscriptOrSubscript = styleStack.contains("sup") || styleStack.contains("sub")
        var chunkFont = isSuperscriptOrSubscript ? Font.system(.caption, design: .serif) : font
        if styleStack.contains("strong") || styleStack.contains("b") { chunkFont = chunkFont.bold() }
        if styleStack.contains("em") || styleStack.contains("i") { chunkFont = chunkFont.italic() }
        chunk.font = chunkFont

        if styleStack.contains("sup") {
            chunk.baselineOffset = 5
        } else if styleStack.contains("sub") {
            chunk.baselineOffset = -3
        }

        result += chunk
    }
}
