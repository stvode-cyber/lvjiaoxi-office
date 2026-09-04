/* 绿角犀 Office · 桌面主进程纯逻辑测试（main-utils）
   覆盖 main.js 抽取出的可测业务逻辑：
     - cmpVer 版本比较（自动更新判定核心，含不等长段 / 非数字 / 非法串）
     - safeStaticResolve 目录穿越防护（根路径 / 子路径 / .. 越界 / 非法编码）
     - mimeFor 常见类型映射与未知兜底
     - MAX_OPEN_BYTES 常量（200MB 上限）
*/
"use strict";
const { cmpVer, MIME, mimeFor, safeStaticResolve, MAX_OPEN_BYTES } = require("./electron/main-utils");
const path = require("path");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; fails.push(name + (detail ? " — " + detail : "")); }
}

/* ---------- cmpVer ---------- */
ok("cmpVer 相等 => 0", cmpVer("1.0.16", "1.0.16") === 0);
ok("cmpVer 大版本升 => 1", cmpVer("1.1.0", "1.0.16") === 1);
ok("cmpVer 大版本降 => -1", cmpVer("1.0.16", "1.1.0") === -1);
ok("cmpVer 尾段升 => 1", cmpVer("1.0.17", "1.0.16") === 1);
ok("cmpVer 尾段降 => -1", cmpVer("1.0.16", "1.0.17") === -1);
ok("cmpVer 不等长段 (1.0 vs 1.0.16) => -1", cmpVer("1.0", "1.0.16") === -1);
ok("cmpVer 不等长段反向 (1.0.16 vs 1.0) => 1", cmpVer("1.0.16", "1.0") === 1);
ok("cmpVer 数字字符串混用", cmpVer(1.16, "1.16") === 0);
ok("cmpVer 非法段按 0 (a.b.16 vs a.b.9)", cmpVer("a", "9") === -1);
ok("cmpVer 空串按 0", cmpVer("", "") === 0 && cmpVer("", "1") === -1 && cmpVer("1", "") === 1);

/* ---------- safeStaticResolve 目录穿越防护 ---------- */
const ROOT = path.join(path.sep, "data", "office", "app");
ok("根路径 -> index.html", (() => {
  const r = safeStaticResolve(ROOT, "/");
  return !r.forbidden && r.file === path.join(ROOT, "index.html");
})());
ok("正常子路径解析", (() => {
  const r = safeStaticResolve(ROOT, "/js/app.js");
  return !r.forbidden && r.file === path.join(ROOT, "js", "app.js");
})());
ok("目录穿越 .. 被拦截 (forbidden=true)", (() => {
  const r = safeStaticResolve(ROOT, "/../../etc/passwd");
  return r.forbidden === true && r.file === null;
})());
ok("以 .. 开头的相对穿越被拦截", (() => {
  const r = safeStaticResolve(ROOT, "/../secret.txt");
  return r.forbidden === true;
})());
ok("同前缀异目录不误伤 (upload/app 不在 office/app 下)", (() => {
  // "/../办公软件/xxx" 应越界
  const r = safeStaticResolve(ROOT, "/../upload/secret");
  return r.forbidden === true;
})());
ok("带 query 的路径正确去皮", (() => {
  const r = safeStaticResolve(ROOT, "/js/app.js?v=1");
  return !r.forbidden && r.file === path.join(ROOT, "js", "app.js");
})());
ok("带 # 路径容忍", (() => {
  const r = safeStaticResolve(ROOT, "/index.html#home");
  return !r.forbidden;
})());
ok("非法编码按 404 (file=null, not forbidden)", (() => {
  const r = safeStaticResolve(ROOT, "/%zz");
  return r.file === null && r.forbidden === false;
})());
ok("URL 编码后的穿越同样被拦截", (() => {
  const r = safeStaticResolve(ROOT, "/%2e%2e/%2e%2e/etc/passwd");
  return r.forbidden === true || (r.file !== null && !path.normalize(path.dirname(r.file)).startsWith(path.normalize(ROOT)));
})());

/* ---------- mimeFor ---------- */
ok("html MIME", mimeFor("/index.html") === "text/html; charset=utf-8");
ok("js MIME", mimeFor("/js/app.js") === "text/javascript; charset=utf-8");
ok("css MIME", mimeFor("/css/style.css") === "text/css; charset=utf-8");
ok("pdf MIME", mimeFor("/a.PDF") === "application/pdf"); // 大小写不敏感
ok("png MIME", mimeFor("/icon.png") === "image/png");
ok("svg MIME", mimeFor("/icon.svg") === "image/svg+xml");
ok("ico MIME", mimeFor("/icon.ico") === "image/x-icon");
ok("webmanifest MIME", mimeFor("/manifest.webmanifest") === "application/manifest+json");
ok("woff2 MIME", mimeFor("/f.woff2") === "font/woff2");
ok("ttf MIME", mimeFor("/f.ttf") === "font/ttf");
ok("未知扩展兜底 octet-stream", mimeFor("/file.zip") === "application/octet-stream");
ok("无扩展兜底 octet-stream", mimeFor("/README") === "application/octet-stream");
ok("MIME 表含核心类型", ["html", "js", "css", "json", "png", "svg", "ico", "webmanifest", "pdf", "woff2", "ttf", "map"].every(k => MIME["." + k]));

/* ---------- MAX_OPEN_BYTES ---------- */
ok("MAX_OPEN_BYTES = 200MB", MAX_OPEN_BYTES === 200 * 1024 * 1024);

console.log(`\nMAIN-UTILS TEST: ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail) { console.log("FAIL:\n  " + fails.join("\n  ")); process.exit(1); }
process.exit(0);