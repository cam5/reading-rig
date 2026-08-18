// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ReadingRigKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ReadingRigKit", targets: ["ReadingRigKit"])
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
    ]
)
