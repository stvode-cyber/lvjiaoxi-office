/* 批注审阅清单导出（W）测试：纯逻辑，零依赖，Node 直跑 */
const S = require("./app/js/modules/pdf-anno-summary.js");
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log("  ✗ " + name); } }

const A = [
  { id: "a1", type: "highlight", page: 1, text: "重要条款", author: "张三" },
  { id: "a2", type: "note", page: 1, text: "待确认", author: "李四" },
  { id: "a3", type: "sign", page: 2, text: "", author: "王五" },
  { id: "a4", type: "link", page: 3, uri: "https://x.com", author: "" }
];

// TYPE_LABELS
ok("类型标签 高亮", S.TYPE_LABELS.highlight === "高亮");
ok("类型标签 链接", S.TYPE_LABELS.link === "链接");

// summarizeByPage
const sp = S.summarizeByPage(A);
ok("按页汇总 第1页=2", sp[1] === 2);
ok("按页汇总 第3页=1", sp[3] === 1);
ok("非法输入返回空", Object.keys(S.summarizeByPage(null)).length === 0);

// toMarkdown（按页分组）
const md = S.toMarkdown(A, { title: "测试清单" });
ok("MD 含标题", md.indexOf("# 测试清单") !== -1);
ok("MD 含总条数", md.indexOf("共 4 条批注") !== -1);
ok("MD 按页分节", md.indexOf("## 第 1 页") !== -1 && md.indexOf("## 第 2 页") !== -1);
ok("MD 含类型标签", md.indexOf("[高亮]") !== -1);
ok("MD 含作者", md.indexOf("张三") !== -1);

// toMarkdown（不分组）
const md2 = S.toMarkdown(A, { groupByPage: false });
ok("MD 不分组无二级标题", md2.indexOf("## 第") === -1);
ok("MD 空列表提示", S.toMarkdown([]).indexOf("无批注") !== -1);

// toCsv
const csv = S.toCsv(A);
const lines = csv.split("\n");
ok("CSV 含表头", lines[0] === "id,type,typeLabel,page,author,text,layer,visible");
ok("CSV 行数=表头+4", lines.length === 5);
ok("CSV 含转义文本", S.toCsv([{ id: "x", type: "note", page: 1, text: '含,逗号"引号' }]).indexOf('"含,逗号""引号"') !== -1);
ok("CSV 可见性默认1", S.toCsv([{ id: "x", type: "note", page: 1 }]).indexOf(",1") !== -1);

console.log(`批注审阅清单导出（W）：通过 ${pass} / ${pass + fail}${fail ? "，失败 " + fail : "，全部通过 ✅"}`);
process.exit(fail ? 1 : 0);
