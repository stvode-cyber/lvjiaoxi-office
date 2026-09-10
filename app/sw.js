/* 绿角犀 Office · Service Worker
   离线缓存应用外壳（对应 PRD：离线可用 / 本地优先）
   注意：Service Worker 仅在 https 或 localhost 下生效，file:// 不受影响。 */
const CACHE = "lvjiaoxi-office-v18";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./icon.svg",
  "./css/style.css",
  "./js/util.js", "./js/store.js",
  "./js/modules/writer.js", "./js/modules/spreadsheet.js",
  "./js/modules/presentation.js", "./js/modules/pdf.js",
  "./js/shell.js", "./js/updater.js"
];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // 发布清单始终走网络，确保后台更新检测拿到最新版本
  if (e.request.url.indexOf("version.json") !== -1) {
    e.respondWith(fetch(e.request, { cache: "no-store" }).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return resp;
  }).catch(() => caches.match("./index.html"))));
});

// 新 Service Worker 安装后，由页面（updater.js）发消息立即激活，使后台更新生效
self.addEventListener("message", e => {
  if (e.data && e.data.type === "skip-waiting") self.skipWaiting();
});
