/* 绿角犀 Office · 全自动更新模式 UI/链路测试（锁定 v1.0.15 行为）
   验证：1) checkNow 发现新版本后只提示「后台自动下载」，无手动「立即更新」按钮；
        2) 主进程推送 updater:downloaded -> 横幅出现「立即重启 / 稍后」，点「立即重启」触发 updater:install；
        3) updater:error 兜底 openExternal(fallbackUrl)；
        4) applyUpdate 桌面分支走静默下载 IPC（updater:download）。
   注：用 Capacitor 桩触发「原生壳走 IPC」分支（与 Electron 分支在 updater.js 中等价）。 */
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

const APP = "D:/源码存档/绿角犀办公软件/app";
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  ✗ " + name); } }

const vc = new VirtualConsole();
vc.on("jsdomError", () => {});
const dom = new JSDOM(`<!DOCTYPE html><html><head><meta name="x-app-version" content="1.0.0"></head><body></body></html>`,
  { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc });
const { window } = dom;

// 原生壳分支桩（等价于 Electron 走 IPC）
window.Capacitor = { isNativePlatform: () => true };
window.OS = { bus: { emit() {}, on() {} }, toast() {} };

const handlers = {};
const invoked = [];
let opened = null;
window.electronAPI = {
  invoke: async (chan) => {
    invoked.push(chan);
    if (chan === "updater:check") return { version: "1.1.0", url: "https://example.com/dl" };
    return { ok: true };
  },
  on: (chan, cb) => { handlers[chan] = cb; },
  removeListener: () => {},
  openExternal: (u) => { opened = u; }
};

const s = window.document.createElement("script");
s.textContent = fs.readFileSync(path.join(APP, "js/updater.js"), "utf8");
window.document.body.appendChild(s);

const U = window.OS.updater;
const btnWith = (root, text) => root && Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);

(async function () {
  ok("OS.updater 已定义", !!U);

  // 订阅主进程推送（start 内 setupNativeListeners，需先调）
  U.start();
  U.stop();

  // 1. checkNow 发现新版本 -> 自动下载提示，无「立即更新」手动按钮
  const r = await U.checkNow();
  ok("checkNow 返回新版本", r && r.version === "1.1.0");
  const bar = window.document.getElementById("updater-banner");
  ok("横幅已创建", !!bar);
  ok("提示含『后台自动下载更新』", bar && /后台自动下载更新/.test(bar.textContent));
  ok("自动模式无『立即更新』手动按钮", !btnWith(bar, "立即更新"));

  // 2. 主进程推送 downloaded -> 出现「立即重启 / 稍后」
  handlers["updater:downloaded"] && handlers["updater:downloaded"]();
  const bar2 = window.document.getElementById("updater-banner");
  ok("downloaded 后显示『新版本已下载完成』", bar2 && /新版本已下载完成/.test(bar2.textContent));
  const btnNow = btnWith(bar2, "立即重启");
  ok("存在『立即重启』按钮", !!btnNow);
  const btnLater = btnWith(bar2, "稍后");
  ok("存在『稍后』按钮", !!btnLater);

  // 3. 点击「立即重启」 -> 调 updater:install
  invoked.length = 0;
  if (btnNow) btnNow.onclick();
  ok("点击立即重启调用 updater:install", invoked.includes("updater:install"));

  // 4. updater:error 兜底打开发布页（含 downloadUrl）
  opened = null;
  handlers["updater:error"] && handlers["updater:error"]("install blocked", "https://example.com/fallback");
  ok("更新错误兜底 openExternal(fallback)", opened === "https://example.com/fallback");

  // 5. applyUpdate 桌面分支走静默下载 IPC
  invoked.length = 0;
  U.applyUpdate({ version: "1.1.0", url: "https://example.com/dl" });
  ok("applyUpdate 触发 updater:download（静默通道）", invoked.includes("updater:download"));

  const summary = `UPDATER-AUTO TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})();
