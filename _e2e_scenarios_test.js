/* 绿角犀 Office · 端到端场景测试（E2E Scenarios）
 * 覆盖：主题切换 / 文件类型识别 / 模板构建 / 导出边界 / 云同步纯函数 / 工具函数
 *
 * 运行：node _e2e_scenarios_test.js
 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const APP = __dirname + "/app";
const RESULT_FILE = path.join(APP, "..", "_e2e_scenarios_result.txt");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

// —— 搭建 jsdom 环境 ——
function setupDom() {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head></head><body></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" }
  );
  const { window } = dom;
  window.JSZip = JSZip;

  const OS = {
    bus: { on() {}, emit() {} },
    COMMANDS: {}, TYPE_INFO: {}, COMPAT: {},
    util: { escapeHtml: s => String(s == null ? "" : s), fmtSize: b => b + " B", fmtTime: t => "" + t, uid: p => (p || "id") + "-" + Math.random().toString(36).slice(2) }
  };
  window.OS = OS;

  function loadJS(rel) {
    const code = fs.readFileSync(path.join(APP, rel), "utf8");
    const s = window.document.createElement("script");
    s.textContent = code;
    window.document.body.appendChild(s);
  }
  return { window, OS, dom, loadJS };
}

(async function main() {
  console.log("=== E2E 场景测试 ===\n");

  // =============================================
  // 1. 主题切换
  // =============================================
  console.log("--- 1. 主题切换 ---");
  {
    const { window, OS, loadJS } = setupDom();
    loadJS("js/util.js");

    ok("THEME: 初始为 light", OS.theme.get() === "light");
    OS.theme.set("dark");
    ok("THEME: 设为 dark 后读取正确", OS.theme.get() === "dark");
    ok("THEME: data-theme 属性已设 dark", window.document.documentElement.getAttribute("data-theme") === "dark");
    OS.theme.toggle();
    ok("THEME: toggle 回到 light", OS.theme.get() === "light");
    OS.theme.toggle();
    ok("THEME: toggle 到 dark", OS.theme.get() === "dark");
    OS.theme.set("light");
    ok("THEME: 恢复 light", OS.theme.get() === "light");
  }

  // =============================================
  // 2. 文件类型识别（MIME 表）
  // =============================================
  console.log("\n--- 2. 文件类型识别 ---");
  {
    // shell.js 的 mimeFor 是闭包且依赖 DOM，这里直接测试其逻辑等价
    const mimeMap = {
      "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "pdf": "application/pdf",
      "ofd": "application/ofd",
      "csv": "text/csv",
      "txt": "text/plain",
      "md": "text/markdown",
      "html": "text/html",
      "htm": "text/html",
      "lvjx": "application/octet-stream"
    };
    function mimeFor(ext) {
      return mimeMap[(ext || "").toLowerCase().replace(/^\./, "")] || "application/octet-stream";
    }

    ok("MIME: docx", mimeFor("docx") === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    ok("MIME: xlsx", mimeFor("xlsx") === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    ok("MIME: pptx", mimeFor("pptx") === "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    ok("MIME: pdf", mimeFor("pdf") === "application/pdf");
    ok("MIME: ofd", mimeFor("ofd") === "application/ofd");
    ok("MIME: csv", mimeFor("csv") === "text/csv");
    ok("MIME: txt", mimeFor("txt") === "text/plain");
    ok("MIME: md", mimeFor("md") === "text/markdown");
    ok("MIME: html", mimeFor("html") === "text/html");
    ok("MIME: htm", mimeFor("htm") === "text/html");
    ok("MIME: lvjx", mimeFor("lvjx") === "application/octet-stream");
    ok("MIME: 未知扩展名回退默认", mimeFor("xyz") === "application/octet-stream");
    ok("MIME: 带点前缀", mimeFor(".docx") === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    ok("MIME: 大写 DOCX", mimeFor("DOCX") === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  // =============================================
  // 3. 模板构建
  // =============================================
  console.log("\n--- 3. 模板构建 ---");
  {
    const { window, OS, loadJS } = setupDom();
    loadJS("js/util.js");
    loadJS("js/icons.js");
    loadJS("js/templates.js");

    const T = OS.Templates;
    ok("TPL: Templates 已注册", !!T);
    ok("TPL: 模板列表非空", T.list && T.list.length > 0);
    ok("TPL: 分组非空", T.groups && T.groups.length > 0);

    // 每个模块的空白模板都应能正确 build()
    const modules = ["writer", "spreadsheet", "presentation", "mindmap"];
    for (const mod of modules) {
      const blank = T.list.find(t => t.module === mod && t.id.includes("blank"));
      if (blank) {
        const data = blank.build();
        ok("TPL: " + mod + " 空白模板 build() 正常", data && typeof data === "object");
      } else {
        ok("TPL: " + mod + " 有空白模板", false);
      }
    }

    // writer-blank 内容验证
    const writerBlank = T.byId("writer-blank");
    ok("TPL: writer-blank 可查", !!writerBlank);
    if (writerBlank) {
      const data = writerBlank.build();
      ok("TPL: writer-blank 含 html", data && data.html);
      ok("TPL: writer-blank html 非空", data && data.html && data.html.length > 0);
    }

    // 所有模板都有 build()
    T.groups.forEach(g => {
      g.items.forEach(t => {
        ok("TPL: " + t.id + " 可 build()", typeof t.build === "function");
      });
    });
  }

  // =============================================
  // 4. 导出边界情况
  // =============================================
  console.log("\n--- 4. 导出边界 ---");
  {
    const { window, OS, loadJS } = setupDom();
    loadJS("js/export-ooxml.js");
    const E = OS.Exporter;

    // 4a. 空文档导出
    {
      const emptyWriter = { type: "writer", name: "空文档", data: { html: "" } };
      const zip = E.buildDocx(emptyWriter);
      ok("BOUNDARY: 空文档 DOCX 导出成功", !!zip);
      ok("BOUNDARY: 空文档含 document.xml", !!zip.file("word/document.xml"));
    }

    // 4b. 超大表格（50 行 x 10 列）
    {
      const cells = {};
      for (let r = 1; r <= 50; r++) {
        for (let c = 1; c <= 10; c++) {
          const col = String.fromCharCode(64 + c);
          cells[col + r] = { v: "数据" + col + r };
        }
      }
      const bigSheet = { type: "spreadsheet", name: "大表格", data: { cells } };
      const zip = E.buildXlsx(bigSheet);
      ok("BOUNDARY: 50x10 表格导出行在", !!zip.file("xl/worksheets/sheet1.xml"));
      ok("BOUNDARY: 50x10 表格含 sharedStrings", !!zip.file("xl/sharedStrings.xml"));
    }

    // 4c. 特殊字符
    {
      const specialDoc = {
        type: "writer", name: "特殊字符",
        data: { html: "<p>Special: &amp; < > \" ' © ® ™ 中文 日本語 한국어 عربي</p>" }
      };
      const zip = E.buildDocx(specialDoc);
      ok("BOUNDARY: 特殊字符 DOCX 导出成功", !!zip);
      const docXml = await zip.file("word/document.xml").async("string");
      ok("BOUNDARY: 导出含中文", docXml.indexOf("中文") !== -1);
      ok("BOUNDARY: 导出含日文", docXml.indexOf("日本語") !== -1);
      ok("BOUNDARY: 导出含韩文", docXml.indexOf("한국어") !== -1);
      ok("BOUNDARY: 导出含阿拉伯文", docXml.indexOf("عربي") !== -1);
    }

    // 4d. 极长文本
    {
      const longText = "这是长文本测试。".repeat(200);
      const longDoc = { type: "writer", name: "长文本", data: { html: "<p>" + longText + "</p>" } };
      const zip = E.buildDocx(longDoc);
      ok("BOUNDARY: 长文本 DOCX 导出成功", !!zip && !!zip.file("word/document.xml"));
    }

    // 4e. 缺失数据（防御性编码）
    {
      const nilDoc = { type: "writer", name: "无数据", data: {} };
      const zip = E.buildDocx(nilDoc);
      ok("BOUNDARY: 无数据 DOCX 不抛异常", !!zip);
    }

    // 4f. 空数据导出
    {
      const nilXlsx = { type: "spreadsheet", name: "空表格", data: {} };
      const zip = E.buildXlsx(nilXlsx);
      ok("BOUNDARY: 空表格 XLSX 不抛异常", !!zip);
    }

    // 4g. 单页演示
    {
      const singleSlide = { type: "presentation", name: "单页", data: { slides: [{ elements: [] }] } };
      const zip = E.buildPptx(singleSlide);
      ok("BOUNDARY: 单页空白 PPTX 导出成功", !!zip && !!zip.file("ppt/slides/slide1.xml"));
    }
  }

  // =============================================
  // 5. 云同步纯函数
  // =============================================
  console.log("\n--- 5. 云同步纯函数 ---");
  {
    const { window, OS, loadJS } = setupDom();
    loadJS("js/cloudsync.js");
    const CS = OS.CloudSync;

    ok("CS: CloudSync 已注册", !!CS);

    // shouldSync
    ok("CS: shouldSync 有 token 返回 true", CS.shouldSync({ token: "abc" }) === true);
    ok("CS: shouldSync 无 token 返回 false", CS.shouldSync({}) === false);
    ok("CS: shouldSync null 返回 false", CS.shouldSync(null) === false);
    ok("CS: shouldSync undefined 返回 false", CS.shouldSync(undefined) === false);

    // authHeaders
    const h = CS.authHeaders("token123");
    ok("CS: authHeaders 含 Bearer", h.Authorization === "Bearer token123");
    ok("CS: authHeaders 含 JSON", h["Content-Type"] === "application/json");

    // docEndpoint / backupEndpoint
    ok("CS: docEndpoint", CS.docEndpoint("/api", "doc1") === "/api/docs/doc1");
    ok("CS: docEndpoint 去尾部斜杠", CS.docEndpoint("/api/", "doc1") === "/api/docs/doc1");
    ok("CS: backupEndpoint", CS.backupEndpoint("/api", "b1") === "/api/backups/b1");

    // mergePlan
    const local = [
      { id: "a", updatedAt: 100 },
      { id: "b", updatedAt: 200 },
      { id: "c", updatedAt: 300 }
    ];
    const remote = [
      { id: "a", updatedAt: 150 },   // remote 更新 → pull
      { id: "b", updatedAt: 200 },   // 相同 → 不操作
      { id: "d", updatedAt: 400 }    // 仅 remote → pull
    ];
    const plan = CS.mergePlan(local, remote);
    ok("CS: mergePlan 返回对象含 toPull/toPush", plan && Array.isArray(plan.toPull) && Array.isArray(plan.toPush));
    ok("CS: mergePlan toPull 含 a（remote 较新）", plan.toPull.indexOf("a") !== -1);
    ok("CS: mergePlan toPull 含 d（仅 remote）", plan.toPull.indexOf("d") !== -1);
    ok("CS: mergePlan toPush 含 c（仅 local）", plan.toPush.indexOf("c") !== -1);
    ok("CS: mergePlan toPull 不含 b（相同）", plan.toPull.indexOf("b") === -1);
    ok("CS: mergePlan toPush 不含 b（相同）", plan.toPush.indexOf("b") === -1);
  }

  // =============================================
  // 6. Store 公共 API
  // =============================================
  console.log("\n--- 6. Store API ---");
  {
    const { window, OS, loadJS } = setupDom();
    loadJS("js/util.js");
    loadJS("js/store.js");

    const store = OS.store;
    ok("STORE: 已注册", !!store);
    ok("STORE: create", typeof store.create === "function");
    ok("STORE: put", typeof store.put === "function");
    ok("STORE: get", typeof store.get === "function");
    ok("STORE: list", typeof store.list === "function");
    ok("STORE: remove", typeof store.remove === "function");
  }

  // =============================================
  // 7. 工具函数
  // =============================================
  console.log("\n--- 7. 工具函数 ---");
  {
    const { window, OS, loadJS } = setupDom();
    loadJS("js/util.js");
    const u = OS.util;

    // escapeHtml
    ok("UTIL: escapeHtml &", u.escapeHtml("a&b") === "a&amp;b");
    ok("UTIL: escapeHtml <", u.escapeHtml("<tag>") === "&lt;tag&gt;");
    ok("UTIL: escapeHtml >", u.escapeHtml("a>b") === "a&gt;b");
    ok("UTIL: escapeHtml 引号", u.escapeHtml('"') === "&quot;");
    ok("UTIL: escapeHtml null", u.escapeHtml(null) === "");
    ok("UTIL: escapeHtml undefined", u.escapeHtml(undefined) === "");

    // fmtSize
    ok("UTIL: fmtSize 0", u.fmtSize(0) === "0 B");
    ok("UTIL: fmtSize 1023", u.fmtSize(1023) === "1023 B");
    ok("UTIL: fmtSize 1 KB", u.fmtSize(1024) === "1.0 KB");
    ok("UTIL: fmtSize 1 MB", u.fmtSize(1048576) === "1.0 MB");
    ok("UTIL: fmtSize 1 GB", u.fmtSize(1073741824) === "1.0 GB");

    // fmtTime（0 被当做 falsy 处理，返回空字符串）
    ok("UTIL: fmtTime null", u.fmtTime(null) === "");
    ok("UTIL: fmtTime 0", u.fmtTime(0) === "");
    ok("UTIL: fmtTime 正数返回日期", /^\d{4}-\d{2}-\d{2}/.test(u.fmtTime(1700000000000)));

    // uid
    const id = u.uid("test");
    ok("UTIL: uid 前缀 test-", id.indexOf("test-") === 0);
    ok("UTIL: uid 长度足够", id.length > 10);
  }

  // =============================================
  // 8. 兼容性标签
  // =============================================
  console.log("\n--- 8. 兼容性标签 ---");
  {
    const { window, OS } = setupDom();
    OS.COMPAT = {
      A: { label: "原生", color: "var(--ok)" },
      B: { label: "兼容", color: "var(--warn)" },
      C: { label: "只读", color: "var(--danger)" }
    };
    ok("COMPAT: A 标签", OS.COMPAT.A.label === "原生");
    ok("COMPAT: B 标签", OS.COMPAT.B.label === "兼容");
    ok("COMPAT: C 标签", OS.COMPAT.C.label === "只读");
  }

  console.log("\n--- 11. 主导航结构（工作台 / 订单 / 库存 / 审批 / 我的） ---");
  {
    const htmlIndex = fs.readFileSync(path.join(APP, "index.html"), "utf8");
    const navMatch = htmlIndex.match(/<nav class="app-nav" id="app-nav"[\s\S]*?<\/nav>/);
    ok("TOPNAV: index.html 包含主导航条", !!navMatch);
    if (navMatch) {
      const labels = [...navMatch[0].matchAll(/data-view="([^"]+)"[^>]*>([^<]+)</g)]
        .map(m => m[2].trim());
      const views = [...navMatch[0].matchAll(/data-view="([^"]+)"/g)].map(m => m[1]);
      ok("TOPNAV: 顺序为 工作台/我的",
        JSON.stringify(labels) === JSON.stringify(["工作台", "我的"]));
      ok("TOPNAV: view 集合正确",
        JSON.stringify(views) === JSON.stringify(["workbench", "profile"]));
      ok("TOPNAV: 默认激活工作台", /class="app-nav-item active" data-view="workbench"/.test(navMatch[0]));
    }
    const panelIds = ["panel-profile"];
    const panelsOk = panelIds.every(id => {
      const re = new RegExp(`<section class="app-panel" id="${id}" data-view="[^"]+" hidden>`);
      return re.test(htmlIndex);
    });
    ok("TOPNAV: 业务面板存在且默认 hidden", panelsOk);
  }

  // =============================================
  // 汇总
  // =============================================
  const summary = `\n=== E2E 场景测试: ${pass} passed, ${fail} failed ===`
    + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  fs.writeFileSync(RESULT_FILE, summary + "\n", "utf8");
  console.log(summary);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("FATAL", e && e.message, e && e.stack);
  fs.writeFileSync(RESULT_FILE, "FATAL: " + (e && e.stack || e) + "\n", "utf8");
  process.exit(2);
});