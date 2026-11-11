import SwiftUI

@main
struct SolesApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()
                .background(Color.black)
                .preferredColorScheme(.dark)
        }
    }
}

/// The whole interface is the web app in a WKWebView.
struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}
