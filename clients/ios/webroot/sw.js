/* 绿角犀 Office · Service Worker v25
   离线缓存应用外壳 + 核心 vendor（pdf-lib/jszip/xlsx/docx/pdf.worker 等 ~3.6MB）
   tesseract lang-data ~65MB 走独立 LANGDATA cache + 手动手动手动
   注意：Service Worker 仅在 https 或 localhost 下生效，file:// 不受影响。 */

const CACHE = "lvjiaoxi-office-v25";
const LANGDATA_CACHE = "lvjiaoxi-langdata-v1";

// —— 预缓存（install 阶段一次性）——
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./icon.svg",
  "./css/style.css",
  "./js/util.js", "./js/store.js", "./js/versions.js",
  "./js/modules/writer.js", "./js/modules/spreadsheet.js",
  "./js/modules/presentation.js", "./js/modules/pdf.js",
  "./js/modules/pdf-engine.js",
  "./js/shell.js", "./js/updater.js",
  // —— 核心 vendor（~3.6MB）——
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",       // PDF 渲染必需，离线看 PDF 的前提
  "./vendor/pdf-lib.min.js",
  "./vendor/jszip.min.js",
  "./vendor/xlsx.full.min.js",
  "./vendor/docx.umd.min.js",
  "./vendor/FileSaver.min.js",
  "./vendor/fontkit.min.js",
  "./vendor/tesseract/tesseract.min.js",
  "./vendor/tesseract/worker.min.js"
  // ⚠️ tesseract/lang-data/*.traineddata ~65MB 不预缓存！离线时 OCR 需在线下载
];

// —— 哪些路径允许自动进 CACHE（runtime fetch 时）——
function shouldAutoCache(url) {
  if (url.indexOf("version.json") !== -1) return false;
  // tesseract lang-data 单独走 LANGDATA cache（按需，不爆 quota）
  if (url.indexOf("tesseract/lang-data/") !== -1) return false;
  // 二进制大文件：不进主 CACHE
  if (url.match(/\.(traineddata|bin|dat|wasm)$/)) return false;
  // 外部 URL（CDN / 远程资源）不缓存
  try { const u = new URL(url, self.location.href); if (u.origin !== self.location.origin) return false; } catch(e) {}
  return true;
}

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k !== CACHE && k !== LANGDATA_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;

  // —— version.json：始终走网络（更新检测），网络失败 fallback index.html ——
  if (url.indexOf("version.json") !== -1) {
    e.respondWith(fetch(e.request, { cache: "no-store" }).catch(() => caches.match("./index.html")));
    return;
  }

  // —— tesseract lang-data：独立 cache-first（按需缓存，不爆主 CACHE）——
  if (url.indexOf("tesseract/lang-data/") !== -1) {
    e.respondWith(
      caches.open(LANGDATA_CACHE).then(c =>
        c.match(e.request).then(r => r || fetch(e.request).then(resp => {
          const copy = resp.clone(); c.put(e.request, copy); return resp;
        }))
      ).catch(() => new Response("Tesseract data unavailable offline", { status: 504 }))
    );
    return;
  }

  // —— 默认：cache-first + runtime cache（白名单内的自动缓存）——
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp.ok && shouldAutoCache(url)) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match("./index.html")))
  );
});

// —— 新 Service Worker 安装后，由页面（updater.js）发消息立即激活 ——
self.addEventListener("message", e => {
  if (e.data && e.data.type === "skip-waiting") self.skipWaiting();
});
