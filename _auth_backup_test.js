/* 绿角犀 Office · 登录系统 + 个人空间配额 + 自动备档 测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const webcrypto = require("crypto").webcrypto;

const APP = "D:/源码存档/绿角犀办公软件/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
Object.defineProperty(window, "TextEncoder", { value: TextEncoder, configurable: true });
Object.defineProperty(window, "AbortController", { value: AbortController, configurable: true });

// 确定性 uid，避免随机影响断言
let _n = 0;
const OS = {
  util: {
    uid: p => (p || "id") + "-" + (++_n),
    fmtSize: b => (b || 0) + " B",
    fmtTime: t => String(t),
    escapeHtml: s => String(s == null ? "" : s)
  },
  bus: { on() {}, emit() {} }
};
window.OS = OS;
// 确定性 stub：让云端接口始终「不可达」（模拟后端未部署），
// 验证云端登录优雅降级，避免 Node 全局 fetch 行为差异导致断言抖动。
window.fetch = function () {
  return Promise.reject(new TypeError("Failed to fetch"));
};

function load(f) {
  const code = fs.readFileSync(path.join(APP, "js", f), "utf8");
  const s = window.document.createElement("script");
  s.textContent = code;
  window.document.body.appendChild(s);
}
load("auth.js");
load("store.js");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

(async () => {
  const A = OS.auth, S = OS.store;

  // 1) 未登录态
  ok("初始未登录", A.isLoggedIn() === false);
  ok("dbNameFor 默认 anon", A.dbNameFor() === "lvjiaoxi-office-anon");
  ok("dbNameFor 用户隔离", A.dbNameFor("alice") === "lvjiaoxi-office-alice");
  ok("QUOTA=50MB", A.QUOTA === 50 * 1024 * 1024);
  ok("MAX_BACKUPS=20", A.MAX_BACKUPS === 20);
  ok("BACKUP_INTERVAL=5min", A.BACKUP_INTERVAL === 5 * 60 * 1000);

  // 2) 统一注册 / 登录（离线：fetch 被 stub 为不可达，应降级为纯本地，不报错）
  const reg = await A.register("alice", "secret123");
  ok("注册成功返回账户", reg.username === "alice");
  ok("离线注册无 token（纯本地降级）", reg.token === null);
  ok("注册后已登录", A.isLoggedIn() === true);
  ok("current 为 alice", A.current() && A.current().username === "alice");
  ok("离线态 isCloudLinked=false", A.isCloudLinked() === false);

  // 3) 密码错误被拒（用符合强度但错误的密码，验证哈希比对而非强度校验拦截）
  let threw = false;
  try { await A.login("alice", "wrongpw"); } catch (e) { threw = /用户名或密码错误/.test(e.message); }
  ok("密码错误登录被拒", threw);

  // 4) 密码强度校验
  let weak = false;
  try { await A.register("bob", "123"); } catch (e) { weak = /至少 6 位/.test(e.message); }
  ok("弱密码注册被拒", weak);

  // 5) 重复用户名被拒（offline 本地已有 alice，新密码冲突）
  let dup = false;
  try { await A.register("alice", "another1"); } catch (e) { dup = /用户名或密码错误/.test(e.message); }
  ok("重复用户名+密码不一致被拒", dup);

  // 6) 正确登录
  const login = await A.login("alice", "secret123");
  ok("正确登录成功", login.username === "alice");

  // 7) 存储初始化（无 indexedDB → 内存降级）
  const mode = await S.init();
  ok("store 初始化为 localstorage 降级", mode === "localstorage");

  // 8) 写入文档并计算 size
  const doc = { id: "d1", type: "writer", name: "测试文档", data: { x: 1 } };
  const put = await S.put(doc);
  ok("put 计算 size>0", put.size > 0);

  // 9) 空间占用含文档
  let used = await S.spaceUsed();
  ok("spaceUsed 含文档 size", used >= put.size);

  // 10) 备档
  await S.backup(doc);
  let bks = await S.listBackups("d1");
  ok("备份后列表含1份", bks.length === 1);
  ok("备份数据一致", bks[0].data.x === 1 && bks[0].docName === "测试文档");

  // 11) 多版本 + 自动 prune 至 MAX_BACKUPS
  for (let i = 0; i < 25; i++) { doc.data = { x: i }; await S.put(doc); await S.backup(doc); }
  bks = await S.listBackups("d1");
  ok("超过20份自动修剪到20", bks.length === A.MAX_BACKUPS);
  ok("备份列表按时间倒序", bks[0].createdAt >= bks[bks.length - 1].createdAt);

  // 12) 回滚到指定版本（回滚到修剪后仍必然存在的最旧一份，避免依赖已被 prune 的历史备份）
  const vOld = bks[bks.length - 1];
  ok("存在可回滚的备份", !!vOld);
  const restored = await S.restoreBackup(vOld.id);
  const got = await S.get("d1");
  ok("回滚恢复指定版本数据", got && got.data.x === vOld.data.x);

  // 13) 备份计入空间
  used = await S.spaceUsed();
  const docOnly = (await S.list()).reduce((s, d) => s + (d.size || 0), 0);
  ok("spaceUsed 含备份占用", used > docOnly);

  // 14) 配额与 withinQuota
  ok("quota=50MB", S.quota() === 50 * 1024 * 1024);
  ok("withinQuota 默认 true", (await S.withinQuota(0)) === true);

  // 15) 云端链接优雅降级：fetch 不可达时 linkCloud 返回 null（纯本地，不抛错）
  Object.defineProperty(window, "fetch", { value: () => Promise.reject(new TypeError("Failed to fetch")), configurable: true });
  let linked = "unset";
  try { linked = await A.linkCloud("alice", "secret123"); } catch (e) { linked = "threw:" + e.message; }
  ok("云端不可达时 linkCloud 返回 null（不抛错）", linked === null);

  // 16) 登出
  await A.logout();
  ok("登出后未登录", A.isLoggedIn() === false);

  // 17) 记住我：持久会话
  const reg2 = await A.register("carol", "remember1", true);
  ok("记住我注册返回账户", reg2.username === "carol");
  const remRaw = window.localStorage.getItem(A.REMEMBER_KEY);
  ok("记住我写入 localStorage", !!remRaw);
  let remSession = null;
  try { remSession = JSON.parse(remRaw); } catch (e) {}
  ok("持久会话含用户名", remSession && remSession.username === "carol");

  // 模拟重开页面：仅剩下 localStorage（sessionStorage 清空）
  window.sessionStorage.clear();
  const restoredFromLS = A.current();
  ok("重开页面从 localStorage 恢复会话", restoredFromLS && restoredFromLS.username === "carol");
  ok("重开后仍处于登录态", A.isLoggedIn() === true);

  // 未勾选记住我：不写入持久会话
  await A.logout();
  await A.register("dave", "remember2", false);
  ok("未勾选记住我不写 localStorage", !window.localStorage.getItem(A.REMEMBER_KEY));

  // 勾选后登出应清除持久会话
  await A.logout();
  await A.register("erin", "remember3", true);
  await A.logout();
  ok("登出清除持久会话", !window.localStorage.getItem(A.REMEMBER_KEY));
  ok("登出清除会话态", A.isLoggedIn() === false);

  // 18) 个人空间导出 / 导入
  await A.register("frank", "export1", false);
  await S.init();
  // 清空现有空间，确保干净隔离
  await S.importSpace({ format: "lvjx-space", version: 1, docs: [], backups: [] }, { replace: true });
  const dExp = { id: "exp1", type: "writer", name: "导出测试", data: { hello: "world" } };
  await S.put(dExp);
  await S.backup(dExp);
  const pkg = await S.exportSpace();
  ok("exportSpace 含文档", pkg.docs.length === 1 && pkg.docs[0].id === "exp1");
  ok("exportSpace 含备档", pkg.backups.length === 1 && pkg.backups[0].docId === "exp1");
  ok("exportSpace 格式标记", pkg.format === "lvjx-space" && pkg.version === 1);
  // 清空后从包导入，验证恢复
  await S.importSpace({ format: "lvjx-space", version: 1, docs: [], backups: [] }, { replace: true });
  const rImp = await S.importSpace(pkg);
  ok("导入返回计数", rImp.docs === 1 && rImp.backups === 1);
  const gotExp = await S.get("exp1");
  ok("导入恢复文档数据", gotExp && gotExp.data.hello === "world");
  const bksExp = await S.listBackups("exp1");
  ok("导入恢复备档", bksExp.length === 1);
  let badPkg = false;
  try { await S.importSpace({ foo: 1 }); } catch (e) { badPkg = /格式不支持|损坏/.test(e.message); }
  ok("损坏包被拒绝", badPkg);

  // 19) .lvjx 导出加密（PBKDF2-SHA256 + AES-GCM-256）
  await A.register("gary", "crypt01", false);
  await S.init();
  await S.importSpace({ format: "lvjx-space", version: 1, docs: [], backups: [] }, { replace: true });
  const dC = { id: "c1", type: "writer", name: "加密测试", data: { secret: "x" } };
  await S.put(dC);
  const enc = await S.exportSpace({ passphrase: "pw123" });
  ok("加密导出带 encrypted 标记", enc.encrypted === true && enc.format === "lvjx-space");
  ok("加密导出不含明文文档", !Array.isArray(enc.docs));
  ok("加密导出含 kdf/iterations", enc.kdf === "PBKDF2-SHA256" && enc.iterations === 150000);
  let needPass = false;
  try { await S.importSpace(enc); } catch (e) { needPass = /口令/.test(e.message); }
  ok("加密文件无口令导入被拒", needPass);
  let wrongPass = false;
  try { await S.importSpace(enc, { passphrase: "bad" }); } catch (e) { wrongPass = /口令错误|损坏/.test(e.message); }
  ok("错误口令导入被拒", wrongPass);
  await S.importSpace({ format: "lvjx-space", version: 1, docs: [], backups: [] }, { replace: true });
  const rC = await S.importSpace(enc, { passphrase: "pw123" });
  ok("正确口令导入恢复文档", rC.docs === 1);
  const gotC = await S.get("c1");
  ok("解密后数据一致", gotC && gotC.data.secret === "x");

  const summary = `AUTH-BACKUP TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  fs.writeFileSync(path.join(APP, "..", "_auth_backup_result.txt"), summary);
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.message); console.log(e && e.stack); process.exit(2); });
