#!/usr/bin/env node
/**
 * 开发版启动器 —— 默认开启 CDP 调试端口
 * 用法：node scripts/dev-start.js
 * 下次卡死时用这个启动，然后另开终端跑 scripts/cdp-capture.js 抓日志
 */
const { spawn } = require("child_process");
const path = require("path");

const electronBin = require("electron");
const appDir = path.resolve(__dirname, "..");

console.log("🚀 启动 Dev 版（CDP: http://127.0.0.1:9222）...");
console.log("📋 另开终端跑: node scripts/cdp-capture.js   抓卡死日志");
console.log("────────────────────────────────────────");

const child = spawn(electronBin, [
  ".",
  "--remote-debugging-port=9222",
  "--enable-logging",
  "--v=1"
], {
  cwd: appDir,
  stdio: "inherit",
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" }
});

child.on("exit", (code) => {
  console.log(`\n👋 Electron 退出 code=${code}`);
  process.exit(code || 0);
});

// Ctrl+C 时优雅退出
process.on("SIGINT", () => { child.kill(); process.exit(0); });
