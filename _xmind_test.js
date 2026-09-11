/* 绿角犀 Office · XMind 解析测试
 * 运行：node _xmind_test.js
 * 覆盖：现代格式 content.json → mindmap nodes；
 *       旧版 XMind 8 content.xml → mindmap nodes；
 *       缺失内容时抛"无法解析"。
 */
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  FAIL: " + name); } }

function loadImporter() {
  const dom = new JSDOM('<html><head></head><body></body></html>', { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  window.JSZip = JSZip;
  window.OS = {};
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
  console.log("=== XMind 解析测试 (mindmap type) ===\n");
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
    ok("返回 mindmap 类型", r.type === "mindmap");
    ok("有 nodes 数组", Array.isArray(r.data.nodes));
    ok("有 rootId", !!r.data.rootId);
    const nodes = r.data.nodes;
    ok("nodes 总数 >= 4", nodes.length >= 4);
    ok("根节点存在", nodes.some(n => n.isRoot));
    ok("根节点文本='主页'", nodes.find(n => n.isRoot)?.text === "主页");
    ok("含 '任务 A'", nodes.some(n => n.text === "任务 A"));
    ok("含 '子项 a'", nodes.some(n => n.text === "子项 a"));
    ok("含 '任务 B'", nodes.some(n => n.text === "任务 B"));
    const root = nodes.find(n => n.isRoot);
    const taskA = nodes.find(n => n.text === "任务 A");
    ok("任务 A parent = rootId", taskA?.parent === root?.id);
    const subA = nodes.find(n => n.text === "子项 a");
    ok("子项 a parent = 任务A id", subA?.parent === taskA?.id);
    ok("所有 node 有必要字段", nodes.every(n => n.id != null && n.text != null && (n.parent != null || n.isRoot) && typeof n.isRoot === "boolean"));
  }

  console.log("\n--- 2. 多 sheet 数组（仅取第一个） ---");
  {
    const multi = [ { title: "画布一", rootTopic: { title: "R1" } },
                    { title: "画布二", rootTopic: { title: "R2", children: { attached: [ { title: "X" } ] } } } ];
    const zip = await zipWith({ "content.json": JSON.stringify(multi) });
    const r = await I.parseXmind(zip);
    ok("取第一个 sheet 的 R1", r.data.nodes.some(n => n.text === "R1"));
    ok("不取第二个 sheet 的 R2", !r.data.nodes.some(n => n.text === "R2"));
  }

  console.log("\n--- 3. 旧版 content.xml (XMind 8) ---");
  const xml = '<?xml version="1.0"?>\n' +
    '<xmap-content><sheet id="s"><topic id="rt"><title>根节点</title>' +
    '<children><topics type="attached">' +
    '<topic id="a"><title>分支1</title><children><topics type="attached"><topic id="a1"><title>分支1.1</title></topic></topics></children></topic>' +
    '<topic id="b"><title>分支2</title></topic>' +
    '</topics></children></topic></sheet></xmap-content>';
  {
    const zip = await zipWith({ "content.xml": xml });
    const r = await I.parseXmind(zip);
    ok("返回 mindmap 类型", r.type === "mindmap");
    ok("根节点='根节点'", r.data.nodes.find(n => n.isRoot)?.text === "根节点");
    ok("含 分支1", r.data.nodes.some(n => n.text === "分支1"));
    ok("含 分支1.1", r.data.nodes.some(n => n.text === "分支1.1"));
    ok("含 分支2", r.data.nodes.some(n => n.text === "分支2"));
    ok("rootId 对应根节点", r.data.rootId === r.data.nodes.find(n => n.isRoot)?.id);
  }

  console.log("\n--- 4. 缺失内容时抛错 ---");
  {
    const empty = await zipWith({ "manifest.json": "{}" });
    let threw = false;
    try { await I.parseXmind(empty); } catch (e) { threw = /无法解析/.test(String(e.message)); }
    ok("无 content 抛'无法解析'", threw);
  }

  const summary = `\n=== XMind 测试: ${pass} passed, ${fail} failed ===` + (fails.length ? "\nFAILED: " + fails.join("; ") : "");
  console.log(summary); process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e && e.message); process.exit(2); });
