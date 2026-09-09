/* 绿角犀 Office · 业务板块·订单/审批 详情展开 + 审批状态留痕 测试
 * 覆盖：order detailData/detail（含 statusHistory 时间线）/
 *       approval detailData/detail、update 状态变更留痕、batchSetStatus 留痕/
 *       订单 + 审批 列表 DOM「详情」展开 → 时间线渲染 → 收起
 * 运行：node _biz_detail_test.js
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = __dirname + "/app";
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeStore() {
  const mem = new Map();
  return {
    mem,
    store: { async list() { return [...mem.values()]; }, async get(id) { return mem.get(id); },
      async put(d) { mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } }
  };
}
function load(mod, $) {
  const dom = new JSDOM(`<html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  window.OS = { util: { uid: p => (p || "x") + "-" + Math.random().toString(36).slice(2, 8) }, toast: () => {}, ...$.storeCtx };
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/" + mod), "utf8");
  window.document.body.appendChild(s);
  return { biz: window.OS.biz, window, mem: $.storeCtx.mem };
}

(async function main() {
  console.log("=== 业务板块·详情展开 测试 ===\n");

  // ---------- 订单 ----------
  console.log("--- 1. 订单 detailData / detail ---");
  const om = makeStore(); const offer = load("orders.js", { storeCtx: om });
  const oz = offer.biz.orders;
  const oDoc = (await oz.create({ customer: "甲方", amount: 100, status: "待处理", note: "首批" })).doc;
  await oz.setStatus(oDoc.id, "进行中", "已安排");
  await oz.setStatus(oDoc.id, "已完成", "验收");

  const od = oz.detailData(oDoc);
  ok("detailData 金额数字", od.amount === 100 && typeof od.amount === "number");
  ok("detailData 状态=最新", od.status === "已完成");
  ok("detailData 映射 history 条数 2", od.history.length === 2);
  ok("detailData history[0] 含状态/ts/note", od.history[0].status === "进行中" && od.history[0].note === "已安排");

  const odi = await oz.detail(oDoc.id);
  ok("detail(id) ok", odi.ok && odi.data.customer === "甲方" && odi.data.history.length === 2);
  const odx = await oz.detail("ord-nope");
  ok("detail 缺失订单报错", odx.error);

  // 订单 DOM 详情展开/收起
  console.log("\n--- 2. 订单列表 DOM 详情展开 → 时间线 → 收起 ---");
  const oel = offer.window.document.createElement("div");
  await oz.render(oel);
  const oBtn = oel.querySelector("[data-detail]");
  ok("渲染出详情按钮", !!oBtn);
  const oHost = oel.querySelector("[data-detail-host]");
  ok("存在详情容器(hidden)", oHost && oHost.hidden === true);
  oBtn.dispatchEvent(new offer.window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("点详情后面板显示", oHost.hidden === false);
  ok("面板含客户", oHost.textContent.includes("甲方"));
  ok("面板含状态流转时间线", oHost.textContent.includes("状态流转") && oHost.textContent.includes("进行中"));
  const oClose = oHost.querySelector("[data-detail-close]");
  oClose.dispatchEvent(new offer.window.MouseEvent("click", { bubbles: true }));
  ok("点收起后隐藏", oHost.hidden === true);

  // ---------- 审批 ----------
  console.log("\n--- 3. 审批 detailData / update 状态留痕 / batchSetStatus 留痕 ---");
  const am = makeStore(); const ap = load("approvals.js", { storeCtx: am });
  const az = ap.biz.approvals;
  const aDoc = (await az.create({ subject: "报销差旅", kind: "报销", applicant: "张三", note: "3.2¥" })).doc;

  const u1 = await az.update(aDoc.id, { status: "已通过" });
  ok("update 状态→已通过", u1.ok && az.detailData(u1.doc).status === "已通过");
  ok("update 追加 statusHistory 1 条", az.detailData(u1.doc).history.length === 1);
  const same = await az.update(aDoc.id, { status: "已通过" });
  ok("同状态 update 不追加 history", az.detailData(same.doc).history.length === 1);

  const ad = az.detailData(aDoc);
  ok("detailData 含 subject/applicant/kind", ad.subject === "报销差旅" && ad.applicant === "张三" && ad.kind === "报销");
  const adi = await az.detail(aDoc.id);
  ok("detail(id) ok", adi.data && adi.data.history.length === 1);
  const adx = await az.detail("apr-nope");
  ok("detail 缺失记录报错", adx.error);

  // batchSetStatus 留痕
  const b1 = (await az.create({ subject: "采购电脑", kind: "采购", applicant: "李四" })).doc;
  await az.batchSetStatus([b1.id], "已通过");
  ok("批量通过追加 statusHistory", az.detailData(await am.store.get(b1.id)).history.length === 1);

  // 审批 DOM 详情展开
  console.log("\n--- 4. 审批列表 DOM 详情展开 ---");
  const ael = ap.window.document.createElement("div");
  await az.render(ael);
  const aBtn = ael.querySelector("[data-detail]");
  ok("渲染出详情按钮", !!aBtn);
  const aHost = ael.querySelector("[data-detail-host]");
  aBtn.dispatchEvent(new ap.window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  ok("审批详情面板显示", aHost.hidden === false);
  ok("审批详情含事由与时间线", aHost.textContent.includes("审批详情") && aHost.textContent.indexOf("已通过") >= 0);
  aHost.querySelector("[data-detail-close]").dispatchEvent(new ap.window.MouseEvent("click", { bubbles: true }));
  ok("审批详情收起", aHost.hidden === true);

  const summary = `\n=== 业务板块·详情展开 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });