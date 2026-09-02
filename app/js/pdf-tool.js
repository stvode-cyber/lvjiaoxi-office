/* ============================================================
   绿角犀 Office · PDF 合并 / 拆分（零依赖，字节级）
   ------------------------------------------------------------
   支持：PDF 1.4 风格内联对象；PDF 1.5+ 对象流（/ObjStm，FlateDecode 压缩）经解析展开。
   xref stream 作为内联对象被原生正则捕获（仅用于定位 /Root，对象偏移由全文扫描获得）。
   说明：合并/拆分采用重编号 + 引用重映射 + 重建页面树 + 重建 xref/trailer 的标准做法；
   输出标准 PDF 1.4 结构，可被本模块及 pdf.js 重新解析。
   注意：parsePdf / mergePdfs / splitPdf 现为异步（ObjStm 解压依赖 DecompressionStream）。
   纯函数以 Uint8Array 输入输出，浏览器与 Node 双导出，便于测试。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // ---------------- 字节 / 字符串互转（latin1 恒等，保二进制） ----------------
  function toStr(u8) {
    if (typeof u8 === "string") return u8;
    if (typeof Buffer !== "undefined" && u8 instanceof Buffer) return u8.toString("latin1");
    let s = "";
    const len = u8.length;
    for (let i = 0; i < len; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
  function toBytes(str) {
    if (str instanceof Uint8Array) return str;
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(str, "latin1"));
    const u = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 0xff;
    return u;
  }

  // 在字节序列中定位 ASCII 关键字（如 "stream"）的起始偏移
  function findAscii(u8, keyword, from) {
    const k = [];
    for (let i = 0; i < keyword.length; i++) k.push(keyword.charCodeAt(i));
    for (let i = from; i + k.length <= u8.length; i++) {
      let ok = true;
      for (let j = 0; j < k.length; j++) if (u8[i + j] !== k[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  // 取对象 innerBytes 的字典部分（"stream" 关键字之前）
  function dictStrOf(innerBytes) {
    const si = findAscii(innerBytes, "stream", 0);
    return si >= 0 ? toStr(innerBytes.subarray(0, si)) : toStr(innerBytes);
  }

  // 从 innerBytes（含 "stream...endstream"）提取 stream 数据（解压前字节）
  function extractStreamData(innerBytes) {
    const si = findAscii(innerBytes, "stream", 0);
    if (si < 0) return null;
    let start = si + 6; // "stream" 长度 6
    if (innerBytes[start] === 0x0a) start++;
    else if (innerBytes[start] === 0x0d) { start++; if (innerBytes[start] === 0x0a) start++; }
    const es = findAscii(innerBytes, "endstream", start);
    let end = es >= 0 ? es : innerBytes.length;
    // endstream 前的 EOL（\r\n / \n / \r）不属于流数据，剥除以免 deflate 报 "Trailing junk"
    if (end > start) {
      if (innerBytes[end - 1] === 0x0a) { end--; if (end > start && innerBytes[end - 1] === 0x0d) end--; }
      else if (innerBytes[end - 1] === 0x0d) end--;
    }
    if (end <= start) return null;
    return innerBytes.subarray(start, end);
  }

  // 在字符串中找第一个完整平衡 <<...>>，返回含定界符的子串（用于从 ObjStm 对象体提取字典）
  function extractFirstBalancedDict(seg) {
    const open = seg.indexOf("<<");
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < seg.length; i++) {
      if (seg[i] === "<" && seg[i + 1] === "<") { depth++; i++; }
      else if (seg[i] === ">" && seg[i + 1] === ">") { depth--; i++; if (depth === 0) return seg.slice(open, i + 1); }
    }
    return null;
  }

  // 解析 ObjStm 解压后的 body：前 /First 字节为偏移表（N 对 整数），其后按偏移切分对象体
  // 对象体格式 "Ni Oi <<dict>>"（紧凑，无 obj/endobj 关键字）。返回 Map<对象号, 字典字节>
  function parseObjStmBody(comp, dict) {
    const N = parseInt((dict.match(/\/N\s+(\d+)/) || [])[1] || "0", 10);
    const First = parseInt((dict.match(/\/First\s+(\d+)/) || [])[1] || "0", 10);
    const out = new Map();
    if (!N) return out;
    const s = toStr(comp);
    const headTokens = s.slice(0, First).trim().split(/\s+/).filter(t => t.length);
    const offs = [];
    for (let i = 1; i < headTokens.length; i += 2) offs.push(parseInt(headTokens[i], 10) || 0);
    for (let i = 0; i < N; i++) {
      const start = First + (offs[i] || 0);
      const end = (i + 1 < N) ? First + (offs[i + 1] || s.length) : s.length;
      let seg = s.slice(start, end).replace(/^\s*\d+\s+\d+\s*/, "");
      const d = extractFirstBalancedDict(seg);
      if (d) out.set(parseInt(headTokens[i * 2], 10), toBytes(d));
    }
    return out;
  }

  // ---------------- 解析（异步：ObjStm 解压依赖 inflate） ----------------
  // 返回 { objects: Map<num,{num,innerBytes}>, dictStr(num), pages:[num...], root, maxId }
  async function parsePdf(input) {
    const bytes = toBytes(input);
    const str = toStr(bytes);
    const objects = new Map();
    const re = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const num = parseInt(m[1], 10);
      const objKw = str.indexOf("obj", m.index);
      let innerBytesStart = objKw + 3;
      while (innerBytesStart < m.index + m[0].length - 6 && /\s/.test(str[innerBytesStart])) innerBytesStart++;
      const innerEnd = m.index + m[0].length - 6; // 去掉末尾 "endobj"
      const innerBytes = bytes.subarray(innerBytesStart, innerEnd);
      objects.set(num, { num, innerBytes });
    }

    // 展开 /ObjStm（PDF 1.5+ 对象流）：解压后把内部对象并入 objects，并移除 ObjStm 容器
    for (const [num, o] of Array.from(objects.entries())) {
      const d = dictStrOf(o.innerBytes);
      if (!/\/Type\s*\/?\s*ObjStm\b/.test(d)) continue;
      const sd = extractStreamData(o.innerBytes);
      if (!sd) continue;
      let comp;
      try { comp = await inflate(sd); } catch (e) { continue; } // 解压失败则跳过该对象流
      const expanded = parseObjStmBody(comp, d);
      for (const [kn, kb] of expanded) if (!objects.has(kn)) objects.set(kn, { num: kn, innerBytes: kb });
      objects.delete(num);
    }

    const maxId = objects.size ? Math.max.apply(null, Array.from(objects.keys())) : 0;

    function dictStr(num) {
      const o = objects.get(num);
      if (!o) return "";
      return dictStrOf(o.innerBytes);
    }

    // 定位 Root（取最后一个 /Root 引用；xref stream 的 /Root 写在容器 dict 中，全文扫描可命中）
    let root = 0;
    const rootMatches = str.match(/\/Root\s+(\d+)\s+\d+\s+R/g);
    if (rootMatches && rootMatches.length) {
      const last = rootMatches[rootMatches.length - 1];
      root = parseInt(last.replace(/^\/Root\s+/, "").replace(/\s+\d+\s+R$/, ""), 10);
    }

    // 递归收集页面（按 /Kids 顺序）
    const pages = [];
    function walk(num) {
      const d = dictStr(num);
      if (!d) return;
      const isPage = /\/Type\s*\/?\s*Page\b/.test(d) && !/\/Type\s*\/?\s*Pages\b/.test(d);
      if (isPage) { pages.push(num); return; }
      const kidsM = d.match(/\/Kids\s*\[([\s\S]*?)\]/);
      if (kidsM) {
        const refs = kidsM[1].match(/(\d+)\s+\d+\s+R/g) || [];
        for (const r of refs) walk(parseInt(r.replace(/\s+\d+\s+R$/, ""), 10));
      }
    }
    if (root) {
      const rd = dictStr(root);
      const pagesM = rd.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
      if (pagesM) walk(parseInt(pagesM[1], 10));
    }

    return { objects, dictStr, pages, root, maxId };
  }

  // ---------------- 引用重映射（仅作用于 dict 部分，避免误改 stream 二进制） ----------------
  function remapRefs(dictStr, offset) {
    if (!offset) return dictStr;
    return dictStr.replace(/(\d+)\s+(\d+)\s+R/g, function (_, n) {
      return (parseInt(n, 10) + offset) + " 0 R";
    });
  }

  // 写出对象：将 {num, bytes} 推入 ordered；bytes 含重映射后的 inner + 头尾
  function writeObject(ordered, num, innerBytes, offset) {
    const si = findAscii(innerBytes, "stream", 0);
    let dictPart = si >= 0 ? toStr(innerBytes.subarray(0, si)) : toStr(innerBytes);
    const rest = si >= 0 ? innerBytes.subarray(si) : new Uint8Array(0);
    dictPart = remapRefs(dictPart, offset);
    const head = toBytes(num + " 0 obj\n");
    const dictB = toBytes(dictPart);
    const tail = toBytes("\nendobj\n");
    const out = new Uint8Array(head.length + dictB.length + rest.length + tail.length);
    let p = 0;
    out.set(head, p); p += head.length;
    out.set(dictB, p); p += dictB.length;
    out.set(rest, p); p += rest.length;
    out.set(tail, p);
    ordered.push({ num, bytes: out });
  }

  // 写出纯字典对象（Pages / Catalog / Root）
  function writeDict(ordered, num, dictStr) {
    ordered.push({ num, bytes: toBytes(num + " 0 obj\n" + dictStr + "\nendobj\n") });
  }

  // ---------------- 组装 xref + trailer ----------------
  function assemble(ordered) {
    const header = toBytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    let offset = header.length;
    const offsets = [];
    const parts = [header];
    for (const o of ordered) {
      offsets.push(offset);
      parts.push(o.bytes);
      offset += o.bytes.length;
    }
    const xrefStart = offset;
    const maxNum = ordered.length ? Math.max.apply(null, ordered.map(o => o.num)) : 0;
    const size = maxNum + 1;
    let xref = "xref\n0 " + size + "\n";
    xref += "0000000000 65535 f \n";
    for (let i = 1; i < size; i++) {
      const idx = ordered.findIndex(o => o.num === i);
      xref += (idx >= 0 ? String(offsets[idx]).padStart(10, "0") : "0000000000") + " 00000 n \n";
    }
    const trailer = "trailer\n<< /Size " + size + " /Root " + maxNum + " 0 R >>\nstartxref\n" +
      xrefStart + "\n%%EOF\n";
    parts.push(toBytes(xref), toBytes(trailer));
    let total = 0; for (const p of parts) total += p.length;
    const out = new Uint8Array(total); let p = 0;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return out;
  }

  // ---------------- 合并 ----------------
  async function mergePdfs(list) {
    let offset = 0;
    const ordered = [];
    const allPageNums = [];
    for (const input of list) {
      const p = await parsePdf(input);
      p.objects.forEach((o) => { writeObject(ordered, o.num + offset, o.innerBytes, offset); });
      for (const pg of p.pages) allPageNums.push(pg + offset);
      offset += p.maxId;
    }
    const pagesNum = offset + 1;
    const catNum = offset + 2;
    const kids = allPageNums.map(n => n + " 0 R").join(" ");
    writeDict(ordered, pagesNum, "<< /Type /Pages /Kids [ " + kids + " ] /Count " + allPageNums.length + " >>");
    writeDict(ordered, catNum, "<< /Type /Catalog /Pages " + pagesNum + " 0 R >>");
    return assemble(ordered);
  }

  // ---------------- 拆分 ----------------
  async function splitPdf(input, ranges) {
    const p = await parsePdf(input);
    const results = [];
    const baseMax = p.maxId;
    for (const range of ranges) {
      let a = range[0], b = range[1] == null ? range[0] : range[1];
      // a/b 为 1 基页位置；转换为页面对象编号
      const selected = p.pages.slice(a - 1, b);
      if (!selected.length) { results.push(new Uint8Array(0)); continue; }
      const ordered = [];
      p.objects.forEach((o) => { writeObject(ordered, o.num, o.innerBytes, 0); });
      const pagesNum = baseMax + 1;
      const catNum = baseMax + 2;
      const kids = selected.map(n => n + " 0 R").join(" ");
      writeDict(ordered, pagesNum, "<< /Type /Pages /Kids [ " + kids + " ] /Count " + selected.length + " >>");
      writeDict(ordered, catNum, "<< /Type /Catalog /Pages " + pagesNum + " 0 R >>");
      results.push(assemble(ordered));
    }
    return results;
  }

  // ---------------- 光栅 → PDF（用于把批注/页面扁平化为可导出的 PDF） ----------------
  function concat() {
    let len = 0;
    for (let i = 0; i < arguments.length; i++) len += arguments[i].length;
    const out = new Uint8Array(len); let p = 0;
    for (let i = 0; i < arguments.length; i++) { out.set(arguments[i], p); p += arguments[i].length; }
    return out;
  }

  // zlib deflate（RFC1950，PDF FlateDecode 期望的格式）。浏览器/Node 均有的 CompressionStream。
  async function deflate(bytes) {
    if (typeof CompressionStream === "undefined") throw new Error("CompressionStream 不可用");
    const cs = new CompressionStream("deflate");
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    const ab = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(ab);
  }
  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream 不可用");
    const ds = new DecompressionStream("deflate");
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    const ab = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(ab);
  }

  // pages: [{ width, height, data: Uint8Array RGBA, mediaW?, mediaH? }]
  //   width/height：光栅像素尺寸（图像实际分辨率）
  //   mediaW/mediaH（可选）：PDF MediaBox 尺寸（点，1pt=1/72in）。缺省=图像像素尺寸（1px=1pt）
  // 返回 Promise<Uint8Array>：每个页面一张 DeviceRGB + FlateDecode 图像，铺满 MediaBox。
  async function writeImagePdf(pages) {
    const P = pages.length;
    if (P === 0) throw new Error("至少需要 1 页");
    const ordered = [];
    const pageNums = [];
    for (let i = 0; i < P; i++) {
      const pg = pages[i];
      const w = pg.width | 0, h = pg.height | 0;
      const mw = (pg.mediaW != null) ? (pg.mediaW | 0) : w;
      const mh = (pg.mediaH != null) ? (pg.mediaH | 0) : h;
      const imgNum = i + 1;          // 1..P
      const contentNum = P + i + 1;  // P+1..2P
      const pageNum = 2 * P + i + 1; // 2P+1..3P
      // RGB（丢弃 alpha）
      const rgb = new Uint8Array(w * h * 3);
      const src = pg.data;
      for (let p = 0, q = 0; p < src.length; p += 4, q += 3) {
        rgb[q] = src[p]; rgb[q + 1] = src[p + 1]; rgb[q + 2] = src[p + 2];
      }
      const comp = await deflate(rgb);
      const imgDict = "<< /Type /XObject /Subtype /Image /Width " + w + " /Height " + h +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length " + comp.length + " >>\n";
      const imgObj = concat(toBytes(imgDict), toBytes("stream\n"), comp, toBytes("\nendstream"));
      writeObject(ordered, imgNum, imgObj, 0);

      // 将图像缩放铺满 MediaBox（mw×mh），图像自身为 w×h
      const content = "q\n" + mw + " 0 0 " + mh + " 0 0 cm\n/I" + imgNum + " Do\nQ\n";
      const contentObj = concat(toBytes("<< /Length " + toBytes(content).length + " >>\n"), toBytes("stream\n" + content + "\nendstream"));
      writeObject(ordered, contentNum, contentObj, 0);

      writeDict(ordered, pageNum, "<< /Type /Page /Parent " + (3 * P + 1) + " 0 R /MediaBox [0 0 " + mw + " " + mh +
        "] /Resources << /XObject << /I" + imgNum + " " + imgNum + " 0 R >> >> /Contents " + contentNum + " 0 R >>");
      pageNums.push(pageNum);
    }
    const pagesTree = 3 * P + 1, catalog = 3 * P + 2;
    writeDict(ordered, pagesTree, "<< /Type /Pages /Kids [ " + pageNums.map(n => n + " 0 R").join(" ") + " ] /Count " + P + " >>");
    writeDict(ordered, catalog, "<< /Type /Catalog /Pages " + pagesTree + " 0 R >>");
    return assemble(ordered);
  }

  const api = { parsePdf, mergePdfs, splitPdf, remapRefs, writeImagePdf, parseObjStm: parseObjStmBody, _deflate: deflate, _inflate: inflate, _concat: concat, _toBytes: toBytes, _toStr: toStr };
  OS.PdfTool = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);
