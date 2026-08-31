import webview from '@ohos.web.webview';

/**
 * 绿角犀 Office · HarmonyOS 首页
 * 用系统 Web 组件加载 resources/rawfile/index.html（即应用的 app/ 目录）。
 */
@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

  build() {
    Column() {
      Web({ src: $rawfile('index.html'), controller: this.controller })
        .javaScriptAccess(true)       // 应用核心依赖 JS
        .domStorageAccess(true)       // IndexedDB / localStorage 持久化
        .fileAccess(true)             // 允许加载本地子资源
        .layoutWeight(1)
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
