/* PDF 文档属性解析（X）测试：纯逻辑，零依赖，Node 直跑 */
const P = require("./app/js/modules/pdf-props.js");
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log("  ✗ " + name); } }

// 构造一份含 Info 字典的最小 PDF 文本
const pdfText = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj
4 0 obj <<
  /Title (绿角犀使用手册)
  /Author (张三)
  /Subject (办公套件)
  /Creator (Lujax Writer)
  /Producer (Lujax PDF Engine)
  /CreationDate (D:20230829120000+08'00')
  /ModDate (D:20230901180000Z)
>> endobj
5 0 obj << /Info 4 0 R >> endobj
trailer << /Root 1 0 R /Info 4 0 R >>
%%EOF`;

const info = P.parseInfo(pdfText);
ok("解析标题", info.title === "绿角犀使用手册");
ok("解析作者", info.author === "张三");
ok("解析主题", info.subject === "办公套件");
ok("解析创建者", info.creator === "Lujax Writer");
ok("解析生产者", info.producer === "Lujax PDF Engine");
ok("解析创建时间(格式化)", info.creationdate === "2023-08-29 12:00");
ok("解析修改时间(格式化)", info.moddate === "2023-09-01 18:00");
ok("Info 在 trailer 引用也能解析", Object.keys(info).length >= 7);

// 十六进制串（ASCII 走 latin1 路径，避免多字节编码歧义）
const pdfHex = `%PDF-1.4
1 0 obj << /Info 2 0 R >> endobj
2 0 obj << /Title <4C756A6178> >> endobj
trailer << /Info 2 0 R >>
%%EOF`;
ok("十六进制标题解析", P.parseInfo(pdfHex).title === "Lujax");

// 转义括号
const pdfEsc = `%PDF-1.4
1 0 obj << /Info 2 0 R >> endobj
2 0 obj << /Title (含\\(括号\\)与\\n换行) >> endobj
trailer << /Info 2 0 R >>
%%EOF`;
const escInfo = P.parseInfo(pdfEsc);
ok("转义括号解析", escInfo.title === "含(括号)与\n换行");

// 无 Info
ok("无 Info 返回空对象", Object.keys(P.parseInfo("%PDF-1.4\ntrailer << /Root 1 0 R >>\n%%EOF")).length === 0);
ok("非法输入返回空对象", Object.keys(P.parseInfo("")).length === 0);

// formatPdfDate
ok("formatPdfDate 仅年", P.formatPdfDate("D:2023") === "2023");
ok("formatPdfDate 空", P.formatPdfDate("") === "");
ok("formatPdfDate 非标准返回原串", P.formatPdfDate("now") === "now");

console.log(`PDF 文档属性解析（X）：通过 ${pass} / ${pass + fail}${fail ? "，失败 " + fail : "，全部通过 ✅"}`);
process.exit(fail ? 1 : 0);
