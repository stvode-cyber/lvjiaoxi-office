/* ============================================================
 * 绿角犀 Office · 统一测试运行器（零依赖）
 * ------------------------------------------------------------
 * 自动发现仓库根目录下的 _*_test.js 套件，逐个以子进程运行：
 *   - 每个套件独立进程（隔离全局污染）
 *   - 统一超时（默认 60s，可用 --timeout 覆盖，单位秒）
 *   - 汇总 PASS / FAIL 套件数，任一失败则进程退出码非零
 *   - 兼容现有「行内 ok() 标记」与「process.exit(1)」两种失败信号：
 *       套件内部已经用 process.exit(fail?1:0) 表达结果，本运行器
 *       直接复用其退出码；额外捕获超时 / 崩溃。
 *
 * 用法：
 *   node scripts/run-tests.js           # 运行全部
 *   node scripts/run-tests.js writer    # 仅运行文件名含 writer 的套件
 *   node scripts/run-tests.js --timeout 120
 * ============================================================ */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const NODE = process.execPath; // CI/沙箱均使用当前 Node
const DEFAULT_TIMEOUT = 60 * 1000;

function parseArgs(argv) {
  const filters = [];
  let timeout = DEFAULT_TIMEOUT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--timeout") { timeout = parseInt(argv[++i], 10) * 1000; }
    else if (a.startsWith("--timeout=")) { timeout = parseInt(a.split("=")[1], 10) * 1000; }
    else if (a === "--help" || a === "-h") {
      console.log("用法: node scripts/run-tests.js [--timeout SECONDS] [name-filter...]");
      process.exit(0);
    } else filters.push(a);
  }
  return { filters, timeout };
}

function discoverSuites(filters) {
  const all = fs.readdirSync(ROOT)
    .filter((f) => /^_.*_test\.js$/.test(f))
    .sort();
  const filtered = filters.length
    ? all.filter((f) => filters.some((kw) => f.toLowerCase().includes(kw.toLowerCase())))
    : all;
  return filtered;
}

function runSuite(file, timeout) {
  const abs = path.join(ROOT, file);
  const started = Date.now();
  const res = spawnSync(NODE, [abs], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    // 不继承 stdio，避免子进程报错刷屏；仅在失败时回显末尾
  });
  const elapsed = Date.now() - started;

  if (res.error && res.error.code === "ETIMEDOUT") {
    return { file, ok: false, reason: "超时（>" + (timeout / 1000) + "s）", elapsed };
  }
  if (res.error) {
    return { file, ok: false, reason: "运行器错误: " + res.error.message, elapsed };
  }
  const code = res.status === null ? 1 : res.status;
  if (code !== 0) {
    const tail = (res.stderr || res.stdout || "").trim().split("\n").slice(-6).join("\n");
    return { file, ok: false, reason: "退出码 " + code, detail: tail, elapsed };
  }
  return { file, ok: true, elapsed };
}

function main() {
  const { filters, timeout } = parseArgs(process.argv.slice(2));
  const suites = discoverSuites(filters);

  if (!suites.length) {
    console.log("未找到匹配测试套件（filters=" + (filters.join(",") || "无") + "）");
    process.exit(1);
  }

  console.log("发现 " + suites.length + " 个测试套件，开始运行…\n");
  const results = [];
  let maxLen = 0;
  suites.forEach((f) => { if (f.length > maxLen) maxLen = f.length; });

  for (const file of suites) {
    const r = runSuite(file, timeout);
    results.push(r);
    const tag = r.ok ? "✓ PASS" : "✗ FAIL";
    const pad = " ".repeat(maxLen - file.length + 2);
    console.log(tag + pad + file + "  (" + r.elapsed + "ms)");
    if (!r.ok) {
      console.log("   ↳ " + r.reason);
      if (r.detail) console.log("   " + r.detail.split("\n").join("\n   "));
    }
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log("\n========================================");
  console.log("套件结果: " + pass + " passed, " + fail + " failed, 共 " + results.length);
  console.log("========================================");

  process.exit(fail ? 1 : 0);
}

// 直接运行时执行；被 require 时仅导出（便于单测，不污染进程退出码）
if (require.main === module) main();

module.exports = { parseArgs, discoverSuites, runSuite, ROOT, NODE };
