/* 绿角犀 Office · 业务板块·我的 渲染测试
 * 覆盖：游客/已登录渲染、版本号、偏好开关状态、交互后持久化
 * 运行：node _profile_biz_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = "D:/源码存档/绿角犀办公软件/app";
// 版本单一真源：从 package.json 读取
const VER = JSON.parse(fs.readFileSync(path.join(APP, "..", "package.json"), "utf8")).version;
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function setup(over) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta name="x-app-version" content="${VER}"></head><body><div id="pf"></div></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  let theme = "light";
  const settings = { autosave: true, dataLocalOnly: false };
  window.OS = Object.assign({
    theme: { get: () => theme, set: t => { theme = t; window.document.documentElement.setAttribute("data-theme", t); }, toggle: () => { theme = theme === "light" ? "dark" : "light"; } },
    settings: { get: k => settings[k], set: (k, v) => { settings[k] = v; } },
    auth: {
      QUOTA: 50 * 1024 * 1024,
      current: () => ({ username: "测试用户", token: null }), // 默认已登录
      isLoggedIn: () => true,
      isCloudLinked: () => false,
      async logout() {}
    }
  }, over || {});
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/profile.js"), "utf8");
  window.document.body.appendChild(s);
  const el = window.document.getElementById("pf");
  return { window, OS: window.OS, pf: window.OS.biz.profile, el };
}

(async function main() {
  console.log("=== 「我的」板块测试 ===\n");

  console.log("--- 1. 纯函数 ---");
  ok("appVersion 读取 meta", setup().pf.appVersion() === VER);
  ok("currentUserName 已登录返回用户名", setup().pf.currentUserName() === "测试用户");

  console.log("\n--- 2. 已登录渲染 ---");
  {
    const { pf, el } = setup();
    await pf.render(el);
    ok("显示用户名", el.innerHTML.includes("测试用户"));
    ok("显示个人空间大小", el.innerHTML.includes("50MB"));
    ok("含退出登录按钮", !!el.querySelector("#pf-logout"));
    ok("无登录按钮", !el.querySelector("#pf-login"));
    ok("含主题开关", !!el.querySelector("#pf-theme"));
    ok("自动保存默认勾选", el.querySelector("#pf-autosave").checked === true);
    ok("含版本信息", el.innerHTML.includes(VER));
  }

  console.log("\n--- 3. 游客渲染 ---");
  {
    const { pf, el, OS } = setup({ auth: { QUOTA: 50 * 1024 * 1024, current: () => null, isLoggedIn: () => false, isCloudLinked: () => false, async logout() {} } });
    await pf.render(el);
    ok("显示游客提示", el.innerHTML.includes("游客模式"));
    ok("含登录按钮", !!el.querySelector("#pf-login"));
    ok("无退出按钮", !el.querySelector("#pf-logout"));
  }

  console.log("\n--- 4. 偏好交互持久化 ---");
  {
    const { pf, el, OS, window: w } = setup();
    await pf.render(el);
    const change = () => new w.Event("change", { bubbles: true });
    // 关闭自动保存开关
    const as = el.querySelector("#pf-autosave"); as.checked = false; as.dispatchEvent(change());
    await pf.render(el);
    ok("自动保存偏好已持久化", OS.settings.get("autosave") === false);
    ok("再次渲染后开关状态一致", el.querySelector("#pf-autosave").checked === false);
    // 开启深色
    const th = el.querySelector("#pf-theme"); th.checked = true; th.dispatchEvent(change());
    ok("深色主题已生效", OS.theme.get() === "dark");
  }

  const summary = `\n=== 「我的」板块测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });