// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AppleStillImageProbe",
    platforms: [.macOS(.v12)],
    products: [.executable(name: "AppleStillImageProbe", targets: ["AppleStillImageProbe"])],
    dependencies: [.package(name: "QRGenSource", path: "QRGenSource")],
    targets: [
        .executableTarget(
            name: "AppleStillImageProbe",
            dependencies: [.product(name: "QRGenKit", package: "QRGenSource")]
        )
    ]
)
