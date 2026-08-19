import CoreText
import SwiftUI

/// Registers the instanced Fraunces TTFs bundled under Resources/
/// (scripts/instanceFrauncesForIOS.ts — same pinned wght 340/opsz
/// 18/SOFT 60/WONK 0 point organic.css's `.font-reading` rule uses,
/// output as a real .ttf instead of the web's woff2) and exposes them as
/// SwiftUI Fonts.
///
/// The PostScript names below are stale leftovers from the source
/// variable font's nearest built-in named instance ("9pt Black") —
/// harfbuzz-subset (subset-font) doesn't rewrite the name table to
/// describe the actual instanced axis values, so the name says "Black"
/// while the real weight is 340 (nowhere near Black). They're still the
/// real, unique names CoreText registers these files under, confirmed by
/// reading the generated TTFs' own `name` table — re-check the same way
/// (or with Font Book) if the source font or instancing point ever
/// changes; `Font.custom` silently falls back to the system font on a
/// mismatch rather than crashing, so a stale name here fails quietly, not
/// loudly.
enum FrauncesFont {
    private static let regularPostScriptName = "Fraunces-9ptBlack"
    private static let italicPostScriptName = "Fraunces-9ptBlackItalic"

    /// `.process` scope: registered for this process only, not installed
    /// system-wide — no permission prompt, and nothing to clean up.
    private static let didRegister: Void = {
        for resourceName in ["Fraunces-Reading-Regular", "Fraunces-Reading-Italic"] {
            guard let url = Bundle.module.url(forResource: resourceName, withExtension: "ttf") else {
                continue
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    public static func regular(size: CGFloat) -> Font {
        _ = didRegister
        return Font.custom(regularPostScriptName, size: size)
    }

    public static func italic(size: CGFloat) -> Font {
        _ = didRegister
        return Font.custom(italicPostScriptName, size: size)
    }
}
