/* 绿角犀 Office · XMind 解析测试
 * 运行：node _xmind_test.js
 * 覆盖：现代格式 content.json（多 sheet + 嵌套 attached 主题）→ 大纲 HTML；
 *       旧版 XMind 8 content.xml（sheet/topic/title/children/topics）→ 大纲 HTML；
 *       缺失内容时抛"无法解析"；转义防注入。
 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function loadImporter() {
  const dom = new JSDOM(`<html><head></head><body></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  window.JSZip = JSZip; // 用真实 npm JSZip（Node 下 async() 可解析）
  window.OS = {};       // import-ooxml 需要 OS 存在
  const s = window.document.createElement("script");
  s.textContent = fs.readFileSync(path.join(__dirname, "app/js/import-ooxml.js"), "utf8");
  window.document.body.appendChild(s);
  return window.OS.Importer;
}
async function zipWith(files) {
  const z = new JSZip();
  Object.keys(files).forEach(n => z.file(n, files[n]));
  const buf = await z.generateAsync({ type: "nodebuffer" });
  return await JSZip.loadAsync(new Uint8Array(buf));
}
(async () => {
  console.log("=== XMind 解析测试 ===\n");
  const I = loadImporter();
  ok("Importer 暴露 parseXmind", typeof I.parseXmind === "function");

  console.log("\n--- 1. 现代 content.json ---");
  const jsonXmind = {
    id: "s1", class: "sheet", title: "项目规划",
    rootTopic: { id: "t1", title: "主页", children: { attached: [
      { id: "t2", title: "任务 A", children: { attached: [
        { id: "t4", title: "子项 a" }
      ] } },
      { id: "t3", title: "任务 B" }
    ] } }
  };
  {
    const zip = await zipWith({ "content.json": JSON.stringify(jsonXmind) });
    const r = await I.parseXmind(zip);
    ok("返回 writer 类型", r.type === "writer");
    const h = r.data.html;
    ok("含 sheet 标题", h.indexOf("项目规划") !== -1);
    ok("含根主题", h.indexOf("主页") !== -1);
    ok("含嵌套子主题", h.indexOf("任务 A") !== -1 && h.indexOf("子项 a") !== -1 && h.indexOf("任务 B") !== -1);
    ok("生成 xm-node 容器", (h.match(/xm-node/g) || []).length >= 4);
  }

  console.log("\n--- 2. content.json 为数组（多 sheet） ---");
  {
    const multi = [ { title: "画布一", rootTopic: { title: "R1" } },
                    { title: "画布二", rootTopic: { title: "R2", children: { attached: [ { title: "X" } ] } } } ];
    const zip = await zipWith({ "content.json": JSON.stringify(multi) });
    const h = (await I.parseXmind(zip)).data.html;
    ok("多 sheet 都渲染", h.indexOf("画布一") !== -1 && h.indexOf("画布二") !== -1 && h.indexOf("X") !== -1);
  }

  console.log("\n--- 3. 旧版 content.xml ---");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content>
  <sheet id="s" theme="default"><topic id="rt">
    <title>根节点</title>
    <children><topics type="attached">
      <topic id="a"><title>分支1</title><children><topics type="attached"><topic id="a1"><title>分支1.1</title></topic></topics></children></topic>
      <topic id="b"><title>分支2</title></topic>
    </topics></children>
  </topic></sheet>
</xmap-content>`;
  {
    const zip = await zipWith({ "content.xml": xml });
    const h = (await I.parseXmind(zip)).data.html;
    ok("XML 根节点", h.indexOf("根节点") !== -1);
    ok("XML 分支与嵌套", h.indexOf("分支1") !== -1 && h.indexOf("分支1.1") !== -1 && h.indexOf("分支2") !== -1);
  }

  console.log("\n--- 4. 转义与缺失 ---");
  {
    const evil = { title: "<script>alert(1)</script>&\"", rootTopic: { title: "<X>" } };
    const zip = await zipWith({ "content.json": JSON.stringify(evil) });
    const h = (await I.parseXmind(zip)).data.html;
    ok("标题已转义（不含原始 <script>）", h.indexOf("<script>alert") === -1);
    ok("转义标记存在", h.indexOf("&lt;script&gt;") !== -1);
  }
  {
    const empty = await zipWith({ "manifest.json": "{}" });
    let threw = false;
    try { await I.parseXmind(empty); } catch (e) { threw = /无法解析/.test(String(e.message)); }
    ok("无 content 抛'无法解析'", threw);
  }

  const summary = `\n=== XMind 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message); process.exit(2); });