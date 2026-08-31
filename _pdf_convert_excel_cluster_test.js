/* 绿角犀 Office · PDF→Excel(CSV) 坐标列边界聚类 测试（纯逻辑，node 直跑）
   验证 pdfToExcel 的 columns/auto 模式：基于逐项 x 坐标检测列边界、跨行对齐、
   段落型行降级为单格；并验证 heuristic 模式与坏数据容错保持兼容。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-convert.js");
  const C = global.OS.PdfConvert;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  // 真实型表格：一页 3 行，每行 3 个独立 span（姓名/年龄/城市），x 有明显列间隔
  const tablePages = [ [
    { text: "姓名", x: 0.08, y: 0.10, h: 0.018 },
    { text: "年龄", x: 0.40, y: 0.10, h: 0.018 },
    { text: "城市", x: 0.72, y: 0.10, h: 0.018 },
    { text: "张三", x: 0.08, y: 0.18, h: 0.015 },
    { text: "28",  x: 0.40, y: 0.18, h: 0.015 },
    { text: "广州", x: 0.72, y: 0.18, h: 0.015 },
    { text: "李四", x: 0.08, y: 0.26, h: 0.015 },
    { text: "31",  x: 0.40, y: 0.26, h: 0.015 },
    { text: "深圳", x: 0.72, y: 0.26, h: 0.015 }
  ] ];

  const cols = C.pdfToExcel(tablePages, { mode: "columns" });
  ok("columns 表头对齐 3 列", /姓名,年龄,城市/.test(cols));
  ok("columns 数据行对齐 3 列", /张三,28,广州/.test(cols) && /李四,31,深圳/.test(cols));
  ok("columns 不含退化竖线", !/,姓名|年龄,/.test(cols.replace(/姓名,年龄,城市/, "")));

  // auto 模式：含表 → 自动坐标聚类
  const auto = C.pdfToExcel(tablePages, { mode: "auto" });
  ok("auto 同样对齐 3 列", /姓名,年龄,城市/.test(auto) && /张三,28,广州/.test(auto));

  // 段落型行（词间距小，无大 gap）→ 降级单格，不误分列
  const prosePages = [ [
    { text: "本报告", x: 0.10, y: 0.10, h: 0.02 },
    { text: "总结了", x: 0.14, y: 0.10, h: 0.02 },
    { text: "全年", x: 0.18, y: 0.10, h: 0.02 },
    { text: "经营", x: 0.22, y: 0.10, h: 0.02 },
    { text: "情况", x: 0.26, y: 0.10, h: 0.02 }
  ] ];
  const prose = C.pdfToExcel(prosePages, { mode: "auto" });
  ok("段落型行降级为单格", prose.trim() === "本报告 总结了 全年 经营 情况");

  // 混合页：标题（宽 span，单格）+ 表格（对齐 3 列）
  const mixPages = [ [
    { text: "员工花名册", x: 0.10, y: 0.05, h: 0.025 },
    { text: "姓名", x: 0.08, y: 0.15, h: 0.018 },
    { text: "年龄", x: 0.40, y: 0.15, h: 0.018 },
    { text: "城市", x: 0.72, y: 0.15, h: 0.018 },
    { text: "王五", x: 0.08, y: 0.23, h: 0.015 },
    { text: "45",  x: 0.40, y: 0.23, h: 0.015 },
    { text: "北京", x: 0.72, y: 0.23, h: 0.015 }
  ] ];
  const mix = C.pdfToExcel(mixPages, { mode: "columns" });
  ok("混合页 标题单格", /员工花名册/.test(mix));
  ok("混合页 表格仍对齐 3 列", /王五,45,北京/.test(mix));

  // heuristic 模式保持旧行为（单 span 含 | → 3 列）
  const legacy = [ [ { text: "姓名|年龄|城市", x: 0.1, y: 0.1, h: 0.02 } ] ];
  ok("heuristic 仍按 | 分列", C.pdfToExcel(legacy, { mode: "heuristic" }).indexOf("姓名,年龄,城市") >= 0);

  // 工具函数单测
  ok("_isTableLike 多列行判真", C._isTableLike([
    { text: "a", x: 0.08, y: 0.1, h: 0.015 }, { text: "b", x: 0.40, y: 0.1, h: 0.015 }
  ], 0.02) === true);
  ok("_isTableLike 段落行判假", C._isTableLike([
    { text: "本", x: 0.10, y: 0.1, h: 0.015 }, { text: "报", x: 0.13, y: 0.1, h: 0.015 }
  ], 0.02) === false);
  ok("_detectSeparators 返回 2 个分隔符(3列)", (function () {
    const ls = [ { items: [
      { text: "a", x: 0.08, y: 0.1, h: 0.015 }, { text: "b", x: 0.40, y: 0.1, h: 0.015 }, { text: "c", x: 0.72, y: 0.1, h: 0.015 }
    ] } ];
    return C._detectSeparators(ls, 0.02).length === 2;
  })());
  ok("_lineToCells 跨分隔符对齐", (function () {
    const items = [
      { text: "a", x: 0.08, y: 0.1, h: 0.015 }, { text: "b", x: 0.40, y: 0.1, h: 0.015 }, { text: "c", x: 0.72, y: 0.1, h: 0.015 }
    ];
    const cells = C._lineToCells(items, [0.24, 0.56]);
    return cells.length === 3 && cells[0] === "a" && cells[1] === "b" && cells[2] === "c";
  })());

  // 坏数据容错
  ok("columns 空数组返回空串", C.pdfToExcel([], { mode: "columns" }) === "");
  ok("columns null 返回空串", C.pdfToExcel(null, { mode: "columns" }) === "");
  ok("columns 含空页不崩", typeof C.pdfToExcel([[], null, [ { text: "ok", x: 0, y: 0, h: 0.01 } ]], { mode: "columns" }) === "string");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
