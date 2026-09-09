/* 绿角犀 Office · 全应用启动冒烟测试（真实 boot() 端到端）
 * 加载 index.html 的全部 app/js 脚本（按 HTML 顺序），在 jsdom 中真正执行 boot()，
 * 验证：① 加载无 jsdomError ② 五个模块全部注册 ③ OS.shell API 存在
 *       ④ 冷启动显示登录门 ⑤ 登录后开始页模板画廊由真实 OS.Templates 渲染
 *       ⑥ 通过 OS.shell.newDoc 端到端挂载 writer 模块
 * 运行：
 *   C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe _app_boot_test.js
 * 结果写入 _app_boot_result.txt（避免 stdout 被吞）
 */
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";

// 按 index.html 顺序（去掉 vendor，boot 阶段不需要）
const SCRIPTS = [
  "js/util.js",
  "js/icons.js",
  "js/auth.js",
  "js/modules/auth-policy.js",
  "js/store.js",
  "js/updater.js",
  "js/ribbon.js",
  "js/pdf-tool.js",
  "js/modules/writer.js",
  "js/modules/spreadsheet.js",
  "js/modules/presentation.js",
  "js/modules/pdf.js",
  "js/modules/mindmap.js",
  "js/templates.js",
  "js/custom-templates.js",
  "js/import-ooxml.js",
  "js/export-ooxml.js",
  "js/tasks.js",
  "js/ai.js",
  "js/ai-selbar.js",
  "js/cloudsync.js",
  "js/shell.js"
];

const EXPECTED_MODULES = ["mindmap", "pdf", "presentation", "spreadsheet", "writer"];

function loadHtmlNoScripts() {
  let html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
  // 去掉所有 <script> 标签（vendor + app），改为手动按顺序注入，避免外部加载不确定
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
  // —— 补齐 jsdom 缺失的浏览器 API（仅为启动期不被卡死，非掩盖应用 bug）——
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

async function bootApp({ loggedIn, requireLogin = false }) {
  const { dom, window, errors } = makeDom();
  for (const f of SCRIPTS) {
    if (f === "js/shell.js" && loggedIn) {
      // 登录态：覆盖判定 + 提供最小 store 桩（不含 IndexedDB）
      window.OS.auth.isLoggedIn = () => true;
      const real = window.OS.store;
      window.OS.store = Object.assign(Object.create(real), {
        init: () => Promise.resolve(),
        list: () => Promise.resolve([]),
        create: (o) => Promise.resolve(Object.assign({
          id: "doc-" + Math.random().toString(36).slice(2, 7),
          name: o.name || ({ writer: "未命名文档", spreadsheet: "未命名表格", presentation: "未命名演示", pdf: "PDF 文件", mindmap: "未命名脑图" }[o.type] || "未命名"),
          compat: "A",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          size: 0
        }, o)),
        put: () => Promise.resolve(),
        quota: () => 50 * 1024 * 1024,
        spaceUsed: () => Promise.resolve(0),
        docBytes: () => Promise.resolve(0),
        backupBytes: () => Promise.resolve(0)
      });
    }
    if (f === "js/modules/auth-policy.js") {
      inject(window, f);
      // 在 auth-policy 注入后、shell 启动判定前，按需要强制登录门（桩，绕过测试环境 localStorage 依赖）
      if (requireLogin) { try { window.OS.AuthPolicy.shouldGate = () => true; } catch (e) {} }
      continue;
    }
    inject(window, f);
  }
  // 等待 boot→enterApp→renderDashboard 的微任务/定时器落定
  await new Promise((r) => setTimeout(r, 120));
  return { dom, window, errors };
}

// —— 断言助手 ——
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log("FAIL:", name); }
}

(async function main() {
  // ===== 场景 A：冷启动（未登录）=====
  const cold = await bootApp({ loggedIn: false });
  ok("A1 加载无 jsdomError", cold.errors.length === 0);
  if (cold.errors.length) console.log("  jsdomErrors:", cold.errors.slice(0, 5));
  const modKeys = cold.window.OS && cold.window.OS.modules ? Object.keys(cold.window.OS.modules).sort() : [];
  ok("A2 五个模块全部注册", JSON.stringify(modKeys) === JSON.stringify(EXPECTED_MODULES));
  if (JSON.stringify(modKeys) !== JSON.stringify(EXPECTED_MODULES)) console.log("  modules:", modKeys);
  ok("A3 OS.shell 存在", typeof (cold.window.OS && cold.window.OS.shell) === "object");
  const sh = cold.window.OS && cold.window.OS.shell;
  ok("A4 shell API 完整", sh && ["boot", "newDoc", "openDoc", "globalSearch", "openSearch", "openReplace", "closeSearch", "closeReplace"].every((m) => typeof sh[m] === "function"));
  const loginOv = cold.window.document.getElementById("login-overlay");
  ok("A5 默认游客进入·不强制登录（登录门隐藏）", !!loginOv && loginOv.hidden === true);
  // 场景 A'：开启「启动时要求登录」→ 冷启动强制显示登录门
  const forced = await bootApp({ loggedIn: false, requireLogin: true });
  const fLoginOv = forced.window.document.getElementById("login-overlay");
  ok("A5b 开启强制登录·冷启动显示登录门", !!fLoginOv && fLoginOv.hidden === false);
  ok("A6 关键全局已就绪", !!(cold.window.OS && cold.window.OS.Templates && cold.window.OS.store && cold.window.OS.settings && cold.window.OS.Favorites));
  ok("A7 PdfTool 全局已注册（合并/拆分）", !!(cold.window.OS && cold.window.OS.PdfTool && typeof cold.window.OS.PdfTool.mergePdfs === "function" && typeof cold.window.OS.PdfTool.splitPdf === "function"));

  // ===== 场景 B：登录态开始页 + 端到端挂载 =====
  const hot = await bootApp({ loggedIn: true });
  ok("B1 登录态加载无 jsdomError", hot.errors.length === 0);
  if (hot.errors.length) console.log("  jsdomErrors:", hot.errors.slice(0, 5));
  const gallery = hot.window.document.getElementById("tpl-gallery");
  ok("B2 开始页模板画廊已渲染(真实 Templates)", !!gallery && gallery.childElementCount > 0);
  if (gallery) console.log("  gallery cards:", gallery.childElementCount);
  const loginHidden = hot.window.document.getElementById("login-overlay");
  ok("B3 登录态隐藏登录门", !!loginHidden && loginHidden.hidden === true);

  // 端到端：通过 shell.newDoc 打开一个 writer 文档，验证 shell→module 全链路
  hot.window.OS.shell.newDoc("writer");
  await new Promise((r) => setTimeout(r, 150));
  const editor = hot.window.document.getElementById("editor");
  const host = hot.window.document.getElementById("module-host");
  ok("B4 newDoc 后编辑器可见", !!editor && editor.hidden === false);
  ok("B5 writer 模块已挂载到 module-host", !!host && host.childElementCount > 0);
  if (host) console.log("  module-host children:", host.childElementCount);
  // 标题栏 / 文档标题应已填充
  const title = hot.window.document.getElementById("doc-title");
  ok("B6 文档标题已写入", !!title && title.textContent.length > 0);

  const summary = `\n=== 应用启动冒烟: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  fs.writeFileSync(path.join(APP, "../_app_boot_result.txt"), summary + "\n", "utf8");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  fs.writeFileSync(path.join(APP, "../_app_boot_result.txt"), "FATAL: " + (e && e.stack || e) + "\n", "utf8");
  process.exit(1);
});
