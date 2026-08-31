/* 纯逻辑单测：登录策略 OS.AuthPolicy
   覆盖：默认不强制、设定后可强制、无 OS / 无 settings 时容错为 false
   注意：node require 有模块缓存，每次用 fresh() 清缓存以隔离闭包状态 */
const assert = require("assert");
const MOD = "./app/js/modules/auth-policy.js";
let pass = 0;
function ok(name, cond) { assert.ok(cond, name); console.log("  ✓ " + name); pass++; }
function stub(initial) { const s = Object.assign({}, initial); return { all: () => ({ ...s }), get: (k) => s[k], set: (k, v) => { s[k] = v; } }; }
function fresh() { delete require.cache[require.resolve(MOD)]; return require(MOD); }

// 场景 1：有 settings，默认 false
global.OS = { settings: stub({ requireLogin: false }) };
let P = fresh();
ok("默认不强制（游客可直接进入）", P.shouldGate() === false);
ok("默认键名为 requireLogin", P.KEY === "requireLogin");
P.setRequire(true);
ok("setRequire(true) 后 shouldGate=true", P.shouldGate() === true);
P.setRequire(false);
ok("setRequire(false) 后 shouldGate=false", P.shouldGate() === false);

// 场景 2：无 OS 全局 → 容错 false（不抛错）
delete global.OS;
let P2 = fresh();
ok("无 OS 全局时 shouldGate 容错为 false", P2.shouldGate() === false);
ok("无 OS 全局时 setRequire 不抛错", (() => { try { P2.setRequire(true); return true; } catch (e) { return false; } })());

// 场景 3：OS 存在但无 settings → 容错 false
global.OS = {};
let P3 = fresh();
ok("OS 无 settings 时 shouldGate 容错为 false", P3.shouldGate() === false);

console.log("\nAuthPolicy 测试通过：" + pass + " / " + pass);
