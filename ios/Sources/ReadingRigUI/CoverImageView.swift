import ReadingRigKit
import SwiftUI

#if os(iOS)
import UIKit
private typealias PlatformImage = UIImage
#else
import AppKit
private typealias PlatformImage = NSImage
#endif

/// GET /cover/* — a plain authenticated image fetch, not the generated
/// OpenAPI client (that route isn't part of openapi.json; see
/// AuthSession.coverImageRequest's own comment). SwiftUI's built-in
/// AsyncImage can't be used here since it has no way to attach the
/// Authorization header this route now requires.
struct CoverImageView: View {
    let request: URLRequest?

    @State private var imageData: Data?
    @State private var failed = false

    var body: some View {
        Group {
            if let imageData, let platformImage = PlatformImage(data: imageData) {
                #if os(iOS)
                Image(uiImage: platformImage).resizable()
                #else
                Image(nsImage: platformImage).resizable()
                #endif
            } else {
                RoundedRectangle(cornerRadius: 4)
                    .fill(RigTheme.neutral400.opacity(0.4))
            }
        }
        .aspectRatio(2 / 3, contentMode: .fill)
        .frame(width: 40, height: 60)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .task(id: request) { await load() }
    }

    private func load() async {
        guard !failed, let request else { return }
        guard
            let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse,
            http.statusCode == 200
        else {
            failed = true
            return
        }
        imageData = data
    }
}
