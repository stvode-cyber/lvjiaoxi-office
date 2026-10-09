/* 绿角犀 Office · PDF→DOCX 三栏版面还原测试（纯逻辑，node 直跑）
   验证：
   A. _detectColumnSeps 递归二分 K-means（单栏 [] / 双栏 [sep] / 三栏 [sep1,sep2]）
   B. 端到端三栏重排（栏 1 读完 → 栏 2 → 栏 3，栏内按阅读序，标题 preserved 插头部）
   C. 双栏回归（基线对齐场景 —— 旧「合并行 x」输入退化成单峰检不出，items 级 x 可检出）
   D. 单栏回归（顺序不变 + 单栏+2 列表格不被误判多栏吞表格）
   坐标约定：多栏/表格体系按 y 大=视觉上方（与 renderTableBlock/双栏重排既有约定一致）；
            单栏 clusterLines 体系按 y 小=视觉上方（events.sort 升序）。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-convert.js");
  const C = global.OS.PdfConvert;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  /* ---------- A. _detectColumnSeps 纯函数 ---------- */
  ok("A1 单栏返回 []", C._detectColumnSeps(Array.from({ length: 20 }, (_, i) => 0.05 + (i % 3) * 0.005)).length === 0);
  const twoColXs = [...Array(10).fill(0.05), ...Array(10).fill(0.55)];
  const seps2 = C._detectColumnSeps(twoColXs);
  ok("A2 双栏返回 1 个分隔点且在 0.2~0.4", seps2.length === 1 && seps2[0] > 0.2 && seps2[0] < 0.4);
  const threeColXs = [...Array(10).fill(0.05), ...Array(10).fill(0.38), ...Array(10).fill(0.68)];
  const seps3 = C._detectColumnSeps(threeColXs);
  ok("A3 三栏返回 2 个分隔点", seps3.length === 2);
  ok("A4 三栏分隔点位置合理(sep1∈0.15~0.30, sep2∈0.45~0.60)",
    seps3.length === 2 && seps3[0] > 0.15 && seps3[0] < 0.30 && seps3[1] > 0.45 && seps3[1] < 0.60);
  ok("A5 样本不足(<10)返回 []", C._detectColumnSeps([0.05, 0.38, 0.68]).length === 0);
  ok("A6 坏数据容错(null/[])返回 []", C._detectColumnSeps(null).length === 0 && C._detectColumnSeps([]).length === 0);

  /* ---------- B. 端到端三栏重排 ---------- */
  // y-down 坐标（与 extractAllPagesSpans 一致，y 小=视觉顶部）：标题 y=0.04 最顶；
  // 跨栏行 y 从 0.13 递增（L1 阅读序第一行 y 最小，L10 y=0.40 栏底）
  const threeColSpans = [{ text: "三栏论文标题", x: 0.05, y: 0.04, h: 0.035 }];
  for (let i = 1; i <= 10; i++) {
    const y = 0.10 + i * 0.03;
    threeColSpans.push({ text: "L" + i, x: 0.05, y, h: 0.015 });
    threeColSpans.push({ text: "M" + i, x: 0.38, y, h: 0.015 });
    threeColSpans.push({ text: "R" + i, x: 0.68, y, h: 0.015 });
  }
  const html3 = C.pdfToDocxHtml([threeColSpans]);
  const iL1 = html3.indexOf("L1"), iL10 = html3.indexOf("L10");
  const iM1 = html3.indexOf("M1"), iM10 = html3.indexOf("M10");
  const iR1 = html3.indexOf("R1"), iR10 = html3.indexOf("R10");
  ok("B1 三栏全部文本都在", iL1 >= 0 && iL10 >= 0 && iM1 >= 0 && iM10 >= 0 && iR1 >= 0 && iR10 >= 0);
  ok("B2 栏间顺序：栏1全部 → 栏2 → 栏3", iL1 >= 0 && iL10 < iM1 && iM10 < iR1);
  ok("B3 栏内阅读序：L1 在 L10 前、M1 在 M10 前、R1 在 R10 前", iL1 < iL10 && iM1 < iM10 && iR1 < iR10);
  const iTitle = html3.indexOf("三栏论文标题");
  ok("B4 标题 preserved 插在所有栏文本之前", iTitle >= 0 && iTitle < iL1);
  ok("B5 标题渲染为 <h2>", /<h2>三栏论文标题<\/h2>/.test(html3));

  /* ---------- C. 双栏回归（基线对齐 —— 合并行 x 全=左栏起点的场景） ---------- */
  const twoColSpans = [];
  for (let i = 1; i <= 10; i++) {
    const y = 0.10 + i * 0.03;
    twoColSpans.push({ text: "A" + i, x: 0.05, y, h: 0.015 });
    twoColSpans.push({ text: "B" + i, x: 0.55, y, h: 0.015 });
  }
  const html2 = C.pdfToDocxHtml([twoColSpans]);
  const iA1 = html2.indexOf("A1"), iA10 = html2.indexOf("A10");
  const iB1 = html2.indexOf("B1"), iB10 = html2.indexOf("B10");
  ok("C1 双栏检出：左栏全部在右栏前", iA1 >= 0 && iA10 >= 0 && iB1 >= 0 && iA10 < iB1);
  ok("C2 双栏栏内阅读序：A1<A10、B1<B10", iA1 < iA10 && iB1 < iB10);

  /* ---------- D. 单栏回归 ---------- */
  // 单栏体系 y 小=视觉上方：P1 y 最小（阅读序第一行）
  const singleSpans = [];
  for (let i = 1; i <= 10; i++) singleSpans.push({ text: "P" + i, x: 0.05, y: 0.08 + i * 0.04, h: 0.015 });
  const html1 = C.pdfToDocxHtml([singleSpans]);
  const iP1 = html1.indexOf("P1"), iP10 = html1.indexOf("P10");
  ok("D1 单栏顺序不变（P1 在 P10 前）", iP1 >= 0 && iP1 < iP10);

  // 单栏正文 + 2 列表格：表格两列 {0.3,0.5} 在右子集形成假双峰，every 判定 + 回滚防吞
  const mixedSpans = [];
  for (let i = 1; i <= 10; i++) mixedSpans.push({ text: "正文" + i, x: 0.05, y: 0.04 + i * 0.03, h: 0.015 });
  const tblY = [0.40, 0.44, 0.48, 0.52, 0.56];
  const tblHead = [["H1", "H2"], ["c11", "c12"], ["c21", "c22"], ["c31", "c32"], ["c41", "c42"]];
  tblY.forEach((y, ri) => {
    mixedSpans.push({ text: tblHead[ri][0], x: 0.30, y, h: 0.015 });
    mixedSpans.push({ text: tblHead[ri][1], x: 0.50, y, h: 0.015 });
  });
  const htmlMix = C.pdfToDocxHtml([mixedSpans]);
  ok("D2 单栏+2列表格：表格不被多栏误吞（含 <table>）", /<table/.test(htmlMix));
  ok("D3 表格单元格内容保留在表格内", /<td>c21<\/td>/.test(htmlMix) && /<td>c22<\/td>/.test(htmlMix));
  ok("D4 正文行保留", htmlMix.indexOf("正文1") >= 0 && htmlMix.indexOf("正文10") >= 0);

  console.log((fail === 0 ? "✓ 全部通过" : "✗ 有失败") + "：通过 " + pass + " / " + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})();
