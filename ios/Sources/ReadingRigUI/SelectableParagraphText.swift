#if os(macOS)
import AppKit
import SwiftUI

/// A selectable (not editable) text view backing WorkReadView's
/// paragraphs on macOS — plain SwiftUI `Text` has `.textSelection(.enabled)`,
/// which turns on the OS's native drag-to-select + copy/share interaction,
/// but exposes no way to read back *which* range got selected. An app
/// action like "highlight exactly what I just selected" needs that range,
/// so this drops to `NSTextView` (which has always had it) wrapped for
/// SwiftUI instead.
///
/// macOS-only: there's no iOS runtime to verify a `UITextView` equivalent
/// against yet (see README's "no real app target" gap) — the same overall
/// approach (a selectable, non-editable text view + a selection delegate)
/// would translate, but isn't built here. `WorkReadView` falls back to
/// plain `Text` on iOS, which keeps working exactly as before (no
/// drag-select, whole-paragraph highlight only via the context menu).
struct SelectableParagraphText: NSViewRepresentable {
    let attributedString: NSAttributedString
    @Binding var selectedRange: NSRange?
    /// `NSTextView` has no intrinsic size SwiftUI's layout system can read
    /// the way `Text` does — this reports the laid-out height back so the
    /// caller can size a `.frame(height:)` around it instead of the view
    /// collapsing to zero or clipping.
    @Binding var measuredHeight: CGFloat

    func makeNSView(context: Context) -> NSTextView {
        let textView = NSTextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.drawsBackground = false
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.delegate = context.coordinator
        return textView
    }

    func updateNSView(_ nsView: NSTextView, context: Context) {
        if nsView.textStorage?.string != attributedString.string {
            nsView.textStorage?.setAttributedString(attributedString)
        }
        DispatchQueue.main.async {
            guard let layoutManager = nsView.layoutManager, let textContainer = nsView.textContainer else {
                return
            }
            layoutManager.ensureLayout(for: textContainer)
            let height = layoutManager.usedRect(for: textContainer).height
            if abs(height - measuredHeight) > 0.5 {
                measuredHeight = height
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(selectedRange: $selectedRange)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        private let selectedRange: Binding<NSRange?>

        init(selectedRange: Binding<NSRange?>) {
            self.selectedRange = selectedRange
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            let range = textView.selectedRange()
            selectedRange.wrappedValue = range.length > 0 ? range : nil
        }
    }
}
#endif
