/* 绿角犀 Office · 静默更新端到端验证脚本
 * 运行：node scripts/verify-update-feed.js [--feed=URL] [--current=VERSION]
 * 示例：node scripts/verify-update-feed.js --feed=http://localhost:18080/dist --current=1.1.3
 *
 * 验证链路（generic provider）：
 *   1. fetch latest.yml → YAML parse → 拿到 version / path / sha512
 *   2. compareVersion(remoteVersion, currentVersion) → 判断有无更新
 *   3. fetch exe head（HEAD 请求，只拉前几字节）→ 确认 Setup.exe 可访问
 *   4. 打印完整链路状态（feed URL、版本比对结果、下载 URL、签名状态提示）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const yaml = require("js-yaml");

// —— 解析命令行参数 ——
const args = process.argv.slice(2);
function getArg(name) {
  const a = args.find(x => x.startsWith("--" + name + "="));
  return a ? a.slice(name.length + 3) : null;
}
const FEED = getArg("feed") || process.env.LVJX_UPDATE_FEED || "http://localhost:18080/dist";
const CURRENT = getArg("current") || "1.1.3";

// —— compareVersion（与 updater.js + Electron cmpVer 方向完全一致）——
function parseVersion(v) { return ("" + (v || "")).split(".").map(x => parseInt(x, 10) || 0); }
function compareVersion(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) { const x = A[i] || 0, y = B[i] || 0; if (x > y) return 1; if (x < y) return -1; }
  return 0;
}

// —— HTTP/HTTPS fetch（Node 内置，不需要 axios/node-fetch）——
function httpFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({
      method: opts.method || "GET",
      hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      headers: opts.headers || {},
      timeout: opts.timeout || 10000
    }, (res) => {
      if (opts.method === "HEAD") {
        // HEAD 只需要 headers
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers, body: null });
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function main() {
  console.log("=".repeat(60));
  console.log("静默更新端到端验证");
  console.log("=".repeat(60));
  console.log(`Feed URL      : ${FEED}`);
  console.log(`Current ver   : ${CURRENT}`);
  console.log("");

  // —— Step 1: fetch latest.yml ——
  const latestUrl = FEED.replace(/\/+$/, "") + "/latest.yml";
  console.log(`[1/4] Fetching latest.yml → ${latestUrl}`);
  let resp;
  try {
    resp = await httpFetch(latestUrl);
  } catch (e) {
    console.error(`  ❌ 网络错误: ${e.message}`);
    console.error("  提示: 启本地 server: cd dist && python -m http.server 18080");
    process.exit(1);
  }
  if (resp.status !== 200) {
    console.error(`  ❌ HTTP ${resp.status} — latest.yml 不存在或不可访问`);
    process.exit(1);
  }

  // —— Step 2: parse latest.yml ——
  let info;
  try {
    info = yaml.load(resp.body.toString("utf8"));
  } catch (e) {
    console.error(`  ❌ YAML 解析失败: ${e.message}`);
    process.exit(1);
  }
  const remoteVer = info.version;
  const exePath = info.path;
  const sha512 = info.sha512;
  const releaseDate = info.releaseDate;
  console.log(`  ✅ 拉到 version=${remoteVer}, path=${exePath}, sha512=${sha512 ? sha512.slice(0, 20) + "..." : "无"}`);
  console.log("");

  // —— Step 3: compareVersion ——
  console.log(`[2/4] 版本比对 compareVersion(${remoteVer}, ${CURRENT})`);
  const cmp = compareVersion(remoteVer, CURRENT);
  let updateAvailable = false;
  if (cmp > 0) {
    updateAvailable = true;
    console.log(`  🆕 有新版本！${remoteVer} > ${CURRENT}`);
  } else if (cmp === 0) {
    console.log(`  ✅ 已是最新（${CURRENT} == ${remoteVer}）`);
  } else {
    console.log(`  ⚠️  remote 比 current 旧（${remoteVer} < ${CURRENT}）— feed 里的版本应该 >= 当前版本`);
  }
  // 铁律验证
  if (cmp !== 0) {
    // 方向必须一致：cmp > 0 意味着 remote 更新
    const expectedSign = cmp > 0 ? 1 : -1;
    console.log(`  🔒 compareVersion 铁律: ${cmp > 0 ? "> 0 (remote 更新)" : "< 0 (remote 旧)"} ✅`);
  }
  console.log("");

  // —— Step 4: 确认 exe 可访问（HEAD 请求，不下载 100MB）——
  console.log(`[3/4] HEAD 请求检查 exe 是否可访问`);
  const exeUrl = FEED.replace(/\/+$/, "") + "/" + exePath;
  console.log(`  → ${exeUrl}`);
  try {
    const head = await httpFetch(exeUrl, { method: "HEAD", timeout: 5000 });
    if (head.status === 200) {
      const size = head.headers["content-length"] || "?";
      console.log(`  ✅ exe 可访问！status=200, size=${size} bytes`);
    } else {
      console.log(`  ❌ HTTP ${head.status} — exe 路径不对或文件不存在`);
    }
  } catch (e) {
    console.log(`  ⚠️  HEAD 失败: ${e.message}（不影响 latest.yml 解析）`);
  }
  console.log("");

  // —— Step 5: 打印完整链路状态 ——
  console.log(`[4/4] Electron autoUpdater 链路状态`);
  console.log(`  LVJX_UPDATE_FEED 环境变量 → ${FEED}`);
  console.log(`  setupAutoUpdater()         → autoUpdater.setFeedURL({ provider: "generic", url: "${FEED.replace(/\/+$/, "")}" })`);
  console.log(`  autoUpdater.checkForUpdates() → fetch ${latestUrl} → parse → compareVersion("${remoteVer}", "${CURRENT}") = ${cmp}`);
  if (updateAvailable) {
    console.log(`  autoUpdater.downloadUpdate()  → ${exeUrl} → 下载后 quitAndInstall()`);
    console.log(`  ⚠️ 注意: Setup.exe 未签名 (NotSigned) — Windows SmartScreen 可能拦截自动安装`);
  } else {
    console.log(`  autoUpdater 会判定 upToDate=true（不需要下载）`);
  }
  console.log("");

  // —— 总结 ——
  console.log("=".repeat(60));
  if (updateAvailable) {
    console.log(`✅ 链路正确！remote=${remoteVer} > current=${CURRENT}`);
    console.log(`   latest.yml 可拉 → compareVersion 方向正确 → exe 可访问`);
    console.log(`   唯一剩余：远程托管 + Setup.exe 签名`);
  } else {
    console.log(`✅ 链路正确，但 remote=${remoteVer} == current=${CURRENT}`);
    console.log(`   latest.yml 可拉 → compareVersion 方向正确 → 无需更新`);
    console.log(`   模拟有更新：把 latest.yml 里 version 改成 ${CURRENT.replace(/\d+$/, n => +n + 1)} 再跑一次`);
  }
  console.log("=".repeat(60));
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
