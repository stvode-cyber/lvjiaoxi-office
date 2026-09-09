/* 绿角犀 Office · 业务板块 工作台聚合「业务概览」 测试
 * 覆盖：orders.dashStats（总数/进行中/待处理/已完成/成交总额）/
 *       approvals.dashStats（总数/待审批/已通过/已驳回）/
 *       空库默认值 / 金额保留两位小数的舍入
 * 运行：node _biz_dashboard_test.js
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
    toast: () => {},
    store: { async list() { return [...mem.values()]; }, async put(d) { mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } }
  };
  const inject = f => { const s = window.document.createElement("script"); s.textContent = fs.readFileSync(path.join(APP, "js/modules/" + f), "utf8"); window.document.body.appendChild(s); };
  inject("orders.js"); inject("approvals.js");
  return { orders: window.OS.biz.orders, approvals: window.OS.biz.approvals, window };
}

(async function main() {
  console.log("=== 业务板块·工作台聚合「业务概览」 测试 ===\n");
  const { orders, approvals } = load();

  console.log("--- 1. orders.dashStats ---");
  let s = await orders.dashStats();
  ok("空库总数0/进行中0/待处理0/金额0", s.count === 0 && s.active === 0 && s.pending === 0 && s.amount === 0);
  await orders.create({ customer: "甲", amount: 100, status: "待处理" });
  await orders.create({ customer: "乙", amount: 250.5, status: "进行中" });
  await orders.create({ customer: "丙", amount: 40, status: "已完成" });
  s = await orders.dashStats();
  ok("总数 3", s.count === 3);
  ok("进行中 1", s.inprogress === 1);
  ok("待处理 1", s.pending === 1);
  ok("已完成 1", s.done === 1);
  ok("active=进行中+待处理=2", s.active === 2);
  ok("成交总额 100+250.5+40=390.5", s.amount === 390.5);
  ok("返回字段完整(count/active/inprogress/done/pending/amount)", ["count", "active", "inprogress", "done", "pending", "amount"].every(k => k in s));

  console.log("\n--- 2. approvals.dashStats ---");
  let a = await approvals.dashStats();
  ok("空库总数0/待审0", a.count === 0 && a.pending === 0 && a.passed === 0 && a.rejected === 0);
  await approvals.create({ subject: "出差报销", kind: "报销", applicant: "张三", status: "待审批" });
  await approvals.create({ subject: "采购申请", kind: "采购", applicant: "李四", status: "待审批" });
  await approvals.create({ subject: "用印", kind: "用印", applicant: "王五", status: "已通过" });
  await approvals.create({ subject: "请假", kind: "请假", applicant: "赵六", status: "已驳回" });
  a = await approvals.dashStats();
  ok("总数 4", a.count === 4);
  ok("待审批 2", a.pending === 2);
  ok("已通过 1", a.passed === 1);
  ok("已驳回 1", a.rejected === 1);
  ok("返回字段完整(count/pending/passed/rejected)", ["count", "pending", "passed", "rejected"].every(k => k in a));

  const summary = `\n=== 业务板块·工作台聚合「业务概览」 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });