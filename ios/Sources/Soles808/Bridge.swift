import UIKit
import WebKit

/// The web app's only door to native code: `webkit.messageHandlers.cadence`.
/// Same methods as the Android plugin (see src/platform/ios.ts).
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?
    private let player = Player()

    override init() {
        super.init()
        player.emit = { [weak self] event, data, critical in self?.emit(event, data, critical: critical) }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        // Only the app's own page, in its main frame.
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == AppSchemeHandler.scheme, origin.host == AppSchemeHandler.host,
              let body = message.body as? [String: Any],
              let method = body["method"] as? String
        else { return replyHandler(nil, "Not allowed") }
        let args = body["args"] as? [String: Any] ?? [:]
        Task { @MainActor in
            do {
                replyHandler(try await self.handle(method, args), nil)
            } catch {
                replyHandler(nil, (error as? BridgeError)?.message ?? error.localizedDescription)
            }
        }
    }

    private func handle(_ method: String, _ a: [String: Any]) async throws -> Any? {
        switch method {
        case "http":
            return try await http(a)
        case "download":
            return try await download(a)
        case "deleteDownload":
            try Downloads.delete(path: a["path"] as? String ?? "")
            return nil
        case "load":
            guard let s = Source.from(a) else { throw BridgeError("Not a playable URL") }
            player.load(s, startMs: num(a["startMs"]) ?? 0, autoplay: a["autoplay"] as? Bool ?? true)
        case "prepareNext":
            guard let s = Source.from(a) else { throw BridgeError("Not a playable URL") }
            player.prepareNext(s)
        case "setUpcoming":
            let list = (a["sources"] as? [[String: Any]] ?? []).prefix(20).compactMap(Source.from)
            player.setUpcoming(Array(list))
        case "clearNext":
            player.clearNext()
        case "play":
            player.play()
        case "pause":
            player.pause()
        case "seek":
            player.seek(ms: num(a["positionMs"]) ?? 0)
        case "setCrossfade":
            player.setCrossfade(ms: num(a["ms"]) ?? 0)
        case "setVolume":
            player.setVolume(Float(num(a["volume"]) ?? 1))
        case "stop":
            player.stopAll()
        case "getState":
            return [String: Any]()
        case "requestNotificationPermission", "minimize":
            // Nothing to do on iOS (an app can't send itself to the background).
            return nil
        default:
            throw BridgeError("Unknown method")
        }
        return nil
    }

    // MARK: Network

    private func http(_ a: [String: Any]) async throws -> [String: Any] {
        guard let raw = a["url"] as? String, let url = URL(string: raw), Policy.allowed(url) else {
            throw BridgeError("Blocked: only YouTube and LRCLIB can be contacted")
        }
        let method = (a["method"] as? String ?? "GET").uppercased()
        guard ["GET", "POST", "HEAD"].contains(method) else { throw BridgeError("Method not allowed") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        for (k, v) in Policy.cleanHeaders(a["headers"]) { req.setValue(v, forHTTPHeaderField: k) }
        if method == "POST", let b64 = a["bodyBase64"] as? String {
            guard let body = Data(base64Encoded: b64), body.count <= Policy.maxRequestBody else {
                throw BridgeError("Request too large")
            }
            req.httpBody = body
        }
        let r = try await Fetcher.shared.fetch(req, cap: Policy.maxResponse)
        return ["status": r.status, "headers": r.headers, "bodyBase64": r.body.base64EncodedString()]
    }

    private func download(_ a: [String: Any]) async throws -> [String: Any] {
        let id = a["id"] as? String ?? ""
        let ext = a["ext"] as? String ?? ""
        guard matches(id, "^[A-Za-z0-9_-]{6,20}$"), matches(ext, "^[a-z0-9]{2,5}$"),
              let raw = a["url"] as? String, let url = URL(string: raw), Policy.isMedia(url)
        else { throw BridgeError("Bad download request") }
        return try await Downloads.save(
            id: id, ext: ext, url: url,
            headers: Policy.cleanHeaders(a["headers"]),
            sizeHint: Int64(num(a["size"]) ?? 0)
        ) { [weak self] received, total in
            Task { @MainActor in
                self?.emit("downloadProgress", ["id": id, "received": received, "total": total], critical: false)
            }
        }
    }

    // MARK: Events to the web app

    /**
     * Calls `window.__cadenceNative.emit(event, data)` in the page. Frequent
     * events (playback position, download progress) aren't sent while the app
     * is in the background: iOS has paused the page and they'd only pile up.
     */
    func emit(_ event: String, _ data: [String: Any], critical: Bool) {
        guard let web = webView else { return }
        if !critical && UIApplication.shared.applicationState == .background { return }
        web.callAsyncJavaScript(
            "window.__cadenceNative && window.__cadenceNative.emit(e, d)",
            arguments: ["e": event, "d": data],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }
}
