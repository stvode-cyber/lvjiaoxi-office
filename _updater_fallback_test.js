/* 绿角犀 Office · 渲染端更新回退测试
   验证：
   - 桌面静默通道安装失败（updater:error，如未签名）时，自动打开发布页下载；
   - 非静默通道下 applyUpdate 直接打开 info.url。 */
const { JSDOM, VirtualConsole } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");

const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";
const UPDATER = fs.readFileSync(path.join(APP, "js/updater.js"), "utf8");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  ✗ " + name); } }

function makeDom(electronApi) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta name="x-app-version" content="1.0.0"></head><body></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc });
  const { window } = dom;
  window.OS = { bus: { emit() {}, on() {} }, toast() {} };
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => "Electron" });
  window.electronAPI = electronApi;
  const s = window.document.createElement("script");
  s.textContent = UPDATER;
  window.document.body.appendChild(s);
  return window;
}

(async function () {
  // ---- DOM1：静默通道 + 安装失败回退打开发布页 ----
  let errHandler = null;
  const w1 = makeDom({
    invoke: async (chan) => {
      if (chan === "updater:check") return { version: "2.0.0", upToDate: false, usingAutoUpdater: true, url: "https://github.com/o/r/releases" };
      return { ok: true };
    },
    openExternal: (u) => { w1.__opened = u; },
    on: (ev, fn) => { if (ev === "updater:error") errHandler = fn; },
    removeListener() {}
  });
  const U1 = w1.OS.updater;
  ok("DOM1 OS.updater 已定义", !!U1);
  U1.start(); U1.stop();
  ok("捕获到 updater:error 监听", typeof errHandler === "function");
  await U1.checkNow();
  ok("checkNow 设置 pending", U1.status().pending === "2.0.0");
  w1.__opened = null;
  errHandler("Cannot install unsigned package");
  ok("安装失败回退打开发布页", w1.__opened === "https://github.com/o/r/releases");

  // ---- DOM2：非静默通道，applyUpdate 直接打开发布页 ----
  const w2 = makeDom({
    invoke: async () => ({ ok: true }),
    openExternal: (u) => { w2.__opened = u; },
    on() {}, removeListener() {}
  });
  const U2 = w2.OS.updater;
  w2.__opened = null;
  U2.applyUpdate({ version: "3.0.0", url: "https://example.com/dl" }); // _autoEnabled 默认 false -> 非静默打开
  ok("非静默通道 applyUpdate 打开发布页", w2.__opened === "https://example.com/dl");

  const summary = `UPDATER-FALLBACK TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})();
