#!/usr/bin/env node
/* 绿角犀 Office · 版本号统一注入
 * ---------------------------------------------------------------
 * 单一真源：package.json 的 version 字段。
 * 一条命令同步全部四端版本信息，避免「发布新版本」时漏改：
 *   1. package.json            -> version
 *   2. app/index.html          -> <meta name="x-app-version" content="...">
 *   3. app/version.json        -> version / publishedAt / url（下载页；--url 或 LVJX_RELEASE_URL 指定，否则保留原值）
 *   4. app/sw.js               -> const CACHE = "lvjiaoxi-office-vN"（N 自增，触发 SW 重装）
 *   5. clients/ios/project.yml        -> MARKETING_VERSION / CURRENT_PROJECT_VERSION(构建号)
 *   6. clients/ios/LvjiaoxiOffice/Info.plist -> CFBundleShortVersionString / CFBundleVersion
 *   7. clients/harmonyos/AppScope/app.json5  -> versionName / versionCode
 *   （Android 在 Gradle 构建时直接读取 package.json，无需此处写入）
 *
 * 用法：
 *   node scripts/bump-version.js patch                 修订号 +1
 *   node scripts/bump-version.js minor                 次版本 +1
 *   node scripts/bump-version.js major                 主版本 +1
 *   node scripts/bump-version.js --set 1.2.3           直接指定
 *   node scripts/bump-version.js patch --notes "修复导出崩溃"
 *   node scripts/bump-version.js patch --url "https://github.com/owner/repo/releases/tag/v1.0.1"
 *   node scripts/bump-version.js patch --dry-run       只打印，不落盘
 *   node scripts/bump-version.js patch --root /abs/path
 *
 * 也可被 require 复用（测试）：
 *   const v = require("./scripts/bump-version.js");
 *   v.bumpSemver("1.0.0","minor") === "1.1.0"
 * =============================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const META_RE = /<meta\s+name=["']x-app-version["']\s+content=["']([^"']*)["']/i;
const HEAD_RE = /<head[^>]*>/i;
const CACHE_RE = /(const\s+CACHE\s*=\s*["'])([^"']*?)(\d+)(["'])/;

/* ---------- 纯函数（可测） ---------- */

function resolveRoot(custom) {
  if (custom) return path.resolve(custom);
  // 脚本位于 <root>/scripts/bump-version.js
  return path.resolve(__dirname, "..");
}

function bumpSemver(version, type) {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec((version || "0.0.0").trim());
  let maj = 0, min = 0, pat = 0, rest = "";
  if (m) { maj = +m[1]; min = +m[2]; pat = +m[3]; rest = m[4] || ""; }
  if (type === "major") { maj++; min = 0; pat = 0; }
  else if (type === "minor") { min++; pat = 0; }
  else if (type === "patch" || !type) { pat++; }
  return maj + "." + min + "." + pat + rest;
}

function readMeta(html) {
  const m = META_RE.exec(html);
  return m ? m[1] : null;
}

function writeMeta(html, version) {
  if (META_RE.test(html)) {
    return html.replace(META_RE,
      '<meta name="x-app-version" content="' + version + '"');
  }
  // 没有 meta 标签时插入到 <head> 之后
  if (HEAD_RE.test(html)) {
    return html.replace(HEAD_RE, function (h) {
      return h + '\n  <meta name="x-app-version" content="' + version + '">';
    });
  }
  throw new Error("index.html 缺少 <head>，无法注入 x-app-version");
}

function readCacheConst(sw) {
  const m = CACHE_RE.exec(sw);
  return m ? (m[2] + m[3]) : null;
}

function bumpCacheConst(sw) {
  if (!CACHE_RE.test(sw)) {
    throw new Error("sw.js 未找到 const CACHE = \"...\"，无法自增缓存版本");
  }
  return sw.replace(CACHE_RE, function (_full, a, pre, num, q) {
    return a + pre + (parseInt(num, 10) + 1) + q;
  });
}

/* ---------- 跨端构建号推导（可测） ----------
 * 同一 package.json 版本号，按各平台约定推导整数构建号：
 *   - iOS / Android：主*10000 + 次*100 + 修订（1.2.3 -> 10203）
 *   - HarmonyOS    ：主*1000000 + 次*1000 + 修订（1.2.3 -> 1020003，契合官方 1.0.0->1000000）
 */
function versionCode(version, base) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec((version || "0.0.0").trim());
  let maj = 0, min = 0, pat = 0;
  if (m) { maj = +m[1] || 0; min = +(m[2] || 0); pat = +(m[3] || 0); }
  if (base === 1000000) return maj * 1000000 + min * 1000 + pat;
  return maj * 10000 + min * 100 + pat;
}

/* ---------- iOS（XcodeGen project.yml + Info.plist） ---------- */

const IOS_YML_MARKETING_RE = /(MARKETING_VERSION:\s*)([^\n]*)/;
const IOS_YML_BUILD_RE = /(CURRENT_PROJECT_VERSION:\s*)([^\n]*)/;
const IOS_PLIST_SHORT_RE = /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]*)(<\/string>)/;
const IOS_PLIST_BUILD_RE = /(<key>CFBundleVersion<\/key>\s*<string>)([^<]*)(<\/string>)/;

function readIOSProjectYml(s) {
  const a = IOS_YML_MARKETING_RE.exec(s);
  const b = IOS_YML_BUILD_RE.exec(s);
  return {
    marketing: a ? a[2].trim() : null,
    build: b ? parseInt(b[2], 10) || 0 : null
  };
}
function writeIOSProjectYml(s, version, buildNum) {
  let out = s;
  if (IOS_YML_MARKETING_RE.test(out)) out = out.replace(IOS_YML_MARKETING_RE, "$1" + version);
  if (IOS_YML_BUILD_RE.test(out)) out = out.replace(IOS_YML_BUILD_RE, "$1" + buildNum);
  return out;
}
function readIOSPlist(s) {
  const a = IOS_PLIST_SHORT_RE.exec(s);
  const b = IOS_PLIST_BUILD_RE.exec(s);
  return {
    short: a ? a[2] : null,
    build: b ? parseInt(b[2], 10) || 0 : null
  };
}
function writeIOSPlist(s, version, buildNum) {
  let out = s;
  if (IOS_PLIST_SHORT_RE.test(out)) out = out.replace(IOS_PLIST_SHORT_RE, "$1" + version + "$3");
  if (IOS_PLIST_BUILD_RE.test(out)) out = out.replace(IOS_PLIST_BUILD_RE, "$1" + buildNum + "$3");
  return out;
}

/* ---------- HarmonyOS（AppScope/app.json5） ---------- */

const HM_NAME_RE = /("versionName":\s*")([^"]*)(")/;
const HM_CODE_RE = /("versionCode":\s*)(\d+)/;

function readHarmonyAppJson(s) {
  const a = HM_NAME_RE.exec(s);
  const b = HM_CODE_RE.exec(s);
  return {
    versionName: a ? a[2] : null,
    versionCode: b ? parseInt(b[2], 10) || 0 : null
  };
}
function writeHarmonyAppJson(s, version, versionCode) {
  let out = s;
  if (HM_NAME_RE.test(out)) out = out.replace(HM_NAME_RE, "$1" + version + "$3");
  if (HM_CODE_RE.test(out)) out = out.replace(HM_CODE_RE, "$1" + versionCode);
  return out;
}

/* ---------- 主流程 ---------- */

function run(opts) {
  opts = opts || {};
  const root = resolveRoot(opts.root);
  const pkgPath = path.join(root, "package.json");
  const htmlPath = path.join(root, "app", "index.html");
  const verPath = path.join(root, "app", "version.json");
  const swPath = path.join(root, "app", "sw.js");

  // 原生端文件（存在才同步；缺失则跳过，不阻断 Web/桌面发布）
  const iosYmlPath = path.join(root, "clients", "ios", "project.yml");
  const iosPlistPath = path.join(root, "clients", "ios", "LvjiaoxiOffice", "Info.plist");
  const hmAppJsonPath = path.join(root, "clients", "harmonyos", "AppScope", "app.json5");

  [pkgPath, htmlPath, verPath, swPath].forEach(function (p) {
    if (!fs.existsSync(p)) throw new Error("缺少文件：" + p);
  });

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const oldVer = pkg.version || "0.0.0";

  let newVer;
  if (opts.set) {
    newVer = String(opts.set).trim();
  } else {
    newVer = bumpSemver(oldVer, opts.type || "patch");
  }
  if (!/^\d+\.\d+\.\d+/.test(newVer)) {
    throw new Error("版本号非法：" + newVer + "（应为 主.次.修订）");
  }

  // 预处理各文件新内容
  const html = fs.readFileSync(htmlPath, "utf8");
  const htmlNew = writeMeta(html, newVer);

  let ver = {};
  try { ver = JSON.parse(fs.readFileSync(verPath, "utf8")) || {}; } catch (e) { ver = {}; }
  ver.version = newVer;
  ver.publishedAt = new Date().toISOString().slice(0, 10);
  if (opts.notes) {
    const arr = Array.isArray(opts.notes) ? opts.notes : String(opts.notes).split("|");
    ver.notes = arr.map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
  }
  // 下载页 URL：显式 --url 优先，其次环境变量 LVJX_RELEASE_URL，最后保留 version.json 已有值
  const relUrl = opts.url || process.env.LVJX_RELEASE_URL;
  if (relUrl) ver.url = relUrl;

  const sw = fs.readFileSync(swPath, "utf8");
  const swNew = bumpCacheConst(sw);

  // 跨端构建号
  const iosBuild = versionCode(newVer, 10000);   // 主*10000+次*100+修订
  const hmCode = versionCode(newVer, 1000000);   // 主*1000000+次*1000+修订

  // iOS
  let iosYmlOld = null, iosYmlNew = null, iosPlistOld = null, iosPlistNew = null;
  if (fs.existsSync(iosYmlPath) && fs.existsSync(iosPlistPath)) {
    const yml = fs.readFileSync(iosYmlPath, "utf8");
    const plist = fs.readFileSync(iosPlistPath, "utf8");
    iosYmlOld = readIOSProjectYml(yml);
    iosPlistOld = readIOSPlist(plist);
    iosYmlNew = writeIOSProjectYml(yml, newVer, iosBuild);
    iosPlistNew = writeIOSPlist(plist, newVer, iosBuild);
  }

  // HarmonyOS
  let hmOld = null, hmNew = null;
  if (fs.existsSync(hmAppJsonPath)) {
    const hm = fs.readFileSync(hmAppJsonPath, "utf8");
    hmOld = readHarmonyAppJson(hm);
    hmNew = writeHarmonyAppJson(hm, newVer, hmCode);
  }

  const report = {
    root: root,
    oldVer: oldVer,
    newVer: newVer,
    metaOld: readMeta(html),
    metaNew: readMeta(htmlNew),
    cacheOld: readCacheConst(sw),
    cacheNew: readCacheConst(swNew),
    ios: (iosYmlOld && iosPlistOld) ? {
      marketingOld: iosYmlOld.marketing, marketingNew: newVer,
      buildOld: iosYmlOld.build, buildNew: iosBuild,
      plistShortOld: iosPlistOld.short, plistShortNew: newVer,
      plistBuildOld: iosPlistOld.build, plistBuildNew: iosBuild
    } : null,
    harmony: hmOld ? {
      nameOld: hmOld.versionName, nameNew: newVer,
      codeOld: hmOld.versionCode, codeNew: hmCode
    } : null,
    dryRun: !!opts.dryRun
  };

  if (!opts.dryRun) {
    pkg.version = newVer;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    fs.writeFileSync(htmlPath, htmlNew);
    fs.writeFileSync(verPath, JSON.stringify(ver, null, 2) + "\n");
    fs.writeFileSync(swPath, swNew);
    if (iosYmlNew) {
      fs.writeFileSync(iosYmlPath, iosYmlNew);
      fs.writeFileSync(iosPlistPath, iosPlistNew);
    }
    if (hmNew) fs.writeFileSync(hmAppJsonPath, hmNew);
    report.written = true;
  }
  return report;
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const opts = { type: "patch", notes: null, set: null, dryRun: false, root: null, url: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "major" || a === "minor" || a === "patch") opts.type = a;
    else if (a === "--set") opts.set = argv[++i];
    else if (a === "--notes") {
      const raw = argv[++i] || "";
      opts.notes = raw.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
    }
    else if (a === "--url") opts.url = argv[++i];
    else if (a === "--dry-run" || a === "-n") opts.dryRun = true;
    else if (a === "--root") opts.root = argv[++i];
    else if (a === "-h" || a === "--help") {
      process.stdout.write(
        "用法: node scripts/bump-version.js [major|minor|patch] [--set X.Y.Z] " +
        "[--notes \"说明1|说明2\"] [--url <下载页URL>] [--dry-run] [--root <dir>]\n");
      process.exit(0);
    } else pos.push(a);
  }
  if (pos.length && !opts.set) {
    // 允许位置参数形如 1.2.3
    if (/^\d+\.\d+\.\d+/.test(pos[0])) opts.set = pos[0];
  }
  return opts;
}

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const r = run(opts);
    const pad = function (s) { return (s == null ? "—" : s); };
    let out =
      "版本注入" + (r.dryRun ? "（演练，未落盘）" : "") + "\n" +
      "  package.json : " + r.oldVer + " -> " + r.newVer + "\n" +
      "  index.html   : " + pad(r.metaOld) + " -> " + pad(r.metaNew) + "\n" +
      "  sw.js CACHE  : " + pad(r.cacheOld) + " -> " + pad(r.cacheNew) + "\n" +
      "  version.json : version=" + r.newVer + " publishedAt=" + (JSON.parse(fs.readFileSync(path.join(r.root, "app", "version.json"), "utf8")).publishedAt) + "\n";
    const vj = JSON.parse(fs.readFileSync(path.join(r.root, "app", "version.json"), "utf8"));
    if (vj.url) out += "  version.json : url=" + vj.url + "\n";
    if (r.ios) {
      out += "  iOS project : " + pad(r.ios.marketingOld) + " -> " + r.ios.marketingNew +
        "  (build " + pad(r.ios.buildOld) + " -> " + r.ios.buildNew + ")\n";
    }
    if (r.harmony) {
      out += "  HarmonyOS   : " + pad(r.harmony.nameOld) + " -> " + r.harmony.nameNew +
        "  (code " + pad(r.harmony.codeOld) + " -> " + r.harmony.codeNew + ")\n";
    }
    out += "  Android     : 构建时自动读取 package.json（无需同步写入）\n";
    process.stdout.write(out);
    if (r.dryRun) process.stdout.write("（演练模式：未写入任何文件）\n");
  } catch (e) {
    process.stderr.write("错误：" + e.message + "\n");
    process.exit(1);
  }
}

module.exports = {
  resolveRoot: resolveRoot,
  bumpSemver: bumpSemver,
  versionCode: versionCode,
  readMeta: readMeta,
  writeMeta: writeMeta,
  readCacheConst: readCacheConst,
  bumpCacheConst: bumpCacheConst,
  readIOSProjectYml: readIOSProjectYml,
  writeIOSProjectYml: writeIOSProjectYml,
  readIOSPlist: readIOSPlist,
  writeIOSPlist: writeIOSPlist,
  readHarmonyAppJson: readHarmonyAppJson,
  writeHarmonyAppJson: writeHarmonyAppJson,
  run: run
};
