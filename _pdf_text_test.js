/* PDF 文本索引回归测试（纯逻辑，零依赖）
 * 桥接：在 node 下把 window 设为 global，require 模块即可拿到 OS.PdfText
 */
(function () {
  "use strict";
  global.window = global;
  const PdfText = require("./app/js/modules/pdf-text.js");

  let pass = 0, fail = 0;
  function ok(c, m) { if (c) { pass++; } else { fail++; console.error("✗ FAIL: " + m); } }

  // —— buildIndex ——
  const idx = PdfText.buildIndex([
    [{ text: "Hello", x: 0.1, y: 0.2, w: 0.3, h: 0.04 }],
    [{ text: "World", x: 0.1, y: 0.3, w: 0.2, h: 0.04 }]
  ]);
  ok(idx && Array.isArray(idx.pages), "buildIndex 返回 pages 数组");
  ok(idx.pages.length === 2, "两页");
  ok(JSON.stringify(idx.counts) === JSON.stringify([1, 1]), "counts 正确");
  ok(idx.pages[0][0].text === "Hello", "span 文本保留");
  ok(Math.abs(idx.pages[0][0].x - 0.1) < 1e-9, "span x 保留");

  // —— 脏数据容错 ——
  const empty = PdfText.buildIndex(null);
  ok(empty.pages.length === 0, "null → 空 pages");
  const bad = PdfText.buildIndex("notarray");
  ok(bad.pages.length === 0, "非数组 → 空 pages");
  const messy = PdfText.buildIndex([{ not: "array" }, "x"]);
  ok(messy.pages.length === 2 && messy.pages[0].length === 0, "页内非数组 → 空 span 数组");
  const dirty = PdfText.buildIndex([[{ text: "a", x: 2, y: -1, w: -5, h: "z" }]]);
  ok(dirty.pages[0][0].x === 1, "x 夹取到 1");
  ok(dirty.pages[0][0].y === 0, "y 夹取到 0");
  ok(dirty.pages[0][0].w === 0, "w 负值归 0");
  ok(dirty.pages[0][0].h === 0, "h 非数值归 0");
  const missText = PdfText.buildIndex([[{ x: 0.1 }]]);
  ok(missText.pages[0][0].text === "", "缺 text 补空串");

  // —— search 大小写不敏感 ——
  let hits = PdfText.search(idx, "hello");
  ok(hits.length === 1, "hello 命中 1 处");
  ok(hits[0].page === 1 && hits[0].text === "Hello", "命中页/文本正确");
  ok(typeof hits[0].x === "number" && typeof hits[0].y === "number", "命中带坐标");

  // —— search 跨页子串 ——
  hits = PdfText.search(idx, "o");
  ok(hits.length === 2, "'o' 跨页命中 2 处");
  const pages = hits.map(h => h.page).sort((a, b) => a - b);
  ok(JSON.stringify(pages) === JSON.stringify([1, 2]), "命中分布在 1、2 页");

  // —— search 无匹配 / 空 query ——
  ok(PdfText.search(idx, "zzz").length === 0, "无匹配返回空");
  ok(PdfText.search(idx, "   ").length === 0, "空白 query 返回空");
  ok(PdfText.search(idx, "").length === 0, "空 query 返回空");
  ok(PdfText.search(null, "x").length === 0, "损坏 index 容错");

  // —— hitPages ——
  ok(JSON.stringify(PdfText.hitPages(idx, "o")) === JSON.stringify([1, 2]), "hitPages 去重升序");

  // —— pageText / allText ——
  ok(PdfText.pageText(idx, 1) === "Hello", "pageText 第1页");
  ok(PdfText.pageText(idx, 2) === "World", "pageText 第2页");
  ok(PdfText.pageText(idx, 99) === "", "越界页返回空");
  const all = PdfText.allText(idx);
  ok(all.indexOf("Hello") !== -1 && all.indexOf("World") !== -1, "allText 含两页文本");
  ok(PdfText.allText(null) === "", "allText 损坏 index 容错");

  console.log(`✓ ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
