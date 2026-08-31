/* 绿角犀 Office · 测试运行器自身回归
 * 验证 scripts/run-tests.js：发现套件、过滤、判定通过/失败、超时、退出码。
 * 运行：node _run_tests_test.js
 */
const fs = require("fs");
const path = require("path");
const runner = require("./scripts/run-tests.js");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) pass++;
  else { fail++; fails.push(name); console.log("FAIL:", name); }
}
function cleanup(p) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} }

const ROOT = runner.ROOT;

// —— 发现 + 过滤 ——
const all = runner.discoverSuites([]);
ok("R1 发现全部既有套件(含本身规划前 33)", all.length >= 33);
ok("R2 套件命名符合 _*_test.js", all.every(f => /^_.*_test\.js$/.test(f)));
const filtered = runner.discoverSuites(["app_boot"]);
ok("R3 过滤器只命中 app_boot 套件", filtered.length === 1 && filtered[0] === "_app_boot_test.js");
const noMatch = runner.discoverSuites(["__nope__"]);
ok("R4 过滤无命中返回空", noMatch.length === 0);

// —— 真实运行一个已知通过的套件（bump_version 规模小、稳定）——
const real = runner.runSuite("_bump_version_test.js", 30000);
ok("R5 已知通过套件判定 PASS", real.ok === true);

// —— 失败判定：临时写一个必失败套件 ——
const failFile = path.join(ROOT, "_tmp_fail_test.js");
fs.writeFileSync(failFile, "process.exit(1);\n");
try {
  const r = runner.runSuite("_tmp_fail_test.js", 30000);
  ok("R6 退出码非 0 套件判定 FAIL", r.ok === false && /退出码/.test(r.reason));
} finally { cleanup(failFile); }

// —— 崩溃判定：抛出未捕获错误 ——
const crashFile = path.join(ROOT, "_tmp_crash_test.js");
fs.writeFileSync(crashFile, "throw new Error('boom');\n");
try {
  const r = runner.runSuite("_tmp_crash_test.js", 30000);
  ok("R7 子进程崩溃判定 FAIL", r.ok === false);
} finally { cleanup(crashFile); }

// —— 超时判定：写一个长 sleep 套件，短超时跑 ——
const toFile = path.join(ROOT, "_tmp_timeout_test.js");
fs.writeFileSync(toFile, "setTimeout(()=>{}, 60000);\n");
try {
  const r = runner.runSuite("_tmp_timeout_test.js", 800);
  ok("R8 超时套件判定 FAIL 且含超时原因", r.ok === false && /超时/.test(r.reason));
} finally { cleanup(toFile); }

// —— parseArgs ——
const a1 = runner.parseArgs(["--timeout", "120", "writer"]);
ok("R9 parseArgs 解析超时与过滤", a1.timeout === 120000 && a1.filters.join() === "writer");
const a2 = runner.parseArgs(["foo"]);
ok("R10 parseArgs 默认超时", a2.timeout === 60000 && a2.filters.join() === "foo");

const summary = `\n=== 测试运行器回归: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
console.log(summary);
process.exit(fail ? 1 : 0);
