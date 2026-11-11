import Foundation

/// Offline copies, in the app's private Application Support folder (not
/// backed up to iCloud). Files are named `<video id>.<ext>`.
enum Downloads {
    static let chunk = 4 * 1024 * 1024
    static let namePattern = "^[A-Za-z0-9_-]{6,20}\\.[a-z0-9]{2,5}$"

    static func directory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var dir = base.appendingPathComponent("downloads", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
        }
        return dir
    }

    /**
     * The current location of a downloaded file, or nil if `url` isn't one.
     * Matched by name only: iOS moves the app's folder when the app is
     * updated, so a saved absolute path can go stale while the file is fine.
     */
    static func resolve(_ url: URL) -> URL? {
        guard url.isFileURL else { return nil }
        let name = url.lastPathComponent
        guard matches(name, namePattern), let dir = try? directory() else { return nil }
        let file = dir.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    /// Saves a googlevideo stream in ranged chunks. Returns path/url/size for the web app.
    static func save(
        id: String, ext: String, url: URL, headers: [String: String], sizeHint: Int64,
        progress: @escaping @Sendable (Int64, Int64) -> Void
    ) async throws -> [String: Any] {
        let dir = try directory()
        let fin = dir.appendingPathComponent("\(id).\(ext)")
        let part = dir.appendingPathComponent("\(id).\(ext).part")
        FileManager.default.createFile(atPath: part.path, contents: nil)
        var received: Int64 = 0
        var total: Int64 = max(0, min(sizeHint, Policy.maxDownload))
        do {
            let handle = try FileHandle(forWritingTo: part)
            defer { try? handle.close() }
            while true {
                var end = received + Int64(chunk) - 1
                if total > 0 { end = min(end, total - 1) }
                var req = URLRequest(url: url)
                for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
                req.setValue("bytes=\(received)-\(end)", forHTTPHeaderField: "Range")
                let r = try await Fetcher.shared.fetch(req, cap: chunk + 1)
                guard r.status == 200 || r.status == 206 else { throw BridgeError("HTTP \(r.status)") }
                if let range = r.headers["content-range"], let slash = range.lastIndex(of: "/"),
                   let t = Int64(range[range.index(after: slash)...].trimmingCharacters(in: .whitespaces)) {
                    total = t
                }
                if total > Policy.maxDownload || received + Int64(r.body.count) > Policy.maxDownload {
                    throw BridgeError("File too large")
                }
                try handle.write(contentsOf: r.body)
                received += Int64(r.body.count)
                progress(received, total)
                if r.body.isEmpty || r.status == 200 || (total > 0 && received >= total) { break }
            }
        } catch {
            try? FileManager.default.removeItem(at: part)
            let message = (error as? BridgeError)?.message ?? error.localizedDescription
            throw BridgeError("Download failed: \(message)")
        }
        try? FileManager.default.removeItem(at: fin)
        do {
            try FileManager.default.moveItem(at: part, to: fin)
        } catch {
            try? FileManager.default.removeItem(at: part)
            throw BridgeError("Couldn't save the file")
        }
        return ["path": fin.path, "url": fin.absoluteString, "size": received]
    }

    static func delete(path: String) throws {
        guard let file = resolve(URL(fileURLWithPath: path)) else {
            // Already gone, or not a download: nothing to delete here.
            if matches(URL(fileURLWithPath: path).lastPathComponent, namePattern) { return }
            throw BridgeError("Not a download")
        }
        try FileManager.default.removeItem(at: file)
    }
}
