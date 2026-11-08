// swift-tools-version: 5.9
// FollowCore: everything the iPhone app knows about Nightscout and glucose, with no UIKit, so
// `swift test` runs on Linux (claude-agents) as well as on the Mac.
import PackageDescription

let package = Package(
    name: "FollowCore",
    platforms: [.iOS("17.2"), .macOS(.v14)],
    products: [
        .library(name: "FollowCore", targets: ["FollowCore"]),
    ],
    targets: [
        .target(name: "FollowCore"),
        .testTarget(
            name: "FollowCoreTests",
            dependencies: ["FollowCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
