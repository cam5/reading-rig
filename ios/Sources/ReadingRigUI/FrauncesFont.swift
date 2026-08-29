import CoreText
import SwiftUI

/// Registers the instanced Fraunces TTFs bundled under Fonts/
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
    /// Not `private` — SelectableParagraphText's host view needs these to
    /// build an `NSFont` directly (see its own comment on why `Font.custom`
    /// alone isn't enough there).
    static let regularPostScriptName = "Fraunces-9ptBlack"
    static let italicPostScriptName = "Fraunces-9ptBlackItalic"

    /// `.process` scope: registered for this process only, not installed
    /// system-wide — no permission prompt, and nothing to clean up.
    ///
    /// `subdirectory: "Fonts"` is load-bearing, not decorative:
    /// `.copy("Fonts")` (Package.swift) preserves "Fonts" as a real nested
    /// directory inside the resource bundle rather than flattening its
    /// contents to the bundle root, and `Bundle.url(forResource:
    /// withExtension:)` only searches the bundle's top level by default.
    /// Without this, the lookup fails silently (`Font.custom` falls back
    /// to the system font rather than crashing) — confirmed fresh on iOS,
    /// where it silently failed; it happened to still "work" in local
    /// macOS builds only because a stale "Resources/" folder from before
    /// this bundle was renamed off that name (see Package.swift's own
    /// comment on why) was still sitting in .build/ and macOS's bundle
    /// lookup treats a top-level "Resources" directory as an implicit
    /// search location — coincidence, not correctness.
    private static let didRegister: Void = {
        for resourceName in ["Fraunces-Reading-Regular", "Fraunces-Reading-Italic"] {
            guard
                let url = Bundle.module.url(
                    forResource: resourceName,
                    withExtension: "ttf",
                    subdirectory: "Fonts"
                )
            else {
                continue
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    /// Anything building an `NSFont`/`UIFont` from `regularPostScriptName`/
    /// `italicPostScriptName` directly (bypassing `regular(size:)`/
    /// `italic(size:)` below) has to call this first, or the name lookup
    /// fails against an unregistered font.
    public static func ensureRegistered() {
        _ = didRegister
    }

    public static func regular(size: CGFloat) -> Font {
        ensureRegistered()
        return Font.custom(regularPostScriptName, size: size)
    }

    public static func italic(size: CGFloat) -> Font {
        ensureRegistered()
        return Font.custom(italicPostScriptName, size: size)
    }
}
