const fs = require("fs");

console.log("==== 绿角犀 Office · 完整体检 ====\n");

// 模块清单
const mods = fs.readdirSync("app/js/modules").filter((f) => f.endsWith(".js")).sort();
console.log(`📦 模块 (${mods.length} 个):`);
mods.forEach((m) => console.log(`   ${m}`));

// OS 暴露项
const util = fs.readFileSync("app/js/util.js", "utf8");
const shell = fs.readFileSync("app/js/shell.js", "utf8");
const keys = new Set();
[util, shell].forEach((c) => {
  const m = c.match(/OS\.(\w+)\s*=/g);
  if (m) m.forEach((x) => keys.add(x));
});
console.log(`\n🧩 OS 暴露: ${[...keys].join(", ")}`);

// 快捷键
const kd = shell.match(/keydown/g);
const mods2 = shell.match(/OS\.modules\.\w+ =/g);
console.log(`\n⌨️ keydown 引用: ${(kd || []).length} 次`);
console.log(`📚 OS.modules 注册: ${(mods2 || []).length} 个`);

// 支持格式
const sh = fs.readFileSync("app/js/shell.js", "utf8");
const fm = sh.match(/SUPPORTED = \[([^\]]+)\]/);
console.log(`\n📄 支持导入: ${fm ? fm[1].replace(/"/g, "").replace(/'/g, "").trim() : "?"}`);

// 导出
const ex = fs.readFileSync("app/js/export-ooxml.js", "utf8");
const exM = ex.match(/function \w+Export|exporters?\s*=|\.exportAs\w+\s*=\s*function/g);
console.log(`\n📤 导出函数: ${(exM || []).length} 处`);

// AI 能力
const ai = fs.readFileSync("app/js/ai.js", "utf8");
const aiFns = ai.match(/local\.(\w+)\s*=\s*function/g);
console.log(`\n🤖 AI.local 能力: ${(aiFns || []).map((x) => x.replace("local.", "").replace(" = function", "")).join(", ")}`);

// PDF 能力
const pdfMods = mods.filter((m) => m.startsWith("pdf-") || m === "pdf.js");
console.log(`\n📕 PDF 模块: ${pdfMods.length} 个 → ${pdfMods.join(", ")}`);

// 版本/更新/云同步
const hasUpdater = fs.existsSync("app/js/updater.js");
const hasCloudsync = fs.existsSync("app/js/cloudsync.js");
console.log(`\n🔄 updater.js: ${hasUpdater ? "✅" : "❌"}  cloudsync.js: ${hasCloudsync ? "✅" : "❌"}`);

// 组件/模板/主题
const hasTheme = util.includes('theme');
const hasTemplates = fs.existsSync("app/js/templates.js");
console.log(`\n🎨 主题: ${hasTheme ? "✅" : "❌"}  模板: ${hasTemplates ? "✅" : "❌"}`);

console.log("\n==== 体检结束 ====");
