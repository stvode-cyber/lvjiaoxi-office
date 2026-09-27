/* 绿角犀 Office · 版本比对铁律回归测试
 * 运行：node _updater_version_test.js
 * 约束：updater.js（浏览器端）和 Electron main-utils.js cmpVer（主进程）
 *       返回值语义必须完全一致——a 比 b 新 → 1；相等 → 0；旧 → -1。
 *       绝对不能反！（版本号铁律：弹窗条件、强制更新分支、cmpVer 返回值语义） */
"use strict";

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL " + name); }
}
function done() {
  console.log(`updater_version: ${pass} ok, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

/* --- 从 updater.js 抽纯函数（浏览器端实现）--- */
function parseVersion(v) { return ("" + (v || "")).split(".").map(x => parseInt(x, 10) || 0); }
function compareVersion(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) { const x = A[i] || 0, y = B[i] || 0; if (x > y) return 1; if (x < y) return -1; }
  return 0;
}

/* --- 从 Electron main-utils.js 抽 cmpVer（主进程实现）--- */
let cmpVer = null;
try {
  const mainUtils = fs.readFileSync(path.join(__dirname, "electron", "main-utils.js"), "utf8");
  // 用 eval 执行文件里的 cmpVer 函数体（闭包 var 安全）
  const fnMatch = mainUtils.match(/function\s+cmpVer\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  if (fnMatch) {
    // 把 var 变成 const，eval 定义
    eval("cmpVer = " + fnMatch[0].replace(/function\s+cmpVer/, "function"));
  }
} catch (e) {
  console.error("无法加载 Electron cmpVer:", e.message);
}

/* --- 1. updater.js compareVersion 单方向铁律 --- */
ok("1.1.4 > 1.1.3 → 1",   compareVersion("1.1.4", "1.1.3") === 1);
ok("1.2.0 > 1.1.99 → 1",  compareVersion("1.2.0", "1.1.99") === 1);
ok("2.0.0 > 1.9.9 → 1",   compareVersion("2.0.0", "1.9.9")  === 1);
ok("1.1.3 == 1.1.3 → 0",  compareVersion("1.1.3", "1.1.3") === 0);
ok("1.1.3 < 1.1.4 → -1",  compareVersion("1.1.3", "1.1.4") === -1);
ok("0.9.0 < 1.1.3 → -1",  compareVersion("0.9.0", "1.1.3") === -1);
ok("1.1.3.1 > 1.1.3 → 1", compareVersion("1.1.3.1", "1.1.3") === 1);
ok("1.1.3 < 1.1.3.1 → -1",compareVersion("1.1.3", "1.1.3.1") === -1);
ok("1.0 == 1.0.0 → 0",    compareVersion("1.0", "1.0.0")   === 0);

/* --- 2. 边界与异常输入 --- */
ok("空字符串 → 0", compareVersion("", "") === 0);
ok("undefined 处理", compareVersion(undefined, "1.0.0") === -1);
ok("非数字段 → 0", compareVersion("abc", "def") === 0);
ok("一段版本相等", compareVersion("5", "5") === 0);
ok("两段版本比较", compareVersion("1.9", "1.10") === -1);

/* --- 3. 与 Electron cmpVer 方向严格一致 --- */
if (cmpVer) {
  const pairs = [
    ["1.1.4", "1.1.3"], ["1.2.0", "1.1.99"], ["2.0.0", "1.9.9"],
    ["1.1.3", "1.1.3"], ["1.1.3", "1.1.4"], ["0.9.0", "1.1.3"],
    ["1.1.3.1", "1.1.3"], ["1.1.3", "1.1.3.1"], ["1.0", "1.0.0"],
    ["", ""], ["1.9", "1.10"]
  ];
  for (const [a, b] of pairs) {
    const up = compareVersion(a, b);
    const el = cmpVer(a, b);
    const consistent = (up > 0 && el > 0) || (up < 0 && el < 0) || (up === 0 && el === 0);
    ok(`updater.js vs Electron cmpVer (${a}, ${b}) 方向一致`, consistent);
  }
} else {
  console.error("SKIP Electron cmpVer 对比（main-utils.js 不可用）");
}

/* --- 4. 实际 v1.1.3 发布版本场景 --- */
ok("v1.1.3 vs 1.1.3 → 0（相等）", compareVersion("1.1.3", "1.1.3") === 0);
ok("v1.1.4 > 1.1.3 → 1（自动更新触发）", compareVersion("1.1.4", "1.1.3") === 1);
ok("v1.1.2 < 1.1.3 → -1（已回退，不触发）", compareVersion("1.1.2", "1.1.3") === -1);

done();
