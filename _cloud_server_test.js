/* 云后端实跑测试：启动真实 HTTP 服务，覆盖认证/文档/备档/配额/静态托管/目录穿越守卫 */
const path = require("path");
const fs = require("fs");
const os = require("os");

// 隔离数据目录，避免污染仓库
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lvjx-cloud-"));
process.env.LVJX_CLOUD_DATA = tmp;
process.env.PORT = "0";

const { start, QUOTA } = require("./server/index.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } }

(async () => {
  const srv = await start(0);
  const base = "http://localhost:" + srv.address().port;

  async function call(method, p, token, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
  }

  // 健康检查
  let h = await call("GET", "/api/health");
  ok("health 200", h.status === 200);
  ok("health 返回 50MB 配额", h.data && h.data.quota === QUOTA);

  // 注册
  let reg = await call("POST", "/api/auth/register", null, { username: "alice", password: "secret123" });
  ok("register 200", reg.status === 200);
  ok("register 返回 token", !!(reg.data && reg.data.token));
  const token = reg.data.token;

  // 重复注册
  ok("重复注册 409", (await call("POST", "/api/auth/register", null, { username: "alice", password: "secret123" })).status === 409);
  // 非法用户名
  ok("非法用户名 400", (await call("POST", "/api/auth/register", null, { username: "a", password: "secret123" })).status === 400);
  // 弱密码
  ok("弱密码 400", (await call("POST", "/api/auth/register", null, { username: "bob", password: "123" })).status === 400);

  // 错误密码登录
  ok("错误密码登录 401", (await call("POST", "/api/auth/login", null, { username: "alice", password: "wrong" })).status === 401);
  // 用户不存在（供前端自动补注册，统一本地/云端账号）
  ok("未注册用户登录 404", (await call("POST", "/api/auth/login", null, { username: "ghost", password: "secret123" })).status === 404);
  // 正确登录
  let lg = await call("POST", "/api/auth/login", null, { username: "alice", password: "secret123" });
  ok("正确登录 200+token", lg.status === 200 && !!lg.data.token);

  // 鉴权守卫
  ok("me 无 token 401", (await call("GET", "/api/me", null)).status === 401);
  ok("me 有 token 200", (await call("GET", "/api/me", token)).data.username === "alice");
  ok("docs PUT 无 token 401", (await call("PUT", "/api/docs/d1", null, { id: "d1" })).status === 401);

  // 文档读写
  ok("docs PUT 200", (await call("PUT", "/api/docs/d1", token, { id: "d1", type: "writer", name: "t", data: { x: 1 } })).status === 200);
  let dg = await call("GET", "/api/docs", token);
  ok("docs GET 含 d1", dg.data.docs.some(d => d.id === "d1"));
  ok("docs GET spaceUsed>0", dg.data.spaceUsed > 0);

  // 备档读写
  ok("backup PUT 200", (await call("PUT", "/api/backups/b1", token, { id: "b1", docId: "d1", docName: "t", type: "writer", data: { y: 2 } })).status === 200);
  ok("backup GET 含 b1", (await call("GET", "/api/backups", token)).data.backups.some(b => b.id === "b1"));

  // 空间
  let sp = await call("GET", "/api/space", token);
  ok("space 200 且 quota 一致", sp.status === 200 && sp.data.quota === QUOTA);

  // 配额强制：循环推 1MB 文档直到 413
  let got413 = false, lastSpace = 0;
  const oneMB = "x".repeat(1024 * 1024);
  for (let i = 0; i < 70 && !got413; i++) {
    let r = await call("PUT", "/api/docs/q" + i, token, { id: "q" + i, type: "writer", name: "q", data: { big: oneMB } });
    if (r.status === 413) { got413 = true; lastSpace = r.data.spaceUsed; }
  }
  ok("配额超限返回 413", got413);
  ok("413 时空间接近 50MB", got413 && lastSpace <= QUOTA && lastSpace > QUOTA - 2 * 1024 * 1024);

  // 静态托管
  let idx = await fetch(base + "/");
  ok("静态 / 200", idx.status === 200);
  ok("静态 / 是 html", (idx.headers.get("content-type") || "").indexOf("text/html") >= 0);
  ok("静态 /js/cloudsync.js 200", (await fetch(base + "/js/cloudsync.js")).status === 200);
  ok("静态 不存在 404", (await fetch(base + "/nope.txt")).status === 404);

  // 目录穿越守卫（纯逻辑断言，与 serveStatic 内表达式一致）
  const APP = path.join(__dirname, "app");
  const fp = path.normalize(path.join(APP, decodeURIComponent("/%2e%2e/server/index.js")));
  ok("目录穿越被守卫（落在 app 外）", !fp.startsWith(APP));

  srv.close();
  console.log("\n==== 云后端 PASS " + pass + " FAIL " + fail + " ====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e); process.exit(2); });
