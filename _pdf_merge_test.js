/* 绿角犀 Office · PDF 合并/拆分 测试（含 PDF 1.5+ 对象流 ObjStm 支持） */
const PdfTool = require("./app/js/pdf-tool.js");

// 测试内字节工具（latin1 恒等，保二进制）
function toBytes(str) {
  const u = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 0xff;
  return u;
}
function toStr(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return s;
}
function concatBytes() {
  let n = 0; for (const a of arguments) n += a.length;
  const o = new Uint8Array(n); let p = 0;
  for (const a of arguments) { o.set(a, p); p += a.length; }
  return o;
}

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) pass++;
  else { fail++; console.error("  ✗ " + name); }
}

// 拼一个「正则可解析」的 PDF（不依赖精确 xref 偏移，parsePdf 用全文扫描对象）
function buildPdf(objs, rootNum) {
  let s = "%PDF-1.5\n";
  for (const num of Object.keys(objs)) s += num + " 0 obj\n" + objs[num] + "\nendobj\n";
  s += "xref\n0 1\n0000000000 65535 f \n";
  s += "trailer\n<< /Root " + rootNum + " 0 R >>\nstartxref\n0\n%%EOF\n";
  return toBytes(s);
}

// 1.4 风格：页面为内联对象
function buildPdf14() {
  return buildPdf({
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    4: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"
  }, 1);
}

// 1.5+ 风格：页面打包进 /ObjStm（FlateDecode 压缩）
async function buildPdf15() {
  const pageDicts = [
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"
  ];
  const nums = [10, 11];
  const N = 2;
  const bodies = [], offs = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    offs.push(acc);
    const body = nums[i] + " 0 " + pageDicts[i] + " ";
    bodies.push(body);
    acc += body.length;
  }
  const bodyStr = bodies.join("");
  const headStr = nums.map((n, i) => n + " " + offs[i]).join(" ") + " ";
  const comp = await PdfTool._deflate(concatBytes(toBytes(headStr), toBytes(bodyStr)));
  const dict = "<< /Type /ObjStm /N 2 /First " + headStr.length + " /Filter /FlateDecode /Length " + comp.length + " >>";
  const objStmInner = concatBytes(toBytes(dict), toBytes("stream\n"), comp, toBytes("\nendstream"));
  return buildPdf({
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [10 0 R 11 0 R] /Count 2 >>",
    99: toStr(objStmInner)
  }, 1);
}

(async () => {
  // —— A. parseObjStm 纯函数：偏移表 + 对象体解析 ——
  {
    // 偏移表与对象体一致构造（偏移相对 First，与 buildPdf15 同法），避免硬编码错位导致对象 11 解析不到
    const nums = [10, 11];
    const dicts = [
      "<< /Type /Page /MediaBox [0 0 1 1] >>",
      "<< /Type /Page /MediaBox [0 0 2 2] >>"
    ];
    const bodies = [], offs = [];
    let acc = 0;
    for (let i = 0; i < nums.length; i++) {
      offs.push(acc);
      const body = nums[i] + " 0 " + dicts[i] + " ";
      bodies.push(body);
      acc += body.length;
    }
    const bodyStr = bodies.join("");
    const headStr = nums.map((n, i) => n + " " + offs[i]).join(" ") + " ";
    const comp = toBytes(headStr + bodyStr);
    const dict = "<< /N 2 /First " + headStr.length + " >>";
    const m = PdfTool.parseObjStm(comp, dict);
    ok("parseObjStm 展开对象数=2", m.size === 2);
    ok("parseObjStm 对象10 dict 完整", toStr(m.get(10)) === dicts[0]);
    ok("parseObjStm 对象11 dict 完整", toStr(m.get(11)) === dicts[1]);
  }

  // —— B. 1.4 内联对象：合并/拆分回归 ——
  {
    const p14 = buildPdf14();
    const pa = await PdfTool.parsePdf(p14);
    ok("1.4 parsePdf 找到 2 页", pa.pages.length === 2);
    const merged = await PdfTool.mergePdfs([p14, p14]);
    const pm = await PdfTool.parsePdf(merged);
    ok("1.4 合并后 4 页", pm.pages.length === 4);
    const outs = await PdfTool.splitPdf(p14, [[1, 2]]);
    ok("1.4 拆分 1 个 range", outs.length === 1);
    const ps = await PdfTool.parsePdf(outs[0]);
    ok("1.4 拆分结果 2 页", ps.pages.length === 2);
  }

  // —— C. 1.5+ ObjStm：展开内部对象 ——
  {
    const p15 = await buildPdf15();
    const pa = await PdfTool.parsePdf(p15);
    ok("1.5+ parsePdf 展开 ObjStm 找到 2 页", pa.pages.length === 2);
    ok("1.5+ 页面对象号为 ObjStm 内的 10/11", pa.pages[0] === 10 && pa.pages[1] === 11);
    const merged = await PdfTool.mergePdfs([p15, p15]);
    const pm = await PdfTool.parsePdf(merged);
    ok("1.5+ 合并后 4 页", pm.pages.length === 4);
    const outs = await PdfTool.splitPdf(p15, [[1, 1]]);
    const ps = await PdfTool.parsePdf(outs[0]);
    ok("1.5+ 拆分单页成功", ps.pages.length === 1);
  }

  // —— D. 混合：1.4 与 1.5+ 合并 ——
  {
    const merged = await PdfTool.mergePdfs([buildPdf14(), await buildPdf15()]);
    const pm = await PdfTool.parsePdf(merged);
    ok("1.4+1.5 混合合并 4 页", pm.pages.length === 4);
  }

  console.log("PDF-MERGE TEST: " + pass + " passed, " + fail + " failed");
  if (fail) process.exit(1);
})().catch(e => { console.error("✗ 运行异常：" + e.message); process.exit(1); });
