// 给导入链路加 console.time 埋点
const fs = require("fs");

function safeReplace(path, old, rep, tag) {
  let c = fs.readFileSync(path, "utf8");
  if (!c.includes(old)) { console.log(`❌ ${tag}: not found in ${path}`); return false; }
  c = c.replace(old, rep);
  fs.writeFileSync(path, c);
  console.log(`✅ ${tag}`);
  return true;
}

// shell.js — 导入入口
safeReplace(
  "app/js/shell.js",
  'OS.Tasks.run("导入 " + f.name, async (r) => {',
  'console.time("[IMPORT]"); OS.Tasks.run("导入 " + f.name, async (r) => {',
  "shell.js import 入口"
);

// store.put 调用前
safeReplace(
  "app/js/shell.js",
  'r.step("保存到本地");',
  'console.timeLog("[IMPORT]", "before store.create+put"); r.step("保存到本地");',
  "shell.js step 保存到本地"
);

// store.put 之后
safeReplace(
  "app/js/shell.js",
  "await OS.store.put(doc); openDoc(doc); return;",
  "await OS.store.put(doc); console.timeLog(\"[IMPORT]\", \"after store.put\"); openDoc(doc); console.timeEnd(\"[IMPORT]\"); return;",
  "shell.js store.put 后"
);

// import-ooxml.js — importFile 入口
safeReplace(
  "app/js/import-ooxml.js",
  "async function importFile(file, onProgress) {",
  "async function importFile(file, onProgress) { console.time(\"[IMPORT-OOXML]\");",
  "import-ooxml.js importFile 入口"
);

// parseXmind 前后
safeReplace(
  "app/js/import-ooxml.js",
  "const result = parseXmind(text);",
  "console.timeLog(\"[IMPORT-OOXML]\", \"before parseXmind\"); const result = parseXmind(text); console.timeLog(\"[IMPORT-OOXML]\", \"after parseXmind\");",
  "import-ooxml.js parseXmind 前后"
);

// importFile 末尾
safeReplace(
  "app/js/import-ooxml.js",
  "console.error(\"[OOXML] importFile error:\", e.message); throw e;",
  "console.error(\"[OOXML] importFile error:\", e.message); console.timeEnd(\"[IMPORT-OOXML]\"); throw e;",
  "import-ooxml.js error 末尾"
);

// store.js — openDB
safeReplace(
  "app/js/store.js",
  "function openDB() {",
  "function openDB() { console.time(\"[DB]\");",
  "store.js openDB 入口"
);

// openDB success
safeReplace(
  "app/js/store.js",
  "resolve(e.target.result);",
  "resolve(e.target.result); console.timeEnd(\"[DB]\");",
  "store.js openDB success"
);

// openDB error
safeReplace(
  "app/js/store.js",
  "reject(req.error);",
  "reject(req.error); console.timeEnd(\"[DB]\");",
  "store.js openDB error"
);

// mindmap.js — layoutMap
safeReplace(
  "app/js/modules/mindmap.js",
  "function layoutMap() {",
  "function layoutMap() { console.time(\"[MINDMAP-LAYOUT]\");",
  "mindmap.js layoutMap 入口"
);

// layoutMap 末尾（加 console.timeEnd）
// 找 place(root, 0);
let mm = fs.readFileSync("app/js/modules/mindmap.js", "utf8");
mm = mm.replace("place(root, 0);", "place(root, 0); console.timeEnd(\"[MINDMAP-LAYOUT]\");");
fs.writeFileSync("app/js/modules/mindmap.js", mm);
console.log("✅ mindmap.js layoutMap 末尾");

console.log("\n🎯 埋点完成！打开 Electron → F12 → Console，然后导入 .xmind，会看到各阶段耗时");
