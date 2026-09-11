const fs = require("fs");
const path = require("path");

const pdfDir = path.join(process.env.TEMP, "绿角犀PDF_unrar", "绿角犀PDF");
const appJsPath = path.join(pdfDir, "www", "assets", "app.js");
const stylePath = path.join(pdfDir, "www", "assets", "style.css");

console.log("=== PDF 项目文件大小 ===");
[appJsPath, stylePath].forEach(p => {
  console.log("  " + path.basename(p) + ": " + fs.statSync(p).size + " bytes");
});

const c = fs.readFileSync(appJsPath, "utf8");

// 提取 CATEGORIES
const catMatch = c.match(/const CATEGORIES\s*=\s*(\[[\s\S]*?\])/);
if (catMatch) {
  console.log("\n=== CATEGORIES ===");
  try {
    const cats = eval(catMatch[1]);
    cats.forEach(c => {
      console.log("  " + c.key + ": " + c.title + " -> [" + c.tools.length + " tools]");
    });
  } catch(e) { console.log("CATEGORIES parse error:", e.message); }
}

// 提取 OPS 所有 key:title:desc
const opsMatch = c.match(/const OPS\s*=\s*\{([\s\S]*?)\n\}/);
if (opsMatch) {
  const opsStr = opsMatch[1];
  // 更简单：逐行找
  const lines = opsStr.split("\n");
  console.log("\n=== OPS (前 500 行) ===");
  let cur = null;
  let count = 0;
  lines.slice(0, 500).forEach(line => {
    const m = line.match(/^\s{2}(\w+):\s*\{/);
    if (m) cur = m[1];
    const t = line.match(/title:\s*'([^']+)'/);
    const d = line.match(/desc:\s*'([^']+)'/);
    if (cur && (t || d)) {
      if (!eval(cur)) eval(cur + " = {}");
      if (t) eval(cur + ".title = " + JSON.stringify(t[1]));
      if (d) eval(cur + ".desc = " + JSON.stringify(d[1]));
    }
  });
  // 不行，直接正则
  const all = opsStr.match(/^\s{2}(\w+):[^\n]*\n([\s\S]*?)(?=^\s{2}\w+:|^\})/gm) || [];
  console.log("\n=== OPS 工具列表 ===");
  all.forEach(block => {
    const km = block.match(/^\s{2}(\w+):/);
    const tm = block.match(/title:\s*'([^']+)'/);
    const dm = block.match(/desc:\s*'([^']+)'/);
    if (km) {
      const k = km[1];
      const t = tm ? tm[1] : "?";
      const d = dm ? dm[1] : "";
      count++;
      console.log("  " + count + ". " + k.padEnd(14) + t + " — " + d);
    }
  });
}

// 看 PDF 项目 HTML 结构 — 关键 DOM id
console.log("\n=== PDF 项目关键 DOM id ===");
const htmlPath = path.join(pdfDir, "www", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const ids = html.match(/id="([^"]+)"/g) || [];
ids.forEach(i => console.log("  " + i));

// CSS 类名前缀汇总
console.log("\n=== CSS 主要类名 ===");
const css = fs.readFileSync(stylePath, "utf8");
const classes = css.match(/\.([a-z][a-z0-9-]+)\s*\{/g) || [];
const seen = new Set();
classes.forEach(c => {
  const n = c.replace(/[.{\s]/g, "");
  if (!seen.has(n)) { seen.add(n); console.log("  ." + n); }
});
