/*
 * _pdf_formfields_test.js · OS.PdfFormFields 单测（node 直接跑，零依赖）
 */
const C = require("C:/Users/Administrator/Desktop/绿角犀办公软件/app/js/modules/pdf-formfields.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name); }
}

function enc(s) { return new TextEncoder().encode(s); }

// 无 AcroForm 的 PDF
const noForm = enc("%PDF-1.7\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n");

// 含 AcroForm 的完整 PDF
const pdf =
"%PDF-1.7\n" +
// 1 catalog
"1 0 obj\n<< /AcroForm 2 0 R /Pages 9 0 R >>\nendobj\n" +
// 2 AcroForm
"2 0 obj\n<< /Fields [ 3 0 R 6 0 R 8 0 R 10 0 R 12 0 R 13 0 R 15 0 R ] >>\nendobj\n" +
// 3 文本框（含 widget，第 1 页）
"3 0 obj\n<< /FT /Tx /T (Name) /V (张三) /Ff 4096 /Kids [ 4 0 R ] >>\nendobj\n" +
"4 0 obj\n<< /Subtype /Widget /P 5 0 R >>\nendobj\n" +
// 5 第 1 页
"5 0 obj\n<< /Type /Page >>\nendobj\n" +
// 6 复选框
"6 0 obj\n<< /FT /Btn /T (Agree) /V /Yes /Ff 0 /Kids [ 7 0 R ] >>\nendobj\n" +
"7 0 obj\n<< /Subtype /Widget /P 5 0 R >>\nendobj\n" +
// 8 下拉框（一维 /Opt，无 widget 直接 terminal；Ff 131072 = bit18 Combo 标志）
"8 0 obj\n<< /FT /Ch /T (City) /Ff 131072 /Opt [ (GZ) (SZ) (BJ) ] /V (GZ) >>\nendobj\n" +
// 10 单选按钮组
"10 0 obj\n<< /FT /Btn /T (Gender) /Ff 32768 /V /M /Kids [ 11 0 R ] >>\nendobj\n" +
"11 0 obj\n<< /Subtype /Widget /P 5 0 R >>\nendobj\n" +
// 12 文本框（只读 + 必填，Ff = 1|2 = 3）
"12 0 obj\n<< /FT /Tx /T (Note) /Ff 3 /V (hi) >>\nendobj\n" +
// 13 分组节点（无 /FT，含 /Kids 子字段）
"13 0 obj\n<< /T (Group) /Kids [ 14 0 R ] >>\nendobj\n" +
"14 0 obj\n<< /FT /Tx /T (Child) /V (x) >>\nendobj\n" +
// 15 下拉框（二维 /Opt）
"15 0 obj\n<< /FT /Ch /T (Color) /Ff 262144 /Opt [ [ (R) (Red) ] [ (G) (Green) ] ] /V (R) >>\nendobj\n" +
// 9 /Pages 树
"9 0 obj\n<< /Type /Pages /Kids [ 5 0 R ] >>\nendobj\n" +
"trailer\n<< >>\n%%EOF\n";
const bytes = enc(pdf);

console.log("PDF 表单字段提取 · 单测");

// 1) 无表单
const r0 = C.parseFormFields(noForm);
ok("无 AcroForm → hasForm=false", r0.hasForm === false);
ok("无 AcroForm → formCount=0", r0.formCount === 0);

// 2) 主解析
const r = C.parseFormFields(bytes);
ok("有 AcroForm → hasForm=true", r.hasForm === true);
ok("字段总数=7", r.formCount === 7);
ok("类型统计 Tx=3", r.byType.Tx === 3);
ok("类型统计 Btn=2", r.byType.Btn === 2);
ok("类型统计 Ch=2", r.byType.Ch === 2);
ok("无签名域 hasSigField=false", r.hasSigField === false);

// 3) 文本框 Name（多行 flag + 页定位 + 中文值）
const nameF = r.fields.find(f => f.name === "Name");
ok("找到 Name 字段", !!nameF);
ok("Name 类型=文本框", nameF && nameF.typeLabel === "文本框");
ok("Name 值=张三", nameF && nameF.value === "张三");
ok("Name 多行标志 on", nameF && nameF.flags.some(x => x.key === "multiline" && x.on));
ok("Name 在第 1 页", nameF && nameF.page === 1);

// 4) 复选框
const agree = r.fields.find(f => f.name === "Agree");
ok("Agree 类型=复选框", agree && agree.typeLabel === "复选框");
ok("Agree 值=/Yes", agree && agree.value === "Yes");

// 5) 单选
const gender = r.fields.find(f => f.name === "Gender");
ok("Gender 类型=单选按钮", gender && gender.typeLabel === "单选按钮");
ok("Gender 单选标志 on", gender && gender.flags.some(x => x.key === "radio" && x.on));

// 6) 下拉框（一维 /Opt）
const city = r.fields.find(f => f.name === "City");
ok("City 类型=下拉框", city && city.typeLabel === "下拉框");
ok("City 下拉标志 on", city && city.flags.some(x => x.key === "combo" && x.on));
ok("City 选项数=3", city && city.options && city.options.length === 3);
ok("City 选项[0]=GZ", city && city.options[0].label === "GZ");
ok("City 值=GZ", city && city.value === "GZ");

// 7) 只读 + 必填
const note = r.fields.find(f => f.name === "Note");
ok("Note 只读 on", note && note.readOnly === true);
ok("Note 必填 on", note && note.required === true);

// 8) 分组节点递归（Group → Child）
const child = r.fields.find(f => f.name === "Child");
ok("分组子字段 Child 被递归提取", !!child);
ok("Child 类型=文本框", child && child.typeLabel === "文本框");

// 9) 二维 /Opt
const color = r.fields.find(f => f.name === "Color");
ok("Color 二维选项数=2", color && color.options.length === 2);
ok("Color 选项[0] 导出=Red", color && color.options[0].label === "Red" && color.options[0].export === "R");

// 10) summarize / markdown / html
const sum = C.summarize(r);
ok("summarize.formCount=7", sum.formCount === 7);
ok("summarize.必填=1", sum.required === 1);
ok("summarize.只读=1", sum.readOnly === 1);
const md = C.toMarkdown(r, { title: "测试文档 表单字段" });
ok("toMarkdown 含标题", md.indexOf("测试文档 表单字段") >= 0);
ok("toMarkdown 含张三", md.indexOf("张三") >= 0);
const html = C.toHtml(r);
ok("toHtml 非空且含字段数", html.indexOf("个字段") >= 0);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
