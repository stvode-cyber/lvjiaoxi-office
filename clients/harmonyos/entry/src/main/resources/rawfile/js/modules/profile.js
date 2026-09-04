/* ============================================================
   绿角犀 Office · 业务板块：我的（账户 / 偏好 / 关于）
   无存储对象；直接对接 OS.auth / OS.theme / OS.settings
   版本号取自 <meta name="x-app-version">
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  function appVersion() {
    const m = global.document && global.document.querySelector && global.document.querySelector('meta[name="x-app-version"]');
    return (m && m.content) || "开发版";
  }
  function currentUserName() {
    try { const c = OS.auth.current(); return c && c.username ? c.username : null; } catch (e) { return null; }
  }
  function cloudLabel() {
    try { return OS.auth.isCloudLinked() ? "云端已连接" : "仅本地"; } catch (e) { return "仅本地"; }
  }

  async function render(el) {
    if (!el) return;
    const user = currentUserName();
    const themeDark = OS.theme.get() === "dark";
    const autosave = OS.settings.get("autosave") !== false;
    const localOnly = !!OS.settings.get("dataLocalOnly");

    el.innerHTML = [
      '<div class="panel-head"><h2>我的</h2><span class="muted">账户 · 偏好 · 关于</span></div>',
      '<div class="panel-card">',
      '  <div class="pt-name">账户与存储</div>',
      '  <div class="profile-row">',
      '    <div>',
      '      <div class="profile-user">' + (user ? esc(user) : "游客模式（未登录）") + '</div>',
      '      <div class="muted" style="font-size:12px">' + (user ? (cloudLabel() + " · 个人空间 " + Math.round(OS.auth.QUOTA / 1024 / 1024) + "MB") : "登录后启用个人云空间（本地优先 · 离线可用）") + '</div>',
      '    </div>',
      '    <span class="profile-actions">',
      (user ? '<button class="btn tiny danger" id="pf-logout">退出登录</button>' : '<button class="btn tiny primary" id="pf-login">登录</button>'),
      '      <button class="btn tiny" id="pf-account">账户与存储</button>',
      '    </span>',
      '  </div>',
      '</div>',
      '<div class="panel-card" style="margin-top:14px">',
      '  <div class="pt-name">偏好设置</div>',
      '  <label class="pf-row"><span>深色主题</span><input type="checkbox" id="pf-theme"' + (themeDark ? " checked" : "") + '></label>',
      '  <label class="pf-row"><span>自动保存</span><input type="checkbox" id="pf-autosave"' + (autosave ? " checked" : "") + '></label>',
      '  <label class="pf-row"><span>数据不出一机（仅在本地存储）</span><input type="checkbox" id="pf-local"' + (localOnly ? " checked" : "") + '></label>',
      '  <p class="muted" style="font-size:11.5px;margin:6px 0 0">偏好即时生效并自动记忆。</p>',
      '</div>',
      '<div class="panel-card" style="margin-top:14px">',
      '  <div class="pt-name">关于</div>',
      '  <div class="profile-row"><span class="muted">版本</span><span>绿角犀 Office ' + esc(appVersion()) + '</span></div>',
      '  <div class="profile-row"><span class="muted">能力</span><span>文档 · 表格 · 演示 · 脑图 · PDF</span></div>',
      '  <div class="profile-row"><span class="muted">兼容</span><span>OOXML / ODF / OFD · 本地优先 · 隐私可控</span></div>',
      '</div>'
    ].join("\n");

    const openAcct = () => global.document &&
      global.document.dispatchEvent(new global.CustomEvent("app:open-account"));
    const lg = el.querySelector("#pf-login"); if (lg) lg.addEventListener("click", openAcct);
    const ac = el.querySelector("#pf-account"); if (ac) ac.addEventListener("click", openAcct);
    const lo = el.querySelector("#pf-logout");
    if (lo) lo.addEventListener("click", async () => {
      if (confirm("确定退出当前账号？")) { try { await OS.auth.logout(); } catch (e) {} await render(el); }
    });

    el.querySelector("#pf-theme").addEventListener("change", e => OS.theme.set(e.target.checked ? "dark" : "light"));
    el.querySelector("#pf-autosave").addEventListener("change", e => OS.settings.set("autosave", e.target.checked));
    el.querySelector("#pf-local").addEventListener("change", e => OS.settings.set("dataLocalOnly", e.target.checked));
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  OS.biz = OS.biz || {};
  OS.biz.profile = { render, appVersion, currentUserName, cloudLabel };
})(window);