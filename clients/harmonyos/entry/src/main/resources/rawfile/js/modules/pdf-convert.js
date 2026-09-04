/* ============================================================
   绿角犀 Office · PDF 文本提取（轻量骨架：DOCX / 纯文本 / Markdown）
   - 输入：textIndex.pages —— 每页归一化 span 数组
           {text,x,y,w,h}，x 由页左向右(0..1)，y 由页顶向下(0..1)，h 为归一化字号
           （与 app/js/modules/pdf.js 文本层、app/js/modules/pdf-text.js 完全一致）
   - 纯逻辑：按 y 聚类成行 → 行内按 x 排序 → 大字号行判为标题
   - 生成 Writer 可编辑 HTML → OS.Exporter.buildDocx 成 DOCX
   - 已知边界：仅文本层提取，无版面/分栏/表格/图片/字体还原，质量有限；
             适合以段落文字为主的 PDF（论文、报告、书籍）。属 PDF⇄Office 的
             「PDF→DOCX / 文本 / Markdown」文本提取（部分实现）。
   - 不依赖 pdf.js / jsdom，可在 node 直跑单测（clusterLines / pdfToDocxHtml）。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = (global.OS = global.OS || {});

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // 单行聚类：把一页的 span 按阅读顺序（y 升序、行内 x 升序）合并为行
  // 返回 [{text, x, y, h}]（行级：已合并文本、记录行首 x、行 y、行内最大字号 h）
  // 改进：同行基线抖动容差+软换行合并（同段落内换行保留为一个段落）
  function clusterLines(spans) {
    if (!Array.isArray(spans)) return [];
    const items = spans
      .filter(s => s && typeof s.text === "string" && s.text.trim().length)
      .map(s => ({
        text: s.text,
        x: typeof s.x === "number" && isFinite(s.x) ? s.x : 0,
        y: typeof s.y === "number" && isFinite(s.y) ? s.y : 0,
        h: (typeof s.h === "number" && s.h > 0) ? s.h : 0.015
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    const lines = [];
    let cur = null, baseY = null;
    for (const it of items) {
      // 行容差：取字号相关的 55% 容忍软换行/基线抖动，较大间距才分新行
      const tol = Math.max(0.55 * it.h, 0.012);
      if (cur === null || Math.abs(it.y - baseY) > tol) {
        cur = { items: [], baseY: it.y, avgH: 0 };
        lines.push(cur);
        baseY = it.y;
      } else {
        baseY = (baseY + it.y) / 2;
        cur.baseY = baseY;
      }
      cur.items.push(it);
      cur.avgH = (cur.avgH * cur.items.length + it.h) / (cur.items.length + 1);
    }
    return lines.map(line => {
      const sorted = line.items.slice().sort((a, b) => a.x - b.x);
      const text = sorted.map(s => s.text).join(" ");
      const maxH = sorted.reduce((m, s) => Math.max(m, s.h), 0);
      return { text: text, x: sorted[0].x, y: line.baseY, h: maxH };
    });
  }

  // 全文中位字号（用于相对标题判定）
  function medianH(pages) {
    const hs = [];
    (Array.isArray(pages) ? pages : []).forEach(sp => {
      (Array.isArray(sp) ? sp : []).forEach(s => { if (s && s.h > 0) hs.push(s.h); });
    });
    if (!hs.length) return 0.015;
    hs.sort((a, b) => a - b);
    return hs[Math.floor(hs.length / 2)] || 0.015;
  }

  // pages → Writer HTML（标题 <h1>/<h2>/<h3>，正文 <p>，列表 <ul>/<ol>，跨页分页）
  // 改进：段落合并（连续等间距行合为一段）、列表检测、多级标题
  function pdfToDocxHtml(pages) {
    if (!Array.isArray(pages) || !pages.length) return "";
    const med = medianH(pages);
    const h3Thresh = Math.max(0.020, med * 1.3);   // 稍大 → <h3>
    const h2Thresh = Math.max(0.024, med * 1.7);   // 显著大 → <h2>
    const h1Thresh = Math.max(0.032, med * 2.4);   // 很大 → <h1>
    const paraGap = Math.max(med * 0.8, 0.018); // 段落间距阈值（约 1.2 行高）

    const blocks = [];
    pages.forEach((spans, pi) => {
      const lines = clusterLines(spans || []);
      if (!lines.length) { if (pi < pages.length - 1) blocks.push(`<div class="page-break"></div>`); return; }

      // 第一步：段落合并（连续行间距小于阈值 → 同段内 <br> 换行）
      const paragraphs = [];
      let curPara = [lines[0]];
      for (let i = 1; i < lines.length; i++) {
        const gap = lines[i].y - lines[i - 1].y;
        const lineH = Math.max(lines[i - 1].h, 0.015);
        // 间距 > 0.8*行高 → 新段落
        if (gap > paraGap) {
          paragraphs.push(curPara);
          curPara = [lines[i]];
        } else {
          curPara.push(lines[i]);
        }
      }
      paragraphs.push(curPara);

      // 第二步：检测并渲染每个段落
      let inList = false, listType = null;
      for (const para of paragraphs) {
        const firstLine = para[0];
        // 标题判定（由大到小，互斥）
        const isH1 = firstLine.h >= h1Thresh;
        const isH2 = !isH1 && firstLine.h >= h2Thresh;
        const isH3 = !isH1 && !isH2 && firstLine.h >= h3Thresh;
        const isHeading = isH1 || isH2 || isH3;

        // 关闭列表
        if (inList && !isHeading) {
          blocks.push(`</${listType}>`);
          inList = false; listType = null;
        }

        if (isHeading) {
          const tag = isH1 ? "h1" : (isH2 ? "h2" : "h3");
          blocks.push(`<${tag}>${esc(firstLine.text)}</${tag}>`);
          // 多行标题取第一行，其余行作为正文段落
          for (let li = 1; li < para.length; li++) {
            blocks.push(`<p>${esc(para[li].text)}</p>`);
          }
          continue;
        }

        // 行内列表检测：首行匹配有序/无序列表标记
        const listMatch = detectListType(firstLine.text);
        if (listMatch && para.length >= 1) {
          const isOrdered = listMatch === "ordered";
          const lt = isOrdered ? "ol" : "ul";
          if (!inList || listType !== lt) {
            if (inList) blocks.push(`</${listType}>`);
            blocks.push(`<${lt}>`);
            inList = true; listType = lt;
          }
          // 多行列表项合并为一项
          const itemText = para.map(l => esc(l.text)).join("<br>");
          // 去掉列表标记前缀
          const cleanText = itemText.replace(/^(<[^>]+>)?\s*(?:[•·●\-*]|\d+[\.\)]|[a-zA-Z][\.\)]|\(?\d+\))\s*/, "$1");
          blocks.push(`<li>${cleanText}</li>`);
          continue;
        }

        // 正文段落：多行合并为一段（<br> 软换行）
        if (para.length === 1) {
          blocks.push(`<p>${esc(firstLine.text)}</p>`);
        } else {
          const joined = para.map(l => esc(l.text)).join("<br>");
          if (joined.trim()) blocks.push(`<p>${joined}</p>`);
        }
      }
      if (inList) { blocks.push(`</${listType}>`); inList = false; listType = null; }

      if (pi < pages.length - 1) blocks.push(`<div class="page-break"></div>`);
    });
    return blocks.join("\n");
  }

  // 检测行文本的列表类型：null / "ordered" / "unordered"
  function detectListType(text) {
    if (!text) return null;
    const t = text.trim();
    if (/^[•·●\-*]\s/.test(t)) return "unordered";
    if (/^\d+[.\)]\s/.test(t)) return "ordered";
    if (/^[a-zA-Z][.\)]\s/.test(t)) return "ordered";
    if (/^\(\d+\)\s/.test(t)) return "ordered";
    return null;
  }

  // pages → DOCX（zip，JSZip 实例）；依赖 OS.Exporter.buildDocx
  function pdfToDocx(pages, name) {
    const html = pdfToDocxHtml(pages);
    const doc = { type: "writer", name: name || "PDF 转换", data: { html } };
    if (OS.Exporter && typeof OS.Exporter.buildDocx === "function") {
      return OS.Exporter.buildDocx(doc);
    }
    return null;
  }

  // pages → 纯文本（跨页行文本 join；opts.pageMarkers 时插入「--- 第 N 页 ---」分隔）
  function pdfToText(pages, opts) {
    opts = opts || {};
    if (!Array.isArray(pages) || !pages.length) return "";
    const parts = [];
    pages.forEach((spans, pi) => {
      const lines = clusterLines(spans || []).map(l => l.text);
      if (opts.pageMarkers && pi > 0) parts.push("--- 第 " + (pi + 1) + " 页 ---");
      parts.push(lines.join("\n"));
    });
    return parts.join("\n\n") + "\n";
  }

  // pages → Markdown（多级标题 #/##/###；正文段落以空行分隔；列表 -/1. 保留）
  function pdfToMarkdown(pages) {
    if (!Array.isArray(pages) || !pages.length) return "";
    const med = medianH(pages);
    const h3 = Math.max(0.020, med * 1.3);
    const h2 = Math.max(0.024, med * 1.7);
    const h1 = Math.max(0.032, med * 2.4);
    const paraGap = Math.max(med * 0.8, 0.018);
    const parts = [];
    pages.forEach((spans, pi) => {
      const lines = clusterLines(spans || []);
      if (!lines.length) return;

      // 段落合并
      const paragraphs = [];
      let curPara = [lines[0]];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].y - lines[i - 1].y > paraGap) {
          paragraphs.push(curPara);
          curPara = [lines[i]];
        } else {
          curPara.push(lines[i]);
        }
      }
      paragraphs.push(curPara);

      for (const para of paragraphs) {
        const first = para[0];
        const isH1 = first.h >= h1;
        const isH2 = first.h >= h2;
        const isH3 = first.h >= h3;
        const listType = detectListType(first.text);

        if (isH1) { parts.push("# " + first.text); }
        else if (isH2) { parts.push("## " + first.text); }
        else if (isH3) { parts.push("### " + first.text); }
        else if (listType === "ordered") {
          para.forEach(l => { parts.push("1. " + l.text.replace(/^\d+[\.\)]\s*/, "")); });
        } else if (listType === "unordered") {
          para.forEach(l => { parts.push("- " + l.text.replace(/^[•·●\-*]\s*/, "")); });
        } else {
          // 正文段落：多行合并、空行分隔
          const joined = para.map(l => l.text).join("  \n");
          if (joined.trim()) parts.push(joined);
        }
      }
      if (pi < pages.length - 1) parts.push("");
    });
    return parts.join("\n\n") + "\n";
  }

  // pages → CSV 文本（Excel 可直接打开）
  // 两种分列策略：
  //   heuristic：按行文本 + 分隔符启发式（| / 制表符 / 2+ 空格）；退化/纯段落用
  //   columns / auto：基于逐项 x 坐标的列边界聚类（检测行间大 gap → 跨表行共享分隔符 → 对齐列）
  function splitCells(line) {
    if (line.indexOf("|") >= 0) return line.split("|").map(s => s.trim());
    if (line.indexOf("\t") >= 0) return line.split("\t").map(s => s.trim());
    if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length);
    return [line.trim()];
  }
  function csvCell(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // 估算归一化文本宽度（仅用于列边界判定，无需精确）
  function estimateWidth(text, h) {
    if (!text) return 0;
    let w = 0;
    for (const ch of String(text)) w += /[　-鿿＀-￯]/.test(ch) ? h : h * 0.55;
    return w;
  }

  // 把一页 span 聚类成行，保留逐项（不合并文本），供坐标分列使用
  function lineItems(spans) {
    if (!Array.isArray(spans)) return [];
    const items = spans
      .filter(s => s && typeof s.text === "string" && s.text.trim().length)
      .map(s => ({
        text: s.text,
        x: typeof s.x === "number" && isFinite(s.x) ? s.x : 0,
        y: typeof s.y === "number" && isFinite(s.y) ? s.y : 0,
        h: (typeof s.h === "number" && s.h > 0) ? s.h : 0.015
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    let cur = null, baseY = null;
    for (const it of items) {
      const tol = Math.max(0.45 * it.h, 0.01);
      if (cur === null || Math.abs(it.y - baseY) > tol) { cur = { items: [], baseY: it.y }; lines.push(cur); baseY = it.y; }
      else { baseY = (baseY + it.y) / 2; cur.baseY = baseY; }
      cur.items.push(it);
    }
    return lines;
  }

  // 某行是否为「表格型」：≥2 项且行内最大 gap 超过阈值（区分段落与表格）
  function isTableLike(items, gapThresh) {
    if (!items || items.length < 2) return false;
    const sorted = items.slice().sort((a, b) => a.x - b.x);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prevR = sorted[i - 1].x + estimateWidth(sorted[i - 1].text, sorted[i - 1].h);
      const gap = sorted[i].x - prevR;
      if (gap > maxGap) maxGap = gap;
    }
    return maxGap > gapThresh;
  }

  // 取一行相邻项之间「超过阈值的空白」中心，作为潜在列边界
  function gapsOf(line, gapThresh) {
    const sorted = line.items.slice().sort((a, b) => a.x - b.x);
    const out = [];
    for (let i = 1; i < sorted.length; i++) {
      const l = sorted[i - 1].x + estimateWidth(sorted[i - 1].text, sorted[i - 1].h);
      const r = sorted[i].x;
      if (r - l > gapThresh) out.push((l + r) / 2);
    }
    return out;
  }
  // 从表格块检测列分隔符：以列数最多行为「基准行」定列边界；
  // 其余行仅在容差内贴近已有边界才合并，缺列行跨列的大 gap 不引入伪列。
  function detectSeparators(tableLines, gapThresh) {
    if (!tableLines || !tableLines.length) return [];
    let primary = tableLines[0];
    for (const l of tableLines) if (l.items.length > primary.items.length) primary = l;
    const seps = gapsOf(primary, gapThresh);
    const tol = Math.max(0.035, gapThresh); // 其他行边界合并容差
    for (const l of tableLines) {
      if (l === primary) continue;
      for (const g of gapsOf(l, gapThresh)) {
        for (let i = 0; i < seps.length; i++) {
          if (Math.abs(seps[i] - g) <= tol) { seps[i] = (seps[i] + g) / 2; break; }
        }
        // 不贴近任何已有 sep → 视为缺列行的跨列 gap，跳过，不新增伪列
      }
    }
    return seps.slice().sort((a, b) => a - b);
  }

  // 把一行项按分隔符分配到对齐的列（含空列补空串）
  function lineToCells(items, seps) {
    const cols = new Array(seps.length + 1).fill(null).map(() => []);
    const sorted = items.slice().sort((a, b) => a.x - b.x);
    for (const it of sorted) {
      const cx = it.x + estimateWidth(it.text, it.h) / 2;
      let ci = 0;
      for (let i = 0; i < seps.length; i++) { if (cx > seps[i]) ci = i + 1; else break; }
      cols[ci].push(it);
    }
    return cols.map(arr => arr.map(it => it.text).join(""));
  }

  // 把一页内的表格型行按垂直间距聚成若干「表格块」：块间大间距（>阈值）即断块。
  // 混排页（文字段 + 表格 + 文字段 + 另一表格）各表独立分列，不串列。
  function clusterTableBlocks(tableLines, gapThresh) {
    if (!tableLines || !tableLines.length) return [];
    const sorted = tableLines.slice().sort((a, b) => a.baseY - b.baseY);
    const blocks = [];
    let cur = [sorted[0]];
    const breakGap = Math.max(0.05, gapThresh * 4); // 行距超过此值视为新表
    for (let i = 1; i < sorted.length; i++) {
      const prevY = cur[cur.length - 1].baseY;
      if (sorted[i].baseY - prevY > breakGap) { blocks.push(cur); cur = [sorted[i]]; }
      else cur.push(sorted[i]);
    }
    blocks.push(cur);
    return blocks;
  }

  function pdfToExcel(pages, opts) {
    opts = opts || {};
    const mode = opts.mode || "auto";
    if (!Array.isArray(pages) || !pages.length) return "";
    const rows = [];
    pages.forEach((spans, pi) => {
      const lines = lineItems(spans || []);
      if (opts.pageMarkers && pi > 0) rows.push(["# 第 " + (pi + 1) + " 页"]);
      const medH = medianH([spans || []]);
      const gapThresh = Math.max(0.02, medH * 1.2);
      const tableLines = lines.filter(l => isTableLike(l.items, gapThresh));

      if (mode === "heuristic" || (mode === "auto" && tableLines.length === 0)) {
        // 退化/纯段落：沿用启发式分隔符
        lines.forEach(l => { const t = l.items.map(it => it.text).join(" "); if (t.trim() !== "") rows.push(splitCells(t)); });
        return;
      }
      if (mode === "columns") {
        // 整页共享分隔符（兼容旧行为 / 单表页）
        const seps = detectSeparators(tableLines, gapThresh);
        lines.forEach(l => {
          const t = l.items.map(it => it.text).join(" ");
          if (l.items.length === 0 || t.trim() === "") return;
          if (!isTableLike(l.items, gapThresh)) { rows.push([t]); return; }
          rows.push(lineToCells(l.items, seps));
        });
        return;
      }
      // auto（混排/多表页）：相邻表格型行聚成「表格块」，每块独立分列，不串列
      const blocks = clusterTableBlocks(tableLines, gapThresh);
      // 单行 block（如 prose 误入）无跨行对齐依据 → 不分列，整行单格
      const blockSeps = blocks.map(blk => blk.length >= 2 ? detectSeparators(blk, gapThresh) : []);
      const lineToBlock = new Map();
      blocks.forEach((blk, bi) => blk.forEach(l => lineToBlock.set(l, bi)));
      lines.forEach(l => {
        const t = l.items.map(it => it.text).join(" ");
        if (l.items.length === 0 || t.trim() === "") return;
        if (!isTableLike(l.items, gapThresh)) { rows.push([t]); return; }
        const bi = lineToBlock.has(l) ? lineToBlock.get(l) : 0;
        rows.push(lineToCells(l.items, blockSeps[bi] || []));
      });
    });
    return rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  }

  const api = { clusterLines, pdfToDocxHtml, pdfToDocx, pdfToText, pdfToMarkdown, pdfToExcel,
    detectListType,
    _esc: esc, _medianH: medianH, _splitCells: splitCells, _csvCell: csvCell,
    _estimateWidth: estimateWidth, _lineItems: lineItems, _isTableLike: isTableLike,
    _detectSeparators: detectSeparators, _lineToCells: lineToCells, _clusterTableBlocks: clusterTableBlocks };
  OS.PdfConvert = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);
