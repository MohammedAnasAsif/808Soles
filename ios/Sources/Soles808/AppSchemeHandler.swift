import Foundation
import WebKit

/// Where the built web app is inside the app bundle.
enum WebRoot {
    static let url: URL? = {
        #if SWIFT_PACKAGE
        // Built by xtool / SwiftPM: the target's resource bundle.
        if let u = Bundle.module.url(forResource: "Web", withExtension: nil) { return u }
        #endif
        // Built by build-ipa.sh: a folder at the app's root.
        return Bundle.main.url(forResource: "Web", withExtension: nil)
    }()
}

/// Serves the web app at app://bundle/ with security headers, like the
/// Windows app's app:// protocol. Only files inside the web folder are served.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    static let host = "bundle"
    static let startURL = URL(string: "app://bundle/index.html")!

    static func isAppURL(_ url: URL) -> Bool {
        url.scheme == scheme && url.host == host
    }

    /// Same policy as Android (src/lib/csp.ts): no inline, injected or remote
    /// script, no eval, and no network from the page (it goes through Bridge).
    static let pageCSP = [
        "default-src 'self'",
        "script-src 'self'",
        "worker-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: data: blob:",
        "media-src 'self' https: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].joined(separator: "; ")

    /// The worker that runs YouTube's player code may compute, nothing else.
    static let workerCSP = "default-src 'none'; script-src 'self' 'unsafe-eval'"

    private let root: URL? = WebRoot.url?.standardizedFileURL.resolvingSymlinksInPath()

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json",
        "webmanifest": "application/manifest+json",
        "png": "image/png",
        "jpg": "image/jpeg",
        "svg": "image/svg+xml",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "woff2": "font/woff2",
        "woff": "font/woff",
        "ttf": "font/ttf",
        "wasm": "application/wasm",
        "txt": "text/plain; charset=utf-8",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, Self.isAppURL(url), let root else {
            return respond(task, status: 404, data: Data(), type: "text/plain")
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst()))
            .standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe)
        else {
            return respond(task, status: 404, data: Data(), type: "text/plain")
        }
        let ext = file.pathExtension.lowercased()
        var extra: [String: String] = [:]
        if ext == "html" {
            extra["Content-Security-Policy"] = Self.pageCSP
        } else if file.lastPathComponent.range(of: "^decipher-worker[-.]", options: .regularExpression) != nil {
            extra["Content-Security-Policy"] = Self.workerCSP
        }
        respond(task, status: 200, data: data, type: Self.types[ext] ?? "application/octet-stream", extra: extra)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, status: Int, data: Data, type: String, extra: [String: String] = [:]) {
        var headers = [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
            "Referrer-Policy": "no-referrer",
        ]
        headers.merge(extra) { _, new in new }
        let response = HTTPURLResponse(url: task.request.url ?? Self.startURL, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
