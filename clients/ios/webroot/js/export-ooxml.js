/* ============================================================
   绿角犀 Office · 原生文件导出 (OOXML / OFD)
   对应 PRD：3.1 兼容性矩阵（反向，实现导入后原生存回）
   - 不依赖任何 CDN 转换库；直接用 JSZip 打包规范 XML
   - writer        → DOCX (wordprocessingml)
   - spreadsheet    → XLSX (spreadsheetml，值 + 公式)
   - presentation   → PPTX (presentationml，多页 + 几何 + 样式)
   - presentation / writer → OFD (GB/T 33190 国标版式)
   - 导出可直接被本套件 OS.Importer 再导入（往返闭环）
   依赖：JSZip（与导入共用，由 index.html 注入）
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});
  OS.Exporter = OS.Exporter || {};

  const X = {
    ct: "http://schemas.openxmlformats.org/package/2006/content-types",
    rel: "http://schemas.openxmlformats.org/package/2006/relationships",
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  };
  const OFD_NS = "http://www.ofdspec.org/2016";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function colIdx(col) {
    let n = 0;
    for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }
  function colName(n) { let s = ""; n = n - 1; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; }

  /* ---------- 原生图表（OOXML chart）---------- */
  const C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  function isTextVal(v) { if (v == null) return false; const s = String(v); if (s === "") return false; if (/^[\d.\-+eE]+$/.test(s) && !isNaN(Number(s))) return false; return true; }
  function cellVal(cells, ref) {
    const c = cells[ref]; if (!c) return "";
    if (c.f != null && c.f !== "") { if (OS.FormulaEngine) { try { return OS.FormulaEngine.run(c.f, r => cellVal(cells, r)); } catch (e) {} } return c.v == null ? "" : c.v; }
    return c.v == null ? "" : c.v;
  }
  function parseRange(s) {
    const parts = String(s).split(":");
    const p = r => { const m = /^([A-Z]+)(\d+)$/.exec(r.trim()); return m ? { col: m[1], row: +m[2] } : { col: "A", row: 1 }; };
    const A = p(parts[0]), B = p(parts[1] || parts[0]);
    const c1 = colIdx(A.col), c2 = colIdx(B.col), r1 = Math.min(A.row, B.row), r2 = Math.max(A.row, B.row);
    return { c1, c2, r1, r2 };
  }
  // 生成单个 chart 部件 XML（引用单元格区域，可被 Excel 实时计算）
  function buildChartXml(spec, sheetName, cells) {
    const rg = parseRange(spec.range);
    const { c1, c2, r1, r2 } = rg;
    const colLooksText = (col) => { for (let r = r1; r <= r2; r++) if (isTextVal(cellVal(cells, colName(col) + r))) return true; return false; };
    const catCol = (c2 > c1 && colLooksText(c1)) ? c1 : null;
    const sC1 = catCol ? c1 + 1 : c1;
    let headerRow = null;
    if (r2 > r1) {
      let topText = 0, botNum = 0; const total = c2 - sC1 + 1;
      for (let c = sC1; c <= c2; c++) { const col = colName(c); if (isTextVal(cellVal(cells, col + r1))) topText++; const bv = cellVal(cells, col + r2); if (bv !== "" && !isNaN(Number(bv))) botNum++; }
      if (total > 0 && topText >= Math.ceil(total / 2) && botNum >= Math.ceil(total / 2)) headerRow = r1;
    }
    const dR1 = headerRow != null ? r1 + 1 : r1;
    const SN = sheetName;
    const catRef = catCol != null ? SN + "!$" + colName(catCol) + "$" + dR1 + ":$" + colName(catCol) + "$" + r2 : null;
    const series = [];
    for (let c = sC1; c <= c2; c++) {
      const col = colName(c);
      const name = headerRow != null ? String(cellVal(cells, col + r1)) : "";
      const nameRef = headerRow != null ? SN + "!$" + col + "$" + r1 : null;
      const valRef = SN + "!$" + col + "$" + dR1 + ":$" + col + "$" + r2;
      const vals = []; for (let r = dR1; r <= r2; r++) { const v = cellVal(cells, col + r); vals.push((v === "" || isNaN(Number(v))) ? 0 : Number(v)); }
      const cats = catCol != null ? (() => { const a = []; for (let r = dR1; r <= r2; r++) a.push(String(cellVal(cells, colName(catCol) + r))); return a; })() : null;
      series.push({ name, nameRef, valRef, vals, cats, idx: c - sC1 });
    }
    const type = spec.type || "bar";
    const axIdCat = 111, axIdVal = 222;
    function strRef(ref, cacheVals) {
      let cache = "";
      if (cacheVals) { cache = "<c:strCache><c:ptCount val=\"" + cacheVals.length + "\"/>"; cacheVals.forEach((v, i) => { cache += "<c:pt idx=\"" + i + "\"><c:v>" + esc(v) + "</c:v></c:pt>"; }); cache += "</c:strCache>"; }
      return "<c:strRef><c:f>" + esc(ref) + "</c:f>" + cache + "</c:strRef>";
    }
    function numRef(ref, cacheVals) {
      let cache = "";
      if (cacheVals) { cache = "<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val=\"" + cacheVals.length + "\"/>"; cacheVals.forEach((v, i) => { cache += "<c:pt idx=\"" + i + "\"><c:v>" + (typeof v === "number" ? v : esc(v)) + "</c:v></c:pt>"; }); cache += "</c:numCache>"; }
      return "<c:numRef><c:f>" + esc(ref) + "</c:f>" + cache + "</c:numRef>";
    }
    let serXml = "";
    series.forEach((s, i) => {
      const txPart = s.nameRef ? ("<c:tx>" + strRef(s.nameRef, [s.name]) + "</c:tx>") : ("<c:tx><c:v>" + esc(s.name || ("系列" + (i + 1))) + "</c:v></c:tx>");
      const catPart = catRef ? ("<c:cat>" + strRef(catRef, s.cats) + "</c:cat>") : "";
      serXml += "<c:ser><c:idx val=\"" + i + "\"/><c:order val=\"" + i + "\"/>" + txPart + catPart +
        "<c:val>" + numRef(s.valRef, s.vals) + "</c:val></c:ser>";
    });
    const titleXml = "<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang=\"zh-CN\"/><a:t>" + esc(spec.title || "图表") + "</a:t></a:r></a:p></c:rich></c:tx><c:overlay val=\"0\"/></c:title>";
    let plot;
    if (type === "line") plot = "<c:lineChart><c:grouping val=\"standard\"/>" + serXml + "<c:axId val=\"" + axIdCat + "\"/><c:axId val=\"" + axIdVal + "\"/></c:lineChart>";
    else if (type === "pie") plot = "<c:pieChart>" + serXml + "</c:pieChart>";
    else plot = "<c:barChart><c:barDir val=\"col\"/><c:grouping val=\"clustered\"/>" + serXml + "<c:axId val=\"" + axIdCat + "\"/><c:axId val=\"" + axIdVal + "\"/></c:barChart>";
    let axes = "";
    if (type !== "pie") {
      axes = "<c:catAx><c:axId val=\"" + axIdCat + "\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"b\"/><c:crossAx val=\"" + axIdVal + "\"/></c:catAx>" +
        "<c:valAx><c:axId val=\"" + axIdVal + "\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"l\"/><c:crossAx val=\"" + axIdCat + "\"/></c:valAx>";
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<c:chartSpace xmlns:c="' + C_NS + '" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:chart><c:autoTitleDeleted val="0"/>' + titleXml + '<c:plotArea><c:layout/>' + plot + axes + '</c:plotArea>' +
      '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>';
  }
  // 为图表集合生成 XLSX 用的 drawing + chart 部件
  function buildChartPartsForXlsx(charts, sheetName, cells, startRow, EMU, prefix) {
    const chartFiles = {}, drawingRels = [];
    let anchors = "";
    charts.forEach((spec, i) => {
      const N = (prefix ? prefix + "_" : "") + (i + 1);
      chartFiles["xl/charts/chart" + N + ".xml"] = buildChartXml(spec, sheetName, cells);
      const fromRow = startRow + i * 20, toRow = fromRow + 18;
      const emuTop = fromRow * EMU * 15, emuLeft = 1 * EMU * 15, emuW = 9 * EMU * 15 * 6.7, emuH = 18 * EMU * 15;
      anchors += '<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + fromRow + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
        '<xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + toRow + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
        '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (100 + i + 1) + '" name="Chart ' + N + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
        '<xdr:graphicFrameLocks noChangeAspect="1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
        '<c:chart xmlns:c="' + C_NS + '" r:id="rId' + N + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
      drawingRels.push('<Relationship Id="rId' + N + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + N + '.xml"/>');
    });
    const drawingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="' + C_NS + '">' +
      anchors + '</xdr:wsDr>';
    const drawingRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + X.rel + '">' + drawingRels.join("") + '</Relationships>';
    return { chartFiles, drawingXml, drawingRelsXml };
  }

  /* ---------- 批注附录：正文 body 末尾附言（仅当 hasComments）---------- */
  function buildCommentsAppendix(comments, X) {
    function fmtTime(t) {
      const d = new Date(t);
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    let out = '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">批注附录</w:t></w:r></w:p>';
    out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="C9D2DD"/></w:pBdr></w:pPr></w:p>';
    comments.forEach(c => {
      out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="6" w:color="D8E0EA"/></w:pBdr></w:pPr>';
      out += '<w:r><w:rPr><w:i/><w:color w:val="5B4A00"/></w:rPr><w:t xml:space="preserve">“' + esc(c.quote || "") + '”</w:t></w:r></w:p>';
      out += '<w:p><w:r><w:rPr><w:color w:val="6B7A8D"/></w:rPr><w:t xml:space="preserve">' + esc(c.author || "我") + ' · ' + fmtTime(c.createdAt) + (c.resolved ? " · 已解决" : " · 待处理") + '</w:t></w:r></w:p>';
      (c.replies || []).forEach(r => {
        out += '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">' + esc(r.author || "") + '：</w:t></w:r>' +
          '<w:r><w:t xml:space="preserve">' + esc(r.text || "") + '</w:t></w:r></w:p>';
      });
    });
    return out;
  }

  /* ============================================================
     DOCX
     ============================================================ */
  function buildDocx(doc) {
    const JSZip = global.JSZip;
    const zip = new JSZip();
    const html = (doc.data && doc.data.html) || "";
    const root = new global.DOMParser().parseFromString(html, "text/html").body;

    const hyperlinks = [];
    const hlinkMap = {};
    function addHyperlink(url) {
      if (hlinkMap[url] != null) return "rId" + (100 + hlinkMap[url]);
      const id = hyperlinks.length;
      hlinkMap[url] = id;
      hyperlinks.push(url);
      return "rId" + (100 + id);
    }

    /* ---------- 图片嵌入（data: URI → word/media + drawing run）---------- */
    // 应用内插入的图片均为 base64 内联（OS.util.readFile(f,true) 走 readAsDataURL），
    // 故导出仅需处理 data: URI；blob:/http(s) 等外部引用无法在同步构建期嵌入，优雅跳过（留空 run）。
    const images = [];
    const imgCtypes = {};
    const imgCache = {};
    function b64ToBytes(b64) {
      const bin = (global.atob || atob)(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }
    function bytesToB64(bytes) {
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return (global.btoa || btoa)(bin);
    }
    function imageDims(b) {
      try {
        if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { // PNG
          const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
          const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
          return { w: w >>> 0, h: h >>> 0 };
        }
        if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) { // JPEG
          let i = 2;
          while (i < b.length - 9) {
            if (b[i] !== 0xff) { i++; continue; }
            const marker = b[i + 1];
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
              const h = (b[i + 5] << 8) | b[i + 6];
              const w = (b[i + 7] << 8) | b[i + 8];
              return { w, h };
            }
            const len = (b[i + 2] << 8) | b[i + 3];
            i += 2 + (len || 0);
          }
        }
        if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) { // GIF
          const w = b[6] | (b[7] << 8);
          const h = b[8] | (b[9] << 8);
          return { w, h };
        }
      } catch (e) {}
      return { w: 600, h: 400 };
    }
    function addImage(src) {
      if (!src || !/^data:/.test(src)) return null;
      if (imgCache[src]) return imgCache[src];
      const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
      if (!m) return null;
      const mime = m[1]; const isB64 = !!m[2];
      let bytes;
      try {
        if (isB64) bytes = b64ToBytes(m[3]);
        else bytes = new Uint8Array(Array.from(decodeURIComponent(m[3])).map(c => c.charCodeAt(0) & 0xff));
      } catch (e) { return null; }
      if (!bytes || !bytes.length) return null;
      let ext = "png", ctype = "image/png";
      if (/png/i.test(mime)) { ext = "png"; ctype = "image/png"; }
      else if (/jpe?g/i.test(mime)) { ext = "jpg"; ctype = "image/jpeg"; }
      else if (/gif/i.test(mime)) { ext = "gif"; ctype = "image/gif"; }
      else if (/webp/i.test(mime)) { ext = "webp"; ctype = "image/webp"; }
      else if (/bmp/i.test(mime)) { ext = "bmp"; ctype = "image/bmp"; }
      const dims = imageDims(bytes);
      const idx = images.length;
      const b64 = bytesToB64(bytes);
      const info = { rid: "rId" + (50 + idx), fname: "media/image" + (idx + 1) + "." + ext, ctype, b64, w: dims.w, h: dims.h, idx };
      images.push(info);
      imgCtypes[ext] = ctype;
      imgCache[src] = info;
      return info;
    }
    function drawingRun(info) {
      const cx = Math.max(1, Math.round(info.w * 9525));
      const cy = Math.max(1, Math.round(info.h * 9525));
      const id = info.idx + 1;
      const ext = info.fname.slice(info.fname.lastIndexOf(".") + 1);
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
        '<wp:docPr id="' + id + '" name="Picture ' + id + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="' + X.a + '" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic xmlns:a="' + X.a + '"><a:graphicData uri="' + X.a.replace("/main", "/picture") + '">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="image' + id + '.' + ext + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + info.rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r>';
    }

    /* ---------- 批注（Writer 评论）---------- */
    const comments = (doc.data && doc.data.comments) || [];
    const hasComments = comments.length > 0;
    const cidToWid = {};
    (function () {
      let rid = 0;
      comments.forEach(c => { rid++; cidToWid[c.id] = rid; rid += (c.replies || []).length; });
    })();

    function propsToRPr(p) {
      const r = [];
      if (p.b) r.push("<w:b/>");
      if (p.i) r.push("<w:i/>");
      if (p.u) r.push('<w:u w:val="single"/>');
      if (p.hlink) r.push('<w:rStyle w:val="Hyperlink"/>');
      if (p.color) r.push('<w:color w:val="' + esc(p.color.replace(/^#/, "")) + '"/>');
      if (p.sz) r.push('<w:sz w:val="' + p.sz + '"/>');
      return r.length ? "<w:rPr>" + r.join("") + "</w:rPr>" : "";
    }
    function mergeProps(props, node) {
      const np = Object.assign({}, props);
      const tag = node.localName;
      if (tag === "b" || tag === "strong") np.b = true;
      if (tag === "i" || tag === "em") np.i = true;
      if (tag === "u") np.u = true;
      if (tag === "a") np.hlink = true;
      const st = node.getAttribute && node.getAttribute("style");
      if (st) {
        const m = {};
        st.split(";").forEach(d => { const i = d.indexOf(":"); if (i > 0) m[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); });
        if (/bold/i.test(m["font-weight"] || "")) np.b = true;
        if (/italic/i.test(m["font-style"] || "")) np.i = true;
        if (/underline/i.test(m["text-decoration"] || "")) np.u = true;
        if (m["color"]) np.color = m["color"].replace(/^#/, "");
        if (m["font-size"]) { const px = /([\d.]+)px/.exec(m["font-size"]); if (px) np.sz = Math.round(parseFloat(px[1]) * 2); }
      }
      return np;
    }
    function inlines(node, props) {
      let out = "";
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const t = child.nodeValue;
          if (t) out += "<w:r>" + propsToRPr(props) + '<w:t xml:space="preserve">' + esc(t) + "</w:t></w:r>";
        } else if (child.nodeType === 1) {
          const tag = child.localName;
          if (tag === "br") out += "<w:r>" + propsToRPr(props) + "<w:br/></w:r>";
          else if (tag === "img") { const info = addImage(child.getAttribute("src") || ""); if (info) out += drawingRun(info); }
          else if (tag === "a") {
            const url = child.getAttribute("href") || "#";
            const rid = addHyperlink(url);
            out += '<w:hyperlink r:id="' + rid + '">' + inlines(child, mergeProps(props, child)) + "</w:hyperlink>";
          }
          else if (tag === "span") {
            const cls = (child.getAttribute && child.getAttribute("class")) || "";
            const cid = child.getAttribute && child.getAttribute("data-cid");
            const wid = (cid != null && cidToWid[cid] != null) ? cidToWid[cid] : null;
            if (wid != null) {
              out += '<w:commentRangeStart w:id="' + wid + '"/>';
              out += inlines(child, mergeProps(props, child));
              out += '<w:commentRangeEnd w:id="' + wid + '"/>';
              out += '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="' + wid + '"/></w:r>';
            } else {
              out += inlines(child, mergeProps(props, child));
            }
          }
          else out += inlines(child, mergeProps(props, child));
        }
      }
      return out;
    }
    function tableToTbl(tbl, props) {
      const rows = Array.from(tbl.querySelectorAll("tr"));
      const colCount = Math.max(1, ...rows.map(r =>
        Array.from(r.children).filter(c => c.localName === "td" || c.localName === "th").length));
      const cw = Math.round(9000 / colCount);
      const grid = Array(colCount).fill(0).map(() => '<w:gridCol w:w="' + cw + '"/>').join("");
      const rowXml = rows.map(r => {
        const cells = Array.from(r.children).filter(c => c.localName === "td" || c.localName === "th");
        const tcs = cells.map(c => {
          const rep = +c.getAttribute("colspan") || 1;
          let tc = "";
          for (let k = 0; k < rep; k++)
            tc += '<w:tc><w:tcPr><w:tcW w:w="' + cw + '" w:type="dxa"/></w:tcPr><w:p>' + inlines(c, props) + "</w:p></w:tc>";
          return tc;
        }).join("");
        return "<w:tr>" + tcs + "</w:tr>";
      }).join("");
      return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>' +
        '<w:tblGrid>' + grid + "</w:tblGrid>" + rowXml + "</w:tbl>";
    }
    function blockToParagraphs(el, props) {
      const tag = el.localName;
      const paras = [];
      let m;
      if ((m = /^h([1-6])$/.exec(tag))) {
        const lvl = m[1];
        paras.push('<w:p><w:pPr><w:pStyle w:val="Heading' + lvl + '"/></w:pPr>' + inlines(el, props) + "</w:p>");
      } else if (tag === "p") {
        paras.push("<w:p>" + inlines(el, props) + "</w:p>");
      } else if (tag === "ul" || tag === "ol") {
        const numId = tag === "ul" ? 1 : 2;
        Array.from(el.children).forEach(li => {
          if (li.localName === "li") {
            paras.push('<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + numId + '"/></w:numPr></w:pPr>' + inlines(li, props) + "</w:p>");
            Array.from(li.children).forEach(c => { if (c.localName === "ul" || c.localName === "ol") paras.push.apply(paras, blockToParagraphs(c, props)); });
          }
        });
      } else if (tag === "table") {
        paras.push(tableToTbl(el, props));
      } else if (tag === "div" && el.classList && el.classList.contains("page-break")) {
        paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      } else if (tag === "nav" && el.classList && el.classList.contains("toc")) {
        paras.push('<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>目录</w:t></w:r></w:p>');
        Array.from(el.querySelectorAll(".toc-link")).forEach(a => {
          const anchor = a.getAttribute("data-target") || "";
          const txt = (a.textContent || "").trim();
          paras.push('<w:p><w:hyperlink w:anchor="' + esc(anchor) + '"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">' + esc(txt) + '</w:t></w:r></w:hyperlink></w:p>');
        });
      }
      return paras;
    }

    const paras = [];
    Array.from(root.children).forEach(ch => paras.push.apply(paras, blockToParagraphs(ch, {})));
    const appendix = hasComments ? buildCommentsAppendix(comments, X) : "";
    const body = paras.join("") + appendix +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

    const docXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="' + X.w + '" xmlns:r="' + X.r + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + "</w:body></w:document>";

    const stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="' + X.w + '">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:sz w:val="32"/><w:b/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:sz w:val="28"/><w:b/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:sz w:val="26"/><w:b/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:sz w:val="24"/><w:b/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:sz w:val="22"/><w:b/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:sz w:val="22"/><w:b/></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:u w:val="single"/><w:color w:val="0563C1"/></w:style>' +
      (hasComments ? '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="Comment Text"/></w:style>' +
        '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="Comment Reference"/></w:style>' : "") +
      "</w:styles>";

    const numberingXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:numbering xmlns:w="' + X.w + '">' +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      "</w:numbering>";

    /* ---------- 批注 XML（word/comments.xml）---------- */
    const commentsXml = hasComments ? (
      (function () {
        let rid = 0;
        const items = [];
        comments.forEach(c => {
          rid++;
          const wid = rid;
          const author = esc(c.author || "我");
          const date = new Date(c.createdAt || Date.now()).toISOString();
          const done = c.resolved ? ' w:done="1"' : "";
          items.push('<w:comment w:id="' + wid + '" w:author="' + author + '" w:date="' + date + '"' + done + '>' +
            '<w:p><w:r><w:rPr><w:rStyle w:val="CommentText"/></w:rPr><w:t xml:space="preserve">' + esc(c.quote || "") + '</w:t></w:r></w:p></w:comment>');
          (c.replies || []).forEach(rp => {
            rid++;
            const rwid = rid;
            const rdate = new Date(rp.createdAt || Date.now()).toISOString();
            items.push('<w:comment w:id="' + rwid + '" w:parentId="' + wid + '" w:author="' + esc(rp.author || "我") + '" w:date="' + rdate + '">' +
              '<w:p><w:r><w:rPr><w:rStyle w:val="CommentText"/></w:rPr><w:t xml:space="preserve">' + esc(rp.text || "") + '</w:t></w:r></w:p></w:comment>');
          });
        });
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<w:comments xmlns:w="' + X.w + '">' + items.join("") + '</w:comments>';
      })()
    ) : null;

    const commentsRel = hasComments ? '<Relationship Id="rId3" Type="' + X.r + '/comments" Target="comments.xml"/>' : "";

    const docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="' + X.r + '/numbering" Target="numbering.xml"/>' +
      commentsRel +
      hyperlinks.map((u, i) => '<Relationship Id="rId' + (100 + i) + '" Type="' + X.r + '/hyperlink" Target="' + esc(u) + '" TargetMode="External"/>').join("") +
      images.map(im => '<Relationship Id="' + im.rid + '" Type="' + X.r + '/image" Target="' + im.fname + '"/>').join("") +
      "</Relationships>";

    const ctComments = hasComments ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : "";

    const ct =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="' + X.ct + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      ctComments +
      Object.keys(imgCtypes).map(ext => '<Default Extension="' + ext + '" ContentType="' + imgCtypes[ext] + '"/>').join("") +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>";

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="' + X.rel + '/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="' + X.r + '/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>";

    const coreXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(doc.name || "文档") + "</dc:title><dc:creator>绿角犀Office</dc:creator></cp:coreProperties>";

    const appXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>绿角犀Office</Application></Properties>';

    zip.file("[Content_Types].xml", ct);
    zip.file("_rels/.rels", rootRels);
    zip.file("word/document.xml", docXml);
    zip.file("word/styles.xml", stylesXml);
    zip.file("word/numbering.xml", numberingXml);
    if (commentsXml) zip.file("word/comments.xml", commentsXml);
    images.forEach(im => zip.file("word/" + im.fname, im.b64, { base64: true }));
    zip.file("word/_rels/document.xml.rels", docRels);
    zip.file("docProps/core.xml", coreXml);
    zip.file("docProps/app.xml", appXml);
    return zip;
  }

  /* ============================================================
     XLSX
     ============================================================ */
  function buildXlsx(doc) {
    const JSZip = global.JSZip;
    const zip = new JSZip();
    const data = doc.data || {};
    const sheets = (data.sheets && data.sheets.length) ? data.sheets : [ { name: "Sheet1", cells: data.cells || {}, charts: data.charts || [] } ];

    const sst = []; const sstMap = {};
    function sid(s) { if (sstMap[s] != null) return sstMap[s]; const id = sst.length; sst.push(s); sstMap[s] = id; return id; }

    const EMU = 9525;
    let wbSheets = "", wbRels = "", ctOverrides = "", chartCT = "";
    const sheetEntries = [];      // { file, xml }
    const drawingEntries = [];    // { sheetIdx, drawingXml, drawingRelsXml, chartFiles }

    sheets.forEach((sh, i) => {
      const idx = i + 1;
      const sheetName = sh.name || ("Sheet" + idx);
      const cells = sh.cells || {};

      const byRow = {};
      Object.keys(cells).forEach(ref => {
        const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) return;
        const c = m[1], r = +m[2];
        (byRow[r] = byRow[r] || {})[c] = cells[ref];
      });
      const maxRow = Object.keys(byRow).length ? Math.max.apply(null, Object.keys(byRow).map(Number)) : 0;

      function getCellVal(ref) {
        const c = cells[ref];
        if (!c) return "";
        if (c.f != null && c.f !== "") {
          try { if (OS.FormulaEngine) return OS.FormulaEngine.run(c.f, getCellVal); } catch (e) {}
          if (c.v != null) return c.v;
          return 0;
        }
        return c.v == null ? "" : c.v;
      }

      let rowsXml = "";
      for (let r = 1; r <= maxRow; r++) {
        const row = byRow[r]; if (!row) continue;
        const cols = Object.keys(row).sort((a, b) => colIdx(a) - colIdx(b));
        if (!cols.length) continue;
        let cellsXml = "";
        cols.forEach(c => {
          const cell = row[c]; const ref = c + r;
          if (cell && cell.f != null && cell.f !== "") {
            let val = "";
            try { if (OS.FormulaEngine) val = OS.FormulaEngine.run(cell.f, getCellVal); } catch (e) {}
            const sv = (typeof val === "number") ? val : (val == null ? "" : String(val));
            cellsXml += '<c r="' + ref + '"><f>' + esc(cell.f.replace(/^=/, "")) + "</f><v>" + esc(sv) + "</v></c>";
          } else {
            const v = cell ? cell.v : undefined;
            if (v == null || v === "") return;
            if (typeof v === "number") cellsXml += '<c r="' + ref + '"><v>' + v + "</v></c>";
            else if (typeof v === "boolean") cellsXml += '<c r="' + ref + '" t="b"><v>' + (v ? 1 : 0) + "</v></c>";
            else cellsXml += '<c r="' + ref + '" t="s"><v>' + sid(String(v)) + "</v></c>";
          }
        });
        if (cellsXml) rowsXml += '<row r="' + r + '">' + cellsXml + "</row>";
      }

      const charts = sh.charts || [];
      let chartParts = null, prefix = "";
      if (charts.length) { prefix = (sheets.length > 1) ? ("s" + idx) : ""; chartParts = buildChartPartsForXlsx(charts, sheetName, cells, maxRow + 2, EMU, prefix); }

      const sheetXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="' + X.w + '" xmlns:r="' + X.r + '"><sheetData>' + rowsXml + "</sheetData>" +
        (chartParts ? '<drawing r:id="rIdD"/>' : "") + "</worksheet>";

      sheetEntries.push({ file: "xl/worksheets/sheet" + idx + ".xml", xml: sheetXml });
      if (chartParts) {
        drawingEntries.push({ sheetIdx: idx, drawingXml: chartParts.drawingXml, drawingRelsXml: chartParts.drawingRelsXml, chartFiles: chartParts.chartFiles });
        chartCT += '<Override PartName="/xl/drawings/drawing' + idx + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.drawing+xml"/>' +
          charts.map((c, ci) => '<Override PartName="/xl/charts/' + prefix + "_" + (ci + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>').join("");
      }

      const rid = "rId" + idx;
      wbSheets += '<sheet name="' + esc(sheetName) + '" sheetId="' + idx + '" r:id="' + rid + '"/>';
      wbRels += '<Relationship Id="' + rid + '" Type="' + X.r + '/worksheet" Target="worksheets/sheet' + idx + '.xml"/>';
      ctOverrides += '<Override PartName="/xl/worksheets/sheet' + idx + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    });

    const sstXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<sst xmlns="' + X.w + '" count="' + sst.length + '" uniqueCount="' + sst.length + '">' +
      sst.map(s => "<si><t>" + esc(s) + "</t></si>").join("") + "</sst>";

    const stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="' + X.w + '"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>';

    const workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="' + X.w + '" xmlns:r="' + X.r + '"><sheets>' + wbSheets + "</sheets></workbook>";

    const wbRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' + wbRels +
      '<Relationship Id="rIdS" Type="' + X.r + '/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdT" Type="' + X.r + '/sharedStrings" Target="sharedStrings.xml"/>' +
      "</Relationships>";

    const ct =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="' + X.ct + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      ctOverrides +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      chartCT +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>";

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="' + X.rel + '/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>";

    const coreXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(doc.name || "表格") + "</dc:title><dc:creator>绿角犀Office</dc:creator></cp:coreProperties>";

    zip.file("[Content_Types].xml", ct);
    zip.file("_rels/.rels", rootRels);
    zip.file("xl/workbook.xml", workbookXml);
    zip.file("xl/_rels/workbook.xml.rels", wbRelsXml);
    sheetEntries.forEach(s => zip.file(s.file, s.xml));
    drawingEntries.forEach(d => {
      const idx = d.sheetIdx;
      zip.file("xl/drawings/drawing" + idx + ".xml", d.drawingXml);
      zip.file("xl/drawings/_rels/drawing" + idx + ".xml.rels", d.drawingRelsXml);
      zip.file("xl/worksheets/_rels/sheet" + idx + ".xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + X.rel + '">' +
        '<Relationship Id="rIdD" Type="' + X.r + '/drawing" Target="../drawings/drawing' + idx + '.xml"/></Relationships>');
      Object.keys(d.chartFiles).forEach(name => zip.file(name, d.chartFiles[name]));
    });
    zip.file("xl/styles.xml", stylesXml);
    zip.file("xl/sharedStrings.xml", sstXml);
    zip.file("docProps/core.xml", coreXml);
    return zip;
  }

  /* ============================================================
     PPTX
     ============================================================ */
  const EMU = 9525; // 1px = 9525 EMU (96dpi)
  function buildPptx(doc) {
    const JSZip = global.JSZip;
    const zip = new JSZip();
    const slides = (doc.data && doc.data.slides) || [];
    const W = 9144000, H = 6858000; // 10in x 7.5in

    function shapeXml(el, id) {
      const x = Math.round((el.x || 0) * EMU), y = Math.round((el.y || 0) * EMU);
      const w = Math.max(1, Math.round((el.w || 40) * EMU)), h = Math.max(1, Math.round((el.h || 20) * EMU));
      const sz = Math.round((el.fontSize || 24) * 100); // hundredths of point
      const color = (el.color || "#111827").replace(/^#/, "");
      const rpr = '<a:rPr lang="zh-CN" sz="' + sz + '"' + (el.bold ? ' b="1"' : "") + '><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></a:rPr>';
      const text = (el.text || "").split("\n").map((line, i) =>
        '<a:p>' + (i === 0 ? "" : "") + '<a:r>' + rpr + "<a:t>" + esc(line) + "</a:t></a:r></a:p>"
      ).join("") || "<a:p/>";
      return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Text ' + id + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        '<p:txBody><a:bodyPr/><a:lstStyle/>' + text + "</p:txBody></p:sp>";
    }

    const slideXmls = slides.map((slide, i) => {
      const bg = slide.bg || "#ffffff";
      const bgRect = '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Back"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + W + '" cy="' + H + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + bg.replace(/^#/, "") + '"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
      const shapes = (slide.elements || []).map((el, j) => shapeXml(el, j + 2)).join("");
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<p:sld xmlns:a="' + X.a + '" xmlns:r="' + X.r + '" xmlns:p="' + X.p + '">' +
        '<p:cSld><p:spTree><a:spTree>' + bgRect + shapes + "</a:spTree></p:spTree></p:cSld></p:sld>";
    });
    if (!slideXmls.length) slideXmls.push(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sld xmlns:a="' + X.a + '" xmlns:r="' + X.r + '" xmlns:p="' + X.p + '"><p:cSld><p:spTree><a:spTree>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Back"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + W + '" cy="' + H + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>' +
      "</a:spTree></p:spTree></p:cSld></p:sld>");

    // ---- 演讲者备注（notesSlide）----
    const notesText = slides.map(s => (s.notes || "").trim());
    const hasNotes = notesText.some(t => t);
    const notesSlideXml = [];
    const notesSlideRels = [];
    if (hasNotes) {
      notesText.forEach((t, i) => {
        if (!t) { notesSlideXml.push(null); notesSlideRels.push(null); return; }
        const paras = t.split("\n").map(line =>
          '<a:p><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>' + esc(line) + '</a:t></a:r></a:p>'
        ).join("") || '<a:p/>';
        notesSlideXml.push(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<p:notesSlide xmlns:a="' + X.a + '" xmlns:r="' + X.r + '" xmlns:p="' + X.p + '">' +
          '<p:cSld><p:spTree><a:spTree>' +
          '<a:sp><a:nvSpPr><a:cNvPr id="2" name="Notes Placeholder"/><a:cNvSpPr/><a:nvPr><a:ph idx="1" type="body"/></a:nvPr></a:nvSpPr>' +
          '<a:spPr/><a:txBody><a:bodyPr/><a:lstStyle/>' + paras + '</a:txBody></a:sp>' +
          '</a:spTree></p:spTree></p:cSld></p:notesSlide>');
        notesSlideRels.push(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + X.rel + '">' +
          '<Relationship Id="rId1" Type="' + X.r + '/slide" Target="../slides/slide' + (i + 1) + '.xml"/>' +
          '<Relationship Id="rId2" Type="' + X.r + '/notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>');
      });
    }
    const notesMasterXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:notesMaster xmlns:a="' + X.a + '" xmlns:r="' + X.r + '" xmlns:p="' + X.p + '">' +
      '<p:cSld><p:bg><p:bgPr><a:noFill/></p:bgPr></p:bg><p:spTree><a:spTree>' +
      '<a:sp><a:nvSpPr><a:cNvPr id="1" name=""/><a:cNvSpPr/><a:nvPr><a:ph type="sldNum" idx="11"/></a:nvPr></a:nvSpPr><a:spPr/><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody></a:sp>' +
      '<a:sp><a:nvSpPr><a:cNvPr id="2" name="Notes Placeholder"/><a:cNvSpPr/><a:nvPr><a:ph type="body" idx="1"/></a:nvPr></a:nvSpPr><a:spPr/><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody></a:sp>' +
      '</a:spTree></p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:notesMaster>';
    const notesMasterRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      '<Relationship Id="rId2" Type="' + X.r + '/theme" Target="../theme/theme1.xml"/></Relationships>';

    const presentationXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:presentation xmlns:a="' + X.a + '" xmlns:r="' + X.r + '" xmlns:p="' + X.p + '">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      (hasNotes ? '<p:notesMasterIdLst><p:notesMasterId id="2147483650" r:id="rId' + (slides.length + 2) + '"/></p:notesMasterIdLst>' : "") +
      '<p:sldIdLst>' + slideXmls.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join("") + '</p:sldIdLst>' +
      '<p:sldSz cx="' + W + '" cy="' + H + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';

    const presRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
      slideXmls.map((_, i) => '<Relationship Id="rId' + (i + 2) + '" Type="' + X.r + '/slide" Target="slides/slide' + (i + 1) + '.xml"/>').join("") +
      (hasNotes ? '<Relationship Id="rId' + (slides.length + 2) + '" Type="' + X.r + '/notesMaster" Target="notesMasters/notesMaster1.xml"/>' : "") +
      "</Relationships>";

    const masterXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sldMaster xmlns:a="' + X.a + '" xmlns:r="' + X.r + '" xmlns:p="' + X.p + '">' +
      '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>' +
      '<p:spTree><a:spTree><a:sp><a:nvSpPr><a:cNvPr id="1"/><a:cNvSpPr/><a:nvPr/></a:nvSpPr><a:spPr/><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody></a:sp></a:spTree></p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';

    const masterRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      '<Relationship Id="rId2" Type="' + X.r + '/theme" Target="../theme/theme1.xml"/></Relationships>';

    const layoutXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sldLayout xmlns:a="' + X.a + '" xmlns:r="' + X.r + '" xmlns:p="' + X.p + '" type="blank" preserve="1">' +
      '<p:cSld name="Blank"><p:spTree><a:spTree><a:sp><a:nvSpPr><a:cNvPr id="1"/><a:cNvSpPr/><a:nvPr/></a:nvSpPr><a:spPr/><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody></a:sp></a:spTree></p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>';

    const layoutRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>';

    const themeXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<a:theme xmlns:a="' + X.a + '" name="Office Theme"><a:themeElements>' +
      '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
      '<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
      "</a:fmtScheme></a:themeElements></a:theme>";

    const ct =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="' + X.ct + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      slideXmls.map((_, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join("") +
      (hasNotes ? '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>' +
        notesSlideXml.map((nx, i) => nx ? '<Override PartName="/ppt/notesSlides/notesSlide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' : "").join("") : "") +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>";

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="' + X.rel + '">' +
      '<Relationship Id="rId1" Type="' + X.r + '/officeDocument" Target="ppt/presentation.xml"/>' +
      '<Relationship Id="rId2" Type="' + X.rel + '/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>";

    const coreXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(doc.name || "演示") + "</dc:title><dc:creator>绿角犀Office</dc:creator></cp:coreProperties>";

    zip.file("[Content_Types].xml", ct);
    zip.file("_rels/.rels", rootRels);
    zip.file("ppt/presentation.xml", presentationXml);
    zip.file("ppt/_rels/presentation.xml.rels", presRels);
    zip.file("ppt/slideMasters/slideMaster1.xml", masterXml);
    zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", masterRels);
    zip.file("ppt/slideLayouts/slideLayout1.xml", layoutXml);
    zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", layoutRels);
    zip.file("ppt/theme/theme1.xml", themeXml);
    slideXmls.forEach((sx, i) => {
      zip.file("ppt/slides/slide" + (i + 1) + ".xml", sx);
      const rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + X.rel + '">',
        '<Relationship Id="rId1" Type="' + X.r + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'];
      if (notesSlideRels[i]) rels.push('<Relationship Id="rId2" Type="' + X.r + '/notesSlide" Target="../notesSlides/notesSlide' + (i + 1) + '.xml"/>');
      rels.push("</Relationships>");
      zip.file("ppt/slides/_rels/slide" + (i + 1) + ".xml.rels", rels.join(""));
    });
    if (hasNotes) {
      zip.file("ppt/notesMasters/notesMaster1.xml", notesMasterXml);
      zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", notesMasterRels);
      notesSlideXml.forEach((nx, i) => {
        if (!nx) return;
        zip.file("ppt/notesSlides/notesSlide" + (i + 1) + ".xml", nx);
        zip.file("ppt/notesSlides/_rels/notesSlide" + (i + 1) + ".xml.rels", notesSlideRels[i]);
      });
    }
    zip.file("docProps/core.xml", coreXml);
    return zip;
  }

  /* ============================================================
     OFD (国标版式)
     ============================================================ */
  function ofdFromPresentation(doc) {
    const JSZip = global.JSZip;
    const zip = new JSZip();
    const slides = (doc.data && doc.data.slides) || [];
    const pageW = 254, pageH = 142.75; // 与 760x427 同比例，导入无 letterbox
    const sx = pageW / 760, sy = pageH / 427;

    const pageXmls = slides.map(slide => {
      const els = (slide.elements || []).map((el, i) => {
        const x = (el.x * sx).toFixed(1), y = (el.y * sy).toFixed(1);
        const w = (el.w * sx).toFixed(1), h = (el.h * sy).toFixed(1);
        const sizeMM = (el.fontSize || 24) * sx;
        const attr = ' Size="' + sizeMM.toFixed(2) + '"' + (el.bold ? ' Bold="true"' : "") + (el.italic ? ' Italic="true"' : "");
        return '<TextObject ID="' + (i + 1) + '" Boundary="' + x + " " + y + " " + w + " " + h + '"' + attr + "><TextCode>" + esc(el.text || "") + "</TextCode></TextObject>";
      }).join("");
      return '<?xml version="1.0" encoding="UTF-8"?>\n<Page xmlns="' + OFD_NS + '">' + els + "</Page>";
    });
    if (!pageXmls.length) pageXmls.push('<?xml version="1.0" encoding="UTF-8"?>\n<Page xmlns="' + OFD_NS + '"></Page>');

    const docXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="' + OFD_NS + '">' +
      "<CommonData><PageArea><PhysicalBox>0 0 " + pageW + " " + pageH + "</PhysicalBox><Application>绿角犀Office</Application></PageArea></CommonData>" +
      "<Pages>" + pageXmls.map((_, i) => '<Page ID="' + (i + 1) + '" BaseLoc="Pages/Page_' + i + '/Content.xml"/>').join("") + "</Pages></Document>";

    const ofdXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<OFD xmlns="' + OFD_NS + '" Version="1.0"><DocBody>' +
      "<DocInfo><DocTitle>" + esc(doc.name || "演示") + "</DocTitle></DocInfo>" +
      "<DocRoot>Doc_0/Document.xml</DocRoot></DocBody></OFD>";

    zip.file("OFD.xml", ofdXml);
    zip.file("Doc_0/Document.xml", docXml);
    pageXmls.forEach((px, i) => zip.file("Doc_0/Pages/Page_" + i + "/Content.xml", px));
    return zip;
  }

  function ofdFromWriter(doc) {
    const JSZip = global.JSZip;
    const zip = new JSZip();
    const html = (doc.data && doc.data.html) || "";
    const root = new global.DOMParser().parseFromString(html, "text/html").body;
    const pageW = 210, lh = 6, top = 15;
    let y = top, id = 0, objs = "";
    function emitText(text, sizeMM, bold) {
      text.split("\n").forEach(line => {
        id++;
        const h = lh;
        objs += '<TextObject ID="' + id + '" Boundary="20 ' + y.toFixed(1) + " " + (pageW - 40) + " " + h + '" Size="' + sizeMM + '"' + (bold ? ' Bold="true"' : "") + "><TextCode>" + esc(line) + "</TextCode></TextObject>";
        y += h + 2;
      });
    }
    Array.from(root.children).forEach(ch => {
      const tag = ch.localName;
      if (/^h([1-6])$/.test(tag)) emitText(ch.textContent || "", 7 - (+tag[1]) * 0.4, true);
      else if (tag === "p") emitText(ch.textContent || "", 3.5, false);
      else if (tag === "li") emitText("• " + (ch.textContent || ""), 3.5, false);
      else if (tag === "ul" || tag === "ol") Array.from(ch.children).forEach(li => { if (li.localName === "li") emitText((tag === "ol" ? "" : "• ") + (li.textContent || ""), 3.5, false); });
    });
    const pageH = Math.max(297, y + 15);
    const pageXml = '<?xml version="1.0" encoding="UTF-8"?>\n<Page xmlns="' + OFD_NS + '">' + objs + "</Page>";
    const docXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="' + OFD_NS + '">' +
      "<CommonData><PageArea><PhysicalBox>0 0 " + pageW + " " + pageH + "</PhysicalBox><Application>绿角犀Office</Application></PageArea></CommonData>" +
      '<Pages><Page ID="1" BaseLoc="Pages/Page_0/Content.xml"/></Pages></Document>';
    const ofdXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<OFD xmlns="' + OFD_NS + '" Version="1.0"><DocBody>' +
      "<DocInfo><DocTitle>" + esc(doc.name || "文档") + "</DocTitle></DocInfo>" +
      "<DocRoot>Doc_0/Document.xml</DocRoot></DocBody></OFD>";
    zip.file("OFD.xml", ofdXml);
    zip.file("Doc_0/Document.xml", docXml);
    zip.file("Doc_0/Pages/Page_0/Content.xml", pageXml);
    return zip;
  }

  function buildOfd(doc) {
    if (doc.type === "presentation") return ofdFromPresentation(doc);
    if (doc.type === "writer") return ofdFromWriter(doc);
    throw new Error("该模块暂不支持 OFD 导出（仅 presentation / writer）");
  }

  /* ============================================================
     入口：导出并下载
     ============================================================ */
  async function exportDoc(doc, fmt, onProgress) {
    if (!global.JSZip) throw new Error("需联网加载 JSZip 以生成压缩包，请稍后重试或在本地服务器下打开");
    let zip, name;
    if (onProgress) onProgress("构建 " + fmt.toUpperCase() + " 文档", 0.15);
    if (fmt === "docx") {
      if (doc.type === "presentation") { zip = buildDocx({ type: "writer", name: doc.name || "演示讲稿", data: { html: (OS.speakerScriptHtml ? OS.speakerScriptHtml(doc) : "") } }); name = doc.name + ".docx"; }
      else { zip = buildDocx(doc); name = doc.name + ".docx"; }
    }
    else if (fmt === "xlsx") { zip = buildXlsx(doc); name = doc.name + ".xlsx"; }
    else if (fmt === "pptx") { zip = buildPptx(doc); name = doc.name + ".pptx"; }
    else if (fmt === "ofd") { zip = buildOfd(doc); name = doc.name + ".ofd"; }
    else throw new Error("不支持的导出格式：" + fmt);
    if (onProgress) onProgress("生成压缩包", 0.55);
    const blob = await zip.generateAsync({
      type: "blob",
      onUpdate: m => { if (onProgress && m && typeof m.percent === "number") onProgress("生成压缩包", 0.55 + (m.percent / 100) * 0.4); }
    });
    if (onProgress) onProgress("写入下载", 0.98);
    OS.util.download(blob, name);
    if (OS.toast) OS.toast("已导出 " + name + "（原生格式，可往返导入）", "ok");
    if (onProgress) onProgress("完成", 1);
    return name;
  }

  OS.Exporter = { exportDoc, buildDocx, buildXlsx, buildPptx, buildOfd };
  if (OS.util && OS.util.log) OS.util.log("Exporter(OOXML/OFD) ready");
})(window);
