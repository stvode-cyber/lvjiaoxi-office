// 修 Timer already exists + 加 try-catch 捕获完整堆栈
const fs = require("fs");

// 1. store.js — 修 Timer 重复 time 问题（改用标志位而非 console.time 名）
let s = fs.readFileSync("app/js/store.js", "utf8");
s = s.replace(
  "function openDB() { console.time(\"[DB]\");",
  "let __dbTimed = false; function openDB() { if(!__dbTimed){console.time(\"[DB]\");__dbTimed=true;}"
);
s = s.replace(
  'resolve(e.target.result); console.timeEnd("[DB]");',
  "resolve(e.target.result); if(__dbTimed){console.timeEnd(\"[DB]\");__dbTimed=false;}"
);
s = s.replace(
  'reject(req.error); console.timeEnd("[DB]");',
  "reject(req.error); if(__dbTimed){console.timeEnd(\"[DB]\");__dbTimed=false;}"
);
fs.writeFileSync("app/js/store.js", s);
console.log("✅ store.js: Timer 重复 time 修复");

// 2. shell.js — 给整个导入分支加 try-catch 包裹 + 完整堆栈
let sh = fs.readFileSync("app/js/shell.js", "utf8");
// 在 r.step("保存到本地") 那行前后加 try-catch
const oldBlock = `console.timeLog("[IMPORT]", "before store.create+put"); r.step("保存到本地");
          const doc = await OS.store.create({ type: r2.type, name: f.name.replace(/\\.[^.]+$/i, "") });
          doc.data = r2.data; doc.compat = r2.compat || "B";
          await OS.store.put(doc); openDoc(doc);
          if (r2.note) OS.toast(r2.note, "ok");
          return;`;
const newBlock = `console.timeLog("[IMPORT]", "before store.create+put");
          try {
            r.step("保存到本地");
            console.log("[IMPORT] creating doc, r2.type=", r2.type);
            const doc = await OS.store.create({ type: r2.type, name: f.name.replace(/\\.[^.]+$/i, "") });
            console.log("[IMPORT] created, data keys:", Object.keys(doc.data||{}).length);
            doc.data = r2.data; doc.compat = r2.compat || "B";
            console.log("[IMPORT] calling store.put...");
            await OS.store.put(doc);
            console.timeLog("[IMPORT]", "after store.put, calling openDoc...");
            openDoc(doc);
            console.timeEnd("[IMPORT]");
            if (r2.note) OS.toast(r2.note, "ok");
            return;
          } catch(e) {
            console.error("[IMPORT] FATAL at save/open stage:", e.message);
            console.error(e.stack);
            OS.toast("保存/打开失败：" + e.message, "err");
            return;
          }`;
if (sh.includes(oldBlock)) {
  sh = sh.replace(oldBlock, newBlock);
  console.log("✅ shell.js: 加了 try-catch + 详细日志");
} else {
  console.log("❌ old block not found, 尝试搜索...");
  // 直接加在 r2 后面
  const old2 = `if (r2) {
          console.timeLog("[IMPORT]", "before store.create+put"); r.step("保存到本地");`;
  const new2 = `if (r2) {
          console.timeLog("[IMPORT]", "before store.create+put");
          try { r.step("保存到本地");`;
  if (sh.includes(old2)) {
    sh = sh.replace(old2, new2);
    console.log("✅ shell.js: 加了 try 包裹 step");
  } else {
    console.log("❌ 还是没找到...");
  }
}
fs.writeFileSync("app/js/shell.js", sh);

// 3. shell.js — 也让 Tasks.run 的 catch 里打完整堆栈
sh = fs.readFileSync("app/js/shell.js", "utf8");
sh = sh.replace(
  "Tasks.run(\"导入 \" + f.name, async (r) => {",
  "console.time(\"[IMPORT-GLOBAL]\"); OS.Tasks.run(\"导入 \" + f.name, async (r) => {"
);
fs.writeFileSync("app/js/shell.js", sh);
console.log("✅ shell.js: 全局 time 加了");

// 4. 验证语法
try {
  new Function(fs.readFileSync("app/js/store.js", "utf8"));
  console.log("✅ store.js syntax OK");
} catch(e) { console.error("❌ store.js syntax:", e.message); }
try {
  new Function(fs.readFileSync("app/js/shell.js", "utf8"));
  console.log("✅ shell.js syntax OK");
} catch(e) { console.error("❌ shell.js syntax:", e.message); }
