package com.lvjiaoxi.office;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 绿角犀 Office · Android 原生壳
 * 用系统 WebView 直接加载 assets 中的 Web 应用（app/ 目录经 assets.srcDirs 映射为 android_asset/）。
 */
public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);            // 应用核心依赖 JS
        ws.setDomStorageEnabled(true);           // IndexedDB / localStorage 持久化文档库
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);             // 允许加载本地资源
        ws.setAllowContentAccess(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);

        // 在 WebView 内打开所有链接，不跳系统浏览器
        webView.setWebViewClient(new WebViewClient());

        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
