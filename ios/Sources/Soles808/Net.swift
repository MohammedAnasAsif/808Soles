import Foundation

struct BridgeError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

/// What the web app may reach through the bridge. Same rules as Windows
/// (electron/main.cjs) and Android (CadencePlugin.java).
enum Policy {
    /// https only, exact names or ".suffix".
    static let allowedHosts = ["youtube.com", ".youtube.com", "youtubei.googleapis.com", ".googlevideo.com", "lrclib.net"]
    static let blockedHeaders: Set<String> = [
        "host", "cookie", "cookie2", "proxy-authorization", "authorization", "connection",
        "content-length", "transfer-encoding", "accept-encoding",
    ]
    static let maxResponse = 32 * 1024 * 1024
    static let maxRequestBody = 1024 * 1024
    static let maxDownload: Int64 = 400 * 1024 * 1024

    /// True for https URLs on the allowed hosts (default port, no credentials).
    static func allowed(_ url: URL?) -> Bool {
        guard let url,
              let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              c.scheme?.lowercased() == "https",
              c.user == nil, c.password == nil,
              c.port == nil || c.port == 443,
              let host = c.host?.lowercased(), !host.isEmpty
        else { return false }
        return allowedHosts.contains { $0.hasPrefix(".") ? host.hasSuffix($0) : host == $0 }
    }

    static func isMedia(_ url: URL?) -> Bool {
        guard allowed(url), let host = url?.host?.lowercased() else { return false }
        return host.hasSuffix(".googlevideo.com")
    }

    /// Drops headers the page mustn't set, and anything malformed.
    static func cleanHeaders(_ raw: Any?) -> [String: String] {
        guard let dict = raw as? [String: Any] else { return [:] }
        var out: [String: String] = [:]
        for (k, v) in dict {
            guard let value = v as? String else { continue }
            let key = k.lowercased()
            if blockedHeaders.contains(key) || !matches(key, "^[a-z0-9-]+$")
                || value.contains("\r") || value.contains("\n") { continue }
            out[k] = String(value.prefix(4096))
        }
        return out
    }
}

func matches(_ s: String, _ pattern: String) -> Bool {
    s.range(of: pattern, options: .regularExpression) != nil
}

/// Any JSON number (or numeric string) as a Double.
func num(_ v: Any?) -> Double? {
    if let n = v as? NSNumber { return n.doubleValue }
    if let s = v as? String { return Double(s) }
    return nil
}

/// HTTP for the bridge: no cookies or cache, redirects only to allowed hosts,
/// and responses are cut off past a size cap instead of filling memory.
final class Fetcher: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = Fetcher()

    struct Result {
        let status: Int
        let headers: [String: String]
        let body: Data
    }

    private struct Pending {
        var data = Data()
        var cap: Int
        var followRedirects: Bool
        var redirects = 0
        var tooLarge = false
        var response: HTTPURLResponse?
        let done: (Swift.Result<Result, Error>) -> Void
    }

    private var pending: [Int: Pending] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieAcceptPolicy = .never
        c.httpShouldSetCookies = false
        c.httpCookieStorage = nil
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest = 25
        c.timeoutIntervalForResource = 180
        c.tlsMinimumSupportedProtocolVersion = .TLSv12
        c.httpMaximumConnectionsPerHost = 6
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    func fetch(_ request: URLRequest, cap: Int) async throws -> Result {
        guard Policy.allowed(request.url) else {
            throw BridgeError("Blocked: only YouTube and LRCLIB can be contacted")
        }
        let follow = (request.httpMethod ?? "GET") != "POST"
        return try await withCheckedThrowingContinuation { cont in
            let task = session.dataTask(with: request)
            lock.withLock {
                pending[task.taskIdentifier] = Pending(cap: cap, followRedirects: follow) { cont.resume(with: $0) }
            }
            task.resume()
        }
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        let ok: Bool = lock.withLock {
            guard var p = pending[task.taskIdentifier], p.followRedirects, p.redirects < 5,
                  Policy.allowed(request.url) else { return false }
            p.redirects += 1
            pending[task.taskIdentifier] = p
            return true
        }
        // nil delivers the redirect itself, which fetch() then refuses.
        completionHandler(ok ? request : nil)
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let ok: Bool = lock.withLock {
            guard var p = pending[dataTask.taskIdentifier] else { return false }
            p.response = response as? HTTPURLResponse
            if response.expectedContentLength > Int64(p.cap) { p.tooLarge = true }
            pending[dataTask.taskIdentifier] = p
            return !p.tooLarge
        }
        completionHandler(ok ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let over: Bool = lock.withLock {
            guard var p = pending[dataTask.taskIdentifier] else { return false }
            if p.data.count + data.count > p.cap {
                p.tooLarge = true
            } else {
                p.data.append(data)
            }
            pending[dataTask.taskIdentifier] = p
            return p.tooLarge
        }
        if over { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let p = lock.withLock({ pending.removeValue(forKey: task.taskIdentifier) }) else { return }
        if p.tooLarge { return p.done(.failure(BridgeError("Response too large"))) }
        if let error { return p.done(.failure(BridgeError("Network error: \(error.localizedDescription)"))) }
        guard let res = p.response else { return p.done(.failure(BridgeError("No response"))) }
        if (300..<400).contains(res.statusCode) {
            return p.done(.failure(BridgeError("Redirect not allowed here")))
        }
        var headers: [String: String] = [:]
        for (k, v) in res.allHeaderFields {
            guard let key = (k as? String)?.lowercased() else { continue }
            if ["content-encoding", "content-length", "transfer-encoding", "set-cookie"].contains(key) { continue }
            headers[key] = "\(v)"
        }
        p.done(.success(Result(status: res.statusCode, headers: headers, body: p.data)))
    }
}
