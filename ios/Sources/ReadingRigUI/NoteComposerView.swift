import SwiftUI

/// A minimal compose sheet — body text only, no mention/attachment support
/// the web composer has. Good enough for a first pass at writing a note
/// from the iOS client at all.
struct NoteComposerView: View {
    let onSave: (String) async -> Void

    @State private var noteText = ""
    @State private var isSaving = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TextEditor(text: $noteText)
                .padding()
                .background(RigTheme.background)
                .navigationTitle("New Note")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            let text = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !text.isEmpty else { return }
                            isSaving = true
                            Task {
                                await onSave(text)
                                isSaving = false
                                dismiss()
                            }
                        }
                        .disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                    }
                }
        }
    }
}
