/* 绿角犀 Office · 发布资产完整性校验
 *
 * 用途：在打 tag / 发布前，确认 GitHub Release（或 dist 目录）包含桌面静默更新通道
 * 与移动端分发所需的全部资产。尤其保证「未配置私有 feed、依赖 GitHub Releases 回退」时，
 * electron-updater 的 github provider 能解析到 latest*.yml 与对应安装包。
 *
 * 纯函数可单测（见 _verify_assets_test.js）；CLI 直接扫目录或读文件名清单。
 *
 * 用法：
 *   node scripts/verify-release-assets.js --dist dist
 *   node scripts/verify-release-assets.js --dist dist --mobile-dir mobile
 *   node scripts/verify-release-assets.js --platforms win,linux --names "a.exe,latest.yml"
 *   node scripts/verify-release-assets.js --names "x.aab,x.apk" --mobile
 */
"use strict";
const fs = require("fs");
const path = require("path");

// 平台 -> 该平台桌面更新路径必需的文件名正则（「分组」结构：组间 AND，组内 OR）。
// 例：iOS 只需满足「ipa 或 xcarchive.zip」其一；Windows 需同时满足安装包 + latest.yml + blockmap。
const DESKTOP_PATTERNS = {
  win: [
    [/^绿角犀 Office Setup .*\.exe$/i],
    [/^绿角犀 Office .*\.exe$/i],
    [/^latest\.yml$/i],
    [/\.blockmap$/i]
  ],
  mac: [
    [/^绿角犀 Office-.*\.dmg$/i],
    [/^latest-mac\.yml$/i],
    [/\.blockmap$/i]
  ],
  linux: [
    [/^绿角犀 Office-.*\.AppImage$/i],
    [/^绿角犀 Office-.*\.deb$/i],
    [/^latest-linux\.yml$/i]
  ]
};
const MOBILE_PATTERNS = {
  android: [
    [/\.aab$/i],
    [/\.apk$/i]
  ],
  ios: [
    [/\.ipa$/i, /\.xcarchive\.zip$/i] // 签名 IPA 或未签名 xcarchive，满足其一即可
  ]
};

// 平台识别标记：除 latest*.yml（更新源）外，安装包本体也能标记「该平台已构建」。
// 仅按 latest*.yml 识别会导致「装了 exe 但没生成更新源」时平台被整体漏检，
// 进而一项都不校验、误报 OK（见 _verify_assets_test.js 的假阳性回归用例）。
const PLATFORM_MARKERS = {
  win: [/^latest\.yml$/i, /^绿角犀 Office Setup .*\.exe$/i, /^绿角犀 Office .*\.exe$/i, /^win-unpacked$/i],
  mac: [/^latest-mac\.yml$/i, /^绿角犀 Office-.*\.dmg$/i],
  linux: [/^latest-linux\.yml$/i, /\.AppImage$/i, /\.deb$/i]
};

// 依据 present（文件名数组）自动识别已构建的桌面平台
function detectPlatforms(present) {
  const ps = [];
  for (const p of ["win", "mac", "linux"]) {
    const hit = PLATFORM_MARKERS[p].some(function (re) {
      return present.some(function (n) { return re.test(n); });
    });
    if (hit) ps.push(p);
  }
  return ps;
}

// 校验 present 是否满足某平台「分组」patterns：每组至少一个命中（组内 OR），所有组都要满足（组间 AND）。
// 返回缺失的分组描述（组内各 pattern 用 " | " 连接）。
function verifyPlatform(present, groups) {
  const missing = [];
  for (const group of groups) {
    const hit = group.some(function (g) { return present.some(function (n) { return g.test(n); }); });
    if (!hit) missing.push(group.map(function (g) { return g.toString(); }).join(" | "));
  }
  return missing;
}

// 汇总校验；返回 { desktop, mobile, ok, missing }
function verifyAll(present, opts) {
  opts = opts || {};
  const result = { desktop: {}, mobile: {}, ok: true, missing: [] };
  const platforms = opts.platforms || detectPlatforms(present);
  result.detected = platforms.slice(); // 供调用方判断「是否一项都没检出」
  for (const p of platforms) {
    const pat = DESKTOP_PATTERNS[p];
    if (!pat) continue;
    const miss = verifyPlatform(present, pat);
    result.desktop[p] = { required: pat.length, missing: miss };
    if (miss.length) { result.ok = false; result.missing.push("desktop/" + p); }
  }
  if (opts.mobile) {
    for (const m of ["android", "ios"]) {
      const pat = MOBILE_PATTERNS[m];
      const miss = verifyPlatform(present, pat);
      result.mobile[m] = { required: pat.length, missing: miss };
      if (miss.length) { result.ok = false; result.missing.push("mobile/" + m); }
    }
  }
  return result;
}

function listFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(e.name);
    }
  })(dir);
  return out;
}

function cli() {
  const args = process.argv.slice(2);
  let dist = null, mobileDir = null, platforms = null, mobile = false, names = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dist") dist = args[++i];
    else if (args[i] === "--mobile-dir") mobileDir = args[++i];
    else if (args[i] === "--platforms") platforms = args[++i].split(",").map(function (s) { return s.trim(); });
    else if (args[i] === "--mobile") mobile = true;
    else if (args[i] === "--names") names = args[++i].split(",").map(function (s) { return s.trim(); });
  }
  const doMobile = mobile || (!!mobileDir && fs.existsSync(mobileDir));
  const mobileDirMissing = !!mobileDir && !fs.existsSync(mobileDir);
  let present;
  if (names) {
    present = names;
  } else {
    present = listFiles(dist);
    if (mobileDir && fs.existsSync(mobileDir)) present = present.concat(listFiles(mobileDir));
  }
  const res = verifyAll(present, { platforms: platforms || undefined, mobile: doMobile });
  // 「空」不等于「通过」：一个桌面平台都没检出，说明根本没有可发布产物
  if (!platforms && res.detected.length === 0) {
    res.ok = false;
    res.missing.push("desktop/<未检出任何平台产物>");
  }
  // 显式指定了 --mobile-dir 却不存在：不能静默跳过（否则移动端资产永远校验不到）
  if (mobileDirMissing) {
    res.ok = false;
    res.missing.push("mobile/<目录不存在: " + mobileDir + ">");
  }
  console.log("RELEASE ASSETS:");
  console.log("  desktop:", JSON.stringify(res.desktop));
  if (doMobile) console.log("  mobile:", JSON.stringify(res.mobile));
  if (res.ok) { console.log("  OK: 所有必需资产齐全"); process.exit(0); }
  else { console.log("  MISSING: " + res.missing.join(", ")); process.exit(1); }
}

module.exports = { DESKTOP_PATTERNS, MOBILE_PATTERNS, PLATFORM_MARKERS, detectPlatforms, verifyPlatform, verifyAll, listFiles };

if (require.main === module) cli();
