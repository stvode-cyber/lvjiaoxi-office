// 绿角犀 Office · Electron 主进程
// 用一个零依赖的本地静态服务器加载 app/ 目录，使桌面版行为与浏览器版完全一致。
// TODO: [坑-koa-connect] 预防：Koa 路由禁止用 koa-connect wrapper；所有中间件一律原生 Koa 风格
// TODO: [坑-csc-link] 预防：CI secrets 必须 if guard（脚本里不能裸引用 electron-builder CSC_* 变量）
// TODO: [坑-electron-builder-csclink-null] 预防: CSC_LINK/CSC_KEY_PASSWORD 未设时 sign 自动 skip 不崩
// TODO: [坑-electron-contextIsolation-window] 预防: webPreferences 开了 contextIsolation，renderer 第三方库引用别假设 global === window
const __t0 = Date.now();
const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
function __phase(tag) { console.log("[MAIN-T]", tag, "+" + (Date.now() - __t0) + "ms"); }

// 🩺 Native crash 追踪 — 进程任何异常退出都写日志
const __DIAG_DIR = path.join(app.getPath("userData"), "diag");
function __logCrash(msg) { try { fs.appendFileSync(path.join(__DIAG_DIR, "native-crash.log"), "[" + new Date().toISOString() + "] " + msg + "\n"); } catch (_) {} }
process.on("uncaughtException", (err) => { __logCrash("uncaughtException: " + (err && err.stack || err)); process.exit(1); });
process.on("unhandledRejection", (reason) => { __logCrash("unhandledRejection: " + (reason && reason.stack || reason)); });
app.on("before-quit", (e) => { __logCrash("[EVENT] before-quit fired"); });
app.on("will-quit", (e) => { __logCrash("[EVENT] will-quit fired"); });
app.on("quit", (e, code) => { __logCrash("[EVENT] quit fired code=" + code); });
process.on("exit", (code) => { __logCrash("process.exit code=" + code); });
console.log("[MAIN] native crash tracking enabled");
__phase("after crash-track setup");

// 🩺 诊断：自动开 Chrome DevTools Protocol 9222 — 必须在 app.whenReady 之前！
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
// 🛡️ 稳定性：禁用硬件加速 + 关闭 GPU 沙箱 — 防止 Windows 上某些机器窗口白屏/闪退/被安全软件拦截
// 必须在 app.whenReady() 之前调用！
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
__phase("after commandLine switches");

const http = require("http");
const { resolveUpdateProvider } = require("./feed-config");
const { extractFilePaths } = require("./file-args");
const { cmpVer, mimeFor, safeStaticResolve, MAX_OPEN_BYTES } = require("./main-utils");
__phase("after all require()s");

// 桌面静默更新（可选依赖：未安装 electron-updater 时自动回退到现有横幅行为）
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { autoUpdater = null; }

// 解析出的更新源（generic / github / null）；无源时桌面视为已最新
let updateProvider = null;
let updateDownloadUrl = ""; // github 回退通道下，供安装失败兜底打开发布页

  // 前端 web 根目录：开发期是 project/app，打包后位于 asar 内的 app/
  // 用文件存在性判断，不用 app.isPackaged（dev 模式下居然返回 true！）
  const _devRoot = path.join(__dirname, "..", "app");
  const ROOT = fs.existsSync(path.join(_devRoot, "index.html"))
    ? _devRoot
    : path.join(process.resourcesPath, "app.asar", "app");

  // 后台自动更新：渲染进程经此比对远程发布清单（仅当配置了 LVJX_UPDATE_FEED）
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
    try { if (url && /^https?:\/\//.test(url)) shell.openExternal(url); } catch (_) { console.info("[Main] 操作失败:", e); }
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
      autoUpdater.autoDownload = true;         // 自动更新模式：发现更新即后台静默下载，无需用户触发
      autoUpdater.autoInstallOnAppQuit = true; // 应用退出时自动安装（不打断当前会话；亦可经前端「立即重启」即时生效）
      if (updateProvider.provider === "github") {
        autoUpdater.setFeedURL({ provider: "github", owner: updateProvider.owner, repo: updateProvider.repo });
        updateDownloadUrl = updateProvider.downloadUrl;
      } else {
        autoUpdater.setFeedURL({ provider: "generic", url: updateProvider.url });
        updateDownloadUrl = "";
      }
      autoUpdater.on("update-available", (info) => {
        BrowserWindow.getAllWindows().forEach(w => !w.isDestroyed() && w.webContents.send("updater:available",
          { version: info.version, releaseDate: info.releaseDate, notes: info.releaseNotes }));
      });
      autoUpdater.on("download-progress", (p) => {
        BrowserWindow.getAllWindows().forEach(w => !w.isDestroyed() && w.webContents.send("updater:progress", Math.round((p && p.percent) || 0)));
      });
      autoUpdater.on("update-downloaded", (info) => {
        BrowserWindow.getAllWindows().forEach(w => !w.isDestroyed() && w.webContents.send("updater:downloaded", { version: info.version }));
      });
      autoUpdater.on("error", (e) => {
        const msg = String(e && e.message || e);
        BrowserWindow.getAllWindows().forEach(w => !w.isDestroyed() && w.webContents.send("updater:error", msg, updateDownloadUrl));
      });
      // 自动更新模式：启动即检查（无需等待前端 IPC；前端 checkNow 仅作补充轮询）
      autoUpdater.checkForUpdates().catch(e => console.info("[Main] 操作失败:", e));
    } catch (e) {
      autoUpdater = null; // 任意异常都回退到现有横幅行为
      updateProvider = null;
      updateDownloadUrl = "";
    }
  }

let PORT = process.env.LVJX_PORT ? parseInt(process.env.LVJX_PORT, 10) : 0; // 0 => 随机空闲端口，避免被固定占用/探测

const server = http.createServer((req, res) => {
  const { file, forbidden } = safeStaticResolve(ROOT, req.url || "/");
  if (forbidden) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  if (!file) {
    res.writeHead(404);
    return res.end("not found");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": mimeFor(file),
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});

// 多窗口管理：每个 BrowserWindow 带自己的 __state = { pendingFiles: [], webReady: false }
const windows = new Set();

// 单文件读取 + base64（异步，绝不阻塞主进程！）
async function readFilePayloadAsync(p) {
  try {
    if (!p || typeof p !== "string") return null;
    const st = await fs.promises.stat(p);
    if (!st.isFile()) return null;
    if (st.size > MAX_OPEN_BYTES) { console.warn("readFilePayloadAsync 跳过超大文件:", p, "(" + Math.round(st.size / 1024 / 1024) + "MB)"); return null; }
  } catch (e) { return null; }
  let buf; try { buf = await fs.promises.readFile(p); } catch(e) { console.error("readFilePayloadAsync 读取失败:", p, e.message); return null; }
  return { path: p, name: path.basename(p), ext: path.extname(p).toLowerCase(), base64: buf.toString("base64") };
}

// 给指定窗口发送文件（窗口就绪 → 直接发；未就绪 → 入该窗口 pendingFiles）
function dispatchFileTo(win, payload) {
  if (!win || win.isDestroyed()) return;
  if (win.__state.webReady) win.webContents.send("app:open-file", payload);
  else win.__state.pendingFiles.push(payload);
}

// 刷某个窗口的 pending queue
function flushWindowPending(win) {
  if (!win || win.isDestroyed()) return;
  while (win.__state.pendingFiles.length) win.webContents.send("app:open-file", win.__state.pendingFiles.shift());
}

// 中文菜单栏（替代 Electron 默认英文 File/Edit/View/Window/Help）
function createAppMenu(targetWin) {
  const about = () => {
    dialog.showMessageBox(targetWin || BrowserWindow.getFocusedWindow(), {
      type: "info",
      title: "关于 绿角犀 Office",
      message: "绿角犀 Office",
      detail: `版本 ${require("../package.json").version}\n© 2026 广州木生林生物科技 / 绿角犀 Lujax`,
      buttons: ["确定"]
    });
  };
  const openExternal = (url) => { try { shell.openExternal(url); } catch (e) { console.info("[Main] 操作失败:", e); } };
  return Menu.buildFromTemplate([
    {
      label: "文件(&F)",
      submenu: [
        { label: "新建窗口(&N)", accelerator: "Ctrl+Shift+N", click: () => createWindow() },
        { type: "separator" },
        { label: "退出(&X)", role: "quit" }
      ]
    },
    {
      label: "编辑(&E)",
      submenu: [
        { label: "撤销(&U)", role: "undo" },
        { label: "重做(&R)", role: "redo" },
        { type: "separator" },
        { label: "剪切(&T)", role: "cut" },
        { label: "复制(&C)", role: "copy" },
        { label: "粘贴(&P)", role: "paste" },
        { label: "删除(&D)", role: "delete" },
        { type: "separator" },
        { label: "全选(&A)", role: "selectAll" }
      ]
    },
    {
      label: "视图(&V)",
      submenu: [
        { label: "刷新(&R)", role: "reload" },
        { label: "强制刷新(&F)", role: "forceReload" },
        { type: "separator" },
        { label: "实际大小(&A)", role: "resetZoom" },
        { label: "放大(&I)", role: "zoomIn" },
        { label: "缩小(&O)", role: "zoomOut" },
        { type: "separator" },
        { label: "切换全屏(&F)", role: "togglefullscreen" },
        { type: "separator" },
        { label: "开发者工具(&D)", role: "toggledevtools" }
      ]
    },
    {
      label: "窗口(&W)",
      submenu: [
        { label: "最小化(&N)", role: "minimize" },
        { label: "关闭(&C)", role: "close" }
      ]
    },
    {
      label: "帮助(&H)",
      submenu: [
        { label: "关于绿角犀 Office(&A)", click: about },
        { type: "separator" },
        { label: "访问官网(&W)", click: () => openExternal("https://lujax.fun") }
      ]
    }
  ]);
}

function createWindow(initialPaths) {
  __phase("createWindow() enter");
  const w = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    icon: path.join(ROOT, "icons", "icon.ico"),
    title: "绿角犀 Office",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  w.__state = { pendingFiles: [], webReady: false }; // 每个窗口自己的 state
  windows.add(w);

  __phase("BrowserWindow.new resolved");
  w.loadURL("http://127.0.0.1:" + PORT + "/");
  __phase("loadURL() resolved");
  w.setMenu(createAppMenu(w));
  w.setMenuBarVisibility(false);
  w.once("did-finish-load", () => { w.__state.webReady = true; flushWindowPending(w); __phase("did-finish-load ← render ready"); });
  w.on("closed", () => { windows.delete(w); });

  // ★ 异步预读：读取文件不阻塞主进程，read 好后直接 dispatch
  if (Array.isArray(initialPaths) && initialPaths.length) {
    Promise.all(initialPaths.map(p => readFilePayloadAsync(p))).then(payloads => {
      payloads.forEach(payload => { if (payload) dispatchFileTo(w, payload); });
    }).catch(e => console.error("[createWindow] 预读失败:", e.message));
  }

  // 🩺 诊断：render 的 console 重定向到文件（每窗口独立日志）
  try {
    const diagDir = path.join(app.getPath('userData'), 'diag');
    require('fs').mkdirSync(diagDir, { recursive: true });
    const logFile = path.join(diagDir, 'render-console.log');
    const fs2 = require('fs');
    fs2.appendFileSync(logFile, `\n===== NEW WINDOW ${new Date().toISOString()} =====\n`, 'utf8');
    w.webContents.on('console-message', (evt, level, msg, line, sourceId) => {
      const ts = new Date().toISOString();
      const tag = ['VERBOSE','INFO','WARN','ERROR'][level] || 'INFO';
      const src = line ? `(${sourceId.split('/').pop()}:${line})` : '';
      const line1 = `[${ts}][${tag}] ${msg} ${src}\n`;
      try { fs2.appendFileSync(logFile, line1); } catch(_) {}
      if (level >= 2) console.log('[RENDER-ERR]', msg);
    });
    w.webContents.on('render-process-gone', (evt, details) => {
      const crashFile = path.join(diagDir, 'crash.log');
      const entry = `\n[${new Date().toISOString()}] render-process-gone! reason=${details.reason}, exitCode=${details.exitCode}\n`;
      try { fs2.appendFileSync(crashFile, entry); } catch(_) {}
      console.error('[MAIN] 💥 render process gone!', details.reason, 'exitCode:', details.exitCode);
    });
    console.log('[DIAG] console redirect →', logFile);
  } catch(e) { console.error('[DIAG] setup failed:', e.message); }
  return w;
}

app.whenReady().then(() => {
  __phase("app.whenReady resolved ← Chromium ready");
  // 单实例 + 多窗口：共享一个 HTTP server；新文件关联 → second-instance 开新窗口
  if (!app.requestSingleInstanceLock()) { __logCrash("[QUIT] singleInstanceLock failed → app.quit()"); app.quit(); return; } __logCrash("[OK] singleInstanceLock acquired");
  __phase("after singleInstanceLock");
  server.listen(PORT, "127.0.0.1", () => { __logCrash("[OK] server.listen success");
    if (PORT === 0) PORT = server.address().port;
    __phase("server.listen callback");
    // 首个窗口 + 命令行携带的初始文件
    const initialPaths = extractFilePaths(process.argv);
    __logCrash("[CALL] createWindow(" + initialPaths.length + " files)");
    createWindow(initialPaths.length ? initialPaths : null);
    __phase("createWindow returned");
    setupAutoUpdater();
    __phase("setupAutoUpdater done");
  });
  // 双击第二个文档 → 开新窗口（保留单实例锁，但不再把文件塞给旧窗口）
  app.on("second-instance", (e, argv) => {
    const paths = extractFilePaths(argv);
    if (paths.length) createWindow(paths);
    else { const f = BrowserWindow.getFocusedWindow(); if (f) { if (f.isMinimized()) f.restore(); f.focus(); } }
  });
  // macOS 拖入文件到 Dock → 给 focused window；没窗口就新开
  app.on("open-file", (e, p) => {
    e.preventDefault();
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) { const payload = readFilePayload(p); if (payload) dispatchFileTo(focused, payload); }
    else createWindow([p]);
  });
  // 渲染层就绪握手（window-specific，通过 sender 定位）
  ipcMain.handle("app:renderer-ready", (evt) => {
    const w = BrowserWindow.fromWebContents(evt.sender);
    if (w && w.__state) { w.__state.webReady = true; flushWindowPending(w); }
  });
  // 前端兜底拉取 pending files（同样 window-specific）
  ipcMain.handle("app:pending-files", (evt) => {
    const w = BrowserWindow.fromWebContents(evt.sender);
    if (w && w.__state) return w.__state.pendingFiles.splice(0, w.__state.pendingFiles.length);
    return [];
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(e => { console.error("[Main] app.whenReady 失败:", e); process.exit(1); });

app.on("window-all-closed", () => { __logCrash("[EVENT] window-all-closed fired");
  server.close();
  if (process.platform !== "darwin") app.quit();
});
