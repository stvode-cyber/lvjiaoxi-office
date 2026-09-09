/* 绿角犀 Office · 业务板块·审批 纯逻辑测试
 * 运行：node _approvals_biz_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function load() {
  const dom = new JSDOM(`<html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  const mem = new Map();
  window.OS = {
    util: { uid: p => (p || "x") + "-" + Math.random().toString(36).slice(2, 8) },
    store: { async list() { return [...mem.values()]; }, async get(id) { return mem.get(id) || null; }, async put(d) { d.updatedAt = Date.now(); mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } }
  };
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/approvals.js"), "utf8");
  window.document.body.appendChild(s);
  return window.OS.biz.approvals;
}

(async function main() {
  console.log("=== 审批板块纯逻辑测试 ===\n");
  const ap = load();
  console.log("--- 1. validateRequest ---");
  ok("缺事由不通过", ap.validateRequest({ subject: "", applicant: "A" }).ok === false);
  ok("缺申请人不通过", ap.validateRequest({ subject: "事", applicant: "" }).ok === false);
  ok("非法类型回退其他", ap.validateRequest({ subject: "事", applicant: "A", kind: "X" }).kind === "其他");
  ok("非法状态回退待审批", ap.validateRequest({ subject: "事", applicant: "A", status: "X" }).status === "待审批");
  ok("合法通过", ap.validateRequest({ subject: " 请假 ", applicant: "王", kind: "请假" }).ok === true);
  ok("状态列表只含三种", ap.APPROVAL_STATUSES.length === 3 && ap.APPROVAL_STATUSES.includes("已驳回"));

  console.log("\n--- 2. summarize ---");
  ok("空列表 pending=0", ap.summarize([]).pending === 0);
  ok("统计各状态", ap.summarize([{ status: "待审批" }, { status: "已通过" }, { status: "待审批" }]).byStatus["待审批"] === 2);
  ok("pending 正确", ap.summarize([{ status: "待审批" }, { status: "已通过" }]).pending === 1);

  console.log("\n--- 3. create / update / list / remove ---");
  const bad = await ap.create({ subject: "", applicant: "A" });
  ok("非法返回 error", !!bad.error);
  const r1 = await ap.create({ subject: "采购报销", applicant: "张", kind: "报销" });
  ok("创建成功且默认待审批", r1.ok === true && r1.doc.data.status === "待审批");
  const up = await ap.update(r1.doc.id, { status: "已通过" });
  ok("审批通过", up.ok === true && up.doc.data.status === "已通过");
  ok("list 1 条且仅 approval", (await ap.list()).length === 1);
  const notfound = await ap.update("nope", { status: "已通过" });
  ok("更新不存在记录返回 error", !!notfound.error);
  await ap.remove(r1.doc.id);
  ok("删除后空", (await ap.list()).length === 0);

  const summary = `\n=== 审批板块测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });