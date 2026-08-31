/* 绿角犀 Office · 后台自动更新器测试
   验证：版本号解析/比较、checkNow 对新/同/旧版本与拉取失败的处理、更新横幅创建。 */
const { JSDOM, VirtualConsole } = require("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom");
const fs = require("fs");
const path = require("path");

const APP = "C:/Users/Administrator/Desktop/绿角犀办公软件/app";
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  ✗ " + name); } }

const vc = new VirtualConsole();
vc.on("jsdomError", () => {});
const dom = new JSDOM(`<!DOCTYPE html><html><head><meta name="x-app-version" content="1.0.0"></head><body></body></html>`,
  { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc });
const { window } = dom;

// stub OS（bus / toast）与 fetch
window.OS = { bus: { emit() {}, on() {} }, toast() {} };
let feed = { version: "1.1.0", notes: ["新功能上线"], url: "https://example.com/dl" };
window.fetch = async () => ({ ok: true, json: async () => feed });

const s = window.document.createElement("script");
s.textContent = fs.readFileSync(path.join(APP, "js/updater.js"), "utf8");
window.document.body.appendChild(s);

const U = window.OS.updater;
const has = (c, m) => { try { ok(m, !!c); } catch (e) { ok(m, false); } };

(async function () {
  has(U, "OS.updater 已定义");

  // 1-4 版本比较
  ok("compareVersion 新>旧", U.compareVersion("1.2.0", "1.1.9") === 1);
  ok("compareVersion 相等", U.compareVersion("1.0.0", "1.0.0") === 0);
  ok("compareVersion 旧<新", U.compareVersion("1.0.0", "1.0.1") === -1);
  ok("compareVersion 跨长度", U.compareVersion("1.0", "1.0.0") === 0);
  const pv = U.parseVersion("2.3.5");
  ok("parseVersion", pv[0] === 2 && pv[1] === 3 && pv[2] === 5);

  // 5 当前版本来自 meta
  ok("当前版本读取 meta", U.currentVersion() === "1.0.0");

  // 6 新版本 -> 返回 latest 并创建横幅
  feed = { version: "1.1.0", notes: ["新功能上线"], url: "https://example.com/dl" };
  let r = await U.checkNow();
  ok("新版本 checkNow 返回 latest", r && r.version === "1.1.0");
  ok("新版本创建 #updater-banner", !!window.document.getElementById("updater-banner"));
  window.document.getElementById("updater-banner").remove();

  // 7 同版本 -> 返回 null
  feed = { version: "1.0.0", notes: [], url: "" };
  r = await U.checkNow();
  ok("同版本 checkNow 返回 null", r === null);

  // 8 旧版本 -> 返回 null
  feed = { version: "0.9.0", notes: [], url: "" };
  r = await U.checkNow();
  ok("旧版本 checkNow 返回 null", r === null);

  // 9 拉取失败 -> 返回 null 不抛
  window.fetch = async () => { throw new Error("network down"); };
  r = await U.checkNow();
  ok("拉取失败 checkNow 返回 null", r === null);

  const summary = `UPDATER TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})();
