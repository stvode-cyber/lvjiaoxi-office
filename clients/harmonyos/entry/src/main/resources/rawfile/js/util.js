/* ============================================================
   绿角犀 Office · 工具与全局命名空间 (OS)
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // ---------- 事件总线 ----------
  const listeners = {};
  OS.bus = {
    on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); },
    emit(evt, payload) { (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }
  };

  // ---------- 通用工具 ----------
  OS.util = {
    uid(prefix) { return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); },
    debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; },
    escapeHtml(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    },
    fmtTime(ts) {
      if (!ts) return "";
      const d = new Date(ts);
      const p = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    fmtSize(bytes) {
      if (!bytes) return "0 B";
      const u = ["B", "KB", "MB", "GB"];
      let i = 0, n = bytes;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
    },
    // 下载 Blob / 触发文件保存
    download(blobOrUrl, filename) {
      if (global.saveAs) { global.saveAs(blobOrUrl, filename); return; }
      const a = document.createElement("a");
      a.href = (blobOrUrl instanceof Blob) ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
      a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      if (blobOrUrl instanceof Blob) setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
    // 读取 File 为文本/DataURL
    readFile(file, asDataUrl) {
      return new Promise((res, rej) => {
        const r = asDataUrl ? new FileReader() : new FileReader();
        r.onload = () => res(r.result); r.onerror = rej;
        if (asDataUrl) r.readAsDataURL(file); else r.readAsText(file);
      });
    }
  };

  // ---------- 主题 ----------
  OS.theme = {
    get() { return localStorage.getItem("os-theme") || "light"; },
    set(t) {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem("os-theme", t);
      OS.bus.emit("theme", t);
      _cssCache = null; // 主题切换时清缓存
    },
    toggle() { this.set(this.get() === "light" ? "dark" : "light"); },
    
    /**
     * 读 CSS 变量值，带缓存。JS 里的硬编码色值应改成：
     *   ctx.fillStyle = OS.theme.getVar("--accent");
     * 缓存在首次调用时构建一次，主题切换时 invalidate。
     */
    getVar(name) {
      if (!_cssCache) {
        const cs = getComputedStyle(document.documentElement);
        _cssCache = {};
        // 把常见变量一次性读出来
        ["--bg","--bg1","--bg2","--bg3","--ink","--ink2","--accent","--accent2","--accent-ink","--muted","--rule"].forEach(n => {
          _cssCache[n] = cs.getPropertyValue(n).trim();
        });
      }
      return _cssCache[name] || "";
    },
    
    /** 快捷映射：语义色 → CSS 变量 */
    color(name) {
      const map = {
        accent: "--accent",
        bg: "--bg", bg1: "--bg1", bg2: "--bg2",
        ink: "--ink", ink2: "--ink2",
        muted: "--muted", rule: "--rule",
      };
      return this.getVar(map[name] || name);
    }
  };

  // ---------- 全局 Undo 调度器（per-tab 路由）----------
  // 各模块实现自己的 undo/redo/canUndo/canRedo，这里只做：
  //   1. bindModule(tabId, instance) — shell.openDoc 时注册
  //   2. unbindModule(tabId) — 关闭标签页时清
  //   3. undo(tabId)/redo(tabId) — 快捷键或功能区按钮触发
  //   4. active() — 返回当前激活 tab 的实例（shell 调）
  // 设计约束：模块自己维护 undoStack/redoStack（snapshot 或 command 模式均可）。
  // 快照模式（spreadsheet/presentation/writer）：snapshot() 在每次 mutation 前 push。
  // 命令模式（可选）：pushCmd({exec, undo})，调度器自动快照 prev state。
  OS.Undo = {
    _modules: new Map(),   // tabId → {undo, redo, canUndo, canRedo}
    _order: [],            // tabId 激活顺序（最后一个是 active）

    bindModule(tabId, instance) {
      if (!instance || typeof instance.undo !== "function") return;
      this._modules.set(tabId, {
        undo: instance.undo.bind(instance),
        redo: instance.redo ? instance.redo.bind(instance) : null,
        canUndo: instance.canUndo ? instance.canUndo.bind(instance) : () => true,
        canRedo: instance.canRedo ? instance.canRedo.bind(instance) : () => true
      });
      this._order = this._order.filter((x) => x !== tabId);
      this._order.push(tabId);
      // TODO: [坑-os-undo-snapshot-execute] 未来可选 command 模式：
      // if (instance.pushCmd) this._cmdMode = true;
    },

    unbindModule(tabId) {
      this._modules.delete(tabId);
      this._order = this._order.filter((x) => x !== tabId);
    },

    activate(tabId) {
      // shell 的 activate(tab) 里调用
      this._order = this._order.filter((x) => x !== tabId);
      this._order.push(tabId);
    },

    active() {
      // 返回当前激活的模块实例（shell 快捷键调）
      const tid = this._order[this._order.length - 1];
      return tid ? { tabId: tid, ...this._modules.get(tid) } : null;
    },

    undo(tabId) {
      const m = tabId ? this._modules.get(tabId) : this.active();
      if (!m || !m.undo) return false;
      const r = m.undo();
      OS.bus.emit("undo-state");
      return r !== false;
    },

    redo(tabId) {
      const m = tabId ? this._modules.get(tabId) : this.active();
      if (!m || !m.redo) return false;
      const r = m.redo();
      OS.bus.emit("undo-state");
      return r !== false;
    },

    canUndo(tabId) {
      const m = tabId ? this._modules.get(tabId) : this.active();
      return m ? m.canUndo() : false;
    },

    canRedo(tabId) {
      const m = tabId ? this._modules.get(tabId) : this.active();
      return m ? m.canRedo() : false;
    }
  };
  
  let _cssCache = null;

  // ---------- 设置（含"数据不出域"开关，对应 PRD 3.6.5） ----------
  const SETTINGS_KEY = "os-settings";
  const defaults = { dataLocalOnly: false, autosave: true, defaultTheme: "light", requireLogin: false };
  OS.settings = {
    all() { try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch { return { ...defaults }; } },
    get(k) { return this.all()[k]; },
    set(k, v) { const s = this.all(); s[k] = v; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); OS.bus.emit("settings", s); }
  };

  // ---------- Toast ----------
  // TODO: [坑-toast-容器未挂载到-body] 预防：ensureHost 主动创建 toast-host 并 appendChild 到 body；body 未 ready 时 queue 缓存 + console 兜底
  const _toastQueue = [];
  let _hostEnsured = false;
  function _ensureHost() {
    if (_hostEnsured) return true;
    try {
      let host = document.getElementById("toast-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "toast-host";
        host.className = "toast-host";
      }
      if (!host.parentNode && document.body) {
        document.body.appendChild(host);
        _hostEnsured = true;
      }
      return _hostEnsured;
    } catch { return false; }
  }
  function _flushQueue() {
    if (!_ensureHost()) return;
    while (_toastQueue.length) {
      const { msg, kind } = _toastQueue.shift();
      OS.toast(msg, kind);
    }
  }
  if (typeof document !== "undefined") {
    if (document.body) _ensureHost();
    else document.addEventListener("DOMContentLoaded", () => { _ensureHost(); _flushQueue(); });
    window.addEventListener("load", _flushQueue);
  }
  OS.toast = function (msg, kind) {
    // 1. 优先 DOM toast-host
    if (_ensureHost()) {
      const host = document.getElementById("toast-host");
      if (host) {
        const el = document.createElement("div");
        el.className = "toast" + (kind ? " " + kind : "");
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2400);
        setTimeout(() => el.remove(), 2800);
        return;
      }
    }
    // 2. body 未 ready → queue 缓存
    if (typeof document !== "undefined" && !document.body) {
      _toastQueue.push({ msg, kind }); return;
    }
    // 3. Node 单测 / 无 DOM 环境 → console 兜底
    if (kind === "err" || kind === "error") console.error("[toast]", msg);
    else if (kind === "warn") console.warn("[toast]", msg);
    else console.log("[toast]", msg);
  };

  // 初始化主题
  OS.theme.set(OS.theme.get());
})(window);
