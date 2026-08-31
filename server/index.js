/* ============================================================
 * 绿角犀 Office · 云端后端（零依赖 Node 服务）
 * ------------------------------------------------------------
 * 单一进程同时承担两件事：
 *   1) 静态托管前端 app/（自托管部署一步到位）
 *   2) 云端账户 + 个人空间 API（auth.js 已按此契约调用）
 *
 * 端点（与 app/js/auth.js 的 API_BASE="/api" 完全一致）：
 *   POST /api/auth/register  { username, password }            -> { token, user:{username} }
 *   POST /api/auth/login     { username, password }            -> { token, user:{username} }
 *   POST /api/auth/logout    { token }                         -> { ok:true }
 *   GET  /api/me                                               -> { username }
 *   GET  /api/docs              (auth)                         -> { docs:[...], spaceUsed, quota }
 *   PUT  /api/docs/:id          (auth) body=doc                -> { ok, spaceUsed }
 *   DELETE /api/docs/:id        (auth)                         -> { ok }
 *   GET  /api/backups           (auth)                         -> { backups:[...], spaceUsed, quota }
 *   PUT  /api/backups/:id       (auth) body=bk                 -> { ok, spaceUsed }
 *   GET  /api/space             (auth)                         -> { spaceUsed, quota }
 *   POST /api/ai/chat            (auth) SSE 代理上游 LLM（密钥留服务端，由 LVJX_AI_* 配置；未配返回 501）
 *
 * 安全：密码用 scrypt 加盐哈希（服务端，绝不明文）；token = base64url(json{u,exp}) + HMAC-SHA256。
 * 配额：服务端强制 50 MB（文档 + 备档合计），超限返回 413。
 * 存储：server/data/<user>.json（按用户名隔离）。生产请用 LVJX_CLOUD_SECRET 设置签名密钥。
 * ============================================================ */
"use strict";
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const QUOTA = 50 * 1024 * 1024; // 个人空间 50 MB
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const SECRET = process.env.LVJX_CLOUD_SECRET || "dev-only-insecure-secret-change-me";
const DATA_DIR = process.env.LVJX_CLOUD_DATA || path.join(__dirname, "data");
const APP_DIR = path.join(__dirname, "..", "app");
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天

// 云端 AI 代理（可选）：真实密钥留在服务端，浏览器只调同源 /api/ai/chat。
// 配置方式（仅服务端环境变量，绝不下发到前端）：
//   LVJX_AI_ENDPOINT  = 上游 /chat/completions 完整地址（OpenAI 风格 SSE）
//   LVJX_AI_API_KEY   = 上游 API Key（服务端保密）
//   LVJX_AI_MODEL     = 默认模型（可被请求覆盖）
const AI_ENDPOINT = process.env.LVJX_AI_ENDPOINT || "";
const AI_API_KEY = process.env.LVJX_AI_API_KEY || "";
const AI_MODEL = process.env.LVJX_AI_MODEL || "gpt-4o-mini";
const AI_PROXY_ENABLED = !!(AI_ENDPOINT && /^https?:\/\//.test(AI_ENDPOINT));
const AI_HTTP_LIB = (() => { try { return AI_ENDPOINT.startsWith("https") ? https : http; } catch (e) { return http; } })();

/* ---------------- 工具 ---------------- */
function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}
function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}
function b64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}
function sizeOf(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

/* ---------------- token ---------------- */
function signToken(username) {
  const body = b64urlJson({ u: username, exp: Date.now() + TOKEN_TTL });
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const expect = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  // 定长比较，防时序攻击
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch (e) { return null; }
  if (!payload || !payload.u || Date.now() > payload.exp) return null;
  return payload.u;
}

/* ---------------- 密码哈希（scrypt） ---------------- */
function hashPassword(pass, salt) {
  return crypto.scryptSync(pass, salt, 64).toString("hex");
}
function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

/* ---------------- 用户存储 ---------------- */
function safeName(username) {
  return /^[A-Za-z0-9_.-]{2,40}$/.test(username) ? username : null;
}
function userFile(username) {
  return path.join(DATA_DIR, username + ".json");
}
function readUser(username) {
  try {
    const raw = fs.readFileSync(userFile(username), "utf8");
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function writeUser(rec) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(userFile(rec.user.username), JSON.stringify(rec, null, 2), "utf8");
}
function spaceUsedOf(rec) {
  let t = 0;
  for (const id in (rec.docs || {})) t += sizeOf(rec.docs[id]);
  for (const id in (rec.backups || {})) t += sizeOf(rec.backups[id]);
  return t;
}

/* ---------------- HTTP 辅助 ---------------- */
function sendJson(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
  }, headers || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooBig = false;
    req.on("data", (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) { tooBig = true; req.destroy(); } // 单请求 5MB 上限
    });
    req.on("end", () => { if (tooBig) return reject(new Error("payload too large")); try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error("invalid json")); } });
    req.on("error", reject);
  });
}
function authUser(req) {
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  return verifyToken(m[1]);
}

/* ---------------- API 路由 ---------------- */
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // 预检
  if (method === "OPTIONS") return sendJson(res, 204, {});

  // 健康检查（无需鉴权）
  if (p === "/api/health" && method === "GET")
    return sendJson(res, 200, { ok: true, quota: QUOTA, aiProxy: AI_PROXY_ENABLED });

  // ---- 云端 AI 流式代理（需鉴权；真实密钥留服务端，不下发前端） ----
  if (p === "/api/ai/chat" && method === "POST") {
    if (!AI_PROXY_ENABLED) {
      // 未配置服务端代理：诚实返回 501，前端据此回退本地引擎
      return sendJson(res, 501, { error: "ai-not-configured", hint: "服务端未配置 LVJX_AI_ENDPOINT，AI 将使用本地离线引擎。" });
    }
    const username = authUser(req);
    if (!username) return sendJson(res, 401, { error: "未授权或登录已过期" });
    let body; try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const messages = body.messages || [{ role: "user", content: body.user || body.prompt || "" }];
    const model = body.model || AI_MODEL;
    const upstreamHeaders = { "Content-Type": "application/json" };
    if (AI_API_KEY) upstreamHeaders["Authorization"] = "Bearer " + AI_API_KEY;
    let upstreamReq;
    try {
      upstreamReq = AI_HTTP_LIB.request(AI_ENDPOINT, {
        method: "POST",
        headers: upstreamHeaders,
        timeout: 60000
      }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*"
        });
        // 直接透传上游 SSE（含 [DONE]）；上游非 2xx 时也把错误体转 SSE 事件便于前端捕获
        upstreamRes.on("data", (chunk) => res.write(chunk));
        upstreamRes.on("end", () => res.end());
        upstreamRes.on("error", () => { try { res.end(); } catch (e) {} });
      });
    } catch (e) {
      return sendJson(res, 502, { error: "ai-upstream-unreachable", detail: String(e && e.message || e) });
    }
    upstreamReq.on("error", (e) => {
      try { sendJson(res, 502, { error: "ai-upstream-error", detail: String(e && e.message || e) }); } catch (err) {}
    });
    upstreamReq.write(JSON.stringify({ model, stream: true, messages }));
    upstreamReq.end();
    return; // 响应已接管（流式）
  }

  // ---- 认证（无需鉴权） ----
  if (p === "/api/auth/register" && method === "POST") {
    let body; try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const username = (body.username || "").trim();
    const password = body.password || "";
    if (!safeName(username)) return sendJson(res, 400, { error: "用户名需为 2-40 位字母/数字/._-" });
    if (password.length < 6) return sendJson(res, 400, { error: "密码至少 6 位" });
    if (readUser(username)) return sendJson(res, 409, { error: "该用户名已被注册" });
    const salt = newSalt();
    const rec = {
      user: { username, salt, passHash: hashPassword(password, salt), createdAt: Date.now() },
      docs: {}, backups: {}
    };
    writeUser(rec);
    return sendJson(res, 200, { token: signToken(username), user: { username } });
  }

  if (p === "/api/auth/login" && method === "POST") {
    let body; try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const username = (body.username || "").trim();
    const password = body.password || "";
    const rec = readUser(username);
    // 区分：用户不存在 -> 404（前端据此自动补注册，统一本地与云端账号）
    if (!rec) return sendJson(res, 404, { error: "该账户尚未在云端注册" });
    // 密码错误 -> 401
    if (rec.user.passHash !== hashPassword(password, rec.user.salt))
      return sendJson(res, 401, { error: "用户名或密码错误" });
    return sendJson(res, 200, { token: signToken(username), user: { username } });
  }

  if (p === "/api/auth/logout" && method === "POST") {
    // 无状态 token，登出即客户端丢弃；服务端仅回 ok
    return sendJson(res, 200, { ok: true });
  }

  // ---- 以下均需鉴权 ----
  const username = authUser(req);
  if (!username) return sendJson(res, 401, { error: "未授权或登录已过期" });
  const rec = readUser(username) || { user: { username }, docs: {}, backups: {} };

  if (p === "/api/me" && method === "GET") return sendJson(res, 200, { username });
  if (p === "/api/space" && method === "GET")
    return sendJson(res, 200, { spaceUsed: spaceUsedOf(rec), quota: QUOTA });

  // 文档
  if (p === "/api/docs" && method === "GET")
    return sendJson(res, 200, { docs: Object.values(rec.docs), spaceUsed: spaceUsedOf(rec), quota: QUOTA });

  const docMatch = /^\/api\/docs\/([^/]+)$/.exec(p);
  if (docMatch && (method === "PUT" || method === "DELETE")) {
    const id = decodeURIComponent(docMatch[1]);
    if (method === "DELETE") {
      delete rec.docs[id];
      writeUser(rec);
      return sendJson(res, 200, { ok: true, spaceUsed: spaceUsedOf(rec) });
    }
    let body; try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const doc = Object.assign({}, body, { id, size: sizeOf(body.data || {}) });
    const incoming = sizeOf(doc);
    if (rec.docs[id]) {
      // 替换：差额 = 新 - 旧
      const delta = incoming - sizeOf(rec.docs[id]);
      if (spaceUsedOf(rec) + delta > QUOTA) return sendJson(res, 413, { error: "个人空间已满（50 MB）", spaceUsed: spaceUsedOf(rec), quota: QUOTA });
    } else {
      if (spaceUsedOf(rec) + incoming > QUOTA) return sendJson(res, 413, { error: "个人空间已满（50 MB）", spaceUsed: spaceUsedOf(rec), quota: QUOTA });
    }
    rec.docs[id] = doc;
    writeUser(rec);
    return sendJson(res, 200, { ok: true, spaceUsed: spaceUsedOf(rec) });
  }

  // 备档
  if (p === "/api/backups" && method === "GET")
    return sendJson(res, 200, { backups: Object.values(rec.backups), spaceUsed: spaceUsedOf(rec), quota: QUOTA });

  const bkMatch = /^\/api\/backups\/([^/]+)$/.exec(p);
  if (bkMatch && (method === "PUT" || method === "DELETE")) {
    const id = decodeURIComponent(bkMatch[1]);
    if (method === "DELETE") {
      delete rec.backups[id];
      writeUser(rec);
      return sendJson(res, 200, { ok: true, spaceUsed: spaceUsedOf(rec) });
    }
    let body; try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const bk = Object.assign({}, body, { id, size: sizeOf(body.data || {}) });
    const incoming = sizeOf(bk);
    if (rec.backups[id]) {
      const delta = incoming - sizeOf(rec.backups[id]);
      if (spaceUsedOf(rec) + delta > QUOTA) return sendJson(res, 413, { error: "个人空间已满（50 MB）", spaceUsed: spaceUsedOf(rec), quota: QUOTA });
    } else {
      if (spaceUsedOf(rec) + incoming > QUOTA) return sendJson(res, 413, { error: "个人空间已满（50 MB）", spaceUsed: spaceUsedOf(rec), quota: QUOTA });
    }
    rec.backups[id] = bk;
    writeUser(rec);
    return sendJson(res, 200, { ok: true, spaceUsed: spaceUsedOf(rec) });
  }

  return sendJson(res, 404, { error: "API 不存在" });
}

/* ---------------- 静态托管（防目录穿越） ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8"
};
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.normalize(path.join(APP_DIR, rel));
  if (!filePath.startsWith(APP_DIR)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404 Not Found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Access-Control-Allow-Origin": "*" });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- 主入口 ---------------- */
function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((e) => sendJson(res, 500, { error: String(e && e.message || e) }));
    return;
  }
  serveStatic(req, res, url);
}

function start(port) {
  const p = (port == null) ? PORT : port; // 传 0 表示随机空闲端口（测试用）
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(p, () => resolve(server));
  });
}

if (require.main === module) {
  start(PORT).then((s) => {
    const addr = s.address();
    console.log("绿角犀 Office 云端已启动：http://localhost:" + (addr.port) + "  （静态 " + APP_DIR + "，数据 " + DATA_DIR + "）");
    if (SECRET === "dev-only-insecure-secret-change-me") {
      console.log("⚠ 使用默认开发密钥；生产请用环境变量 LVJX_CLOUD_SECRET 设置强密钥。");
    }
  });
}

module.exports = { start, handler, signToken, verifyToken, hashPassword, QUOTA, spaceUsedOf, AI_PROXY_ENABLED, AI_ENDPOINT, _internals: { DATA_DIR, userFile, readUser } };
