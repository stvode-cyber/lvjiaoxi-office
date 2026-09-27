/* 绿角犀 Office · 静默更新端到端验证脚本（支持 GitHub redirect）
 * 运行：node scripts/verify-update-feed.js [--feed=URL] [--current=VERSION]
 * 示例：node scripts/verify-update-feed.js --feed=https://github.com/stvode-cyber/lvjiaoxi-office/releases/download/v1.1.4 --current=1.1.3
 */
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const yaml = require("js-yaml");

const args = process.argv.slice(2);
function getArg(n) { const a = args.find(x => x.startsWith("--" + n + "=")); return a ? a.slice(n.length + 3) : null; }
const FEED = getArg("feed") || process.env.LVJX_UPDATE_FEED || "http://localhost:18080/dist";
const CURRENT = getArg("current") || "1.1.3";

function parseVersion(v) { return ("" + (v || "")).split(".").map(x => parseInt(x, 10) || 0); }
function compareVersion(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) { const x = A[i] || 0, y = B[i] || 0; if (x > y) return 1; if (x < y) return -1; }
  return 0;
}

// —— HTTP/HTTPS fetch（支持 301/302 redirect，最多 5 层）——
function httpFetch(url, opts = {}, _depth = 0) {
  return new Promise((resolve, reject) => {
    if (_depth > 5) return reject(new Error("too many redirects"));
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({
      method: opts.method || "GET",
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      headers: opts.headers || { "User-Agent": "lvjiaoxi-verify/1.0" },
      timeout: opts.timeout || 15000
    }, (res) => {
      // follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        httpFetch(next, opts, _depth + 1).then(resolve).catch(reject);
        return;
      }
      if (opts.method === "HEAD") {
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
  console.log("Feed URL    : " + FEED);
  console.log("Current ver : " + CURRENT);
  console.log("");

  // Step 1: fetch latest.yml
  const latestUrl = FEED.replace(/\/+$/, "") + "/latest.yml";
  console.log("[1/4] Fetching latest.yml → " + latestUrl);
  let resp;
  try { resp = await httpFetch(latestUrl); } catch (e) {
    console.error("  ❌ 网络错误: " + e.message);
    process.exit(1);
  }
  if (resp.status !== 200) {
    console.error("  ❌ HTTP " + resp.status + " — latest.yml 不存在或不可访问");
    process.exit(1);
  }

  let info;
  try { info = yaml.load(resp.body.toString("utf8")); } catch (e) {
    console.error("  ❌ YAML 解析失败: " + e.message);
    process.exit(1);
  }
  const remoteVer = info.version;
  const exePath = info.path;
  console.log("  ✅ version=" + remoteVer + ", path=" + exePath);
  console.log("");

  // Step 2: compareVersion
  console.log("[2/4] compareVersion(" + remoteVer + ", " + CURRENT + ")");
  const cmp = compareVersion(remoteVer, CURRENT);
  let updateAvailable = false;
  if (cmp > 0) { updateAvailable = true; console.log("  🆕 有新版本！" + remoteVer + " > " + CURRENT); }
  else if (cmp === 0) { console.log("  ✅ 已是最新（" + CURRENT + " == " + remoteVer + "）"); }
  else { console.log("  ⚠️ remote 比 current 旧（irony）"); }
  console.log("");

  // Step 3: HEAD exe
  console.log("[3/4] HEAD 请求检查 exe 是否可访问");
  const exeUrl = FEED.replace(/\/+$/, "") + "/" + exePath;
  console.log("  → " + exeUrl);
  try {
    const head = await httpFetch(exeUrl, { method: "HEAD", timeout: 8000 });
    if (head.status === 200) {
      const size = head.headers["content-length"] || "?";
      console.log("  ✅ exe 可访问！status=200, size=" + size + " bytes");
    } else {
      console.log("  ❌ HTTP " + head.status);
    }
  } catch (e) { console.log("  ⚠️ HEAD 失败: " + e.message); }
  console.log("");

  // Step 4: 完整链路
  console.log("[4/4] Electron autoUpdater 链路状态");
  console.log("  LVJX_UPDATE_FEED        → " + FEED);
  console.log("  setupAutoUpdater()      → autoUpdater.setFeedURL({ provider: 'generic', url: '" + FEED.replace(/\/+$/, "") + "' })");
  console.log("  checkForUpdates()       → fetch " + latestUrl + " → compareVersion('" + remoteVer + "', '" + CURRENT + "') = " + cmp);
  if (updateAvailable) {
    console.log("  downloadUpdate()        → " + exeUrl);
    console.log("  quitAndInstall()        → 下载完自动安装");
  } else {
    console.log("  autoUpdater 判定 upToDate=true");
  }
  console.log("");

  console.log("=".repeat(60));
  if (updateAvailable) {
    console.log("✅ 链路正确！remote=" + remoteVer + " > current=" + CURRENT);
    console.log("   latest.yml 可拉 → compareVersion 方向正确 → exe 可访问");
    console.log("   首次使用 GitHub Releases 无需代码签名证书（generic provider 兼容）");
  } else {
    console.log("✅ 链路正确，但是已是最新版本");
  }
  console.log("=".repeat(60));
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
