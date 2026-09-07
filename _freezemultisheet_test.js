/* 绿角犀 Office · 表格冻结窗格 & 多工作表 jsdom 联调测试 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const APP = "D:/源码存档/绿角犀办公软件/app";

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () {
  return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, closePath() {} };
};

function makeZipStub() { const files = {}; const zip = { file(n, c) { files[n] = c; return zip; }, folder() { return zip; }, generateAsync() { return Promise.resolve({ _files: files }); } }; return zip; }
window.JSZip = function () { return makeZipStub(); };

const OS = {};
OS.Ribbon = { create() { return { el: window.document.createElement("div"), activate() {}, tabs: [], getTab() { return null; } }; } };
let downloads = [];
OS.toast = () => {};
OS.util = {
  uid: p => (p || "id") + Math.random().toString(36).slice(2, 8),
  debounce: f => f, escapeHtml: s => String(s == null ? "" : s), fmtTime: t => new Date(t).toLocaleString(),
  download(b, n) { downloads.push({ blob: b, name: n }); }, readFile: () => Promise.resolve("")
};
OS.AI = { createSelToolbar() { return { destroy() {} }; }, safeRect() { return {}; }, local: { critique: t => t } };
OS.icons = { svg: () => "<svg></svg>" };
OS.blankDoc = t => ({ type: t, data: {} });
window.OS = OS;

const code = fs.readFileSync(path.join(APP, "js/modules/spreadsheet.js"), "utf8");
const s = window.document.createElement("script"); s.textContent = code; window.document.body.appendChild(s);
const exCode = fs.readFileSync(path.join(APP, "js/export-ooxml.js"), "utf8");
const s2 = window.document.createElement("script"); s2.textContent = exCode; window.document.body.appendChild(s2);

const mod = window.OS.modules.spreadsheet;
const host = window.document.createElement("div"); window.document.body.appendChild(host);
const ctx = { markDirty() {}, openBackstage() {} };

// 旧版单表文档（无 sheets 字段）
function legacyDoc() {
  return {
    name: "T", type: "spreadsheet",
    data: {
      rows: 20, cols: 5,
      cells: { A1: { v: "名称" }, B1: { v: "数值" }, A2: { v: "香蕉" }, B2: { v: 30 }, A3: { v: "苹果" }, B3: { v: 10 } },
      styles: {}, charts: [], condFormats: [], filters: []
    }
  };
}

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

const inst = mod.mount(host, legacyDoc(), ctx);

// 1) 旧版文档归一化为单工作表，单元格迁移
const ser0 = inst.serialize();
ok("legacy 文档归一化为单工作表", ser0.sheets && ser0.sheets.length === 1 && inst.sheetNames()[0] === "Sheet1");
ok("legacy 单元格迁移到 sheets[0]", ser0.sheets[0].cells.B2 && ser0.sheets[0].cells.B2.v === 30 && ser0.sheets[0].cells.A3.v === "苹果");
ok("默认冻结为 {row:0,col:0}", JSON.stringify(inst.freeze()) === JSON.stringify({ row: 0, col: 0 }));

// 2) 新增工作表并自动激活
const newIdx = inst.addSheet();
ok("addSheet 返回新下标 1", newIdx === 1);
ok("addSheet 后共 2 个工作表", inst.sheets().length === 2);
ok("addSheet 后激活第 2 个", inst.activeSheet() === 1);
ok("sheet-tab DOM 渲染 2 个", host.querySelectorAll(".sheet-tab").length === 2);
ok("激活的 tab 带 on 类", host.querySelectorAll(".sheet-tab.on").length === 1);

// 3) 在第二个工作表写入数据，切换回第 1 个，数据互不干扰
inst.commit("A1", "Sheet2Data");
inst.switchSheet(0);
const serSwitch = inst.serialize();
ok("切换后 sheet2 数据保留", serSwitch.sheets[1].cells.A1 && serSwitch.sheets[1].cells.A1.v === "Sheet2Data");
ok("切换后 sheet1 数据未受影响", serSwitch.sheets[0].cells.B2 && serSwitch.sheets[0].cells.B2.v === 30);

// 4) 删除工作表（删除当前激活的 sheet1->下标0）并重绑别名
const removed = inst.removeSheet(0);
ok("removeSheet 返回 true", removed === true);
ok("删除后剩 1 个工作表", inst.sheets().length === 1);
ok("删除后激活下标归 0", inst.activeSheet() === 0);
ok("删除后 sheet-tab 仅 1 个", host.querySelectorAll(".sheet-tab").length === 1);
ok("删除后留下的工作表含 Sheet2Data", inst.serialize().sheets[0].cells.A1 && inst.serialize().sheets[0].cells.A1.v === "Sheet2Data");

// 5) 不能删除最后一个工作表
const removeLast = inst.removeSheet(0);
ok("不能删除最后一个工作表", removeLast === false && inst.sheets().length === 1);

// 6) 重命名工作表
inst.renameSheet(0, "财务");
ok("renameSheet 生效", inst.sheetNames()[0] === "财务");
ok("tab DOM 文本更新", Array.prototype.some.call(host.querySelectorAll(".sheet-tab-name"), e => e.textContent === "财务"));

// 7) 冻结首行
inst.setFreeze(1, 0);
ok("setFreeze(1,0) 记录冻结", JSON.stringify(inst.freeze()) === JSON.stringify({ row: 1, col: 0 }));
const a1 = host.querySelector('td[data-ref="A1"]');
ok("冻结首行：A1 行单元格 sticky", a1 && a1.style.position === "sticky");
ok("冻结首行：A1 带 frozen 类", a1 && a1.classList.contains("frozen"));

// 8) 冻结首列
inst.setFreeze(0, 1);
const a1c = host.querySelector('td[data-ref="A1"]');
ok("冻结首列：A1 列单元格 sticky", a1c && a1c.style.position === "sticky" && a1c.style.left === "0px");
ok("冻结首列：A1 带 frozen 类", a1c && a1c.classList.contains("frozen"));

// 9) 冻结窗格（行列都冻），交叉点 zIndex=4
inst.setFreeze(1, 1);
const a1b = host.querySelector('td[data-ref="A1"]');
ok("冻结窗格：交叉点 zIndex=4", a1b && a1b.style.zIndex === "4");
ok("冻结窗格：A1 同时有 top 与 left", a1b && !!a1b.style.top && !!a1b.style.left);

// 10) 取消冻结清除样式 & 序列化持久化
inst.setFreeze(0, 0);
const a1x = host.querySelector('td[data-ref="A1"]');
ok("取消冻结：清除 position", a1x && a1x.style.position === "");
ok("取消冻结：移除 frozen 类", a1x && !a1x.classList.contains("frozen"));
ok("freeze 持久化进序列化", JSON.stringify(inst.serialize().freeze) === JSON.stringify({ row: 0, col: 0 }));

// 11) 多工作表 XLSX 导出
(async () => {
  const doc = {
    type: "spreadsheet", name: "多表",
    data: {
      activeSheet: 0, freeze: { row: 0, col: 0 },
      sheets: [
        { name: "产品销售", rows: 20, cols: 5, cells: { A1: { v: "产品" }, B1: { v: "销量" }, A2: { v: "甲" }, B2: { v: 5 } }, styles: {}, charts: [], condFormats: [], filters: [] },
        { name: "人员", rows: 20, cols: 5, cells: { A1: { v: "姓名" }, B1: { v: "工号" }, A2: { v: "张三" }, B2: { v: "E01" } }, styles: {}, charts: [], condFormats: [], filters: [] }
      ]
    }
  };
  downloads = [];
  await window.OS.Exporter.exportDoc(doc, "xlsx");
  ok("xlsx 下载触发", downloads.length === 1);
  const files = downloads[0].blob._files;
  ok("含 xl/worksheets/sheet1.xml", !!files["xl/worksheets/sheet1.xml"]);
  ok("含 xl/worksheets/sheet2.xml", !!files["xl/worksheets/sheet2.xml"]);
  ok("workbook 列出两个工作表", !!files["xl/workbook.xml"] && files["xl/workbook.xml"].indexOf('name="产品销售"') !== -1 && files["xl/workbook.xml"].indexOf('name="人员"') !== -1);
  ok("workbook rels 含两个 worksheet", !!files["xl/_rels/workbook.xml.rels"] && files["xl/_rels/workbook.xml.rels"].indexOf("worksheets/sheet1.xml") !== -1 && files["xl/_rels/workbook.xml.rels"].indexOf("worksheets/sheet2.xml") !== -1);
  ok("Content_Types 含两个 sheet override", !!files["[Content_Types].xml"] && files["[Content_Types].xml"].indexOf("/xl/worksheets/sheet1.xml") !== -1 && files["[Content_Types].xml"].indexOf("/xl/worksheets/sheet2.xml") !== -1);
  ok("两个工作表字符串都进共享字典", !!files["xl/sharedStrings.xml"] && files["xl/sharedStrings.xml"].indexOf("甲") !== -1 && files["xl/sharedStrings.xml"].indexOf("张三") !== -1);

  const summary = `FREEZE-MULTISHEET TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
  fs.writeFileSync(path.join(APP, "..", "_freezemultisheet_result.txt"), summary);
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERROR", e && e.message); console.log(e && e.stack); process.exit(2); });
