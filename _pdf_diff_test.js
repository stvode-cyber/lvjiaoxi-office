/* AA 测试：PDF 文档对比（文本层 Diff）— LCS 行/词级差异 + 摘要 */
const D = require("./app/js/modules/pdf-diff.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); }
}
function eq(name, a, b) { ok(name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", JSON.stringify(a) === JSON.stringify(b)); }

// 1. 完全相同 → 全 eq，无增删
{
  const r = D.diffDocs("a\nb\nc", "a\nb\nc");
  eq("identical unchanged", r.summary.unchanged, 3);
  eq("identical added", r.summary.added, 0);
  eq("identical removed", r.summary.removed, 0);
  ok("identical all eq", r.diff.every(o => o.type === "eq"));
}

// 2. 新增一行
{
  const r = D.diffDocs("a\nb", "a\nb\nc");
  eq("add: added", r.summary.added, 1);
  eq("add: removed", r.summary.removed, 0);
  eq("add: unchanged", r.summary.unchanged, 2);
}

// 3. 删除一行
{
  const r = D.diffDocs("a\nb\nc", "a\nb");
  eq("del: added", r.summary.added, 0);
  eq("del: removed", r.summary.removed, 1);
}

// 4. 修改一行（删旧 + 加新）
{
  const r = D.diffDocs("a\nx\nc", "a\ny\nc");
  eq("change: added", r.summary.added, 1);
  eq("change: removed", r.summary.removed, 1);
  eq("change: unchanged", r.summary.unchanged, 2);
}

// 5. 忽略空白差异
{
  const r1 = D.diffDocs("a   b", "a b");
  eq("ws off: removed", r1.summary.removed, 1);
  const r2 = D.diffDocs("a   b", "a b", { ignoreWhitespace: true });
  eq("ws on: unchanged", r2.summary.unchanged, 1);
  eq("ws on: added", r2.summary.added, 0);
}

// 6. 忽略大小写
{
  const r1 = D.diffDocs("Hello", "hello");
  eq("ci off: removed", r1.summary.removed, 1);
  const r2 = D.diffDocs("Hello", "hello", { ignoreCase: true });
  eq("ci on: unchanged", r2.summary.unchanged, 1);
}

// 7. 空文档 A（对方全为新增）
{
  const r = D.diffDocs("", "x\ny");
  eq("emptyA added", r.summary.added, 2);
  eq("emptyA removed", r.summary.removed, 0);
  eq("emptyA linesA", r.linesA, 0);
}

// 8. 空文档 B（当前全为删除）
{
  const r = D.diffDocs("x\ny", "");
  eq("emptyB removed", r.summary.removed, 2);
  eq("emptyB added", r.summary.added, 0);
}

// 9. 词级差异
{
  const r = D.diffWords("the cat sat", "the dog sat");
  eq("words added", r.filter(o => o.type === "add").length, 1);
  eq("words removed", r.filter(o => o.type === "del").length, 1);
}

// 10. 摘要百分比
{
  const ops = [{ type: "eq" }, { type: "eq" }, { type: "add" }, { type: "del" }];
  const s = D.summarize(ops);
  eq("pct total", s.total, 4);
  eq("pct addedPct", s.addedPct, 25);
  eq("pct removedPct", s.removedPct, 25);
  eq("pct unchangedPct", s.unchangedPct, 50);
}

// 11. diffDocs 结构
{
  const r = D.diffDocs("a\nb", "a\nc");
  ok("struct has diff array", Array.isArray(r.diff));
  ok("struct has summary", typeof r.summary === "object");
  eq("struct linesA", r.linesA, 2);
  eq("struct linesB", r.linesB, 2);
}

// 12. 整段重排 → LCS 仍找到 1 个公共行（标准 diff 行为）
{
  const r = D.diffDocs("line1\nline2", "line2\nline1");
  eq("reorder unchanged", r.summary.unchanged, 1);
  eq("reorder added", r.summary.added, 1);
  eq("reorder removed", r.summary.removed, 1);
}

// 13. 数组输入
{
  const r = D.diffLines(["x", "y"], ["x", "z"]);
  eq("array eq x", r[0].type, "eq");
  eq("array del y", r[1].type, "del");
  eq("array add z", r[2].type, "add");
}

// 14. 词法切分保留空白
{
  const t = D._tokenizeWords("a  b");
  eq("tokenize len", t.length, 3);
  eq("tokenize mid", t[1], "  ");
}

console.log("AA 文档对比 Diff：" + (fail === 0 ? "通过 " + pass + " / " + pass + "，全部通过 ✅" : pass + " 通过, " + fail + " 失败 ❌"));
process.exit(fail === 0 ? 0 : 1);
