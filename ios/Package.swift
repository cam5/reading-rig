// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ReadingRig",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ReadingRigKit", targets: ["ReadingRigKit"]),
        .library(name: "ReadingRigUI", targets: ["ReadingRigUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.5.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.6.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "ReadingRigKit",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
            ]
        ),
        .testTarget(
            name: "ReadingRigKitTests",
            dependencies: [
                "ReadingRigKit",
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),

        // SwiftUI screens, kept separate from ReadingRigKit so the pure
        // networking/model layer never has to link SwiftUI — a real iOS app
        // target (once one exists) imports both; ReadingRigDevApp below is
        // the only thing that imports just this one directly today.
        .target(
            name: "ReadingRigUI",
            dependencies: ["ReadingRigKit"],
            // The instanced Fraunces TTFs (scripts/instanceFrauncesForIOS.ts)
            // — .copy, not .process, so they land in Bundle.module verbatim
            // rather than SwiftPM guessing at an asset-catalog-style
            // transform for a file type it doesn't specially recognize.
            resources: [.copy("Resources")]
        ),

        // A `swift run`-able macOS window app around ReadingRigUI's screens
        // — exists so the screens are clickable today, on Command Line
        // Tools alone, without waiting on Xcode (or an XcodeGen-built iOS
        // app target) to be available. Not shipped anywhere; superseded by
        // a real iOS app target once one exists.
        .executableTarget(
            name: "ReadingRigDevApp",
            dependencies: ["ReadingRigUI"]
        ),
    ]
)
