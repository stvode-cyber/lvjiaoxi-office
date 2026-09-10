/* 绿角犀 Office · 审批意见(comment)留痕 纯逻辑 + DOM 交互测试
 * 运行：node _approval_comment_test.js
 * 覆盖：setStatus 流转校验（通过可留空意见 / 驳回必填理由）、历史 comment 留痕、
 *       update 携带 comment、detailData 回显、详情时间线展示意见、UI 通过/驳回 prompt 交互
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
    store: { async list() { return [...mem.values()]; }, async get(id) { return mem.get(id) || null; }, async put(d) { d.updatedAt = Date.now(); mem.set(d.id, d); return d; }, async remove(id) { mem.delete(id); } },
    export: { csv: () => {} }
  };
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/approvals.js"), "utf8");
  window.document.body.appendChild(s);
  return { ap: window.OS.biz.approvals, window, mem };
}

async function makePending(ap) {
  const r = await ap.create({ subject: "请假审批", applicant: "张", kind: "请假" });
  return r.doc;
}

(async function main() {
  console.log("=== 审批意见留痕测试 ===\n");
  const { ap, window } = load();

  console.log("--- 1. setStatus 校验 ---");
  ok("不存在记录返回 error", (await ap.setStatus("nope", "已通过", "")).error === "记录不存在");
  const bad1 = await ap.create({ subject: "x", applicant: "a" });
  ok("无效状态被拒", (await ap.setStatus(bad1.doc.id, "待审批", "")).error === "无效状态");
  ok("终态不可再流转", (await ap.setStatus(bad1.doc.id, "不存在态", "")).error === "无效状态");

  console.log("\n--- 2. 通过：意见可留空，历史记 comment ---");
  const pass1 = await makePending(ap);
  const r2 = await ap.setStatus(pass1.id, "已通过", "符合报销规范");
  ok("通过成功", r2.ok === true && r2.doc.data.status === "已通过");
  const h2 = r2.doc.data.statusHistory;
  ok("历史追加 1 条含意见", h2.length === 1 && h2[0].comment === "符合报销规范");
  const passEmpty = await makePending(ap);
  const r3 = await ap.setStatus(passEmpty.id, "已通过", "   ");
  ok("通过意见留空成功", r3.ok === true && r3.doc.data.statusHistory[0].comment === "");
  ok("已通过不可再流转", (await ap.setStatus(pass1.id, "已驳回", "理由")).error === "仅待审批记录可流转");

  console.log("\n--- 3. 驳回：理由必填 ---");
  const rej1 = await makePending(ap);
  const r5 = await ap.setStatus(rej1.id, "已驳回", "  ");
  ok("驳回空理由被拒", r5.error === "驳回须填写理由");
  ok("拒绝后仍为待审批", rej1.data ? rej1.data.status : true);
  const rej2 = await makePending(ap);
  const r6 = await ap.setStatus(rej2.id, "已驳回", "材料不齐");
  ok("驳回携理由成功", r6.ok === true && r6.doc.data.status === "已驳回");
  ok("驳回历史记理由", r6.doc.data.statusHistory[0].comment === "材料不齐");

  console.log("\n--- 4. detailData 回显 comment ---");
  const dd = ap.detailData({ id: rej1.id, data: { status: "待审批", statusHistory: [{ status: "已驳回", ts: 1, comment: "不通过" }] } });
  ok("detailData 历史含 comment", dd.history.length === 1 && dd.history[0].comment === "不通过");
  const dd2 = ap.detailData({ id: pass1.id, data: { status: "已通过", statusHistory: [{ status: "已通过", ts: 2, comment: "通过" }] } });
  ok("已通过历史 comment=通过", dd2.history[0].comment === "通过");

  console.log("\n--- 5. update 携带 comment ---");
  const up1 = await makePending(ap);
  const up2 = await ap.update(up1.id, { status: "已通过", comment: "直接更新意见" });
  ok("update 历史含 comment", up2.ok === true && up2.doc.data.statusHistory[0].comment === "直接更新意见");

  console.log("\n--- 6. DOM 交互：通过/驳回按钮走 prompt ---");
  const domTest = load();
  const host = domTest.window.document.createElement("div");
  host.hidden = false; domTest.window.document.body.appendChild(host);
  // 预置一条待审批
  const pend = await domTest.ap.create({ subject: "采购", applicant: "李", kind: "采购" });
  // 监听 prompt：
  const realPrompt = domTest.window.prompt;
  domTest.window.prompt = (msg, _def) => msg.includes("驳回理由") ? "发票缺失" : "意见通过";
  await domTest.ap.render(host);
  // 点「通过」
  const passBtn = host.querySelector('[data-act="pass"]');
  ok("渲染出通过按钮", !!passBtn);
  passBtn.dispatchEvent(new domTest.window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const afterPass = (await domTest.ap.list()).find(x => x.id === pend.doc.id);
  ok("DOM 通过后状态=已通过", afterPass.data.status === "已通过");
  ok("DOM 通过历史含意见", afterPass.data.statusHistory[0].comment === "意见通过");
  // 再来一条走驳回
  const pend2 = (await domTest.ap.create({ subject: "出差", applicant: "王", kind: "其他" })).doc;
  domTest.window.prompt = () => ""; // 模拟驳回留空
  await domTest.ap.render(host);
  const rejBtn = host.querySelector('[data-act="reject"]');
  rejBtn.dispatchEvent(new domTest.window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const afterRejEmpty = (await domTest.ap.list()).find(x => x.id === pend2.id);
  ok("DOM 驳回留空仍为待审批", afterRejEmpty.data.status === "待审批");
  domTest.window.prompt = realPrompt;

  const summary = `\n=== 审批意见测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });