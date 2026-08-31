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
    },
    toggle() { this.set(this.get() === "light" ? "dark" : "light"); }
  };

  // ---------- 设置（含"数据不出域"开关，对应 PRD 3.6.5） ----------
  const SETTINGS_KEY = "os-settings";
  const defaults = { dataLocalOnly: false, autosave: true, defaultTheme: "light" };
  OS.settings = {
    all() { try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch { return { ...defaults }; } },
    get(k) { return this.all()[k]; },
    set(k, v) { const s = this.all(); s[k] = v; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); OS.bus.emit("settings", s); }
  };

  // ---------- Toast ----------
  OS.toast = function (msg, kind) {
    const host = document.getElementById("toast-host");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2400);
    setTimeout(() => el.remove(), 2800);
  };

  // 初始化主题
  OS.theme.set(OS.theme.get());
})(window);
