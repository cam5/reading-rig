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

    /// --font-reading's fallback stack ends in Georgia/serif — Fraunces
    /// itself isn't bundled into the app yet (organic.css's copy is
    /// subsetted per-build by scripts/instanceFraunces.ts, which has no iOS
    /// equivalent), so reading text uses the system serif design instead of
    /// the real typeface, matching Fraunces' proportions only loosely.
    public static let readingFont = Font.system(.body, design: .serif)
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
