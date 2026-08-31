/* ============================================================
   绿角犀 Office · PDF 附件（EmbeddedFiles）提取（纯逻辑，零依赖）
   ------------------------------------------------------------
   从 PDF 原始字节中解析 /Names /EmbeddedFiles 名称树，沿
   Filespec → /EF → /F|/UF 定位内嵌文件流，解码 /Filter
   /FlateDecode，返回可下载的附件列表：
     [{ name, mime, size, data(Uint8Array), compressed, desc }]
   支持两种名称树形态：
     - 平铺：/Names [(name) filespec (name) filespec ...]
     - 递归：/Kids [ node(含 /Names 或 /Kids) ... ]
   不依赖 pdf.js，可在 node 直跑单测。浏览器侧优先用 pdf.js
   的 getAttachments()（解码最可靠），本模块作 Node 单测与回退。
   暴露：OS.PdfAttachments = { parseRawAttachments, toMarkdown,
            _locateStream, _decodeName, _parsePdfString }
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // —— 字节 / 文本互转 ——
  function toText(bytes) {
    if (typeof bytes === "string") return bytes;
    if (bytes instanceof Uint8Array || bytes instanceof Buffer) {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xff);
      return s;
    }
    if (bytes && bytes.buffer) return toText(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return "";
  }

  // PDF 字面串 (...) / 十六进制串 <...> 解码
  function parsePdfString(raw) {
    if (raw == null) return "";
    raw = String(raw).trim();
    if (!raw) return "";
    if (raw[0] === "(") {
      let out = "", i = 1;
      while (i < raw.length) {
        const c = raw[i];
        if (c === "\\") {
          const nx = raw[i + 1];
          if (nx === "n") out += "\n";
          else if (nx === "r") out += "\r";
          else if (nx === "t") out += "\t";
          else if (nx === "b") out += "\b";
          else if (nx === "f") out += "\f";
          else if (nx === "(") out += "(";
          else if (nx === ")") out += ")";
          else if (nx === "\\") out += "\\";
          else if (nx && /[0-7]/.test(nx)) {
            const oct = raw.substr(i + 1, 3).match(/^[0-7]{1,3}/);
            if (oct) { out += String.fromCharCode(parseInt(oct[0], 8)); i += oct[0].length; }
          }
          i += 2;
        } else if (c === ")") { break; }
        else { out += c; i++; }
      }
      return out;
    }
    if (raw[0] === "<") {
      const hex = raw.slice(1).replace(/>.*$/, "").replace(/[^0-9A-Fa-f]/g, "");
      const bytes = [];
      for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16) || 0);
      if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
        let s = "";
        for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return s;
      }
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
    return raw;
  }

  // /Name 中的 #XX 转义还原（如 text#2Fplain → text/plain）
  function decodeName(n) {
    if (!n) return "";
    return String(n).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }

  // 取字典中 /Key N 0 R 引用的对象号
  function dictRef(dict, key) {
    const m = new RegExp("/" + key + "\\s+(\\d+)\\s+\\d+\\s+R").exec(dict);
    return m ? parseInt(m[1], 10) : null;
  }

  // 取字典中 /Key (literal) 或 /Key <hex> 串
  function dictString(dict, key) {
    const re = new RegExp("/" + key + "\\s*(?=[(<])");
    const m = re.exec(dict);
    if (!m) return "";
    const start = m.index + m[0].length;
    if (dict[start] === "(") {
      let depth = 0, i = start;
      for (; i < dict.length; i++) {
        if (dict[i] === "\\") { i++; continue; }
        if (dict[i] === "(") depth++;
        else if (dict[i] === ")") { depth--; if (depth === 0) { i++; break; } }
      }
      return parsePdfString(dict.slice(start, i));
    }
    const end = dict.indexOf(">", start);
    return parsePdfString(dict.slice(start, end === -1 ? dict.length : end + 1));
  }

  // 取 /Key 后紧跟的 << ... >> 字典（支持嵌套）
  function extractDictAfter(txt, key) {
    const re = new RegExp("/" + key + "\\b");
    const m = re.exec(txt);
    if (!m) return null;
    const ds = txt.indexOf("<<", m.index);
    if (ds === -1) return null;
    let depth = 0, i = ds;
    for (; i < txt.length; i++) {
      if (txt[i] === "<" && txt[i + 1] === "<") { depth++; i++; }
      else if (txt[i] === ">" && txt[i + 1] === ">") { depth--; i++; if (depth === 0) break; }
    }
    return txt.slice(ds, Math.min(i + 1, txt.length));
  }

  // 取 /Key 后紧跟的 [ ... ] 数组（支持嵌套方括号）
  function extractArrayAfter(txt, key) {
    const re = new RegExp("/" + key + "\\b");
    const m = re.exec(txt);
    if (!m) return null;
    const bs = txt.indexOf("[", m.index);
    if (bs === -1) return null;
    let depth = 0, i = bs;
    for (; i < txt.length; i++) {
      if (txt[i] === "[") depth++;
      else if (txt[i] === "]") { depth--; if (depth === 0) { i++; break; } }
    }
    return txt.slice(bs, i);
  }

  // 扫描对象号 → {num, dict}
  function scanObjects(txt) {
    const out = [];
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const num = parseInt(m[1], 10);
      const start = m.index + m[0].length;
      const end = txt.indexOf("endobj", start);
      const body = txt.slice(start, end === -1 ? txt.length : end);
      const ds = body.indexOf("<<");
      if (ds === -1) continue;
      let depth = 0, i = ds;
      for (; i < body.length; i++) {
        if (body[i] === "<" && body[i + 1] === "<") { depth++; i++; }
        else if (body[i] === ">" && body[i + 1] === ">") { depth--; i++; if (depth === 0) break; }
      }
      out.push({ num, dict: body.slice(ds, Math.min(i + 1, body.length)) });
    }
    return out;
  }

  // 选择解压器：优先外部 opts.inflate；否则尝试 Node zlib（raw deflate）
  function getInflater(opts) {
    if (opts && typeof opts.inflate === "function") return opts.inflate;
    try {
      const zlib = require("zlib");
      return (buf) => {
        const b = (buf instanceof Uint8Array) ? Buffer.from(buf) : Buffer.from(buf);
        return new Uint8Array(zlib.inflateRawSync(b));
      };
    } catch (e) { return null; }
  }

  // 在二进制字节中定位对象 num 的内嵌流，返回 {data, filter, subtype, size}
  function locateStream(bytes, num) {
    const txt = toText(bytes);
    const m = new RegExp("\\b" + num + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const headerEnd = m.index + m[0].length;
    const ds = txt.indexOf("<<", headerEnd);
    if (ds === -1) return null;
    const si = txt.indexOf("stream", ds);
    if (si === -1) return null;
    const afterStream = si + "stream".length;
    let contentStart;
    if (txt[afterStream] === "\r" && txt[afterStream + 1] === "\n") contentStart = afterStream + 2;
    else if (txt[afterStream] === "\n") contentStart = afterStream + 1;
    else if (txt[afterStream] === "\r") contentStart = afterStream + 1;
    else contentStart = afterStream;
    const ei0 = txt.indexOf("endstream", contentStart);
    if (ei0 === -1) return null;
    // 剥掉 endstream 前的 EOL
    let ei = ei0;
    if (txt[ei - 1] === "\n" && txt[ei - 2] === "\r") ei -= 2;
    else if (txt[ei - 1] === "\n" || txt[ei - 1] === "\r") ei -= 1;

    const dictEnd = txt.lastIndexOf(">>", si);
    const dictText = txt.slice(ds, dictEnd + 2);
    const filterM = /\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(dictText);
    const subM = /\/Subtype\s*\/([A-Za-z0-9#]+)/.exec(dictText);
    const subtype = subM ? decodeName(subM[1]) : "";
    const sizeM = /\/Params\b[\s\S]*?\/Size\s+(\d+)/.exec(dictText);
    const size = sizeM ? parseInt(sizeM[1], 10) : (ei - contentStart);

    const data = (bytes.subarray ? bytes.subarray(contentStart, ei) : bytes.slice(contentStart, ei));
    return { data, filter: filterM ? "FlateDecode" : null, subtype, size };
  }

  function subtypeToMime(sub) {
    if (!sub) return "application/octet-stream";
    const s = String(sub).toLowerCase();
    if (s.indexOf("text/xml") !== -1 || s === "application/xml") return "application/xml";
    if (s.indexOf("xml") !== -1) return "application/xml";
    if (s.indexOf("text/plain") !== -1) return "text/plain";
    if (s.indexOf("text") !== -1) return "text/plain";
    if (s.indexOf("pdf") !== -1) return "application/pdf";
    if (s.indexOf("json") !== -1) return "application/json";
    if (s.indexOf("html") !== -1) return "text/html";
    return "application/octet-stream";
  }

  // 从 Filespec 对象抽取单个附件
  function extractFileStream(bytes, fsNum, objByNum, inflate) {
    const fs = objByNum[fsNum];
    if (!fs) return null;
    const efDict = extractDictAfter(fs.dict, "EF");
    if (!efDict) return null;
    const ref = dictRef(efDict, "F") != null ? dictRef(efDict, "F")
              : (dictRef(efDict, "UF") != null ? dictRef(efDict, "UF")
              : dictRef(efDict, "D"));
    if (ref == null) return null;
    const st = locateStream(bytes, ref);
    if (!st) return null;
    let data = st.data;
    let compressed = false;
    if (st.filter === "FlateDecode") {
      if (inflate) {
        try { data = inflate(st.data); compressed = false; }
        catch (e) { compressed = true; }
      } else { compressed = true; }
    }
    const name = dictString(fs.dict, "UF") || dictString(fs.dict, "F") || ("embedded-" + fsNum);
    const desc = dictString(fs.dict, "Desc");
    const size = st.size || data.length;
    return { name, mime: subtypeToMime(st.subtype), size, data, compressed, desc };
  }

  // 解析单个名称树节点字典（/Names 平铺 或 /Kids 递归）
  function collectFromDict(dict, bytes, objByNum, inflate, out, seen) {
    const namesArr = extractArrayAfter(dict, "Names");
    if (namesArr) {
      const toks = namesArr.match(/\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]+>|\d+\s+\d+\s+R/g) || [];
      for (let i = 0; i + 1 < toks.length; i += 2) {
        const refM = /(\d+)\s+\d+\s+R/.exec(toks[i + 1]);
        if (refM) {
          const f = extractFileStream(bytes, parseInt(refM[1], 10), objByNum, inflate);
          if (f) out.push(f);
        }
      }
    }
    const kidsArr = extractArrayAfter(dict, "Kids");
    if (kidsArr) {
      const refs = kidsArr.match(/(\d+)\s+\d+\s+R/g) || [];
      refs.forEach(r => {
        const m = /(\d+)\s+\d+\s+R/.exec(r);
        if (m) {
          const node = objByNum[parseInt(m[1], 10)];
          if (node && !seen[node.num]) { seen[node.num] = 1; collectFromDict(node.dict, bytes, objByNum, inflate, out, seen); }
        }
      });
    }
  }

  // 主入口：解析 PDF 字节 → 附件数组
  function parseRawAttachments(bytes, opts) {
    const txt = toText(bytes);
    if (!txt) return [];
    const inflate = getInflater(opts);
    const efDict = extractDictAfter(txt, "EmbeddedFiles");
    if (!efDict) return [];
    const objs = scanObjects(txt);
    const objByNum = {};
    objs.forEach(o => { if (objByNum[o.num] == null) objByNum[o.num] = o; });
    const out = [];
    collectFromDict(efDict, bytes, objByNum, inflate, out, {});
    return out;
  }

  // 附件清单 → Markdown
  function toMarkdown(atts) {
    if (!atts || !atts.length) return "（无附件）";
    return atts.map((a, i) => {
      const flag = a.compressed ? "（原始流，未解压）" : "";
      return (i + 1) + ". " + (a.name || "(未命名)") + " — " + (a.mime || "未知类型") +
        "，约 " + (a.size || 0) + " 字节" + (a.desc ? "，备注：" + a.desc : "") + flag;
    }).join("\n");
  }

  const Api = {
    parseRawAttachments, toMarkdown,
    _locateStream: locateStream, _extractFileStream: extractFileStream,
    _collectFromDict: collectFromDict, _decodeName: decodeName,
    _parsePdfString: parsePdfString, _scanObjects: scanObjects,
    _subtypeToMime: subtypeToMime
  };
  OS.PdfAttachments = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
