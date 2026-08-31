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

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
