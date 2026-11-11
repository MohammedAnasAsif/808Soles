import UIKit
import WebKit

/// Hosts the web app. It's served from the private app:// scheme
/// (AppSchemeHandler), can't navigate anywhere else, and talks to native code
/// only through the `cadence` message handler (Bridge).
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private let bridge = Bridge()

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        // Page world only, and Bridge also checks the sender is our page.
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "cadence")
        config.allowsInlineMediaPlayback = true
        config.dataDetectorTypes = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.upgradeKnownHostsToHTTPS = true

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        // The page lays itself out around the notch and home bar (CSS safe-area insets).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsLinkPreview = false
        // Swipe from the left edge to go back, like other iOS apps.
        web.allowsBackForwardNavigationGestures = true
        #if DEBUG
        web.isInspectable = true
        #else
        web.isInspectable = false
        #endif
        web.navigationDelegate = self
        web.uiDelegate = self
        bridge.webView = web
        webView = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: AppSchemeHandler.startURL))
    }

    // MARK: Navigation: the app's own pages only

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if AppSchemeHandler.isAppURL(url) { return decisionHandler(.allow) }
        // Links to the web open in Safari instead.
        if url.scheme == "https", action.navigationType == .linkActivated {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url, url.scheme == "https" {
            UIApplication.shared.open(url)
        }
        return nil
    }

    /// iOS may stop the web view's process to free memory; start it again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: AppSchemeHandler.startURL))
    }
}
