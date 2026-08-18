import ReadingRigKit
import SwiftUI

/// GET /api/v1/home, rendered as a tappable list — the app's home screen.
public struct ShelfListView: View {
    private let client: Client

    @State private var works: [ShelfWork] = []
    @State private var errorMessage: String?

    public init(client: Client) {
        self.client = client
    }

    public var body: some View {
        List(works, id: \.id) { work in
            NavigationLink {
                WorkReadView(client: client, workId: work.id, title: work.title)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(work.title)
                        .font(.headline)
                        .foregroundStyle(RigTheme.text)
                    if let author = work.author {
                        Text(author)
                            .font(.subheadline)
                            .foregroundStyle(RigTheme.neutral600)
                    }
                }
                .listRowBackground(RigTheme.background)
            }
        }
        .tint(RigTheme.accent)
        .scrollContentBackground(.hidden)
        .background(RigTheme.background)
        .navigationTitle("Shelf")
        .overlay {
            if let errorMessage {
                ContentUnavailableView(
                    "Couldn't load your shelf",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else if works.isEmpty {
                ProgressView()
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            let response = try await client.getHome(.init())
            switch try response.ok.body {
            case .json(let payload):
                works = payload.works
                errorMessage = nil
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
