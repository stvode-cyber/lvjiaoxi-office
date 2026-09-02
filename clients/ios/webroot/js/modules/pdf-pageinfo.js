/*
 * 绿角犀 Office · PDF 页面属性 / 页面树信息提取（OS.PdfPageInfo）
 * 纯逻辑零依赖模块：从 PDF 原始字节解析页面树（/Pages → /Kids 递归），
 * 提取每页几何与资源属性，并派生文档级摘要（纸张分布 / 一致性 / 主流纸张 / 方向 / 旋转）。
 *
 * 用途：文档版面审计 / 页面尺寸核对 / 打印前检查 / 异常页（超大·极小·旋转）定位 / 报告导出。
 * 纯解析、不修改文档；不依赖 pdf.js DOM，可在 node 单测。
 *
 * 关键约束：txt（bytesToString 生成的 latin1 串）与 bytes 是 1:1 索引映射，
 * 任意字典的「文本起始」与「字节切片起始」必须对齐才能正确切片字面串字节（本模块不切字面串，故无此约束，
 * 但仍统一以 txt 做文本解析、以 bytes 仅作兜底）。
 *
 * 暴露：
 *   parsePageTree(bytes)       主函数 → 完整结果（pages + 摘要）
 *   summarize(res)             派生摘要（与 res 内 summary 一致，便于测试）
 *   toMarkdown(res, opts)       页面属性 Markdown 报告
 *   toHtml(res)                HTML 片段（每页带 data-page 跳页）
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
      else if (txt[i] === ">" && txt[i + 1] === ">") { depth--; i++; if (depth === 0) return txt.slice(startIdx, i + 1); }
    }
    return null;
  }

  /** 定位对象号 num 的字典，返回 { str, start }（start 为字典在全局 txt 中的字节起始）。 */
  function getObjDict(txt, num) {
    const m = new RegExp("(?<!\\d)" + num + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const lt = txt.indexOf("<<", m.index);
    if (lt < 0) return null;
    const str = sliceDict(txt, lt);
    if (!str) return null;
    return { str, start: lt };
  }

  /** 取对象 num 的原始内容（介于 "N 0 obj" 与 "endobj" 之间），用于数组对象 / 间接引用解析。 */
  function getObjectContent(txt, num) {
    const m = new RegExp("(?<!\\d)" + num + "\\s+0\\s+obj").exec(txt);
    if (!m) return null;
    const start = m.index + m[0].length;
    const end = txt.indexOf("endobj", start);
    return end >= 0 ? txt.slice(start, end) : txt.slice(start);
  }

  /** 解析数字数组 "[a b c d]" → [Number,...]，忽略非数字。 */
  function parseNumArr(s) {
    if (!s) return null;
    const nums = [];
    const re = /-?\d+(\.\d+)?/g; let m;
    while ((m = re.exec(s))) nums.push(parseFloat(m[0]));
    return nums.length ? nums : null;
  }

  /** 解析方框（MediaBox/CropBox 等）：内联数组或间接引用对象（数组对象或含数组字典）。 */
  function resolveBox(txt, d, key) {
    const arrM = new RegExp(key + "\\s*\\[([\\s\\S]*?)\\]").exec(d);
    if (arrM) return parseNumArr(arrM[1]);
    const refM = new RegExp(key + "\\s+(\\d+)\\s+0\\s+R").exec(d);
    if (refM) {
      const content = getObjectContent(txt, +refM[1]);
      if (content) {
        const a = /\s*\[([\s\S]*?)\]/.exec(content);
        if (a) return parseNumArr(a[1]);
        const d2 = /<<([\s\S]*?)>>/.exec(content);
        if (d2) {
          const a2 = /\s*\[([\s\S]*?)\]/.exec(d2[1]);
          if (a2) return parseNumArr(a2[1]);
        }
      }
    }
    return null;
  }

  /** 解析旋转角，归一化到 [0,360)。 */
  function parseRotate(d) {
    const m = /\/Rotate\s+(-?\d+)/.exec(d);
    if (!m) return 0;
    return ((+m[1]) % 360 + 360) % 360;
  }

  /** 统计子字典（/Font /XObject）顶层键数量。 */
  function countTopLevelKeys(inner) {
    let depth = 0, count = 0, i = 0;
    const n = inner.length;
    while (i < n) {
      const c = inner[i];
      if (c === "<" && inner[i + 1] === "<") {
        if (depth === 0) {
          let j = i - 1;
          while (j >= 0 && /\s/.test(inner[j])) j--;
          if (j >= 0 && inner[j] === "/") count++;
          depth++; i += 2; continue;
        }
        depth++; i += 2; continue;
      } else if (c === ">" && inner[i + 1] === ">") {
        depth--; i += 2; continue;
      } else if (c === "/" && depth === 0) {
        let j = i + 1;
        while (j < n && inner[j] !== "<" && !/[A-Za-z0-9._:#=-]/.test(inner[j])) j++;
        if (inner[j] === "<") { i = j; continue; } // 字典键，交给 << 处理
        count++;
        i++; // 跳过 "/" 自身
        while (i < n && /[A-Za-z0-9._:#=-]/.test(inner[i])) i++;
        continue;
      } else { i++; }
    }
    return count;
  }

  /** 解析 /Resources → 字体/图像/XObject 计数（用平衡切分避免嵌套子字典被 >> 截断）。 */
  function parseResources(txt, d) {
    let resDict = null;
    const refM = /\/Resources\s+(\d+)\s+0\s+R/.exec(d);
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) resDict = o.str; }
    else {
      const inM = /\/Resources\s*<</.exec(d);
      if (inM) {
        const lt = inM.index + inM[0].indexOf("<<");
        resDict = sliceDict(d, lt);
      }
    }
    if (!resDict) return { has: false, fonts: 0, xobjects: 0, images: 0 };
    const fontsM = /\/Font\s*<<([\s\S]*?)>>/.exec(resDict);
    const fonts = fontsM ? countTopLevelKeys(fontsM[1]) : 0;
    const xoM = /\/XObject\s*<<([\s\S]*?)>>/.exec(resDict);
    const xobjects = xoM ? countTopLevelKeys(xoM[1]) : 0;
    let images = 0;
    if (xoM) {
      const xoInner = xoM[1];
      // 内联字典中直接写 /Subtype /Image
      const inRe = /\/Subtype\s*\/Image\b/g; let im;
      while ((im = inRe.exec(xoInner))) images++;
      // 间接引用：解析被引用对象，若其 /Subtype /Image 则计为图像
      const refRe = /(\d+)\s+(\d+)\s+R/g; let rm;
      while ((rm = refRe.exec(xoInner))) {
        const o = getObjDict(txt, +rm[1]);
        if (o && /\/Subtype\s*\/Image\b/.test(o.str)) images++;
      }
    }
    return { has: true, fonts, xobjects, images };
  }

  /** 标准纸张尺寸（pt，ISO A/B + 北美）。检测时按较大×较小维度匹配，容差 2pt。 */
  const PAPER_SIZES = [
    { name: "A0", w: 2384, h: 3370 },
    { name: "A1", w: 1684, h: 2384 },
    { name: "A2", w: 1191, h: 1684 },
    { name: "A3", w: 842, h: 1191 },
    { name: "A4", w: 595, h: 842 },
    { name: "A5", w: 420, h: 595 },
    { name: "A6", w: 298, h: 420 },
    { name: "B4", w: 729, h: 1032 },
    { name: "B5", w: 516, h: 729 },
    { name: "Letter", w: 612, h: 792 },
    { name: "Legal", w: 612, h: 1008 },
    { name: "Tabloid", w: 792, h: 1224 }
  ];

  function detectPaper(w, h) {
    if (!w || !h || isNaN(w) || isNaN(h)) return "未知";
    const W = Math.max(w, h), H = Math.min(w, h);
    for (const p of PAPER_SIZES) {
      const pw = Math.max(p.w, p.h), ph = Math.min(p.w, p.h);
      if (Math.abs(W - pw) <= 2 && Math.abs(H - ph) <= 2) return p.name;
    }
    return "自定义";
  }

  const PT_TO_MM = 25.4 / 72;

  /** 有效方向：旋转 90/270 会翻转盒方向。 */
  function effectiveOrientation(widthPt, heightPt, rotate) {
    const rawLandscape = widthPt >= heightPt;
    const flipped = (rotate === 90 || rotate === 270);
    const land = flipped ? !rawLandscape : rawLandscape;
    return land ? "landscape" : "portrait";
  }

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
    if (refM) { const o = getObjDict(txt, +refM[1]); if (o) return o.str; }
    const inM = /\/Pages\s*<<[\s\S]*?\/Kids\s*\[/.exec(rootDict);
    if (inM) {
      const lt = inM.index + inM[0].indexOf("<<");
      return sliceDict(txt, lt);
    }
    return null;
  }

  function buildPage(txt, d, obj, parentObj, depth, order, counter) {
    const mediaBox = resolveBox(txt, d, "/MediaBox");
    const cropBox = resolveBox(txt, d, "/CropBox") || (mediaBox ? mediaBox.slice() : null);
    const rotate = parseRotate(d);
    const res = parseResources(txt, d);
    const widthPt = mediaBox ? +(mediaBox[2] - mediaBox[0]).toFixed(2) : null;
    const heightPt = mediaBox ? +(mediaBox[3] - mediaBox[1]).toFixed(2) : null;
    const paperSize = detectPaper(widthPt, heightPt);
    return {
      num: counter.n++,
      obj,
      parentObj,
      depth,
      order,
      mediaBox: mediaBox ? mediaBox.slice() : null,
      widthPt,
      heightPt,
      widthMm: widthPt != null ? +(widthPt * PT_TO_MM).toFixed(1) : null,
      heightMm: heightPt != null ? +(heightPt * PT_TO_MM).toFixed(1) : null,
      cropBox: cropBox ? cropBox.slice() : null,
      cropW: cropBox ? +(cropBox[2] - cropBox[0]).toFixed(2) : null,
      cropH: cropBox ? +(cropBox[3] - cropBox[1]).toFixed(2) : null,
      rotate,
      paperSize,
      orientation: widthPt != null && heightPt != null ? effectiveOrientation(widthPt, heightPt, rotate) : null,
      resources: res
    };
  }

  function collectLeaves(txt, nodeDict, parentObj, depth, out, counter) {
    const kidsM = /Kids\s*\[([\s\S]*?)\]/.exec(nodeDict);
    if (!kidsM) return;
    const refRe = /(\d+)\s+(\d+)\s+R/g; let rm;
    while ((rm = refRe.exec(kidsM[1]))) {
      const num = +rm[1];
      const o = getObjDict(txt, num);
      if (!o) continue;
      const d = o.str;
      if (/\/Type\s*\/Pages\b/.test(d)) {
        collectLeaves(txt, d, num, depth + 1, out, counter);
      } else if (/\/Type\s*\/Page\b/.test(d)) {
        out.push(buildPage(txt, d, num, parentObj, depth, counter.n, counter));
      }
    }
  }

  /** 主函数：解析页面树，返回完整结果（含文档级摘要）。 */
  function parsePageTree(bytes) {
    const txt = bytesToString(bytes);
    const rootDict = findRootDict(txt);
    const pagesNode = findPagesNode(txt, rootDict);
    const res = {
      hasPageTree: false,
      totalPages: 0,
      pages: [],
      summary: {
        totalPages: 0,
        distribution: {},
        orientations: { portrait: 0, landscape: 0 },
        rotations: { "0": 0, "90": 0, "180": 0, "270": 0 },
        consistentSize: true,
        dominantSize: null
      }
    };
    if (!pagesNode) {
      res.summary.distribution = {};
      return res;
    }
    const counter = { n: 1 };
    const leaves = [];
    collectLeaves(txt, pagesNode, null, 0, leaves, counter);
    // 按 order（遍历序号）升序排列为页码顺序
    leaves.sort((a, b) => a.order - b.order);
    res.hasPageTree = true;
    res.pages = leaves;
    res.totalPages = leaves.length;

    // —— 派生摘要 ——
    const distribution = {};
    const orientations = { portrait: 0, landscape: 0 };
    const rotations = { "0": 0, "90": 0, "180": 0, "270": 0 };
    const sizeSet = new Set();
    for (const p of leaves) {
      let key = p.paperSize;
      if (p.paperSize === "自定义" && p.widthPt != null && p.heightPt != null) {
        key = "自定义 " + Math.round(p.widthPt) + "×" + Math.round(p.heightPt) + "pt";
      }
      if (!distribution[key]) distribution[key] = [];
      distribution[key].push(p.num);
      if (p.orientation === "portrait") orientations.portrait++;
      else if (p.orientation === "landscape") orientations.landscape++;
      const rk = String(p.rotate || 0);
      if (rotations[rk] == null) rotations[rk] = 0;
      rotations[rk]++;
      if (p.widthPt != null && p.heightPt != null) {
        sizeSet.add(Math.round(p.widthPt) + "x" + Math.round(p.heightPt));
      }
    }
    // 重新编号页码（1-based，按遍历顺序）
    leaves.forEach((p, i) => { p.num = i + 1; });
    // distribution 的页码索引也要同步更新
    const distribution2 = {};
    for (const key in distribution) {
      distribution2[key] = distribution[key].map(origOrder => {
        const leaf = leaves.find(l => l.order === origOrder);
        return leaf ? leaf.num : origOrder;
      });
    }

    let dominantSize = null, max = 0;
    for (const key in distribution2) {
      if (distribution2[key].length > max) { max = distribution2[key].length; dominantSize = key; }
    }

    res.summary = {
      totalPages: leaves.length,
      distribution: distribution2,
      orientations,
      rotations,
      consistentSize: sizeSet.size <= 1,
      dominantSize
    };
    return res;
  }

  function summarize(res) {
    if (!res) return { totalPages: 0, hasPageTree: false };
    return {
      hasPageTree: res.hasPageTree,
      totalPages: res.totalPages,
      distribution: res.summary ? res.summary.distribution : {},
      orientations: res.summary ? res.summary.orientations : { portrait: 0, landscape: 0 },
      rotations: res.summary ? res.summary.rotations : {},
      consistentSize: res.summary ? res.summary.consistentSize : true,
      dominantSize: res.summary ? res.summary.dominantSize : null
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtBox(p) {
    if (p.mediaBox == null) return "未知尺寸";
    return (p.widthMm != null ? p.widthMm + "×" + p.heightMm + "mm" : "?") +
      "（" + Math.round(p.widthPt) + "×" + Math.round(p.heightPt) + "pt）";
  }

  function toMarkdown(res, opts) {
    opts = opts || {};
    const lines = ["# " + (opts.title || "PDF 页面属性 / 页面树信息"), ""];
    if (!res.hasPageTree) {
      lines.push("（未发现 PDF 页面树，无法解析页面属性）");
      return lines.join("\n");
    }
    const s = res.summary;
    lines.push("## 文档摘要");
    lines.push("- **总页数**：" + s.totalPages);
    lines.push("- **尺寸一致**：" + (s.consistentSize ? "全部页面尺寸相同" : "存在多种页面尺寸"));
    lines.push("- **主流纸张**：" + (s.dominantSize || "无"));
    lines.push("- **方向**：纵向 " + s.orientations.portrait + " 页 · 横向 " + s.orientations.landscape + " 页");
    lines.push("- **旋转**：" + Object.keys(s.rotations).filter(k => s.rotations[k]).map(k => (k === "0" ? "无" : k + "°") + "×" + s.rotations[k]).join(" · "));
    lines.push("");
    lines.push("## 纸张分布");
    for (const key in s.distribution) {
      lines.push("- **" + key + "**：第 " + s.distribution[key].join("、") + " 页（共 " + s.distribution[key].length + " 页）");
    }
    lines.push("");
    lines.push("## 逐页属性");
    for (const p of res.pages) {
      const resStr = p.resources.has
        ? ("字体 " + p.resources.fonts + " / 图像 " + p.resources.images + " / XObject " + p.resources.xobjects)
        : "无资源";
      lines.push("### 第 " + p.num + " 页（对象 " + p.obj + "）");
      lines.push("- 纸张：" + p.paperSize + " · " + fmtBox(p));
      lines.push("- 方向：" + (p.orientation === "landscape" ? "横向" : "纵向") + " · 旋转 " + p.rotate + "°");
      lines.push("- 资源：" + resStr);
      if (p.cropBox && (p.cropW !== p.widthPt || p.cropH !== p.heightPt)) {
        lines.push("- 裁剪框：" + p.cropW + "×" + p.cropH + "pt");
      }
    }
    return lines.join("\n");
  }

  function toHtml(res) {
    if (!res.hasPageTree) {
      return `<div style="color:#999;padding:6px 0">（未发现 PDF 页面树，无法解析页面属性）</div>`;
    }
    const s = res.summary;
    let html = `<div style="font-size:13px">`;
    html += `<div style="font-weight:600;margin:4px 0;color:#444">文档摘要</div>`;
    html += `<div style="padding:4px 0;color:#333">总页数 <b>${s.totalPages}</b> · 尺寸${s.consistentSize ? "一致" : "不一致"} · 主流纸张 <b>${escapeHtml(s.dominantSize || "无")}</b></div>`;
    html += `<div style="padding:4px 0;color:#555">方向：纵向 ${s.orientations.portrait} · 横向 ${s.orientations.landscape} ｜ 旋转：${Object.keys(s.rotations).filter(k => s.rotations[k]).map(k => (k === "0" ? "无" : k + "°") + "×" + s.rotations[k]).join(" · ")}</div>`;
    html += `<div style="font-weight:600;margin:8px 0 2px;color:#444">纸张分布</div>`;
    for (const key in s.distribution) {
      html += `<div style="padding:2px 0;color:#555">${escapeHtml(key)}：第 ${s.distribution[key].join("、")} 页</div>`;
    }
    html += `<div style="font-weight:600;margin:8px 0 2px;color:#444">逐页属性（点击跳页）</div>`;
    html += `<div style="border:1px solid #eee;border-radius:6px;overflow:hidden">`;
    res.pages.forEach((p, i) => {
      const resStr = p.resources.has
        ? ("字体 " + p.resources.fonts + " / 图像 " + p.resources.images)
        : "无资源";
      const bg = i % 2 ? "#fafafa" : "#fff";
      html += `<div data-page="${p.num}" style="display:flex;justify-content:space-between;gap:10px;padding:6px 8px;border-bottom:1px solid #eee;cursor:pointer;background:${bg}" title="点击跳转到第 ${p.num} 页">` +
        `<div><b>第 ${p.num} 页</b> <span style="color:#888">· ${escapeHtml(p.paperSize)}</span></div>` +
        `<div style="color:#555;text-align:right">${fmtBox(p)}<br><span style="color:#888">${p.orientation === "landscape" ? "横向" : "纵向"} · 旋转 ${p.rotate}° · ${escapeHtml(resStr)}</span></div>` +
        `</div>`;
    });
    html += `</div></div>`;
    return html;
  }

  const Api = {
    bytesToString, sliceDict, getObjDict, getObjectContent, parseNumArr, resolveBox,
    parseRotate, countTopLevelKeys, parseResources, detectPaper,
    findRootDict, findPagesNode, buildPage, collectLeaves,
    parsePageTree, summarize, toMarkdown, toHtml
  };
  OS.PdfPageInfo = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof window !== "undefined" ? window : globalThis);
