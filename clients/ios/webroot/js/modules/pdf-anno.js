/* ============================================================
   绿角犀 Office · PDF 批注模型（纯逻辑，可单测、不依赖 pdf.js）
   坐标统一归一化到页面盒子 (0..1)，与缩放/分辨率解耦。
   支持类型：highlight(高亮) / pen(画笔) / note(文字批注) / rect(矩形)
            / sign(签名印章) / textfield(表单文本框) / checkbox(表单复选框)
            / freetext(自由文本框) / stamp(图章/图片盖章) / link(链接)
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  const COLORS = {
    highlight: "#fff176", // 黄
    pen: "#ff5252",       // 红
    note: "#42a5f5",      // 蓝
    rect: "#66bb6a",      // 绿
    sign: "#1c1b18",      // 墨黑（签名墨迹）
    textfield: "#1565c0", // 深蓝（表单文本框边框）
    checkbox: "#2e7d32",  // 深绿（表单复选框边框）
    freetext: "#37474f",  // 深灰（自由文本框）
    stamp: "#8d6e63",     // 棕（盖章）
    link: "#1565c0"       // 蓝（链接）
  };

  let _seq = 0;
  function newId() {
    _seq += 1;
    return "a" + Date.now().toString(36) + "_" + _seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // —— 数据操作（直接作用于传入的 annotations 数组）——
  function add(annos, a) {
    if (!Array.isArray(annos) || !a) return null;
    const item = {
      id: a.id || newId(),
      page: a.page,
      type: a.type,
      color: a.color || COLORS[a.type] || "#000000",
      created: a.created || Date.now(),
      author: a.author || "我"
    };
    if (a.type === "note") {
      item.x = num(a.x); item.y = num(a.y);
      item.text = typeof a.text === "string" ? a.text : "";
    } else if (a.type === "pen") {
      const strokes = Array.isArray(a.inkList) && a.inkList.length
        ? a.inkList
        : (Array.isArray(a.points) ? [a.points] : []);
      item.inkList = strokes.map(stroke => (Array.isArray(stroke) ? stroke : []).map(p => Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p), num(p)]));
      // 兼容派生：展开为扁平点对序列（多笔画合并），供旧渲染/旧测试访问 item.points
      item.points = item.inkList.reduce((acc, s) => acc.concat(s), []);
    } else if (a.type === "sign") {
      // 印章：笔画 strokes（每笔为 [x,y] 数组，归一化至印章自身 0..1 盒子）+ 页面放置 x,y,w,h
      item.x = num(a.x); item.y = num(a.y); item.w = num(a.w); item.h = num(a.h);
      item.strokes = Array.isArray(a.strokes)
        ? a.strokes.map(stroke => Array.isArray(stroke) ? stroke.map(pt => [num(pt[0]), num(pt[1])]) : [])
        : [];
    } else if (a.type === "textfield") {
      // 表单文本框：可编辑文字 + 归一化矩形
      item.x = num(a.x); item.y = num(a.y); item.w = num(a.w); item.h = num(a.h);
      item.text = typeof a.text === "string" ? a.text : "";
    } else if (a.type === "checkbox") {
      // 表单复选框：归一化见方 + checked 状态
      item.x = num(a.x); item.y = num(a.y); item.w = num(a.w); item.h = num(a.h);
      item.checked = !!a.checked;
    } else if (a.type === "freetext") {
      // 自由文本框：归一化矩形 + 文本（非表单，纯注解文本框）
      item.x = num(a.x); item.y = num(a.y); item.w = num(a.w); item.h = num(a.h);
      item.text = typeof a.text === "string" ? a.text : "";
    } else if (a.type === "stamp") {
      // 图章/盖章：归一化矩形 + 标签文本 + 可选 image（图片盖章 dataURL / 资源引用）
      item.x = num(a.x); item.y = num(a.y); item.w = num(a.w); item.h = num(a.h);
      item.text = typeof a.text === "string" ? a.text : "";
      if (a.image) item.image = a.image; // 图片盖章（dataURL / 资源引用），可选
    } else if (a.type === "link") {
      // 链接：归一化矩形 + 目标地址（URI 或内部定位 dest）
      item.x = num(a.x); item.y = num(a.y); item.w = num(a.w); item.h = num(a.h);
      item.uri = typeof a.uri === "string" ? a.uri : (typeof a.href === "string" ? a.href : "");
    } else { // highlight / rect / underline / strikeout 等
      item.x = num(a.x); item.y = num(a.y); item.w = num(a.w); item.h = num(a.h);
      if (Array.isArray(a.quadPoints) && a.quadPoints.length >= 8) item.quadPoints = a.quadPoints.map(num);
    }
    if (Array.isArray(a.vector)) item.vector = a.vector; // 矢量外观（AP 矢量绘制命令序列，由 PdfContent 解析）
    // 图层分组 + 可见性（T）：layer 默认 "default"，visible 默认 true
    item.layer = (typeof a.layer === "string" && a.layer) ? a.layer : "default";
    item.visible = (a.visible === false) ? false : true;
    annos.push(item);
    return item;
  }

  function remove(annos, id) {
    if (!Array.isArray(annos)) return false;
    const i = annos.findIndex(x => x.id === id);
    if (i >= 0) { annos.splice(i, 1); return true; }
    return false;
  }

  function update(annos, id, patch) {
    if (!Array.isArray(annos)) return null;
    const a = annos.find(x => x.id === id);
    if (!a) return null;
    Object.keys(patch || {}).forEach(k => { a[k] = patch[k]; });
    return a;
  }

  function getById(annos, id) {
    if (!Array.isArray(annos)) return null;
    return annos.find(x => x.id === id) || null;
  }

  function getPage(annos, page) {
    if (!Array.isArray(annos)) return [];
    return annos.filter(a => a.page === page);
  }

  function stats(annos) {
    const arr = Array.isArray(annos) ? annos : [];
    const byPage = {};
    const byLayer = {};
    let visibleCount = 0;
    let byType = { highlight: 0, pen: 0, note: 0, rect: 0, sign: 0, textfield: 0, checkbox: 0, freetext: 0, stamp: 0, link: 0 };
    arr.forEach(a => {
      byPage[a.page] = (byPage[a.page] || 0) + 1;
      if (byType[a.type] != null) byType[a.type] += 1;
      const layer = a.layer || "default";
      byLayer[layer] = (byLayer[layer] || 0) + 1;
      if (a.visible !== false) visibleCount += 1;
    });
    return { total: arr.length, byPage, byType, byLayer, visibleCount };
  }

  function clearPage(annos, page) {
    if (!Array.isArray(annos)) return 0;
    let n = 0;
    for (let i = annos.length - 1; i >= 0; i--) {
      if (annos[i].page === page) { annos.splice(i, 1); n++; }
    }
    return n;
  }

  // —— 图层分组 + 可见性（T）——
  // 按 layer 字段分组，返回 { layerName: [anno, ...] }
  function groupByLayer(annos) {
    const groups = {};
    if (!Array.isArray(annos)) return groups;
    annos.forEach(a => {
      const layer = a.layer || "default";
      (groups[layer] = groups[layer] || []).push(a);
    });
    return groups;
  }
  // 设置某条批注所属图层（按 id），返回更新后的 item 或 null
  function setLayer(annos, id, layer) {
    if (!Array.isArray(annos)) return null;
    const a = annos.find(x => x.id === id);
    if (!a) return null;
    a.layer = (typeof layer === "string" && layer) ? layer : "default";
    return a;
  }
  // 设置某条批注可见性（按 id），返回更新后的 item 或 null
  function setVisible(annos, id, visible) {
    if (!Array.isArray(annos)) return null;
    const a = annos.find(x => x.id === id);
    if (!a) return null;
    a.visible = !!visible;
    return a;
  }
  // 设置某图层全部批注的可见性（按 layer 名），返回受影响条数
  function setVisibleForLayer(annos, layer, visible) {
    if (!Array.isArray(annos)) return 0;
    const name = (typeof layer === "string" && layer) ? layer : "default";
    let n = 0;
    annos.forEach(a => { if ((a.layer || "default") === name) { a.visible = !!visible; n++; } });
    return n;
  }

  // —— 序列化 ——
  function toJSON(annos) { return JSON.stringify(annos || []); }
  function fromJSON(s) {
    if (s == null) return [];
    if (Array.isArray(s)) return s; // 已解析
    try {
      const a = JSON.parse(s);
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  // —— 导出为可再导入的规范形态（与 importFromRaw 闭环）——
  // 输出数组，元素为「原始输入」结构（type + page + 类型相关字段 + 颜色/作者），
  // 可直接喂回 importFromRaw / importFromFdf 等，round-trip 后结构/坐标一致。
  function exportToRaw(annos) {
    if (!Array.isArray(annos)) return [];
    return annos.map(a => {
      const o = { id: a.id, page: a.page, type: a.type };
      if (a.color) o.color = a.color;
      if (a.author) o.author = a.author;
      if (a.created) o.created = a.created;
      if (a.type === "pen") {
        o.inkList = (a.inkList || []).map(s => s.map(p => [num(p[0]), num(p[1])]));
        if (a.points) o.points = a.points.map(p => [num(p[0]), num(p[1])]);
      } else if (a.type === "note") {
        o.x = num(a.x); o.y = num(a.y); o.w = 0; o.h = 0; o.text = a.text != null ? a.text : "";
      } else if (a.type === "sign") {
        o.x = num(a.x); o.y = num(a.y); o.w = num(a.w); o.h = num(a.h);
        o.strokes = (a.strokes || []).map(s => s.map(p => [num(p[0]), num(p[1])]));
      } else if (a.type === "highlight" || a.type === "rect") {
        o.x = num(a.x); o.y = num(a.y); o.w = num(a.w); o.h = num(a.h);
        if (Array.isArray(a.quadPoints) && a.quadPoints.length >= 8) o.quadPoints = a.quadPoints.map(num);
      } else {
        // textfield / checkbox / freetext / stamp / link
        o.x = num(a.x); o.y = num(a.y); o.w = num(a.w); o.h = num(a.h);
        if (a.text != null) o.text = a.text;
        if (a.checked != null) o.checked = !!a.checked;
        if (a.image != null) o.image = a.image;
        if (a.uri != null) o.uri = a.uri;
      }
      if (Array.isArray(a.vector)) o.vector = a.vector; // 矢量外观（AP 矢量绘制命令序列，round-trip 保留）
      o.layer = a.layer || "default"; // 图层分组（T，round-trip 保留）
      o.visible = a.visible !== false; // 可见性（T，round-trip 保留；默认可见）
      return o;
    });
  }
  function exportJSON(annos) { return JSON.stringify(exportToRaw(annos)); }

  // —— 几何：归一化（像素坐标 -> 0..1）——
  function normRect(x, y, w, h, boxW, boxH) {
    const bw = boxW > 0 ? boxW : 1, bh = boxH > 0 ? boxH : 1;
    return { x: x / bw, y: y / bh, w: w / bw, h: h / bh };
  }
  function denormRect(r, boxW, boxH) {
    return { x: r.x * boxW, y: r.y * boxH, w: r.w * boxW, h: r.h * boxH };
  }

  // 画笔点序列 -> 归一化包围盒 {x,y,w,h}
  function polyBBox(points, boxW, boxH) {
    if (!points || !points.length) return null;
    const bw = boxW > 0 ? boxW : 1, bh = boxH > 0 ? boxH : 1;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
      const x = p[0] / bw, y = p[1] / bh;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    });
    return { x: minX, y: minY, w: Math.max(maxX - minX, 0.0001), h: Math.max(maxY - minY, 0.0001) };
  }

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  // —— 反向读回：外部/原始 PDF 注释数据 → 内部 annotation 模型 ——
  // 支持：已是内部格式 / 常见原始字段（type 别名、rect[4]/[x,y,w,h]/quadPoints、颜色数组或 hex、contents 文本、points/inkList、checkbox 状态）
  // 坏数据（缺坐标、未知类型、结构非法）跳过并计入 skipped，不阻塞其余。
  function normalizeColor(c) {
    if (c == null) return null;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const to255 = c.some(v => v > 1);
      const rgb = c.slice(0, 3).map(v => Math.round(to255 ? v : v * 255));
      return "#" + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
    }
    return null;
  }
  function rectFrom(raw) {
    if (!raw || typeof raw !== "object") return null;
    const R = v => Math.round(v * 1e6) / 1e6;
    const r = raw.rect || raw.Rect || raw.bbox || raw.boundingBox;
    const q = raw.quadPoints || raw.QuadPoints;
    if (Array.isArray(r) && r.length >= 4) {
      const x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]);
      return { x: R(x), y: R(y), w: R(Math.abs(r[2] - r[0])), h: R(Math.abs(r[3] - r[1])) };
    }
    if (r && typeof r.x === "number" && typeof r.w === "number") return { x: R(r.x), y: R(r.y), w: R(r.w), h: R(r.h) };
    if (Array.isArray(q) && q.length >= 8) {
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
      return { x: R(Math.min.apply(null, xs)), y: R(Math.min.apply(null, ys)), w: R(Math.max.apply(null, xs) - Math.min.apply(null, xs)), h: R(Math.max.apply(null, ys) - Math.min.apply(null, ys)) };
    }
    return null;
  }
  const TYPE_ALIAS = {
    underline: "highlight", squiggly: "highlight", strikeout: "highlight",
    text: "note", FreeText: "note",
    Ink: "pen", ink: "pen",
    square: "rect", circle: "rect",
    Widget: "textfield",
    Link: "link", link: "link"
  };
  // —— FDF / XFDF 原始文本解析层（容错）——
  // 将 FDF（类 PDF 字典文本）或 XFDF（XML）解析为 importFromRaw 可消费的原始数组
  // 坐标保持 PDF 用户空间（Points，原点左下，y 向上）；归一化交由 importFromRaw(opts.normalize) 负责。
  function unescapePdfStr(s) {
    if (typeof s !== "string") return "";
    return s.replace(/\\([()\\])/g, "$1").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
  }
  const FDF_SUBTYPE = {
    text: "note", freetext: "freetext", highlight: "highlight", underline: "highlight",
    squiggly: "highlight", strikeout: "highlight", square: "rect", circle: "rect",
    line: "rect", polygon: "rect", polyline: "rect", ink: "pen", stamp: "stamp",
    caret: "note", widget: "textfield", checkbox: "checkbox", radiobutton: "checkbox",
    link: "link"
  };
  const KNOWN_TYPES = ["highlight", "pen", "note", "rect", "sign", "textfield", "checkbox", "freetext", "stamp", "link"];
  function pick(body, re) { const m = re.exec(body); return m ? m[1] : null; }
  // 按深度计数提取顶层 <<...>> 字典（容忍内嵌子字典，如 /AP <<...>>），供注释解析
  function extractDicts(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === "<" && text[i + 1] === "<") {
        let depth = 1, j = i + 2;
        while (j < text.length && depth > 0) {
          if (text[j] === "<" && text[j + 1] === "<") { depth++; j += 2; }
          else if (text[j] === ">" && text[j + 1] === ">") { depth--; j += 2; }
          else j++;
        }
        out.push(text.slice(i, j));
        i = j;
      } else i++;
    }
    return out;
  }
  function pickRectPoints(body) {
    const m = /Rect\s*\[([^\]]+)\]/.exec(body);
    if (!m) return null;
    const nums = m[1].trim().split(/\s+/).map(Number).filter(v => isFinite(v));
    if (nums.length < 4) return null;
    return [nums[0], nums[1], nums[2], nums[3]];
  }
  function pickColorArr(body) {
    const m = /C\s*\[([^\]]+)\]/.exec(body);
    if (!m) return null;
    const a = m[1].trim().split(/\s+/).map(Number).filter(v => isFinite(v));
    if (a.length < 3) return null;
    return a.slice(0, 3);
  }
  function parseFdfText(text) {
    if (!text || typeof text !== "string") return [];
    const out = [];
    const dicts = extractDicts(text);
    for (const b of dicts) {
      const sub = pick(b, /Subtype\s*\/\s*(\w+)/);
      const rect = pickRectPoints(b);
      if (!sub || !rect) continue;
      const type = FDF_SUBTYPE[sub.toLowerCase()] || sub.toLowerCase();
      if (KNOWN_TYPES.indexOf(type) < 0) continue; // 仅保留可映射的内部类型
      const raw = { type: type, rect: rect };
      const pageM = /(^|\s)P\s+(\d+)\s+0\s+R/.exec(b);
      if (pageM) raw.page = parseInt(pageM[2], 10); // /P N 0 R：引用对象号，扁平文档≈1-based 页码(启发式)
      else { const pm = /Page\s+(\d+)/.exec(b); if (pm) raw.page = parseInt(pm[1], 10); } // FDF /Page N 为 1-based
      const c = pick(b, /Contents\s*\(([^)]*)\)/) || pick(b, /Contents\s*<([^>]*)>/);
      if (c != null) raw.text = unescapePdfStr(c);
      const t = pick(b, /T\s*\(([^)]*)\)/) || pick(b, /T\s*<([^>]*)>/);
      if (t != null) raw.author = unescapePdfStr(t);
      const col = pickColorArr(b);
      if (col) raw.color = col;
      // 链接目标（FDF: /A << /S /URI /URI (...) >>）
      if (type === "link") {
        const uriM = /URI\s*\(([^)]*)\)/.exec(b);
        if (uriM) raw.uri = unescapePdfStr(uriM[1]);
      }
      // 图片盖章（最佳努力）：自定义 /IMG (data:...) 或 /StampImage (<...data:...>)
      const imgM = /(?:IMG|StampImage)\s*(?:\(([^)]*data:[^)]*)\)|<([^>]*data:[^>]*)>)/.exec(b);
      if (imgM) raw.image = (imgM[1] || imgM[2] || "").trim();
      if (type === "pen") {
        const ip = b.indexOf("InkList");
        const i0 = ip >= 0 ? b.indexOf("[", ip) : -1;
        if (i0 >= 0) {
          let i = i0, depth = 0, cur = null;
          const segs = [];
          let end = -1;
          for (; i < b.length; i++) {
            const ch = b[i];
            if (ch === "[") {
              depth++;
              if (depth === 2) cur = "";
            } else if (ch === "]") {
              if (depth === 2 && cur !== null) { segs.push(cur); cur = null; }
              depth--; if (depth === 0) { end = i; break; }
            } else if (depth >= 2 && cur !== null) cur += ch;
          }
          if (segs.length === 0 && end >= 0) {
            // 单笔画（无内层括号）：整个 InkList 内容作为一笔
            const content = b.slice(i0 + 1, end).trim();
            if (content.length) segs.push(content);
          }
          const inkList = segs.filter(s => s && s.trim().length).map(s => {
            const nums = s.trim().split(/\s+/).map(Number).filter(v => isFinite(v));
            const pts = [];
            for (let k = 0; k + 1 < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
            return pts;
          }).filter(s => s.length >= 2);
          if (inkList.length) { raw.inkList = inkList; raw.points = inkList[0]; } // raw.points 兼容派生（首笔点对数组）
        }
      }
      const qm = /QuadPoints\s*\[([^\]]+)\]/.exec(b);
      if (qm) {
        const nums = qm[1].trim().split(/\s+/).map(Number).filter(v => isFinite(v));
        if (nums.length >= 8) raw.quadPoints = nums;
      }
      out.push(raw);
    }
    return out;
  }
  function getAttr(s, name) { const mm = new RegExp(name + "\\s*=\\s*[\"']?([\\d.]+)[\"']?").exec(s); return mm ? parseFloat(mm[1]) : NaN; }
  function parseXfdfText(text) {
    if (!text || typeof text !== "string") return [];
    const out = [];
    const tagRe = /<(text|highlight|underline|squiggly|strikeout|square|circle|line|polygon|polyline|ink|stamp|caret|freetext|widget|checkbox|radiobutton|link)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = tagRe.exec(text))) {
      const tag = m[1].toLowerCase();
      const attrs = m[2] || "";
      const inner = m[3] || "";
      const type = FDF_SUBTYPE[tag] || tag;
      const pageM = /page\s*=\s*["']?(\d+)["']?/.exec(attrs);
      const page = pageM ? parseInt(pageM[1], 10) + 1 : 1; // XFDF page 0-based → 1-based
      const rectEl = /<rect\b[^>]*\/?>/.exec(inner);
      let rect = null;
      if (rectEl) {
        const x = getAttr(rectEl[0], "x"), y = getAttr(rectEl[0], "y");
        const w = getAttr(rectEl[0], "width"), h = getAttr(rectEl[0], "height");
        if (isFinite(x) && isFinite(y) && isFinite(w) && isFinite(h)) rect = [x, y, x + w, y + h];
      }
      if (!rect && type !== "pen") continue; // pen 用 inkList 确定坐标，无需 rect
      const raw = { type: type, rect: rect, page: page };
      const cm = /<contents\b[^>]*>([\s\S]*?)<\/contents>/.exec(inner);
      if (cm) raw.text = cm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      const tm = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(inner);
      if (tm) raw.author = tm[1].trim();
      const colM = /<color\b[^>]*>([\s\S]*?)<\/color>/.exec(inner) || /<pen\b[^>]*>([\s\S]*?)<\/pen>/.exec(inner);
      if (colM) { const a = colM[1].trim().split(/\s+/).map(Number).filter(isFinite); if (a.length >= 3) raw.color = a.slice(0, 3); }
      // 链接目标
      if (type === "link") {
        const hrefA = /href\s*=\s*["']([^"']*)["']/.exec(attrs);
        const hrefM = /<href\b[^>]*>([\s\S]*?)<\/href>/.exec(inner);
        raw.uri = hrefA ? hrefA[1] : (hrefM ? hrefM[1].trim() : "");
      }
      // 图片盖章（最佳努力）：inner 中的 data: URL，或 image= 属性
      if (type === "stamp") {
        const imgX = /(data:image\/[^\s"'<>]+)/.exec(inner) || /image\s*=\s*["']([^"']+)["']/.exec(attrs);
        if (imgX) raw.image = imgX[1];
      }
      if (type === "pen") {
        const inkEl = /<inklist\b[^>]*>([\s\S]*?)<\/inklist>/.exec(inner);
        if (inkEl) {
          const strokeStrs = inkEl[1].match(/<stroke\b[^>]*>([\s\S]*?)<\/stroke>/g) || inkEl[1].match(/\[[^\]]*\]/g) || [inkEl[1]];
          const inkList = strokeStrs.map(s => {
            const nums = s.replace(/<[^>]*>/g, " ").replace(/[\[\]]/g, " ").trim().split(/\s+/).map(Number).filter(v => isFinite(v));
            const pts = [];
            for (let k = 0; k + 1 < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
            return pts;
          }).filter(s => s.length >= 2);
          if (inkList.length) { raw.inkList = inkList; raw.points = inkList[0]; } // raw.points 兼容派生（首笔点对数组）
        }
      }
      const qm = /<quadpoints\b[^>]*>([\s\S]*?)<\/quadpoints>/.exec(inner);
      if (qm) {
        const nums = qm[1].trim().split(/\s+/).map(Number).filter(v => isFinite(v));
        if (nums.length >= 8) raw.quadPoints = nums;
      }
      out.push(raw);
    }
    return out;
  }
  // 原始 FDF/XFDF 文本 → 内部模型（默认按 Letter 612×792 归一化；可用 opts.dims(page)=>{w,h} 覆盖）
  function importFromFdf(text, opts) {
    opts = opts || {};
    const raw = parseFdfText(text);
    if (!raw.length) return { annotations: [], skipped: 0, error: "未解析到注释" };
    const dims = typeof opts.dims === "function" ? opts.dims
      : (function () { const W = opts.pageWidth || 612, H = opts.pageHeight || 792; return function () { return { w: W, h: H }; }; })();
    return importFromRaw(raw, { normalize: true, dims: dims });
  }
  function importFromXfdf(text, opts) {
    opts = opts || {};
    const raw = parseXfdfText(text);
    if (!raw.length) return { annotations: [], skipped: 0, error: "未解析到注释" };
    const dims = typeof opts.dims === "function" ? opts.dims
      : (function () { const W = opts.pageWidth || 612, H = opts.pageHeight || 792; return function () { return { w: W, h: H }; }; })();
    return importFromRaw(raw, { normalize: true, dims: dims });
  }

  function importFromRaw(rawList, opts) {
    opts = opts || {};
    const dimsFn = (opts.normalize && typeof opts.dims === "function") ? opts.dims : null;
    let list = rawList;
    if (typeof rawList === "string") { try { list = JSON.parse(rawList); } catch (e) { list = null; } }
    if (!Array.isArray(list)) return { annotations: [], skipped: 0, error: "输入非数组" };
    const knownTypes = ["highlight", "pen", "note", "rect", "sign", "textfield", "checkbox", "freetext", "stamp", "link"];
    const out = []; let skipped = 0;
    // 源坐标（如 PDF 用户空间 Points）→ 归一化 0..1（应用内部模型约定）。
    // 触发条件：提供了 dims 回调且坐标明显 > 1（非归一化）。y 轴翻转（PDF 原点左下 → 渲染原点左上）。
    function normRect(item) {
      if (!dimsFn) return;
      const d = dimsFn(item.page);
      if (!d || !d.w || !d.h) return;
      if (item.x > 1 || item.y > 1 || item.w > 1 || item.h > 1) {
        const nx = item.x / d.w;
        const ny = (d.h - (item.y + item.h)) / d.h;
        item.x = nx; item.y = ny; item.w = item.w / d.w; item.h = item.h / d.h;
      }
    }
    function normPen(item) {
      if (!dimsFn || !item.inkList) return;
      const d = dimsFn(item.page);
      if (!d || !d.w || !d.h) return;
      if (!item.inkList.some(stroke => stroke.some(p => p[0] > 1 || p[1] > 1))) return;
      item.inkList = item.inkList.map(stroke => stroke.map(p => [p[0] / d.w, (d.h - p[1]) / d.h]));
    }
    function normQuad(item) {
      if (!dimsFn || !Array.isArray(item.quadPoints)) return;
      const d = dimsFn(item.page);
      if (!d || !d.w || !d.h) return;
      if (!item.quadPoints.some(v => v > 1)) return;
      // quadPoints 扁平 [x1 y1 x2 y2 ...]，成对为角点；x 归一化、y 翻转（PDF 原点左下）
      item.quadPoints = item.quadPoints.map((v, i) => (i % 2 === 0) ? v / d.w : (d.h - v) / d.h);
    }
    list.forEach(raw => {
      if (!raw || typeof raw !== "object") { skipped++; return; }
      // 已是内部格式（含归一化坐标）→ 直接接受，保留 id（含 author/created 等原字段）
      if (raw.type && knownTypes.indexOf(raw.type) >= 0 && raw.x != null && raw.y != null && raw.w != null && raw.h != null) {
        if (!add(out, raw)) skipped++; return;
      }
      const page = num(raw.page != null ? raw.page : (raw.pageIndex != null ? raw.pageIndex : (raw.p != null ? raw.p : 1)));
      let type = raw.type ? String(raw.type) : null;
      if (type && TYPE_ALIAS[type]) type = TYPE_ALIAS[type];
      if (!type || knownTypes.indexOf(type) < 0) { skipped++; return; }
      const rect = rectFrom(raw);
      if (type !== "pen" && (!rect || !(rect.w > 0) || !(rect.h > 0))) { skipped++; return; }
      const color = normalizeColor(raw.color != null ? raw.color : (raw.c != null ? raw.c : raw.C));
      const item = { page: page, type: type, color: color || undefined };
      if (raw.id) item.id = raw.id;
      if (type === "pen") {
        let inkList = null;
        if (Array.isArray(raw.inkList) && raw.inkList.length && Array.isArray(raw.inkList[0])) {
          inkList = raw.inkList.map(stroke => stroke.map(p => Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p.x), num(p.y)]));
        } else if (Array.isArray(raw.points) && raw.points.length) {
          const flat = raw.points.map(p => Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p.x), num(p.y)]);
          if (flat.length >= 2) inkList = [flat];
        }
        if (!inkList || !inkList.length) { skipped++; return; }
        item.inkList = inkList;
        normPen(item);
      } else if (type === "note" || type === "textfield") {
        item.x = rect.x; item.y = rect.y; item.w = rect.w; item.h = rect.h;
        item.text = typeof raw.text === "string" ? raw.text : (typeof raw.contents === "string" ? raw.contents : (typeof raw.content === "string" ? raw.content : (typeof raw.T === "string" ? raw.T : "")));
        normRect(item);
      } else if (type === "checkbox") {
        item.x = rect.x; item.y = rect.y; item.w = rect.w; item.h = rect.h;
        item.checked = !!(raw.checked === true || raw.V === "Yes" || raw.checked === "Yes");
        normRect(item);
      } else if (type === "sign") {
        item.x = rect.x; item.y = rect.y; item.w = rect.w; item.h = rect.h;
        item.strokes = Array.isArray(raw.strokes) ? raw.strokes : [];
        normRect(item);
      } else if (type === "freetext" || type === "stamp" || type === "link") {
        item.x = rect.x; item.y = rect.y; item.w = rect.w; item.h = rect.h;
        if (type === "freetext" || type === "stamp") {
          item.text = typeof raw.text === "string" ? raw.text : (typeof raw.contents === "string" ? raw.contents : (typeof raw.content === "string" ? raw.content : (typeof raw.T === "string" ? raw.T : "")));
        }
        if (type === "stamp" && (raw.image || raw.IMG)) item.image = raw.image || raw.IMG; // 图片盖章（dataURL / 资源引用）
        if (type === "link") {
          item.uri = typeof raw.uri === "string" ? raw.uri : (typeof raw.href === "string" ? raw.href : (typeof raw.URI === "string" ? raw.URI : ""));
        }
        normRect(item);
      } else {
        item.x = rect.x; item.y = rect.y; item.w = rect.w; item.h = rect.h;
        if (Array.isArray(raw.quadPoints) && raw.quadPoints.length >= 8) { item.quadPoints = raw.quadPoints.map(num); normQuad(item); }
        normRect(item);
      }
      if (raw.author || raw.title) item.author = raw.author || raw.title;
      if (raw.created) item.created = raw.created;
      if (Array.isArray(raw.vector)) item.vector = raw.vector; // 矢量外观（AP 矢量绘制命令序列）
      if (raw.layer && typeof raw.layer === "string") item.layer = raw.layer; // 图层分组（T）
      if (raw.visible === false) item.visible = false; // 可见性（T）
      if (!add(out, item)) skipped++;
    });
    return { annotations: out, skipped: skipped };
  }

  // ===================== PDF 内嵌 AP 资源流解析（提取图章/签名真实图像） =====================
  // 接收 OS.PdfTool.parsePdf 的解析结果，逐页读取 /Annots，解码 /AP 外观字典引用的
  // 图像 XObject（直接图像，或 Form XObject 内嵌的 /XObject 图像），还原为内部批注模型。
  // 坐标保持 PDF 用户空间（原点左下），归一化交由 importFromRaw(opts.normalize) 负责。

  function _toStrU8(u8) { return OS.PdfTool._toStr(u8); }
  function _b64(u8) {
    if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
    let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return (typeof btoa === "function") ? btoa(s) : s;
  }

  // 最小 PNG 编码器（RGB, 8bit, filter=0），依赖 OS.PdfTool._deflate（RFC1950）
  let _crcTable = null;
  function _crc32(buf) {
    if (!_crcTable) {
      _crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crcTable[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function _concatBytes() {
    let len = 0; for (let i = 0; i < arguments.length; i++) len += arguments[i].length;
    const out = new Uint8Array(len); let p = 0;
    for (let i = 0; i < arguments.length; i++) { out.set(arguments[i], p); p += arguments[i].length; }
    return out;
  }
  function _pngChunk(type, data) {
    const len = new Uint8Array(4); const dv = new DataView(len.buffer); dv.setUint32(0, data.length);
    const t = new Uint8Array(4); for (let i = 0; i < 4; i++) t[i] = type.charCodeAt(i);
    const crcBuf = _concatBytes(t, data);
    const crc = _crc32(crcBuf);
    const cb = new Uint8Array(4); const dv2 = new DataView(cb.buffer); dv2.setUint32(0, crc);
    return _concatBytes(len, t, data, cb);
  }
  async function _encodePng(w, h, rgb) {
    const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const stride = w * 3;
    const raw = new Uint8Array((stride + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); }
    const comp = await OS.PdfTool._deflate(raw);
    return _concatBytes(sig, _pngChunk("IHDR", ihdr), _pngChunk("IDAT", comp), _pngChunk("IEND", new Uint8Array(0)));
  }

  // 解码单个图像 XObject（dict 字符串 + 流字节）→ { format, width, height, dataUrl }
  async function decodeImageXObject(dictStr, streamBytes) {
    const wM = /Width\s+(\d+)/.exec(dictStr); const hM = /Height\s+(\d+)/.exec(dictStr);
    const w = wM ? parseInt(wM[1], 10) : 0, h = hM ? parseInt(hM[1], 10) : 0;
    const filterM = /Filter\s*\/([A-Za-z]+)/.exec(dictStr) || /Filter\s*\[\s*\/([A-Za-z]+)/.exec(dictStr);
    const filter = filterM ? filterM[1] : null;
    if (filter === "DCTDecode") {
      return { format: "jpeg", width: w, height: h, dataUrl: "data:image/jpeg;base64," + _b64(streamBytes) };
    }
    let rawBytes = streamBytes;
    if (filter === "FlateDecode" || filter == null) {
      try { rawBytes = await OS.PdfTool._inflate(streamBytes); } catch (e) { return null; }
    } else { return null; }
    const gray = /ColorSpace\s*\/DeviceGray/.test(dictStr);
    let rgb;
    if (gray) {
      rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { rgb[i * 3] = rawBytes[i]; rgb[i * 3 + 1] = rawBytes[i]; rgb[i * 3 + 2] = rawBytes[i]; }
    } else { rgb = rawBytes; } // 默认 DeviceRGB
    const png = await _encodePng(w, h, rgb);
    return { format: "png", width: w, height: h, dataUrl: "data:image/png;base64," + _b64(png) };
  }

  // 从注释字典中提取 AP 外观图像（直接图像 XObject，或 Form XObject 内嵌图像）
  async function extractApImage(annotDictStr, getObject) {
    if (typeof annotDictStr !== "string") return null;
    const apM = /AP\s*<<([\s\S]*?)>>/.exec(annotDictStr);
    if (!apM) return null;
    const apInner = apM[1];
    const nref = /N\s+(\d+)\s+\d+\s+R/.exec(apInner) || /D\s+(\d+)\s+\d+\s+R/.exec(apInner) || /R\s+(\d+)\s+\d+\s+R/.exec(apInner);
    if (!nref) return null;
    const obj = getObject(parseInt(nref[1], 10));
    if (!obj) return null;
    if (/\/Subtype\s*\/Image\b/.test(obj.dict)) {
      return decodeImageXObject(obj.dict, obj.stream);
    }
    if (/\/Subtype\s*\/Form\b/.test(obj.dict)) {
      const xoM = /XObject\s*<<([\s\S]*?)\s*>>/.exec(obj.dict);
      if (!xoM) return null;
      const refs = {};
      const re = /\/([A-Za-z0-9]+)\s+(\d+)\s+\d+\s+R/g; let m;
      while ((m = re.exec(xoM[1]))) refs[m[1]] = parseInt(m[2], 10);
      if (!Object.keys(refs).length) return null;
      // 找出内容流中实际引用的图像名（" /Name Do "）
      let usedName = null;
      const doM = /([A-Za-z0-9]+)\s+Do\b/.exec(obj.streamStr || "");
      if (doM) usedName = doM[1].replace(/^\//, "");
      const name = usedName && refs[usedName] != null ? usedName : Object.keys(refs)[0];
      const imgObj = getObject(refs[name]);
      if (!imgObj || !/\/Subtype\s*\/Image\b/.test(imgObj.dict)) return null;
      return decodeImageXObject(imgObj.dict, imgObj.stream);
    }
    return null;
  }

  // 由 parsePdf 结果构建对象解析器：num → { dict, stream, streamStr }
  function _makeObjectResolver(parsedPdf) {
    return function (num) {
      const o = parsedPdf.objects.get(num);
      if (!o) return null;
      const s = _toStrU8(o.innerBytes);
      const si = s.indexOf("stream");
      if (si < 0) return { dict: s, stream: new Uint8Array(0), streamStr: "" };
      const dict = s.slice(0, si);
      let start = si + 6;
      if (s[start] === "\r") start++; if (s[start] === "\n") start++;
      const ei = s.lastIndexOf("endstream");
      let end = ei >= 0 ? ei : s.length;
      while (end > start && (s[end - 1] === "\n" || s[end - 1] === "\r")) end--;
      const stream = o.innerBytes.subarray(start, end);
      return { dict, stream, streamStr: _toStrU8(stream) };
    };
  }

  // 顶层：解析整份 PDF 的批注，提取真实图像（图章/签名），返回 { annotations, skipped }
  async function resolvePdfAnnotations(parsedPdf, pageDimsFn) {
    pageDimsFn = pageDimsFn || function () { return { w: 612, h: 792 }; };
    const getObj = _makeObjectResolver(parsedPdf);
    const raws = [];
    const dimsByIndex = [];
    let skipped = 0;
    for (let idx = 0; idx < parsedPdf.pages.length; idx++) {
      const pageNum = parsedPdf.pages[idx];
      const dims = pageDimsFn(pageNum) || { w: 612, h: 792 };
      dimsByIndex.push(dims);
      const dict = parsedPdf.dictStr(pageNum);
      const annM = /Annots\s*\[([\s\S]*?)\]/.exec(dict);
      if (!annM) continue;
      const refs = annM[1].match(/(\d+)\s+\d+\s+R/g) || [];
      for (const r of refs) {
        const num = parseInt(r.replace(/\s+\d+\s+R$/, ""), 10);
        const a = getObj(num);
        if (!a) { skipped++; continue; }
        const d = a.dict;
        const subM = /Subtype\s*\/\s*(\w+)/.exec(d);
        if (!subM) { skipped++; continue; }
        let subtype = subM[1].toLowerCase();
        if (subtype === "widget") {
          subtype = /FT\s*\/Tx\b/.test(d) ? "textfield" : (/FT\s*\/Btn\b/.test(d) ? "checkbox" : "textfield");
        }
        const rectM = /Rect\s*\[([^\]]+)\]/.exec(d);
        if (!rectM) { skipped++; continue; }
        const nums = rectM[1].trim().split(/\s+/).map(Number).filter(isFinite);
        if (nums.length < 4) { skipped++; continue; }
        const x1 = nums[0], y1 = nums[1], x2 = nums[2], y2 = nums[3];
        const raw = { page: idx + 1, type: subtype, rect: [x1, y1, x2, y2] };
        const cM = /Contents\s*\(([^)]*)\)/.exec(d) || /Contents\s*<([^>]*)>/.exec(d);
        if (cM) raw.text = cM[1];
        const tM = /T\s*\(([^)]*)\)/.exec(d);
        if (tM) raw.author = tM[1];
        const colM = /C\s*\[([^\]]+)\]/.exec(d);
        if (colM) { const cc = colM[1].trim().split(/\s+/).map(Number).filter(isFinite); if (cc.length >= 3) raw.color = cc; }
        const uriM = /URI\s*\(([^)]*)\)/.exec(d);
        if (uriM) raw.uri = uriM[1];
        const qM = /QuadPoints\s*\[([^\]]+)\]/.exec(d);
        if (qM) { const qn = qM[1].trim().split(/\s+/).map(Number).filter(isFinite); if (qn.length >= 8) raw.quadPoints = qn; }
        if (subtype === "ink") {
          const ip = d.indexOf("InkList"); const i0 = ip >= 0 ? d.indexOf("[", ip) : -1;
          if (i0 >= 0) {
            let i = i0, depth = 0, cur = null; const segs = []; let end = -1;
            for (; i < d.length; i++) {
              const ch = d[i];
              if (ch === "[") { depth++; if (depth === 2) cur = ""; }
              else if (ch === "]") { if (depth === 2 && cur !== null) { segs.push(cur); cur = null; } depth--; if (depth === 0) { end = i; break; } }
              else if (depth >= 2 && cur !== null) cur += ch;
            }
            if (segs.length === 0 && end >= 0) { const content = d.slice(i0 + 1, end).trim(); if (content.length) segs.push(content); }
            const inkList = segs.filter(s => s && s.trim().length).map(s => {
              const ns = s.trim().split(/\s+/).map(Number).filter(v => isFinite(v)); const pts = [];
              for (let k = 0; k + 1 < ns.length; k += 2) pts.push([ns[k], ns[k + 1]]); return pts;
            }).filter(s => s.length >= 2);
            if (inkList.length) raw.inkList = inkList;
          }
        }
        const img = await extractApImage(d, getObj);
        if (img) raw.image = img.dataUrl;
        // 矢量外观（Form XObject 内容流中的路径绘制）：与位图 image 互补，独立存储 vector 字段
        if (OS.PdfContent && OS.PdfContent.extractApVector) {
          const vec = await OS.PdfContent.extractApVector(d, getObj);
          if (vec) raw.vector = vec.ops;
        }
        raws.push(raw);
      }
    }
    const res = importFromRaw(raws, { normalize: true, dims: function (p) { return dimsByIndex[p - 1] || { w: 612, h: 792 }; } });
    res.skipped += skipped;
    return res;
  }

  OS.PdfAnno = {
    COLORS, newId,
    add, remove, update, getById, getPage, stats, clearPage,
    groupByLayer, setLayer, setVisible, setVisibleForLayer,
    toJSON, fromJSON, exportToRaw, exportJSON,
    normRect, denormRect, polyBBox,
    importFromRaw, _normalizeColor: normalizeColor, _rectFrom: rectFrom, _TYPE_ALIAS: TYPE_ALIAS,
    parseFdfText, parseXfdfText, importFromFdf, importFromXfdf, _FDF_SUBTYPE: FDF_SUBTYPE,
    decodeImageXObject, extractApImage, _makeObjectResolver, resolvePdfAnnotations,
    extractApVector: (OS && OS.PdfContent && OS.PdfContent.extractApVector) ? OS.PdfContent.extractApVector : undefined
  };
  if (typeof module !== "undefined" && module.exports) module.exports = OS.PdfAnno;
})(typeof window !== "undefined" ? window : globalThis);
