// swift-tools-version: 6.0
// The 808Soles iPhone/iPad app: a native shell (WKWebView + AVPlayer) around
// the same web app the Windows and Android versions use. Built with xtool
// (`xtool dev`), or by CI into an unsigned .ipa (build-ipa.sh).
import PackageDescription

let package = Package(
    name: "Soles808",
    platforms: [.iOS(.v17)],
    products: [
        // xtool bundles this library into the app (see xtool.yml).
        .library(name: "Soles808", targets: ["Soles808"]),
    ],
    targets: [
        .target(
            name: "Soles808",
            // The built web app, copied here by `npm run ios:web`.
            resources: [.copy("Web")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
