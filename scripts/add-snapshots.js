const fs = require("fs");
let c = fs.readFileSync("app/js/modules/mindmap.js", "utf8");

// 在 mindmap mount 里的 mutation 函数开头加 _snapshot()
// 策略：找这些 marker 行，在它们之前加 _snapshot()
// marker 1: data.nodes.push / data.nodes.filter / data.nodes = / data.edges.push / data.edges.filter / data.edges =
//   但只在 mount 内部（纯逻辑函数如 _buildTree 不要）
// marker 2: layoutMap(); render(); syncSide(); ctx.markDirty(); 序列 → 这是 mutation 完了，不是开头

// 最简单方式：找 addNode/deleteNode/connectNodes/loadExample/loadAIOutline/clearAll/reset/addBranch 等函数开头
// 先看有哪些函数
const funcs = c.match(/function\s+(\w+)\s*\(/g) || [];
console.log("Functions found:", funcs.map((f) => f.replace("function ", "").replace("(", "")));

// 用更精确的方式：找关键 mutation 语句
// 策略：在 "push/pop/splice/filter/=" 这类 data.nodes/data.edges 操作行 **之前** 加 _snapshot()
// 但要小心只加在 mount 闭包内，别加在纯逻辑导出函数里

// 我选择用 regex 匹配具体场景：
// "function addNode" / "function deleteNode" / "function connectNodes" / "function loadExample" /
// "function loadAIOutline" / "function clearAll" / "function reset" / "function addBranch"
// 在这些函数的 { 之后第一行加 _snapshot()

const targets = [
  /function\s+(addNode|deleteNode|connectNodes|loadExample|loadAIOutline|clearAll|reset|addBranch|editNode|deleteSel|toggleBranch)\s*\([^)]*\)\s*\{/g,
];

let added = 0;
for (const re of targets) {
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(c)) !== null) {
    const start = c.indexOf("{", m.index) + 1;
    // 在 { 之后插入 _snapshot();
    const before = c.slice(0, start);
    const after = c.slice(start);
    if (!after.startsWith("\n    _snapshot()")) {
      c = before + "\n    _snapshot();" + after;
      added++;
    }
  }
}
console.log(`✅ 函数开头加 _snapshot(): ${added} 处`);

fs.writeFileSync("app/js/modules/mindmap.js", c);
try {
  new Function(c);
  console.log("✅ syntax OK");
} catch (e) {
  console.error("❌ syntax:", e.message);
}
