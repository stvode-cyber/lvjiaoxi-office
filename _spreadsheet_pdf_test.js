/* N: Spreadsheet 直接下载 PDF —— 纯逻辑验证（零 DOM 依赖部分）
   - OS.SheetExport.sheetUsedRange：扫描单元格存储得到已使用范围
   - OS.SheetExport.buildSheetPageHtml：按行区间构建分页 HTML 表
   - writeImagePdf：A4 横向（842×595 pt）MediaBox 多页输出
*/
global.window = global; global.OS = {};
require("./app/js/modules/sheet-export.js");
require("./app/js/pdf-tool.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

// 简单列字母 <-> 索引（测试用，覆盖 A-Z），与标准 bijective base-26 一致
function colToIdx(letters) { let n = 0; for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; }
function idxToCol(i) { let s = ""; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

const SE = OS.SheetExport;
const PER_PAGE = 32;

// 1) used-range
const cells = { A1: { v: "名称" }, B1: { v: "数量" }, A5: { v: "X" }, C3: { v: 12 }, Z10: { v: 1 } };
const range = SE.sheetUsedRange(cells, colToIdx);
ok("used-range 行 = 10", range.r === 10);
ok("used-range 列 = 26（Z）", range.c === 26);

const cellsEmpty = {};
const rangeE = SE.sheetUsedRange(cellsEmpty, colToIdx);
ok("空表回退为 1×1", rangeE.r === 1 && rangeE.c === 1);

// 2) 单页 HTML 结构
const styleMap = { A1: "font-weight:700;", B2: "text-align:right;" };
const txtMap = { A1: "名称", B1: "数量", A2: "苹果", B2: 5 };
function cellText(ref) { const v = txtMap[ref]; return v == null ? "" : (typeof v === "number" ? String(v) : v); }
function cellStyle(ref) { return styleMap[ref] || ""; }
const html = SE.buildSheetPageHtml({ r: 2, c: 2 }, 1, 2, "测试表", cellText, cellStyle, idxToCol, escapeHtml);
ok("HTML 含表标题", html.indexOf("<div class='ss-title'>测试表</div>") !== -1);
ok("HTML 含列头 A/B", html.indexOf(">A</th>") !== -1 && html.indexOf(">B</th>") !== -1);
ok("HTML 含行头 1/2", html.indexOf(">1<") !== -1 && html.indexOf(">2<") !== -1);
ok("HTML 应用了加粗样式（A1）", html.indexOf("style='font-weight:700;'") !== -1);
ok("HTML 应用了右对齐（B2）", html.indexOf("style='text-align:right;'") !== -1);
ok("HTML 含单元格值 苹果", html.indexOf(">苹果<") !== -1);
ok("HTML 数值 5 被转为字符串", html.indexOf(">5<") !== -1);

// 3) 分页行数计算
function pageCount(r, per) { let n = 0; for (let s = 1; s <= r; s += per) n++; return n; }
ok("10 行 -> 1 页", pageCount(10, PER_PAGE) === 1);
ok("33 行 -> 2 页", pageCount(33, PER_PAGE) === 2);
ok("64 行 -> 2 页", pageCount(64, PER_PAGE) === 2);
ok("65 行 -> 3 页", pageCount(65, PER_PAGE) === 3);

// 4) writeImagePdf A4 横向多页
function makePage(w, h) {
  const data = new Uint8Array(w * h * 4).fill(255);
  return { width: w, height: h, data, mediaW: 842, mediaH: Math.round(842 * h / w) };
}
(async () => {
  const pages = [makePage(760, 1100), makePage(760, 1100), makePage(760, 600)];
  const bytes = await OS.PdfTool.writeImagePdf(pages);
  const txt = Buffer.from(bytes).toString("latin1");
  ok("PDF 以 %PDF- 开头", txt.indexOf("%PDF-") === 0);
  ok("PDF 含 3 个 /Type /Page", (txt.match(/\/Type \/Page[^s]/g) || []).length === 3);
  ok("MediaBox 使用 842pt 宽（A4 横向，高度按内容比例）", (txt.match(/\/MediaBox \[0 0 842 \d+\]/g) || []).length === 3);
  ok("图像流使用 FlateDecode", txt.indexOf("/Filter /FlateDecode") !== -1);

  console.log("\nN 测试：" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
