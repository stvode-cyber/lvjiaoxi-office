/* 发版前自检 · 回归测试（node 原生断言，无依赖）
 * 覆盖：isSemver / isPlaceholderUrl / versionCmp / validateVersionJson / checkEnv / run 退出码。 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mod = require("./scripts/release-check.js");

let passed = 0, failed = 0;
function ok(name, cond) {
  try { assert.ok(cond, name); console.log("✓ " + name); passed++; }
  catch (e) { console.log("✗ " + name + "  -> " + e.message); failed++; }
}
function eq(name, a, b) {
  try { assert.strictEqual(a, b, name); console.log("✓ " + name); passed++; }
  catch (e) { console.log("✗ " + name + "  -> " + e.message + " (got " + JSON.stringify(a) + ")"); failed++; }
}

// ---- isSemver ----
ok("isSemver 接受 1.0.0", mod.isSemver("1.0.0"));
ok("isSemver 接受 12.3.45", mod.isSemver("12.3.45"));
ok("isSemver 拒绝 1.0", !mod.isSemver("1.0"));
ok("isSemver 拒绝 v1.0.0", !mod.isSemver("v1.0.0"));
ok("isSemver 拒绝 1.0.0.0", !mod.isSemver("1.0.0.0"));
ok("isSemver 拒绝 字符串", !mod.isSemver("abc"));

// ---- isPlaceholderUrl ----
ok("isPlaceholderUrl 识别 example.com", mod.isPlaceholderUrl("https://example.com/x"));
ok("isPlaceholderUrl 识别 localhost", mod.isPlaceholderUrl("http://localhost:8080/x"));
ok("isPlaceholderUrl 识别 127.0.0.1", mod.isPlaceholderUrl("http://127.0.0.1/x"));
ok("isPlaceholderUrl 拒绝 空", mod.isPlaceholderUrl(""));
ok("isPlaceholderUrl 拒绝 非 http", mod.isPlaceholderUrl("ftp://x/y"));
ok("isPlaceholderUrl 接受 真实 https", !mod.isPlaceholderUrl("https://releases.example.org/lvjx/v1.2.3"));
ok("isPlaceholderUrl 接受 github", !mod.isPlaceholderUrl("https://github.com/owner/repo/releases/tag/v1.0.0"));

// ---- versionCmp ----
eq("versionCmp 相等", mod.versionCmp("1.0.0", "1.0.0"), 0);
eq("versionCmp 旧<新", mod.versionCmp("1.0.0", "1.0.1"), -1);
eq("versionCmp 新>旧", mod.versionCmp("1.2.0", "1.0.9"), 1);
eq("versionCmp 大版本", mod.versionCmp("2.0.0", "1.9.9"), 1);

// ---- validateVersionJson ----
const good = mod.validateVersionJson({ version: "1.0.0", url: "https://github.com/o/r/releases/tag/v1.0.0", minVersion: "1.0.0", notes: ["fix"] });
ok("validateVersionJson 合法对象 ok", good.ok && good.errors.length === 0);

const badUrl = mod.validateVersionJson({ version: "1.0.0", url: "https://example.com/x" });
ok("validateVersionJson 占位 url 报错", !badUrl.ok && badUrl.errors.some(function (e) { return /占位符/.test(e); }));

const badVer = mod.validateVersionJson({ version: "1.0", url: "https://github.com/o/r" });
ok("validateVersionJson 非法 version 报错", !badVer.ok && badVer.errors.some(function (e) { return /semver/.test(e); }));

const badMin = mod.validateVersionJson({ version: "1.0.0", url: "https://github.com/o/r", minVersion: "2.0.0" });
ok("validateVersionJson minVersion>version 报错", !badMin.ok && badMin.errors.some(function (e) { return /minVersion/.test(e); }));

const allowPh = mod.validateVersionJson({ version: "1.0.0", url: "https://example.com/x" }, { allowPlaceholder: true });
ok("validateVersionJson allowPlaceholder 把 url 降级为 warning", allowPh.ok && allowPh.warnings.length > 0 && allowPh.errors.length === 0);

const emptyNotes = mod.validateVersionJson({ version: "1.0.0", url: "https://github.com/o/r" });
ok("validateVersionJson 空 notes 给 warning", emptyNotes.warnings.some(function (w) { return /notes/.test(w); }));

const notObj = mod.validateVersionJson(null);
ok("validateVersionJson 非对象报错", !notObj.ok && notObj.errors.length > 0);

// ---- checkEnv ----
const env1 = mod.checkEnv({ A: "1", B: "" }, ["A", "B", "C"]);
ok("checkEnv 正确分类 present/missing", env1.present.length === 1 && env1.missing.length === 2 && env1.missing.indexOf("C") >= 0);

// ---- run 退出码（用临时 version.json） ----
function writeTmpVersion(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relchk-"));
  const f = path.join(dir, "version.json");
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
}

const goodFile = writeTmpVersion({ version: "1.0.0", url: "https://github.com/o/r/releases/tag/v1.0.0", notes: ["x"] });
eq("run 合法文件 -> 0", mod.run(["--version-file", goodFile, "--allow-placeholder"], {}), 0);

const badFile = writeTmpVersion({ version: "1.0.0", url: "https://example.com/x" });
eq("run 占位 url -> 1", mod.run(["--version-file", badFile], {}), 1);

const missingFeed = writeTmpVersion({ version: "1.0.0", url: "https://github.com/o/r" });
eq("run --ci 缺 feed -> 1", mod.run(["--version-file", missingFeed, "--ci"], {}), 1);
eq("run 非 ci 缺 feed -> 0", mod.run(["--version-file", missingFeed], {}), 0);

const feedSet = writeTmpVersion({ version: "1.0.0", url: "https://github.com/o/r" });
eq("run 设了 feed 且 --ci -> 0", mod.run(["--version-file", feedSet, "--ci"], { LVJX_UPDATE_FEED: "https://feed.example/" }), 0);

console.log("\n=== 发版自检测试：通过 " + passed + " / 失败 " + failed + " ===");
process.exit(failed ? 1 : 0);
