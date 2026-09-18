// 绿角犀 Office · Electron 主进程
// 用一个零依赖的本地静态服务器加载 app/ 目录，使桌面版行为与浏览器版完全一致。
// TODO: [坑-koa-connect] 预防：Koa 路由禁止用 koa-connect wrapper；所有中间件一律原生 Koa 风格
// TODO: [坑-csc-link] 预防：CI secrets 必须 if guard（脚本里不能裸引用 electron-builder CSC_* 变量）
const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

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

const http = require("http");
const { resolveUpdateProvider } = require("./feed-config");
const { extractFilePaths } = require("./file-args");
const { cmpVer, mimeFor, safeStaticResolve, MAX_OPEN_BYTES } = require("./main-utils");

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

// 文件关联：待打开文档队列（窗口未就绪前先缓存，did-finish-load 后统一推送前端）
let pendingFiles = [];
let webReady = false;

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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    icon: path.join(ROOT, "icons", "icon.ico"),
    title: "绿角犀 Office",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  win.loadURL("http://127.0.0.1:" + PORT + "/");
  win.setMenu(createAppMenu(win));
  win.once("did-finish-load", () => { webReady = true; flushPendingFiles(); });
  win.on("closed", () => { win = null; });

  // 🩺 诊断：render 的 console 重定向到文件，就算 render 冻住了也能看到最后一行
  try {
    const diagDir = path.join(app.getPath('userData'), 'diag');
    require('fs').mkdirSync(diagDir, { recursive: true });
    const logFile = path.join(diagDir, 'render-console.log');
    const fs = require('fs');
    // 每次启动清空
    fs.writeFileSync(logFile, `\n===== NEW SESSION ${new Date().toISOString()} =====\n`, 'utf8');
    win.webContents.on('console-message', (evt, level, msg, line, sourceId) => {
      const ts = new Date().toISOString();
      const tag = ['VERBOSE','INFO','WARN','ERROR'][level] || 'INFO';
      const src = line ? `(${sourceId.split('/').pop()}:${line})` : '';
      const line1 = `[${ts}][${tag}] ${msg} ${src}\n`;
      try { fs.appendFileSync(logFile, line1); } catch(_) {}
      if (level >= 2) console.log('[RENDER-ERR]', msg); // error 也打到 main 控制台
    });
    win.webContents.on('render-process-gone', (evt, details) => {
      const crashFile = path.join(diagDir, 'crash.log');
      const entry = `\n[${new Date().toISOString()}] render-process-gone! reason=${details.reason}, exitCode=${details.exitCode}\n`;
      try { fs.appendFileSync(crashFile, entry); } catch(_) {}
      console.error('[MAIN] 💥 render process gone!', details.reason, 'exitCode:', details.exitCode);
    });
    console.log('[DIAG] console redirect →', logFile);
  } catch(e) { console.error('[DIAG] setup failed:', e.message); }
}

app.whenReady().then(() => {
  // 单实例：已在运行的实例不再重复起服务；双击/默认打开方式的文件转交首实例的 second-instance 处理
  if (!app.requestSingleInstanceLock()) { __logCrash("[QUIT] singleInstanceLock failed → app.quit()"); app.quit(); return; } __logCrash("[OK] singleInstanceLock acquired");
  server.listen(PORT, "127.0.0.1", () => { __logCrash("[OK] server.listen success");
    if (PORT === 0) PORT = server.address().port; // 固定为实际随机端口，供后续窗口复用
    __logCrash("[CALL] createWindow()"); createWindow();
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
  // 渲染层就绪握手：前端初始化完成后通知主进程，把文件队列刷给前端（不依赖易失效的 did-finish-load）
  ipcMain.handle("app:renderer-ready", () => { webReady = true; flushPendingFiles(); });
  // 前端兜底拉取：返回且清空排队中的文件（启动瞬间双击的文档）
  ipcMain.handle("app:pending-files", () => {
    const q = pendingFiles.splice(0, pendingFiles.length);
    return q;
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(e => { console.error("[Main] app.whenReady 失败:", e); process.exit(1); });

app.on("window-all-closed", () => { __logCrash("[EVENT] window-all-closed fired");
  server.close();
  if (process.platform !== "darwin") app.quit();
});
