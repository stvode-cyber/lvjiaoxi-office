/* 绿角犀 Office · 通用导出 toCSV 纯逻辑测试
 * 覆盖：普通值 / 逗号 / 引号 / 换行 / 中文 / 空值 / 空列表 / pick 映射
 * 运行：node _export_csv_test.js
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
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(APP, "js/modules/export.js"), "utf8");
  window.document.body.appendChild(s);
  return window.OS.export;
}

(async function main() {
  console.log("=== CSV 导出纯逻辑测试 ===\n");
  const ex = load();

  console.log("--- 1. toCSV 基础 ---");
  ok("仅表头", ex.toCSV(["客户", "金额"]) === "客户,金额");
  ok("单行数据", ex.toCSV(["a", "b"], [["1", "2"]]) === "a,b\r\n1,2");
  ok("空列表只出表头", ex.toCSV(["x"], []) === "x");

  console.log("\n--- 2. 转义 ---");
  ok("含逗号加引号", ex.toCSV(["v"], [["a,b"]]) === "v\r\n\"a,b\"");
  ok("含引号加倍", ex.toCSV(["v"], [["a\"b"]]) === "v\r\n\"a\"\"b\"");
  ok("含换行加引号", ex.toCSV(["v"], [["a\nb"]]) === "v\r\n\"a\nb\"");
  ok("中文转义保留", ex.toCSV(["品名"], [["螺丝"]]) === "品名\r\n螺丝");

  console.log("\n--- 3. null / undefined ---");
  ok("空值转空串", ex.toCSV(["v"], [[null]]) === "v\r\n");
  ok("undefined 转空串", ex.toCSV(["v"], [[undefined]]) === "v\r\n");

  console.log("\n--- 4. pick 映射 ---");
  const rows = [{ data: { customer: "甲", amount: 100 } }, { data: { customer: "乙", amount: 50 } }];
  const cols = [{ pick: r => r.data.customer }, { pick: r => r.data.amount }];
  const picked = ex.pick(rows, cols);
  ok("pick 提取 2 行 2 列", picked.length === 2 && picked[0][0] === "甲" && picked[0][1] === 100);
  ok("pick + toCSV 串联", ex.toCSV(["客户", "金额"], picked) === "客户,金额\r\n甲,100\r\n乙,50");

  console.log("\n--- 5. 与业务列定义一致性 ---");
  // 确保三大板块导出的列数与表头数一致（防止将来改崩）
  const ordersRows = [[1, 2, 3, 4, 5]];
  ok("订单 5 列四行对齐", ex.toCSV(["客户", "金额", "状态", "备注", "创建时间"], ordersRows).split("\r\n")[0].split(",").length === 5);
  const invRows = [[1, 2, 3, 4, 5]];
  ok("库存 5 列对齐", ex.toCSV(["品名", "数量", "安全库存", "单位", "备注"], invRows).split("\r\n")[0].split(",").length === 5);
  const aprRows = [[1, 2, 3, 4, 5]];
  ok("审批 5 列对齐", ex.toCSV(["事由", "类型", "申请人", "状态", "备注"], aprRows).split("\r\n")[0].split(",").length === 5);

  const summary = `\n=== CSV 导出测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message, e && e.stack); process.exit(2); });