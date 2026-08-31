/*
 * 绿角犀 Office · PDF 文档信息/元数据提取（OS.PdfDocInfo）
 * 纯逻辑零依赖模块：从 PDF 原始字节解析文档信息，分两路：
 *   1) /Info 字典（trailer 或根目录引用）：标题/作者/主题/关键词/创建者/生产者/
 *      创建时间/修改时间/是否 trapped，兼容 UTF-16BE·UTF-8·Latin-1 字面值解码（正确处理中文）。
 *   2) /Metadata XMP 流：提取 pdf:Title / dc:creator / dc:description / xmp:CreateDate /
 *      xmp:ModifyDate / xmp:CreatorTool / xmpMM:DocumentID / pdf:Producer / pdf:Keywords。
 * 用于「文档属性审计 / 元数据源核对 / 文档溯源报告导出」。
 * 纯解析、不修改文档；不依赖 pdf.js DOM，可在 node 单测。
 *
 * 关键约束：txt（bytesToString 生成的 latin1 串）与 bytes 是 1:1 索引映射，
 * 任意字典的「文本起始」与「字节切片起始」必须对齐才能正确切片字面串字节。
 *
 * 暴露：
 *   parseDocInfo(bytes)        主函数 → { hasInfo, info, infoHuman, hasMetadata, xmp, xmpRaw }
 *   summarize(res)             派生摘要
 *   toMarkdown(res, opts)      文档信息 Markdown 报告
 *   toHtml(res)                HTML 片段
 */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  /** bytes → latin1 字符串，与 bytes 1:1 索引映射。 */
  function bytesToString(bytes) {
    if (!bytes) return "";
    let s = "";
    const n = bytes.length;
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i] & 0xff);
    return s;
  }

  /** 从 startIdx（指向 '<<'）开始做 << >> 平衡切分，返回最外层字典串。 */
  function sliceDict(txt, startIdx) {
    let depth = 0, i = startIdx;
    for (; i < txt.length; i++) {
      if (txt[i] === "<" && txt[i + 1] === "<") { depth++; i++; }
      else if (txt[i] === ">" && txt[i + 1] === ">") { depth--; i++; if (depth === 0) return txt.slice(startIdx, i); }
    }
    return null;
  }

  /** 定位对象号 num 的字典，返回 { str, start }（start 为字典在全局 txt 中的字节起始）。
   *  用 (?<!\\d) 锚定对象号，避免数字前缀重叠误匹配（如 3 误命中 13）。 */
  function getObjDict(txt, num) {
    const m = new RegExp("(?<!\\d)" + num + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const lt = txt.indexOf("<<", m.index);
    if (lt < 0) return null;
    const str = sliceDict(txt, lt);
    if (!str) return null;
    return { str, start: lt };
  }

  /** 把字面串/十六进制串的原始字节解码为可读字符串（兼容 UTF-16BE / UTF-8 / Latin-1 + PDF 转义）。 */
  function decodeLiteralBytes(raw) {
    if (!raw || !raw.length) return "";
    if (raw.length >= 2 && raw[0] === 0xFE && raw[1] === 0xFF) {
      let s = "";
      for (let i = 2; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
      return s;
    }
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (b === 0x5C) {
        const n = raw[i + 1];
        if (n === 0x6E) { out.push(10); i++; }
        else if (n === 0x72) { out.push(13); i++; }
        else if (n === 0x74) { out.push(9); i++; }
        else if (n === 0x62) { out.push(8); i++; }
        else if (n === 0x66) { out.push(12); i++; }
        else if (n === 0x28) { out.push(0x28); i++; }
        else if (n === 0x29) { out.push(0x29); i++; }
        else if (n === 0x5C) { out.push(0x5C); i++; }
        else if (n >= 0x30 && n <= 0x37) {
          let val = n - 0x30, j = i + 2;
          if (raw[j] >= 0x30 && raw[j] <= 0x37) { val = val * 8 + (raw[j] - 0x30); j++; if (raw[j] >= 0x30 && raw[j] <= 0x37) { val = val * 8 + (raw[j] - 0x30); j++; } }
          out.push(val & 0xff); i = j - 1;
        } else { out.push(n); i++; }
      } else out.push(b);
    }
    const u8 = Uint8Array.from(out);
    try {
      const td = (typeof TextDecoder !== "undefined") ? new TextDecoder("utf-8", { fatal: false }) : null;
      if (td) return td.decode(u8);
    } catch (e) { /* fallthrough */ }
    let s = "";
    for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]);
    return s;
  }

  /** 在 blockTxt（与 blockBytes 1:1 对齐）内取 key 对应的字面串/十六进制串。 */
  function lit(blockTxt, blockBytes, key) {
    const re = new RegExp(key + "\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)");
    const m = re.exec(blockTxt);
    if (m) {
      const start = m.index + m[0].indexOf("(") + 1;
      const raw = blockBytes.subarray(start, start + m[1].length);
      return decodeLiteralBytes(raw);
    }
    const hx = new RegExp(key + "\\s*<([0-9A-Fa-f\\s]+)>").exec(blockTxt);
    if (hx) {
      const h = hx[1].replace(/\s/g, "");
      const arr = [];
      for (let i = 0; i + 1 < h.length; i += 2) arr.push(parseInt(h.substr(i, 2), 16));
      return decodeLiteralBytes(Uint8Array.from(arr));
    }
    return null;
  }

  /** 取名称（/Key）。 */
  function nameOf(blockTxt, key) {
    const m = new RegExp(key + "\\s*\\/([A-Za-z0-9._:#=-]+)").exec(blockTxt);
    return m ? m[1] : null;
  }

  /** 在 bytes 中定位 stream 对象的原始字节块并解码（支持 FlateDecode）。返回 Uint8Array 或 null。 */
  function readStreamBytes(bytes, txt, objNum) {
    const m = new RegExp("(?<!\\d)" + objNum + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const dictStart = txt.indexOf("<<", m.index);
    if (dictStart < 0) return null;
    const dictEnd = txt.indexOf(">>", dictStart);
    const dictStr = txt.slice(dictStart, dictEnd + 2);
    const streamKw = txt.indexOf("stream", dictEnd);
    if (streamKw < 0) return null;
    // 跳过 stream 后的 EOL（\r\n 或 \n）
    let dataStart = streamKw + 6;
    if (txt[dataStart] === "\r" && txt[dataStart + 1] === "\n") dataStart += 2;
    else if (txt[dataStart] === "\n") dataStart += 1;
    const endIdx = txt.indexOf("endstream", dataStart);
    if (endIdx < 0) return null;
    // 回退 endstream 前的 EOL
    let dataEnd = endIdx;
    if (txt[dataEnd - 2] === "\r\n") dataEnd -= 2;
    else if (txt[dataEnd - 1] === "\n") dataEnd -= 1;
    const raw = bytes.subarray(dataStart, dataEnd);
    const filterM = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dictStr);
    if (filterM && filterM[1] === "FlateDecode") {
      try {
        if (typeof require !== "undefined") {
          const zlib = require("zlib");
          const buf = zlib.inflateSync(Buffer.from(raw));
          return new Uint8Array(buf);
        }
      } catch (e) { /* fallthrough：浏览器端无法同步解压，返回原始 */ }
      return raw; // 浏览器端未解压，调用方应降级
    }
    return raw;
  }

  /** 解析 PDF 日期串 D:YYYYMMDDHHmmSSOHH'mm' → 可读字符串。 */
  function parsePdfDate(s) {
    if (!s) return null;
    const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+\-]\d{2}'\d{2}')?/.exec(s.trim());
    if (!m) return s;
    const Y = m[1], Mo = m[2] || "01", D = m[3] || "01", H = m[4] || "00", Mi = m[5] || "00", S = m[6] || "00";
    let off = "";
    if (m[7]) {
      const o = m[7];
      if (o === "Z") off = " UTC";
      else off = " (" + o.replace("'", ":").replace("'", "") + ")";
    }
    return `${Y}-${Mo}-${D} ${H}:${Mi}:${S}${off}`;
  }

  /** 扫描 bytes 中的 XMP 片段（x:xmpmeta 或 xpacket），返回完整 XML 字符串或 null。 */
  function scanXmp(bytes) {
    const txt = bytesToString(bytes);
    let a = txt.indexOf("<x:xmpmeta");
    let b = txt.indexOf("</x:xmpmeta>", a);
    if (a >= 0 && b > a) return txt.slice(a, b + "</x:xmpmeta>".length);
    a = txt.indexOf("<?xpacket begin");
    if (a >= 0) {
      const endKw = "<?xpacket end=";
      b = txt.indexOf(endKw, a);
      if (b >= 0) {
        const tail = txt.indexOf("?>", b);
        if (tail >= 0) return txt.slice(a, tail + 2);
      }
    }
    return null;
  }

  /** 从 XMP 片段中提取关键字段。支持「元素形式 <tag>v</tag>」与「属性形式 tag="v"」两种写法。 */
  function parseXmp(xml) {
    if (!xml) return null;
    const pick = (tag) => {
      // 元素形式：<tag ...>v</tag>
      const el = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">").exec(xml);
      if (el) return el[1].trim();
      // 属性形式：tag="v"（避开 xmlns:tag 声明）
      const at = new RegExp("(?:^|\\s)" + tag + "\\s*=\\s*\"([^\"]*)\"").exec(xml);
      if (at) return at[1].trim();
      const at2 = new RegExp("(?:^|\\s)" + tag + "\\s*=\\s*'([^']*)'").exec(xml);
      if (at2) return at2[1].trim();
      return null;
    };
    // dc:creator 可能是 <rdf:Seq><rdf:li>...</rdf:li></rdf:Seq>
    const creators = [];
    const seqM = /<dc:creator>([\s\S]*?)<\/dc:creator>/.exec(xml);
    if (seqM) {
      const liRe = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g; let lm;
      while ((lm = liRe.exec(seqM[1]))) creators.push(lm[1].trim());
    }
    return {
      Title: pick("pdf:Title"),
      Creator: creators,
      Description: pick("dc:description"),
      CreateDate: pick("xmp:CreateDate"),
      ModifyDate: pick("xmp:ModifyDate"),
      CreatorTool: pick("xmp:CreatorTool"),
      DocumentID: pick("xmpMM:DocumentID"),
      Producer: pick("pdf:Producer"),
      Keywords: pick("pdf:Keywords")
    };
  }

  /** 解析文档信息。 */
  function parseDocInfo(bytes) {
    const txt = bytesToString(bytes);
    const res = {
      hasInfo: false,
      info: null,
      infoHuman: null,
      hasMetadata: false,
      metadataCompressed: false,
      xmp: null,
      xmpRaw: null
    };

    // —— 1) /Info 字典 ——
    let infoDict = null, infoStart = 0;
    // 引用型：/Info N 0 R
    const refM = /\/Info\s+(\d+)\s+0\s+R/.exec(txt);
    if (refM) {
      const o = getObjDict(txt, +refM[1]);
      if (o) { infoDict = o.str; infoStart = o.start; }
    }
    // 内联型：/Info << ... >>
    if (!infoDict) {
      const inM = /\/Info\s*<<([\s\S]*?)>>/.exec(txt);
      if (inM) { infoDict = "<<" + inM[1] + ">>"; infoStart = inM.index + inM[0].indexOf("<<"); }
    }
    if (infoDict) {
      // infoBytes 必须与 infoDict 在全局 txt 的起始位置 1:1 对齐，lit() 才能正确切片字面串字节
      const infoBytes = bytes.subarray(infoStart, infoStart + infoDict.length);
      res.hasInfo = true;
      const keys = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate", "Trapped", "Version"];
      const info = {};
      const infoHuman = {};
      for (const k of keys) {
        const litV = lit(infoDict, infoBytes, "/" + k);
        let v = litV;
        if (v == null) v = nameOf(infoDict, "/" + k);
        if (v != null) {
          info[k] = v;
          if (k === "CreationDate" || k === "ModDate") infoHuman[k] = parsePdfDate(v);
          else infoHuman[k] = v;
        }
      }
      // 捕获其它原始 key（以 / 开头、无斜杠嵌套的简单条目）
      const extra = {};
      const kvRe = /\/([A-Za-z][A-Za-z0-9]+)\s+\(((?:[^()\\]|\\.)*)\)/g; let km;
      while ((km = kvRe.exec(infoDict))) {
        if (keys.indexOf(km[1]) >= 0) continue;
        const start = km.index + km[0].indexOf("(") + 1;
        const raw = infoBytes.subarray(start, start + km[1].length * 0 + km[2].length);
        const v = decodeLiteralBytes(raw);
        if (v) extra[km[1]] = v;
      }
      res.info = info;
      if (Object.keys(extra).length) res.info._extra = extra;
      res.infoHuman = infoHuman;
    }

    // —— 2) /Metadata XMP ——
    const metaM = /\/Metadata\s+(\d+)\s+0\s+R/.exec(txt);
    if (metaM) {
      res.hasMetadata = true;
      const raw = readStreamBytes(bytes, txt, +metaM[1]);
      if (raw) {
        const xml = scanXmp(raw);
        if (xml) { res.xmpRaw = xml; res.xmp = parseXmp(xml); }
        else if (raw.length && /FlateDecode/.test(txt.slice(txt.indexOf("<<", txt.indexOf(metaM[0]) - 40), txt.indexOf(">>", txt.indexOf(metaM[0]))))) {
          res.metadataCompressed = true;
        }
      }
    }
    // 即使没有 /Metadata 引用，也尝试在全局扫描到 XMP（有些文档内联）
    if (!res.xmpRaw) {
      const xml = scanXmp(bytes);
      if (xml) { res.xmpRaw = xml; res.xmp = parseXmp(xml); res.hasMetadata = true; }
    }
    return res;
  }

  function summarize(res) {
    if (!res) return { hasInfo: false, hasMetadata: false };
    return {
      hasInfo: res.hasInfo,
      hasMetadata: res.hasMetadata,
      title: res.info && res.info.Title ? res.info.Title : null,
      author: res.info && res.info.Author ? res.info.Author : null,
      creator: res.info && res.info.Creator ? res.info.Creator : null,
      xmpTitle: res.xmp && res.xmp.Title ? res.xmp.Title : null
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function kv(label, val) {
    if (val == null || val === "") return "";
    return `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px dashed #eee;font-size:13px">` +
      `<div style="width:96px;color:#888;flex:none">${escapeHtml(label)}</div>` +
      `<div style="color:#333;word-break:break-all">${escapeHtml(Array.isArray(val) ? val.join("、") : val)}</div></div>`;
  }

  function toMarkdown(res, opts) {
    opts = opts || {};
    const lines = ["# " + (opts.title || "PDF 文档信息提取"), ""];
    if (res.hasInfo) {
      lines.push("## 文档信息字典（/Info）");
      const order = [["Title", "标题"], ["Author", "作者"], ["Subject", "主题"], ["Keywords", "关键词"],
        ["Creator", "创建者"], ["Producer", "生产者"], ["CreationDate", "创建时间"], ["ModDate", "修改时间"],
        ["Trapped", "Trapped"], ["Version", "版本"]];
      for (const [k, zh] of order) {
        if (res.info[k] != null) lines.push(`- **${zh}**：${res.info[k]}${res.infoHuman && res.infoHuman[k] && res.infoHuman[k] !== res.info[k] ? "（" + res.infoHuman[k] + "）" : ""}`);
      }
      if (res.info && res.info._extra) {
        lines.push("- **其它字段**：");
        for (const k in res.info._extra) lines.push(`  - ${k}: ${res.info._extra[k]}`);
      }
      lines.push("");
    } else {
      lines.push("（未发现 /Info 文档信息字典）");
      lines.push("");
    }
    if (res.xmp) {
      lines.push("## XMP 元数据（/Metadata）");
      const x = res.xmp;
      if (x.Title) lines.push(`- **标题**：${x.Title}`);
      if (x.Creator && x.Creator.length) lines.push(`- **创建者**：${x.Creator.join("、")}`);
      if (x.Description) lines.push(`- **描述**：${x.Description}`);
      if (x.CreateDate) lines.push(`- **创建时间**：${x.CreateDate}`);
      if (x.ModifyDate) lines.push(`- **修改时间**：${x.ModifyDate}`);
      if (x.CreatorTool) lines.push(`- **创建工具**：${x.CreatorTool}`);
      if (x.Producer) lines.push(`- **生产者**：${x.Producer}`);
      if (x.Keywords) lines.push(`- **关键词**：${x.Keywords}`);
      if (x.DocumentID) lines.push(`- **文档 ID**：${x.DocumentID}`);
      lines.push("");
    } else if (res.hasMetadata) {
      lines.push("（存在 /Metadata 但未能解析 XMP" + (res.metadataCompressed ? "，流为压缩格式" : "") + "）");
      lines.push("");
    }
    return lines.join("\n");
  }

  function toHtml(res) {
    let html = `<div style="font-size:13px">`;
    if (res.hasInfo) {
      html += `<div style="font-weight:600;margin:6px 0 2px;color:#444">文档信息字典（/Info）</div>`;
      const order = [["Title", "标题"], ["Author", "作者"], ["Subject", "主题"], ["Keywords", "关键词"],
        ["Creator", "创建者"], ["Producer", "生产者"], ["CreationDate", "创建时间"], ["ModDate", "修改时间"],
        ["Trapped", "Trapped"], ["Version", "版本"]];
      for (const [k, zh] of order) {
        if (res.info[k] != null) {
          let v = res.info[k];
          if (res.infoHuman && res.infoHuman[k] && res.infoHuman[k] !== v) v = res.infoHuman[k];
          html += kv(zh, v);
        }
      }
      if (res.info && res.info._extra) {
        for (const k in res.info._extra) html += kv(k, res.info._extra[k]);
      }
    } else {
      html += `<div style="color:#999;padding:6px 0">（未发现 /Info 文档信息字典）</div>`;
    }
    if (res.xmp) {
      html += `<div style="font-weight:600;margin:10px 0 2px;color:#444">XMP 元数据（/Metadata）</div>`;
      const x = res.xmp;
      if (x.Title) html += kv("标题", x.Title);
      if (x.Creator && x.Creator.length) html += kv("创建者", x.Creator);
      if (x.Description) html += kv("描述", x.Description);
      if (x.CreateDate) html += kv("创建时间", x.CreateDate);
      if (x.ModifyDate) html += kv("修改时间", x.ModifyDate);
      if (x.CreatorTool) html += kv("创建工具", x.CreatorTool);
      if (x.Producer) html += kv("生产者", x.Producer);
      if (x.Keywords) html += kv("关键词", x.Keywords);
      if (x.DocumentID) html += kv("文档ID", x.DocumentID);
    } else if (res.hasMetadata) {
      html += `<div style="color:#999;padding:6px 0">（存在 /Metadata 但未能解析 XMP${res.metadataCompressed ? "，流为压缩格式" : ""}）</div>`;
    }
    html += `</div>`;
    return html;
  }

  const Api = {
    bytesToString, sliceDict, getObjDict, decodeLiteralBytes, lit, nameOf,
    readStreamBytes, parsePdfDate, scanXmp, parseXmp,
    parseDocInfo, summarize, toMarkdown, toHtml
  };
  OS.PdfDocInfo = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
