/* 绿角犀 Office · PDF→Excel(CSV) 文本提取 测试（纯逻辑，node 直跑）
   验证 pdfToExcel 的分列启发式、CSV 转义、页码分隔与坏数据容错。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/pdf-convert.js");
  const C = global.OS.PdfConvert;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  // 假 pages：每行一个 span，text 内含分隔符（模拟聚类后的整行文本）
  const pages = [
    [ { text: "姓名|年龄|城市", x: 0.1, y: 0.1, h: 0.02 } ],
    [ { text: "张三|28|广州", x: 0.1, y: 0.2, h: 0.015 } ],
    [ { text: "李四|31|深圳", x: 0.1, y: 0.3, h: 0.015 } ]
  ];

  // —— splitCells 分列启发式 ——
  ok("splitCells | 分3列", JSON.stringify(C._splitCells("姓名|年龄|城市")) === JSON.stringify(["姓名", "年龄", "城市"]));
  ok("splitCells 制表符分2列", JSON.stringify(C._splitCells("a\tb")) === JSON.stringify(["a", "b"]));
  ok("splitCells 2+空格分2列", JSON.stringify(C._splitCells("a  b")) === JSON.stringify(["a", "b"]));
  ok("splitCells 单空格整行单列", JSON.stringify(C._splitCells("a b c")) === JSON.stringify(["a b c"]));
  ok("splitCells 无分隔整行单列", JSON.stringify(C._splitCells("single")) === JSON.stringify(["single"]));

  // —— csvCell 转义 ——
  ok("csvCell 含逗号加引号", C._csvCell("has,comma") === '"has,comma"');
  ok("csvCell 含引号双写", C._csvCell('a"b') === '"a""b"');
  ok("csvCell 含逗号+引号组合", C._csvCell('a,"b') === '"a,""b"');
  ok("csvCell 普通文本不加引号", C._csvCell("plain") === "plain");

  // —— pdfToExcel 整体 ——
  const csv = C.pdfToExcel(pages);
  ok("pdfToExcel 含表头", csv.indexOf("姓名,年龄,城市") >= 0);
  ok("pdfToExcel 含数据行", csv.indexOf("张三,28,广州") >= 0 && csv.indexOf("李四,31,深圳") >= 0);
  ok("pdfToExcel 默认无页码分隔", csv.indexOf("# 第") < 0);

  const csv2 = C.pdfToExcel(pages, { pageMarkers: true });
  ok("pdfToExcel pageMarkers 插入页码分隔", csv2.indexOf("# 第 2 页") >= 0);

  // 多空格分列场景（表格型）
  const tablePages = [ [ { text: "10  20  30", x: 0.1, y: 0.1, h: 0.015 } ] ];
  ok("pdfToExcel 多空格分列成 3 字段", C.pdfToExcel(tablePages).indexOf("10,20,30") >= 0);

  // —— 坏数据容错 ——
  ok("pdfToExcel 空数组返回空串", C.pdfToExcel([]) === "");
  ok("pdfToExcel null 返回空串", C.pdfToExcel(null) === "");
  ok("pdfToExcel 非数组返回空串", C.pdfToExcel("x") === "");
  ok("pdfToExcel 含空页不崩", typeof C.pdfToExcel([[], null, [ { text: "ok", x: 0, y: 0, h: 0.01 } ]]) === "string");

  // —— pdfToExcelRows（新 API：返回 rows[][] 而非 CSV）——
  const rows = C.pdfToExcelRows(pages);
  ok("pdfToExcelRows 返回数组", Array.isArray(rows));
  ok("pdfToExcelRows 行数=3", rows.length === 3);
  ok("pdfToExcelRows 首行3列", JSON.stringify(rows[0]) === JSON.stringify(["姓名", "年龄", "城市"]));
  ok("pdfToExcelRows 数据行正确", rows[1][0] === "张三" && rows[2][2] === "深圳");

  const rows2 = C.pdfToExcelRows(pages, { pageMarkers: true });
  ok("pdfToExcelRows pageMarkers 含页码行", rows2.some(r => r[0] && r[0].indexOf("# 第") === 0));

  ok("pdfToExcelRows 空数组返回空", C.pdfToExcelRows([]).length === 0);
  ok("pdfToExcelRows null 返回空", C.pdfToExcelRows(null).length === 0);

  // —— rowsToCells（新 API：rows[][] → buildXlsx cells 格式）——
  const cells = C.rowsToCells([["A1", "B1", "C1"], ["A2", "B2"]]);
  ok("rowsToCells 生成 A1 引用", cells["A1"] && cells["A1"].v === "A1");
  ok("rowsToCells 生成 C1 引用", cells["C1"] && cells["C1"].v === "C1");
  ok("rowsToCells 缺列留空", cells["C2"] === undefined || cells["C2"] === null);
  ok("rowsToCells 引用数=5（3+2）", Object.keys(cells).length === 5);

  // 空行容错
  const cells2 = C.rowsToCells([[], ["only"]]);
  ok("rowsToCells 空行填 A1 空值", cells2["A1"] && cells2["A1"].v === "");
  ok("rowsToCells 正常行 A2 值正确", cells2["A2"] && cells2["A2"].v === "only");

  // 大范围列名验证（Z → AA 边界）
  const wideRows = [ Array.from({length: 27}, (_, i) => "c" + (i+1)) ];
  const wideCells = C.rowsToCells(wideRows);
  ok("rowsToCells Z 列正确", wideCells["Z1"] && wideCells["Z1"].v === "c26");
  ok("rowsToCells AA 列正确（Z 下一列）", wideCells["AA1"] && wideCells["AA1"].v === "c27");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
