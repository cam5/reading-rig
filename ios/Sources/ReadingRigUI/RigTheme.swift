import SwiftUI

/// Mirrors app/styles/organic.css's custom-property palette — kept as a
/// flat, hand-copied set of constants (not generated from the CSS file)
/// since there's no shared design-token source of truth between the two
/// yet; if organic.css's values change, these need updating by hand too.
/// The web app has no dark-mode block, so this doesn't define one either —
/// same single light palette regardless of the device's appearance setting.
public enum RigTheme {
    public static let background = Color(hex: 0xF5_EA_D8) // --color-bg
    public static let surface = Color(hex: 0xDE_C8_A0) // --color-surface
    public static let text = Color(hex: 0x20_1E_1D) // --color-text
    public static let accent = Color(hex: 0xC6_71_39) // --color-accent
    public static let accent2 = Color(hex: 0x7A_8A_5E) // --color-accent-2

    public static let neutral200 = Color(hex: 0xEE_E7_DB)
    public static let neutral400 = Color(hex: 0xC0_B6_A5)
    public static let neutral600 = Color(hex: 0x82_79_6A)

    /// The real Fraunces, via FrauncesFont — see that file for how it's
    /// bundled/registered. A literal 17.5pt, not a Dynamic Type text
    /// style — ReadingParagraph.module.css's own `.paragraph` recipe is a
    /// literal 17.5px too (see its comment: "a single call site, not a
    /// shared UI text size"), so this matches that literalness rather
    /// than scaling with the system text-size setting the way the rest of
    /// this app's UI chrome should.
    public static let readingFont = FrauncesFont.regular(size: 17.5)
    /// Fraunces' real italic face — not `.italic()` on `readingFont`,
    /// which would ask SwiftUI to synthesize an oblique from the roman
    /// weight rather than use the typeface's own italic drawing.
    public static let readingFontItalic = FrauncesFont.italic(size: 17.5)

    /// The approximated-1.8-line-height extra gap `readingFont`'s own doc
    /// comment mentions — used as both `Text.lineSpacing` (the gap between
    /// wrapped lines *within* one paragraph) and the reading column's
    /// paragraph-to-paragraph spacing (WorkReadView's outer LazyVStack).
    /// Both have to use the same value: CSS's `line-height` applies
    /// uniformly to every line including across a `margin: 0` paragraph
    /// boundary, but SwiftUI's `lineSpacing` only inserts space *between*
    /// lines inside a single Text — a separate VStack spacing of 0 between
    /// Text views (this reading column's actual layout, chosen to match
    /// print-style "the indent is the only paragraph-break cue") leaves
    /// paragraph boundaries visibly tighter than the lines within a
    /// paragraph unless the same gap is applied there too.
    public static let readingLineSpacing: CGFloat = 9
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
