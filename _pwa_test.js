/* 绿角犀 Office · PWA 结构完整性测试
 * 运行：node _pwa_test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const app = f => path.join(ROOT, "app", f);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✅ " + name); }
  catch(e) { failed++; console.log("  ❌ " + name + ": " + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

console.log("=".repeat(60));
console.log("PWA 结构完整性测试");
console.log("=".repeat(60));

// —— 1. manifest ——
console.log("\n[1] manifest.webmanifest");
test("文件存在", () => assert(fs.existsSync(app("manifest.webmanifest"))));
const manifest = JSON.parse(fs.readFileSync(app("manifest.webmanifest"), "utf8"));
test("合法 JSON", () => assert(typeof manifest === "object"));
test("name 字段", () => assert(manifest.name && manifest.name.length > 0));
test("short_name 字段", () => assert(manifest.short_name));
test("start_url = '.'", () => assert(manifest.start_url === "."));
test("display=standalone", () => assert(manifest.display === "standalone"));
test("theme_color", () => assert(manifest.theme_color));
test("background_color", () => assert(manifest.background_color));
test("icons 数组非空", () => assert(Array.isArray(manifest.icons) && manifest.icons.length > 0));
test("icon.svg 实际存在", () => assert(fs.existsSync(app(manifest.icons[0].src))));

// —— 2. sw.js ——
console.log("\n[2] sw.js");
const sw = fs.readFileSync(app("sw.js"), "utf8");
test("文件存在且有内容", () => assert(sw.length > 100));

// 用简单字符串检查（避开 PowerShell regex 转义地狱）
const hasCache = sw.indexOf('const CACHE = "lvjiaoxi-office-v') !== -1;
test("CACHE 常量", () => assert(hasCache));
// 避开 PowerShell regex 双引号地狱
const cacheLine = sw.split('\n').find(l => l.indexOf('const CACHE = ') !== -1) || '';
const cacheVer = (cacheLine.split('"')[1] || '');
test("CACHE 版本号 >= v25", () => {
  const n = parseInt(cacheVer.split('v').pop());
  assert(n >= 25, "需要 >= v25（当前 " + cacheVer + "）");
});
test("LANGDATA_CACHE 独立", () => assert(sw.indexOf("const LANGDATA_CACHE =") !== -1));
test("shouldAutoCache 函数", () => assert(sw.indexOf("function shouldAutoCache") !== -1));
test("shouldAutoCache 排除 tesseract/lang-data", () => assert(sw.indexOf("tesseract/lang-data") !== -1));
test("install listener", () => assert(sw.indexOf('addEventListener("install"') !== -1));
test("activate listener", () => assert(sw.indexOf('addEventListener("activate"') !== -1));
test("fetch listener", () => assert(sw.indexOf('addEventListener("fetch"') !== -1));
test("message listener (skip-waiting)", () => assert(sw.indexOf("skip-waiting") !== -1));

// —— 3. ASSETS 列表 ——
console.log("\n[3] ASSETS 预缓存列表");
// 简单解析：找 "const ASSETS = [" 然后找下一个 "]"
const asStart = sw.indexOf("const ASSETS = [");
const asEnd = sw.indexOf("]", asStart);
const asBlock = sw.substring(asStart, asEnd);
// 提取所有 "./xxx" 路径
const assets = [];
let pos = 0;
const prefix = "./";
while ((pos = asBlock.indexOf(prefix, pos)) !== -1) {
  let end = asBlock.indexOf('"', pos + 2);
  if (end === -1) end = asBlock.indexOf("'", pos + 2);
  if (end !== -1) {
    const rel = asBlock.substring(pos + 2, end);
    if (!rel.includes("lang-data")) assets.push(rel);
    pos = end + 1;
  } else break;
}
test("能解析出 ASSETS 数组", () => assert(assets.length > 0, "没找到任何 ASSETS"));
console.log("  📋 ASSETS 共 " + assets.length + " 项");

// 检查每个文件是否存在
let missing = 0;
assets.forEach(a => {
  if (!fs.existsSync(app(a))) { missing++; failed++; console.log("  ❌ 缺文件: app/" + a); }
});
if (missing === 0) { passed++; console.log("  ✅ 全部 " + assets.length + " 项实际存在"); }

// —— 4. vendor 核心库覆盖 ——
console.log("\n[4] vendor 核心库覆盖");
const requiredVendors = [
  "vendor/pdf.worker.min.js",
  "vendor/pdf.min.js",
  "vendor/pdf-lib.min.js",
  "vendor/jszip.min.js",
  "vendor/xlsx.full.min.js",
  "vendor/docx.umd.min.js",
  "vendor/FileSaver.min.js",
  "vendor/fontkit.min.js",
  "vendor/tesseract/tesseract.min.js",
  "vendor/tesseract/worker.min.js"
];
requiredVendors.forEach(v => {
  test(v + " 在 ASSETS 中", () => assert(assets.indexOf(v) !== -1, v + " 未进 ASSETS"));
  test(v + " 实际存在", () => assert(fs.existsSync(app(v)), v + " 不存在"));
});

// —— 5. shell.js beforeinstallprompt ——
console.log("\n[5] shell.js PWA 安装引导");
const shell = fs.readFileSync(app("js/shell.js"), "utf8");
test("beforeinstallprompt 事件监听", () => assert(shell.indexOf("beforeinstallprompt") !== -1));
test("appinstalled 事件监听", () => assert(shell.indexOf("appinstalled") !== -1));
test("window.__installPrompt 暴露", () => assert(shell.indexOf("__installPrompt") !== -1));
test("showAbout 有安装按钮", () => assert(shell.indexOf("📱") !== -1));
test("pwaInstallAvailable 设置", () => assert(shell.indexOf("pwaInstallAvailable") !== -1));

// —— 总结 ——
console.log("\n" + "=".repeat(60));
console.log("结果: " + passed + "/" + (passed + failed) + (failed ? " 红 ❌ " + failed : " 全绿 ✅"));
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);

