import ReadingRigKit
import SwiftUI

/// GET /api/v1/read/:workId, rendered as a scrollable column of paragraphs.
/// Plain text only for now — highlights, notes, and footnotes are already
/// on the wire (see ContentParagraph) but not rendered here yet.
public struct WorkReadView: View {
    private let client: Client
    private let workId: String
    private let title: String

    @State private var paragraphs: [ContentParagraph] = []
    @State private var errorMessage: String?

    public init(client: Client, workId: String, title: String) {
        self.client = client
        self.workId = workId
        self.title = title
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                ForEach(paragraphs, id: \.id) { paragraph in
                    Text(paragraph.text)
                        .font(paragraph.isBlockquote ? RigTheme.readingFont.italic() : RigTheme.readingFont)
                        .foregroundStyle(RigTheme.text)
                        .padding(.leading, paragraph.isBlockquote ? 16 : 0)
                }
            }
            .padding()
        }
        .background(RigTheme.background)
        .navigationTitle(title)
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
