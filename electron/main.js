// 绿角犀 Office · Electron 主进程
// 用一个零依赖的本地静态服务器加载 app/ 目录，使桌面版行为与浏览器版完全一致。
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { resolveUpdateProvider } = require("./feed-config");
const { extractFilePaths } = require("./file-args");

// 桌面静默更新（可选依赖：未安装 electron-updater 时自动回退到现有横幅行为）
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { autoUpdater = null; }

// 解析出的更新源（generic / github / null）；无源时桌面视为已最新
let updateProvider = null;
let updateDownloadUrl = ""; // github 回退通道下，供安装失败兜底打开发布页

  // 前端 web 根目录：开发期是 project/app，打包后位于 asar 内的 app/
  const ROOT = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "app")
    : path.join(__dirname, "..", "app");

  // 后台自动更新：渲染进程经此比对远程发布清单（仅当配置了 LVJX_UPDATE_FEED）
  function cmpVer(a, b) {
    const A = ("" + a).split(".").map(x => parseInt(x, 10) || 0);
    const B = ("" + b).split(".").map(x => parseInt(x, 10) || 0);
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) { const x = A[i] || 0, y = B[i] || 0; if (x > y) return 1; if (x < y) return -1; }
    return 0;
  }
  ipcMain.handle("updater:check", async () => {
    const cur = require("../package.json").version; // 注意：main.js 在 electron/，package.json 在仓库根
    // 已启用 electron-updater + 已解析出更新源：走真正的静默下载/安装通道
    if (autoUpdater && updateProvider) {
      try {
        const r = await autoUpdater.checkForUpdates();
        const v = r && r.updateInfo && r.updateInfo.version;
        const newer = !!v && cmpVer(v, cur) > 0;
        return {
          version: v || cur,
          upToDate: !newer,
          usingAutoUpdater: true,
          provider: updateProvider.provider,
          // 命中新版本时，把发布页地址回传给渲染端（github 回退通道用，安装失败兜底打开）
          url: newer && updateProvider.provider === "github" ? updateProvider.downloadUrl : ""
        };
      } catch (e) {
        // 无更新（checkForUpdates 在无更新时 reject）或其它异常：视为已最新，不阻断
        return { upToDate: true, version: cur, usingAutoUpdater: true, provider: updateProvider.provider, error: String(e && e.message || e) };
      }
    }
    if (updateProvider) {
      // 有更新源但 electron-updater 不可用（极罕见）：保守回退，不联网、不阻断
      return { upToDate: true, version: cur, provider: updateProvider.provider };
    }
    return { upToDate: true, version: cur }; // 完全无远程更新源，视为已最新
  });
  // 主动触发下载（仅 electron-updater 通道有效）
  ipcMain.handle("updater:download", async () => {
    if (!autoUpdater) return { ok: false, reason: "no-auto-updater" };
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  // 退出并安装已下载的更新（仅 electron-updater 通道有效）
  ipcMain.handle("updater:install", async () => {
    if (!autoUpdater) return { ok: false, reason: "no-auto-updater" };
    try { autoUpdater.quitAndInstall(false, true); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.on("shell:open-external", (e, url) => {
    try { if (url && /^https?:\/\//.test(url)) shell.openExternal(url); } catch (_) {}
  });

  // 配置 electron-updater（能力/配置缺失时直接返回，完全不影响现有行为）
  function setupAutoUpdater() {
    if (!autoUpdater) return;
    const feed = process.env.LVJX_UPDATE_FEED;
    const releaseUrl = process.env.LVJX_RELEASE_URL;
    const githubRepo = process.env.LVJX_GITHUB_REPO || "";
    let versionJsonUrl = "";
    try { versionJsonUrl = (require("../app/version.json").url) || ""; } catch (e) { /* 无 version.json 亦可 */ }
    // 解析更新源：优先私有 feed；否则回退 GitHub Releases（从 releaseUrl / version.json.url / githubRepo 推导）
    updateProvider = resolveUpdateProvider({ feed, releaseUrl, versionJsonUrl, githubRepo });
    if (!updateProvider) return; // 无远程更新源，桌面视为已最新
    try {
      autoUpdater.autoDownload = false;        // 由用户/IPC 主动触发下载，避免抢占带宽
      autoUpdater.autoInstallOnAppQuit = true;
      if (updateProvider.provider === "github") {
        autoUpdater.setFeedURL({ provider: "github", owner: updateProvider.owner, repo: updateProvider.repo });
        updateDownloadUrl = updateProvider.downloadUrl;
      } else {
        autoUpdater.setFeedURL({ provider: "generic", url: updateProvider.url });
        updateDownloadUrl = "";
      }
      autoUpdater.on("update-available", (info) => {
        if (win && !win.isDestroyed()) win.webContents.send("updater:available",
          { version: info.version, releaseDate: info.releaseDate, notes: info.releaseNotes });
      });
      autoUpdater.on("download-progress", (p) => {
        if (win && !win.isDestroyed()) win.webContents.send("updater:progress", Math.round((p && p.percent) || 0));
      });
      autoUpdater.on("update-downloaded", (info) => {
        if (win && !win.isDestroyed()) win.webContents.send("updater:downloaded", { version: info.version });
      });
      autoUpdater.on("error", (e) => {
        // 安装被拦（如未签名的 Windows 安装包）时，把发布页地址一并带回，渲染端可兜底打开
        const msg = String(e && e.message || e);
        if (win && !win.isDestroyed()) win.webContents.send("updater:error", msg, updateDownloadUrl);
      });
    } catch (e) {
      autoUpdater = null; // 任意异常都回退到现有横幅行为
      updateProvider = null;
      updateDownloadUrl = "";
    }
  }

let PORT = process.env.LVJX_PORT ? parseInt(process.env.LVJX_PORT, 10) : 0; // 0 => 随机空闲端口，避免被固定占用/探测

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json"
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  // 防目录穿越
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});

// 文件关联：待打开文档队列（窗口未就绪前先缓存，did-finish-load 后统一推送前端）
let pendingFiles = [];
let webReady = false;
const MAX_OPEN_BYTES = 200 * 1024 * 1024; // 200MB 上限，避免超大文件撑爆内存

function openFileAt(p) {
  try {
    if (!p || typeof p !== "string") return;
    const buf = fs.readFileSync(p);
    if (buf.length > MAX_OPEN_BYTES) { console.warn("openFileAt 跳过超大文件:", p); return; }
    const payload = {
      path: p,
      name: path.basename(p),
      ext: path.extname(p).toLowerCase(),
      base64: buf.toString("base64")
    };
    if (win && !win.isDestroyed() && webReady) win.webContents.send("app:open-file", payload);
    else pendingFiles.push(payload);
  } catch (e) { console.error("openFileAt 失败:", e); }
}

function flushPendingFiles() {
  if (!win || win.isDestroyed()) return;
  while (pendingFiles.length) win.webContents.send("app:open-file", pendingFiles.shift());
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    icon: path.join(ROOT, "icons", "icon.ico"), // 必须是 .ico，绝不能用 .svg（Windows 会静默崩溃）
    title: "绿角犀 Office",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  win.loadURL("http://127.0.0.1:" + PORT + "/");
  win.once("did-finish-load", () => { webReady = true; flushPendingFiles(); });
  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  server.listen(PORT, "127.0.0.1", () => {
    if (PORT === 0) PORT = server.address().port; // 固定为实际随机端口，供后续窗口复用
    createWindow();
    setupAutoUpdater(); // 配置电子静默更新（无 feed/无依赖时自动跳过）
    // 文件关联：双击文档 / 命令行携带路径启动时，把文件推给前端打开（窗口未就绪前先入队）
    extractFilePaths(process.argv).forEach(openFileAt);
  });
  // 已运行实例收到新文件关联请求（Windows 下双击第二个文档时）
  app.on("second-instance", (e, argv) => {
    extractFilePaths(argv).forEach(openFileAt);
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  // macOS 拖入文件到 Dock 图标
  app.on("open-file", (e, p) => { e.preventDefault(); openFileAt(p); });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  server.close();
  if (process.platform !== "darwin") app.quit();
});
