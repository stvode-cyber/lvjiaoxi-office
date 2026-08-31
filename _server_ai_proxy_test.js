/* 绿角犀 Office · 服务端 AI 流式代理回归
 * 验证 server/index.js 的 /api/ai/chat：
 *   ① health 的 aiProxy 标志随 LVJX_AI_ENDPOINT 变化
 *   ② 未配上游 → POST /api/ai/chat 返回 501 ai-not-configured
 *   ③ 已配上游 → 鉴权失败 401；鉴权通过 → 200 并透传 SSE，且上游收到的是服务端密钥（非客户端 token）
 *   ④ 上游 5xx → 透传上游状态码（错误透传）
 * 运行：node _server_ai_proxy_test.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); console.log("FAIL:", name); } }

const SERVER_PATH = path.join(__dirname, "server", "index.js");
let tmpSeq = 0;
function tmpDataDir() { const d = path.join(os.tmpdir(), "lvjx-ai-test-" + (process.pid) + "-" + (tmpSeq++)); fs.mkdirSync(d, { recursive: true }); return d; }

// —— mock 上游 SSE 服务：回显固定事件，并记录收到的 Authorization ——
function startUpstream() {
  return new Promise((resolve) => {
    const rec = { auth: null, body: null };
    const s = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => b += c);
      req.on("end", () => {
        rec.auth = req.headers["authorization"] || null;
        rec.body = b;
        if (/fail/.test(req.url)) {
          res.writeHead(500, { "Content-Type": "text/plain" }); res.end("upstream boom"); return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n");
        res.write("data: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    s.listen(0, () => resolve({ server: s, port: s.address().port, rec }));
  });
}

function reqSSE(port, pathname, token) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "localhost", port, path: pathname, method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "Authorization": "Bearer " + token } : {}) } },
      (res) => {
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => resolve({ status: res.statusCode, body }));
      });
    r.on("error", reject);
    r.write(JSON.stringify({ messages: [{ role: "user", content: "hi" }] }));
    r.end();
  });
}
function reqJSON(port, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "localhost", port, path: pathname, method: "GET" }, (res) => {
      let b = ""; res.on("data", (c) => b += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, json: null }); } });
    });
    r.on("error", reject); r.end();
  });
}
function registerLogin(port, user, passwd) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "localhost", port, path: "/api/auth/register", method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      let b = ""; res.on("data", (c) => b += c);
      res.on("end", () => { try { resolve(JSON.parse(b).token); } catch (e) { reject(e); } });
    });
    r.on("error", reject); r.write(JSON.stringify({ username: user, password: passwd })); r.end();
  });
}
function freshRequire(enabledEndpoint) {
  // 通过清理缓存 + 设置 env，得到一份独立的 server 模块实例（数据目录隔离，避免注册 409）
  delete require.cache[require.resolve(SERVER_PATH)];
  process.env.LVJX_CLOUD_DATA = tmpDataDir();
  if (enabledEndpoint) { process.env.LVJX_AI_ENDPOINT = enabledEndpoint; process.env.LVJX_AI_API_KEY = "server-secret"; process.env.LVJX_AI_MODEL = "test-model"; }
  else { delete process.env.LVJX_AI_ENDPOINT; delete process.env.LVJX_AI_API_KEY; }
  return require(SERVER_PATH);
}

(async function main() {
  const upstream = await startUpstream();
  const UP = upstream.port;

  // ===== A：已启用代理 =====
  const srvA = freshRequire("http://localhost:" + UP + "/sse");
  ok("A1 启用时 health.aiProxy=true", srvA.AI_PROXY_ENABLED === true);
  const serverA = await srvA.start(0);
  const portA = serverA.address().port;
  const hA = await reqJSON(portA, "/api/health");
  ok("A2 /api/health 暴露 aiProxy 标志", hA.json && hA.json.aiProxy === true);

  const noTok = await reqSSE(portA, "/api/ai/chat", null);
  ok("A3 无 token → 401", noTok.status === 401);

  const token = await registerLogin(portA, "aiuser", "secret1");
  ok("A4 注册登录拿到 token", !!token);

  const good = await reqSSE(portA, "/api/ai/chat", token);
  ok("A5 鉴权通过 → 200", good.status === 200);
  ok("A6 透传 SSE 内容含上游片段", /"content":"hi"/.test(good.body) && /"content":" there"/.test(good.body) && /\[DONE\]/.test(good.body));
  ok("A7 上游收到的是【服务端密钥】而非客户端 token", upstream.rec.auth === "Bearer server-secret");
  ok("A8 上游收到模型字段", /test-model/.test(upstream.rec.body || ""));

  // 上游 5xx 透传
  const upstream5 = await startUpstream();
  const srvA2 = (function () {
    delete require.cache[require.resolve(SERVER_PATH)];
    process.env.LVJX_CLOUD_DATA = tmpDataDir();
    process.env.LVJX_AI_ENDPOINT = "http://localhost:" + upstream5.port + "/fail"; process.env.LVJX_AI_API_KEY = "server-secret";
    return require(SERVER_PATH);
  })();
  const serverA2 = await srvA2.start(0);
  const portA2 = serverA2.address().port;
  const token2 = await registerLogin(portA2, "aiuser2", "secret2");
  const err5 = await reqSSE(portA2, "/api/ai/chat", token2);
  ok("A9 上游 5xx → 透传状态码(非200)", err5.status !== 200);

  // ===== B：未启用代理 =====
  const srvB = freshRequire(null);
  ok("B1 未启用时 AI_PROXY_ENABLED=false", srvB.AI_PROXY_ENABLED === false);
  const serverB = await srvB.start(0);
  const portB = serverB.address().port;
  const hB = await reqJSON(portB, "/api/health");
  ok("B2 未启用时 health.aiProxy=false", hB.json && hB.json.aiProxy === false);
  const tokB = await registerLogin(portB, "aiuserB", "secretB1");
  const notCfg = await reqSSE(portB, "/api/ai/chat", tokB);
  ok("B3 未配置上游 → 501 ai-not-configured", notCfg.status === 501 && /ai-not-configured/.test(notCfg.body));

  serverA.close(); serverA2.close(); serverB.close(); upstream.server.close(); upstream5.server.close();

  const summary = `\n=== AI 代理回归: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
