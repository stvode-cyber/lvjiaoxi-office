/* AB 测试：PDF 书签目录（Outline / TOC）解析与消费 */
const O = require("./app/js/modules/pdf-outline.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); }
}
function eq(name, a, b) { ok(name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", JSON.stringify(a) === JSON.stringify(b)); }

// 合成带书签树的最小 PDF：
//   1=Catalog  2=Outlines(First=3)  3=第一章(First=5,Next=4,Dest->8)
//   4=目录(UTF-16BE 标题, /A GoTo -> 9)  5=1.1 小节(子节点, Dest->8)
//   6=Pages  8=Page(第1页)  9=Page(第2页)
const pdf =
  "%PDF-1.4\n" +
  "1 0 obj << /Type /Catalog /Outlines 2 0 R /Pages 6 0 R >> endobj\n" +
  "2 0 obj << /Type /Outlines /First 3 0 R /Last 4 0 R /Count 3 >> endobj\n" +
  "3 0 obj << /Title (第一章 概述) /Parent 2 0 R /Next 4 0 R /First 5 0 R /Dest [8 0 R /XYZ 0 800 null] >> endobj\n" +
  "4 0 obj << /Title <FEFF76EE5F55> /Parent 2 0 R /Prev 3 0 R /A << /S /GoTo /D [9 0 R /Fit] >> >> endobj\n" +
  "5 0 obj << /Title (1.1 小节) /Parent 3 0 R /Dest [8 0 R /Fit] >> endobj\n" +
  "6 0 obj << /Type /Pages /Kids [8 0 R 9 0 R] /Count 2 >> endobj\n" +
  "8 0 obj << /Type /Page /Parent 6 0 R >> endobj\n" +
  "9 0 obj << /Type /Page /Parent 6 0 R >> endobj\n" +
  "trailer << /Root 1 0 R >>\n%%EOF";

// 1. 解析出两个顶层书签
const tree = O.parseRawOutline(pdf);
eq("top-level count", tree.length, 2);

// 2. 首节点标题与页码（/Dest -> obj 8 -> 第 1 页）
eq("node1 title", tree[0].title, "第一章 概述");
eq("node1 page", tree[0].page, 1);

// 3. 子节点（/First=5）
eq("node1 child count", tree[0].items.length, 1);
eq("child title", tree[0].items[0].title, "1.1 小节");
eq("child page", tree[0].items[0].page, 1);

// 4. 次节点：UTF-16BE 十六进制标题 + /A GoTo 页码（obj 9 -> 第 2 页）
eq("node2 title (utf16be)", tree[1].title, "目录");
eq("node2 page (GoTo)", tree[1].page, 2);

// 5. 扁平化带层级
const flat = O.flattenOutline(tree);
eq("flatten len", flat.length, 3);
eq("flatten levels", flat.map(f => f.level), [1, 2, 1]);
eq("flatten titles", flat.map(f => f.title), ["第一章 概述", "1.1 小节", "目录"]);

// 6. Markdown 导出（缩进 + 页码）
const md = O.toMarkdown(tree);
ok("md has node1", md.indexOf("- 第一章 概述  (p.1)") !== -1);
ok("md indents child", md.indexOf("  - 1.1 小节  (p.1)") !== -1);
ok("md has node2", md.indexOf("- 目录  (p.2)") !== -1);

// 7. HTML 导出（含 data-page 供跳转）
const html = O.toHtml(tree);
ok("html data-page=1", html.indexOf("data-page='1'") !== -1);
ok("html data-page=2", html.indexOf("data-page='2'") !== -1);
ok("html has title", html.indexOf("1.1 小节") !== -1);

// 8. 搜索：命中顶层节点
{
  const r = O.searchOutline(tree, "目录");
  eq("search top len", r.length, 1);
  eq("search top title", r[0].title, "目录");
}

// 9. 搜索：命中子节点时保留祖先
{
  const r = O.searchOutline(tree, "小节");
  eq("search child ancestors", r.length, 1);
  eq("search child parent kept", r[0].title, "第一章 概述");
  eq("search child kept", r[0].items[0].title, "1.1 小节");
}

// 10. 搜索空串返回原树
eq("search empty returns tree", O.searchOutline(tree, "").length, 2);

// 11. 归一化 pdf.js getOutline() 结果（dest 为页码）
{
  const raw = [{ title: "A", dest: 3, items: [{ title: "A1", dest: 4, items: [] }] }];
  const t = O.normalizeOutline(raw, null);
  eq("normalize page", t[0].page, 3);
  eq("normalize child page", t[0].items[0].page, 4);
}

// 12. 归一化（dest 为显式目标数组，按对象号映射页码）
{
  const raw = [{ title: "B", dest: [{ num: 8, gen: 0 }, { name: "XYZ" }], items: [] }];
  const t = O.normalizeOutline(raw, { 8: 1, 9: 2 });
  eq("normalize dest obj page", t[0].page, 1);
}

// 13. 无书签对象 → 空树
eq("no outline", O.parseRawOutline("1 0 obj << /Type /Catalog >> endobj"), []);

// 14. 空输入
eq("empty input", O.parseRawOutline(""), []);

// 15. 字面串转义（括号）
{
  const t = O.parseRawOutline("1 0 obj << /Type /Outlines /First 2 0 R >> endobj\n2 0 obj << /Title (a \\(b\\) c) /Dest [3 0 R /Fit] >> endobj\n3 0 obj << /Type /Page >> endobj");
  eq("escaped parens", t[0].title, "a (b) c");
}

console.log("AB 书签目录 Outline：" + (fail === 0 ? "通过 " + pass + " / " + pass + "，全部通过 ✅" : pass + " 通过, " + fail + " 失败 ❌"));
process.exit(fail === 0 ? 0 : 1);
