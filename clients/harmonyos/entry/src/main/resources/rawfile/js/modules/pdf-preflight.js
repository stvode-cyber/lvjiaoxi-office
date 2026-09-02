/* ============================================================
   绿角犀 Office · PDF 结构预检 / 完整性诊断（零依赖，字节级）
   ------------------------------------------------------------
   AQ：对任意 PDF 做只读结构体检，不修改文件。诊断项（16 项，error/warn/info 三级）：
     1  header-version   %PDF-x.y 头缺失或版本异常               info/warn
     2  eof              文件不以 %%EOF 结尾                     warn
     3  startxref        缺 startxref 偏移                       error
     4  xref             既无 xref 表也无 xref 流                error
     5  trailer-root     缺 trailer /Root 引用                   error
     6  root-defined     /Root 指向的对象未定义（悬挂）          error
     7  catalog-type     /Root 对象非 /Catalog                   warn
     8  size-consistency trailer /Size 与最大对象号不符          warn/info
     9  dangling-refs    引用了未定义对象（全文扫描，排除流内）  error
    10  duplicate-objects 同一对象号多次定义                     warn
    11  page-tree-cycle  页面树 /Kids 环（带 visited 安全走树）  error
    12  page-count       页面树不可达 / 页数为 0                 warn
    13  stream-length    流缺 /Length                            warn
    14  stream-length    流 /Length 为间接引用                   info
    15  stream-length    流 /Length 与实际数据失配（±2 容差）    warn
    16  objstm-fail      /ObjStm 解压失败                        error
    17  orphan-objects   已定义但无任何引用指向的孤儿对象        info
   PDF 1.5+ 对象流（ObjStm）经解压展开后参与判定（复用 OS.PdfTool._inflate / parseObjStm）。
   注意：不使用 OS.PdfTool.parsePdf 的页面树递归（其 walk 无环保护，遇环会栈溢出）。
   异步接口（ObjStm 解压依赖 DecompressionStream）。浏览器与 Node 双导出。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // ---------------- 字节 / 字符串互转 ----------------
  function toStr(u8) {
    if (typeof u8 === "string") return u8;
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  // 在字节序列中定位 ASCII 关键字（如 "stream"）的起始偏移
  function findAscii(u8, keyword, from) {
    for (let i = from; i + keyword.length <= u8.length; i++) {
      let ok = true;
      for (let j = 0; j < keyword.length; j++) if (u8[i + j] !== keyword.charCodeAt(j)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  // 对象体 → 字典文本（"stream" 关键字之前，流二进制不参与正则扫描）
  function dictPartOf(innerBytes) {
    const si = findAscii(innerBytes, "stream", 0);
    return si >= 0 ? toStr(innerBytes.subarray(0, si)) : toStr(innerBytes);
  }

  // 提取流数据（endstream 前 EOL 剥除，与 OS.PdfTool.extractStreamData 同逻辑）
  function streamDataOf(innerBytes) {
    const si = findAscii(innerBytes, "stream", 0);
    if (si < 0) return null;
    let start = si + 6;
    if (innerBytes[start] === 0x0a) start++;
    else if (innerBytes[start] === 0x0d) { start++; if (innerBytes[start] === 0x0a) start++; }
    const es = findAscii(innerBytes, "endstream", start);
    let end = es >= 0 ? es : innerBytes.length;
    if (end > start) {
      if (innerBytes[end - 1] === 0x0a) { end--; if (end > start && innerBytes[end - 1] === 0x0d) end--; }
      else if (innerBytes[end - 1] === 0x0d) end--;
    }
    if (end <= start) return null;
    return innerBytes.subarray(start, end);
  }

  // 平衡切分第一个 <<...>>（含定界符；闭合处 slice 至 i+1 保住末位 >）
  function firstBalancedDict(seg) {
    const open = seg.indexOf("<<");
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < seg.length; i++) {
      if (seg[i] === "<" && seg[i + 1] === "<") { depth++; i++; }
      else if (seg[i] === ">" && seg[i + 1] === ">") { depth--; i++; if (depth === 0) return seg.slice(open, i + 1); }
    }
    return null;
  }

  const LEVEL_ORDER = { error: 0, warn: 1, info: 2 };
  const LEVEL_TEXT = { error: "错误", warn: "警告", info: "提示" };
  const VERDICT_TEXT = { errors: "存在结构错误", warnings: "存在警告", pass: "结构完好" };

  // ---------------- 主解析（异步：ObjStm 解压） ----------------
  async function parse(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(0);
    const str = toStr(bytes);
    const checks = [];

    function add(id, level, title, detail, count) {
      checks.push({ id, level, title, detail: detail || "", count: count == null ? 1 : count });
    }

    // —— 1. 头部版本 ——
    const hm = /^%PDF-(\d\.\d)/.exec(str);
    if (!hm) add("header-version", "warn", "PDF 头缺失", "未找到 %PDF-x.y 版本头，阅读器可能按修复模式打开");
    else if (!/^1\.[0-7]$/.test(hm[1])) add("header-version", "info", "版本号非常规", "检测到 PDF " + hm[1] + "，非常规 1.0~1.7 版本");

    // —— 2. %%EOF ——
    if (!/%%EOF\s*$/.test(str) && str.indexOf("%%EOF") < 0) add("eof", "warn", "缺少 %%EOF 结尾标记", "文件尾部未找到 %%EOF");

    // —— 3. startxref ——
    const sxm = /startxref\s+(\d+)/.exec(str);
    if (!sxm) add("startxref", "error", "缺少 startxref", "未找到 startxref 偏移声明，阅读器无法定位交叉引用表");

    // —— 4. xref 表 / xref 流 ——
    const hasXrefTable = /(^|[\s\r\n>])xref\s*[\r\n]+\s*\d+\s+\d+/.test(str);
    const hasXrefStream = /\/Type\s*\/?\s*XRef\b/.test(str);
    if (!hasXrefTable && !hasXrefStream) add("xref", "error", "交叉引用缺失", "既无经典 xref 表也无 xref 流（/Type /XRef）");

    // —— 5. trailer /Root ——
    let rootRef = 0, sizeVal = 0, hasTrailerDict = false;
    const rootMatches = str.match(/\/Root\s+(\d+)\s+\d+\s+R/g);
    if (rootMatches && rootMatches.length) {
      const last = rootMatches[rootMatches.length - 1];
      rootRef = parseInt(last.replace(/^\/Root\s+/, "").replace(/\s+\d+\s+R$/, ""), 10);
      hasTrailerDict = true;
    }
    const sizeM = /\/Size\s+(\d+)/g;
    let sm;
    while ((sm = sizeM.exec(str)) !== null) sizeVal = parseInt(sm[1], 10);
    if (/trailer[\s\r\n]*<</.test(str) || hasXrefStream) hasTrailerDict = true;
    if (!hasTrailerDict || !rootMatches) add("trailer-root", "error", "缺少 trailer /Root", "未找到文档目录（/Root）引用");

    // —— 对象扫描（含 ObjStm 展开） ——
    const objects = new Map();          // num -> innerBytes（展开后）
    const dupNums = [];
    const re = /(\d+)\s+\d+\s+obj(?![\d])/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const num = parseInt(m[1], 10);
      const bodyStart = m.index + m[0].length;
      const endKw = str.indexOf("endobj", bodyStart);
      const bodyEnd = endKw >= 0 ? endKw : Math.min(bodyStart + 4096, str.length);
      if (objects.has(num)) dupNums.push(num);
      else objects.set(num, bytes.subarray(bodyStart, bodyEnd));
    }

    // ObjStm 展开：解压后并入 objects，容器本身移除
    const objstmFail = [];
    for (const [num, inner] of Array.from(objects.entries())) {
      const d = dictPartOf(inner);
      if (!/\/Type\s*\/?\s*ObjStm\b/.test(d)) continue;
      const sd = streamDataOf(inner);
      let comp = null;
      if (sd && global.OS && OS.PdfTool && OS.PdfTool._inflate) {
        try { comp = await OS.PdfTool._inflate(sd); } catch (e) { comp = null; }
      }
      if (!comp) { objstmFail.push(num); continue; }
      const expanded = OS.PdfTool.parseObjStm(comp, d);
      for (const [kn, kb] of expanded) if (!objects.has(kn)) objects.set(kn, kb);
      objects.delete(num);
    }
    if (objstmFail.length) add("objstm-fail", "error", "对象流解压失败", "无法解压 /ObjStm（对象 " + objstmFail.slice(0, 5).join(", ") + (objstmFail.length > 5 ? " 等" : "") + "），其中对象不可达", objstmFail.length);

    const maxNum = objects.size ? Math.max.apply(null, Array.from(objects.keys())) : 0;

    // —— 10. 重复对象 ——
    if (dupNums.length) {
      const uniq = Array.from(new Set(dupNums));
      add("duplicate-objects", "warn", "重复对象定义", "对象 " + uniq.slice(0, 5).join(", ") + (uniq.length > 5 ? " 等" : "") + " 被多次定义（增量更新场景请人工确认）", uniq.length);
    }

    // —— 6./7. Root 对象 ——
    if (rootRef && objects.has(rootRef)) {
      const rd = dictPartOf(objects.get(rootRef));
      if (!/\/Type\s*\/?\s*Catalog\b/.test(rd)) add("catalog-type", "warn", "Root 非 Catalog", "/Root 指向对象 " + rootRef + "，但其字典缺少 /Type /Catalog");
    } else if (rootRef) {
      add("root-defined", "error", "Root 对象未定义", "/Root 指向对象 " + rootRef + "，但该对象在文件中不存在（悬挂引用）");
    }

    // —— 8. /Size 一致性 ——
    if (sizeVal && maxNum) {
      if (sizeVal < maxNum + 1) add("size-consistency", "warn", "trailer /Size 偏小", "/Size " + sizeVal + " < 最大对象号+1（" + (maxNum + 1) + "），部分对象不在引用计数内");
      else if (sizeVal > maxNum + 1) add("size-consistency", "info", "trailer /Size 偏大", "/Size " + sizeVal + " > 最大对象号+1（" + (maxNum + 1) + "），可能为增量更新或删除对象后未清理");
    }

    // —— 9. 悬挂引用（仅扫描各对象字典部分 + trailer 文本，不扫流二进制） ——
    let refText = "";
    for (const inner of objects.values()) refText += dictPartOf(inner) + "\n";
    if (hasXrefTable) {
      const xi = str.lastIndexOf("xref");
      const ti = str.lastIndexOf("startxref");
      refText += str.slice(Math.max(xi, ti - 400) < 0 ? 0 : Math.max(0, ti - 400), ti >= 0 ? ti : str.length) + "\n";
    }
    const refRe = /(\d+)\s+\d+\s+R/g;
    const referenced = new Set();
    const danglingSet = new Set();
    let totalRefs = 0;
    while ((m = refRe.exec(refText)) !== null) {
      const n = parseInt(m[1], 10);
      if (!n) continue;
      totalRefs++;
      referenced.add(n);
      if (!objects.has(n)) danglingSet.add(n);
    }
    const dangling = Array.from(danglingSet).sort((a, b) => a - b);
    if (dangling.length) add("dangling-refs", "error", "悬挂引用（对象未定义）", "引用了未定义对象 " + dangling.slice(0, 6).join(", ") + (dangling.length > 6 ? " 等" : "") + "，阅读器在解析到相关内容时可能报错", dangling.length);

    // —— 11./12. 页面树安全走树（带 visited，防环） ——
    let pageRootNum = 0;
    if (rootRef && objects.has(rootRef)) {
      const pm = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(dictPartOf(objects.get(rootRef)));
      if (pm) pageRootNum = parseInt(pm[1], 10);
    }
    let pageCount = 0;
    const cycleNodes = [];
    if (pageRootNum) {
      const visited = new Set();
      const stack = [pageRootNum];
      while (stack.length) {
        const n = stack.pop();
        if (visited.has(n)) { cycleNodes.push(n); continue; }
        visited.add(n);
        const inner = objects.get(n);
        if (!inner) continue;
        const d = dictPartOf(inner);
        if (/\/Type\s*\/?\s*Page\b/.test(d) && !/\/Type\s*\/?\s*Pages\b/.test(d)) { pageCount++; continue; }
        const kidsM = d.match(/\/Kids\s*\[([\s\S]*?)\]/);
        if (kidsM) {
          const rs = kidsM[1].match(/(\d+)\s+\d+\s+R/g) || [];
          for (const r of rs) stack.push(parseInt(r.replace(/\s+\d+\s+R$/, ""), 10));
        }
      }
      if (cycleNodes.length) add("page-tree-cycle", "error", "页面树存在环", "/Kids 引用在对象 " + Array.from(new Set(cycleNodes)).slice(0, 5).join(", ") + " 处形成循环，走树终止", cycleNodes.length);
    }
    if (!pageRootNum && rootRef && objects.has(rootRef)) add("page-count", "warn", "页面树不可达", "Catalog 未引用 /Pages，文档无页面树");
    else if (pageRootNum && !cycleNodes.length && pageCount === 0) add("page-count", "warn", "文档页数为 0", "页面树可达但未发现 /Type /Page 节点");

    // —— 13./14./15. 流 /Length ——
    const noLen = [], lenRef = [], lenBad = [];
    for (const [num, inner] of objects.entries()) {
      const si = findAscii(inner, "stream", 0);
      if (si < 0) continue;
      const d = dictPartOf(inner);
      const lm = /\/Length\s+(\d+)\s+\d+\s+R/.exec(d);
      if (lm) { lenRef.push(num); continue; }
      const ln = /\/Length\s+(\d+)(?![\d\s]*\s+\d+\s+R)/.exec(d);
      if (!ln) { noLen.push(num); continue; }
      const declared = parseInt(ln[1], 10);
      const data = streamDataOf(inner);
      if (data && (declared > data.length + 2 || declared < data.length - 2)) {
        lenBad.push({ num, declared, actual: data.length });
      }
    }
    if (noLen.length) add("stream-length-missing", "warn", "流缺 /Length", "对象 " + noLen.slice(0, 5).join(", ") + (noLen.length > 5 ? " 等" : "") + " 的流未声明 /Length，阅读器需猜测边界", noLen.length);
    if (lenRef.length) add("stream-length-ref", "info", "流 /Length 为间接引用", "对象 " + lenRef.slice(0, 5).join(", ") + " 的 /Length 是间接对象（规范允许，但部分阅读器兼容性差）", lenRef.length);
    if (lenBad.length) add("stream-length-mismatch", "warn", "流 /Length 失配", lenBad.slice(0, 3).map(b => "对象 " + b.num + "（声明 " + b.declared + " ≠ 实际 " + b.actual + "）").join("；") + (lenBad.length > 3 ? " 等" : ""), lenBad.length);

    // —— 17. 孤儿对象 ——
    const orphans = [];
    for (const num of objects.keys()) {
      if (num === rootRef || referenced.has(num)) continue;
      orphans.push(num);
    }
    if (orphans.length) add("orphan-objects", "info", "孤儿对象（无引用指向）", "对象 " + orphans.slice(0, 6).join(", ") + (orphans.length > 6 ? " 等" : "") + " 已定义但无任何引用指向（占用体积，通常无害）", orphans.length);

    // ---------------- 汇总 ----------------
    checks.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    const summary = {
      errors: checks.filter(c => c.level === "error").reduce((s, c) => s + c.count, 0),
      warnings: checks.filter(c => c.level === "warn").reduce((s, c) => s + c.count, 0),
      infos: checks.filter(c => c.level === "info").reduce((s, c) => s + c.count, 0),
      objectCount: objects.size,
      pageCount: pageCount,
      totalRefs: totalRefs,
      checksCount: checks.length
    };
    summary.verdict = summary.errors ? "errors" : summary.warnings ? "warnings" : "pass";

    return {
      header: { version: hm ? hm[1] : null },
      hasXrefTable: hasXrefTable, hasXrefStream: hasXrefStream, hasStartxref: !!sxm,
      rootRef: rootRef, sizeVal: sizeVal, maxNum: maxNum,
      checks: checks, summary: summary
    };
  }

  // ---------------- 导出 ----------------
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function toMarkdown(res, opts) {
    const s = res.summary;
    const lines = [];
    lines.push("# " + ((opts && opts.title) || "PDF 结构预检报告"));
    lines.push("");
    lines.push("- **结论**：" + VERDICT_TEXT[s.verdict] + "（错误 " + s.errors + " / 警告 " + s.warnings + " / 提示 " + s.infos + "）");
    lines.push("- **对象数**：" + s.objectCount + " · **页数**：" + s.pageCount + " · **交叉引用**：" + s.totalRefs + " 处");
    lines.push("- **结构**：xref " + (res.hasXrefTable ? "表" : res.hasXrefStream ? "流" : "缺失") + " · startxref " + (res.hasStartxref ? "✓" : "✗") + " · /Root → 对象 " + (res.rootRef || "—"));
    if (res.header.version) lines.push("- **版本**：PDF " + res.header.version);
    lines.push("");
    if (!s.checksCount) {
      lines.push("全部 " + "17 项检查通过，未发现结构问题。");
      return lines.join("\n");
    }
    lines.push("| 级别 | 检查项 | 数量 | 说明 |");
    lines.push("|---|---|---|---|");
    for (const c of res.checks) {
      lines.push("| " + LEVEL_TEXT[c.level] + " | " + c.title + " | " + c.count + " | " + c.detail + " |");
    }
    lines.push("");
    lines.push("> 本报告由绿角犀 Office 结构预检生成（只读诊断，不修改文件）。");
    return lines.join("\n");
  }

  function toHtml(res) {
    const s = res.summary;
    const color = { error: "#d1242f", warn: "#8a6d00", info: "#57606a" };
    let html = "<div style='font:12px/1.6 sans-serif'>";
    html += "<div style='display:flex;gap:10px;margin-bottom:8px'>" +
      "<span>对象 <b>" + s.objectCount + "</b></span><span>页数 <b>" + s.pageCount + "</b></span>" +
      "<span>引用 <b>" + s.totalRefs + "</b> 处</span>" +
      "<span>xref " + (res.hasXrefTable ? "表" : res.hasXrefStream ? "流" : "<span style='color:#d1242f'>缺失</span>") + "</span></div>";
    if (!s.checksCount) {
      html += "<div style='color:#1a7f37;padding:8px 10px;background:#f0fff4;border:1px solid #d1f0d9;border-radius:6px'>全部 17 项检查通过，未发现结构问题。</div>";
    } else {
      for (const c of res.checks) {
        html += "<div style='display:flex;gap:8px;padding:5px 8px;border-bottom:1px solid #eee;align-items:baseline'>" +
          "<span style='flex:0 0 34px;font-weight:bold;color:" + color[c.level] + "'>" + LEVEL_TEXT[c.level] + "</span>" +
          "<span style='flex:0 0 150px;font-weight:bold'>" + escapeHtml(c.title) + "</span>" +
          "<span style='flex:0 0 34px'>×" + c.count + "</span>" +
          "<span style='flex:1;color:#555'>" + escapeHtml(c.detail) + "</span></div>";
      }
    }
    html += "</div>";
    return html;
  }

  const Api = { parse: parse, toMarkdown: toMarkdown, toHtml: toHtml };
  OS.PdfPreflight = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
