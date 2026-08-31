/* 云端同步纯函数测试：用伪 window 加载 cloudsync.js IIFE，验证可测的纯逻辑（无需联网） */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("✓ " + name); } else { fail++; console.log("✗ " + name); } }

// 加载 cloudsync.js（IIFE 绑定到传入的 window）
const code = fs.readFileSync(path.join(__dirname, "app/js/cloudsync.js"), "utf8");
const window = { OS: { auth: { API_BASE: "/api" }, util: { log() {} } } };
new Function("window", code)(window);
const CS = window.OS.CloudSync;

ok("CloudSync 已挂载", !!CS);
ok("含 shouldSync", typeof CS.shouldSync === "function");

// shouldSync：统一账号模型，仅看 token（不区分 provider）
ok("有 token => true", CS.shouldSync({ username: "u", token: "x" }) === true);
ok("无 token => false", CS.shouldSync({ username: "u" }) === false);
ok("空会话 => false", CS.shouldSync({}) === false);
ok("local+token => true（统一账号，云端链接即同步）", CS.shouldSync({ username: "u", token: "x" }) === true);

// 端点拼接（含编码）
ok("docEndpoint", CS.docEndpoint("/api", "d1") === "/api/docs/d1");
ok("docEndpoint 编码特殊 id", CS.docEndpoint("/api", "a/b c") === "/api/docs/" + encodeURIComponent("a/b c"));
ok("backupEndpoint", CS.backupEndpoint("/api", "b1") === "/api/backups/b1");

// 鉴权头
const headers = CS.authHeaders("tk");
ok("authHeaders 含 Bearer", headers["Authorization"] === "Bearer tk" && headers["Content-Type"] === "application/json");

// mergePlan：双向合并
const local = [{ id: "a", updatedAt: 10 }, { id: "b", updatedAt: 5 }];
const remote = [{ id: "a", updatedAt: 20 }, { id: "c", updatedAt: 1 }];
const plan = CS.mergePlan(local, remote);
ok("mergePlan toPull 含 a(远端新)+c(本地缺)", plan.toPull.indexOf("a") >= 0 && plan.toPull.indexOf("c") >= 0);
ok("mergePlan toPush 含 b(本地新/远端缺)", plan.toPush.indexOf("b") >= 0);
ok("mergePlan 不重复", plan.toPull.length === 2 && plan.toPush.length === 1);

// backupMergePlan：云端缺失即上传
const bp = CS.backupMergePlan([{ id: "b1" }, { id: "b2" }], [{ id: "b2" }], new Set());
ok("backupMergePlan 仅推 b1", bp.toPush.length === 1 && bp.toPush[0] === "b1");

// status：初始态
const st = CS.status();
ok("status 初始 enabled=false", st.enabled === false && st.connected === false);
ok("status 含统计字段", typeof st.lastSync === "number" && typeof st.seenDocs === "number");

console.log("\n==== cloudsync PASS " + pass + " FAIL " + fail + " ====");
process.exit(fail ? 1 : 0);
