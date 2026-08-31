import UIKit
import WebKit

/// 绿角犀 Office · iOS 原生壳
/// 用 WKWebView 加载 App Bundle 中的 webroot/index.html（即应用的 app/ 目录）。
class ViewController: UIViewController {

    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptEnabled = true
        // 允许 IndexedDB / localStorage 持久化（iOS WKWebView 需开启）
        config.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.backgroundColor = .systemBackground
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        guard let url = Bundle.main.url(forResource: "index",
                                        withExtension: "html",
                                        subdirectory: "webroot") else {
            fatalError("webroot/index.html 未找到，请确认已将 app/ 拷贝为 iOS 工程的 webroot 目录")
        }
        // allowingReadAccessTo 指向 webroot 目录，使其中的 js/css/vendor 子资源可被加载
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
}

extension ViewController: WKNavigationDelegate {
    // 所有导航留在 WebView 内，不跳 Safari
}
