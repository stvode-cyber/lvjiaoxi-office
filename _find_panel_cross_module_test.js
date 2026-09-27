/**
 * 跨模块查找替换面板测试
 * 验证 Writer / Spreadsheet / Presentation / MindMap 四模块都导出了 openFindPanel
 */
const assert = require("assert");

// 简易 DOM 桩
const _el = () => ({ appendChild() {}, querySelector() { return null; }, hidden: false, querySelectorAll() { return []; }, style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, focus() {}, addEventListener() {}, scrollIntoView() {}, innerHTML: "", firstChild: null, childNodes: [] });
global.document = { createElement: () => _el(), querySelector() { return null; }, body: { appendChild() {} }, createTreeWalker() { return { nextNode() { return null; } }; }, createRange: () => ({ setStart() {}, setEnd() {}, surroundContents() {}, deleteContents() {}, insertNode() {} }) };
global.window = global;
global.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };

const modules = {};
global.OS = {
  modules,
  icons: { svg() { return "<svg></svg>"; } },
  toast() {},
  util: { uid: () => "test_" + Math.random().toString(36).slice(2, 8) },
  Ribbon: { create() { return { el: { classList: { add() {} } } }; } },
  AI: { createSelToolbar() { return { el: { classList: { add() {} } } }; } },
  theme: { get() { return "light"; } },
  bus: { on() {}, emit() {} },
};

// 四个模块
require("./app/js/modules/spreadsheet.js");
require("./app/js/modules/writer.js");
require("./app/js/modules/presentation.js");
require("./app/js/modules/mindmap.js");

// ---------- 断言开始 ----------
let pass = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else console.error("  ✗ FAIL: " + name);
}

console.log("\n=== 跨模块 openFindPanel 导出测试 ===\n");

// 1. 四个模块都注册了
check("4 个模块全部注册", Object.keys(modules).length === 4);

// 2. 每个模块都有 openFindPanel（Spreadsheet 在 mount 返回值，其余在模块顶层）
const moduleLevel = [
  ["writer", "Writer (contenteditable)"],
  ["presentation", "Presentation (slides)"],
  ["mindmap", "MindMap (SVG nodes)"],
];
for (const [key, label] of moduleLevel) {
  const m = modules[key];
  check(label + " 存在", !!m);
  check(label + ".openFindPanel 是函数", typeof m?.openFindPanel === "function");
}
check("Spreadsheet 存在", !!modules.spreadsheet);
check("Spreadsheet.mount 是函数", typeof modules.spreadsheet?.mount === "function");

// 3. Writer / Presentation / MindMap 调用不崩（DOM 桩无 scope，toast 不抛）
for (const [key, label] of [["writer","Writer"], ["presentation","Presentation"], ["mindmap","MindMap"]]) {
  let threw = false;
  try { modules[key].openFindPanel("find"); } catch(e) { threw = true; }
  check(label + " openFindPanel('find') 不崩（无 scope 时 toast 提示）", !threw);
  try { modules[key].openFindPanel("replace"); } catch(e) { threw = true; }
  check(label + " openFindPanel('replace') 不崩", !threw);
}

// ---------- 汇总 ----------
console.log("\n=== 跨模块查找测试: " + pass + "/" + total + " passed ===\n");
if (pass !== total) { console.error("有测试失败！"); process.exit(1); }
