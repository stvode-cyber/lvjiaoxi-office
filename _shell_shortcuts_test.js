/**
 * 全局快捷键矩阵测试
 * 验证 shell.js 拦截的所有 Ctrl/Alt 组合键路由到正确函数
 */
const fs = require("fs");
const src = fs.readFileSync("app/js/shell.js", "utf8");

let pass = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) { pass++; console.log("  ✓ " + name); }
  else console.error("  ✗ FAIL: " + name);
}

console.log("\n=== 全局快捷键矩阵测试 ===\n");

// 1. 原有快捷键（已实现且不动）
const existing = [
  ["Ctrl+K", 'k === "k"', "openCmd"],
  ["Ctrl+S", 'k === "s"', "saveNow"],
  ["Ctrl+E", 'k === "e"', "showExportMenu"],
  ["Ctrl+Shift+H", 'k === "h" && e.shiftKey', "goHome"],
  ["Ctrl+H", 'k === "h" && !e.shiftKey', "openReplace"],
  ["Ctrl+F", '!e.shiftKey && k === "f"', "openFindPanel/openSearch"],
  ["Ctrl+Shift+F", 'k === "f"', "openSearch"],
  ["Ctrl+Z", '!e.shiftKey && k === "z"', "OS.Undo.undo"],
  ["Ctrl+Y", 'k === "y"', "OS.Undo.redo"],
  ["Ctrl+Shift+A", 'k === "a"', "openAI"],
  ["Alt+T", 'k === "t"', "OS.Tasks.togglePanel"],
  ["Ctrl+Shift+M", 'k === "m"', "addComment"],
  ["Escape", 'e.key === "Escape"', "closeOverlays"],
];
for (const [name, kp, target] of existing) {
  check("原有快捷键 " + name + " → " + target + " 仍在", src.includes(kp));
}

// 2. 新增快捷键（Ctrl+Tab/N/O/W/P/Shift+T/Q/R + F1/F5）
const added = [
  ["Ctrl+Tab", '_tabSwitcher', "_tswOpen"],
  ["Ctrl+Shift+T", 'reopenRecentlyClosed', 'reopenRecentlyClosed()'],
  ["Ctrl+N", '!e.shiftKey && k === "n"', 'newDoc("writer")'],
  ["Ctrl+O", 'k === "o"', '#file-input'],
  ["Ctrl+W", '!e.shiftKey && k === "w"', "closeTab"],
  ["Ctrl+P", 'k === "p"', 'exportAs("pdf")'],
  ["Ctrl+Q", 'k === "q"', '"app:quit"'],
  ["Ctrl+R", 'k === "r"', '"app:reload"'],
  ["F1", 'k === "f1"', "showAbout()"],
  ["F5", 'k === "f5"', '"app:reload"'],
];
for (const [name, kp, target] of added) {
  check("新增快捷键 " + name + " 已注册", src.includes(kp));
  check("新增快捷键 " + name + " 路由到 " + target, src.includes(target));
}

// 3. 函数依赖存在性检查
check("newDoc 函数存在", src.includes("function newDoc(") || src.includes("newDoc ="));
check("closeTab 函数存在", src.includes("function closeTab("));
check("saveNow 函数存在", src.includes("function saveNow("));
check("activeTab 函数存在", src.includes("function activeTab("));
check("closeBackstage 函数存在", src.includes("closeBackstage"));
check("showExportMenu 函数存在", src.includes("function showExportMenu("));

// ---------- 汇总 ----------
console.log("\n=== 快捷键矩阵: " + pass + "/" + total + " passed ===\n");
if (pass !== total) { console.error("有测试失败！"); process.exit(1); }

