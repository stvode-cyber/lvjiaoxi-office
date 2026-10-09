/* ============================================================
   绿角犀 Office · PDF 文本提取（轻量骨架：DOCX / 纯文本 / Markdown）
   - 输入：textIndex.pages —— 每页归一化 span 数组
           {text,x,y,w,h}，x 由页左向右(0..1)，y 由页顶向下(0..1)，h 为归一化字号
           （与 app/js/modules/pdf.js 文本层、app/js/modules/pdf-text.js 完全一致）
   - 纯逻辑：按 y 聚类成行 → 行内按 x 排序 → 大字号行判为标题
   - 生成 Writer 可编辑 HTML → OS.Exporter.buildDocx 成 DOCX
   - 已知边界：文本 + 图片 + 双栏/三栏版面 + 表格识别；字体/字号/粗斜体/颜色还原（段内分组
             inline span）；旋转图片按轴对齐近似取框；Form XObject 嵌套图片支持（透明度组 form 不递归）。
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

  // 行内样式 → CSS inline style 字符串（font-family/font-size/color）
  // font-size: PDF 磅值转 px（pt × 96/72），与 buildDocx mergeProps 的 px 解析对齐
  function inlineStyle(g) {
    const parts = [];
    if (g && g.fontReal) parts.push("font-family:'" + String(g.fontReal).replace(/'/g, "") + "'");
    if (g && g.fontSize) parts.push("font-size:" + Math.round(g.fontSize * 96 / 72) + "px");
    if (g && g.color) parts.push("color:" + g.color);
    return parts.join(";");
  }

  // 一行 spans → inline span HTML（按样式分组：连续同 font/bold/italic/color/size 合并）
  // bold/italic 用 <b>/<i> 标签包裹（buildDocx mergeProps 已识别）
  function renderLineInline(line) {
    if (!line) return "";
    if (Array.isArray(line.items) && line.items.length) {
      const groups = [];
      let cur = null;
      for (const s of line.items) {
        const key = [s.fontReal || "", s.bold ? "b" : "", s.italic ? "i" : "", s.color || "", s.fontSize || ""].join("|");
        if (!cur || cur.key !== key) {
          cur = { key, items: [], fontReal: s.fontReal, bold: s.bold, italic: s.italic, color: s.color, fontSize: s.fontSize };
          groups.push(cur);
        }
        cur.items.push(s.text);
      }
      return groups.map(g => {
        const text = esc(g.items.join(" "));
        let open = "", close = "";
        if (g.bold) { open += "<b>"; close = "</b>" + close; }
        if (g.italic) { open += "<i>"; close = "</i>" + close; }
        const st = inlineStyle(g);
        return st ? open + '<span style="' + st + '">' + text + "</span>" + close : open + text + close;
      }).join("");
    }
    return esc(line.text || "");
  }

  // 多行段落 → inline HTML（行间用 <br> 分隔）
  function renderParaInline(para) {
    if (!Array.isArray(para) || !para.length) return "";
    const out = [];
    for (let i = 0; i < para.length; i++) {
      out.push(renderLineInline(para[i]));
      if (i < para.length - 1) out.push("<br>");
    }
    return out.join("");
  }

  // 单行聚类：把一页的 span 按阅读顺序（y 升序、行内 x 升序）合并为行
  // 返回 [{text, x, y, h}]（行级：已合并文本、记录行首 x、行 y、行内最大字号 h）
  // 改进：同行基线抖动容差+软换行合并（同段落内换行保留为一个段落）
  function clusterLines(spans) {
    if (!Array.isArray(spans)) return [];
    const items = spans
      .filter(s => s && typeof s.text === "string" && s.text.trim().length)
      .map(s => {
        // 保留全部样式字段（fontReal/bold/italic/color/fontSize），下游 renderLineInline 用
        const o = {
          text: s.text,
          x: typeof s.x === "number" && isFinite(s.x) ? s.x : 0,
          y: typeof s.y === "number" && isFinite(s.y) ? s.y : 0,
          h: (typeof s.h === "number" && s.h > 0) ? s.h : 0.015
        };
        if (s.fontReal) o.fontReal = s.fontReal;
        if (s.bold) o.bold = true;
        if (s.italic) o.italic = true;
        if (s.color) o.color = s.color;
        if (s.fontSize) o.fontSize = s.fontSize;
        return o;
      })
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
      return { text: text, x: sorted[0].x, y: line.baseY, h: maxH, items: sorted };
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
  // 渲染一个表格块为 HTML <table>（复用 pdfToExcel 的列边界）
  function renderTableBlock(rows, seps) {
    if (!rows.length || !seps.length) return "";
    // rows 按 baseY 升序：表头（y 最小=视觉顶部，与批注渲染 top=y*bh 同坐标系）先渲染在最上面
    const sorted = rows.slice().sort((a, b) => a.baseY - b.baseY);
    const trs = sorted.map(row => {
      const cells = lineToCells(row.items, seps);
      const tds = cells.map(c => `<td>${esc(String(c == null ? "" : c))}</td>`).join("");
      return `<tr>${tds}</tr>`;
    });
    return `<table border="1" cellspacing="0" cellpadding="4"><tbody>${trs.join("")}</tbody></table>`;
  }

  function pdfToDocxHtml(pages) {
    if (!Array.isArray(pages) || !pages.length) return "";
    const med = medianH(pages);
    const h3Thresh = Math.max(0.020, med * 1.3);   // 稍大 → <h3>
    const h2Thresh = Math.max(0.024, med * 1.7);   // 显著大 → <h2>
    const h1Thresh = Math.max(0.032, med * 2.4);   // 很大 → <h1>
    const paraGap = Math.max(med * 0.8, 0.018); // 段落间距阈值（约 1.2 行高）
    const gapThresh = Math.max(0.02, med * 1.2); // 表格列边界阈值（和 pdfToExcel 一致）

    const blocks = [];
    pages.forEach((spans, pi) => {
      if (!spans || !spans.length) { if (pi < pages.length - 1) blocks.push(`<div class="page-break"></div>`); return; }

      // === 先分离图片 span 和文本 span ===
      // 图片 span 格式：{ image: "data:image/png;base64,...", x, y, w, h }
      // 文本 span 格式：{ text: "...", x, y, h }
      const textSpans = spans.filter(s => !s.image && s.text !== undefined);
      const imageSpans = spans.filter(s => s.image);

      // 两套行格式并行：
      //   rowLines (lineItems) → { items, baseY } 用于表格识别 + 多栏检测（需要 items 数组）
      //   proseLines (clusterLines) → { text, x, y, h } 用于段落合并 + 标题/列表/正文渲染
      const rowLines = lineItems(textSpans);
      const proseLines = clusterLines(textSpans);

      // === 流程：先多栏检测 → 再表格识别（避免循环依赖）===
      // 新方案：递归二分 K-means 对 items 级 x 坐标做多峰检测（最多三栏）
      // （旧方案依赖 rows gap histogram，真实 PDF 里 items>=3 的行太多导致 dominant ratio 不够；
      //   输入用 items 级 x 而非合并行 x —— 基线对齐的多栏排版合并行 x 全是左栏起点会退化成单峰）
      const colSeps = detectColumnSeps(rowLines.reduce((acc, l) => { for (const it of l.items) acc.push(it.x); return acc; }, []));
      const nCols = colSeps.length + 1;

      let proseRowLines = [];
      let tableCandidates = rowLines.filter(l => isTableLike(l.items, gapThresh));
      if (colSeps.length) {
        // 跨所有分隔点的行：每个分隔点两侧都有 item（三栏行 = 左中右都有字）
        // 用 every 而非 some：防「单栏正文 + 2 列表格」误判 —— 表格两列在右子集形成假双峰时，
        // 表格行只跨第二个 sep、不跨第一个，every 判定直接排除，表格不会被吞
        const crossSepAll = rowLines.filter(l => l.items.length >= 2 && colSeps.every(sep =>
          l.items.some(it => it.x < sep - 0.02) && l.items.some(it => it.x >= sep - 0.02)));
        // 剔除多列表格行（items 数 > 栏数是多列表格的特征，不是多栏 prose）
        // 多栏 prose 每行每栏 1 个 item（双栏 2 个、三栏 3 个）
        const crossSep = crossSepAll.filter(l => l.items.length <= nCols);
        // 安全回滚：剔除后剩下的多栏 prose 行不够多（<5）→ 可能是表格 → 回滚
        const afterRemove = tableCandidates.filter(l => !crossSep.some(c => Math.abs(c.baseY - l.baseY) < 0.005));
        if (crossSep.length < 5) {
          colSeps.length = 0;
        } else {
          proseRowLines = crossSep;
          tableCandidates = afterRemove;
        }
      }

      const tBlocks = clusterTableBlocks(tableCandidates, gapThresh).filter(blk => blk.length >= 2);
      const tBlockSeps = tBlocks.map(blk => detectSeparators(blk, gapThresh) || []);
      const tableRowSet = new Set();
      const tableSlots = [];
      tBlocks.forEach((blk, bi) => {
        blk.forEach(l => tableRowSet.add(l.baseY));
        const minY = Math.min(...blk.map(l => l.baseY));
        tableSlots.push({ minY, html: renderTableBlock(blk, tBlockSeps[bi] || []) });
      });

      // 段落合并（用 proseLines，过滤掉表格行）
      let proseOnly = proseLines.filter(l => !tableRowSet.has(l.y));

      // === 多栏 prose 重排（用上面 detectColumnSeps 已算出的 colSeps，支持双栏/三栏）===
      // 多栏段落直接预构建（每栏一整段），不走下方 y-gap 段落合并 ——
      // y-gap 合并会让栏切换处（y 回落）粘连、栏内行距大时被拆段导致 events 按 y 交错乱栏。
      let prebuiltParagraphs = null;
      if (colSeps.length && proseRowLines.length) {
        // 先保存未被多栏覆盖的 prose 行（标题、备注等单栏行）
        const multiColBaseY = new Set(proseRowLines.map(l => l.baseY));
        const preserved = proseOnly.filter(l => !multiColBaseY.has(l.y));
        // 按 colSeps 拆 proseRowLines → N 栏 items 组
        const colGroups = Array.from({ length: nCols }, () => []);
        for (const row of proseRowLines) {
          const buckets = Array.from({ length: nCols }, () => []);
          for (const it of row.items) {
            let ci = 0;
            for (const sep of colSeps) { if (it.x >= sep - 0.02) ci++; else break; }
            buckets[ci].push(it);
          }
          buckets.forEach((items, ci) => { if (items.length) colGroups[ci].push({ baseY: row.baseY, items }); });
        }
        // 栏内 baseY 升序（y 小=视觉顶部，自上而下阅读序；与批注 top=y*bh 同坐标系）
        colGroups.forEach(g => g.sort((a, b) => a.baseY - b.baseY));
        // 所有栏段共享同一事件 y（栏首行 y 最小值）→ events 稳定 sort 保持栏 1→栏 2→栏 3 顺序
        const nonEmpty = colGroups.filter(g => g.length);
        const colMinY = nonEmpty.length ? Math.min.apply(null, nonEmpty.map(g => g[0].baseY)) : 0;
        prebuiltParagraphs = [];
        for (const g of colGroups) {
          if (!g.length) continue;
          const lines = g.map(grp => {
            const sorted = grp.items.slice().sort((a, b) => a.x - b.x);
            return { text: sorted.map(s => s.text).join(" "), x: sorted[0].x, y: grp.baseY, h: Math.max.apply(null, sorted.map(s => s.h)), items: sorted };
          });
          lines._evY = colMinY;
          prebuiltParagraphs.push(lines);
        }
        // preserved（标题/页脚等单栏行）各自独立成段，按自身 y 参与 events 排序
        for (const l of preserved) prebuiltParagraphs.push([l]);
      }

      if (!proseOnly.length && !tableSlots.length && !imageSpans.length) {
        if (pi < pages.length - 1) blocks.push(`<div class="page-break"></div>`);
        return;
      }

      const paragraphs = prebuiltParagraphs || [];
      if (!prebuiltParagraphs) {
        let curPara = proseOnly.length ? [proseOnly[0]] : [];
        for (let i = 1; i < proseOnly.length; i++) {
          const gap = proseOnly[i].y - proseOnly[i - 1].y;
          if (gap > paraGap) { paragraphs.push(curPara); curPara = [proseOnly[i]]; }
          else { curPara.push(proseOnly[i]); }
        }
        if (curPara.length) paragraphs.push(curPara);
      }

      // 渲染事件按 y 排序穿插（多栏预构建段用共享 _evY 保持栏序，其余段用首行 y）
      const events = [];
      for (const slot of tableSlots) events.push({ y: slot.minY, kind: "table", html: slot.html });
      for (const para of paragraphs) events.push({ y: (para._evY !== undefined ? para._evY : para[0].y), kind: "para", para });
      // 图片事件：每张图按 y 坐标插入序列（图片不打乱列表/段落逻辑）
      for (const img of imageSpans) {
        // 归一化尺寸：PDF 页面宽度 ≈ 0.86 in DOCX（A4 有效区），高度 ≈ 11 in
        // 这里只输出 `<img src>`，宽高由 buildDocx.drawingRun 从 PNG/JPEG header 自动读
        const wAttr = img.w ? ` width="${Math.round(img.w * 600)}"` : "";
        const hAttr = img.h ? ` height="${Math.round(img.h * 800)}"` : "";
        events.push({ y: img.y, kind: "img", html: `<img src="${esc(img.image)}"${wAttr}${hAttr} />` });
      }
      events.sort((a, b) => a.y - b.y);

      let inList = false, listType = null;
      for (const ev of events) {
        if (ev.kind === "img") {
          // 图片前后加 <p> 保证段落边界，避免和列表/表格粘连
          if (inList) { blocks.push(`</${listType}>`); inList = false; listType = null; }
          blocks.push(`<p>${ev.html}</p>`);
          continue;
        }
        if (ev.kind === "table") {
          if (inList) { blocks.push(`</${listType}>`); inList = false; listType = null; }
          blocks.push(ev.html);
          continue;
        }
        const para = ev.para;
        const firstLine = para[0];
        // 标题判定（firstLine.h = maxH from clusterLines）
        const isH1 = firstLine.h >= h1Thresh;
        const isH2 = !isH1 && firstLine.h >= h2Thresh;
        const isH3 = !isH1 && !isH2 && firstLine.h >= h3Thresh;
        const isHeading = isH1 || isH2 || isH3;
        if (inList && !isHeading) { blocks.push(`</${listType}>`); inList = false; listType = null; }
        if (isHeading) {
          const tag = isH1 ? "h1" : (isH2 ? "h2" : "h3");
          blocks.push(`<${tag}>${renderLineInline(firstLine)}</${tag}>`);
          for (let li = 1; li < para.length; li++) blocks.push(`<p>${renderLineInline(para[li])}</p>`);
          continue;
        }
        const listMatch = detectListType(firstLine.text);
        if (listMatch && para.length >= 1) {
          const isOrdered = listMatch === "ordered";
          const lt = isOrdered ? "ol" : "ul";
          if (!inList || listType !== lt) { if (inList) blocks.push(`</${listType}>`); blocks.push(`<${lt}>`); inList = true; listType = lt; }
          const itemHtml = renderParaInline(para);
          // 去掉列表符号（标记字符由 detectListType 识别，这里只在 inline html 开头清理标记）
          const cleanHtml = itemHtml.replace(/^(<[^>]+>)?\s*(?:[•·●\-*]|\d+[\.\)]|[a-zA-Z][\.\)]|\(?\d+\))\s*/, "$1");
          blocks.push(`<li>${cleanHtml}</li>`);
          continue;
        }
        if (para.length === 1) { blocks.push(`<p>${renderLineInline(firstLine)}</p>`); }
        else { const joined = renderParaInline(para); if (joined.trim()) blocks.push(`<p>${joined}</p>`); }
      }
      if (inList) { blocks.push(`</${listType}>`); inList = false; listType = null; }
      if (pi < pages.length - 1) blocks.push(`<div class="page-break"></div>`);
    });
    return blocks.join("\n");
  }

  // 检测多栏 prose 行的栏分隔 x 坐标（gap 直方图众数，用 items 数组）
  // 返回 null（单栏）或一个 number（栏分隔 x）
  function detectColumnSep(xs) {
    if (!xs || xs.length < 10) return null;
    const n = xs.length;
    let c1 = Math.min(...xs), c2 = Math.max(...xs);
    for (let iter = 0; iter < 50; iter++) {
      const g1 = [], g2 = [];
      for (const x of xs) {
        if (Math.abs(x - c1) <= Math.abs(x - c2)) g1.push(x); else g2.push(x);
      }
      if (!g1.length || !g2.length) return null;
      const nc1 = g1.reduce((a, b) => a + b, 0) / g1.length;
      const nc2 = g2.reduce((a, b) => a + b, 0) / g2.length;
      if (Math.abs(nc1 - c1) < 0.001 && Math.abs(nc2 - c2) < 0.001) break;
      c1 = nc1; c2 = nc2;
    }
    const dist = Math.abs(c2 - c1);
    const g1n = xs.filter(x => Math.abs(x - c1) <= Math.abs(x - c2)).length;
    const g2n = n - g1n;
    // 两峰间距够大（≥0.15）且两群都至少占 15% → 判定双栏
    const minGroup = Math.min(g1n, g2n) / n;
    if (dist < 0.15 || minGroup < 0.15) return null;
    return (c1 + c2) / 2;
  }

  // 多栏分隔点检测（泛化版）：递归二分 K-means，最多三栏（2 个分隔点）
  // 返回 []（单栏）/ [sep]（双栏）/ [sep1,sep2]（三栏），升序
  // 输入建议用 items 级 x（rowLines flatMap），真实多栏排版栏内基线对齐时
  // 合并行 x 全等于左栏起点会退化成单峰；items 级 x 峰更稳。
  function detectColumnSeps(xs) {
    if (!xs || xs.length < 10) return [];
    const sep = detectColumnSep(xs);
    if (sep == null) return [];
    const seps = [sep];
    // 左右子集各再试分一次（depth=1，最多三栏；单栏子集因 dist<0.15 防抖被拒）
    const left = xs.filter(x => x < sep);
    const right = xs.filter(x => x >= sep);
    if (left.length >= 10) { const s2 = detectColumnSep(left); if (s2 != null) seps.push(s2); }
    if (right.length >= 10) { const s3 = detectColumnSep(right); if (s3 != null) seps.push(s3); }
    return seps.sort((a, b) => a - b);
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

  /* ============================================================
     图片提取纯函数工具（pdf.js operator list → 图片 span）
     供 app/js/modules/pdf.js extractAllPagesSpans 调用；
     无 DOM/Canvas 依赖，node 直跑单测。
     ============================================================ */

  // PDF 仿射矩阵相乘 m1×m2（[a,b,c,d,e,f] 表示 |a c e; b d f|）
  function multiplyM(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  // CTM → 归一化图片矩形（与文本 span 同坐标系：x=e/vpW, y=f/vpH）
  // 图片画在单位正方形 [0,1]² 上：宽=|(a,b)|，高=|(c,d)|（取绝对值容忍翻转）
  // 注意：返回的 y 是 PDF 用户空间（y-up）底角值，y-down 翻转在 walkImageRects 里做
  function imageRect(ctm, vpW, vpH) {
    if (!ctm || ctm.length < 6 || !vpW || !vpH) return null;
    const w = Math.hypot(ctm[0], ctm[1]) / vpW;
    const h = Math.hypot(ctm[2], ctm[3]) / vpH;
    const x = ctm[4] / vpW;
    const y = ctm[5] / vpH;
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return null;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  // pdf.js 图像对象 {data,width,height,kind} → RGBA 字节流
  // kind: 1=GRAYSCALE_1BPP（位打包） 2=RGB_24BPP 3=RGBA_32BPP；缺 kind 按数据长度推断
  function expandRGBA(img) {
    if (!img || !img.width || !img.height || !img.data || !img.data.length) return null;
    const W = img.width, H = img.height, n = W * H;
    const src = img.data;
    let kind = img.kind;
    if (!kind) {
      if (src.length >= n * 4) kind = 3;
      else if (src.length >= n * 3) kind = 2;
      else kind = 1;
    }
    const out = new Uint8ClampedArray(n * 4);
    if (kind === 3) {
      out.set(src.length === n * 4 ? src : src.subarray(0, n * 4));
    } else if (kind === 2) {
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        out[i * 4] = src[j]; out[i * 4 + 1] = src[j + 1]; out[i * 4 + 2] = src[j + 2]; out[i * 4 + 3] = 255;
      }
    } else if (kind === 1) {
      const stride = Math.ceil(W / 8);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const byte = src[y * stride + (x >> 3)] || 0;
          const v = (byte & (0x80 >> (x & 7))) ? 255 : 0;
          const o = (y * W + x) * 4;
          out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
        }
      }
    } else {
      return null;
    }
    return out;
  }

  // pdf.js textContent items → 归一化文本 spans（与 pdf.js extractAllPagesSpans 同一套）
  // 坐标系：pdf.js transform 是用户空间 y-up（底 0 顶 vpH），这里翻转为 y-down（顶 0 底 1），
  // 与下游所有升序排序（clusterLines/colGroups/renderTableBlock/events）的「顶→底」约定一致。
  // 样式还原：fontMap（fontName → {name,bold,italic}）从 commonObjs 取；colorRuns 是按
  // showText 顺序记录的「当前填充色」数组（来自 _colorRunsFromOps）。
  // 配对：过滤空 str 后的 items 与 colorRuns 1:1 顺序对齐——数量不等就全 null 不强配。
  function textSpansFromTC(items, vpW, vpH, fontMap, colorRuns) {
    const spans = [];
    if (!Array.isArray(items) || !vpW || !vpH) return spans;
    // 预过滤：pdf.js 会给空 str item（仅设 text matrix，hasEOL=true），与 showText 不是 1:1
    const realItems = items.filter(it => it && it.str && it.str.trim());
    const useColors = Array.isArray(colorRuns) && colorRuns.length === realItems.length;
    let ci = 0;
    for (const it of realItems) {
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const fontH = Math.abs(t[3]) || 10;
      const fi = (fontMap && it.fontName && fontMap[it.fontName]) || {};
      spans.push({
        text: it.str,
        x: (t[4] || 0) / vpW,
        y: 1 - (t[5] || 0) / vpH,
        w: (it.width || fontH) / vpW,
        h: fontH / vpH,
        fontSize: fontH,           // 原始 PDF 字号（磅，pt）
        fontReal: fi.name || null, // 真实字体名（如 "Helvetica-Bold"），无则 null
        bold: !!fi.bold,
        italic: !!fi.italic,
        color: useColors ? colorRuns[ci].color : null  // #rrggbb 或 null
      });
      ci++;
    }
    return spans;
  }

  // 遍历 pdf.js operator list 提取「每个 showText/showSpacedText 调用时的当前填充色」。
  // 时序：setFillRGBColor → setFont → moveText/transform → showText。
  // 文字颜色属于图形状态，会持续到下一个 setFill 才变；pdf.js 把 setFillRGBColor 的 0..1
  // 输入 normalize 成 0..255 存（dump 实锤），这里转 hex。
  // 支持 RGB/Gray/CMYK；其它颜色空间（Pattern/DeviceN）color=null 降级。
  function colorRunsFromOps(fnArray, argsArray, OPS) {
    const runs = [];
    if (!Array.isArray(fnArray) || !OPS) return runs;
    let color = null;
    const toHex = (r, g, b) => "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i], args = argsArray[i];
      // pdf.js 颜色 args 可能是 Array 也可能是 typed array / arguments，统一用下标读
      if (fn === OPS.setFillRGBColor && args && args.length >= 3) {
        color = toHex(args[0], args[1], args[2]);
      } else if (fn === OPS.setFillGray && args && args.length >= 1) {
        const g = args[0]; color = toHex(g, g, g);
      } else if (fn === OPS.setFillCMYKColor && args && args.length >= 4) {
        // CMYK → RGB（PDF 标准公式：R = 255×(1-C)×(1-K) 等）
        const c = args[0], m = args[1], y = args[2], k = args[3];
        color = toHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
      } else if (fn === OPS.setFillColor || fn === OPS.setFillColorN) {
        // 非主流颜色空间无法稳定提色，降级（不输出颜色）
        color = null;
      } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        runs.push({ color: color });
      }
    }
    return runs;
  }

  // 遍历 pdf.js operator list，算出每张图片的归一化矩形（y-down，与 textSpansFromTC 一致）。
  // 覆盖 Form XObject 嵌套：pdf.js 把 form 子内容内联展开在 paintFormXObjectBegin/End 之间，
  // Begin 携带 form Matrix（args[0]）需右乘进 CTM（multiplyM(ctm, fm)，与 OPS.transform 同序）；
  // Begin/End 自身入栈/出栈一对，嵌套表单靠栈配平。
  // 返回 [{ id(objId)|inline(图像对象), x, y, w, h }]，id/inline 二选一供调用方取像素。
  function walkImageRects(fnArray, argsArray, OPS, vpW, vpH) {
    const out = [];
    if (!fnArray || !argsArray || !OPS || !vpW || !vpH) return out;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i], args = argsArray[i];
      if (fn === OPS.save) { stack.push(ctm.slice()); continue; }
      if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); continue; }
      // PDF/Canvas 矩阵是右乘（postmultiply）：CTM_new = CTM × m。
      // 之前左乘（m × CTM）只在「单条 cm」场景碰巧正确（I 可交换），
      // pdf-lib drawImage 这类 平移→旋转→缩放 多步 cm 链会算飞（2026-10-09 坑）。
      if (fn === OPS.transform) { ctm = multiplyM(ctm, args); continue; }
      if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm.slice());
        const fm = args && args[0];
        if (Array.isArray(fm) && fm.length >= 6) ctm = multiplyM(ctm, fm);
        continue;
      }
      if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); continue; }
      const isXObj = fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject;
      const isInline = fn === OPS.paintInlineImageXObject;
      if (!isXObj && !isInline) continue;
      const w = Math.hypot(ctm[0], ctm[1]) / vpW;
      const h = Math.hypot(ctm[2], ctm[3]) / vpH;
      // 镜像（负 a）时左边界 = e + a
      const x = (ctm[4] + Math.min(0, ctm[0])) / vpW;
      // CTM y 是 y-up 底角：顶边 y-up = e + max(0,d)，翻转为 y-down 顶边
      const y = 1 - (ctm[5] + Math.max(0, ctm[3])) / vpH;
      if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) continue;
      out.push({ id: isXObj ? args[0] : null, inline: isInline ? args[0] : null, x, y, w, h });
    }
    return out;
  }

  // 归一化尺寸 → 目标像素（600×800 页网格约定，和 pdfToDocxHtml 的 wAttr/hAttr 一致）
  // 上限 1600px 防爆 DOCX 体积；小于 8px 的图标/项目符号返回 null（调用方跳过）
  function targetPx(wNorm, hNorm) {
    const tw = Math.round(wNorm * 600);
    const th = Math.round(hNorm * 800);
    if (!isFinite(tw) || !isFinite(th) || tw < 8 || th < 8) return null;
    return { tw: Math.min(tw, 1600), th: Math.min(th, 1600) };
  }

  const _imgUtils = { multiplyM, imageRect, expandRGBA, targetPx };

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
  // 从表格块检测列分隔符（直方图法 v2）：
  // 收集所有表格行的 gaps，建直方图找「众数 bin」作为真实列边界；
  // primary 行的伪 gap（只在 1 行出现）自然被淘汰。
  // 对比旧版 primary 行优先法：表头被拆成多段时不会引入伪列。
  // 单行表（tableLines.length===1）回退旧逻辑；
  // minSupport 过滤后若结果为空也回退（如 2 行表其中 1 行缺列）。
  function detectSeparators(tableLines, gapThresh) {
    if (!tableLines || !tableLines.length) return [];
    // 单行表回退：只有 1 行，用该行自身 gaps 即可
    if (tableLines.length === 1) return gapsOf(tableLines[0], gapThresh).sort((a, b) => a - b);
    const tol = Math.max(0.035, gapThresh); // bin 宽 = 合并容差
    const allGaps = []; // [ { x, lineIdx } ]
    tableLines.forEach((l, li) => {
      for (const g of gapsOf(l, gapThresh)) allGaps.push({ x: g, li });
    });
    if (!allGaps.length) return [];
    // 建直方图
    const minX = Math.min(...allGaps.map(g => g.x));
    const maxX = Math.max(...allGaps.map(g => g.x));
    const nBins = Math.max(1, Math.ceil((maxX - minX) / tol) + 1);
    const bins = new Array(nBins).fill(null).map(() => ({ sum: 0, n: 0, lines: new Set() }));
    for (const g of allGaps) {
      const bi = Math.round((g.x - minX) / tol);
      if (bi >= 0 && bi < nBins) { bins[bi].sum += g.x; bins[bi].n++; bins[bi].lines.add(g.li); }
    }
    // 找峰值 bin（出现次数 ≥ 总行数 50% 的才是真实列边界）
    const minSupport = Math.max(2, Math.ceil(tableLines.length * 0.5));
    const peaks = [];
    for (let i = 0; i < nBins; i++) {
      if (bins[i].n >= minSupport) {
        // 高斯加权合并相邻 bin
        let w = bins[i].sum; let n = bins[i].n;
        if (i + 1 < nBins && bins[i + 1].n >= minSupport) { w += bins[i + 1].sum; n += bins[i + 1].n; i++; }
        peaks.push(w / n);
      }
    }
    // 直方图法空结果回退：minSupport 太严（如 2 行表其中 1 行缺列）
    if (peaks.length === 0) {
      let primary = tableLines[0];
      for (const l of tableLines) if (l.items.length > primary.items.length) primary = l;
      return gapsOf(primary, gapThresh).sort((a, b) => a - b);
    }
    return peaks.sort((a, b) => a - b);
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

  function _buildExcelRows(pages, opts) {
    opts = opts || {};
    const mode = opts.mode || "auto";
    if (!Array.isArray(pages) || !pages.length) return [];
    const rows = [];
    pages.forEach((spans, pi) => {
      const lines = lineItems(spans || []);
      if (opts.pageMarkers && pi > 0) rows.push(["# 第 " + (pi + 1) + " 页"]);
      const medH = medianH([spans || []]);
      const gapThresh = Math.max(0.02, medH * 1.2);
      const tableLines = lines.filter(l => isTableLike(l.items, gapThresh));

      if (mode === "heuristic" || (mode === "auto" && tableLines.length === 0)) {
        lines.forEach(l => { const t = l.items.map(it => it.text).join(" "); if (t.trim() !== "") rows.push(splitCells(t)); });
        return;
      }
      if (mode === "columns") {
        const seps = detectSeparators(tableLines, gapThresh);
        lines.forEach(l => {
          const t = l.items.map(it => it.text).join(" ");
          if (l.items.length === 0 || t.trim() === "") return;
          if (!isTableLike(l.items, gapThresh)) { rows.push([t]); return; }
          rows.push(lineToCells(l.items, seps));
        });
        return;
      }
      const blocks = clusterTableBlocks(tableLines, gapThresh);
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
    return rows;
  }

  function pdfToExcelRows(pages, opts) { return _buildExcelRows(pages, opts); }

  function pdfToExcel(pages, opts) {
    const rows = _buildExcelRows(pages, opts);
    if (!rows.length) return "";
    return rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  }

  // rows 数组 → buildXlsx 兼容的 cells 对象（{A1:{v:""}, B1:{v:""}}）
  function _colName(n) { let s = ""; n = n - 1; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; }
  function rowsToCells(rows) {
    const cells = {};
    rows.forEach((row, ri) => {
      if (!row || !row.length) { cells["A" + (ri + 1)] = { v: "" }; return; }
      row.forEach((val, ci) => {
        let v = val == null ? "" : String(val);
        cells[_colName(ci + 1) + (ri + 1)] = { v };
      });
    });
    return cells;
  }

  const api = { clusterLines, pdfToDocxHtml, pdfToDocx, pdfToText, pdfToMarkdown, pdfToExcel, pdfToExcelRows, rowsToCells,
    detectListType,
    _esc: esc, _medianH: medianH, _splitCells: splitCells, _csvCell: csvCell,
    _estimateWidth: estimateWidth, _lineItems: lineItems, _isTableLike: isTableLike,
    _detectSeparators: detectSeparators, _lineToCells: lineToCells, _clusterTableBlocks: clusterTableBlocks,
    _detectColumnSeps: detectColumnSeps,
    _textSpansFromTC: textSpansFromTC, _colorRunsFromOps: colorRunsFromOps, _walkImageRects: walkImageRects,
    _imgUtils };
  OS.PdfConvert = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})(typeof window !== "undefined" ? window : globalThis);
