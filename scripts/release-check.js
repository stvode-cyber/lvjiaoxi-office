#!/usr/bin/env node
/* 绿角犀 Office · 发版前自检（pre-flight check）
 *
 * 在 `git push --tags` 触发 release.yml 之前，本地先跑本脚本，提前发现会导致
 * 「发版失败 / 产物带假地址」的低级问题：
 *   - version.json 的 version 不是合法 semver
 *   - version.json 的 url 仍是占位符（example.com / localhost）
 *   - minVersion 高于 version
 *   - 桌面静默更新源 LVJX_UPDATE_FEED 未配置（--ci 时视为错误）
 *   - 下载页 LVJX_RELEASE_URL 未配置（将按 git remote 推导，仅提示）
 *
 * 用法：
 *   node scripts/release-check.js                # 自检，占位 url 等视为错误
 *   node scripts/release-check.js --allow-placeholder   # 本地开发宽容模式（url 假地址仅警告）
 *   node scripts/release-check.js --ci            # CI 模式：缺失 feed 凭证视为错误
 *   node scripts/release-check.js --version-file <path>
 *
 * 退出码：发现任何 error -> 1；否则 0。可直接接进 `release:prep` 或 CI 前置步骤。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SEMVER_RE = /^(\d+)\.\d+\.\d+$/;

/** 是否为合法 semver（仅支持 X.Y.Z 三段）。 */
function isSemver(v) {
  return typeof v === "string" && SEMVER_RE.test(v.trim());
}

/** 是否为「占位符 / 无效」下载地址。真地址需为 http(s) 且非 example/localhost。 */
function isPlaceholderUrl(url) {
  if (!url || typeof url !== "string") return true;
  if (!/^https?:\/\//i.test(url.trim())) return true;
  return /example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url);
}

/** 版本比较：a>b -> 1；a<b -> -1；相等 -> 0。非 semver 一律按 0 处理（不误判）。 */
function versionCmp(a, b) {
  const A = ("" + (a || "")).split(".").map(function (x) { return parseInt(x, 10) || 0; });
  const B = ("" + (b || "")).split(".").map(function (x) { return parseInt(x, 10) || 0; });
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * 校验 version.json 内容。
 * @param {object} obj 已解析的 version.json
 * @param {{allowPlaceholder?:boolean}} [opts]
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validateVersionJson(obj, opts) {
  opts = opts || {};
  const errors = [];
  const warnings = [];
  if (!obj || typeof obj !== "object") {
    errors.push("version.json 不存在或不是合法 JSON");
    return { ok: false, errors: errors, warnings: warnings };
  }
  if (!isSemver(obj.version)) {
    errors.push("version.json.version 不是合法 semver：" + JSON.stringify(obj.version));
  }
  if (isPlaceholderUrl(obj.url)) {
    if (opts.allowPlaceholder) {
      warnings.push("version.json.url 仍是占位符（" + obj.url + "），将不写入真实发布页");
    } else {
      errors.push("version.json.url 仍是占位符（" + obj.url + "），需为真实发布页地址");
    }
  }
  if (obj.minVersion && isSemver(obj.minVersion) && isSemver(obj.version)) {
    if (versionCmp(obj.minVersion, obj.version) > 0) {
      errors.push("version.json.minVersion（" + obj.minVersion + "）高于 version（" + obj.version + "）");
    }
  }
  if (!Array.isArray(obj.notes) || obj.notes.length === 0) {
    warnings.push("version.json.notes 为空，建议发布前填写更新说明");
  }
  if (obj.publishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(obj.publishedAt)) {
    warnings.push("version.json.publishedAt 非 YYYY-MM-DD 格式：" + JSON.stringify(obj.publishedAt));
  }
  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

/**
 * 检查必需环境变量是否配置。
 * @param {object} env process.env
 * @param {string[]} required 必需的 key 列表
 * @returns {{missing:string[], present:string[]}}
 */
function checkEnv(env, required) {
  env = env || {};
  const missing = [];
  const present = [];
  for (const k of required) {
    if (!env[k] || !String(env[k]).trim()) missing.push(k);
    else present.push(k);
  }
  return { missing: missing, present: present };
}

/** 读取并解析 version.json（不存在或非法时抛出）。 */
function readVersionJson(file) {
  const p = file || path.resolve(__dirname, "..", "app", "version.json");
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const opts = { allowPlaceholder: false, ci: false, versionFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-placeholder") opts.allowPlaceholder = true;
    else if (a === "--ci") opts.ci = true;
    else if (a === "--version-file") opts.versionFile = argv[++i];
    else if (a === "-h" || a === "--help") {
      process.stdout.write(
        "用法: node scripts/release-check.js [--allow-placeholder] [--ci] [--version-file <path>]\n");
      process.exit(0);
    }
  }
  return opts;
}

function run(argv, env) {
  env = env || process.env;
  const opts = parseArgs(argv || []);
  const out = process.stdout;

  let obj;
  try {
    obj = readVersionJson(opts.versionFile);
  } catch (e) {
    out.write("❌ 无法读取 version.json：" + e.message + "\n");
    return 1;
  }

  const v = validateVersionJson(obj, opts);
  out.write("=== 发版前自检 ===\n");
  out.write("version      : " + obj.version + "\n");
  out.write("url          : " + obj.url + "\n");
  out.write("minVersion   : " + (obj.minVersion || "(未设置)") + "\n");
  out.write("notes        : " + (Array.isArray(obj.notes) ? obj.notes.length + " 条" : "(空)") + "\n");

  // 桌面静默更新源：CI 模式缺失视为错误，本地模式仅警告
  const feedCheck = checkEnv(env, ["LVJX_UPDATE_FEED"]);
  if (feedCheck.missing.length) {
    if (opts.ci) v.errors.push("缺失环境变量 " + feedCheck.missing.join(", ") + "（桌面静默更新源无法发布）");
    else v.warnings.push("本地未配置 LVJX_UPDATE_FEED（CI 需在仓库变量设置，才能发布桌面静默更新源）");
  } else {
    out.write("feed         : " + feedCheck.present.join(", ") + " ✔\n");
  }

  // 下载页 URL：缺失则 release.yml 会按 git remote 推导，仅提示
  const urlCheck = checkEnv(env, ["LVJX_RELEASE_URL"]);
  if (urlCheck.missing.length) {
    v.warnings.push("LVJX_RELEASE_URL 未设置，release.yml 将按 git remote 推导 GitHub Release 标签页");
  } else {
    out.write("release url  : " + urlCheck.present.join(", ") + " ✔\n");
  }

  let rc = 0;
  if (v.errors.length) {
    out.write("\n❌ 错误（必须修复才能发版）：\n");
    v.errors.forEach(function (e) { out.write("  • " + e + "\n"); });
    rc = 1;
  }
  if (v.warnings.length) {
    out.write("\n⚠️ 警告：\n");
    v.warnings.forEach(function (w) { out.write("  • " + w + "\n"); });
  }
  if (rc === 0) out.write("\n✔ 自检通过，可以发版。\n");
  else out.write("\n自检未通过，请先修复上述错误。\n");
  return rc;
}

// 直接运行时执行
if (require.main === module) {
  process.exit(run(process.argv.slice(2), process.env));
}

module.exports = {
  isSemver: isSemver,
  isPlaceholderUrl: isPlaceholderUrl,
  versionCmp: versionCmp,
  validateVersionJson: validateVersionJson,
  checkEnv: checkEnv,
  readVersionJson: readVersionJson,
  run: run,
  SEMVER_RE: SEMVER_RE,
};
