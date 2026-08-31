/* 绿角犀 Office · MindMap 导出 docx/md/ofd 测试（纯逻辑，node 直跑）
   验证树形序列化：Markdown 缩进、DOCX 标题层级、OFD XML、DFS 顺序、坏数据容错。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/mindmap.js");
  const MM = global.OS.modules.mindmap;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  const data = {
    mode: "map", rootId: "r",
    nodes: [
      { id: "r", text: "中心主题", isRoot: true, parent: null },
      { id: "a", text: "分支A", parent: "r" },
      { id: "a1", text: "子A1", parent: "a" },
      { id: "b", text: "分支B", parent: "r" }
    ],
    edges: []
  };

  // —— toMarkdown ——
  const md = MM.toMarkdown(data);
  ok("toMarkdown 含根节点", md.indexOf("- 中心主题") >= 0);
  ok("toMarkdown 分支缩进 2 空格", md.indexOf("  - 分支A") >= 0);
  ok("toMarkdown 子节点缩进 4 空格", md.indexOf("    - 子A1") >= 0);
  ok("toMarkdown 分支B 存在", md.indexOf("  - 分支B") >= 0);

  // —— toDocxHtml ——
  const html = MM.toDocxHtml(data);
  ok("toDocxHtml h1 根", html.indexOf("<h1>中心主题</h1>") >= 0);
  ok("toDocxHtml h2 分支", html.indexOf("<h2>分支A</h2>") >= 0);
  ok("toDocxHtml p 子", html.indexOf("<p>子A1</p>") >= 0);
  ok("toDocxHtml 转义 < &", MM.toDocxHtml({ nodes: [{ id: "x", text: "<b>&", isRoot: true, parent: null }] }).indexOf("&lt;b&gt;&amp;") >= 0);

  // —— toOfdXml ——
  const ofd = MM.toOfdXml(data);
  ok("toOfdXml 含 Content 根", ofd.indexOf("<ofd:Content") >= 0);
  ok("toOfdXml 含 OFD 命名空间", ofd.indexOf("www.ofdspec.org") >= 0);
  ok("toOfdXml 含 TextCode 根文本", ofd.indexOf("<ofd:TextCode>中心主题</ofd:TextCode>") >= 0);

  // —— _buildTree 顺序 / 深度 ——
  const tree = MM._buildTree(data);
  ok("buildTree DFS 顺序", tree[0].text === "中心主题" && tree[1].text === "分支A" && tree[2].text === "子A1" && tree[3].text === "分支B");
  ok("buildTree 深度正确", tree[2].depth === 2 && tree[3].depth === 1);

  // —— 坏数据容错 ——
  ok("toMarkdown 空返回空串", MM.toMarkdown(null) === "");
  ok("toDocxHtml 空返回空串", MM.toDocxHtml({}) === "");
  ok("toOfdXml 空返回空串", MM.toOfdXml(null) === "");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
