/* ============================================================
   绿角犀 Office · 结构化文件导入 (OOXML / ODF / OFD)
   对应 PRD：3.1 兼容性矩阵 / 附录 A 数据模型
   - 用 DOMParser 解析 OOXML(docx/xlsx/pptx)、ODF(odt/ods/odp)、OFD(ofd 国标 GB/T 33190)
   - 保留标题层级、粗体/斜体/下划线、项目符号、表格、超链接、公式、版式坐标
   - 导入结果直接映射到 writer / spreadsheet / presentation 的 data 结构
   - OFD 为固定版式（类似 PDF），按页面映射到 Presentation 幻灯片（每页一张、文本按毫米坐标定位）
   - 兼容等级标记为 B（基本兼容，非像素级保真）
   依赖：JSZip（在线时由 index.html 注入；file:// 离线可用内存兜底）
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  /* ---------- 通用 XML/DOM 工具 ---------- */
  function parseXML(str) {
    const d = new DOMParser().parseFromString(str, "application/xml");
    if (d.querySelector("parsererror")) throw new Error("XML 解析失败");
    return d;
  }
  const all = (el, name) => el ? Array.from(el.getElementsByTagNameNS("*", name)) : [];
  const first = (el, name) => el ? el.getElementsByTagNameNS("*", name)[0] || null : null;
  // 聪明的 attr：先 getAttribute(name)，找不到再按 localName 遍历（处理 r:embed 等带 ns 前缀的属性）
  const attr = (el, name) => {
    if (!el) return null;
    let v = el.getAttribute(name);
    if (v != null) return v;
    for (const a of (el.attributes || [])) {
      if (a.localName === name) return a.value;
    }
    return null;
  };
  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, "&quot;");
  }
  function colToIdx(col) { // "AB" -> 28
    let n = 0; for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64); return n;
  }
  function refToRC(ref) { const m = /^([A-Z]+)(\d+)$/.exec(ref); return m ? { c: colToIdx(m[1]), r: +m[2] } : { c: 1, r: 1 }; }
  function isNum(v) { return v !== "" && v != null && !isNaN(+v); }

  /* ---------- DOCX 内嵌图片读回（drawing/blip r:embed → word/media → data URI）---------- */
  let IMG_EMBED = {};   // rId -> "data:image/...;base64,..."  ，每轮 parseDocx 重置
  function mimeFromPath(p) {
    const e = (p.split(".").pop() || "").toLowerCase();
    if (e === "jpg" || e === "jpeg") return "image/jpeg";
    if (e === "gif") return "image/gif";
    if (e === "webp") return "image/webp";
    if (e === "bmp") return "image/bmp";
    return "image/png";
  }
  function drawingToImg(node) {
    const blip = first(node, "blip");
    if (!blip) return "";
    const id = attr(blip, "r:embed");
    const uri = id && IMG_EMBED[id];
    return uri ? `<img src="${escAttr(uri)}" alt="导入图片">` : "";
  }
  // 预读 document.xml 中所有 blip 引用的媒体，转 data URI 缓存（zip 读字节为异步，故在 parseDocx 入口统一预取）
  async function prefetchDocxImages(d, rels, zip) {
    IMG_EMBED = {};
    const blips = all(d.documentElement, "blip");
    await Promise.all(blips.map(async bl => {
      const id = attr(bl, "r:embed");
      if (!id) return;
      const target = rels[id];
      if (!target) return;
      let p = target;
      if (p.charAt(0) === "/") p = p.slice(1);
      else if (p.indexOf("word/") !== 0) {
        p = p.replace(/^\.\//, "");
        if (p.indexOf("word/") !== 0) p = "word/" + p;
      }
      const f = zip.file(p);
      if (!f) return;
      try {
        const b64 = await f.async("base64");
        IMG_EMBED[id] = "data:" + mimeFromPath(p) + ";base64," + b64;
      } catch (e) { /* 读取失败优雅跳过，不阻断整篇导入 */ }
    }));
  }

  /* ============================================================
     DOCX -> Writer HTML
     ============================================================ */
  async function parseDocx(zip) {
    const docXml = await zip.file("word/document.xml").async("string");
    const relsXml = zip.file("word/_rels/document.xml.rels") ? await zip.file("word/_rels/document.xml.rels").async("string") : null;
    const rels = parseRels(relsXml);
    const numFmt = await buildNumbering(zip);
    const commentDefs = await parseComments(zip);
    const d = parseXML(docXml);
    await prefetchDocxImages(d, rels, zip);   // 预读内嵌图片到 IMG_EMBED，供 runToHtml 生成 <img>
    const body = first(d.documentElement, "body");
    if (!body) throw new Error("未找到文档正文");

    let html = "";
    let listBuf = null;
    const state = { stack: [], quotes: {} };
    const flushList = () => {
      if (listBuf) { html += `<${listBuf.type}>` + listBuf.items.map(i => `<li>${i}</li>`).join("") + `</${listBuf.type}>`; listBuf = null; }
    };

    for (const node of Array.from(body.children)) {
      const tag = node.localName;
      if (tag === "p") {
        const blk = blockFromP(node, rels, numFmt, state);
        if (blk.isList) {
          if (!listBuf || listBuf.type !== blk.listType) { flushList(); listBuf = { type: blk.listType, items: [] }; }
          listBuf.items.push(blk.inner);
        } else { flushList(); html += blk.outer; }
      } else if (tag === "tbl") { flushList(); html += tableToHtml(node, rels, state); }
    }
    flushList();

    /* ---------- 组装批注（优先用正文引用跨度取 quote）---------- */
    const comments = [];
    Object.keys(commentDefs.byId).map(Number).sort((a, b) => a - b).forEach(wid => {
      const def = commentDefs.byId[wid];
      if (def.parentId != null) return; // 回复在下方聚合
      const quote = (state.quotes[wid] != null && state.quotes[wid] !== "") ? state.quotes[wid] : def.firstLine;
      const replies = (commentDefs.repliesByParent[wid] || []).map(r => ({
        author: r.author || "我", text: r.text || "", createdAt: r.date ? (Date.parse(r.date) || Date.now()) : Date.now()
      }));
      comments.push({
        id: String(wid), quote: quote || "", author: def.author || "我",
        createdAt: def.date ? (Date.parse(def.date) || Date.now()) : Date.now(),
        resolved: !!def.done, replies
      });
    });

    return { type: "writer", data: { html: html || "<p>（空文档）</p>", comments }, compat: "B", note: "DOCX 已导入（基本兼容：标题/格式/列表/表格/链接/批注保留）" };
  }

  async function parseComments(zip) {
    const byId = {}; const repliesByParent = {};
    const f = zip.file("word/comments.xml");
    if (!f) return { byId, repliesByParent };
    const xml = await f.async("string");
    const d = parseXML(xml);
    all(d.documentElement, "comment").forEach(c => {
      const wid = attr(c, "w:id");
      const parentId = attr(c, "w:parentId");
      const author = attr(c, "w:author") || "我";
      const date = attr(c, "w:date") || null;
      const done = attr(c, "w:done") === "1" || attr(c, "w:done") === "true";
      let text = "";
      all(c, "t").forEach(t => { text += t.textContent; });
      if (parentId != null) {
        (repliesByParent[parentId] = repliesByParent[parentId] || []).push({ author, date, text });
      } else {
        byId[wid] = { author, date, done, firstLine: text };
      }
    });
    return { byId, repliesByParent };
  }

  function blockFromP(pEl, rels, numFmt, state) {
    const pPr = first(pEl, "pPr");
    let tag = "p", isList = false, listType = "ul";
    if (pPr) {
      const ps = first(pPr, "pStyle");
      if (ps) {
        const v = attr(ps, "w:val") || "";
        const m = /Heading(\d)/.exec(v);
        if (m) tag = "h" + m[1];
        else if (/^Title$/i.test(v)) tag = "h1";
        else if (/^Subtitle$/i.test(v)) tag = "h2";
      }
      const numPr = first(pPr, "numPr");
      if (numPr) {
        isList = true;
        const numId = attr(first(numPr, "numId"), "w:val");
        listType = (numId && numFmt[numId]) || "ul";
      }
    }
    const inner = runsToHtml(pEl, rels, state);
    // 段落结束关闭仍未闭合的批注跨度（跨段批注降级为单段闭合）
    let closeHtml = "";
    while (state.stack.length) { state.stack.pop(); closeHtml += "</span>"; }
    const fullInner = inner + closeHtml;
    if (isList) return { isList: true, listType, inner: fullInner };
    return { isList: false, outer: `<${tag}>${fullInner || "<br>"}</${tag}>` };
  }

  function runsToHtml(el, rels, state) {
    state = state || { stack: [], quotes: {} };
    let out = "";
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        const tv = n.nodeValue;
        if (tv) {
          if (state.stack.length) state.quotes[state.stack[state.stack.length - 1].wid] += tv;
          out += esc(tv);
        }
        continue;
      }
      const tag = n.localName;
      if (tag === "r") {
        if (first(n, "commentReference")) continue; // 跳过批注引用锚点（无可见文字）
        out += runToHtml(n);
        if (state.stack.length) state.quotes[state.stack[state.stack.length - 1].wid] += (n.textContent || "");
      }
      else if (tag === "hyperlink") out += hyperlinkToHtml(n, rels, state);
      else if (tag === "tab") out += "    ";
      else if (tag === "br") out += "<br>";
      else if (tag === "commentRangeStart") {
        const wid = attr(n, "w:id");
        state.stack.push({ wid: wid });
        if (state.quotes[wid] == null) state.quotes[wid] = "";
        out += '<span class="cmt" data-cid="' + wid + '">';
      }
      else if (tag === "commentRangeEnd") {
        out += "</span>";
        if (state.stack.length) state.stack.pop();
      }
      else out += runsToHtml(n, rels); // smartTag / ins / customXml 等容器
    }
    return out;
  }

  function runToHtml(rEl) {
    const rPr = first(rEl, "rPr");
    let txt = "";
    let imgHtml = "";
    for (const n of Array.from(rEl.childNodes)) {
      const t = n.localName;
      if (t === "t") txt += n.textContent;
      else if (t === "tab") txt += "    ";
      else if (t === "br") txt += "\n";
      else if (t === "noBreakHyphen") txt += "-";
      else if (t === "drawing") { const im = drawingToImg(n); if (im) imgHtml += im; }
    }
    txt = esc(txt).replace(/\n/g, "<br>");
    let s = txt;
    if (imgHtml) s += imgHtml;   // 内嵌图片不参与 esc，直接拼为 <img>
    if (rPr) {
      if (first(rPr, "b")) s = `<strong>${s}</strong>`;
      if (first(rPr, "i")) s = `<em>${s}</em>`;
      if (first(rPr, "u")) s = `<u>${s}</u>`;
      if (first(rPr, "strike")) s = `<s>${s}</s>`;
      const color = attr(first(rPr, "color"), "w:val");
      if (color && /^[0-9a-fA-F]{6}$/.test(color)) s = `<span style="color:#${color}">${s}</span>`;
    }
    return s;
  }

  function hyperlinkToHtml(hEl, rels, state) {
    const rid = attr(hEl, "r:id");
    const href = rels[rid] || "#";
    const inner = runsToHtml(hEl, rels, state);
    return `<a href="${escAttr(href)}">${inner}</a>`;
  }

  function tableToHtml(tblEl, rels, state) {
    const rows = all(tblEl, "tr").map(tr => {
      const tds = all(tr, "tc").map(tc => `<td>${runsToHtml(tc, rels, state)}</td>`).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    return `<table class="imp-table"><tbody>${rows}</tbody></table>`;
  }

  function parseRels(xml) {
    const map = {};
    if (!xml) return map;
    const d = parseXML(xml);
    all(d.documentElement, "Relationship").forEach(r => { map[attr(r, "Id")] = attr(r, "Target"); });
    return map;
  }

  async function buildNumbering(zip) {
    const map = {};
    const f = zip.file("word/numbering.xml");
    if (!f) return map;
    try {
      const d = parseXML(await f.async("string"));
      const abs = {};
      all(d.documentElement, "abstractNum").forEach(an => {
        const id = attr(an, "abstractNumId");
        const lvl = first(an, "lvl");
        abs[id] = lvl ? attr(first(lvl, "numFmt"), "w:val") : null;
      });
      all(d.documentElement, "num").forEach(n => {
        const numId = attr(n, "numId");
        const aid = first(n, "abstractNumId");
        const fmt = aid ? abs[attr(aid, "w:val")] : null;
        map[numId] = (fmt && /decimal|letter|roman/i.test(fmt)) ? "ol" : "ul";
      });
    } catch (e) { /* 忽略，列表默认 ul */ }
    return map;
  }

  /* ============================================================
     XLSX -> Spreadsheet cells
     ============================================================ */
  async function parseXlsx(zip) {
    let shared = [];
    const sf = zip.file("xl/sharedStrings.xml");
    if (sf) {
      const d = parseXML(await sf.async("string"));
      shared = all(d.documentElement, "si").map(si => all(si, "t").map(t => t.textContent).join(""));
    }
    // 仅导入第一个工作表（套件当前为单表模型）
    const sheetFile = zip.file("xl/worksheets/sheet1.xml") || firstZip(zip, "xl/worksheets/sheet");
    if (!sheetFile) throw new Error("未找到工作表");
    const d = parseXML(await sheetFile.async("string"));
    const cells = {};
    let maxC = 1, maxR = 1;
    all(d.documentElement, "c").forEach(c => {
      const ref = attr(c, "r"); if (!ref) return;
      const t = attr(c, "t");
      const f = first(c, "f");
      const v = first(c, "v");
      const is = first(c, "is");
      const { c: ci, r: ri } = refToRC(ref);
      maxC = Math.max(maxC, ci); maxR = Math.max(maxR, ri);
      if (f) {
        cells[ref] = { f: "=" + (f.textContent || "").trim() };
      } else {
        let val;
        if (t === "s") val = shared[+v.textContent] || "";
        else if (t === "inlineStr") val = is ? all(is, "t").map(x => x.textContent).join("") : "";
        else if (t === "str") val = v ? v.textContent : "";
        else if (t === "b") val = v && v.textContent === "1" ? "TRUE" : "FALSE";
        else val = v ? v.textContent : "";
        cells[ref] = { v: isNum(val) ? Number(val) : val };
      }
    });
    const note = Object.keys(cells).length
      ? "XLSX 已导入（基本兼容：值与公式保留；仅导入首个工作表）"
      : "XLSX 已导入（空表）";
    return { type: "spreadsheet", data: { rows: Math.max(maxR, 50), cols: Math.max(maxC, 16), cells, styles: {} }, compat: "B", note };
  }

  /* ============================================================
     PPTX -> Presentation slides
     ============================================================ */
  async function parsePptx(zip) {
    // 幻灯片尺寸（EMU → 像素）
    let sldW = 12192000, sldH = 6858000;
    let sldSzOrient = "land";
    const pres = zip.file("ppt/presentation.xml");
    if (pres) {
      const pd = parseXML(await pres.async("string"));
      const sz = first(pd.documentElement, "sldSz");
      if (sz) { sldW = +attr(sz, "cx") || sldW; sldH = +attr(sz, "cy") || sldH; }
      sldSzOrient = (attr(sz, "orient") || "land");
    }
    const isPort = sldSzOrient === "port";
    // 渲染画布尺寸（保持 16:9 比例不变形）
    const refW = isPort ? 427 : 760;
    const refH = isPort ? 760 : 427;
    const W = refW, H = refH;
    const fx = W / sldW, fy = H / sldH;

    // ========== 1. 预读所有 slide rels + 预取 ppt/media 图片转 data URI ==========
    const mediaMap = {};   // rId -> { path, dataUrl }
    const allRels = {};    // slidePath -> { rId -> target }
    const mediaFiles = Object.keys(zip.files).filter(n => /^ppt\/media\//.test(n));
    // 预读 media 文件
    await Promise.all(mediaFiles.map(async mp => {
      const u8 = await zip.file(mp).async("uint8array");
      let mime = "image/png";
      if (/\.(jpe?g|jpe)$/.test(mp)) mime = "image/jpeg";
      else if (/\.gif$/.test(mp)) mime = "image/gif";
      else if (/\.bmp$/.test(mp)) mime = "image/bmp";
      else if (/\.svg$/.test(mp)) mime = "image/svg+xml";
      else if (/\.webp$/.test(mp)) mime = "image/webp";
      else if (/\.mp3$/.test(mp)) mime = "audio/mpeg";
      else if (/\.mp4$/.test(mp)) mime = "video/mp4";
      // base64 编码
      let bin = "";
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      try { mediaMap[mp] = "data:" + mime + ";base64," + btoa(bin); } catch (e) { mediaMap[mp] = ""; }
    }));

    // 预读所有 slide _rels 关系
    const slideRels = Object.keys(zip.files).filter(n => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n)).sort();
    for (const rp of slideRels) {
      const relXml = await zip.file(rp).async("string");
      const slideName = rp.replace("ppt/slides/_rels/", "").replace(".rels", ""); // slide1.xml
      allRels[slideName] = parseRels(relXml);
    }

    // ========== 2. 读 slideMaster / slideLayout 的背景（用于继承回退） ==========
    let masterBg = "#ffffff";
    const sm = zip.file("ppt/slideMasters/slideMaster1.xml");
    if (sm) {
      const smd = parseXML(await sm.async("string"));
      const mbg = first(first(smd.documentElement, "bg"), "srgbClr");
      if (mbg) masterBg = "#" + attr(mbg, "val");
    }

    // ========== 3. 遍历每张 slide ==========
    const slideEntries = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (+/slide(\d+)/.exec(a)[1]) - (+/slide(\d+)/.exec(b)[1]));

    // 工具：从 rId 找 media base64
    function resolveMediaByRels(rels, rId) {
      if (!rels || !rId) return null;
      const target = rels[rId];
      if (!target) return null;
      // target 相对 slide：../media/image1.png -> ppt/media/image1.png
      const path = ("ppt/slides/" + target).replace(/ppt\/slides\/\.\.\//, "ppt/");
      const dataUrl = mediaMap[path];
      return dataUrl || null;
    }

    // 工具：从 <a:srgbClr> / <a:schemeClr> / <a:scrgbClr> 提取颜色
    function extractFillColor(fillNode) {
      if (!fillNode) return null;
      const srgb = first(fillNode, "srgbClr");
      if (srgb) return "#" + attr(srgb, "val");
      const scheme = first(fillNode, "schemeClr");
      if (scheme) {
        // 主题色：返回默认映射（简化处理）
        const map = {
          "bg1": "#ffffff", "tx1": "#000000",
          "bg2": "#f0f0f0", "tx2": "#333333",
          "accent1": "#4472c4", "accent2": "#ed7d31",
          "accent3": "#a5a5a5", "accent4": "#ffc000",
          "accent5": "#5b9bd5", "accent6": "#70ad47"
        };
        return map[attr(scheme, "val")] || "#888888";
      }
      return null;
    }

    // 工具：从 spPr 读取 shape 属性（shape type / fill / stroke / radius）
    function parseSpPr(spPr, parentXfrm) {
      const result = { shape: "rect", fill: null, stroke: null, strokeWidth: 0, radius: 0 };
      if (!spPr) return result;
      // 形状类型
      const geom = first(spPr, "prstGeom");
      if (geom) {
        const prst = attr(geom, "prst") || "rect";
        const shapeMap = {
          "rect": "rect", "roundRect": "rect", "ellipse": "ellipse",
          "line": "arrow", "chevron": "rect", "downArrow": "arrow", "upArrow": "arrow",
          "leftArrow": "arrow", "rightArrow": "arrow", "pentagon": "rect",
          "hexagon": "rect", "parallelogram": "rect", "trapezoid": "rect"
        };
        result.shape = shapeMap[prst] || "rect";
        // 圆角矩形的 adjust 值影响圆角半径（简化处理）
      }
      // 填充
      const solidFill = first(spPr, "solidFill");
      if (solidFill) result.fill = extractFillColor(solidFill);
      // 描边
      const ln = first(spPr, "ln");
      if (ln) {
        const lnFill = first(ln, "solidFill");
        result.stroke = extractFillColor(lnFill);
        const w = attr(ln, "w");
        if (w) result.strokeWidth = Math.round((+w) / 12700); // EMU -> pt -> px
      }
      return result;
    }

    // 工具：递归遍历 spTree 子元素，生成 elements 数组
    function walkSpTree(parent, rels, offX, offY, slideWEMU, slideHEMU) {
      const result = [];
      const kids = parent ? parent.children : [];
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        const ln = k.localName;
        if (ln === "sp") {
          const text = shapeText(k);
          const xfrm = first(k, "xfrm");
          const off = xfrm ? first(xfrm, "off") : null;
          const ext = xfrm ? first(xfrm, "ext") : null;
          // 跳过 background shape：覆盖整个 slide + 空文本
          if (off && ext && slideWEMU && slideHEMU) {
            const ox = +attr(off, "x"), oy = +attr(off, "y");
            const cx = +attr(ext, "cx"), cy = +attr(ext, "cy");
            if (ox === 0 && oy === 0 && cx === slideWEMU && cy === slideHEMU && !text) continue;
          }
          const x = off ? Math.round((+attr(off, "x") + offX) * fx) : 40;
          const y = off ? Math.round((+attr(off, "y") + offY) * fy) : 40;
          const w = ext ? Math.max(4, Math.round((+attr(ext, "cx")) * fx)) : 200;
          const h = ext ? Math.max(4, Math.round((+attr(ext, "cy")) * fy)) : 40;
          const { fontSize, color, bold } = runStyle(k);
          const spPr = first(k, "spPr");
          const geom = parseSpPr(spPr);
          if (text) {
            result.push({
              id: OS.util.uid("el"), type: "text", x, y, w, h,
              text, fontSize: fontSize || 14, color: color || "#111827", bold: !!bold,
              shape: geom.shape, fill: geom.fill, stroke: geom.stroke, strokeWidth: geom.strokeWidth
            });
          } else if (geom.fill || geom.stroke) {
            // 空文本但有填充色 → 是形状（如矩形、圆），也当 shape 输出
            result.push({
              id: OS.util.uid("el"), type: "shape", x, y, w, h,
              shape: geom.shape, fill: geom.fill || "#e0e7ff",
              stroke: geom.stroke, strokeWidth: geom.strokeWidth,
              text: "", fontSize: fontSize || 14, color: color || "#111827", bold: !!bold
            });
          }
        } else if (ln === "pic") {
          // 图片
          const nvPicPr = first(k, "nvPicPr");
          const xfrm = nvPicPr ? first(nvPicPr, "xfrm") : null;
          // 也可能在 blipFill 里
          let offExt = first(k, "xfrm");
          if (!offExt) offExt = nvPicPr ? first(nvPicPr, "xfrm") : null;
          const off = offExt ? first(offExt, "off") : null;
          const ext = offExt ? first(offExt, "ext") : null;
          const x = off ? Math.round((+attr(off, "x") + offX) * fx) : 40;
          const y = off ? Math.round((+attr(off, "y") + offY) * fy) : 40;
          const w = ext ? Math.max(4, Math.round((+attr(ext, "cx")) * fx)) : 200;
          const h = ext ? Math.max(4, Math.round((+attr(ext, "cy")) * fy)) : 100;
          const blip = first(k, "blip");
          const rId = blip ? attr(blip, "embed") : null;
          const dataUrl = resolveMediaByRels(rels, rId);
          if (dataUrl) {
            result.push({ id: OS.util.uid("el"), type: "image", x, y, w, h, src: dataUrl });
          }
        } else if (ln === "grpSp") {
          // 组合形状：递归遍历内部
          const grpSpPr = first(k, "grpSpPr");
          const xfrm = grpSpPr ? first(grpSpPr, "xfrm") : null;
          const off = xfrm ? first(xfrm, "off") : null;
          const gx = off ? (+attr(off, "x")) : 0;
          const gy = off ? (+attr(off, "y")) : 0;
          result.push(...walkSpTree(k, rels, offX + gx, offY + gy, slideWEMU, slideHEMU));
        } else if (ln === "cxnSp") {
          // 连接线 → arrow
          const xfrm = first(k, "xfrm");
          const off = xfrm ? first(xfrm, "off") : null;
          const ext = xfrm ? first(xfrm, "ext") : null;
          const x = off ? Math.round((+attr(off, "x") + offX) * fx) : 40;
          const y = off ? Math.round((+attr(off, "y") + offY) * fy) : 40;
          const w = ext ? Math.max(4, Math.round((+attr(ext, "cx")) * fx)) : 100;
          const h = ext ? Math.max(4, Math.round((+attr(ext, "cy")) * fy)) : 4;
          const spPr = first(k, "spPr");
          const geom = parseSpPr(spPr);
          result.push({
            id: OS.util.uid("el"), type: "shape", shape: "arrow",
            x, y, w, h, fill: "transparent",
            stroke: geom.stroke || "#111827", strokeWidth: geom.strokeWidth || 1,
            text: "", fontSize: 14, color: "#111827", bold: false
          });
        }
        // nvGrpSpPr / grpSpPr 等 prst 属性直接忽略
      }
      return result;
    }

    // ========== 4. 遍历每张 slide ==========
    const slides = [];
    for (const name of slideEntries) {
      const sd = parseXML(await zip.file(name).async("string"));
      const sld = first(sd.documentElement, "sld") || sd.documentElement;
      // 背景：slide 自己的 <p:bg> → masterBg → 默认白
      let bgColor = masterBg;
      const bgNode = first(sld, "bg");
      if (bgNode) {
        const solidBg = first(bgNode, "solidFill");
        const srgbBg = first(bgNode, "srgbClr");
        if (solidBg) {
          const c = extractFillColor(solidBg);
          if (c) bgColor = c;
        } else if (srgbBg) {
          bgColor = "#" + attr(srgbBg, "val");
        }
        // blipFill 图片背景跳过（简化）
      }

      // 取 slide 自己的 rels
      const relsKey = name.replace("ppt/slides/", ""); // slide1.xml
      const rels = allRels[relsKey] || {};

      // spTree（注意：PPTX 里 spTree 可能多层嵌套 <p:spTree><a:spTree>，需要取最深一层）
      let cSld = first(sld, "cSld");
      let spTree = cSld ? first(cSld, "spTree") : null;
      // 继续往里钻直到不再有 spTree
      while (spTree && first(spTree, "spTree")) {
        spTree = first(spTree, "spTree");
      }
      let elements = [];
      if (spTree) {
        elements = walkSpTree(spTree, rels, 0, 0, sldW, sldH);
      }
      // 过滤：跳过完全超出 slide 边界的元素（动画初始 off-screen 位置 / 布局溢出）
      // 有 50px 容差（允许部分超出但保留可见部分）
      const offScreenTol = 50;
      elements = elements.filter(el =>
        el.x + el.w > -offScreenTol &&
        el.y + el.h > -offScreenTol &&
        el.x < (W + offScreenTol) &&
        el.y < (H + offScreenTol)
      );

      // 演讲者备注（保留原逻辑）
      let notes = "";
      const relName = name.replace(/ppt\/slides\/(slide\d+\.xml)$/, "ppt/slides/_rels/$1.rels");
      const relFile = zip.file(relName);
      if (relFile) {
        const rd = parseXML(await relFile.async("string"));
        const rels2 = all(rd.documentElement, "Relationship");
        const nr = rels2.find(r => (attr(r, "Type") || "").endsWith("/notesSlide"));
        if (nr) {
          const tgt = attr(nr, "Target");
          const np = ("ppt/slides/" + tgt).replace(/ppt\/slides\/\.\.\//, "ppt/");
          const nf = zip.file(np);
          if (nf) {
            const nstr = await nf.async("string");
            const ms = nstr.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [];
            notes = ms.map(x => x.replace(/^<a:t>/, "").replace(/<\/a:t>$/, ""))
              .join("\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
          }
        }
      }

      slides.push({ bg: bgColor, elements, notes });
    }
    if (!slides.length) slides.push({ bg: "#ffffff", elements: [] });
    return { type: "presentation", data: { slides }, compat: "B", note: `PPTX 已导入 ${slides.length} 页（基础兼容：文本/图片/形状/位置/样式保留）` };
  }

  function shapeText(sp) {
    const body = first(sp, "txBody");
    if (!body) return null;
    const ps = all(body, "p");
    const parts = ps.map(p => all(p, "t").map(t => t.textContent).join("")).filter(s => s !== "" || true);
    // 段落间换行，空段保留为换行
    const text = parts.join("\n").replace(/\s+$/g, "");
    return text || null;
  }
  function runStyle(sp) {
    const rPr = first(first(sp, "txBody"), "rPr");
    if (!rPr) return {};
    const sz = attr(rPr, "sz");
    const fontSize = sz ? Math.round((+sz) / 100 * 1.333) : null; // hundredths of pt -> px
    const b = attr(rPr, "b") === "1" || first(rPr, "b");
    const clr = first(rPr, "srgbClr");
    const color = clr ? "#" + attr(clr, "val") : null;
    return { fontSize, color, bold: b };
  }

  /* ============================================================
     ODF (odt / ods / odp) -> 对应模块
     ============================================================ */
  async function parseOdf(ext, zip) {
    const content = zip.file("content.xml");
    if (!content) throw new Error("ODF 缺少 content.xml");
    const d = parseXML(await content.async("string"));
    const body = first(d.documentElement, "body");
    if (!body) throw new Error("ODF 缺少 body");

    // 样式表（用于加粗/对齐判定）
    const styleMap = await buildOdfStyles(zip);

    if (first(body, "text")) return parseOdt(first(body, "text"), styleMap);
    if (first(body, "spreadsheet")) return parseOds(first(body, "spreadsheet"), styleMap);
    if (first(body, "presentation")) return parseOdp(first(body, "presentation"), styleMap);
    throw new Error("无法识别的 ODF 类型");
  }

  async function buildOdfStyles(zip) {
    const map = { para: {}, text: {} }; // name -> {bold, align}
    const files = ["styles.xml", "content.xml"].map(n => zip.file(n)).filter(Boolean);
    for (const f of files) {
      let d; try { d = parseXML(await f.async("string")); } catch (e) { continue; }
      all(d.documentElement, "style").forEach(st => {
        const name = attr(st, "style:name");
        if (!name) return;
        const tp = attr(st, "style:family");
        const props = first(st, "text-properties");
        const pprops = first(st, "paragraph-properties");
        const entry = {};
        if (props) {
          if (/bold/i.test(attr(props, "fo:font-weight") || "")) entry.bold = true;
          if (/italic/i.test(attr(props, "fo:font-style") || "")) entry.italic = true;
        }
        if (pprops) {
          const al = attr(pprops, "fo:text-align");
          if (al) entry.align = al;
        }
        if (tp === "paragraph") map.para[name] = entry;
        else map.text[name] = entry;
      });
    }
    return map;
  }

  function parseOdt(textEl, styleMap) {
    let html = "";
    let listBuf = null;
    const flushList = () => { if (listBuf) { html += `<${listBuf.type}>` + listBuf.items.map(i => `<li>${i}</li>`).join("") + `</${listBuf.type}>`; listBuf = null; } };

    const handleP = (p, listType) => {
      const styleName = attr(p, "text:style-name");
      const st = styleMap.para[styleName] || {};
      let inner = odfInline(p, styleMap);
      const align = st.align ? ` style="text-align:${st.align}"` : "";
      if (listType) {
        if (!listBuf || listBuf.type !== listType) { flushList(); listBuf = { type: listType, items: [] }; }
        listBuf.items.push(inner);
      } else { flushList(); html += `<p${align}>${inner || "<br>"}</p>`; }
    };

    for (const node of Array.from(textEl.children)) {
      const tag = node.localName;
      if (tag === "h") {
        const lvl = Math.min(6, Math.max(1, +attr(node, "text:outline-level") || 1));
        flushList(); html += `<h${lvl}>${odfInline(node, styleMap) || "<br>"}</h${lvl}>`;
      } else if (tag === "p") {
        handleP(node, null);
      } else if (tag === "list") {
        const listType = /number|ordered/i.test(attr(node, "text:style-name") || "") ? "ol" : "ul";
        all(node, "list-item").forEach(li => {
          const p = first(li, "p");
          if (p) handleP(p, listType);
        });
      } else if (tag === "table") {
        flushList(); html += odfTable(node, styleMap);
      }
    }
    flushList();
    return { type: "writer", data: { html: html || "<p>（空文档）</p>" }, compat: "B", note: "ODT 已导入（基本兼容：标题/段落/列表/表格保留）" };
  }

  function odfInline(el, styleMap) {
    let out = "";
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { out += esc(n.nodeValue); continue; }
      const tag = n.localName;
      if (tag === "span") {
        const st = styleMap.text[attr(n, "text:style-name")] || {};
        let s = odfInline(n, styleMap);
        if (st.bold) s = `<strong>${s}</strong>`;
        if (st.italic) s = `<em>${s}</em>`;
        out += s;
      } else if (tag === "a") {
        out += `<a href="${escAttr(attr(n, "xlink:href") || "#")}">${odfInline(n, styleMap)}</a>`;
      } else if (tag === "line-break") out += "<br>";
      else if (tag === "tab") out += "    ";
      else out += odfInline(n, styleMap);
    }
    return out;
  }

  function odfTable(tbl, styleMap) {
    const rows = all(tbl, "table-row").map(tr => {
      const tds = all(tr, "table-cell").map(tc => {
        const rep = +attr(tc, "table:number-columns-repeated") || 1;
        const cell = `<td>${odfInline(tc, styleMap)}</td>`;
        return cell.repeat(rep);
      }).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    return `<table class="imp-table"><tbody>${rows}</tbody></table>`;
  }

  function parseOds(sheetEl, styleMap) {
    const table = first(sheetEl, "table") || sheetEl;
    const cells = {};
    let maxC = 1, maxR = 1;
    let r = 0;
    all(table, "table-row").forEach(row => {
      r++;
      let c = 0;
      all(row, "table-cell").forEach(td => {
        const rep = +attr(td, "table:number-columns-repeated") || 1;
        for (let k = 0; k < rep; k++) {
          c++;
          const vt = attr(td, "office:value-type");
          const val = vt === "string" ? all(td, "p").map(p => p.textContent).join("") : attr(td, "office:value");
          if (val !== undefined && val !== null && val !== "") {
            const ref = OS.FormulaEngine.idxToCol(c) + r;
            cells[ref] = { v: vt === "float" || vt === "percentage" || vt === "currency" ? Number(val) : val };
            maxC = Math.max(maxC, c); maxR = Math.max(maxR, r);
          }
        }
      });
    });
    return { type: "spreadsheet", data: { rows: Math.max(maxR, 50), cols: Math.max(maxC, 16), cells, styles: {} }, compat: "B", note: "ODS 已导入（基本兼容：单元格值与格式保留）" };
  }

  function parseOdp(presEl, styleMap) {
    const W = 760, H = 427;
    const cmToPx = W / 25.4; // 以 25.4cm 幻灯片宽近似映射到画布
    const slides = [];
    all(presEl, "page").forEach(page => {
      const bg = attr(page, "draw:background-color") || "#ffffff";
      const elements = [];
      all(page, "frame").forEach(fr => {
        const tb = first(fr, "text-box") || first(fr, "image");
        if (!tb) return;
        const text = all(tb, "p").map(p => all(p, "span").map(s => s.textContent).join("") || p.textContent).join("\n").trim();
        if (!text) return;
        const x = parseFloat(attr(fr, "svg:x")) || 1;
        const y = parseFloat(attr(fr, "svg:y")) || 1;
        const w = parseFloat(attr(fr, "svg:width")) || 5;
        const h = parseFloat(attr(fr, "svg:height")) || 3;
        elements.push({
          id: OS.util.uid("el"), type: "text",
          x: Math.round(x * cmToPx), y: Math.round(y * cmToPx),
          w: Math.max(40, Math.round(w * cmToPx)), h: Math.max(30, Math.round(h * cmToPx)),
          text, fontSize: 24, color: "#111827", bold: false
        });
      });
      slides.push({ bg, elements });
    });
    if (!slides.length) slides.push({ bg: "#ffffff", elements: [] });
    return { type: "presentation", data: { slides }, compat: "B", note: `ODP 已导入 ${slides.length} 页（基本兼容：文本/位置保留）` };
  }

  function firstZip(zip, prefix) {
    const name = Object.keys(zip.files).find(n => n.indexOf(prefix) === 0 && n.endsWith(".xml"));
    return name ? zip.file(name) : null;
  }

  /* ============================================================
     OFD (国标 GB/T 33190) -> Presentation 幻灯片
     - 包结构：OFD.xml -> Doc_N/Document.xml -> Pages/Page_N/Content.xml
     - 坐标系：原点页面左上角，X 右正 Y 下正，单位 mm（毫米）
     - 文本：<TextObject Boundary="x y w h"> -> <TextCode>文本内容</TextCode>
     ============================================================ */
  async function parseOfd(zip) {
    const W = 760, H = 427; // 演示画布尺寸（与 presentation.js 对齐）

    // 1) 主入口 OFD.xml -> DocRoot
    const ofdFile = zip.file("OFD.xml") || firstZip(zip, "OFD.xml");
    let docRoot = "Doc_0/Document.xml";
    if (ofdFile) {
      const od = parseXML(await ofdFile.async("string"));
      const dr = first(od.documentElement, "DocRoot");
      if (dr && dr.textContent.trim()) docRoot = dr.textContent.trim();
    }
    // docDir = DocRoot 所在目录（去掉文件名）
    const docDir = docRoot.replace(/[^/]+$/, "");
    const docFile = zip.file(docRoot) || zip.file(docDir + (docRoot.split("/").pop()));
    if (!docFile) throw new Error("OFD 缺少 Document.xml");

    const dd = parseXML(await docFile.async("string"));

    // 2) 文档默认页面尺寸（PhysicalBox，单位 mm）
    let pageW = 210, pageH = 297;
    const docBox = first(dd.documentElement, "PhysicalBox");
    if (docBox) { const b = (docBox.textContent || "").trim().split(/\s+/).map(Number); if (b.length === 4 && b[2] > 0 && b[3] > 0) { pageW = b[2]; pageH = b[3]; } }

    // 3) 页面列表（Page 的 BaseLoc 相对文档目录）
    const pages = all(dd.documentElement, "Page").map(p => {
      const bl = attr(p, "BaseLoc") || "";
      return bl ? (docDir + bl) : null;
    }).filter(Boolean);

    if (!pages.length) throw new Error("OFD 未找到页面");

    // 等比缩放，居中（letterbox），保持版式比例
    const scale = Math.min(W / pageW, H / pageH);
    const offX = (W - pageW * scale) / 2;
    const offY = (H - pageH * scale) / 2;
    const mm = v => (parseFloat(v) || 0) * scale;
    const toPxX = m => Math.round(offX + mm(m));
    const toPxY = m => Math.round(offY + mm(m));

    const slides = [];
    for (const path of pages) {
      const pf = zip.file(path);
      if (!pf) continue;
      const cd = parseXML(await pf.async("string"));
      // 单页尺寸优先于文档默认
      let pw = pageW, ph = pageH;
      const pageBox = first(cd.documentElement, "PhysicalBox");
      if (pageBox) { const b = (pageBox.textContent || "").trim().split(/\s+/).map(Number); if (b.length === 4 && b[2] > 0 && b[3] > 0) { pw = b[2]; ph = b[3]; } }
      const sc = pw === pageW && ph === pageH ? scale : Math.min(W / pw, H / ph);
      const ox = (W - pw * sc) / 2, oy = (H - ph * sc) / 2;

      const elements = [];
      all(cd.documentElement, "TextObject").forEach(to => {
        const bnd = (attr(to, "Boundary") || "0 0 20 10").trim().split(/\s+/).map(Number);
        const x = bnd[0] || 0, y = bnd[1] || 0, w = bnd[2] || 50, h = bnd[3] || 10;
        // TextCode 文本（可能多个，换行拼接）
        const texts = all(to, "TextCode").map(tc => (tc.textContent || "").replace(/\s+$/g, "")).filter(Boolean);
        const text = texts.join("\n");
        if (!text) return;
        const sizeMM = parseFloat(attr(to, "Size")) || 3.5; // OFD 字号单位 mm
        const weight = parseFloat(attr(to, "Weight"));
        const bold = (!isNaN(weight) && weight >= 0.4) || attr(to, "Bold") === "true";
        const italic = attr(to, "Italic") === "true";
        elements.push({
          id: OS.util.uid("el"), type: "text",
          x: Math.round(ox + x * sc), y: Math.round(oy + y * sc),
          w: Math.max(40, Math.round(w * sc)), h: Math.max(20, Math.round(h * sc)),
          text, fontSize: Math.max(10, Math.round(sizeMM * sc)), color: "#111827", bold: !!bold, italic: !!italic
        });
      });
      slides.push({ bg: "#ffffff", elements });
    }
    if (!slides.length) slides.push({ bg: "#ffffff", elements: [] });
    return { type: "presentation", data: { slides }, compat: "B", note: `OFD 已导入 ${slides.length} 页（基本兼容：文本按版式坐标定位；图形/图片为后续项）` };
  }

  /* ============================================================
     XMind（.xmind）→ mindmap 数据结构
     现代格式(zip 内 content.json)，旧版 XMind 8(zip 内 content.xml)
     ============================================================ */
  let _xmNodeId = 0;
  function xmUid() { return "xm_" + (++_xmNodeId) + "_" + Math.random().toString(36).slice(2, 8); }
  // JSON 格式（XMind 2020+）
  function xmJsonToNodes(rootTopic, nodes, parentId, depth) {
    if (!rootTopic) return;
    const id = xmUid();
    const text = (rootTopic.title || rootTopic.text || "").trim() || "未命名主题";
    const node = {
      id, x: 0, y: 0, text,
      color: depth === 0 ? "#1e3a5f" : "#2563eb",
      shape: "rounded", fontSize: depth === 0 ? 16 : 14,
      parent: parentId, isRoot: depth === 0
    };
    nodes.push(node);
    const children = (rootTopic.children && rootTopic.children.attached) || rootTopic.children || [];
    if (Array.isArray(children)) {
      children.forEach(ch => xmJsonToNodes(ch, nodes, id, depth + 1));
    }
  }
  // XML 格式（XMind 8）
  function xmXmlTopicToNode(el, nodes, parentId, depth) {
    const t = el.getElementsByTagName("title");
    const text = ((t && t[0] && t[0].textContent) || el.getAttribute("title") || "未命名主题").trim();
    const id = el.getAttribute("id") || xmUid();
    // 确保唯一（XMind 8 里 topic id 已唯一，但多 sheet 间不保证）
    const node = {
      id, x: 0, y: 0, text,
      color: depth === 0 ? "#1e3a5f" : "#2563eb",
      shape: "rounded", fontSize: depth === 0 ? 16 : 14,
      parent: parentId, isRoot: depth === 0
    };
    nodes.push(node);
    // 递归找子 topic
    const allChildren = el.getElementsByTagName("children");
    for (let i = 0; i < allChildren.length; i++) {
      const topicsList = allChildren[i].getElementsByTagName("topics");
      for (let j = 0; j < topicsList.length; j++) {
        const childTopics = topicsList[j].getElementsByTagName("topic");
        for (let k = 0; k < childTopics.length; k++) {
          // 只处理直接子节点（避免重复拿后代）
          const parentCheck = childTopics[k].parentElement;
          if (parentCheck && parentCheck.tagName.toLowerCase() === "topics") {
            xmXmlTopicToNode(childTopics[k], nodes, id, depth + 1);
          }
        }
      }
    }
  }
  async function parseXmind(zip) {
    const jf = zip.file("content.json");
    const xf = zip.file("content.xml");
    const nodes = [];
    let rootId = null;
    if (jf) {
      const root = JSON.parse(await jf.async("string"));
      const sheets = Array.isArray(root) ? root
        : (root && root.sheet ? root.sheet : null);
      const list = sheets || [{ title: (root && root.title) || "思维导图", rootTopic: root && root.rootTopic }];
      // 只取第一个 sheet 的第一个 rootTopic 作为根
      const firstSheet = Array.isArray(list) ? list[0] : list;
      const rt = firstSheet && firstSheet.rootTopic;
      if (rt) {
        const rootJsonId = xmUid();
        nodes.push({ id: rootJsonId, x: 0, y: 0, text: (rt.title || "中心主题").trim(), color: "#1e3a5f", shape: "rounded", fontSize: 16, parent: null, isRoot: true });
        rootId = rootJsonId;
        const children = (rt.children && rt.children.attached) || rt.children || [];
        if (Array.isArray(children)) children.forEach(ch => xmJsonToNodes(ch, nodes, rootJsonId, 1));
      }
    } else if (xf) {
      const doc = parseXML(await xf.async("string"));
      const sheets = doc.getElementsByTagName("sheet");
      if (sheets && sheets.length) {
        const firstSheet = sheets[0];
        // 直接子 topic（根节点）
        const childTopics = firstSheet.getElementsByTagName("topic");
        if (childTopics && childTopics.length) {
          // 拿第一个（XML 里 topic 可能嵌套，先找直接挂在 sheet 下的）
          let rootTopic = null;
          for (let i = 0; i < childTopics.length; i++) {
            const parent = childTopics[i].parentElement;
            if (parent && parent.tagName.toLowerCase() === "sheet") { rootTopic = childTopics[i]; break; }
          }
          if (!rootTopic) rootTopic = childTopics[0];
          if (rootTopic) {
            xmXmlTopicToNode(rootTopic, nodes, null, 0);
            rootId = nodes[0].id;
          }
        }
      }
    }
    if (!nodes.length) throw new Error("无法解析的 XMind 文件（缺少 content.json / content.xml）");
    return { type: "mindmap", data: { mode: "map", nodes, edges: [], rootId }, compat: "B", note: `XMind 已导入（${nodes.length} 个节点，仅首个 sheet）` };
  }

  /* ============================================================
     入口
     ============================================================ */
  /* ============================================================
     BIFF8 .xls (旧版 Excel 二进制) — 用 SheetJS 解析
     ============================================================ */
  function parseXls(buf) {
    if (!global.XLSX) throw new Error("未加载 SheetJS（xlsx）库");
    const wb = global.XLSX.read(buf, { type: "array", cellFormula: true, cellText: false, cellDates: false });
    const sheetName = wb.SheetNames[0] || "Sheet1";
    const ws = wb.Sheets[sheetName];
    if (!ws) throw new Error("XLS 工作簿为空");
    // 用 sheet_to_json 拉二维数组（含公式）
    const rows = global.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    const cells = {};
    let maxR = rows.length, maxC = 0;
    rows.forEach((row, ri) => {
      row.forEach((val, ci) => {
        const ref = global.XLSX.utils.encode_cell({ r: ri, c: ci });
        maxC = Math.max(maxC, ci + 1);
        if (val === null || val === undefined || val === "") return;
        if (typeof val === "string" && val.startsWith("=")) {
          cells[ref] = { f: val };
        } else {
          cells[ref] = { v: typeof val === "number" ? val : String(val) };
        }
      });
    });
    const note = "XLS 已导入（基本兼容：值与公式保留；仅导入首个工作表）";
    return { type: "spreadsheet", data: { rows: Math.max(maxR, 50), cols: Math.max(maxC, 16), cells, styles: {} }, compat: "B", note };
  }

  /* ============================================================
     入口
     ============================================================ */
  async function importFile(file, onProgress) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const buf = new Uint8Array(await file.arrayBuffer());
    if (onProgress) onProgress("读取文件字节", 0.2);
    // .xls 是 BIFF8 二进制，不走 JSZip，直接 SheetJS 解析
    if (ext === "xls") {
      if (!global.XLSX) throw new Error("需加载 SheetJS 解析库");
      if (onProgress) onProgress("解析旧版 Excel (.xls)", 0.7);
      const r = parseXls(buf);
      if (onProgress) onProgress("构建文档模型", 0.95);
      return r;
    }
    // 其他格式（docx/xlsx/pptx/odt/ods/odp/ofd/xmind）都是 ZIP 容器
    if (!global.JSZip) throw new Error("需加载 JSZip 解析库");
    const zip = await global.JSZip.loadAsync(buf.buffer);
    if (onProgress) onProgress("解压包结构", 0.5);
    let r;
    switch (ext) {
      case "docx": if (onProgress) onProgress("解析 Word 文档", 0.7); r = parseDocx(zip); break;
      case "xlsx": if (onProgress) onProgress("解析工作簿", 0.7); r = parseXlsx(zip); break;
      case "pptx": if (onProgress) onProgress("解析演示文稿", 0.7); r = parsePptx(zip); break;
      case "odt":
      case "ods":
      case "odp": if (onProgress) onProgress("解析 ODF 文档", 0.7); r = parseOdf(ext, zip); break;
      case "ofd": if (onProgress) onProgress("解析 OFD 版式文件", 0.7); r = parseOfd(zip); break;
      case "xmind": if (onProgress) onProgress("解析思维导图 XMind", 0.7); r = parseXmind(zip); break;
      default: r = null;
    }
    if (onProgress) onProgress("构建文档模型", 0.95);
    return r;
  }

  OS.Importer = { importFile, parseDocx, parseXmind };
  if (OS.util && OS.util.log) OS.util.log("Importer(OOML/ODF) ready");
})(window);
