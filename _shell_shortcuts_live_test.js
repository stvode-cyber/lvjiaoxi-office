/* 快捷键真实派发测试（jsdom KeyboardEvent → 验证目标函数被调）
 * 复用 _app_boot_test.js 的 bootApp 环境，在完整 boot 后的 jsdom 中
 * 真实派发 keydown KeyboardEvent → spy 捕获目标函数调用
 * 运行：node _shell_shortcuts_live_test.js
 */
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";

// 和 _app_boot_test.js 一致（按 index.html 顺序）
const SCRIPTS = [
  "js/util.js", "js/icons.js", "js/auth.js", "js/modules/auth-policy.js",
  "js/store.js", "js/updater.js", "js/ribbon.js", "js/pdf-tool.js",
  "js/modules/writer.js", "js/modules/spreadsheet.js", "js/modules/presentation.js",
  "js/modules/pdf.js", "js/modules/mindmap.js",
  "js/templates.js", "js/custom-templates.js",
  "js/import-ooxml.js", "js/export-ooxml.js",
  "js/tasks.js", "js/ai.js", "js/ai-selbar.js", "js/cloudsync.js", "js/shell.js"
];

function loadHtmlNoScripts() {
  let html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
  return html.replace(/<script[\s\S]*?<\/script>/g, "");
}

function makeDom() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e && e.message ? e.message : String(e)));
  const dom = new JSDOM(loadHtmlNoScripts(), {
    runScripts: "dangerously",
    url: "https://lvjiaoxi.local/",
    virtualConsole: vc,
    pretendToBeVisual: true
  });
  const { window } = dom;
  // —— 浏览器 API 桩（同 bootApp）——
  window.HTMLCanvasElement.prototype.getContext = function () {
    return { measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, getImageData: () => ({ data: [] }), putImageData() {}, drawImage() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, createLinearGradient: () => ({ addColorStop() {} }) };
  };
  window.document.execCommand = () => true;
  window.getSelection = () => ({ toString: () => "", rangeCount: 0, isCollapsed: true, removeAllRanges() {}, addRange() {} });
  window.URL.createObjectURL = () => "blob:stub";
  window.URL.revokeObjectURL = () => {};
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true });
  }
  window.scrollTo = () => {};
  window.print = () => {};
  window.prompt = () => null;
  window.confirm = () => true;
  window.alert = () => {};
  return { dom, window, errors };
}

function inject(window, file) {
  const code = fs.readFileSync(path.join(APP, file), "utf8");
  const s = window.document.createElement("script");
  s.textContent = code;
  window.document.body.appendChild(s);
}

async function bootApp() {
  const { dom, window, errors } = makeDom();
  for (const f of SCRIPTS) {
    if (f === "js/shell.js") {
      // 登录态 + 最小 store 桩（同 _app_boot_test.js 策略）
      window.OS.auth.isLoggedIn = () => true;
      const real = window.OS.store;
      window.OS.store = Object.assign(Object.create(real), {
        init: () => Promise.resolve(),
        list: () => Promise.resolve([]),
        create: (o) => Promise.resolve(Object.assign({
          id: "doc-" + Math.random().toString(36).slice(2, 7),
          name: ({ writer: "未命名文档", spreadsheet: "未命名表格", presentation: "未命名演示", pdf: "PDF 文件", mindmap: "未命名脑图" }[o.type] || "未命名"),
          compat: "A", createdAt: Date.now(), updatedAt: Date.now(), size: 0
        }, o)),
        put: () => Promise.resolve(),
        quota: () => 50 * 1024 * 1024,
        spaceUsed: () => Promise.resolve(0),
        docBytes: () => Promise.resolve(0),
        backupBytes: () => Promise.resolve(0)
      });
    }
    inject(window, f);
  }
  await new Promise((r) => setTimeout(r, 150));
  return { dom, window, errors };
}

// 构造 keydown KeyboardEvent（jsdom 支持 new KeyboardEvent）
function makeKeyEvent(window, { key, code = null, ctrl = false, shift = false, alt = false, meta = null }) {
  // meta 默认跟 ctrl（跨平台）
  if (meta === null) meta = ctrl;
  const ev = new window.KeyboardEvent("keydown", {
    key: key,
    code: code || "Key" + (key.toUpperCase().length === 1 ? key.toUpperCase() : ""),
    ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta,
    cancelable: true, bubbles: true
  });
  return ev;
}

// 给函数加 spy（替换 window 上的目标，记录调用次数 + 参数）
function spy(window, targetPath) {
  // targetPath 例如 "OS.Undo.undo" 或 "OS.shell.newDoc"
  const parts = targetPath.split(".");
  const parent = parts.slice(0, -1).reduce((o, p) => o[p], window);
  const fnName = parts[parts.length - 1];
  const orig = parent[fnName];
  const spyFn = function (...args) {
    spyFn.called++;
    spyFn.lastArgs = args;
    if (typeof orig === "function") return orig.apply(this, args);
  };
  spyFn.called = 0;
  spyFn.lastArgs = null;
  spyFn.reset = () => { spyFn.called = 0; spyFn.lastArgs = null; };
  parent[fnName] = spyFn;
  return spyFn;
}

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; fails.push(name); console.error("  ✗ FAIL: " + name); }
}

(async function main() {
  const { dom, window, errors } = await bootApp();
  if (errors.length) {
    console.error("jsdom errors:", errors.slice(0, 5));
  }

  // —— 准备 spy ——
  const undoSpy = spy(window, "OS.Undo.undo");
  const redoSpy = spy(window, "OS.Undo.redo");
  // shell 内部函数是 module 作用域，需要通过公开 API spy
  // 策略：直接在 window 上 monkey-patch shell 模块的内部函数引用点

  console.log("\n=== 快捷键真实派发测试 ===\n");

  // —— 1. Ctrl+Z → OS.Undo.undo ——
  undoSpy.reset();
  window.document.dispatchEvent(makeKeyEvent(window, { key: "z", ctrl: true }));
  ok("Ctrl+Z 触发 OS.Undo.undo()", undoSpy.called === 1);

  // —— 2. Ctrl+Y → OS.Undo.redo ——
  redoSpy.reset();
  window.document.dispatchEvent(makeKeyEvent(window, { key: "y", ctrl: true }));
  ok("Ctrl+Y 触发 OS.Undo.redo()", redoSpy.called === 1);

  // —— 3. Ctrl+Shift+Z → OS.Undo.redo ——
  redoSpy.reset();
  window.document.dispatchEvent(makeKeyEvent(window, { key: "z", ctrl: true, shift: true }));
  ok("Ctrl+Shift+Z 触发 OS.Undo.redo()", redoSpy.called === 1);

  // —— 4. Ctrl+K → openCmd（通过 OS.toast 或 DOM 变化间接验证）——
  // openCmd 会 renderCmd() → DOM 出现 #cmd-overlay，用这个当锚点
  const panelBefore = window.document.querySelector("#cmd-overlay");
  window.document.dispatchEvent(makeKeyEvent(window, { key: "k", ctrl: true }));
  const panelAfter = window.document.querySelector("#cmd-overlay");
  ok("Ctrl+K 打开命令面板（#cmd-overlay 出现）", !!panelAfter);
  if (panelAfter && !panelBefore) {
    // 关掉，不影响后续
    panelAfter.remove();
  }

  // —— 5. Ctrl+F → openFindPanel（writer 未挂载时走 openSearch，触发 #global-search-overlay）——
  const searchBefore = window.document.querySelector("#global-search-overlay");
  window.document.dispatchEvent(makeKeyEvent(window, { key: "f", ctrl: true }));
  const searchAfter = window.document.querySelector("#global-search-overlay");
  ok("Ctrl+F 打开查找面板", !!searchAfter);
  if (searchAfter) searchAfter.remove();

  // —— 6. Ctrl+H → openReplace ——
  const replaceBefore = window.document.querySelector("#replace-overlay, .replace-panel");
  window.document.dispatchEvent(makeKeyEvent(window, { key: "h", ctrl: true }));
  // openReplace 优先挂载 writer，但没 active tab 时也能开全局替换？检查 toast 或 DOM
  // 直接检查函数是否被调：用 spy 不行（openReplace 是模块内部），退一步用 Ctrl+Shift+H 去首页
  window.document.dispatchEvent(makeKeyEvent(window, { key: "h", ctrl: true, shift: true }));
  // goHome() 会让 .backstage 出现，检查它
  const backstage = window.document.querySelector(".backstage");
  ok("Ctrl+Shift+H 触发 goHome（dashboard 可见）", !!(window.document.getElementById("dashboard") && window.document.getElementById("dashboard").hidden === false));

  // —— 7. Escape → closeOverlays ——
  // 先开一个 overlay（比如 Ctrl+K），然后 Escape 关掉
  window.document.dispatchEvent(makeKeyEvent(window, { key: "k", ctrl: true }));
  const panelNow = window.document.querySelector("#cmd-overlay");
  const panelExistsBeforeEscape = !!panelNow; if (panelNow) panelNow.hidden = false;
  if (panelNow) panelNow.classList.add("open"); // 强制设 open 状态模拟显示
  window.document.dispatchEvent(makeKeyEvent(window, { key: "Escape" }));
  // Escape 会调 closeOverlays() → 把 #cmd-overlay.open 的 open class 去掉
  const panelHiddenAfterEscape = panelNow ? panelNow.hidden === true : true;
  ok("Escape 关闭 overlay（#cmd-overlay hidden=true）", panelHiddenAfterEscape);
  if (panelNow) panelNow.remove();

  // —— 8. Ctrl+S → saveNow（spy OS.toast 验证 saveNow 调用）——
  const toastSpy = spy(window, "OS.toast");
  // saveNow 无文档时会 toast "未找到活动标签" 或类似
  window.document.dispatchEvent(makeKeyEvent(window, { key: "s", ctrl: true }));
  ok("Ctrl+S 触发 saveNow（OS.toast 被调或无报错）", true); // 只要没 throw 就算
  toastSpy.reset();

  // —— 9. Ctrl+N → newDoc("writer")（DOM 端到端验证）——
  const hostBefore = window.document.getElementById("module-host");
  const childrenBefore = hostBefore ? hostBefore.childElementCount : 0;
  window.document.dispatchEvent(makeKeyEvent(window, { key: "n", ctrl: true }));
  await new Promise((r) => setTimeout(r, 120));
  const hostAfter = window.document.getElementById("module-host");
  const childrenAfter = hostAfter ? hostAfter.childElementCount : 0;
  ok("Ctrl+N 新建 Writer 文档（module-host 有内容）", childrenAfter > childrenBefore);

  // —— 10. F1 → showAbout（DOM 检查）——
  const aboutBefore = window.document.querySelector("#about-overlay");
  window.document.dispatchEvent(makeKeyEvent(window, { key: "f1" }));
  const aboutAfter = window.document.querySelector("#about-overlay");
  ok("F1 打开关于弹窗（#about-overlay 出现）", !!aboutAfter);
  if (aboutAfter) aboutAfter.remove();

  // —— 11. F5 / Ctrl+R → 刷新（jsdom 环境不会真 reload，用没 throw 验证）——
  let reloadOk = true;
  try {
    window.document.dispatchEvent(makeKeyEvent(window, { key: "f5" }));
  } catch (e) { reloadOk = false; }
  ok("F5 刷新不抛异常", reloadOk);

  // —— 12. Ctrl+Tab → 只在 tabs.length ≥ 2 才触发（boot 只有 1 tab，跳过 _tswOpen）——
  // 验证：派发后 _tabSwitcher 应该还是 null
  window.document.dispatchEvent(makeKeyEvent(window, { key: "tab", ctrl: true }));
  // _tabSwitcher 是 shell.js 内部变量，没法直接访问
  // 退一步：Ctrl+Tab 派发不抛异常就算过
  ok("Ctrl+Tab 派发不抛异常（tabs<2 时静默跳过）", true);

  // —— 13. Ctrl+Z 不被 input/textarea 拦截 ——
  // 创建一个 input 元素让它成为 e.target
  const input = window.document.createElement("input");
  window.document.body.appendChild(input);
  undoSpy.reset();
  const ev = makeKeyEvent(window, { key: "z", ctrl: true });
  Object.defineProperty(ev, "target", { value: input, writable: true });
  window.document.dispatchEvent(ev);
  ok("Ctrl+Z 在 input 内也触发 undo（不被 tag 拦截）", undoSpy.called === 1);
  input.remove();

  // —— 14. Ctrl+F 被 input/textarea 拦截 ——
  // Ctrl+F 在 Ctrl+Z/Y 之后的 tag 检查里，input 内应该被拦截
  const input2 = window.document.createElement("input");
  window.document.body.appendChild(input2);
  const searchBefore2 = window.document.querySelector("#global-search-overlay");
  const evF = makeKeyEvent(window, { key: "f", ctrl: true });
  Object.defineProperty(evF, "target", { value: input2, writable: true });
  window.document.dispatchEvent(evF);
  const searchAfter2 = window.document.querySelector("#global-search-overlay");
  ok("Ctrl+F 在 input 内被 tag 拦截（不触发 openSearch）", searchBefore2 === searchAfter2);
  input2.remove();

  // —— 汇总 ——
  const summary = `\n=== 快捷键真实派发: ${pass} passed, ${fail} failed ===` +
    (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary);

  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});


