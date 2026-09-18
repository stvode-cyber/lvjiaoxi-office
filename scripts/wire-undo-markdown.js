const fs = require("fs");

// markdown.js — 用 textarea 原生 undo 栈（和 writer 的 execCommand 方案一样）
let m = fs.readFileSync("app/js/modules/markdown.js", "utf8");
const mountIdx = m.indexOf("function mount(host, doc, ctx) {");
if (mountIdx < 0) { console.log("❌ mount not found"); process.exit(1); }
const lineEnd = m.indexOf("\n", mountIdx);
const inject = `

    // Undo/Redo：用 textarea 原生栈 + 暴露给 OS.Undo
    function undo() { try { document.execCommand("undo"); } catch (e) {} return true; }
    function redo() { try { document.execCommand("redo"); } catch (e) {} return true; }
`;
m = m.slice(0, lineEnd + 1) + inject + m.slice(lineEnd + 1);

// 在 return 对象里暴露
m = m.replace(
  "      saveNow,\n      toMarkdown,\n      toHtml,",
  "      saveNow,\n      toMarkdown,\n      toHtml,\n      undo,\n      redo,\n      canUndo: () => true,\n      canRedo: () => true,"
);

fs.writeFileSync("app/js/modules/markdown.js", m);
console.log("✅ markdown.js undo/redo");

// 验证语法
try { new Function(fs.readFileSync("app/js/modules/markdown.js", "utf8")); console.log("✅ syntax OK"); }
catch (e) { console.error("❌ syntax:", e.message); }

// pdf.js — 纯只读渲染，没有 mutation，给 no-op stub
let p = fs.readFileSync("app/js/modules/pdf.js", "utf8");
const retMatch = p.match(/return \{[\s\S]*?destroy\(\) \{ wrap\.remove\(\); \}\s*\};/);
if (retMatch) {
  const old = retMatch[0];
  const rep = old.replace(
    "destroy() { wrap.remove(); }",
    "destroy() { wrap.remove(); },\n      undo() { return false; }, redo() { return false; }, canUndo() { return false; }, canRedo() { return false; }"
  );
  p = p.replace(old, rep);
  fs.writeFileSync("app/js/modules/pdf.js", p);
  console.log("✅ pdf.js undo stubs");
} else {
  console.log("ℹ️ pdf.js return pattern not matched, pdf 只读不需要 undo 其实");
}

try { new Function(fs.readFileSync("app/js/modules/pdf.js", "utf8")); console.log("✅ pdf syntax OK"); }
catch (e) { console.error("❌ pdf:", e.message); }
