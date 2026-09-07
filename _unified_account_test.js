/* 绿角犀 Office · 统一账号（本地离线 + 云端同步）测试
 * 覆盖：
 *   1) 离线登录：本地校验成功、无 token、isCloudLinked=false（纯本地降级，不抛错）
 *   2) 云端存在：login 返回 token（本地+云端统一账号）
 *   3) 云端不存在(404)：linkCloud 自动补注册并返回 token
 *   4) 密码不一致(401)：linkCloud 返回 null（不抛错，纯本地）
 *   5) 后端不可达：linkCloud 返回 null（不抛错，纯本地）
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const webcrypto = require("crypto").webcrypto;

const APP = "D:/源码存档/绿角犀办公软件/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
Object.defineProperty(window, "TextEncoder", { value: TextEncoder, configurable: true });
Object.defineProperty(window, "AbortController", { value: AbortController, configurable: true });

let _n = 0;
const OS = {
  util: { uid: p => (p || "id") + "-" + (++_n), fmtSize: b => (b || 0) + " B", fmtTime: t => String(t), escapeHtml: s => String(s == null ? "" : s) },
  bus: { on() {}, emit() {} }
};
window.OS = OS;

function load(f) {
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js", f), "utf8");
  window.document.body.appendChild(s);
}
load("auth.js");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; console.log("✓ " + name); } else { fail++; fails.push(name); console.log("✗ " + name); } }

// 可控的 fetch 桩：按规则返回
function setFetch(rule) { window.fetch = rule; }

(async () => {
  const A = OS.auth;

  ok("导出 register/login/ensureLocal/linkCloud", typeof A.register === "function" && typeof A.login === "function" && typeof A.ensureLocal === "function" && typeof A.linkCloud === "function");
  ok("导出 isCloudLinked", typeof A.isCloudLinked === "function");

  // ---- 1) 离线登录（fetch 不可达）----
  setFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  const offReg = await A.register("u_off", "secret123");
  ok("离线注册成功", offReg.username === "u_off");
  ok("离线注册无 token", offReg.token === null);
  ok("离线注册 isCloudLinked=false", A.isCloudLinked() === false);
  const offLogin = await A.login("u_off", "secret123");
  ok("离线登录成功", offLogin.username === "u_off" && offLogin.token === null);
  await A.logout();

  // ---- 2) 云端存在：login 返回 token ----
  // 先确保本地没有该用户（全新）
  setFetch((url, opts) => {
    const body = JSON.parse(opts.body);
    if (/\/auth\/login$/.test(url)) {
      if (body.username === "u_cloud" && body.password === "pw123456")
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: "TK-CLOUD", user: { username: "u_cloud" } }) });
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: "用户名或密码错误" }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  const cl = await A.login("u_cloud", "pw123456");
  ok("云端存在时登录返回 token", cl.token === "TK-CLOUD");
  ok("云端存在时 isCloudLinked=true", A.isCloudLinked() === true);
  await A.logout();

  // ---- 3) 云端不存在(404)：自动补注册返回 token ----
  setFetch((url, opts) => {
    const body = JSON.parse(opts.body);
    if (/\/auth\/login$/.test(url)) {
      // 该用户尚未在云端注册 → 404
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "该账户尚未在云端注册" }) });
    }
    if (/\/auth\/register$/.test(url)) {
      if (body.username === "u_new" && body.password === "pw123456")
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: "TK-NEW", user: { username: "u_new" } }) });
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "bad" }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  const nl = await A.login("u_new", "pw123456");
  ok("云端 404 自动补注册并返回 token", nl.token === "TK-NEW");
  await A.logout();

  // ---- 4) 密码不一致(401)：linkCloud 返回 null（不抛错）----
  setFetch((url, opts) => {
    const body = JSON.parse(opts.body);
    if (/\/auth\/login$/.test(url)) {
      // 本地密码与云端不一致 → 401
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: "用户名或密码错误" }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  let linked401 = "unset";
  try { linked401 = await A.linkCloud("u_pw", "secret123"); } catch (e) { linked401 = "threw:" + e.message; }
  ok("云端 401（密码不一致）linkCloud 返回 null", linked401 === null);
  // 本地侧仍应可登录（纯本地）
  await A.logout();

  // ---- 5) 后端不可达：linkCloud 返回 null（不抛错）----
  setFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  let linkedNo = "unset";
  try { linkedNo = await A.linkCloud("u_nf", "secret123"); } catch (e) { linkedNo = "threw:" + e.message; }
  ok("后端不可达 linkCloud 返回 null", linkedNo === null);

  const summary = `UNIFIED-ACCOUNT TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.message); console.log(e && e.stack); process.exit(2); });
