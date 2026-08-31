/* 云端同步端到端：真实启动 server，驱动 OS.CloudSync.syncNow() 与之对话，
 * 验证「本地文档→云端上传」与「云端文档→本地拉取」两条链路真实打通。 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lvjx-cs-int-"));
process.env.LVJX_CLOUD_DATA = tmp;
process.env.PORT = "0";

const { start } = require("./server/index.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } }

(async () => {
  const srv = await start(0);
  const base = "http://localhost:" + srv.address().port;
  const api = base + "/api";

  // —— 注册 + 登录拿 token ——
  const reg = await fetch(api + "/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "carol", password: "pw123456" }) });
  const { token } = await reg.json();
  ok("拿到云端 token", !!token);

  // —— 准备前端环境（mock store，记录 put 调用）——
  const putCalls = [];
  const putBackupCalls = [];
  const localDoc = { id: "doc-local-1", type: "writer", name: "本地文档", data: { t: "hello" }, updatedAt: 1000 };
  const localBk = { id: "bk-local-1", docId: "doc-local-1", docName: "本地文档", type: "writer", data: { t: "hello" }, createdAt: 1000 };
  const fakeOS = {
    auth: { API_BASE: api, current: () => ({ token, username: "carol" }) },
    store: {
      list: () => Promise.resolve([localDoc]),
      listAllBackups: () => Promise.resolve([localBk]),
      put: (d) => { putCalls.push(d); return Promise.resolve(d); },
      putBackup: (b) => { putBackupCalls.push(b); return Promise.resolve(b); }
    },
    toast: () => {},
    util: { log() {} }
  };
  const window = { OS: fakeOS };
  new Function("window", fs.readFileSync(path.join(__dirname, "app/js/cloudsync.js"), "utf8"))(window);
  const CS = window.OS.CloudSync;

  // —— 激活并同步（上传本地到云端）——
  const r1 = await CS.start();
  ok("start→首次同步连通", r1 && r1.connected === true && r1.pushed >= 2);
  CS.stop();

  // 云端确实收到了本地文档与备档
  const dg = await (await fetch(api + "/docs", { headers: { Authorization: "Bearer " + token } })).json();
  const bg = await (await fetch(api + "/backups", { headers: { Authorization: "Bearer " + token } })).json();
  ok("云端含本地上传的文档", dg.docs.some(d => d.id === "doc-local-1"));
  ok("云端含本地上传的备档", bg.backups.some(b => b.id === "bk-local-1"));

  // —— 反向：云端有本地缺失的文档，syncNow 应拉取到本地 store.put ——
  const remoteOnly = { id: "doc-remote-1", type: "spreadsheet", name: "云端独有", data: { v: 1 }, updatedAt: 5000 };
  await fetch(api + "/docs/doc-remote-1", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(remoteOnly) });

  const r2 = await CS.start();
  CS.stop();
  ok("syncNow 连通（第二轮）", r2 && r2.connected === true);
  ok("云端独有文档被拉取到本地 store.put", putCalls.some(d => d.id === "doc-remote-1"));

  // —— 配额满：塞满后上传应被拒绝且不崩溃 ——
  const oneMB = "x".repeat(1024 * 1024);
  for (let i = 0; i < 60; i++) {
    const rr = await fetch(api + "/docs/fill" + i, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ id: "fill" + i, type: "writer", data: { big: oneMB } }) });
    if (rr.status === 413) break;
  }
  const r3 = await CS.start();
  CS.stop();
  ok("配额满时 syncNow 不抛错（graceful）", r3 && typeof r3.connected === "boolean");

  srv.close();
  console.log("\n==== 云端同步端到端 PASS " + pass + " FAIL " + fail + " ====");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("TEST ERROR", e); process.exit(2); });
