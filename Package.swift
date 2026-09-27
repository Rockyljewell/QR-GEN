// swift-tools-version:5.9
//
// QRGenKit: the native iOS / macOS package of the QRGen SDK.
// The manifest lives at the repository root so the package can be added with
// https://github.com/Rockyljewell/QR-GEN in Xcode or in another Package.swift.
// Sources live in packages/ios (see packages/ios/README.md).

import PackageDescription

let package = Package(
    name: "QRGenKit",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(name: "QRGenKit", targets: ["QRGenKit"]),
    ],
    targets: [
        .target(
            name: "QRGenKit",
            path: "packages/ios/Sources/QRGenKit"
        ),
        .testTarget(
            name: "QRGenKitTests",
            dependencies: ["QRGenKit"],
            path: "packages/ios/Tests/QRGenKitTests"
        ),
    ]
)
