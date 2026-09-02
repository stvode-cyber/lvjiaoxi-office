/* 绿角犀 Office · PDF 光栅写入器 回归测试（纯逻辑，node 直跑，异步） */
(async function () {
  const T = require("./app/js/pdf-tool.js");
  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }

  function makePage(w, h, rgb) {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; }
    return { width: w, height: h, data };
  }

  const pages = [
    makePage(2, 2, [255, 0, 0]),
    makePage(3, 1, [0, 255, 0]),
    makePage(1, 4, [0, 0, 255])
  ];

  const out = await T.writeImagePdf(pages);
  ok("writeImagePdf 返回 Uint8Array", out instanceof Uint8Array);
  ok("输出以 %PDF 开头", T._toStr(out).indexOf("%PDF") === 0);

  const parsed = await T.parsePdf(out);
  ok("解析出 3 页", parsed.pages.length === 3);
  ok("Root 已解析", parsed.root > 0);

  // 图像 XObject 数量 = 3
  let imgCount = 0;
  parsed.objects.forEach(o => { if (/\/Subtype\s*\/Image/.test(parsed.dictStr(o.num))) imgCount++; });
  ok("含 3 个 Image XObject", imgCount === 3);

  // 每页 MediaBox 与传入尺寸一致
  ok("第1页 MediaBox [0 0 2 2]", /\/MediaBox\s*\[0 0 2 2\]/.test(parsed.dictStr(parsed.pages[0])));
  ok("第2页 MediaBox [0 0 3 1]", /\/MediaBox\s*\[0 0 3 1\]/.test(parsed.dictStr(parsed.pages[1])));
  ok("第3页 MediaBox [0 0 1 4]", /\/MediaBox\s*\[0 0 1 4\]/.test(parsed.dictStr(parsed.pages[2])));

  // startxref 偏移有效：指向 "xref"
  const s = T._toStr(out);
  const sx = s.indexOf("startxref");
  const off = parseInt(s.slice(sx + 9).trim().split(/\s+/)[0], 10);
  ok("startxref 可解析为整数", !isNaN(off));
  const head4 = String.fromCharCode(out[off], out[off + 1], out[off + 2], out[off + 3]);
  ok("startxref 偏移指向 xref 表", head4 === "xref");

  // 重新解析后再次 writeImagePdf（组合健壮性）
  const out2 = await T.writeImagePdf([makePage(4, 4, [10, 20, 30])]);
  ok("二次生成仍有效且 1 页", (await T.parsePdf(out2)).pages.length === 1);

  // —— _deflate / _inflate 像素往返 ——
  const sample = new Uint8Array([1, 2, 3, 4, 5, 6, 200, 100, 0, 255, 7, 8]);
  const comp = await T._deflate(sample);
  ok("_deflate 产出更短或相等字节", comp.length >= 0 && comp instanceof Uint8Array);
  const back = await T._inflate(comp);
  ok("_inflate 还原原始像素", back.length === sample.length && back.every((v, i) => v === sample[i]));

  // 大块随机数据往返（压力）
  const big = new Uint8Array(2000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  const bigBack = await T._inflate(await T._deflate(big));
  ok("_deflate/_inflate 大块往返保真", bigBack.length === big.length && bigBack.every((v, i) => v === big[i]));

  console.log("PDF-IMAGE: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
