// 绿角犀 Office · Electron 主进程纯逻辑（零依赖，可单测）
// 从 main.js 抽出的可测业务逻辑，main.js 复用，避免双份实现漂移。
"use strict";

// 版本比较：支持不定长段（如 "1.0" vs "1.0.16"），任一 >= 0；返回 1 / -1 / 0
function cmpVer(a, b) {
  const A = ("" + a).split(".").map(x => parseInt(x, 10) || 0);
  const B = ("" + b).split(".").map(x => parseInt(x, 10) || 0);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) { const x = A[i] || 0, y = B[i] || 0; if (x > y) return 1; if (x < y) return -1; }
  return 0;
}

// 静态文件 MIME 表
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json"
};

function mimeFor(p) {
  return MIME[require("path").extname("" + p).toLowerCase()] || "application/octet-stream";
}

// 静态服务器路径解析（防目录穿越）：reqPath 为已去 query 的 URL 路径
// 返回 { file, forbidden }；forbidden=true 表示越界（应回 403），file=null 表示 404
function safeStaticResolve(root, reqPath) {
  let p = "";
  try { p = decodeURIComponent(reqPath.split("?")[0]); }
  catch (e) { return { file: null, forbidden: false }; } // 非法编码按 404
  if (p === "/") p = "/index.html";
  const file = require("path").join(root, p);
  if (!file.startsWith(root)) return { file: null, forbidden: true };
  return { file, forbidden: false };
}

// 单次打开文档的字节上限（超限跳过，避免撑爆内存）
const MAX_OPEN_BYTES = 200 * 1024 * 1024;

module.exports = { cmpVer, MIME, mimeFor, safeStaticResolve, MAX_OPEN_BYTES };