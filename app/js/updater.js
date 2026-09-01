/* 绿角犀 Office · 后台自动更新器
   目标：让未来的版本更新「无感」——后台轮询发布清单，发现新版本即提示用户一键刷新/下载。
   跨平台策略：
   - Web / PWA：轮询同源 ./version.json，命中新版本后由 Service Worker 后台接管（skipWaiting），
     用户点「立即更新」即刷新到最新外壳与资源。
   - Electron（桌面）：优先经主进程 IPC（updater:check）比对远程发布清单（LVJX_UPDATE_FEED），
     未配置 feed 时回退为同源比对；命中后「前往下载」打开发布页。
   - 移动端 WebView（Android/iOS/HarmonyOS）：走同源轮询；原生壳资源由各自应用商店/ OTA 管控。 */
(function (global) {
  const OS = global.OS = global.OS || {};

  const CHECK_INTERVAL = 30 * 60 * 1000; // 30 分钟后台轮询
  const FEED_URL = "./version.json";     // 同源发布清单（Electron 可由主进程覆盖为远程 feed）

  let current = "";
  let timer = null;
  let lastCheck = 0;
  let pending = null;   // 待应用的新版本信息
  let swReg = null;

  function readCurrent() {
    const m = document.querySelector('meta[name="x-app-version"]');
    return (m && m.content && m.content.trim()) || OS.version || "0.0.0";
  }

  function parseVersion(v) {
    return ("" + (v || "")).split(".").map(function (x) { return parseInt(x, 10) || 0; });
  }

  // 返回 1 / 0 / -1：a 比 b 新 / 相等 / 旧
  function compareVersion(a, b) {
    const A = parseVersion(a), B = parseVersion(b);
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const x = A[i] || 0, y = B[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function isNativeShell() {
    return /Electron/i.test(navigator.userAgent) ||
      (global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }

  async function fetchLatest() {
    // Electron：优先走主进程 IPC（可指向远程 feed）
    if (isNativeShell() && global.electronAPI && typeof global.electronAPI.invoke === "function") {
      try {
        const r = await global.electronAPI.invoke("updater:check");
        if (r && (r.version || r.upToDate !== undefined)) return r;
      } catch (e) { /* 回退到同源 fetch */ }
    }
    const resp = await fetch(FEED_URL, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
    if (!resp.ok) throw new Error("版本信息获取失败 (" + resp.status + ")");
    return await resp.json();
  }

  async function checkNow(opts) {
    opts = opts || {};
    current = current || readCurrent();
    lastCheck = Date.now();
    let latest;
    try {
      latest = await fetchLatest();
    } catch (e) {
      if (opts.toast) OS.toast && OS.toast("检查更新失败：" + e.message, "warn");
      return null;
    }
    if (!latest || !latest.version) return null;
    // 低于最低支持版本时强制提示更新
    if (compareVersion(latest.version, current) > 0) {
      pending = latest;
      notify(latest);
      if (opts.toast) OS.toast && OS.toast("发现新版本 v" + latest.version, "ok");
      OS.bus && OS.bus.emit("updater:update-available", latest);
      return latest;
    }
    if (opts.toast) OS.toast && OS.toast("已是最新版本 v" + current, "ok");
    return null;
  }

  function notify(info) {
    let bar = document.getElementById("updater-banner");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "updater-banner";
      bar.className = "updater-banner";
      document.body.appendChild(bar);
    }
    bar.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "updater-msg";
    msg.innerHTML = "<b>绿角犀 Office v" + info.version + "</b> 已发布" +
      (info.notes && info.notes.length
        ? "<br><span class=\"muted\">" + info.notes.slice(0, 2).join("；") + "</span>"
        : "");
    const actions = document.createElement("div");
    actions.className = "updater-actions";
    const btnUpdate = document.createElement("button");
    btnUpdate.className = "btn primary";
    btnUpdate.textContent = "立即更新"; // 桌面/Web 均走应用内更新（桌面为静默下载安装，无需手动下载原件）
    btnUpdate.onclick = function () { applyUpdate(info); };
    const btnClose = document.createElement("button");
    btnClose.className = "btn";
    btnClose.textContent = "稍后";
    btnClose.onclick = function () { bar.remove(); };
    actions.appendChild(btnUpdate);
    actions.appendChild(btnClose);
    bar.appendChild(msg);
    bar.appendChild(actions);
  }

  function applyUpdate(info) {
    if (isNativeShell()) {
      // 桌面端：默认经主进程 IPC 走 electron-updater 静默下载 → 安装（应用内完成更新，无需手动下载原件）；
      // 主进程在无 electron-updater 时回传 ok:false，downloadAndInstall 会兜底打开发布页。
      if (global.electronAPI && typeof global.electronAPI.invoke === "function") {
        downloadAndInstall(info);
        return;
      }
      // 极端兜底：连 IPC 都不可用（不应发生），直接打开发布页
      const url = (info && info.url) || (pending && pending.url);
      if (url) {
        if (global.electronAPI && typeof global.electronAPI.openExternal === "function") global.electronAPI.openExternal(url);
        else if (global.open) global.open(url, "_blank");
      }
      return;
    }
    // Web / PWA：若 SW 已有等待中的新版，直接激活；否则触发更新并刷新
    if (swReg && swReg.waiting) { swReg.waiting.postMessage({ type: "skip-waiting" }); return; }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then(function (reg) { if (reg) reg.update(); });
    }
    setTimeout(function () { location.reload(); }, 400); // 兜底刷新
  }

  // 桌面静默通道：触发下载，进度/完成由主进程推送事件驱动
  function downloadAndInstall(info) {
    const bar = document.getElementById("updater-banner");
    if (bar) {
      const actions = bar.querySelector(".updater-actions");
      if (actions) actions.innerHTML = "<span class=\"muted\">正在下载 v" + (info.version || "") + " …</span>";
    }
    global.electronAPI.invoke("updater:download").then(function (r) {
      if (!r || !r.ok) {
        // 下载失败 → 回退到打开发布页
        const url = (info && info.url) || (pending && pending.url);
        if (url && global.electronAPI.openExternal) global.electronAPI.openExternal(url);
        else if (global.open) global.open(url, "_blank");
        if (bar) bar.remove();
      }
    }).catch(function () {});
  }

  // 订阅主进程推送的下载进度 / 完成 / 错误事件
  function setupNativeListeners() {
    if (!global.electronAPI || typeof global.electronAPI.on !== "function") return;
    global.electronAPI.on("updater:progress", function (pct) {
      const bar = document.getElementById("updater-banner");
      if (bar) { const m = bar.querySelector(".updater-msg"); if (m) m.innerHTML = "<b>正在下载更新… " + (pct || 0) + "%</b>"; }
    });
    global.electronAPI.on("updater:downloaded", function () {
      const bar = document.getElementById("updater-banner");
      if (bar) { const a = bar.querySelector(".updater-actions"); if (a) a.innerHTML = "<span class=\"muted\">下载完成，即将重启安装…</span>"; }
      if (global.electronAPI.invoke) global.electronAPI.invoke("updater:install");
    });
    global.electronAPI.on("updater:error", function (msg, downloadUrl) {
      if (OS.toast) OS.toast("自动更新失败：" + msg, "warn");
      // 静默安装被系统/杀软拦截（如未签名的 Windows 安装包）时，兜底打开发布页手动下载
      const url = (downloadUrl || (pending && pending.url) || "");
      if (url && /^https?:\/\//.test(url)) {
        if (global.electronAPI && typeof global.electronAPI.openExternal === "function") global.electronAPI.openExternal(url);
        else if (global.open) global.open(url, "_blank");
      }
    });
  }

  function start() {
    if (timer) return;
    current = readCurrent();
    OS.version = current;
    // 捕获 SW 注册，便于后台接管新版本
    if (!isNativeShell() && "serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg) {
          swReg = reg;
          reg.addEventListener("updatefound", function () {
            const nw = reg.installing;
            if (nw) nw.addEventListener("statechange", function () {
              if (nw.state === "installed" && navigator.serviceWorker.controller) checkNow();
            });
          });
        }
      });
    }
    // 桌面版：订阅主进程静默更新推送（无 electronAPI 时跳过）
    if (isNativeShell() && global.electronAPI && typeof global.electronAPI.invoke === "function") {
      setupNativeListeners();
    }
    setTimeout(function () { checkNow(); }, 8000); // 启动后稍延迟首查，避免抢占初始化
    timer = setInterval(function () {
      if (Date.now() - lastCheck > CHECK_INTERVAL * 0.8) checkNow();
    }, 60 * 1000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && Date.now() - lastCheck > CHECK_INTERVAL) checkNow();
    });
    OS.bus && OS.bus.emit("updater:started", { current: current });
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  function status() { return { current: current, lastCheck: lastCheck, pending: pending ? pending.version : null }; }

  OS.updater = {
    CHECK_INTERVAL: CHECK_INTERVAL,
    FEED_URL: FEED_URL,
    start: start,
    stop: stop,
    checkNow: checkNow,
    applyUpdate: applyUpdate,
    compareVersion: compareVersion,
    parseVersion: parseVersion,
    currentVersion: function () { return current || readCurrent(); },
    status: status
  };
})(window);
