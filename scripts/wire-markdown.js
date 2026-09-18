const fs = require("fs");

// 1. index.html — 加 markdown.js script
let html = fs.readFileSync("app/index.html", "utf8");
if (!html.includes("js/modules/markdown.js")) {
  const marker = '<script src="js/modules/mindmap.js"></script>';
  const insert = marker + '\n    <script src="js/modules/markdown.js"></script>';
  html = html.replace(marker, insert);
  fs.writeFileSync("app/index.html", html);
  console.log("✅ index.html 加了 markdown.js");
} else {
  console.log("ℹ️ markdown.js 已存在");
}

// 2. shell.js — txt/md 分开路由
let sh = fs.readFileSync("app/js/shell.js", "utf8");
const oldTxtMd = 'if (ext === "txt" || ext === "md") {';
const newTxt = 'if (ext === "txt") {';
if (sh.includes(oldTxtMd)) {
  sh = sh.replace(oldTxtMd, newTxt);
  // 在 txt 块结束之后加 md 块
  const txtEndPattern = /(doc\.data = \{ html: `.*?<h1>.*?<\/h1>` \+ html \}; await OS\.store\.put\(doc\); openDoc\(doc\); return;\n      })/;
  const m = sh.match(txtEndPattern);
  if (m && !sh.includes('ext === "md"')) {
    const mdBlock = `
      }
      if (ext === "md") {
        const mdTxt = await OS.util.readFile(f, false);
        const doc = await OS.store.create({ type: "markdown", name: f.name });
        doc.data = { mode: "split", source: mdTxt, html: "" }; await OS.store.put(doc); openDoc(doc); return;`;
    sh = sh.replace(txtEndPattern, m[1] + mdBlock);
    fs.writeFileSync("app/js/shell.js", sh);
    console.log("✅ shell.js: txt/md 分开，md → markdown 模块");
  } else {
    console.log("❌ txt block end pattern not matched, or md already handled");
  }
} else {
  console.log("ℹ️ txt/md already separated or pattern changed");
}

// 3. 验证语法
try {
  new Function(fs.readFileSync("app/js/modules/markdown.js", "utf8"));
  console.log("✅ markdown.js syntax OK");
} catch (e) {
  console.error("❌ markdown.js syntax:", e.message);
}
try {
  new Function(fs.readFileSync("app/js/shell.js", "utf8"));
  console.log("✅ shell.js syntax OK");
} catch (e) {
  console.error("❌ shell.js syntax:", e.message);
}

// 4. 跑测试
const { execSync } = require("child_process");
try {
  const r = execSync("node scripts/run-tests.js", { encoding: "utf8" });
  const match = r.match(/套件结果:.*(\d+ passed.*)/);
  console.log(match ? "✅ " + match[0] : r.slice(-200));
} catch (e) {
  console.error("❌ test error:", e.stdout?.slice(-200));
}
