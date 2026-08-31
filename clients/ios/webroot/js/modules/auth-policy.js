/* ============================================================
   绿角犀 Office · 登录策略 (OS.AuthPolicy)
   - 纯逻辑：决定「启动是否强制要求登录」
   - 默认不强制（游客直接进入，离线可用）；用户可在「登录设定」中开启
   - 不依赖 DOM / window，可在 node 下单测
   - 三件套范式：IIFE + OS 全局 + module.exports
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  const KEY = "requireLogin"; // 对应 OS.settings 键

  // 是否应在启动时拦截（强制登录）。
  // 容错：无 settings / 异常时一律视为 false（不强制，游客可用）。
  function shouldGate() {
    try {
      if (!OS.settings || typeof OS.settings.get !== "function") return false;
      return !!OS.settings.get(KEY);
    } catch (e) { return false; }
  }

  // 设定是否强制登录（写入 settings）。无 settings 时静默 noop。
  function setRequire(v) {
    try {
      if (OS.settings && typeof OS.settings.set === "function") OS.settings.set(KEY, !!v);
    } catch (e) { /* 忽略：环境无 settings 时不影响纯逻辑判定 */ }
  }

  const Policy = { KEY, shouldGate, setRequire };

  // 浏览器环境挂全局
  if (typeof window !== "undefined" && window.OS) window.OS.AuthPolicy = Policy;
  // node / 测试导出
  if (typeof module !== "undefined" && module.exports) module.exports = Policy;
})(typeof window !== "undefined" ? window : global);
