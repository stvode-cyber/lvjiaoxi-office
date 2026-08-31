/* PDF→Excel 多表格隔离 + 列边界容错测试
 * 验证：混排页（文字段 + 多表）各表独立分列不串列；缺列补空；columns/heuristic 兼容；空输入。
 * 运行：node _pdf_convert_excel_block_test.js
 */
global.window = global;
global.OS = {};
require("./app/js/modules/pdf-convert.js");
const C = global.OS.PdfConvert;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("✗ " + name); } }

// 构造混排页：段落标题 + 表1(姓名|年龄|城市) + 说明段 + 表2(产品|单价|库存,不同列布局)
function mixedPage() {
  return [
    { text: "销售表", x: 0.10, y: 0.05, h: 0.02 },
    { text: "姓名", x: 0.08, y: 0.10, h: 0.015 },
    { text: "年龄", x: 0.40, y: 0.10, h: 0.015 },
    { text: "城市", x: 0.72, y: 0.10, h: 0.015 },
    { text: "张三", x: 0.08, y: 0.14, h: 0.015 },
    { text: "28", x: 0.40, y: 0.14, h: 0.015 },
    { text: "广州", x: 0.72, y: 0.14, h: 0.015 },
    { text: "以上为销售数据", x: 0.10, y: 0.30, h: 0.018 },
    { text: "产品", x: 0.08, y: 0.40, h: 0.015 },
    { text: "单价", x: 0.35, y: 0.40, h: 0.015 },
    { text: "库存", x: 0.60, y: 0.40, h: 0.015 },
    { text: "苹果", x: 0.08, y: 0.44, h: 0.015 },
    { text: "5.0", x: 0.35, y: 0.44, h: 0.015 },
    { text: "100", x: 0.60, y: 0.44, h: 0.015 }
  ];
}
function rows(csv) { return csv.trim().split("\n").map(r => r.split(",")); }

// 1. 混排页 auto：表1 三列正确
{
  const csv = C.pdfToExcel([mixedPage()], { mode: "auto" });
  const rs = rows(csv);
  const zhang = rs.find(r => r[0] === "张三");
  ok("混排·表1 行三列正确", zhang && zhang.join(",") === "张三,28,广州");
}
// 2. 混排页：表2 三列正确（不同列布局，未被表1 分隔符串列）
{
  const csv = C.pdfToExcel([mixedPage()], { mode: "auto" });
  const rs = rows(csv);
  const apple = rs.find(r => r[0] === "苹果");
  ok("混排·表2 行三列正确", apple && apple.join(",") === "苹果,5.0,100");
}
// 3. 混排页：说明段单格
{
  const csv = C.pdfToExcel([mixedPage()], { mode: "auto" });
  ok("混排·说明段单格", csv.indexOf("以上为销售数据") >= 0 && !/,以上为销售数据/.test(csv));
}
// 4. 混排页：标题单格
{
  const csv = C.pdfToExcel([mixedPage()], { mode: "auto" });
  ok("混排·标题单格", csv.trim().split("\n")[0] === "销售表");
}
// 5. clusterTableBlocks 返回 2 块
{
  const lines = C._lineItems(mixedPage());
  const gapThresh = 0.024;
  const tbl = lines.filter(l => C._isTableLike(l.items, gapThresh));
  ok("clusterTableBlocks 分 2 块", C._clusterTableBlocks(tbl, gapThresh).length === 2);
}
// 6. 单表页 auto 仍正确（回归）
{
  const page = [
    { text: "A", x: 0.08, y: 0.10, h: 0.015 },
    { text: "B", x: 0.40, y: 0.10, h: 0.015 },
    { text: "C", x: 0.72, y: 0.10, h: 0.015 },
    { text: "1", x: 0.08, y: 0.14, h: 0.015 },
    { text: "2", x: 0.40, y: 0.14, h: 0.015 },
    { text: "3", x: 0.72, y: 0.14, h: 0.015 }
  ];
  const csv = C.pdfToExcel([page], { mode: "auto" });
  ok("单表页 auto 三列", csv.indexOf("1,2,3") >= 0);
}
// 7. columns 模式：多行单表页与 auto 一致（同集合定列边界）
{
  const page = [
    { text: "A", x: 0.08, y: 0.10, h: 0.015 },
    { text: "B", x: 0.40, y: 0.10, h: 0.015 },
    { text: "C", x: 0.72, y: 0.10, h: 0.015 },
    { text: "1", x: 0.08, y: 0.14, h: 0.015 },
    { text: "2", x: 0.40, y: 0.14, h: 0.015 },
    { text: "3", x: 0.72, y: 0.14, h: 0.015 }
  ];
  const auto = C.pdfToExcel([page], { mode: "auto" }).trim();
  const cols = C.pdfToExcel([page], { mode: "columns" }).trim();
  ok("columns 与 auto 多行单表一致", auto === cols && auto.indexOf("1,2,3") >= 0);
}
// 7b. 单行表格：auto 保守不分列；columns 仍可强制分列（兜底）
{
  const page = [
    { text: "A", x: 0.08, y: 0.10, h: 0.015 },
    { text: "B", x: 0.40, y: 0.10, h: 0.015 },
    { text: "C", x: 0.72, y: 0.10, h: 0.015 }
  ];
  const auto = C.pdfToExcel([page], { mode: "auto" }).trim();
  const cols = C.pdfToExcel([page], { mode: "columns" }).trim();
  ok("单行表 auto 保守单格", auto === "ABC");
  ok("单行表 columns 强制分列", cols === "A,B,C");
}
// 8. 列边界容错：某行缺中间列 → 空列补空
{
  const page = [
    { text: "姓名", x: 0.08, y: 0.10, h: 0.015 },
    { text: "年龄", x: 0.40, y: 0.10, h: 0.015 },
    { text: "城市", x: 0.72, y: 0.10, h: 0.015 },
    { text: "张三", x: 0.08, y: 0.14, h: 0.015 },
    { text: "广州", x: 0.72, y: 0.14, h: 0.015 } // 缺年龄列
  ];
  const csv = C.pdfToExcel([page], { mode: "auto" });
  const rs = rows(csv);
  const zhang = rs.find(r => r[0] === "张三");
  ok("缺列补空(张三,,广州)", zhang && zhang.join(",") === "张三,,广州");
}
// 9. 段落型 prose 降级单格（无大 gap）
{
  const page = [
    { text: "本", x: 0.10, y: 0.10, h: 0.02 },
    { text: "报告", x: 0.18, y: 0.10, h: 0.02 },
    { text: "总结", x: 0.28, y: 0.10, h: 0.02 }
  ];
  const csv = C.pdfToExcel([page], { mode: "auto" });
  ok("prose 降级单格", csv.trim() === "本报告总结");
}
// 10. 多页 pageMarkers
{
  const p1 = [{ text: "X", x: 0.08, y: 0.10, h: 0.015 }, { text: "Y", x: 0.40, y: 0.10, h: 0.015 }];
  const p2 = [{ text: "M", x: 0.08, y: 0.10, h: 0.015 }, { text: "N", x: 0.40, y: 0.10, h: 0.015 }];
  const csv = C.pdfToExcel([p1, p2], { mode: "auto", pageMarkers: true });
  ok("pageMarkers 第二页标记", csv.indexOf("# 第 2 页") >= 0);
}
// 11. 空输入返回空串
ok("空输入返回空串", C.pdfToExcel([], { mode: "auto" }) === "");
ok("null 输入返回空串", C.pdfToExcel(null) === "");

// 12. heuristic 模式兼容（按 | / 多空格分列）
{
  const page = [{ text: "甲 | 乙 | 丙", x: 0.10, y: 0.10, h: 0.015 }];
  const csv = C.pdfToExcel([page], { mode: "heuristic" });
  ok("heuristic | 分列", csv.trim() === "甲,乙,丙");
}

console.log((fail === 0 ? "✓ 全部通过" : "✗ 有失败") + "：通过 " + pass + " / " + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
