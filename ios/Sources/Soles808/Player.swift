import AVFoundation
import MediaPlayer
import UIKit

struct Source {
    var url: URL
    var userAgent: String?
    var title = ""
    var artist = ""
    var album = ""
    var artworkURL: URL?
    var gain: Float = 1

    /// Streams from googlevideo, or files in our downloads folder; nothing else.
    static func from(_ a: [String: Any]) -> Source? {
        guard let raw = a["url"] as? String, var url = URL(string: raw) else { return nil }
        if url.isFileURL {
            guard let local = Downloads.resolve(url) else { return nil }
            url = local
        } else if !Policy.isMedia(url) {
            return nil
        }
        var s = Source(url: url)
        // AVFoundation's public API sets only the User-Agent; it's the one header the streams need.
        s.userAgent = Policy.cleanHeaders(a["headers"]).first { $0.key.lowercased() == "user-agent" }?.value
        let meta = a["meta"] as? [String: Any] ?? [:]
        s.title = String((meta["title"] as? String ?? "").prefix(500))
        s.artist = String((meta["artist"] as? String ?? "").prefix(500))
        s.album = String((meta["album"] as? String ?? "").prefix(500))
        // Lock-screen artwork is downloaded natively: https only.
        if let art = meta["artworkUrl"] as? String, art.hasPrefix("https://") { s.artworkURL = URL(string: art) }
        s.gain = Float(min(max(num(a["gain"]) ?? 1, 0), 1))
        return s
    }
}

/**
 * Plays audio with two AVPlayers ("decks"), so the next song can be preloaded
 * and crossfaded in, and drives the lock screen / Control Center.
 *
 * It mirrors Android's PlaybackService, plus one thing iOS needs: iOS pauses
 * the web view while the app is in the background, so the web app can't
 * prepare each next song there. It hands over the next few songs in advance
 * (setUpcoming) and this class plays on through them, telling the web app
 * ("advanced") so it catches up when it's back.
 */
@MainActor
final class Player {
    /// (event, data, critical). Non-critical events are dropped while in the background.
    var emit: (String, [String: Any], Bool) -> Void = { _, _, _ in }

    private final class Deck {
        let player = AVPlayer()
        var source: Source?
        var gain: Float = 1
        var fade: Float = 1
        var ended = false
        var failed = false
        var observers: [NSObjectProtocol] = []
        var status: NSKeyValueObservation?
    }

    private let decks = [Deck(), Deck()]
    private var active = 0
    private var nextReady = false
    private var upcoming: [Source] = []
    /// A next song that arrived mid-crossfade; prepared once the fade ends.
    private var pendingNext: Source?
    private var crossfadeMs: Double = 6000
    private var master: Float = 1
    private var fadeStart: CFTimeInterval = -1
    private var fadeLength: Double = 0
    private var wantPlaying = false
    private var advancedAt: CFTimeInterval = 0
    private var lastStateHash = 0
    private var lastDurationSec = -1
    private var observers: [NSObjectProtocol] = []
    private var interruptedWhilePlaying = false
    private var timer: Timer?

    private var artwork: MPMediaItemArtwork?
    private var artworkFor: URL?
    private var artworkTask: URLSessionDataTask?
    private let artworkSession: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieAcceptPolicy = .never
        c.httpShouldSetCookies = false
        c.timeoutIntervalForRequest = 15
        return URLSession(configuration: c)
    }()

    init() {
        for d in decks {
            d.player.actionAtItemEnd = .pause
            d.player.automaticallyWaitsToMinimizeStalling = true
        }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        setUpRemoteCommands()
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            let info = n.userInfo
            MainActor.assumeIsolated { self?.onInterruption(info) }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] n in
            let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            MainActor.assumeIsolated {
                // Headphones unplugged: pause, like every music app.
                if let raw, AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable { self?.pause() }
            }
        })
        observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.emitState(force: true) }
        })
        let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    // MARK: Commands from the web app

    func load(_ s: Source, startMs: Double, autoplay: Bool) {
        finishFade()
        pendingNext = nil
        upcoming = []
        setSource(1 - active, nil)
        nextReady = false
        start(s, on: active, startMs: startMs, play: autoplay)
        emitState(force: true)
    }

    func prepareNext(_ s: Source) {
        if fadeStart >= 0 {
            pendingNext = s
            return
        }
        let other = 1 - active
        let d = decks[other]
        if nextReady, d.source?.url == s.url, !d.failed {
            // Already preloaded (by ourselves, from `upcoming`).
            d.source = s
            d.gain = s.gain
            applyVolume(other)
            return
        }
        d.gain = s.gain
        d.fade = 1
        setSource(other, s)
        applyVolume(other)
        nextReady = true
        upcoming.removeAll { $0.url == s.url }
    }

    func setUpcoming(_ list: [Source]) {
        var l = list
        let skip = [decks[active].source?.url, nextReady ? decks[1 - active].source?.url : nil, pendingNext?.url]
        while let first = l.first, skip.contains(first.url) { l.removeFirst() }
        upcoming = l
    }

    func clearNext() {
        upcoming = []
        pendingNext = nil
        if fadeStart >= 0 { return }
        setSource(1 - active, nil)
        nextReady = false
    }

    func play() {
        wantPlaying = true
        activateSession()
        decks[active].player.play()
        if fadeStart >= 0 { decks[1 - active].player.play() }
        updateNowPlaying(full: false)
        emitState(force: true)
    }

    func pause() {
        wantPlaying = false
        decks[active].player.pause()
        if fadeStart >= 0 { decks[1 - active].player.pause() }
        updateNowPlaying(full: false)
        emitState(force: true)
    }

    func seek(ms: Double) {
        finishFade()
        let d = decks[active]
        d.ended = false
        d.player.seek(to: CMTime(seconds: max(0, ms) / 1000, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
        if wantPlaying { d.player.play() }
        updateNowPlaying(full: false, positionMs: max(0, ms))
        emitState(force: true)
    }

    func setCrossfade(ms: Double) { crossfadeMs = max(0, ms) }

    func setVolume(_ v: Float) {
        master = min(max(v, 0), 1)
        applyVolume(0)
        applyVolume(1)
    }

    func stopAll() {
        wantPlaying = false
        fadeStart = -1
        pendingNext = nil
        upcoming = []
        nextReady = false
        setSource(0, nil)
        setSource(1, nil)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        emitState(force: true)
    }

    // MARK: Decks

    private func item(for s: Source) -> AVPlayerItem {
        var options: [String: Any] = [:]
        if let ua = s.userAgent { options[AVURLAssetHTTPUserAgentKey] = ua }
        return AVPlayerItem(asset: AVURLAsset(url: s.url, options: options))
    }

    private func setSource(_ deck: Int, _ s: Source?, startMs: Double = 0) {
        let d = decks[deck]
        d.player.pause()
        d.status = nil
        d.observers.forEach { NotificationCenter.default.removeObserver($0) }
        d.observers = []
        d.source = s
        d.ended = false
        d.failed = false
        guard let s else {
            d.player.replaceCurrentItem(with: nil)
            return
        }
        let item = item(for: s)
        d.status = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard item.status == .failed else { return }
                    self?.onDeckError(deck, item)
                }
            }
        }
        let nc = NotificationCenter.default
        d.observers.append(nc.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.onDeckEnded(deck, item) }
        })
        d.observers.append(nc.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.onDeckError(deck, item) }
        })
        d.player.replaceCurrentItem(with: item)
        if startMs > 0 {
            d.player.seek(to: CMTime(seconds: startMs / 1000, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
        }
    }

    /// Plays `s` on `deck` straight away (used by load, and when skipping ahead natively).
    private func start(_ s: Source, on deck: Int, startMs: Double = 0, play: Bool) {
        let d = decks[deck]
        d.gain = s.gain
        d.fade = 1
        setSource(deck, s, startMs: startMs)
        applyVolume(deck)
        wantPlaying = play
        if play {
            activateSession()
            d.player.play()
        }
        updateNowPlaying(full: true)
    }

    private func applyVolume(_ deck: Int) {
        let d = decks[deck]
        d.player.volume = min(max(master * d.gain * d.fade, 0), 1)
    }

    private func activateSession() {
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func durationMs(_ deck: Int) -> Double {
        guard let t = decks[deck].player.currentItem?.duration, t.isNumeric else { return 0 }
        let s = t.seconds
        return s.isFinite && s > 0 ? s * 1000 : 0
    }

    private func positionMs(_ deck: Int) -> Double {
        let s = decks[deck].player.currentTime().seconds
        return s.isFinite && s > 0 ? s * 1000 : 0
    }

    // MARK: Transitions

    /// The prepared deck becomes the active one.
    private func advance(fade: Bool) {
        let next = 1 - active
        nextReady = false
        if fade {
            decks[next].fade = 0
            fadeStart = CACurrentMediaTime()
            let dur = durationMs(active)
            fadeLength = dur > 0 ? min(crossfadeMs, dur / 3) : crossfadeMs
        } else {
            decks[next].fade = 1
            decks[active].player.pause()
        }
        applyVolume(next)
        wantPlaying = true
        activateSession()
        decks[next].player.play()
        active = next
        didAdvance()
    }

    /// Nothing preloaded yet, but the web app gave us the next song: play it now.
    private func skipToUpcoming() -> Bool {
        guard fadeStart < 0, !upcoming.isEmpty else { return false }
        let s = upcoming.removeFirst()
        nextReady = false
        setSource(1 - active, nil)
        start(s, on: active, play: true)
        didAdvance()
        return true
    }

    private func didAdvance() {
        advancedAt = CACurrentMediaTime()
        emit("advanced", [:], true)
        updateNowPlaying(full: true)
        emitState(force: true)
    }

    private func finishFade() {
        guard fadeStart >= 0 else { return }
        fadeStart = -1
        let old = 1 - active
        setSource(old, nil)
        decks[old].fade = 1
        decks[active].fade = 1
        applyVolume(old)
        applyVolume(active)
        if let p = pendingNext {
            pendingNext = nil
            prepareNext(p)
        }
    }

    private func tick() {
        let now = CACurrentMediaTime()
        if fadeStart >= 0 {
            let t = (now - fadeStart) * 1000 / max(1, fadeLength)
            let x = Float(min(max(t, 0), 1))
            decks[1 - active].fade = cos(x * .pi / 2)
            decks[active].fade = sin(x * .pi / 2)
            applyVolume(0)
            applyVolume(1)
            if t >= 1 { finishFade() }
        } else if nextReady, wantPlaying, crossfadeMs > 0 {
            let d = decks[active]
            let dur = durationMs(active)
            if d.player.timeControlStatus == .playing, dur > 0, dur - positionMs(active) <= min(crossfadeMs, dur / 3) {
                advance(fade: true)
            }
        } else if !nextReady, pendingNext == nil, !upcoming.isEmpty, decks[active].source != nil, now - advancedAt > 8 {
            // The web app prepares the next song itself a few seconds after a
            // change; if it hasn't (it's paused in the background), we do.
            prepareNext(upcoming.removeFirst())
        }
        emitState(force: false)
    }

    private func onDeckEnded(_ deck: Int, _ item: AVPlayerItem) {
        guard deck == active, decks[deck].player.currentItem === item else { return }
        decks[deck].ended = true
        if nextReady {
            advance(fade: false)
        } else if !skipToUpcoming() {
            wantPlaying = false
            emit("ended", [:], true)
            updateNowPlaying(full: false)
            emitState(force: true)
        }
    }

    private func onDeckError(_ deck: Int, _ item: AVPlayerItem) {
        let d = decks[deck]
        guard d.player.currentItem === item, !d.failed else { return }
        d.failed = true
        if deck != active {
            if fadeStart < 0 { nextReady = false }
            return
        }
        var data: [String: Any] = ["message": item.error?.localizedDescription ?? "Playback failed"]
        if let status = Self.httpStatus(item) { data["httpStatus"] = status }
        emit("error", data, true)
        emitState(force: true)
    }

    /// The HTTP status behind a stream failure, when AVFoundation reports one.
    private static func httpStatus(_ item: AVPlayerItem) -> Int? {
        if let code = item.errorLog()?.events.last?.errorStatusCode, (400..<600).contains(code) { return code }
        var e = item.error as NSError?
        while let err = e {
            // CoreMedia's codes for HTTP 403 and 404.
            if err.code == -12660 { return 403 }
            if err.code == -12938 { return 404 }
            e = err.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return nil
    }

    // MARK: Lock screen, Control Center, headphones

    private func setUpRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.play() }
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.pause() }
            return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.wantPlaying { self.pause() } else { self.play() }
            }
            return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.remoteNext() }
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.remotePrevious() }
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let ms = e.positionTime * 1000
            MainActor.assumeIsolated { self?.seek(ms: ms) }
            return .success
        }
        for cmd in [c.skipForwardCommand, c.skipBackwardCommand, c.seekForwardCommand, c.seekBackwardCommand] {
            cmd.isEnabled = false
        }
    }

    /// Handled here when the next song is ready, so it works with the app in the background.
    private func remoteNext() {
        if fadeStart < 0, nextReady {
            advance(fade: false)
        } else if !nextReady, skipToUpcoming() {
            return
        } else {
            emit("remote", ["action": "next"], true)
        }
    }

    private func remotePrevious() {
        if positionMs(active) > 3000 {
            seek(ms: 0)
        } else {
            emit("remote", ["action": "previous"], true)
        }
    }

    private func onInterruption(_ info: [AnyHashable: Any]?) {
        guard let raw = info?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            interruptedWhilePlaying = wantPlaying
            if wantPlaying { pause() }
        } else {
            let opts = AVAudioSession.InterruptionOptions(rawValue: info?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            if interruptedWhilePlaying, opts.contains(.shouldResume) { play() }
            interruptedWhilePlaying = false
        }
    }

    private func updateNowPlaying(full: Bool, positionMs pos: Double? = nil) {
        let center = MPNowPlayingInfoCenter.default()
        guard let s = decks[active].source else {
            center.nowPlayingInfo = nil
            return
        }
        var info = full ? [:] : (center.nowPlayingInfo ?? [:])
        if full {
            info[MPMediaItemPropertyTitle] = s.title
            info[MPMediaItemPropertyArtist] = s.artist
            info[MPMediaItemPropertyAlbumTitle] = s.album
            info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
            if s.artworkURL != nil, s.artworkURL == artworkFor, let artwork {
                info[MPMediaItemPropertyArtwork] = artwork
            } else {
                loadArtwork(s.artworkURL)
            }
        }
        let dur = durationMs(active)
        if dur > 0 { info[MPMediaItemPropertyPlaybackDuration] = dur / 1000 }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = (pos ?? positionMs(active)) / 1000
        info[MPNowPlayingInfoPropertyPlaybackRate] = wantPlaying && !decks[active].ended ? 1.0 : 0.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        center.nowPlayingInfo = info
    }

    private func loadArtwork(_ url: URL?) {
        artworkTask?.cancel()
        artwork = nil
        artworkFor = url
        guard let url else { return }
        artworkTask = artworkSession.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, data.count < 5_000_000, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.artworkFor == url, self.decks[self.active].source?.artworkURL == url else { return }
                    let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                    self.artwork = art
                    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                    info[MPMediaItemPropertyArtwork] = art
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
                }
            }
        }
        artworkTask?.resume()
    }

    // MARK: State for the web app

    private func emitState(force: Bool) {
        let d = decks[active]
        let hasItem = d.player.currentItem != nil && !d.failed
        let playing = wantPlaying && hasItem && !d.ended
        let buffering = hasItem && d.player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        let pos = positionMs(active)
        let dur = durationMs(active)
        // The lock screen needs the duration once the stream has loaded.
        if Int(dur / 1000) != lastDurationSec {
            lastDurationSec = Int(dur / 1000)
            if dur > 0 { updateNowPlaying(full: false) }
        }
        let hash = (playing ? 1 : 0) + (buffering ? 2 : 0) + Int(pos / 250) * 4 + Int(dur / 1000) * 31
        if !force && hash == lastStateHash { return }
        lastStateHash = hash
        emit("state", ["playing": playing, "buffering": buffering, "positionMs": pos, "durationMs": dur], false)
    }
}
