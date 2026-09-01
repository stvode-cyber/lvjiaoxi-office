/*
 * 绿角犀 Office · PDF 字体信息提取（OS.PdfFonts）
 * 纯逻辑零依赖模块：从 PDF 原始字节解析页面树 → 每页 /Resources /Font，
 * 逐字体提取 BaseFont（含子集前缀剥离）/ Subtype / Encoding / ToUnicode /
 * FontDescriptor 嵌入标志（FontFile·FontFile2·FontFile3；Type0 经 DescendantFonts 下钻）/
 * Flags（等宽·衬线·符号·斜体…）/ 字符范围；按对象号去重并合并使用页。
 *
 * 用途：打印与转换保真检查（未嵌入且非标准 14 字体 → 显示/提取风险）、
 *       字体清单审计、中文 CID 字体识别、子集字体识别。
 * 纯解析、不修改文档；不依赖 pdf.js DOM，可在 node 单测。
 *
 * 关键约束：txt（bytesToString 生成的 latin1 串）与 bytes 是 1:1 索引映射。
 * 本模块不切字面串字节（只读 ASCII 名字），故无对齐要求。
 *
 * 暴露：
 *   parseFonts(bytes)        主函数 → 完整结果（fonts + 逐页映射 + 摘要）
 *   summarize(res)           派生摘要（与 res 内 summary 一致，便于测试）
 *   toMarkdown(res, opts)     字体信息 Markdown 报告
 *   toHtml(res)              HTML 片段
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
      else if (txt[i] === ">" && txt[i + 1] === ">") {
        depth--; i++;
        if (depth === 0) return txt.slice(startIdx, i);
      }
    }
    return null;
  }

  /** 定位对象号 num 的字典，返回 { str, start }（start 为字典在全局 txt 中的起始）。 */
  function getObjDict(txt, num) {
    const m = new RegExp("(?<!\\d)" + num + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const lt = txt.indexOf("<<", m.index);
    if (lt < 0) return null;
    const str = sliceDict(txt, lt);
    if (!str) return null;
    return { str, start: lt };
  }

  /** PDF 名字中的常规字符（不含分隔符）。 */
  function isRegular(ch) {
    return /[A-Za-z0-9._:*+\-#!$&@?]/.test(ch);
  }

  /** 从 i 处读一个 PDF 对象值，返回 { value, next }。 */
  function parseValue(s, i) {
    const n = s.length;
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) return { value: "", next: i };
    const c = s[i];
    if (c === "<" && s[i + 1] === "<") {
      const sub = sliceDict(s, i);
      if (sub) return { value: sub, next: i + sub.length };
      return { value: "<<", next: i + 2 };
    }
    if (c === "<") {
      let j = i + 1;
      while (j < n && s[j] !== ">") j++;
      return { value: s.slice(i, Math.min(j + 1, n)), next: j + 1 };
    }
    if (c === "[") {
      let depth = 0, j = i;
      for (; j < n; j++) {
        if (s[j] === "[") depth++;
        else if (s[j] === "]") { depth--; if (depth === 0) { j++; break; } }
      }
      return { value: s.slice(i, j), next: j };
    }
    if (c === "(") {
      let depth = 0, j = i;
      for (; j < n; j++) {
        if (s[j] === "\\") { j++; continue; }
        if (s[j] === "(") depth++;
        else if (s[j] === ")") { depth--; if (depth === 0) { j++; break; } }
      }
      return { value: s.slice(i, Math.min(j + 1, n)), next: j + 1 };
    }
    if (c === "/") {
      let j = i + 1, v = "/";
      while (j < n && isRegular(s[j])) { v += s[j]; j++; }
      return { value: v, next: j };
    }
    if (/[+-]?\d/.test(c)) {
      // 优先匹配间接引用 "N G R"（含空格）
      const refM = /^(\d+)\s+(\d+)\s+R\b/.exec(s.slice(i, i + 48) || "");
      if (refM) return { value: refM[0], next: i + refM[0].length };
      let j = i, v = "";
      while (j < n && !/[\s/<\[\](){}>]/.test(s[j])) { v += s[j]; j++; }
      if (!v) { j = i + 1; v = c; }
      return { value: v, next: j };
    }
    // 关键字 / true / false / null
    let j = i, v = "";
    while (j < n && isRegular(s[j])) { v += s[j]; j++; }
    if (!v) { j = i + 1; v = c; }
    return { value: v, next: j };
  }

  /** 解析字典内层（去掉外层 << >>）的顶层键值对 → [{ key, value }]。 */
  function parseDictEntries(inner) {
    const out = [];
    let i = 0;
    const n = inner.length;
    while (i < n) {
      const c = inner[i];
      if (c === "<" && inner[i + 1] === "<") {
        const sub = sliceDict(inner, i);
        i += sub ? sub.length : 2;
        continue;
      }
      if (c === ">" && inner[i + 1] === ">") { i += 2; continue; }
      if (c === "[") {
        const r = parseValue(inner, i);
        i = Math.max(r.next, i + 1);
        continue;
      }
      if (c === "/") {
        let j = i + 1, key = "";
        while (j < n && isRegular(inner[j])) { key += inner[j]; j++; }
        if (!key) { i++; continue; }
        i = j;
        const r = parseValue(inner, i);
        out.push({ key, value: r.value });
        i = Math.max(r.next, i + 1);
        continue;
      }
      i++;
    }
    return out;
  }

  /** 取字典串的顶层 entries（自动剥外层 << >>）。 */
  function dictEntries(dictStr) {
    if (!dictStr) return [];
    const lt = dictStr.indexOf("<<");
    if (lt < 0) return [];
    const body = dictStr.slice(lt + 2, dictStr.lastIndexOf(">>"));
    return parseDictEntries(body);
  }

  function entryVal(entries, key) {
    for (const e of entries) if (e.key === key) return e.value;
    return null;
  }

  /** 把值解析为字典串：内联字典直接返回；间接引用则解析对象字典。 */
  function valueAsDict(txt, val) {
    if (!val) return null;
    if (val.indexOf("<<") === 0) return val;
    const rm = /^(\d+)\s+(\d+)\s+R/.exec(val.trim());
    if (rm) {
      const o = getObjDict(txt, +rm[1]);
      if (o) return o.str;
    }
    return null;
  }

  function valueIsRef(val) {
    return !!val && /^\s*\d+\s+\d+\s+R/.test(val);
  }

  // —— 字体类型 ——
  const FONT_TYPES = {
    Type0: "Type0（复合/CID，中日韩常用）",
    Type1: "Type1",
    TrueType: "TrueType",
    MMType1: "MMType1（多主字重）",
    Type3: "Type3（程序化字形）",
    CIDFontType0: "CIDFontType0",
    CIDFontType2: "CIDFontType2"
  };

  // —— 标准 14 字体（查看器内置，未嵌入也安全）——
  const STANDARD_14 = [
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Symbol", "ZapfDingbats"
  ];

  // —— Flags 位（PDF 32000-1 Table 122）——
  const FLAG_BITS = [
    { bit: 1, key: "fixedPitch", label: "等宽" },
    { bit: 2, key: "serif", label: "衬线" },
    { bit: 4, key: "symbolic", label: "符号" },
    { bit: 8, key: "script", label: "手写体" },
    { bit: 32, key: "nonsymbolic", label: "非符号" },
    { bit: 64, key: "italic", label: "斜体" },
    { bit: 65536, key: "allCap", label: "全大写" },
    { bit: 131072, key: "smallCap", label: "小型大写" },
    { bit: 262144, key: "forceBold", label: "强制加粗" }
  ];

  /** 剥离子集前缀（ABCDEF+SimSun → { subset:true, tag:"ABCDEF", family:"SimSun" }）。 */
  function splitSubset(baseFont) {
    if (!baseFont) return { subset: false, tag: null, family: "" };
    const m = /^([A-Z]{6})\+(.+)$/.exec(baseFont);
    if (m) return { subset: true, tag: m[1], family: m[2] };
    return { subset: false, tag: null, family: baseFont };
  }

  /** 解析 /Encoding：名字 / 引用（取 BaseEncoding，否则自定义）/ 字典。 */
  function parseEncoding(txt, val) {
    if (!val) return null;
    const v = String(val).trim();
    if (v.charAt(0) === "/") return v.slice(1);
    const d = valueAsDict(txt, v);
    if (d) {
      const es = dictEntries(d);
      const be = entryVal(es, "BaseEncoding");
      if (be && String(be).charAt(0) === "/") return String(be).slice(1);
      if (entryVal(es, "Differences") != null) return "自定义(Differences)";
      return "自定义";
    }
    if (valueIsRef(v)) {
      const rm = /^(\d+)\s+(\d+)\s+R/.exec(v);
      const o = getObjDict(txt, +rm[1]);
      if (o) {
        const es = dictEntries(o.str);
        const be = entryVal(es, "BaseEncoding");
        if (be && String(be).charAt(0) === "/") return String(be).slice(1);
        if (entryVal(es, "Differences") != null) return "自定义(Differences)";
        return "自定义";
      }
      return "自定义";
    }
    return v || null;
  }

  /** 解析 FontDescriptor 的嵌入标志与基本度量。 */
  function parseDescriptor(txt, val) {
    const out = { has: false, embedded: false, embeddedAs: null, fontName: null, family: null, flags: null };
    const d = valueAsDict(txt, val);
    if (!d) return out;
    out.has = true;
    const es = dictEntries(d);
    const fn = entryVal(es, "FontName");
    if (fn) out.fontName = String(fn).charAt(0) === "/" ? String(fn).slice(1) : String(fn);
    // /Flags 规范上属于 FontDescriptor（PDF 32000-1 Table 122），字体字典中通常不写
    const fr = entryVal(es, "Flags");
    if (fr != null) {
      const fv = parseInt(String(fr).trim(), 10);
      if (!isNaN(fv)) out.flags = fv;
    }
    const fam = entryVal(es, "FontFamily");
    if (fam) {
      out.family = String(fam).charAt(0) === "/"
        ? String(fam).slice(1)
        : String(fam).replace(/^\(([\s\S]*)\)$/, "$1");
    }
    if (entryVal(es, "FontFile") != null) { out.embedded = true; out.embeddedAs = "FontFile(Type1)"; }
    else if (entryVal(es, "FontFile2") != null) { out.embedded = true; out.embeddedAs = "FontFile2(TrueType)"; }
    else if (entryVal(es, "FontFile3") != null) {
      out.embedded = true;
      const st = entryVal(es, "Subtype") || "";
      const s = String(st).charAt(0) === "/" ? String(st).slice(1) : String(st);
      out.embeddedAs = "FontFile3(" + (s || "CFF/OpenType") + ")";
    }
    return out;
  }

  /** Type0：经 /DescendantFonts 下钻到 CIDFont 取 descriptor。 */
  function descendantDescriptor(txt, entries) {
    const df = entryVal(entries, "DescendantFonts");
    if (!df) return null;
    const refRe = /(\d+)\s+(\d+)\s+R/g;
    let m;
    while ((m = refRe.exec(df))) {
      const o = getObjDict(txt, +m[1]);
      if (!o) continue;
      const es = dictEntries(o.str);
      const fd = entryVal(es, "FontDescriptor");
      if (fd != null) {
        const r = parseDescriptor(txt, fd);
        // 若 CIDFont 未声明 CIDSystemInfo，可用其 BaseFont 兜底家族名
        if (!r.family) {
          const bf = entryVal(es, "BaseFont");
          if (bf) r.family = splitSubset(String(bf).charAt(0) === "/" ? String(bf).slice(1) : String(bf)).family;
        }
        r.cidFontType = String(entryVal(es, "Subtype") || "").charAt(0) === "/"
          ? String(entryVal(es, "Subtype")).slice(1) : null;
        return r;
      }
    }
    return null;
  }

  /** 从字体字典串构造一条字体记录。 */
  function buildFont(txt, dictStr, resName, objNum) {
    const es = dictEntries(dictStr);
    const subtypeRaw = String(entryVal(es, "Subtype") || "");
    const subtype = subtypeRaw.charAt(0) === "/" ? subtypeRaw.slice(1) : (subtypeRaw || null);
    const bfRaw = String(entryVal(es, "BaseFont") || "");
    const baseFont = bfRaw.charAt(0) === "/" ? bfRaw.slice(1) : (bfRaw || "");
    const ss = splitSubset(baseFont);

    let desc = parseDescriptor(txt, entryVal(es, "FontDescriptor"));
    let descSource = "自身";
    if (!desc.has && subtype === "Type0") {
      const d2 = descendantDescriptor(txt, es);
      if (d2 && d2.has) { desc = d2; descSource = "DescendantFonts"; }
    }

    const enc = parseEncoding(txt, entryVal(es, "Encoding"));
    const toUnicode = entryVal(es, "ToUnicode") != null;

    // /Flags：字体字典优先，缺失时兜底取 FontDescriptor（多数 PDF 只写在 descriptor 里）
    let flags = null;
    const fr = entryVal(es, "Flags");
    if (fr != null) {
      const fv = parseInt(String(fr).trim(), 10);
      if (!isNaN(fv)) flags = fv;
    }
    if (flags == null && desc.flags != null) flags = desc.flags;
    const flagObj = {};
    if (flags != null) for (const b of FLAG_BITS) flagObj[b.key] = !!(flags & b.bit);

    const fc = entryVal(es, "FirstChar");
    const lc = entryVal(es, "LastChar");
    const firstChar = fc != null ? parseInt(String(fc).trim(), 10) : null;
    const lastChar = lc != null ? parseInt(String(lc).trim(), 10) : null;
    const widthsVal = entryVal(es, "Widths");
    let widthCount = null;
    if (widthsVal && widthsVal.charAt(0) === "[") {
      const nums = widthsVal.slice(1, -1).match(/-?\d+(\.\d+)?/g);
      widthCount = nums ? nums.length : 0;
    }

    // 嵌入判定：Type3 字形由内容流过程定义，无需嵌入字体文件
    let embedded = desc.embedded;
    let embeddedAs = desc.embeddedAs;
    if (subtype === "Type3" && !embedded) { embedded = true; embeddedAs = "Type3 字形过程"; }

    const family = ss.family || desc.family || "";
    const isStandard14 = STANDARD_14.indexOf(family) >= 0;
    // 风险：未嵌入且非标准 14 → 依赖查看器本地字体，显示/打印/提取可能失真
    const risky = !embedded && !isStandard14;

    return {
      obj: objNum,
      resName: resName || null,
      baseFont: baseFont || null,
      family: family || null,
      subset: ss.subset,
      subsetTag: ss.tag,
      subtype: subtype,
      typeLabel: FONT_TYPES[subtype] || (subtype || "未知"),
      encoding: enc,
      toUnicode: toUnicode,
      hasDescriptor: desc.has,
      descriptorSource: descSource,
      embedded: embedded,
      embeddedAs: embeddedAs,
      isStandard14: isStandard14,
      risky: risky,
      flags: flags,
      flagLabels: FLAG_BITS.filter(b => flags != null && (flags & b.bit)).map(b => b.label),
      fixedPitch: flags != null ? !!(flags & 1) : null,
      serif: flags != null ? !!(flags & 2) : null,
      symbolic: flags != null ? !!(flags & 4) : null,
      script: flags != null ? !!(flags & 8) : null,
      nonsymbolic: flags != null ? !!(flags & 32) : null,
      italic: flags != null ? !!(flags & 64) : null,
      allCap: flags != null ? !!(flags & 65536) : null,
      smallCap: flags != null ? !!(flags & 131072) : null,
      forceBold: flags != null ? !!(flags & 262144) : null,
      firstChar: firstChar != null && !isNaN(firstChar) ? firstChar : null,
      lastChar: lastChar != null && !isNaN(lastChar) ? lastChar : null,
      widthCount: widthCount,
      pages: []
    };
  }

  // —— 页面树遍历 ——
  function findRootDict(txt) {
    const refM = /\/Root\s+(\d+)\s+0\s+R/.exec(txt);
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) return o.str; }
    const inM = /\/Root\s*<<[\s\S]*?\/Type\s*\/Catalog[\s\S]*?>>/.exec(txt);
    if (inM) return inM[0];
    return null;
  }

  function findPagesNode(txt, rootDict) {
    if (!rootDict) return null;
    const refM = /\/Pages\s+(\d+)\s+0\s+R/.exec(rootDict);
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) return { str: o.str, obj: +refM[1] }; }
    const inM = /\/Pages\s*<<[\s\S]*?\/Kids\s*\[/.exec(rootDict);
    if (inM) {
      const lt = inM.index + inM[0].indexOf("<<");
      const str = sliceDict(rootDict, lt);
      if (str) return { str, obj: null };
    }
    return null;
  }

  function collectLeaves(txt, nodeDict, parentObj, out, counter) {
    const kidsM = /\/Kids\s*\[([\s\S]*?)\]/.exec(nodeDict);
    if (!kidsM) return;
    const refRe = /(\d+)\s+(\d+)\s+R/g;
    let rm;
    while ((rm = refRe.exec(kidsM[1]))) {
      const num = +rm[1];
      const o = getObjDict(txt, num);
      if (!o) continue;
      if (/\/Type\s*\/Pages\b/.test(o.str)) {
        collectLeaves(txt, o.str, num, out, counter);
      } else if (/\/Type\s*\/Page\b/.test(o.str)) {
        out.push({ num: counter.n++, obj: num, dict: o.str, parentObj });
      }
    }
  }

  /** 取节点的 /Resources 字典串（内联或引用）。 */
  function nodeResources(txt, d) {
    const refM = /\/Resources\s+(\d+)\s+0\s+R/.exec(d);
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) return o.str; }
    const inM = /\/Resources\s*<</.exec(d);
    if (inM) {
      const lt = inM.index + inM[0].indexOf("<<");
      return sliceDict(d, lt);
    }
    return null;
  }

  /** 解析页面 /Resources，缺失时沿 /Parent 链向上继承。 */
  function resolvePageResources(txt, pageObj, pageDict) {
    const seen = new Set();
    let curObj = pageObj, curDict = pageDict;
    while (curDict) {
      const r = nodeResources(txt, curDict);
      if (r) return r;
      const pm = /\/Parent\s+(\d+)\s+0\s+R/.exec(curDict);
      if (!pm) return null;
      const num = +pm[1];
      if (seen.has(num)) return null;
      seen.add(num);
      const o = getObjDict(txt, num);
      if (!o) return null;
      curObj = num; curDict = o.str;
    }
    return null;
  }

  /** 从 /Resources 字典取 /Font 子字典串（内联或引用）。 */
  function fontSubDict(txt, resDict) {
    if (!resDict) return null;
    const refM = /\/Font\s+(\d+)\s+0\s+R/.exec(resDict);
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) return o.str; }
    const inM = /\/Font\s*<</.exec(resDict);
    if (inM) {
      const lt = inM.index + inM[0].indexOf("<<");
      return sliceDict(resDict, lt);
    }
    return null;
  }

  /** 主函数：解析 PDF 字体信息。 */
  function parseFonts(bytes) {
    const txt = bytesToString(bytes);
    const res = {
      hasPageTree: false,
      hasFonts: false,
      totalPages: 0,
      fonts: [],
      pageFonts: [],
      summary: {
        totalFonts: 0,
        byType: {},
        embeddedCount: 0,
        notEmbeddedCount: 0,
        subsetCount: 0,
        standard14Count: 0,
        riskyCount: 0,
        riskyFonts: [],
        withToUnicode: 0,
        pagesWithFonts: 0
      }
    };

    const rootDict = findRootDict(txt);
    const pagesNode = findPagesNode(txt, rootDict);
    const leaves = [];
    if (pagesNode) {
      const counter = { n: 1 };
      collectLeaves(txt, pagesNode.str, pagesNode.obj, leaves, counter);
      res.hasPageTree = true;
    }
    res.totalPages = leaves.length;

    const byObj = new Map();   // 对象号 → 字体记录（去重合并）
    const pageFonts = [];

    if (leaves.length) {
      for (const leaf of leaves) {
        const resDict = resolvePageResources(txt, leaf.obj, leaf.dict);
        const fDict = fontSubDict(txt, resDict);
        const es = fDict ? dictEntries(fDict) : [];
        const names = [];
        for (const e of es) {
          // /F1 6 0 R 或 /F1 << ... >>
          let dictStr = null, objNum = null;
          if (e.value.indexOf("<<") === 0) {
            dictStr = e.value;
          } else {
            const rm = /^(\d+)\s+(\d+)\s+R/.exec(String(e.value).trim());
            if (rm) {
              objNum = +rm[1];
              const o = getObjDict(txt, objNum);
              if (o) dictStr = o.str;
            }
          }
          if (!dictStr) continue;
          if (objNum == null) objNum = -(byObj.size + 1); // 内联字体无对象号 → 伪号
          let rec = byObj.get(objNum);
          if (!rec) {
            rec = buildFont(txt, dictStr, e.key, objNum);
            byObj.set(objNum, rec);
          } else if (!rec.resName && e.key) {
            rec.resName = e.key;
          }
          if (rec.pages.indexOf(leaf.num) < 0) rec.pages.push(leaf.num);
          names.push(rec);
        }
        pageFonts.push({ page: leaf.num, fonts: names.map(f => ({ resName: f.resName, family: f.family, obj: f.obj })) });
      }
    } else {
      // 兜底：无页面树时扫描全文档 /Type /Font 对象
      const objRe = /(\d+)\s+0\s+obj\s*<</g;
      let m;
      const seenObj = new Set();
      while ((m = objRe.exec(txt))) {
        const num = +m[1];
        if (seenObj.has(num)) continue;
        seenObj.add(num);
        const lt = m.index + m[0].length - 2;
        const str = sliceDict(txt, lt);
        if (!str) continue;
        if (!/\/Type\s*\/Font\b/.test(str)) continue;
        const rec = buildFont(txt, str, null, num);
        byObj.set(num, rec);
      }
    }

    const fonts = Array.from(byObj.values());
    // 排序：先按首次出现页，再按资源名
    fonts.sort((a, b) => {
      const pa = a.pages.length ? a.pages[0] : Infinity;
      const pb = b.pages.length ? b.pages[0] : Infinity;
      if (pa !== pb) return pa - pb;
      return String(a.resName || "").localeCompare(String(b.resName || ""));
    });
    fonts.forEach((f, i) => { f.index = i + 1; f.pages.sort((x, y) => x - y); });

    res.fonts = fonts;
    res.pageFonts = pageFonts;
    res.hasFonts = fonts.length > 0;

    // —— 派生摘要 ——
    const byType = {};
    let embeddedCount = 0, notEmbeddedCount = 0, subsetCount = 0;
    let standard14Count = 0, withToUnicode = 0, pagesWithFonts = 0;
    const riskyFonts = [];
    for (const f of fonts) {
      const t = f.subtype || "未知";
      byType[t] = (byType[t] || 0) + 1;
      if (f.embedded) embeddedCount++; else notEmbeddedCount++;
      if (f.subset) subsetCount++;
      if (f.isStandard14) standard14Count++;
      if (f.toUnicode) withToUnicode++;
      if (f.risky) riskyFonts.push(f.family || f.baseFont || ("对象" + f.obj));
    }
    for (const pf of pageFonts) if (pf.fonts.length) pagesWithFonts++;

    res.summary = {
      totalFonts: fonts.length,
      byType,
      embeddedCount,
      notEmbeddedCount,
      subsetCount,
      standard14Count,
      riskyCount: riskyFonts.length,
      riskyFonts,
      withToUnicode,
      pagesWithFonts
    };
    return res;
  }

  function summarize(res) {
    if (!res) return { totalFonts: 0, hasFonts: false };
    return {
      hasFonts: res.hasFonts,
      hasPageTree: res.hasPageTree,
      totalPages: res.totalPages,
      totalFonts: res.summary ? res.summary.totalFonts : 0,
      byType: res.summary ? res.summary.byType : {},
      embeddedCount: res.summary ? res.summary.embeddedCount : 0,
      notEmbeddedCount: res.summary ? res.summary.notEmbeddedCount : 0,
      subsetCount: res.summary ? res.summary.subsetCount : 0,
      standard14Count: res.summary ? res.summary.standard14Count : 0,
      riskyCount: res.summary ? res.summary.riskyCount : 0,
      riskyFonts: res.summary ? res.summary.riskyFonts : [],
      withToUnicode: res.summary ? res.summary.withToUnicode : 0,
      pagesWithFonts: res.summary ? res.summary.pagesWithFonts : 0
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtPages(pages) {
    if (!pages || !pages.length) return "—";
    const ps = pages.slice().sort((a, b) => a - b);
    if (ps.length <= 6) return "第 " + ps.join("、") + " 页";
    return "第 " + ps.slice(0, 5).join("、") + " 页等 " + ps.length + " 页";
  }

  function toMarkdown(res, opts) {
    opts = opts || {};
    const lines = ["# " + (opts.title || "PDF 字体信息"), ""];
    if (!res.hasFonts) {
      lines.push("（未发现 PDF 字体资源）");
      return lines.join("\n");
    }
    const s = res.summary;
    lines.push("## 摘要");
    lines.push("- **字体总数**：" + s.totalFonts + " 个（按字体对象去重）");
    lines.push("- **已嵌入**：" + s.embeddedCount + " · **未嵌入**：" + s.notEmbeddedCount);
    lines.push("- **子集字体**：" + s.subsetCount + " · **标准 14 字体**：" + s.standard14Count);
    lines.push("- **含 ToUnicode 映射**：" + s.withToUnicode + "（影响文本复制/搜索）");
    lines.push("- **使用字体的页数**：" + s.pagesWithFonts + " / " + res.totalPages);
    lines.push("- **类型分布**：" + Object.keys(s.byType).map(k => k + "×" + s.byType[k]).join(" · "));
    if (s.riskyCount) {
      lines.push("");
      lines.push("> ⚠ **风险提示**：以下 " + s.riskyCount + " 个字体未嵌入且非标准 14 字体，");
      lines.push("> 依赖查看器本地字形，换机/打印/转换时可能显示失真或无法提取文本：");
      lines.push("> " + s.riskyFonts.join("、"));
    } else {
      lines.push("- **风险**：无未嵌入的非标准字体");
    }
    lines.push("");
    lines.push("## 字体清单");
    for (const f of res.fonts) {
      lines.push("### " + f.index + ". " + (f.family || f.baseFont || "未知字体") +
        (f.resName ? "（资源名 /" + f.resName + "）" : "") +
        (f.subset ? " · 子集" : ""));
      lines.push("- **类型**：" + f.typeLabel);
      lines.push("- **BaseFont**：" + (f.baseFont || "—") + (f.subset ? "（子集前缀 " + f.subsetTag + "+）" : ""));
      lines.push("- **嵌入**：" + (f.embedded ? ("是 · " + (f.embeddedAs || "")) : "否") +
        (f.isStandard14 ? "（标准 14 字体，查看器内置）" : ""));
      lines.push("- **编码**：" + (f.encoding || "—") + " · **ToUnicode**：" + (f.toUnicode ? "有" : "无"));
      if (f.flags != null) {
        lines.push("- **Flags**：" + f.flags + (f.flagLabels.length ? "（" + f.flagLabels.join("·") + "）" : ""));
      }
      if (f.firstChar != null && f.lastChar != null) {
        lines.push("- **字符范围**：" + f.firstChar + "–" + f.lastChar +
          (f.widthCount != null ? " · 宽度表 " + f.widthCount + " 项" : ""));
      }
      lines.push("- **使用页**：" + fmtPages(f.pages));
      lines.push("");
    }
    lines.push("## 逐页字体");
    for (const pf of res.pageFonts) {
      lines.push("- **第 " + pf.page + " 页**：" +
        (pf.fonts.length ? pf.fonts.map(f => "/" + f.resName + "(" + (f.family || "?") + ")").join(" · ") : "无字体资源"));
    }
    return lines.join("\n");
  }

  function toHtml(res) {
    if (!res.hasFonts) {
      return `<div style="color:#999;padding:6px 0">（未发现 PDF 字体资源）</div>`;
    }
    const s = res.summary;
    let html = `<div style="font-size:13px">`;
    html += `<div style="font-weight:600;margin:4px 0;color:#444">摘要</div>`;
    html += `<div style="padding:4px 0;color:#333">字体 <b>${s.totalFonts}</b> 个 · 已嵌入 <b style="color:#1a7f37">${s.embeddedCount}</b> · 未嵌入 <b>${s.notEmbeddedCount}</b> · 子集 ${s.subsetCount} · 标准14 ${s.standard14Count}</div>`;
    html += `<div style="padding:4px 0;color:#555">类型：${Object.keys(s.byType).map(k => escapeHtml(k) + "×" + s.byType[k]).join(" · ")} ｜ 含 ToUnicode ${s.withToUnicode}</div>`;
    if (s.riskyCount) {
      html += `<div style="margin:6px 0;padding:6px 8px;border-left:3px solid #d1242f;background:#fff5f5;color:#a40e26">⚠ 未嵌入且非标准 14 的字体 ${s.riskyCount} 个：${escapeHtml(s.riskyFonts.join("、"))}<br><span style="color:#8a6d00">换机/打印/转换时可能显示失真或无法提取文本</span></div>`;
    } else {
      html += `<div style="margin:6px 0;padding:6px 8px;border-left:3px solid #1a7f37;background:#f2fbf4;color:#1a7f37">✓ 未发现未嵌入的非标准字体</div>`;
    }
    html += `<div style="font-weight:600;margin:8px 0 2px;color:#444">字体清单</div>`;
    html += `<div style="border:1px solid #eee;border-radius:6px;overflow:hidden">`;
    res.fonts.forEach((f, i) => {
      const bg = i % 2 ? "#fafafa" : "#fff";
      const embColor = f.embedded ? "#1a7f37" : (f.isStandard14 ? "#8a6d00" : "#d1242f");
      const embText = f.embedded ? ("已嵌入" + (f.embeddedAs ? " · " + escapeHtml(f.embeddedAs) : "")) : (f.isStandard14 ? "未嵌入 · 标准14(查看器内置)" : "未嵌入 ⚠");
      html += `<div style="padding:7px 9px;border-bottom:1px solid #eee;background:${bg}">` +
        `<div><b>${f.index}. ${escapeHtml(f.family || f.baseFont || "未知字体")}</b> ` +
        `<span style="color:#888">${f.resName ? "· /" + escapeHtml(f.resName) : ""}${f.subset ? " · 子集(" + escapeHtml(f.subsetTag) + "+)" : ""}</span></div>` +
        `<div style="color:#555;margin-top:2px">${escapeHtml(f.typeLabel)} · <span style="color:${embColor}">${embText}</span></div>` +
        `<div style="color:#888;margin-top:2px">编码 ${escapeHtml(f.encoding || "—")} · ToUnicode ${f.toUnicode ? "有" : "无"}` +
        `${f.flags != null ? " · Flags " + f.flags + (f.flagLabels.length ? "(" + escapeHtml(f.flagLabels.join("·")) + ")" : "") : ""}` +
        ` · ${escapeHtml(fmtPages(f.pages))}</div>` +
        `</div>`;
    });
    html += `</div>`;
    html += `<div style="font-weight:600;margin:10px 0 2px;color:#444">逐页字体</div>`;
    for (const pf of res.pageFonts) {
      html += `<div style="padding:2px 0;color:#555">第 ${pf.page} 页：${pf.fonts.length ? pf.fonts.map(f => "/" + escapeHtml(f.resName) + "(" + escapeHtml(f.family || "?") + ")").join(" · ") : "<span style='color:#999'>无字体资源</span>"}</div>`;
    }
    html += `</div>`;
    return html;
  }

  const Api = {
    bytesToString, sliceDict, getObjDict, parseValue, parseDictEntries, dictEntries,
    entryVal, valueAsDict, splitSubset, parseEncoding, parseDescriptor, descendantDescriptor,
    buildFont, findRootDict, findPagesNode, collectLeaves, nodeResources,
    resolvePageResources, fontSubDict,
    parseFonts, summarize, toMarkdown, toHtml,
    STANDARD_14, FONT_TYPES
  };
  OS.PdfFonts = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
