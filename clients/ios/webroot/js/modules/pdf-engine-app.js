/* =========================================================================
 * 绿角犀 PDF · 跨平台引擎层 (engine.js)
 * 纯客户端实现：合并 / 拆分 / 旋转 / 删除 / 重排 / 提取
 *               加密 / 解密 / 权限
 *               文字水印 / 图片水印 / 页码 / 页眉页脚
 *               压缩重序列化 / 图片转PDF / PDF转图片 / 文本提取
 * 依赖：PDFLib (window.PDFLib)  ·  pdfjsLib (window.pdfjsLib)
 * ========================================================================= */
(function () {
  'use strict';

  const { PDFDocument, degrees, rgb, StandardFonts, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown,
          PDFName, PDFHexString, PDFBool, PDFDict, PDFArray, PDFNumber, PDFString, PDFRef, PDFNull } = PDFLib;

  // fontkit 用于嵌入自定义字体（TTF/OTF）。需在加载 engine.js 前于页面中引入 fontkit 并挂载到 window.fontkit。
  // 注意：本打包版 pdf-lib 的 registerFontkit 是「实例方法」(doc.registerFontkit)，需在每个 doc 上注册。
  function getFontkit() {
    return (typeof globalThis !== 'undefined' && globalThis.fontkit) ||
           (typeof window !== 'undefined' && window.fontkit) || null;
  }
  function ensureFontkit(doc) {
    const fk = getFontkit();
    if (!fk) return false;
    try { doc.registerFontkit(fk); return true; } catch (e) { return false; }
  }

  /* ---------- 小工具 ---------- */

  async function loadDoc(bytes, password) {
    return PDFDocument.load(bytes, password ? { password } : {});
  }

  // 用浏览器字体把文字渲染成透明背景 PNG（支持中文等任意语言，可旋转）
  function textToImage(text, opts) {
    opts = opts || {};
    const fontSize = opts.fontSize || 48;
    const color = opts.color || '#888888';
    const opacity = opts.opacity == null ? 0.25 : opts.opacity;
    const fontWeight = opts.fontWeight || 'bold';
    const font = opts.font || 'sans-serif';
    const angle = ((opts.angleDeg || 0) * Math.PI) / 180;

    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `${fontWeight} ${fontSize}px ${font}`;
    const tw = Math.ceil(measure.measureText(text).width);
    const th = Math.ceil(fontSize * 1.3);
    const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
    const W = Math.ceil(tw * cos + th * sin) + 24;
    const H = Math.ceil(tw * sin + th * cos) + 24;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(angle);
    ctx.font = `${fontWeight} ${fontSize}px ${font}`;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
  }

  async function blobToBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  const PT_PER_MM = 72 / 25.4;
  const PAGE_SIZES = {
    A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [420.94, 595.28],
    A6: [297.64, 419.53], LETTER: [612, 792],
  };

  function hexToRgb(hex) {
    hex = (hex || '#000000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // 该 pdf-lib 构建的 getSize() 返回 {width,height} 对象（非数组），统一用此函数读取
  function pageSize(p) {
    const s = p.getSize();
    return [s.width != null ? s.width : s[0], s.height != null ? s.height : s[1]];
  }

  // 把 "1,3,5-7" 或 "all" 解析为 0 起的页码数组
  function resolveTargetPages(spec, total) {
    if (!spec || spec === 'all' || String(spec).trim() === '') return Array.from({ length: total }, (_, i) => i);
    const out = [];
    String(spec).split(/[,\s]+/).forEach((part) => {
      if (!part) return;
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i - 1);
      } else out.push(Number(part) - 1);
    });
    return [...new Set(out)].filter((i) => i >= 0 && i < total).sort((x, y) => x - y);
  }

  // 把上传图片转成 PNG（可按角度旋转），供平铺水印使用
  async function imageToPngBytes(imageFile, angleDeg) {
    const im = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.src = URL.createObjectURL(imageFile);
    });
    const angle = ((angleDeg || 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
    const W = Math.ceil(im.width * cos + im.height * sin);
    const H = Math.ceil(im.width * sin + im.height * cos);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.translate(W / 2, H / 2);
    ctx.rotate(angle);
    ctx.drawImage(im, -im.width / 2, -im.height / 2);
    URL.revokeObjectURL(im.src);
    return blobToBytes(await new Promise((r) => cv.toBlob(r, 'image/png')));
  }

  // 把 PNG 平铺到所有页面（PNG 本身已含旋转角度）
  async function tileImage(doc, pages, pngBytes, opts, onProgress) {
    const img = await doc.embedPng(pngBytes);
    const iw = img.width, ih = img.height;
    const baseW = Math.max(...pages.map((p) => p.getWidth()));
    const targetW = (opts.scale || 0.28) * baseW;
    const ratio = targetW / iw;
    const dw = iw * ratio, dh = ih * ratio;
    const spacing = opts.spacing || 1.8;
    const stepX = dw * spacing, stepY = dh * spacing;
    const op = opts.opacity == null ? 1 : opts.opacity;
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      const pw = page.getWidth(), ph = page.getHeight();
      for (let y = -dh; y < ph + dh; y += stepY) {
        for (let x = -dw; x < pw + dw; x += stepX) {
          page.drawImage(img, { x, y, width: dw, height: dh, opacity: op });
        }
      }
      if (onProgress) onProgress({ done: pi + 1, total: pages.length, phase: '添加水印' });
    }
  }

  // 在单页指定位置叠加文字图片
  async function overlayText(doc, pages, text, pos, style) {
    const blob = await textToImage(text, {
      fontSize: style.fontSize || 11, color: style.color || '#333333',
      opacity: style.opacity == null ? 1 : style.opacity,
      font: style.font || 'sans-serif', fontWeight: style.fontWeight || 'normal', angleDeg: 0,
    });
    const png = await blobToBytes(blob);
    const img = await doc.embedPng(png);
    const ratio = ((style.fontSize || 11) / img.height) * 1.4;
    const w = img.width * ratio, h = img.height * ratio;
    const m = 24;
    for (const page of pages) {
      const pw = page.getWidth(), ph = page.getHeight();
      let x, y;
      switch (pos) {
        case 'top-left': x = m; y = ph - h - m; break;
        case 'top-right': x = pw - w - m; y = ph - h - m; break;
        case 'top-center': x = (pw - w) / 2; y = ph - h - m; break;
        case 'bottom-left': x = m; y = m; break;
        case 'bottom-right': x = pw - w - m; y = m; break;
        case 'bottom-center': default: x = (pw - w) / 2; y = m; break;
      }
      page.drawImage(img, { x, y, width: w, height: h });
    }
  }

  /* ===================== 页面操作 ===================== */

  async function mergePDFs(files, onProgress) {
    const out = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const bytes = f.bytes || new Uint8Array(await f.file.arrayBuffer());
      const src = await loadDoc(bytes, f.password);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      if (onProgress) onProgress({ done: i + 1, total: files.length, phase: '合并文件' });
    }
    return out.save();
  }

  async function splitPDF(file, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const src = await loadDoc(bytes, file.password);
    const n = src.getPageCount();
    const result = [];
    for (let i = 0; i < n; i++) {
      const one = await PDFDocument.create();
      const [p] = await one.copyPages(src, [i]);
      one.addPage(p);
      result.push({ index: i, bytes: await one.save() });
      if (onProgress) onProgress({ done: i + 1, total: n, phase: '拆分页面' });
    }
    return result;
  }

  async function extractPages(file, pages, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const src = await loadDoc(bytes, file.password);
    const idx = pages.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount());
    if (onProgress) onProgress({ done: 0, total: 0, phase: '提取页面' });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, idx);
    copied.forEach((p) => out.addPage(p));
    return out.save();
  }

  // P6-① 按书签拆分：依文档大纲（/Outlines）把大 PDF 切成若干独立 PDF。
  // mode='top' 仅按顶层书签分章；mode='all' 用全部书签（含子级）作切分点。
  // 返回 { files:[{name,bytes,title,start,end,pages}], count, totalPages, noBookmarks }。
  async function splitByOutline(file, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    const total = doc.getPageCount();
    const tree = await getOutline({ bytes, password });
    const sanitizeName = (s) => {
      s = String(s || 'part').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
      if (!s) s = 'part';
      return s.length > 64 ? s.slice(0, 64).trim() : s;
    };
    const mode = opts.mode === 'all' ? 'all' : 'top';
    let cuts = [];
    if (mode === 'all') {
      const collect = (nodes) => { for (const n of nodes) { if (n.page) cuts.push(n); if (n.children) collect(n.children); } };
      collect(tree);
    } else {
      cuts = tree.filter((n) => n.page);
    }
    cuts = cuts.filter((c) => c.page >= 1 && c.page <= total).sort((a, b) => a.page - b.page);
    const uniq = [];
    for (const c of cuts) { if (!uniq.length || uniq[uniq.length - 1].page !== c.page) uniq.push(c); }
    cuts = uniq;
    if (cuts.length === 0) return { files: [], count: 0, totalPages: total, noBookmarks: tree.length === 0 };

    const files = [];
    for (let i = 0; i < cuts.length; i++) {
      const start = cuts[i].page;
      const end = (i + 1 < cuts.length) ? cuts[i + 1].page - 1 : total;
      if (end < start) continue;
      const range = [];
      for (let p = start; p <= end; p++) range.push(p);
      const outBytes = await extractPages({ bytes, password }, range);
      const name = String(i + 1).padStart(2, '0') + '_' + sanitizeName(cuts[i].title) + '.pdf';
      files.push({ name, bytes: outBytes, title: cuts[i].title, start, end, pages: range.length });
      if (onProgress) onProgress({ done: i + 1, total: cuts.length, phase: '按书签拆分' });
    }
    return { files, count: files.length, totalPages: total, noBookmarks: false };
  }

  // P6-② 按固定页数拆分：把文档切成每 N 页一组的独立 PDF（与「拆分为单页」「按书签拆分」构成完整拆分矩阵）。
  // opts.count 为每组页数（>=1，非法/非正整数归为 1）；若仅 1 组（count>=总页数）则产出单个文件。
  // 返回 { files:[{name,bytes,index,start,end,pages}], count, totalPages }。
  async function splitByCount(file, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    const total = doc.getPageCount();
    let per = Math.floor(Number(opts.count));
    if (!isFinite(per) || per < 1) per = 1;
    if (onProgress) onProgress({ done: 0, total: 0, phase: '读取页数' });
    const files = [];
    let idx = 0;
    const chunks = Math.ceil(total / per);
    for (let start = 1; start <= total; start += per) {
      const end = Math.min(total, start + per - 1);
      const range = [];
      for (let p = start; p <= end; p++) range.push(p);
      const outBytes = await extractPages({ bytes, password }, range);
      idx += 1;
      const name = 'part-' + String(idx).padStart(3, '0') + '_p' + start + '-' + end + '.pdf';
      files.push({ name, bytes: outBytes, index: idx, start, end, pages: range.length });
      if (onProgress) onProgress({ done: idx, total: chunks, phase: '按页数拆分' });
    }
    return { files, count: files.length, totalPages: total };
  }

  // P6-⑤ 按文件大小拆分：把文档切成若干独立 PDF，使每个输出文件不超过目标大小（KB）。
  // 采用贪心装箱：从某页起不断向后并入下一页，直到再加一页会超限为止；若单页本身已超限则单独成段（不强压）。
  // opts.maxSizeKB 为目标上限（>=1，非法/非正归 1024）；返回 { files:[{name,bytes,index,start,end,pages,sizeKB,overSingle}], count, totalPages }。
  async function splitBySize(file, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    const total = doc.getPageCount();
    let maxKB = Math.floor(Number(opts.maxSizeKB));
    if (!isFinite(maxKB) || maxKB < 1) maxKB = 1024;
    const maxBytes = maxKB * 1024;
    if (onProgress) onProgress({ done: 0, total: 0, phase: '读取页数' });

    // 复用已加载的源文档，避免逐段重新加载（copyPages 不改动源文档上下文）
    const extractRange = async (range) => {
      const out = await PDFDocument.create();
      const idxs = range.map((p) => p - 1).filter((i) => i >= 0 && i < total);
      const copied = await out.copyPages(doc, idxs);
      copied.forEach((p) => out.addPage(p));
      return out.save();
    };
    const rangeOf = (a, b) => { const r = []; for (let p = a; p <= b; p++) r.push(p); return r; };
    const makeEntry = (i, s, e, pb, over) => ({
      name: 'part-' + String(i).padStart(3, '0') + '_p' + s + '-' + e + '.pdf',
      bytes: pb, index: i, start: s, end: e, pages: e - s + 1,
      sizeKB: Math.round(pb.length / 1024), overSingle: over,
    });

    const files = [];
    let idx = 0;
    let start = 1;
    while (start <= total) {
      let part = await extractRange([start]);
      let fitEnd = start;
      if (part.length > maxBytes) {
        // 单页本身已超限：单独成段，不强压（结果可能略大于目标，但为最小不可分割单元）
        idx += 1;
        files.push(makeEntry(idx, start, start, part, true));
        if (onProgress) onProgress({ done: idx, total: 0, phase: '按大小拆分' });
        start = start + 1;
        continue;
      }
      for (let e = start + 1; e <= total; e++) {
        const candidate = await extractRange(rangeOf(start, e));
        if (candidate.length > maxBytes) break;
        part = candidate;
        fitEnd = e;
      }
      idx += 1;
      files.push(makeEntry(idx, start, fitEnd, part, false));
      if (onProgress) onProgress({ done: idx, total: 0, phase: '按大小拆分' });
      start = fitEnd + 1;
    }
    return { files, count: files.length, totalPages: total };
  }

  // P6-③ 页面背景：给页面加纯色或图片背景，绘制在现有内容「下层」（按 /Contents 顺序前置，故显示为背景）。
  // opts: { mode:'color'|'image', color:'#RRGGBB'(默认 #ffffff), imageBytes:Uint8Array, fit:'cover'|'tile'(仅 image),
  //         pages:number[] (1-based) | pageRanges:'1-3,5' | 缺省=全部, password }
  // 返回 { bytes }。纯本地、文件不上传。
  async function setPageBackground(file, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    const ctx = doc.context;
    const pages = doc.getPages();
    const total = pages.length;

    // 目标页（1-based，去重排序）
    let targets;
    if (opts.pages && Array.isArray(opts.pages) && opts.pages.length) {
      targets = opts.pages.map(Number).filter((p) => p >= 1 && p <= total);
    } else if (opts.pageRanges) {
      targets = parsePageRanges(opts.pageRanges, total);
    } else {
      targets = []; for (let i = 1; i <= total; i++) targets.push(i);
    }
    targets = Array.from(new Set(targets)).sort((a, b) => a - b);
    if (!targets.length) throw new Error('没有可添加背景的页面');

    // 图片模式：预嵌入图片，拿到 XObject ref
    let bgImage = null, bgRef = null;
    if (opts.mode === 'image') {
      if (!opts.imageBytes || !opts.imageBytes.length) throw new Error('请选择背景图片');
      const ib = opts.imageBytes;
      const isJpg = ib[0] === 0xFF && ib[1] === 0xD8; // JPEG 魔术字 FF D8
      bgImage = isJpg ? await doc.embedJpg(ib) : await doc.embedPng(ib);
      bgRef = bgImage.ref;
    }

    const f = (n) => Number(n).toFixed(3);
    const col = hexToRgb(opts.color || '#ffffff');
    const fit = opts.fit === 'tile' ? 'tile' : 'cover';

    for (let ti = 0; ti < targets.length; ti++) {
      const page = pages[targets[ti] - 1];
      const size = pageSize(page);
      const W = size[0], H = size[1];
      let ops;
      if (opts.mode === 'image' && bgRef) {
        ensureXObject(page, ctx, 'BGIMG', bgRef);
        if (fit === 'cover') {
          ops = 'q\n' + f(W) + ' 0 0 ' + f(H) + ' 0 0 cm\n/BGIMG Do\nQ\n';
        } else {
          const iw = bgImage.width, ih = bgImage.height;
          let s = '';
          for (let x = 0; x < W; x += iw) for (let y = 0; y < H; y += ih) s += 'q\n' + f(iw) + ' 0 0 ' + f(ih) + ' ' + f(x) + ' ' + f(y) + ' cm\n/BGIMG Do\nQ\n';
          ops = s;
        }
      } else {
        ops = 'q\n' + f(col.r) + ' ' + f(col.g) + ' ' + f(col.b) + ' rg\n0 0 ' + f(W) + ' ' + f(H) + ' re\nf\nQ\n';
      }
      const stream = ctx.stream(new TextEncoder().encode(ops), ctx.obj({}));
      const streamRef = ctx.register(stream);
      const existing = getContentRefs(page, ctx);
      page.node.set(PDFName.of('Contents'), ctx.obj([streamRef, ...existing]));
      if (onProgress) onProgress({ done: ti + 1, total: targets.length, phase: '添加页面背景' });
    }

    const out = await doc.save();
    return { bytes: new Uint8Array(out) };
  }

  // 取页面 /Contents 的引用数组（PDFRef），保持原顺序、未登记对象自动登记
  function getContentRefs(page, ctx) {
    const c = page.node.get(PDFName.of('Contents'));
    if (!c) return [];
    if (c instanceof PDFArray) {
      const arr = [];
      for (let i = 0; i < c.size(); i++) {
        const it = c.get(i);
        arr.push(it instanceof PDFRef ? it : ctx.register(it));
      }
      return arr;
    }
    if (c instanceof PDFRef) return [c];
    return [ctx.register(c)];
  }

  // 在页面 Resources/XObject 中登记一个 XObject（含继承 Resources 解析；缺失则新建）
  function ensureXObject(page, ctx, name, ref) {
    let res = safeLookup(page.node, 'Resources');
    if (!res || !isDict(res)) { res = ctx.obj({}); page.node.set(PDFName.of('Resources'), res); }
    let xobj = safeLookup(res, 'XObject');
    if (!xobj || !isDict(xobj)) { xobj = ctx.obj({}); res.set(PDFName.of('XObject'), xobj); }
    xobj.set(PDFName.of(name), ref);
  }

  // 解析 '1-3,5,8' 形式的页码范围（1-based，约束到 1..total，反转区间自动纠正）
  function parsePageRanges(str, total) {
    const out = [];
    if (!str) return out;
    for (const part of String(str).split(/[,\s]+/)) {
      if (!part) continue;
      if (/^\d+$/.test(part)) { const p = Number(part); if (p >= 1 && p <= total) out.push(p); continue; }
      const m = part.match(/^(\d+)-(\d+)$/);
      if (m) {
        let a = Math.max(1, Number(m[1])), b = Math.min(total, Number(m[2]));
        if (a > b) { const t = a; a = b; b = t; }
        for (let p = a; p <= b; p++) out.push(p);
      }
    }
    return out;
  }

  async function deletePages(file, pages, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const src = await loadDoc(bytes, file.password);
    const remove = new Set(pages.map((p) => p - 1));
    const keep = src.getPageIndices().filter((i) => !remove.has(i));
    if (onProgress) onProgress({ done: 0, total: 0, phase: '删除页面' });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, keep);
    copied.forEach((p) => out.addPage(p));
    return out.save();
  }

  // P7-① 去除空白页：扫描并移除完全空白的页面（无文本 / 无图像 / 无绘制 / 无批注）。
  // 判定采用「保守多信号」策略，宁可少删也不误删：任一信号命中即视为非空。
  async function detectBlankPages(file, opts, onProgress) {
    opts = opts || {};
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const ctx = doc.context;
    const total = doc.getPageCount();
    const blank = [];
    for (let i = 0; i < total; i++) {
      const page = doc.getPage(i);
      const node = page.node;
      let isBlank = true;

      // 1. 资源里含任意 XObject（Image/Form）→ 视为有内容（保守，避免漏删含图页）
      const res = getEffectiveResources(node, ctx);
      if (res) {
        const xo = safeLookup(res, 'XObject');
        if (xo) {
          const xod = xo instanceof PDFRef ? ctx.lookup(xo, PDFDict) : xo;
          if (xod && isDict(xod) && xod.keys().length > 0) isBlank = false;
        }
      }

      // 2. 内容流含绘制 / 文本 / 图像操作符 → 有内容
      if (isBlank) {
        const c = node.lookup(PDFName.of('Contents'));
        const streams = [];
        if (c) {
          if (c instanceof PDFRef) { const s = ctx.lookup(c); if (s) streams.push(s); }
          else if (isArray(c)) { for (let j = 0; j < c.size(); j++) { const s = ctx.lookup(c.lookup(j)); if (s) streams.push(s); } }
          else streams.push(c);
        }
        for (const s of streams) {
          let raw = null;
          try { if (typeof s.getContents === 'function') raw = s.getContents(); } catch (e) {}
          if (!raw && s.contents) raw = s.contents;
          if (!raw || raw.length === 0) continue;
          const txt = Buffer.from(raw).toString('latin1');
          if (/Tj|TJ|Do|\bf\b|\bF\b|\bS\b|\bs\b/.test(txt)) { isBlank = false; break; }
        }
      }

      // 3. 含注解（批注 / 签字等）→ 视为有内容（保守，避免误删批注页）
      if (isBlank) {
        const an = node.lookup(PDFName.of('Annots'));
        if (an) isBlank = false;
      }

      if (isBlank) blank.push(i + 1);
      if (onProgress) onProgress({ done: i + 1, total, phase: '扫描空白页' });
    }
    if (onProgress) onProgress({ done: total, total, phase: '完成' });
    return { blank, total };
  }

  async function removeBlankPages(file, opts, onProgress) {
    opts = opts || {};
    const det = await detectBlankPages(file, opts, onProgress);
    if (det.blank.length === 0) {
      const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
      return { bytes, removed: [], total: det.total, keptAll: true };
    }
    // 全部页都是空白：删除后无法生成合法 0 页文档（pdf-lib 限制），保留 1 个最小空白页作占位。
    if (det.blank.length === det.total) {
      const d = await PDFDocument.create();
      d.addPage([612, 792]);
      const bytes = await d.save();
      return { bytes, removed: det.blank, total: det.total, allBlank: true };
    }
    const out = await deletePages(file, det.blank, onProgress);
    return { bytes: out, removed: det.blank, total: det.total };
  }

  // P7-② 删除重复页：按「页面内容签名」聚类，移除与前面页完全相同的页。
  // 签名 = 内容流（解压）字节 + 各 XObject 原始（编码）字节 的 FNV-1a 折叠；相同视觉页 → 相同签名。
  function fnvFold(h, bytes) {
    h = h >>> 0;
    if (typeof bytes === 'string') {
      for (let i = 0; i < bytes.length; i++) { h ^= bytes.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    } else if (bytes && bytes.length) {
      for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    }
    return h >>> 0;
  }

  // 收集一页内容流对象（/Contents 可能是单个流或流数组）
  function collectContentStreams(node, ctx) {
    const out = [];
    const c = node.lookup(PDFName.of('Contents'));
    if (!c) return out;
    const add = (s) => { if (s) out.push(s); };
    if (c instanceof PDFRef) add(ctx.lookup(c));
    else if (isArray(c)) { for (let j = 0; j < c.size(); j++) add(ctx.lookup(c.lookup(j))); }
    else add(c);
    return out;
  }

  // 工具：把可能带 Flate 头的字节解压（非 Flate 原样返回）。Node 走 zlib，浏览器走 DecompressionStream。
  async function maybeInflate(raw) {
    if (!raw || raw.length < 2) return raw;
    const b0 = raw[0], b1 = raw[1];
    const isFlate = (b0 === 0x78) && (b1 === 0x01 || b1 === 0x9c || b1 === 0xda);
    if (!isFlate) return raw;
    if (typeof require === 'function') { try { return new Uint8Array(require('zlib').inflateSync(Buffer.from(raw))); } catch (e) {} }
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate');
        const w = ds.writable.getWriter(); w.write(raw); w.close();
        const r = ds.readable.getReader(); const parts = []; let x;
        while (!(x = await r.read()).done) parts.push(x.value);
        let l = 0; for (const p of parts) l += p.length;
        const o = new Uint8Array(l); let o2 = 0; for (const p of parts) { o.set(p, o2); o2 += p.length; }
        return o;
      } catch (e) {}
    }
    return raw;
  }

  function stripSlash(s) { return (s && s.charAt(0) === '/') ? s.slice(1) : s; }

  function bytesToLatin1(u) {
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return s;
  }

  function bytesCompare(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
    return a.length - b.length;
  }

  // 归一化内容流里的资源名：vendored pdf-lib 给每个嵌入资源分配带随机后缀的唯一名
  // （如 /Image-9742682568、/Helvetica-7098480789），会把「相同页」的差异写进内容流字节。
  // 这里只剥掉 -<数字> 后缀、保留资源类型（/Image、/Helvetica），使相同视觉页的内容流归一为一致。
  function normalizeResourceNames(str) {
    return str.replace(/\/([A-Za-z][A-Za-z0-9]*)-(\d+)/g, '/$1');
  }

  async function pageSignature(page, ctx) {
    const node = page.node;
    let h = 0x811c9dc5;
    // 1) 内容流：getContents() 取字节（本打包版仍带 Flate 头）→ 解压 → 归一资源名 → 哈希
    for (const s of collectContentStreams(node, ctx)) {
      let raw = null;
      try { if (typeof s.getContents === 'function') raw = await s.getContents(); } catch (e) {}
      if (!raw && s.contents) raw = s.contents;
      if (!raw || raw.length === 0) continue;
      const dec = await maybeInflate(raw);
      const norm = normalizeResourceNames(bytesToLatin1(dec));
      h = fnvFold(h, norm);
    }
    // 2) 图像原始字节集合（顺序无关）：相同视觉页 → 相同图像集合 → 相同哈希（避免「同布局不同图」误判重复）
    const imgBytesList = [];
    const res = getEffectiveResources(node, ctx);
    if (res) {
      const xo = safeLookup(res, 'XObject');
      if (xo) {
        const xod = (xo instanceof PDFRef) ? ctx.lookup(xo, PDFDict) : xo;
        if (xod && isDict(xod)) {
          const names = xod.keys().map((k) => (k && k.asString ? k.asString() : String(k)));
          for (const nm of names) {
            const ref = xod.lookup(PDFName.of(stripSlash(nm)));
            const obj = (ref instanceof PDFRef) ? ctx.lookup(ref) : ref;
            if (obj && typeof obj.getContents === 'function') {
              let raw = null; try { raw = await obj.getContents(); } catch (e) {}
              if (!raw && obj.contents) raw = obj.contents;
              if (raw && raw.length) imgBytesList.push(raw);
            }
          }
        }
      }
    }
    imgBytesList.sort(bytesCompare);
    for (const b of imgBytesList) h = fnvFold(h, b);
    // 3) 批注信号：数量 + 各批注 /Subtype，避免「有批注页」与「无批注页」误判为重复
    const an = node.lookup(PDFName.of('Annots'));
    if (an) {
      const arr = (an instanceof PDFRef) ? ctx.lookup(an) : an;
      const list = (arr && isArray(arr)) ? arr : [arr];
      const subs = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i] instanceof PDFRef ? ctx.lookup(list[i]) : list[i];
        if (!a) continue;
        const st = safeLookup(a, 'Subtype');
        subs.push(st ? String(st) : '?');
      }
      subs.sort();
      h = fnvFold(h, 'AN:' + subs.length + ':' + subs.join(','));
    }
    return h >>> 0;
  }

  async function detectDuplicatePages(file, opts, onProgress) {
    opts = opts || {};
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const total = doc.getPageCount();
    const sigs = [];
    for (let i = 0; i < total; i++) {
      sigs.push(await pageSignature(doc.getPage(i), doc.context));
      if (onProgress) onProgress({ done: i + 1, total, phase: '扫描页面' });
    }
    let clusters = [];
    if (opts.mode === 'consecutive') {
      let run = [];
      let runSig = null;
      for (let i = 0; i < total; i++) {
        if (run.length === 0 || sigs[i] === runSig) { run.push(i + 1); runSig = sigs[i]; }
        else { clusters.push(run); run = [i + 1]; runSig = sigs[i]; }
      }
      if (run.length) clusters.push(run);
    } else {
      const m = new Map();
      for (let i = 0; i < total; i++) {
        if (!m.has(sigs[i])) m.set(sigs[i], []);
        m.get(sigs[i]).push(i + 1);
      }
      for (const pages of m.values()) clusters.push(pages);
    }
    const duplicate = [];
    const kept = [];
    for (const cl of clusters) {
      kept.push(cl[0]);
      for (let k = 1; k < cl.length; k++) duplicate.push(cl[k]);
    }
    duplicate.sort((a, b) => a - b);
    kept.sort((a, b) => a - b);
    if (onProgress) onProgress({ done: total, total, phase: '完成' });
    return { duplicate, kept, total, mode: opts.mode || 'all', clusters };
  }

  async function removeDuplicatePages(file, opts, onProgress) {
    opts = opts || {};
    const det = await detectDuplicatePages(file, opts, onProgress);
    if (det.duplicate.length === 0) {
      const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
      return { bytes, removed: [], total: det.total, keptAll: true };
    }
    const out = await deletePages(file, det.duplicate, onProgress);
    return { bytes: out, removed: det.duplicate, total: det.total, kept: det.kept };
  }

  async function reorderPages(file, order, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const src = await loadDoc(bytes, file.password);
    const idx = order.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount());
    if (onProgress) onProgress({ done: 0, total: 0, phase: '重排页面' });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, idx);
    copied.forEach((p) => out.addPage(p));
    return out.save();
  }

  async function rotatePages(file, rotations, rotateAll, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const src = await loadDoc(bytes, file.password);
    if (onProgress) onProgress({ done: 0, total: 0, phase: '旋转页面' });
    if (rotateAll != null) {
      for (let i = 0; i < src.getPageCount(); i++) src.getPage(i).setRotation(degrees(rotateAll));
    } else {
      for (const k in rotations) {
        const cur = src.getPage(Number(k) - 1).getRotation().angle;
        src.getPage(Number(k) - 1).setRotation(degrees((cur + rotations[k]) % 360));
      }
    }
    return src.save();
  }

  // P5-② 指定页旋转：按 奇数页 / 偶数页 / 指定页(支持 1-3,5 区间) / 全部 对所选页做相对旋转（delta 叠加到当前角度，mod 360）。
  // 与「整体旋转」(rotatePages 的 rotateAll 绝对角度) 互补，专治单页扫描歪斜。
  async function rotateSelectedPages(file, opts, onProgress) {
    opts = opts || {};
    const delta = Number(opts.delta) || 0;
    const mode = opts.mode || 'custom';
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const src = await loadDoc(bytes, file.password || (opts && opts.password));
    if (onProgress) onProgress({ done: 0, total: 0, phase: '旋转指定页面' });
    const count = src.getPageCount();

    let targets = [];
    if (mode === 'odd') {
      for (let i = 1; i <= count; i += 2) targets.push(i);
    } else if (mode === 'even') {
      for (let i = 2; i <= count; i += 2) targets.push(i);
    } else if (mode === 'all') {
      for (let i = 1; i <= count; i++) targets.push(i);
    } else {
      // custom: 支持 "1-3,5,8" 形式（逗号分隔，连字符表示闭区间）
      const tokens = String(opts.pages || '').split(',');
      for (const tk of tokens) {
        const t = tk.trim();
        if (!t) continue;
        if (t.indexOf('-') > 0) {
          const parts = t.split('-').map((x) => parseInt(x, 10));
          const a = parts[0], b = parts[1];
          if (!isNaN(a) && !isNaN(b) && a <= b) for (let p = a; p <= b; p++) targets.push(p);
        } else {
          const n = parseInt(t, 10);
          if (!isNaN(n)) targets.push(n);
        }
      }
    }
    // 去重 + 约束到 1..count
    const seen = new Set();
    targets = targets.filter((p) => {
      if (p < 1 || p > count || seen.has(p)) return false;
      seen.add(p);
      return true;
    });

    for (const p of targets) {
      const page = src.getPage(p - 1);
      const cur = page.getRotation().angle;
      page.setRotation(degrees(((cur + delta) % 360 + 360) % 360));
    }
    return src.save();
  }

  /* ===================== 加密 / 解密 ===================== */

  async function encryptPDF(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    if (onProgress) onProgress({ done: 0, total: 0, phase: '加密中' });
    const src = await loadDoc(bytes, opts.currentPassword);
    const perm = opts.permissions || {};
    return src.save({
      userPassword: opts.userPassword || '',
      ownerPassword: opts.ownerPassword || opts.userPassword || '',
      permissions: {
        printing: perm.printing !== false,
        modifying: perm.modifying !== false,
        copying: perm.copying !== false,
        annotating: perm.annotating !== false,
        fillingForms: true,
        contentAccessibility: true,
        documentAssembly: true,
      },
    });
  }

  async function decryptPDF(file, password, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    if (onProgress) onProgress({ done: 0, total: 0, phase: '解密中' });
    const src = await loadDoc(bytes, password);
    return src.save();
  }

  /* ===================== 水印 / 标注 ===================== */

  async function addTextWatermark(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    if (onProgress) onProgress({ done: 0, total: 0, phase: '生成水印' });
    const doc = await loadDoc(bytes, opts.password);
    const pngBlob = await textToImage(opts.text, {
      fontSize: opts.fontSize || 42, color: opts.color || '#9aa0aa',
      opacity: opts.opacity == null ? 0.22 : opts.opacity,
      font: opts.font || 'sans-serif', fontWeight: opts.fontWeight || 'bold',
      angleDeg: opts.angleDeg == null ? -30 : opts.angleDeg,
    });
    const pngBytes = await blobToBytes(pngBlob);
    await tileImage(doc, doc.getPages(), pngBytes, {
      scale: opts.scale || 0.28, opacity: 1, spacing: opts.spacing || 1.8,
    }, onProgress);
    return doc.save();
  }

  async function addImageWatermark(file, imageFile, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    if (onProgress) onProgress({ done: 0, total: 0, phase: '准备水印图片' });
    const doc = await loadDoc(bytes, opts.password);
    const pngBytes = await imageToPngBytes(imageFile, opts.angleDeg || 0);
    await tileImage(doc, doc.getPages(), pngBytes, {
      scale: opts.scale || 0.25, opacity: opts.opacity == null ? 0.5 : opts.opacity, spacing: opts.spacing || 1.4,
    }, onProgress);
    return doc.save();
  }

  async function addPageNumbers(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    if (onProgress) onProgress({ done: 0, total: pages.length, phase: '添加页码' });
    for (let i = 0; i < pages.length; i++) {
      const t = (opts.format || '第 {n} 页').replace('{n}', String(i + 1)).replace('{total}', String(pages.length));
      await overlayText(doc, [pages[i]], t, opts.position || 'bottom-center', { fontSize: opts.fontSize || 11, color: opts.color || '#555555' });
      if (onProgress) onProgress({ done: i + 1, total: pages.length, phase: '添加页码' });
    }
    return doc.save();
  }

  function headerFooterPos(edge, align) {
    const a = (align === 'left' || align === 'right') ? align : 'center';
    return edge + '-' + a;
  }

  // 页眉 / 页脚：为指定页码范围逐页叠加页眉(顶部)与页脚(底部)文字。
  // 文字支持占位符：{n}=当前页(1-based)，{N}=总页数；例如页脚 "第 {n} / {N} 页"。
  // align: 'left' | 'center' | 'right'（页眉页脚共用）；line: 是否画分隔线（默认 false，避免改变旧行为）；
  // pageRanges: '1-3,5' 或留空=全部；fontSize/color 同 overlayText。
  async function addHeaderFooter(file, opts, onProgress) {
    opts = opts || {};
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const total = pages.length;
    const doH = !!opts.header, doF = !!opts.footer;
    if (!doH && !doF) return doc.save();
    const fs = opts.fontSize || 11;
    const M = 24; // 与 overlayText 的边距一致
    const color = hexToRgb(opts.color || '#333333');
    const hPos = headerFooterPos('top', opts.align);
    const fPos = headerFooterPos('bottom', opts.align);
    const drawLine = !!opts.line;
    const targets = opts.pageRanges ? resolveTargetPages(opts.pageRanges, total) : pages.map((_, i) => i);
    const sub = (t, i) => (t || '').replace(/\{n\}/g, String(i + 1)).replace(/\{N\}/g, String(total));
    if (onProgress) onProgress({ done: 0, total: targets.length, phase: '页眉页脚' });
    for (let k = 0; k < targets.length; k++) {
      const i = targets[k];
      const page = pages[i];
      if (doH) {
        if (drawLine) { const [pw, ph] = pageSize(page); page.drawLine({ start: { x: M, y: ph - M - 6 }, end: { x: pw - M, y: ph - M - 6 }, thickness: 0.5, color }); }
        await overlayText(doc, [page], sub(opts.header, i), hPos, { fontSize: fs, color: opts.color || '#333333' });
      }
      if (doF) {
        await overlayText(doc, [page], sub(opts.footer, i), fPos, { fontSize: fs, color: opts.color || '#333333' });
        if (drawLine) { const [pw] = pageSize(page); page.drawLine({ start: { x: M, y: M + fs * 1.4 + 6 }, end: { x: pw - M, y: M + fs * 1.4 + 6 }, thickness: 0.5, color }); }
      }
      if (onProgress) onProgress({ done: k + 1, total: targets.length, phase: '页眉页脚' });
    }
    return doc.save();
  }

  /* ===================== 压缩 / 转换 ===================== */

  async function compressPDF(file, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    if (onProgress) onProgress({ done: 0, total: 0, phase: '压缩中' });
    const doc = await loadDoc(bytes, file.password);
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
    return doc.save({ useObjectStreams: true });
  }

  async function rasterizeCompress(file, scale, onProgress) {
    scale = scale || 1.4;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const n = (await loadDoc(bytes, file.password)).getPageCount();
    const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const out = await PDFDocument.create();
    if (onProgress) onProgress({ done: 0, total: n, phase: '转图压缩' });
    for (let i = 0; i < n; i++) {
      const pg = await pdfjs.getPage(i + 1);
      const vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const jpg = await blobToBytes(await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.7)));
      const img = await out.embedJpg(jpg);
      const p = out.addPage([cv.width, cv.height]);
      p.drawImage(img, { x: 0, y: 0, width: cv.width, height: cv.height });
      if (onProgress) onProgress({ done: i + 1, total: n, phase: '转图压缩' });
    }
    return out.save();
  }

  async function imagesToPDF(imageFiles, opts, onProgress) {
    opts = opts || {};
    const out = await PDFDocument.create();
    if (onProgress) onProgress({ done: 0, total: imageFiles.length, phase: '合成 PDF' });
    for (let i = 0; i < imageFiles.length; i++) {
      const f = imageFiles[i];
      let img;
      if (f.type === 'image/png') {
        img = await out.embedPng(new Uint8Array(await f.arrayBuffer()));
      } else if (f.type === 'image/jpeg' || f.type === 'image/jpg') {
        img = await out.embedJpg(new Uint8Array(await f.arrayBuffer()));
      } else {
        // webp / gif / bmp 等：用 canvas 统一转成 png 再嵌入
        const im = await new Promise((r) => {
          const i = new Image();
          i.onload = () => r(i);
          i.src = URL.createObjectURL(f);
        });
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        cv.getContext('2d').drawImage(im, 0, 0);
        URL.revokeObjectURL(im.src);
        const pngBytes = await blobToBytes(await new Promise((r) => cv.toBlob(r, 'image/png')));
        img = await out.embedPng(pngBytes);
      }
      const maxW = opts.maxWidth || 1440;
      const ratio = Math.min(1, maxW / img.width);
      const w = img.width * ratio, h = img.height * ratio;
      const page = out.addPage([w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
      if (onProgress) onProgress({ done: i + 1, total: imageFiles.length, phase: '合成 PDF' });
    }
    return out.save();
  }

  async function pdfToImages(file, opts, onProgress) {
    opts = opts || {};
    const scale = opts.scale || 2;
    const format = opts.format || 'image/png';
    const quality = opts.quality || 0.92;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const n = pdfjs.numPages;
    const result = [];
    if (onProgress) onProgress({ done: 0, total: n, phase: '导出图片' });
    for (let i = 1; i <= n; i++) {
      const pg = await pdfjs.getPage(i);
      const vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise((r) => cv.toBlob(r, format, quality));
      result.push({ page: i, blob });
      if (onProgress) onProgress({ done: i, total: n, phase: '导出图片' });
    }
    return result;
  }

  async function extractText(file, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const n = pdfjs.numPages;
    let text = '';
    if (onProgress) onProgress({ done: 0, total: n, phase: '提取文本' });
    for (let i = 1; i <= n; i++) {
      const pg = await pdfjs.getPage(i);
      const tc = await pg.getTextContent();
      let para = '';
      for (const it of tc.items) {
        const s = it.str || '';
        const needSpace = para && !para.endsWith(' ') && !s.startsWith(' ') && s;
        para += needSpace ? ' ' + s : s;
        if (it.hasEOL) { text += para + '\n'; para = ''; }
      }
      text += para + '\n\n';
      if (onProgress) onProgress({ done: i, total: n, phase: '提取文本' });
    }
    return text;
  }

  async function pageCount(file, onProgress) {
    if (onProgress) onProgress({ done: 0, total: 0, phase: '读取页数' });
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, file.password);
    return doc.getPageCount();
  }

  /* ===================== 内容编辑 ===================== */

  async function insertPages(file, insertFile, opts, onProgress) {
    const mainBytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const insBytes = insertFile.bytes || new Uint8Array(await insertFile.file.arrayBuffer());
    const main = await loadDoc(mainBytes, opts.password);
    const ins = await loadDoc(insBytes, opts.insertPassword);
    const mainCount = main.getPageCount();
    const at = opts.atPage == null ? mainCount : Math.max(0, Math.min(mainCount, opts.atPage | 0));
    const copied = await main.copyPages(ins, ins.getPageIndices());
    if (onProgress) onProgress({ done: 0, total: copied.length, phase: '插入页面' });
    for (let i = 0; i < copied.length; i++) {
      main.insertPage(at + i, copied[i]);
      if (onProgress) onProgress({ done: i + 1, total: copied.length, phase: '插入页面' });
    }
    return main.save();
  }

  async function replacePage(file, srcFile, opts, onProgress) {
    const mainBytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const srcBytes = srcFile.bytes || new Uint8Array(await srcFile.file.arrayBuffer());
    const main = await loadDoc(mainBytes, opts.password);
    const src = await loadDoc(srcBytes, opts.srcPassword);
    const mainCount = main.getPageCount();
    const pageIndex = Math.max(1, Math.min(mainCount, opts.pageIndex | 0));
    const srcIndex = Math.max(1, Math.min(src.getPageCount(), opts.srcPageIndex || 1));
    const [copied] = await main.copyPages(src, [srcIndex - 1]);
    main.removePage(pageIndex - 1);
    main.insertPage(pageIndex - 1, copied);
    if (onProgress) onProgress({ done: 0, total: 0, phase: '替换页面' });
    return main.save();
  }

  async function cropPages(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const targets = resolveTargetPages(opts.pages, pages.length);
    if (onProgress) onProgress({ done: 0, total: pages.length, phase: '裁剪页面' });
    const mL = (opts.left || 0) * PT_PER_MM, mR = (opts.right || 0) * PT_PER_MM;
    const mT = (opts.top || 0) * PT_PER_MM, mB = (opts.bottom || 0) * PT_PER_MM;
    for (let i = 0; i < pages.length; i++) {
      if (targets.includes(i)) {
        const p = pages[i]; const [w, h] = pageSize(p);
        p.setCropBox(mL, mB, Math.max(1, w - mL - mR), Math.max(1, h - mT - mB));
      }
      if (onProgress) onProgress({ done: i + 1, total: pages.length, phase: '裁剪页面' });
    }
    return doc.save();
  }

  async function resizePages(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const src = await loadDoc(bytes, opts.password);
    const n = src.getPageCount();
    const out = await PDFDocument.create();
    let tw, th;
    if (opts.size === 'CUSTOM') { tw = (opts.width || 210) * PT_PER_MM; th = (opts.height || 297) * PT_PER_MM; }
    else { const s = PAGE_SIZES[opts.size] || PAGE_SIZES.A4; tw = s[0]; th = s[1]; }
    const fit = opts.fit || 'contain';
    const targets = resolveTargetPages(opts.pages, n);
    if (onProgress) onProgress({ done: 0, total: n, phase: '调整尺寸' });
    for (let i = 0; i < n; i++) {
      if (targets.includes(i)) {
        const embedded = await out.embedPage(src.getPage(i));
        const [sw, sh] = pageSize(src.getPage(i));
        const sx = tw / sw, sy = th / sh;
        // 除显式“拉伸”外，始终等比缩放，避免内容变形
        const sc = fit === 'stretch' ? null : (fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy));
        const dw = sc != null ? sw * sc : tw, dh = sc != null ? sh * sc : th;
        const x = (tw - dw) / 2, y = (th - dh) / 2; // 居中
        const target = out.addPage([tw, th]);
        target.drawPage(embedded, { x, y, width: dw, height: dh });
      } else {
        // 非选中页：原样保留，不做尺寸变换
        const [copied] = await out.copyPages(src, [i]);
        out.addPage(copied);
      }
      if (onProgress) onProgress({ done: i + 1, total: n, phase: '调整尺寸' });
    }
    return out.save();
  }

  async function placeText(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const targets = resolveTargetPages(opts.pages, pages.length);
    if (onProgress) onProgress({ done: 0, total: targets.length, phase: '添加文字' });
    const fontSize = opts.fontSize || 14;
    const blob = await textToImage(opts.text || '', {
      fontSize, color: opts.color || '#222222', opacity: opts.opacity == null ? 1 : opts.opacity,
      font: 'sans-serif', fontWeight: 'normal', angleDeg: 0,
    });
    const png = await blobToBytes(blob);
    const img = await doc.embedPng(png);
    const ratio = (fontSize / img.height) * 1.4;
    const w = img.width * ratio, h = img.height * ratio;
    const xPt = (opts.x || 10) * PT_PER_MM;
    for (let k = 0; k < targets.length; k++) {
      const p = pages[targets[k]]; const [pw, ph] = pageSize(p);
      const yPt = ph - (opts.y || 10) * PT_PER_MM - h; // 以左上角为原点输入
      p.drawImage(img, { x: xPt, y: yPt, width: w, height: h });
      if (onProgress) onProgress({ done: k + 1, total: targets.length, phase: '添加文字' });
    }
    return doc.save();
  }

  async function placeImage(file, imageFile, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const targets = resolveTargetPages(opts.pages, pages.length);
    const pngBytes = await imageToPngBytes(imageFile, opts.angle || 0);
    const img = await doc.embedPng(pngBytes);
    const iw = img.width, ih = img.height;
    const targetW = (opts.width || 50) * PT_PER_MM;
    const ratio = targetW / iw;
    const dw = iw * ratio, dh = ih * ratio;
    const xPt = (opts.x || 10) * PT_PER_MM;
    if (onProgress) onProgress({ done: 0, total: targets.length, phase: '添加图片' });
    for (let k = 0; k < targets.length; k++) {
      const p = pages[targets[k]]; const [pw, ph] = pageSize(p);
      const yPt = ph - (opts.y || 10) * PT_PER_MM - dh;
      p.drawImage(img, { x: xPt, y: yPt, width: dw, height: dh, opacity: opts.opacity == null ? 1 : opts.opacity });
      if (onProgress) onProgress({ done: k + 1, total: targets.length, phase: '添加图片' });
    }
    return doc.save();
  }

  async function addHighlight(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const targets = resolveTargetPages(opts.pages, pages.length);
    const x = (opts.x || 10) * PT_PER_MM, yTop = (opts.y || 10) * PT_PER_MM;
    const w = (opts.w || 100) * PT_PER_MM, h = (opts.h || 10) * PT_PER_MM;
    if (onProgress) onProgress({ done: 0, total: targets.length, phase: '高亮标注' });
    for (let k = 0; k < targets.length; k++) {
      const p = pages[targets[k]]; const [pw, ph] = pageSize(p);
      const yPt = ph - yTop - h; // 以左上角为原点输入
      p.drawRectangle({ x, y: yPt, width: w, height: h, color: hexToRgb(opts.color || '#ffeb3b'), opacity: opts.opacity == null ? 0.35 : opts.opacity });
      if (onProgress) onProgress({ done: k + 1, total: targets.length, phase: '高亮标注' });
    }
    return doc.save();
  }

  // ---------------- 矢量注释（矩形 / 箭头 / 手绘 / 批注）----------------
  // 坐标约定：毫米(mm)，左上原点（与高亮一致）。引擎内部换算为 PDF 用户空间(pt, 左下原点)再绘制。
  // 实现说明：直接把矢量图形烤进页面内容流（与高亮一致），可保证在全部阅读器与本应用的 pdf.js 预览中稳定可见
  //           —— 真正的 PDF 注释对象若无 /AP 外观流，pdf.js 等多数预览器不会渲染，故采用矢量「绘制」而非注释对象。
  async function addVectorAnnotation(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const type = opts.type || 'rect';
    const color = hexToRgb(opts.color || '#e53935');
    const fill = opts.fill ? hexToRgb(opts.fill) : null;
    const opacity = opts.opacity == null ? 1 : Number(opts.opacity);
    const borderW = (opts.borderWidth == null ? 1.2 : Number(opts.borderWidth)) * PT_PER_MM;
    const note = opts.note || '';

    let targets;
    if (Array.isArray(opts.pages) && opts.pages.length) targets = opts.pages.map(Number);
    else if (opts.page != null) targets = [Number(opts.page) - 1];
    else targets = [0];
    targets = targets.filter((i) => i >= 0 && i < pages.length);
    if (!targets.length) throw new Error('未指定有效页码');

    if (onProgress) onProgress({ done: 0, total: targets.length, phase: '添加矢量注释' });

    for (let k = 0; k < targets.length; k++) {
      const p = pages[targets[k]]; const [pw, ph] = pageSize(p);
      const toPt = (xmm, ymm) => ({ x: xmm * PT_PER_MM, y: ph - ymm * PT_PER_MM });

      if (type === 'rect') {
        const x0 = Math.min(opts.x0, opts.x1) * PT_PER_MM;
        const x1 = Math.max(opts.x0, opts.x1) * PT_PER_MM;
        const yTop = Math.max(opts.y0, opts.y1), yBot = Math.min(opts.y0, opts.y1);
        const y0 = ph - yTop * PT_PER_MM, y1 = ph - yBot * PT_PER_MM;
        const rectOpts = {
          x: x0, y: y0, width: x1 - x0, height: y1 - y0,
          borderWidth: borderW, borderColor: color, opacity,
        };
        if (fill) rectOpts.color = fill; // 无填充时不传 color，避免 pdf-lib 报错
        p.drawRectangle(rectOpts);
      } else if (type === 'arrow') {
        const s = toPt(opts.x0, opts.y0), e = toPt(opts.x1, opts.y1);
        p.drawLine({ start: s, end: e, thickness: borderW, color, opacity });
        const ang = Math.atan2(e.y - s.y, e.x - s.x);
        const head = Math.max(8, borderW * 3);
        const a1 = ang + Math.PI - 0.4, a2 = ang + Math.PI + 0.4;
        p.drawLine({ start: e, end: { x: e.x + head * Math.cos(a1), y: e.y + head * Math.sin(a1) }, thickness: borderW, color, opacity });
        p.drawLine({ start: e, end: { x: e.x + head * Math.cos(a2), y: e.y + head * Math.sin(a2) }, thickness: borderW, color, opacity });
      } else if (type === 'ink') {
        const pts = (opts.points || []).map((pt) => toPt(pt[0], pt[1]));
        for (let i = 1; i < pts.length; i++) {
          p.drawLine({ start: pts[i - 1], end: pts[i], thickness: borderW, color, opacity });
        }
      } else if (type === 'comment') {
        const pt = toPt(opts.x == null ? 20 : opts.x, opts.y == null ? 20 : opts.y);
        const s = 16;
        p.drawRectangle({ x: pt.x, y: pt.y, width: s, height: s, color, opacity: 1 });
        if (note && typeof document !== 'undefined') {
          const img = await textToImagePng(doc, note, { fontSize: 11, color: '#222222' });
          if (img) p.drawImage(img.img, { x: pt.x + s + 4, y: pt.y, width: img.w, height: img.h });
        }
      } else {
        throw new Error('未知注释类型: ' + type);
      }
      if (onProgress) onProgress({ done: k + 1, total: targets.length, phase: '添加矢量注释' });
    }
    return doc.save();
  }

  // ---------------- 书签 / 大纲（Outline）----------------
  // 输入 tree：节点数组，每个节点 { title, page(1基), top?(mm,左上原点), left?(mm), zoom?, children? }
  // 实现：直接操作 PDF 文档目录的 /Outlines 大纲字典，写入真实的 GoTo 动作 + 大纲条目，
  //       保证在 Acrobat / 浏览器 pdf.js / 各类阅读器中均显示为可点击书签。
  // 标题编码：含非 Latin-1 字符（中文等）时用 UTF-16BE(带 BOM) 的十六进制串，确保跨阅读器不乱码。
  function makeTitlePdfString(title) {
    const t = title == null ? '' : String(title);
    try { return PDFHexString.fromText(t); } catch (e) { return PDFString.of(t); }
  }
  function readTitlePdfString(pdfStr) {
    if (!pdfStr) return '';
    try { return pdfStr.decodeText(); } catch (e) { return ''; }
  }

  async function setOutline(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const tree = Array.isArray(opts.tree) ? opts.tree : [];
    const ctx = doc.context;
    const pages = doc.getPages();

    function buildChain(nodes, parentRef) {
      let prevRef = null, firstRef = null, lastRef = null, count = 0;
      for (const n of nodes) {
        const idx = Math.max(0, Math.min(pages.length - 1, (Number(n.page) || 1) - 1));
        const page = pages[idx];
        const [, ph] = pageSize(page);
        // 目标：/XYZ 左侧距 left(mm)、顶部距 top(mm)、缩放 zoom；未提供则保持当前（null）
        const x = n.left == null ? null : n.left * PT_PER_MM;
        const y = n.top == null ? null : ph - n.top * PT_PER_MM;
        const zoom = n.zoom == null ? null : Number(n.zoom);
        const hasPos = n.left != null || n.top != null || n.zoom != null;
        const dest = hasPos
          ? [page.ref, PDFName.of('XYZ'), x, y, zoom]
          : [page.ref, PDFName.of('Fit')];
        const action = ctx.obj({ Type: PDFName.of('Action'), S: PDFName.of('GoTo'), D: dest });
        const actionRef = ctx.register(action);
        const item = ctx.obj({
          Title: makeTitlePdfString(n.title),
          Parent: parentRef,
          A: actionRef,
        });
        const itemRef = ctx.register(item);
        if (prevRef) {
          ctx.lookup(prevRef).set(PDFName.of('Next'), itemRef);
          item.set(PDFName.of('Prev'), prevRef);
        } else {
          firstRef = itemRef;
        }
        lastRef = itemRef; prevRef = itemRef; count++;
        if (n.children && n.children.length) {
          const sub = buildChain(n.children, itemRef);
          item.set(PDFName.of('First'), sub.firstRef);
          item.set(PDFName.of('Last'), sub.lastRef);
          item.set(PDFName.of('Count'), PDFNumber.of(sub.count));
          count += sub.count;
        }
      }
      return { firstRef, lastRef, count };
    }

    const root = ctx.obj({ Type: PDFName.of('Outlines'), Count: 0 });
    const rootRef = ctx.register(root);
    const res = buildChain(tree, rootRef);
    root.set(PDFName.of('First'), res.firstRef || PDFNull);
    root.set(PDFName.of('Last'), res.lastRef || PDFNull);
    root.set(PDFName.of('Count'), PDFNumber.of(res.count));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);

    const out = await doc.save();
    return { bytes: out, count: res.count };
  }

  async function getOutline(file, opts) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts && opts.password);
    const ctx = doc.context;
    const ol = doc.catalog.lookup(PDFName.of('Outlines'));
    if (!ol) return [];
    const pages = doc.getPages();
    function readChain(ref) {
      const arr = [];
      let cur = ref;
      while (cur) {
        const item = ctx.lookup(cur);
        const node = { title: readTitlePdfString(item.lookup(PDFName.of('Title'))) };
        const a = item.lookup(PDFName.of('A'));
        if (a) {
          const dest = a.lookup(PDFName.of('D'));
          if (dest && dest.size() > 0) {
            const pageRef = dest.get(0); // 取原始引用（不反解），才能拿到 objectNumber
            const objNum = pageRef && pageRef.objectNumber != null ? pageRef.objectNumber : null;
            const pi = objNum != null ? pages.findIndex((p) => p.ref.objectNumber === objNum) : -1;
            if (pi >= 0) {
              node.page = pi + 1;
              const kind = dest.lookup(1);
              const kstr = kind && kind.asString ? kind.asString() : '';
              if (kstr === '/XYZ' || kstr === 'XYZ') {
                const numAt = (i) => { const v = dest.lookup(i); if (!v || typeof v.asNumber !== 'function') return null; const x = v.asNumber(); return (x == null || isNaN(x)) ? null : x; };
                const x = numAt(2); if (x != null) node.left = Math.round(x / PT_PER_MM * 10) / 10;
                const y = numAt(3); if (y != null) node.top = Math.round((pageSize(pages[pi])[1] - y) / PT_PER_MM * 10) / 10;
                const z = numAt(4); if (z != null) node.zoom = z;
              }
            }
          }
        }
        const first = item.lookup(PDFName.of('First'));
        if (first) node.children = readChain(first);
        arr.push(node);
        cur = item.lookup(PDFName.of('Next'));
      }
      return arr;
    }
    const first = ol.lookup(PDFName.of('First'));
    return first ? readChain(first) : [];
  }

  // 往指定页面的 /Annots 数组追加一个注解引用（不存在则创建）
  function pushAnnot(page, ctx, annotRef) {
    let annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots) {
      const arr = ctx.obj([]);
      const arrRef = ctx.register(arr);
      page.node.set(PDFName.of('Annots'), arrRef);
      annots = page.node.lookup(PDFName.of('Annots'));
    }
    annots.push(annotRef);
  }

  /* ===================== 元数据编辑 ===================== */

  // 读取 PDF 文档信息字典（/Info）中的元数据字段。
  // 返回一个对象：{ title, author, subject, keywords, creator, producer }（均为字符串，缺失字段为 ''）。
  // 标题等可能以 PDFHexString (UTF-16BE) 或 PDFString 存储，统一用 decodeText() 解码，中文不乱码。
  async function getMetadata(file, password) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    const info = doc.getInfoDict();
    const fields = {
      title: 'Title', author: 'Author', subject: 'Subject',
      keywords: 'Keywords', creator: 'Creator', producer: 'Producer',
    };
    const out = {};
    for (const key in fields) {
      const node = info.lookup(PDFName.of(fields[key]));
      out[key] = node ? node.decodeText() : '';
    }
    return out;
  }

  // 写入 / 更新 PDF 元数据。opts 字段均可选：
  //   - 未提供的字段保持不变；
  //   - 提供且非空字符串 → 以 PDFHexString (UTF-16BE) 写入（中文安全）；
  //   - 提供且为空字符串 '' → 写入空的 PDFHexString（清空该字段，保留其他字段）。
  // opts.clearAll === true 时忽略其余字段，将全部六项置空。
  // 注：pdf-lib 在保存时会强制把 Producer 写为自身标识，故 Producer 字段不受自定义控制（仅可读取）。
  async function setMetadata(file, opts, onProgress) {
    if (onProgress) onProgress({ done: 0, total: 1, phase: '写入元数据' });
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const info = doc.getInfoDict();
    const fields = {
      title: 'Title', author: 'Author', subject: 'Subject',
      keywords: 'Keywords', creator: 'Creator', producer: 'Producer',
    };
    const clearAll = !!opts.clearAll;
    for (const key in fields) {
      // 未提供且非 clearAll → 不动；否则 v 为字符串（空串表示清空）
      const v = clearAll ? '' : (opts[key] === undefined ? null : (opts[key] == null ? '' : String(opts[key])));
      if (v === null) continue;
      info.set(PDFName.of(fields[key]), PDFHexString.fromText(v));
    }
    const out = await doc.save();
    if (onProgress) onProgress({ done: 1, total: 1, phase: '写入元数据' });
    return out;
  }

  /* ===================== 页面标签（Page Labels） ===================== */

  // PDF 页面标签（/PageLabels 数字树）：让阅读器在导航栏显示逻辑页码，
  // 例如「封面(i) / 前言(ii) / 第1章(1) / 附录A(A-1)」。与「绘制页码水印」是两套机制：
  // 这里是 PDF 原生的逻辑编号，不改动页面内容。
  //
  // 一个区间 = { page(1基起始页), style('D'|'r'|'R'|'a'|'A'|''), prefix(前缀串), start(起始编号,默认1) }
  //   style: 'D' 十进制(1,2,3) | 'r' 小写罗马(i,ii) | 'R' 大写罗马(I,II)
  //          | 'a' 小写字母(a,b) | 'A' 大写字母(A,B) | '' 仅前缀无数字
  //   prefix: 任意文本前缀（支持中文，UTF-16 写入）
  //   start:  该区间第一页的标签编号（正整数，默认 1）

  // 把数字树节点（/PageLabels 根，或其 /Kids 子树）中的 [数字, 字典] 对扁平收集到 out
  function flattenNumTree(node, ctx, out) {
    if (!node || typeof node.lookup !== 'function') return;
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids && typeof kids.size === 'function' && kids.size() > 0) {
      for (let i = 0; i < kids.size(); i++) flattenNumTree(ctx.lookup(kids.get(i)), ctx, out);
      return;
    }
    const nums = node.lookup(PDFName.of('Nums'));
    if (!nums || typeof nums.size !== 'function' || nums.size() < 2) return;
    for (let i = 0; i + 1 < nums.size(); i += 2) {
      const n = nums.get(i);
      let d = nums.get(i + 1);
      if (d && typeof d.lookup !== 'function') d = ctx.lookup(d); // /Nums 中存的是间接引用，需解析
      out.push({ num: (n && typeof n.asNumber === 'function') ? n.asNumber() : Number(n), dict: d });
    }
  }

  // 读取 PDF 的页面标签，返回可读区间数组（按起始页升序）
  async function getPageLabels(file, password) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    const ctx = doc.context;
    const pl = doc.catalog.lookup(PDFName.of('PageLabels'));
    if (!pl) return [];
    const pairs = [];
    flattenNumTree(pl, ctx, pairs);
    pairs.sort((a, b) => a.num - b.num);
    return pairs.map((p) => {
      const d = p.dict || {};
      const s = (typeof d.lookup === 'function') ? d.lookup(PDFName.of('S')) : null;
      let style = '';
      if (s && typeof s.asString === 'function') style = (s.asString().replace(/^\//, '') || '');
      const pNode = (typeof d.lookup === 'function') ? d.lookup(PDFName.of('P')) : null;
      const prefix = pNode && typeof pNode.decodeText === 'function' ? pNode.decodeText() : '';
      const stNode = (typeof d.lookup === 'function') ? d.lookup(PDFName.of('St')) : null;
      const start = (stNode && typeof stNode.asNumber === 'function') ? stNode.asNumber() : 1;
      return { page: p.num + 1, style, prefix: prefix || '', start: start || 1 };
    });
  }

  // 写入 PDF 页面标签。opts.ranges 为区间数组；opts.clearAll=true 时清除全部标签。
  async function setPageLabels(file, opts, onProgress) {
    if (onProgress) onProgress({ done: 0, total: 1, phase: '写入页面标签' });
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const ctx = doc.context;
    if (opts.clearAll) {
      doc.catalog.delete(PDFName.of('PageLabels'));
      const out = await doc.save();
      if (onProgress) onProgress({ done: 1, total: 1, phase: '清除页面标签' });
      return { bytes: out, labels: [] };
    }
    const ranges = Array.isArray(opts.ranges) ? opts.ranges : [];
    if (!ranges.length) throw new Error('请至少填写一个页面标签区间');
    const VALID = { '': true, D: true, r: true, R: true, a: true, A: true };
    const entries = ranges.map((r) => {
      const page = Math.max(1, Math.floor(Number(r.page) || 1));
      const style = (r.style || '').toString().trim();
      if (!VALID.hasOwnProperty(style)) throw new Error('样式无效：' + (r.style || '(空)') + '（应为 D/r/R/a/A 或留空）');
      const prefix = (r.prefix || '').toString();
      const start = Math.max(1, Math.floor(Number(r.start) || 1));
      const dictObj = {};
      if (style) dictObj.S = PDFName.of(style);
      if (prefix) dictObj.P = PDFHexString.fromText(prefix);
      if (start > 1) dictObj.St = PDFNumber.of(start);
      return { start: page - 1, style, prefix, startNum: start, dict: ctx.obj(dictObj) };
    }).sort((a, b) => a.start - b.start);
    const nums = ctx.obj([]);
    for (const e of entries) {
      nums.push(PDFNumber.of(e.start));
      nums.push(ctx.register(e.dict));
    }
    const pl = ctx.obj({ Nums: ctx.register(nums) });
    const plRef = ctx.register(pl);
    doc.catalog.set(PDFName.of('PageLabels'), plRef);
    const out = await doc.save();
    if (onProgress) onProgress({ done: 1, total: 1, phase: '写入页面标签' });
    return { bytes: out, labels: entries.map((e) => ({ page: e.start + 1, style: e.style, prefix: e.prefix, start: e.startNum })) };
  }

  // 在指定页矩形区域添加链接注解（内部跳转 / 外部网址），并可选绘制可见标记（下划线 / 边框）
  // 坐标约定：mm，左上原点（与矢量注释一致），引擎内换算为 PDF 用户空间（左下原点）
  async function addLink(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const ctx = doc.context;
    const pi = Math.max(0, Math.min(pages.length - 1, (Number(opts.page) || 1) - 1));
    const page = pages[pi];
    const [, ph] = pageSize(page);
    const x0 = Math.min(opts.x0, opts.x1) * PT_PER_MM;
    const x1 = Math.max(opts.x0, opts.x1) * PT_PER_MM;
    const yTop = Math.max(opts.y0, opts.y1), yBot = Math.min(opts.y0, opts.y1);
    const y0 = ph - yTop * PT_PER_MM, y1 = ph - yBot * PT_PER_MM;

    let action;
    if (opts.kind === 'external') {
      const uriAction = ctx.obj({ Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(opts.url || '') });
      action = uriAction;
    } else {
      const ti = Math.max(0, Math.min(pages.length - 1, (Number(opts.targetPage) || 1) - 1));
      const tpage = pages[ti];
      const [, tph] = pageSize(tpage);
      const x = opts.left == null ? null : opts.left * PT_PER_MM;
      const y = opts.top == null ? null : tph - opts.top * PT_PER_MM;
      const zoom = opts.zoom == null ? null : Number(opts.zoom);
      const hasPos = opts.left != null || opts.top != null || opts.zoom != null;
      const dest = hasPos ? [tpage.ref, PDFName.of('XYZ'), x, y, zoom] : [tpage.ref, PDFName.of('Fit')];
      action = ctx.obj({ Type: PDFName.of('Action'), S: PDFName.of('GoTo'), D: dest });
    }
    const actionRef = ctx.register(action);

    const bw = opts.borderWidth == null ? 0 : Number(opts.borderWidth);
    const linkDict = { Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [x0, y0, x1, y1], A: actionRef };
    if (bw > 0) linkDict.Border = [0, 0, bw];
    const linkRef = ctx.register(ctx.obj(linkDict));
    pushAnnot(page, ctx, linkRef);

    const color = hexToRgb(opts.color || '#1565c0');
    const lw = opts.lineWidth == null ? 1 : Number(opts.lineWidth);
    if (opts.style === 'underline') {
      page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y0 }, thickness: lw, color });
    } else if (opts.style === 'box') {
      page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, borderWidth: lw, borderColor: color });
    }

    const out = await doc.save();
    return { bytes: out, count: 1 };
  }

  // ---------------- 批注读取（PDF Annot 对象反向） ----------------
  // 读取 PDF 文档中标准 Annotation 字典（/Annots 数组）——包括 Link / Text(批注泡泡) / FreeText / Highlight /
  // Underline / StrikeOut / Squiggly / Circle / Square / Line / PolyLine / Ink / PopUp / Sound 等标准 Subtype。
  // 说明：
  //  - 本应用 addVectorAnnotation 的 rect/arrow/ink/comment 是 page.draw* 烤进内容流的矢量绘制，
  //    不创建 Annot 字典，不在本函数的覆盖范围内。
  //  - Form Widget 注释（Subtype: Widget）由 getFormFields 处理，此处跳过。
  //  - 坐标：PDF 用户空间 pt（左下原点），返回原始坐标不变换。
  async function getAnnotations(file, opts = {}) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const ctx = doc.context;
    const annotations = [];
    const SKIP_WIDGET = true;

    function arrToNum(arr) {
      if (!arr) return null;
      const r = [];
      for (let i = 0; i < arr.size(); i++) {
        const n = arr.get(i);
        if (n && typeof n.asNumber === 'function') r.push(n.asNumber());
        else r.push(null);
      }
      return r.every((x) => x != null) ? r : null;
    }
    function arrOf(val) {
      if (!val) return null;
      let arr = val;
      if (val instanceof PDFRef) { try { arr = ctx.lookup(val); } catch (e) { return null; } }
      if (!arr || typeof arr.size !== 'function') return null;
      return arrToNum(arr);
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let annotsArr;
      try { annotsArr = page.node.lookup(PDFName.of('Annots')); } catch (e) {}
      if (!annotsArr || typeof annotsArr.size !== 'function') continue;

      for (let j = 0; j < annotsArr.size(); j++) {
        const ref = annotsArr.get(j);
        let dict;
        try { dict = ctx.lookup(ref); } catch (e) { continue; }
        if (!dict) continue;

        const subtypeNode = dict.lookup(PDFName.of('Subtype'));
        const subtype = subtypeNode && typeof subtypeNode.asString === 'function' ? subtypeNode.asString().replace(/^\//, '') : '';
        if (!subtype) continue;
        if (SKIP_WIDGET && subtype === 'Widget') continue;

        const rect = arrOf(dict.lookup(PDFName.of('Rect')));
        const contentsNode = dict.lookup(PDFName.of('Contents'));
        const contents = contentsNode ? readTitlePdfString(contentsNode) : '';
        const authorNode = dict.lookup(PDFName.of('T'));
        const author = authorNode ? readTitlePdfString(authorNode) : '';
        const flagsNode = dict.lookup(PDFName.of('F'));
        const flags = flagsNode && typeof flagsNode.asNumber === 'function' ? flagsNode.asNumber() : 0;

        let action = null;
        if (subtype === 'Link') {
          let a = dict.lookup(PDFName.of('A'));
          if (a) {
            if (a instanceof PDFRef) { try { a = ctx.lookup(a); } catch (e) { a = null; } }
          }
          if (a) {
            const sNode = a.lookup(PDFName.of('S'));
            const s = sNode && typeof sNode.asString === 'function' ? sNode.asString().replace(/^\//, '') : '';
            if (s === 'URI') {
              const uNode = a.lookup(PDFName.of('URI'));
              const url = uNode ? readTitlePdfString(uNode) : '';
              action = { type: 'URI', url };
            } else if (s === 'GoTo') {
              const dRef = a.lookup(PDFName.of('D'));
              let d = dRef;
              if (d && d instanceof PDFRef) { try { d = ctx.lookup(d); } catch (e) { d = null; } }
              if (d && typeof d.size === 'function' && d.size() >= 2) {
                let targetPage = null;
                try {
                  const first = d.get(0);
                  if (first && typeof first.asNumber === 'function') {
                    targetPage = first.asNumber() + 1; // 1基
                  }
                } catch (e) {}
                action = { type: 'GoTo', targetPage };
              }
            } else if (s === 'GoToR') {
              const uNode = a.lookup(PDFName.of('F'));
              const url = uNode ? readTitlePdfString(uNode) : '';
              action = { type: 'GoToR', url };
            }
          }
          // 某些 Link 可能直接带 /Dest（GoTo 的另一种写法）
          if (!action) {
            const dNode = dict.lookup(PDFName.of('Dest'));
            if (dNode) action = { type: 'GoTo', targetPage: null, rawDest: String(dNode) };
          }
        }

        annotations.push({
          page: i + 1,
          subtype,
          rect: rect || [0, 0, 0, 0],
          contents,
          author,
          flags,
          action,
        });
      }
    }
    return { annotations, totalPages: pages.length, count: annotations.length };
  }

  // 在指定页生成可点击目录（基于 items 列表或现有书签 getOutline），每行含标题 + 页码 + 内部链接
  async function generateTOC(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const pages = doc.getPages();
    const ctx = doc.context;
    const targetIdx = Math.max(0, Math.min(pages.length - 1, (Number(opts.targetPage) || 1) - 1));
    const page = pages[targetIdx];
    const [pw, ph] = pageSize(page);

    let items = Array.isArray(opts.items) ? opts.items : [];
    if ((!items || !items.length) && opts.fromOutline) {
      const tree = await getOutline({ bytes }, { password: opts.password });
      const flat = [];
      (function walk(nodes, depth) {
        for (const n of (nodes || [])) {
          flat.push({ title: (depth ? '　'.repeat(depth) : '') + n.title, page: n.page });
          if (n.children) walk(n.children, depth + 1);
        }
      })(tree, 0);
      items = flat;
    }
    if (!items || !items.length) throw new Error('没有可生成目录的条目（请提供 items 或开启 fromOutline）');

    const marginMm = opts.margin == null ? 15 : Number(opts.margin);
    const lineHmm = opts.lineHeightMM == null ? 9 : Number(opts.lineHeightMM);
    const fsMm = opts.fontSizeMM == null ? 5 : Number(opts.fontSizeMM);
    const fs = fsMm * PT_PER_MM;
    const color = hexToRgb(opts.color || '#000000');
    const titleX = marginMm * PT_PER_MM;
    const rightX = pw - marginMm * PT_PER_MM;
    let yMm = (ph / PT_PER_MM) - marginMm;
    const numFont = await doc.embedFont(StandardFonts.Helvetica);

    let count = 0;
    for (const it of items) {
      const ti = Math.max(0, Math.min(pages.length - 1, (Number(it.page) || 1) - 1));
      const tpage = pages[ti];
      const yPt = ph - yMm * PT_PER_MM;
      const title = (it.title == null || it.title === '') ? ('第 ' + it.page + ' 页') : String(it.title);
      // 标题（CJK 经 textToImagePng 渲染；无 canvas 环境降级为不显示，但链接注解仍在）
      const g = await textToImagePng(doc, title, { fontSize: Math.max(10, fs * 1.4), color: opts.color || '#000000' });
      if (g) page.drawImage(g.img, { x: titleX, y: yPt, width: g.w, height: g.h });
      // 页码（数字，Helvetica）
      const numStr = String(it.page);
      const numW = numFont.widthOfTextAtSize(numStr, fs);
      page.drawText(numStr, { x: rightX - numW, y: yPt, size: fs, font: numFont, color });
      // 链接注解覆盖整行
      const link = ctx.obj({
        Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
        Rect: [titleX, yPt - fs * 1.4, rightX, yPt + fs * 0.4],
        A: ctx.register(ctx.obj({ Type: PDFName.of('Action'), S: PDFName.of('GoTo'), D: [tpage.ref, PDFName.of('Fit')] })),
      });
      pushAnnot(page, ctx, ctx.register(link));
      count++;
      yMm -= lineHmm;
      if (yMm < marginMm) break; // 超出页底则停止（简单保护）
    }

    const out = await doc.save();
    return { bytes: out, count };
  }

  // 读取 PDF 表单字段（供 UI 动态渲染）
  async function getFormFields(file) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes);
    let form;
    try { form = doc.getForm(); } catch (e) { return []; }
    if (!form) return [];
    return form.getFields().map((f) => {
      const name = f.getName();
      let type = 'unknown', value = null, options = null;
      try {
        if (f instanceof PDFTextField) { type = 'text'; value = f.getText(); }
        else if (f instanceof PDFCheckBox) { type = 'checkbox'; value = f.isChecked(); }
        else if (f instanceof PDFRadioGroup) { type = 'radio'; options = f.getOptions(); value = f.getSelected(); }
        else if (f instanceof PDFDropdown) { type = 'dropdown'; options = f.getOptions(); value = f.getSelected(); }
        else if (f instanceof PDFButton) { type = 'button'; }
      } catch (e) {}
      return { name, type, value, options };
    }).filter((f) => f.type !== 'unknown' && f.type !== 'button');
  }

  // P4-③ 导出表单域结构：复用 getFormFields 的字段分类，附加「所在页码」归属。
  // 返回 { fields:[{name,type,value,options,page}], count }；无名称/按钮类被跳过。
  async function exportFormFields(file, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    let form;
    try { form = doc.getForm(); } catch (e) { form = null; }
    if (!form) return { fields: [], count: 0 };

    // 预建 页面 → 控件引用 映射：用页面 Annots 的原始引用，控件即页面上的 widget annotation。
    const pages = doc.getPages();
    const pageOfWidget = new Map();
    for (let p = 0; p < pages.length; p++) {
      try {
        const annots = pages[p].node.lookup(PDFName.of('Annots'));
        if (annots && typeof annots.size === 'function') {
          for (let i = 0; i < annots.size(); i++) {
            const ref = annots.get(i);
            if (ref) pageOfWidget.set(ref.toString(), p + 1);
          }
        }
      } catch (e) {}
    }

    if (onProgress) onProgress({ done: 0, total: 0, phase: '读取表单字段' });

    const fields = form.getFields().map((f) => {
      const name = f.getName();
      let type = 'unknown', value = null, options = null;
      try {
        if (f instanceof PDFTextField) { type = 'text'; value = f.getText(); }
        else if (f instanceof PDFCheckBox) { type = 'checkbox'; value = f.isChecked(); }
        else if (f instanceof PDFRadioGroup) { type = 'radio'; options = f.getOptions(); value = f.getSelected(); }
        else if (f instanceof PDFDropdown) { type = 'dropdown'; options = f.getOptions(); value = f.getSelected(); }
        else if (f instanceof PDFButton) { type = 'button'; }
      } catch (e) {}
      // 单选/下拉可能返回数组（多选或单元素数组），统一为单值字符串，便于阅读与自动填表
      if ((type === 'radio' || type === 'dropdown') && Array.isArray(value)) {
        value = value.length === 1 ? value[0] : value;
      }
      // 页码归属：字段的 widget 引用在 acroField 的 /Kids 中（与页面 Annots 引用一致）
      let page = null;
      try {
        const af = f.acroField;
        const kids = af && af.dict ? af.dict.lookup(PDFName.of('Kids')) : null;
        const refs = [];
        if (kids && typeof kids.size === 'function' && kids.size() > 0) {
          for (let i = 0; i < kids.size(); i++) {
            const k = kids.get(i);
            if (k) refs.push(k instanceof PDFRef ? k : (k.ref || null));
          }
        } else {
          refs.push(f.ref || null);
        }
        for (const r of refs) {
          if (r && pageOfWidget.has(r.toString())) { page = pageOfWidget.get(r.toString()); break; }
        }
      } catch (e) {}
      return { name, type, value, options, page };
    }).filter((f) => f.type !== 'unknown' && f.type !== 'button');

    return { fields, count: fields.length };
  }

  // P6-④ 表单 FDF 导出：把 PDF 表单字段名/值导出为 Acrobat FDF（Forms Data Format）文件。
  // FDF 是纯文本的 PDF 子集（%FDF-1.2 … %%EOF），可被 Acrobat/Reader 导入回填。
  // 返回 { bytes: Uint8Array(FDF 文本), count, fields:[{name,type,value}] }；无表单返回空 FDF。
  async function exportFormFDF(file, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    let form;
    try { form = doc.getForm(); } catch (e) { form = null; }
    if (!form || typeof form.getFields !== 'function') {
      return { bytes: buildFDF([]), count: 0, fields: [] };
    }
    if (onProgress) onProgress({ done: 0, total: 0, phase: '读取表单字段' });
    const fields = [];
    form.getFields().forEach((f) => {
      let name = '';
      try { name = f.getName(); } catch (e) { return; }
      if (!name) return;
      let type = 'unknown', value = null;
      try {
        if (f instanceof PDFTextField) { type = 'text'; value = f.getText() || ''; }
        else if (f instanceof PDFCheckBox) { type = 'checkbox'; value = f.isChecked() ? true : false; }
        else if (f instanceof PDFRadioGroup) { type = 'radio'; let s = f.getSelected(); value = Array.isArray(s) ? (s[0] || '') : (s || ''); }
        else if (f instanceof PDFDropdown) { type = 'dropdown'; let s = f.getSelected(); value = Array.isArray(s) ? (s[0] || '') : (s || ''); }
        else if (f instanceof PDFButton) { type = 'button'; value = null; }
      } catch (e) {}
      if (type === 'unknown' || type === 'button') return;
      fields.push({ name, type, value });
    });
    if (onProgress) onProgress({ done: 1, total: 1, phase: '生成 FDF' });
    return { bytes: buildFDF(fields.map((f) => ({ name: f.name, value: fdfFieldValue(f) }))), count: fields.length, fields };
  }

  // 字段值 → FDF 的 /V 值：checkbox 勾选记为 "Yes"（标准导出态），未勾选记为 null（FDF 约定无值即未选）
  function fdfFieldValue(f) {
    if (f.type === 'checkbox') return f.value ? 'Yes' : null;
    if (f.value == null) return null;
    return String(f.value);
  }

  // FDF 字符串编码：纯 ASCII 用 (转义) 字面量；含非 ASCII 用 UTF-16BE + FEFF BOM 的 <hex> 形式，保证 CJK/emoji 不丢。
  function fdfStr(s) {
    s = s == null ? '' : String(s);
    let ascii = true;
    for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) > 0x7f) { ascii = false; break; } }
    if (ascii) return '(' + fdfEscape(s) + ')';
    let hex = 'FEFF';
    for (let i = 0; i < s.length; i++) hex += ('0000' + s.charCodeAt(i).toString(16)).slice(-4);
    return '<' + hex + '>';
  }

  function fdfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function fdfUnescape(s) {
    return String(s).replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
  }

  // UTF-16BE <hex> 串 → 字符串（含 BOM 自动跳过）
  function fdfHexToStr(hex) {
    let h = String(hex || '').replace(/\s/g, '');
    if (h.startsWith('FEFF')) h = h.slice(4);
    let out = '';
    for (let i = 0; i + 3 < h.length; i += 4) {
      const c = parseInt(h.substr(i, 4), 16);
      if (!isNaN(c)) out += String.fromCharCode(c);
    }
    return out;
  }

  // 组装 FDF 文档文本，并编码为 Uint8Array（UTF-8）
  function buildFDF(entries) {
    const lines = ['%FDF-1.2', '1 0 obj', '<< /FDF << /Fields ['];
    for (const e of entries) {
      let v = '';
      if (e.value !== null && e.value !== undefined) v = ' /V ' + fdfStr(e.value);
      lines.push('  << /T ' + fdfStr(e.name) + v + ' >>');
    }
    lines.push('] >> >>', 'endobj', 'trailer', '<< /Root 1 0 R >>', '%%EOF', '');
    const text = lines.join('\n');
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    return Uint8Array.from(Buffer.from(text, 'utf-8'));
  }

  // 解析 FDF（Acrobat Forms Data Format）为 [{name,value}] 数组，供 importFormFields 复用。
  // 按「字段字典」粒度（以 << /T 开头）精准匹配，避开 /FDF、/Fields 等容器嵌套把字段块吞掉的问题；
  // 名称/值支持字面量 (...) 与 <hex>（UTF-16BE）。
  function parseFDF(text) {
    const entries = [];
    const fieldRe = /<<\s*\/T\s*\((?:[^()\\]|\\.)*\)[\s\S]*?>>/g;
    let m;
    while ((m = fieldRe.exec(text))) {
      const inner = m[0].slice(2, -2).trim(); // 去掉首尾 << >>
      const name = fdfStrMatch(inner, 'T');
      if (name === null) continue;
      let value = fdfStrMatch(inner, 'V');
      if (value === null) {
        const hex = inner.match(/\/V\s*<([0-9A-Fa-f\s]*)>/);
        if (hex) value = fdfHexToStr(hex[1]);
      }
      entries.push({ name, value: value === null ? '' : value });
    }
    return entries;
  }

  function fdfStrMatch(body, key) {
    const re = new RegExp('/' + key + '\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)');
    const m = body.match(re);
    return m ? fdfUnescape(m[1]) : null;
  }

  // pdf-lib 默认用 WinAnsi 编码外观，CJK/emoji 等超 Latin-1 字符无法编码。
  // 检测后改为直接写原始 UTF-16 值到 V，并让 AcroForm 声明 NeedAppearances，
  // 由阅读器在打开时自行绘制外观，从而绕过编码限制。
  function isCJK(str) {
    if (!str) return false;
    for (const ch of String(str)) {
      if (ch.codePointAt(0) > 0xff) return true;
    }
    return false;
  }

  function setNeedAppearances(doc) {
    try {
      const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      if (acroForm) acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);
    } catch (e) {}
  }

  // 把 values（字段名 → 值）写入已加载文档的表单。被 fillForm 与 batchFillForms 复用。
  function applyValuesToDoc(doc, values) {
    const form = doc.getForm();
    let needRaw = false;
    for (const name in values) {
      try {
        const f = form.getField(name);
        if (f instanceof PDFTextField) {
          const v = String(values[name] == null ? '' : values[name]);
          if (isCJK(v)) {
            // 直接写原始 UTF-16 值，跳过 WinAnsi 外观编码
            f.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(v));
            f.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText(v));
            needRaw = true;
          } else {
            f.setText(v);
          }
        } else if (f instanceof PDFCheckBox) {
          const v = values[name];
          const s = String(v == null ? '' : v).toLowerCase();
          const on = v === true || s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === '是' || s === '✓' || v === 1;
          if (on) f.check(); else f.uncheck();
        } else if (f instanceof PDFRadioGroup || f instanceof PDFDropdown) {
          const v = values[name];
          if (v == null || v === '') continue;
          if (isCJK(String(v))) {
            f.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(String(v)));
            needRaw = true;
          } else {
            try { f.select(String(v)); }
            catch (e) {
              // 选项不存在等：兜底写原始值
              try { f.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(String(v))); needRaw = true; } catch (_) {}
            }
          }
        }
      } catch (e) {
        // 兜底：任何编码/找不到选项失败，都尝试写原始值
        try {
          const f = form.getField(name);
          const v = String(values[name] == null ? '' : values[name]);
          f.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(v));
          needRaw = true;
        } catch (_) {}
      }
    }
    if (needRaw) setNeedAppearances(doc);
    return needRaw;
  }

  async function fillForm(file, values, password, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);
    if (onProgress) onProgress({ done: 0, total: 0, phase: '填充表单' });
    applyValuesToDoc(doc, values);
    return doc.save();
  }

  // 解析字段映射文本（JSON / CSV）为 [{ name, value }]。
  // 支持的 JSON 形态：
  //   1) 对象字面量：{ "FullName": "John", "Agree": true }
  //   2) 数组：[{ "name": "FullName", "value": "John" }, ...]
  //   3) 导出工具产品：{ "fields": [{ "name": "...", "value": "..." }], "count": N }（与 exportFormFields 输出对接）
  // CSV 需含 name/字段名 与 value/值 两列（首行表头，大小写不敏感）。
  function parseFieldMapping(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) throw new Error('映射内容为空');
    // FDF（Acrobat Forms Data Format）：以 %FDF 开头或含 << /FDF 容器
    if (t.startsWith('%FDF') || /<<\s*\/FDF/.test(t)) {
      const entries = parseFDF(t);
      if (!entries.length) throw new Error('FDF 中未解析到任何 /T 字段条目');
      return entries.map((e) => ({ name: e.name, value: e.value }));
    }
    // JSON（以 { 或 [ 开头才尝试，避免把 CSV 误判）
    if (t[0] === '{' || t[0] === '[') {
      try {
        const obj = JSON.parse(t);
        if (Array.isArray(obj)) {
          return obj.map((e) => ({
            name: String(e && e.name != null ? e.name : (e.field != null ? e.field : '')),
            value: e && e.value != null ? e.value : (e.val != null ? e.val : (e.值 != null ? e.值 : null)),
          }));
        }
        if (obj && Array.isArray(obj.fields)) {
          return obj.fields.map((e) => ({
            name: String(e && e.name != null ? e.name : ''),
            value: e && e.value != null ? e.value : null,
          }));
        }
        if (obj && typeof obj === 'object') {
          return Object.keys(obj).map((k) => ({ name: k, value: obj[k] }));
        }
      } catch (e) { /* 非合法 JSON → 落到下方按 CSV 处理 */ }
    }
    // CSV
    const { headers, rows } = parseCSV(t);
    if (!headers.length) throw new Error('无法解析映射：请使用 JSON 或 CSV（含 name/字段名、value/值 列）');
    const nameCol = headers.findIndex((h) => /^(name|字段名|名称)$/i.test(h));
    const valCol = headers.findIndex((h) => /^(value|值)$/i.test(h));
    if (nameCol < 0 || valCol < 0) {
      throw new Error('CSV 需含 name/字段名 与 value/值 两列（首行表头）');
    }
    return rows.map((r) => ({
      name: String(r[nameCol] != null ? r[nameCol] : ''),
      value: r[valCol] != null ? r[valCol] : '',
    }));
  }

  // P5-① 表单域反向导入填充：把 JSON/CSV 映射回填进 PDF 表单字段，并产出匹配/缺失/跳过报告。
  // 与 P4-③ exportFormFields 形成闭环（导出的 form-fields.json 改 value 后可直接回灌）。
  // 返回 { bytes, report:{ total, matched, filled, missing:[name...], skippedEmpty:[name...] } }。
  async function importFormFields(file, mappingText, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, password);

    let form;
    try { form = doc.getForm(); } catch (e) { form = null; }
    if (!form || typeof form.getFields !== 'function' || form.getFields().length === 0) {
      throw new Error('该 PDF 不包含可填写的表单字段（请用「导出表单域结构」确认字段存在）');
    }
    // 现有字段名集合（含非按钮类，供匹配/缺失判定）
    const existing = new Set();
    try { form.getFields().forEach((f) => { try { existing.add(f.getName()); } catch (e) {} }); }
    catch (e) {}

    if (onProgress) onProgress({ done: 0, total: 0, phase: '解析映射' });
    const entries = parseFieldMapping(mappingText);

    const values = {};
    const matched = [];
    const missing = [];
    const skippedEmpty = [];
    for (const e of entries) {
      const name = String(e.name == null ? '' : e.name).trim();
      if (!name) continue;
      if (!existing.has(name)) { missing.push(name); continue; }
      matched.push(name);
      // 值：显式 null/undefined 视为不填（保留原值）；空字符串视为清除/取消勾选
      if (e.value === null || e.value === undefined) { skippedEmpty.push(name); continue; }
      values[name] = e.value;
      if (e.value === '' ) skippedEmpty.push(name);
    }

    if (onProgress) onProgress({ done: 1, total: 1, phase: '写入字段值' });
    applyValuesToDoc(doc, values);
    const out = await doc.save();

    return {
      bytes: out,
      report: {
        total: entries.length,
        matched: matched.length,
        filled: Object.keys(values).length,
        missing,
        skippedEmpty,
      },
    };
  }

  // 解析 CSV（RFC4180 风格的轻量实现）：支持字段引号包裹、双引号转义（""）、逗号字段、CRLF/LF。
  // 返回 { headers:[..], rows:[[..],..] }。首行为表头。自动去除 BOM 与表头两侧空白。
  function parseCSV(text) {
    const t = String(text == null ? '' : text).replace(/^﻿/, '');
    const records = [];
    let field = '';
    let record = [];
    let inQuotes = false;
    let i = 0;
    const n = t.length;
    while (i < n) {
      const ch = t[i];
      if (inQuotes) {
        if (ch === '"') {
          if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { record.push(field); field = ''; i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') { record.push(field); records.push(record); record = []; field = ''; i++; continue; }
        field += ch; i++; continue;
      }
    }
    if (field !== '' || record.length > 0) { record.push(field); records.push(record); }
    const cleaned = records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
    if (cleaned.length === 0) return { headers: [], rows: [] };
    const headers = cleaned[0].map((h) => h.trim());
    return { headers, rows: cleaned.slice(1) };
  }

  // 批量填表：模板 PDF + CSV（首行表头为字段名，每行一份），逐行生成一份填好的 PDF。
  // opts: { password, fileNameColumn }  —— fileNameColumn 指定用作输出文件名的列名，默认 row_001.pdf。
  // 返回 { files:[{name,bytes}], count, dataFields, headers, rows }。
  async function batchFillForms(file, csvText, opts, onProgress) {
    opts = opts || {};
    const password = opts.password || null;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const { headers, rows } = parseCSV(csvText);
    if (headers.length === 0 || rows.length === 0) {
      throw new Error('CSV 为空或缺少表头/数据行');
    }
    // 文件名列识别（列名命中其一则用作输出文件名；刻意避开 name/名称 等常见字段名以防劫持真实字段）
    const nameKeys = ['filename', '文件名', '输出文件名', 'outname', '__filename'];
    let nameCol = -1;
    for (let c = 0; c < headers.length; c++) {
      if (nameKeys.includes(headers[c].toLowerCase())) { nameCol = c; break; }
    }
    const dataFields = headers.filter((h) => h && !nameKeys.includes(h.toLowerCase()));
    // 预检模板是否含表单（pdf-lib 的 getForm() 在无形单文档上不会抛错，而是返回无字段的空表单）
    const probe = await loadDoc(bytes, password);
    let hasFields = false;
    try {
      const f = probe.getForm();
      if (f && typeof f.getFields === 'function' && f.getFields().length > 0) hasFields = true;
    } catch (e) { /* 部分版本在无 AcroForm 时抛错，视为无字段 */ }
    if (!hasFields) {
      throw new Error('模板 PDF 不包含可填写的表单字段（请用「表单填写」工具确认字段存在）');
    }
    const files = [];
    const total = rows.length;
    for (let r = 0; r < rows.length; r++) {
      if (onProgress) onProgress({ done: r, total, phase: '填充第 ' + (r + 1) + ' / ' + total + ' 行' });
      const row = rows[r];
      const values = {};
      for (let c = 0; c < headers.length; c++) {
        if (c === nameCol) continue;
        const key = headers[c];
        if (!key) continue;
        values[key] = row[c] != null ? row[c] : '';
      }
      const doc = await loadDoc(bytes, password);
      applyValuesToDoc(doc, values);
      const out = await doc.save();
      let fname = 'row_' + String(r + 1).padStart(3, '0') + '.pdf';
      if (nameCol >= 0 && row[nameCol]) {
        fname = String(row[nameCol]).replace(/[\\/:*?"<>|]/g, '_').trim() || fname;
        if (!/\.pdf$/i.test(fname)) fname += '.pdf';
      }
      files.push({ name: fname, bytes: out });
    }
    if (onProgress) onProgress({ done: total, total, phase: '完成' });
    return { files, count: files.length, dataFields, headers, rows: rows.length };
  }

  // 表单扁平化：把字段值画成静态层后删除全部字段，使内容不可再编辑。
  // 说明：CJK 字段走 NeedAppearances（无烘焙外观），故统一用 canvas 覆盖（复用 textToImage），保证中文正确显示。
  function readWidgetRect(w) {
    try {
      const r = w.dict.lookup(PDFName.of('Rect'));
      if (!r || r.size() < 4) return null;
      return r.asArray().map((n) => (typeof n.asNumber === 'function' ? n.asNumber() : n.value));
    } catch (e) { return null; }
  }

  function findPageOfWidget(doc, w) {
    const pages = doc.getPages();
    for (const pg of pages) {
      const annots = pg.node.lookup(PDFName.of('Annots'));
      if (!annots || !annots.size) continue;
      for (let i = 0; i < annots.size(); i++) {
        if (annots.lookup(i) === w.dict) return pg;
      }
    }
    return null;
  }

  async function textToImagePng(doc, text, opts) {
    try {
      const blob = await textToImage(text, {
        fontSize: opts.fontSize || 11, color: opts.color || '#333333',
        opacity: 1, font: opts.font || 'sans-serif', fontWeight: opts.fontWeight || 'normal', angleDeg: 0,
      });
      const bytes = await blobToBytes(blob);
      const img = await doc.embedPng(bytes);
      const ratio = ((opts.fontSize || 11) / img.height) * 1.4;
      return { img, w: img.width * ratio, h: img.height * ratio };
    } catch (e) { return null; }
  }

  async function drawFieldVisual(doc, page, rect, type, value, opts) {
    const [x1, y1, x2, y2] = rect;
    const w = x2 - x1, h = y2 - y1;
    const color = opts.color || '#111111';
    if (type === 'checkbox') {
      if (!value) return;
      const size = Math.min(w, h);
      const fs = Math.max(8, size * 0.8);
      const g = await textToImagePng(doc, '✓', { fontSize: fs, color, fontWeight: 'bold' });
      if (!g) return;
      page.drawImage(g.img, { x: x1 + (w - g.w) / 2, y: y1 + (h - g.h) / 2, width: g.w, height: g.h });
      return;
    }
    if (type === 'radio') {
      if (!value) return;
      const cx = x1 + w / 2, cy = y1 + h / 2, r = Math.min(w, h) * 0.28;
      page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, color: hexToRgb(color) });
      return;
    }
    const text = (value == null) ? '' : String(value).replace(/\r?\n/g, ' ');
    if (!text.trim()) return;
    const fs = Math.max(6, Math.min(h * 0.72, 14));
    const g = await textToImagePng(doc, text, { fontSize: fs, color });
    if (!g) return;
    let iw = g.w, ih = g.h;
    if (iw > w) { const s = w / iw; iw *= s; ih *= s; }
    page.drawImage(g.img, { x: x1 + 2, y: y1 + (h - ih) / 2, width: iw, height: ih });
  }

  async function flattenForms(file, opts, onProgress) {
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts && opts.password);
    let form;
    try { form = doc.getForm(); } catch (e) { return doc.save(); }
    if (!form) return doc.save();
    const fields = form.getFields();
    if (!fields.length) return doc.save();
    if (!opts) opts = {};
    if (onProgress) onProgress({ done: 0, total: fields.length, phase: '表单扁平化' });
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      let type = 'unknown', value = null;
      try {
        if (f instanceof PDFTextField) { type = 'text'; value = f.getText(); }
        else if (f instanceof PDFCheckBox) { type = 'checkbox'; value = f.isChecked(); }
        else if (f instanceof PDFRadioGroup) { type = 'radio'; value = f.getSelected(); }
        else if (f instanceof PDFDropdown) { type = 'dropdown'; value = f.getSelected(); }
      } catch (e) {}
      const widgets = (f.acroField && f.acroField.getWidgets) ? f.acroField.getWidgets() : [];
      for (const w of widgets) {
        const page = findPageOfWidget(doc, w);
        if (!page) continue;
        const r = readWidgetRect(w);
        if (!r) continue;
        if (type === 'radio') {
          let on = false;
          try { const as = w.dict.lookup(PDFName.of('AS')); on = !!(as && as.asString && as.asString() !== 'Off'); } catch (e) { on = !!value; }
          await drawFieldVisual(doc, page, r, 'radio', on, opts);
        } else if (type === 'checkbox') {
          await drawFieldVisual(doc, page, r, 'checkbox', value, opts);
        } else {
          await drawFieldVisual(doc, page, r, 'text', value, opts);
        }
      }
      if (onProgress) onProgress({ done: i + 1, total: fields.length, phase: '表单扁平化' });
    }
    for (const f of fields) { try { form.removeField(f); } catch (e) {} }
    try {
      const acro = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      if (acro) acro.set(PDFName.of('NeedAppearances'), PDFBool.False);
    } catch (e) {}
    return doc.save();
  }

  /* ===================== 数字签名（P0-②） =====================
   * 纯前端实现：自签 X.509 v3 证书（WebCrypto RSA-2048）+ 手工构造 PKCS#7
   * detached 签名，写回 PDF 的 /ByteRange 与 /Contents 占位区。零依赖。
   * - 采用「先占位、保存后字节回填」：保存时用固定宽度占位符（16384 hex + 10位 ByteRange），
   *   定位占位区 → 计算 ByteRange → 哈希 → 签名 → 回填，文件长度不变，哈希不受影响。
   * - 验证：解析原文 ByteRange 重算哈希，并解析 PKCS#7 校验签名与 messageDigest。
   */
  const subtle = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle)
    ? globalThis.crypto.subtle
    : (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);

  function bytesOf(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
  function concatBytes(arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }
  function indexOfBytes(hay, needle, from) { const hl = hay.length, nl = needle.length; if (nl === 0) return -1; outer: for (let i = (from || 0); i <= hl - nl; i++) { for (let j = 0; j < nl; j++) { if (hay[i + j] !== needle[j]) continue outer; } return i; } return -1; }
  function derLen(n) { if (n < 128) return [n]; const b = []; while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); } return [0x80 | b.length, ...b]; }
  function seqBytes(...p) { const b = concatBytes(p); return concatBytes([Uint8Array.from([0x30]), Uint8Array.from(derLen(b.length)), b]); }
  function setOfBytes(...p) { const b = concatBytes(p); return concatBytes([Uint8Array.from([0x31]), Uint8Array.from(derLen(b.length)), b]); }
  function octetBytes(b) { return concatBytes([Uint8Array.from([0x04]), Uint8Array.from(derLen(b.length)), b]); }
  function bitStringBytes(b) { return concatBytes([Uint8Array.from([0x03]), Uint8Array.from(derLen(b.length + 1)), Uint8Array.from([0x00]), b]); }
  function integerBytes(b) { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.subarray(i); if (b[0] & 0x80) b = concatBytes([Uint8Array.from([0x00]), b]); return concatBytes([Uint8Array.from([0x02]), Uint8Array.from(derLen(b.length)), b]); }
  function oidBytes(s) { const parts = s.split('.').map(Number); const out = [parts[0] * 40 + parts[1]]; for (let i = 2; i < parts.length; i++) { let v = parts[i]; const t = []; if (v === 0) t.push(0); else { while (v > 0) { t.unshift(v & 0x7f); v = Math.floor(v / 128); } for (let j = 0; j < t.length - 1; j++) t[j] |= 0x80; } out.push(...t); } return concatBytes([Uint8Array.from([0x06]), Uint8Array.from(derLen(out.length)), Uint8Array.from(out)]); }
  function nullBytes() { return Uint8Array.from([0x05, 0x00]); }
  function utf8Bytes(s) { const b = bytesOf(s); return concatBytes([Uint8Array.from([0x0c]), Uint8Array.from(derLen(b.length)), b]); }
  function utcBytes(d) { const p = (x) => String(x).padStart(2, '0'); const s = p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z'; return concatBytes([Uint8Array.from([0x17]), Uint8Array.from([s.length]), bytesOf(s)]); }
  function ctxTagBytes(tag, b) { return concatBytes([Uint8Array.from([0xA0 | tag]), Uint8Array.from(derLen(b.length)), b]); }
  function rdnBytes(o, s) { return seqBytes(seqBytes(oidBytes(o), utf8Bytes(s))); }
  function nameBytes(attrs) { return seqBytes(...attrs.filter(a => a[1]).map(([o, s]) => rdnBytes(o, s))); }
  function toHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; }
  function hexToBytes(h) { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
  function bufEqual(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

  function parseTLV(buf, off) { const tag = buf[off]; const h0 = off + 1; let l = buf[h0]; let p = h0 + 1; if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) { l = l * 256 + buf[p + i]; } p += n; } const contentStart = p, contentEnd = p + l; return { tag, start: off, headerEnd: p, contentStart, contentEnd }; }
  function walkTLV(buf, start, end, cb) { let p = start; while (p < end) { const t = parseTLV(buf, p); cb(t); p = t.contentEnd; } }
  function isOid(buf, dotted) { const parts = dotted.split('.').map(Number); const out = [parts[0] * 40 + parts[1]]; for (let i = 2; i < parts.length; i++) { let v = parts[i]; const t = []; if (v === 0) t.push(0); else { while (v > 0) { t.unshift(v & 0x7f); v = Math.floor(v / 128); } for (let j = 0; j < t.length - 1; j++) t[j] |= 0x80; } out.push(...t); } if (buf.length !== out.length) return false; for (let i = 0; i < out.length; i++) if (buf[i] !== out[i]) return false; return true; }
  function decodeDerStr(buf, node) { let s = ''; for (let i = node.contentStart; i < node.contentEnd; i++) s += String.fromCharCode(buf[i]); return s; }

  async function makeCert(opts) {
    const cn = opts.commonName || 'Signer', o = opts.organization || '', c = opts.country || '';
    const kp = await subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: opts.modulusLength || 2048, publicExponent: new Uint8Array([1, 0, 0, 1]), hash: { name: 'SHA-256' } },
      true, ['sign', 'verify']);
    const spki = new Uint8Array(await subtle.exportKey('spki', kp.publicKey));
    const serial = new Uint8Array(16);
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(serial);
    else for (let i = 0; i < 16; i++) serial[i] = Math.floor(Math.random() * 256);
    serial[0] &= 0x7f; if (serial[0] === 0) serial[0] = 1;
    const now = new Date(); const nb = new Date(now.getTime() - 2000); const na = new Date(now.getTime() + (opts.validityYears || 2) * 365.25 * 864e5);
    const subj = nameBytes([['2.5.4.6', c], ['2.5.4.10', o], ['2.5.4.3', cn]]);
    const tbs = seqBytes(
      ctxTagBytes(0, integerBytes(new Uint8Array([2]))),               // version v3 = INTEGER 2
      integerBytes(serial),                                            // serialNumber
      seqBytes(oidBytes('1.2.840.113549.1.1.11'), nullBytes()),       // signature algorithm
      subj,                                                           // issuer
      seqBytes(utcBytes(nb), utcBytes(na)),                           // validity
      subj,                                                           // subject
      spki,                                                           // subjectPublicKeyInfo
      ctxTagBytes(3, seqBytes(                                        // extensions [3] EXPLICIT
        seqBytes(oidBytes('2.5.29.19'), octetBytes(seqBytes(integerBytes(new Uint8Array([1]))))),   // basicConstraints CA:TRUE
        seqBytes(oidBytes('2.5.29.15'), octetBytes(bitStringBytes(new Uint8Array([0xC0]))))         // keyUsage digitalSignature
      ))
    );
    const sig = new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, tbs));
    const cert = seqBytes(tbs, seqBytes(oidBytes('1.2.840.113549.1.1.11'), nullBytes()), bitStringBytes(sig));
    return { cert, spki, privKey: kp.privateKey, serial, subject: subj };
  }

  async function buildPKCS7(opts) {
    const docHash = new Uint8Array(await subtle.digest('SHA-256', opts.docBytes));
    const ctAttr = seqBytes(oidBytes('1.2.840.113549.1.9.3'), setOfBytes(oidBytes('1.2.840.113549.1.7.1')));
    const mdAttr = seqBytes(oidBytes('1.2.840.113549.1.9.4'), setOfBytes(octetBytes(docHash)));
    const stAttr = seqBytes(oidBytes('1.2.840.113549.1.9.5'), setOfBytes(utcBytes(opts.signingTime || new Date())));
    const inner = concatBytes([ctAttr, mdAttr, stAttr]);
    const attrsSet = setOfBytes(inner);                                // 签名是对此 SET(0x31) DER 计算
    const sig = new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', opts.privKey, attrsSet));
    const signerInfo = seqBytes(
      integerBytes(new Uint8Array([1])),
      seqBytes(opts.subject, integerBytes(opts.serial)),
      seqBytes(oidBytes('2.16.840.1.101.3.4.2.1'), nullBytes()),
      ctxTagBytes(0, inner),                                          // authenticatedAttributes [0] IMPLICIT
      seqBytes(oidBytes('1.2.840.113549.1.1.1'), nullBytes()),
      octetBytes(sig)
    );
    const signedData = seqBytes(
      integerBytes(new Uint8Array([1])),
      setOfBytes(seqBytes(oidBytes('2.16.840.1.101.3.4.2.1'), nullBytes())),
      seqBytes(oidBytes('1.2.840.113549.1.7.1')),
      ctxTagBytes(0, opts.cert),                                      // certificates [0] IMPLICIT
      setOfBytes(signerInfo)
    );
    return seqBytes(oidBytes('1.2.840.113549.1.7.2'), ctxTagBytes(0, signedData));
  }

  async function signPDF(file, opts) {
    if (!subtle) throw new Error('当前环境不支持 WebCrypto，无法签名');
    opts = opts || {};
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    const ctx = doc.context;
    let acroRef = doc.catalog.get(PDFName.of('AcroForm'));
    let fieldsArr = null;
    if (acroRef instanceof PDFRef) {
      const d = ctx.lookup(acroRef, PDFDict);
      if (d) { const f = d.get(PDFName.of('Fields')); if (f instanceof PDFRef) fieldsArr = ctx.lookup(f, PDFArray); }
    }
    if (!fieldsArr) {
      fieldsArr = PDFArray.withContext(ctx);
      const acroDict = ctx.obj({ Fields: fieldsArr, SigFlags: PDFNumber.of(3) });
      acroRef = ctx.register(acroDict);
      doc.catalog.set(PDFName.of('AcroForm'), acroRef);
    }
    const reserved = 8192;                                            // PKCS#7 预留空间（字节）
    const ph = bytesOf('0'.repeat(reserved * 2));                    // /Contents 占位 hex（固定长度）
    const sigDict = ctx.obj({
      Type: PDFName.of('Sig'), Filter: PDFName.of('Adobe.PPKLite'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      Contents: PDFHexString.of('0'.repeat(reserved * 2)),
      ByteRange: ctx.obj([9999999999, 9999999999, 9999999999, 9999999999]),
      M: PDFString.fromDate(new Date()),
    });
    if (opts.reason) sigDict.set(PDFName.of('Reason'), PDFHexString.fromText(opts.reason));
    if (opts.location) sigDict.set(PDFName.of('Location'), PDFHexString.fromText(opts.location));
    if (opts.contact) sigDict.set(PDFName.of('ContactInfo'), PDFHexString.fromText(opts.contact));
    if (opts.name) sigDict.set(PDFName.of('Name'), PDFHexString.fromText(opts.name));
    const sigRef = ctx.register(sigDict);
    const fieldDict = ctx.obj({
      FT: PDFName.of('Sig'), T: PDFHexString.fromText(opts.fieldName || 'Signature1'),
      V: sigRef, Ff: PDFNumber.of(0),
      Subtype: PDFName.of('Widget'), Rect: ctx.obj([0, 0, 0, 0]), F: PDFNumber.of(4),
    });
    const fieldRef = ctx.register(fieldDict);
    fieldsArr.push(fieldRef);
    const saved = await doc.save({ useObjectStreams: false });        // 关闭对象流，保证占位符在明文
    const phIdx = indexOfBytes(saved, ph);
    if (phIdx < 0) throw new Error('签名占位符未找到');
    const gapStart = phIdx, gapEnd = phIdx + ph.length;
    const brPlaceholder = bytesOf('9999999999 9999999999 9999999999 9999999999');
    const brIdx = indexOfBytes(saved, brPlaceholder);
    if (brIdx < 0) throw new Error('ByteRange 占位符未找到');
    const brStr = bytesOf([0, gapStart, gapEnd, saved.length - gapEnd].map(n => String(n).padStart(10, '0')).join(' '));
    // 先把 /ByteRange 占位符替换为最终值，得到“中间文件”（/Contents 仍为占位符）。
    // 这样计算摘要时覆盖的区域已包含最终的 /ByteRange 声明，与最终落盘文件完全一致。
    const intermediate = concatBytes([saved.subarray(0, brIdx), brStr, saved.subarray(brIdx + brPlaceholder.length)]);
    const covered = concatBytes([intermediate.subarray(0, gapStart), intermediate.subarray(gapEnd)]);  // ByteRange 覆盖区域
    const cert = await makeCert({ commonName: opts.name || 'Signer', organization: opts.organization || '', country: opts.country || '', validityYears: opts.validityYears || 2, modulusLength: opts.modulusLength || 2048 });
    const pkcs7 = await buildPKCS7({ cert: cert.cert, privKey: cert.privKey, subject: cert.subject, serial: cert.serial, docBytes: covered, signingTime: new Date() });
    if (pkcs7.length > reserved) throw new Error('PKCS#7 超出预留空间: ' + pkcs7.length);
    const pkcs7Hex = bytesOf(toHex(pkcs7).padEnd(reserved * 2, '0'));
    // 等长回填 /Contents（占位符与 PKCS#7 hex 长度一致，文件长度不变）。
    // 中间文件中 /Contents 仍在 gapStart..gapEnd，且位于 /ByteRange 之前，直接切片替换即可。
    const result = concatBytes([intermediate.subarray(0, gapStart), pkcs7Hex, intermediate.subarray(gapEnd)]);
    return result;
  }

  async function verifyPDFSignature(file) {
    if (!subtle) return { valid: false, error: '当前环境不支持 WebCrypto' };
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const brMarker = bytesOf('/ByteRange');
    const brIdx = indexOfBytes(bytes, brMarker);
    if (brIdx < 0) return { valid: false, error: 'no ByteRange' };
    const open = indexOfBytes(bytes, bytesOf('['), brIdx);
    const close = indexOfBytes(bytes, bytesOf(']'), brIdx);
    if (open < 0 || close < 0) return { valid: false, error: 'bad ByteRange' };
    const nums = []; let cur = '';
    for (let i = open + 1; i < close; i++) { const ch = String.fromCharCode(bytes[i]); if (ch >= '0' && ch <= '9') cur += ch; else if (cur) { nums.push(Number(cur)); cur = ''; } }
    if (cur) nums.push(Number(cur));
    if (nums.length !== 4) return { valid: false, error: 'bad ByteRange' };
    const br = nums;
    const cMarker = bytesOf('/Contents');
    const cIdx = indexOfBytes(bytes, cMarker);
    if (cIdx < 0) return { valid: false, error: 'no Contents' };
    const lt = indexOfBytes(bytes, bytesOf('<'), cIdx);
    const gt = indexOfBytes(bytes, bytesOf('>'), lt + 1);
    if (lt < 0 || gt < 0) return { valid: false, error: 'bad Contents' };
    // /Contents 是 PDF 十六进制字符串，区域内是 ASCII 形式的十六进制文本，需先按 Latin1 还原成十六进制字符串再解码
    const ascii = bytes.subarray(lt + 1, gt);
    let hex = '';
    for (let i = 0; i < ascii.length; i++) hex += String.fromCharCode(ascii[i]);
    const p7 = hexToBytes(hex);
    const covered = concatBytes([bytes.subarray(br[0], br[0] + br[1]), bytes.subarray(br[2], br[2] + br[3])]);
    const docHash = new Uint8Array(await subtle.digest('SHA-256', covered));
    const ciNode = parseTLV(p7, 0);
    let sdWrap = null; walkTLV(p7, ciNode.contentStart, ciNode.contentEnd, (t) => { if (t.tag === 0xA0) sdWrap = t; });
    if (!sdWrap) return { valid: false, error: 'no SignedData' };
    const sdNode = parseTLV(p7, sdWrap.contentStart);
    let certBytes = null, signerInfosBytes = null;
    walkTLV(p7, sdNode.contentStart, sdNode.contentEnd, (t) => {
      if (t.tag === 0xA0) certBytes = p7.subarray(t.contentStart, t.contentEnd);
      else if (t.tag === 0x31) { const first = parseTLV(p7, t.contentStart); if (first.tag === 0x30) { const v = parseTLV(p7, first.contentStart); if (v.tag === 0x02) signerInfosBytes = p7.subarray(t.contentStart, t.contentEnd); } }
    });
    if (!certBytes) return { valid: false, error: 'no cert' };
    if (!signerInfosBytes) return { valid: false, error: 'no signerInfo' };
    const certSeq = parseTLV(certBytes, 0); const tbsT = parseTLV(certBytes, certSeq.contentStart);
    const cchildren = []; walkTLV(certBytes, tbsT.contentStart, tbsT.contentEnd, (t) => cchildren.push(t));
    const spkiT = cchildren[6]; if (!spkiT) return { valid: false, error: 'no spki' };
    const spkiBytes = certBytes.subarray(spkiT.start, spkiT.contentEnd);
    const siNode = parseTLV(signerInfosBytes, 0);
    const sich = []; walkTLV(signerInfosBytes, siNode.contentStart, siNode.contentEnd, (t) => sich.push(t));
    let attrsInnerStart = null, attrsInnerEnd = null, encDigest = null;
    for (const t of sich) { if (t.tag === 0xA0) { attrsInnerStart = t.contentStart; attrsInnerEnd = t.contentEnd; } if (t.tag === 0x04) encDigest = signerInfosBytes.subarray(t.contentStart, t.contentEnd); }
    if (attrsInnerStart == null || !encDigest) return { valid: false, error: 'no attrs/digest' };
    const innerLen = attrsInnerEnd - attrsInnerStart;
    const attrsSet = concatBytes([Uint8Array.from([0x31]), Uint8Array.from(derLen(innerLen)), signerInfosBytes.subarray(attrsInnerStart, attrsInnerEnd)]);
    const attrsInner = signerInfosBytes.subarray(attrsInnerStart, attrsInnerEnd);
    let msgDigest = null;
    walkTLV(attrsInner, 0, attrsInner.length, (t) => {
      if (t.tag === 0x30) { const oidT = parseTLV(attrsInner, t.contentStart); const o = attrsInner.subarray(oidT.contentStart, oidT.contentEnd);
        if (isOid(o, '1.2.840.113549.1.9.4')) { const setT = parseTLV(attrsInner, oidT.contentEnd); const octT = parseTLV(attrsInner, setT.contentStart); msgDigest = attrsInner.subarray(octT.contentStart, octT.contentEnd); } }
    });
    if (!msgDigest) return { valid: false, error: 'no messageDigest attr' };
    const mdOk = bufEqual(msgDigest, docHash);
    let sigOk = false, signer = null;
    try {
      const pubKey = await subtle.importKey('spki', spkiBytes, { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, false, ['verify']);
      sigOk = await subtle.verify('RSASSA-PKCS1-v1_5', pubKey, encDigest, attrsSet);
      const subjNode = cchildren[5];
      if (subjNode) { walkTLV(certBytes, subjNode.contentStart, subjNode.contentEnd, (t) => { if (t.tag === 0x30) { const atv = parseTLV(certBytes, t.contentStart); const oidT = parseTLV(certBytes, atv.contentStart); const o = certBytes.subarray(oidT.contentStart, oidT.contentEnd); const valNode = parseTLV(certBytes, oidT.contentEnd); if (isOid(o, '2.5.4.3')) signer = decodeDerStr(certBytes, valNode); } }); }
    } catch (e) { sigOk = false; }
    return { valid: mdOk && sigOk, mdOk, sigOk, signer };
  }

  /* ===================== OCR（本地 · 文件不出设备） ===================== */
  // 设计要点：
  //  - 用 pdf.js 把每一页栅格化成位图（canvas）。
  //  - 用 tesseract.js（wasm，跑在 Web Worker 里）做文字识别，PDF 字节始终留在本地。
  //  - 默认 core/wasm 与语言包走 tesseract.js 官方 CDN，首次联网下载、浏览器缓存后离线可用；
  //    OCR 计算本身全部在本地完成，用户文件不上传。
  //  - 如需完全离线，把 tesseract 的 corePath/langPath 指向本地 vendored 副本即可（见 OCR_CONFIG）。
  const OCR_CONFIG = {
    langs: 'chi_sim+eng',
    workerPath: 'assets/vendor/tesseract/worker.min.js',
    // corePath / langPath 留空则用 tesseract.js 4.1.3 自带默认 CDN（首次下载、浏览器缓存后离线可用）。
    // 已在真实浏览器实测：tesseract.js 5.x 在 createWorker 阶段即抛库内 `x.map is not a function`（库级兼容问题），
    // 4.1.3 稳定可用，故 vendored 固定为 4.1.3。
    // langPath 默认指向 GitHub tessdata_fast 镜像（非 gz）：
    //   tesseract.js 官方默认语言包源 tessdata.projectnaptha.com 曾出现连接挂起（fetch 一直 pending、无报错，
    //   卡在「加载 OCR 模型…」），故改用实测可达的 GitHub 镜像；因该镜像为 .traineddata 非 gz，须配 gzip:false
    //   （见 getOcrWorker 的 opts.gzip）。如需切回官方 gz 源，把 langPath 置空并去掉 opts.gzip=false 即可。
    corePath: '',
    langPath: 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/',
    // 中文可检索层：填一个 CJK TrueType(.ttf) 的 URL 以启用「中文烤入文本层」；
    // 留空则中文仅抽取为文本，不烤入 PDF（避免没有中文字体时报错）。
    cjkFontUrl: '',
    scale: 3, // 栅格化倍率，越大识别越准但越慢/越吃内存
  };

  let _ocrWorker = null;
  let _ocrLangs = null;

  async function getOcrWorker(langs, onProgress) {
    if (!globalThis.Tesseract) throw new Error('Tesseract 未加载（缺少 assets/vendor/tesseract/tesseract.min.js）');
    if (!_ocrWorker || _ocrLangs !== langs) {
      if (_ocrWorker) { try { await _ocrWorker.terminate(); } catch (e) {} _ocrWorker = null; }
      if (onProgress) onProgress({ phase: '加载 OCR 模型…' });
      // 注意：不要把 logger 回调塞进 createWorker 的 opts —— 本 vendored 版本会把 opts 整体 postMessage
      // 给 Worker，函数无法结构化克隆，直接抛 DataCloneError（即长期被误判为 CDN 受限的错误）。
      // 故去掉 logger：仅丢失「下载模型 x%」细分百分比，阶段提示与识别/烤字进度仍由外层 onProgress 上报。
      const opts = { workerPath: OCR_CONFIG.workerPath };
      if (OCR_CONFIG.corePath) opts.corePath = OCR_CONFIG.corePath;
      if (OCR_CONFIG.langPath) { opts.langPath = OCR_CONFIG.langPath; opts.gzip = false; }
      _ocrWorker = await globalThis.Tesseract.createWorker(opts);
      await _ocrWorker.loadLanguage(langs);
      await _ocrWorker.initialize(langs);
      _ocrLangs = langs;
    }
    return _ocrWorker;
  }

  // 对单个 PDF 文件做 OCR，返回结构化结果。
  // 返回：{ pages:[{page,width,height,text,words:[{text,confidence,x0,y0,x1,y1}],confidence}], fullText, lang, pageCount }
  async function ocrPDF(fileOpts, opts = {}, onProgress) {
    const { file } = fileOpts;
    if (!globalThis.pdfjsLib) throw new Error('pdf.js 未加载');
    const pdfjs = globalThis.pdfjsLib;
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: buf, password: opts.password || '' }).promise;
    const n = pdf.numPages;
    const langs = opts.langs || OCR_CONFIG.langs;
    const worker = await getOcrWorker(langs, onProgress);
    const S = OCR_CONFIG.scale;
    const pages = [];
    let fullText = '';
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: S });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (onProgress) onProgress({ phase: `识别第 ${i}/${n} 页`, done: i - 1, total: n });
      const { data } = await worker.recognize(canvas);
      const words = (data.words || []).map((w) => ({
        text: w.text, confidence: w.confidence,
        x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
      }));
      const text = (data.text || '').replace(/\s+$/g, '');
      pages.push({ page: i, width: base.width, height: base.height, text, words, confidence: data.confidence });
      fullText += (fullText ? '\n' : '') + (text || '');
      if (page.cleanup) page.cleanup();
      if (onProgress) onProgress({ phase: `识别第 ${i}/${n} 页`, done: i, total: n });
    }
    if (onProgress) onProgress({ phase: '完成', done: n, total: n });
    return { pages, fullText: fullText.trim(), lang: langs, pageCount: n };
  }

  // 把 OCR 结果烤成「可检索文本层」：原扫描图作为可见内容，文字以透明层叠加上去（可选中/可复制/可搜索）。
  // 坐标换算：pdf.js 以 scale=S 渲染，1 PDF 点 = S 像素；故像素坐标 / S 即得 PDF 用户空间坐标（点）。
  async function makeSearchablePDF(fileOpts, ocrResult, opts = {}, onProgress) {
    const { file } = fileOpts;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { password: opts.password || '' });
    const S = OCR_CONFIG.scale;
    const pages = doc.getPages();

    let cjkFont = null;
    const needCJK = (ocrResult.pages || []).some((p) => /[㐀-鿿豈-﫿]/.test(p.text || ''));
    if (needCJK && OCR_CONFIG.cjkFontUrl) {
      try {
        const r = await fetch(OCR_CONFIG.cjkFontUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ab = await r.arrayBuffer();
        cjkFont = await doc.embedFont(new Uint8Array(ab), { subset: true });
      } catch (e) { cjkFont = null; }
    }
    const baseFont = cjkFont || await doc.embedFont(StandardFonts.Helvetica);

    let drawn = 0, skipped = 0;
    const total = Math.min(pages.length, (ocrResult.pages || []).length);
    for (let i = 0; i < total; i++) {
      const ocrPage = ocrResult.pages[i];
      if (!ocrPage || !ocrPage.words || !ocrPage.words.length) { if (onProgress) onProgress({ phase: `第 ${i + 1}/${total} 页（无文字）`, done: i + 1, total }); continue; }
      const page = pages[i];
      const { height: H } = page.getSize(); // 页面高度（点）
      for (const w of ocrPage.words) {
        const text = (w.text || '').trim();
        if (!text) continue;
        const x = w.x0 / S;
        const y = H - w.y1 / S;
        const size = Math.max(1, ((w.y1 - w.y0) / S) * 0.92);
        if (x < -50 || x > 1e5 || y < -50 || y > 1e5) continue;
        try {
          page.drawText(text, { x, y, size, font: baseFont, color: rgb(0, 0, 0), opacity: 0.0 });
          drawn++;
        } catch (e) { skipped++; } // 字符无法用当前字体编码（如中文且未嵌中文字体）→ 跳过
      }
      if (onProgress) onProgress({ phase: `烤入第 ${i + 1}/${total} 页`, done: i + 1, total });
    }
    const out = await doc.save();
    return { bytes: out, drawn, skipped, cjkEmbedded: !!cjkFont };
  }

  // ===== P0-④ 导出 Office：PDF → Word(.docx) / Excel(.xlsx) =====
  // 纯本地：文本由 pdf.js 提取，文档由 vendored 的 docx / SheetJS 在浏览器内生成，文件不上传。

  // 用 pdf.js 提取每页文本（含坐标/字号/粗斜体信息），供 Word/Excel 复用。
  async function extractPdfText(file, opts, onProgress) {
    const buf = await resolveBytes(file);   // 兼容 {file}/ {bytes}/裸Uint8Array（调用方均传 {file} 包装，此前取 file.arrayBuffer() 会在浏览器报错）
    const pdf = await pdfjsLib.getDocument({ data: buf, password: opts.password || '' }).promise;
    const pages = [];
    const n = pdf.numPages;
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = (tc.items || []).map((it) => {
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        const x = t[4], y = t[5];
        const size = Math.abs(t[3]) || Math.abs(t[0]) || 11;
        const fn = it.fontName || '';
        return {
          x, y,
          str: it.str || '',
          w: it.width || 0,
          h: it.height || size * 0.8,
          fontName: fn,
          bold: /bold/i.test(fn),
          italic: /italic|oblique/i.test(fn),
          size,
          hasEOL: !!it.hasEOL,
        };
      });
      pages.push({ width: vp.width, height: vp.height, items });
      if (onProgress) onProgress({ phase: `提取第 ${i}/${n} 页文本`, done: i, total: n });
    }
    await pdf.destroy();
    return { pages, pageCount: n };
  }

  // 按 y 把词条聚成「行」（自顶向下、同 x 升序）。
  function groupLines(items, rowTol) {
    if (!items.length) return [];
    const sorted = items.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    let cur = [sorted[0]];
    let curY = sorted[0].y;
    for (let i = 1; i < sorted.length; i++) {
      const it = sorted[i];
      if (Math.abs(it.y - curY) <= rowTol) cur.push(it);
      else { lines.push(cur); cur = [it]; curY = it.y; }
    }
    lines.push(cur);
    return lines.map((ln) => {
      ln.sort((a, b) => a.x - b.x);
      return { y: ln[0].y, height: Math.max.apply(null, ln.map((c) => c.h)), items: ln };
    });
  }

  // 把提取结果构建成 docx.Document（纯函数，便于单测）。布局以「流式段落」还原，保留粗体/斜体/字号。
  function buildDocxDocument(extracted, opts) {
    const D = globalThis.docx || window.docx;
    if (!D) throw new Error('docx 运行时未加载');
    const rowTol = opts.rowTol || 6;
    const paraTol = opts.paraTol || 14;
    const children = [];
    (extracted.pages || []).forEach((pg, pi) => {
      if (pi > 0) children.push(new D.Paragraph({ children: [new D.TextRun('')], pageBreakBefore: true }));
      const lines = groupLines(pg.items, rowTol);
      let para = null;
      const paras = [];
      for (let li = 0; li < lines.length; li++) {
        const ln = lines[li];
        const prev = lines[li - 1];
        const gap = prev ? (prev.y - ln.y) : 0; // 向下为正
        if (!para || gap > paraTol) { para = []; paras.push(para); }
        para.push(ln);
      }
      paras.forEach((paraLines) => {
        const runs = [];
        paraLines.forEach((ln, idx) => {
          ln.items.forEach((it, ii) => {
            if (!it.str) return;
            if (ii > 0) {
              const prev = ln.items[ii - 1];
              const gap = it.x - (prev.x + (prev.w || 0));
              if (gap > it.size * 0.25) runs.push(new D.TextRun({ text: ' ' }));
            }
            runs.push(new D.TextRun({
              text: it.str,
              bold: it.bold,
              italics: it.italic,
              size: Math.max(10, Math.round(it.size * 2)), // docx 字号单位=半磅
            }));
          });
          if (idx < paraLines.length - 1) runs.push(new D.TextRun({ text: '', break: 1 }));
        });
        children.push(new D.Paragraph({ children: runs.length ? runs : [new D.TextRun('')] }));
      });
    });
    return new D.Document({ sections: [{ children }] });
  }

  // 把一页词条按 x/y 聚类成网格（启发式表格识别）。desc=true 表示按值降序排列中心（行：顶部在前）。
  function cluster(values, tol, desc) {
    const s = values.slice().sort((a, b) => desc ? (b - a) : (a - b));
    const centers = [];
    let cur = [s[0]];
    for (let i = 1; i < s.length; i++) {
      if (Math.abs(s[i] - cur[0]) <= tol) cur.push(s[i]);
      else { centers.push(avg(cur)); cur = [s[i]]; }
    }
    centers.push(avg(cur));
    return centers;
  }
  function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
  function nearest(centers, v) {
    let bi = 0, bd = Infinity;
    centers.forEach((c, i) => { const d = Math.abs(c - v); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  function detectTables(extracted, opts) {
    const colTol = opts.colTol || 12;
    const rowTol = opts.rowTol || 6;
    const sheets = [];
    (extracted.pages || []).forEach((pg, pi) => {
      const items = pg.items.filter((it) => it.str && it.str.trim());
      if (!items.length) return;
      const rowCs = cluster(items.map((i) => i.y), rowTol, true);     // 降序（顶部在前）
      const colCs = cluster(items.map((i) => i.x), colTol, false);    // 升序（左→右）
      const grid = rowCs.map(() => new Array(colCs.length).fill(''));
      items.forEach((it) => {
        const ri = nearest(rowCs, it.y);
        const ci = nearest(colCs, it.x);
        grid[ri][ci] = (grid[ri][ci] ? grid[ri][ci] + ' ' : '') + it.str.trim();
      });
      sheets.push({ name: 'Page' + (pi + 1), rows: grid });
    });
    return { sheets };
  }

  function buildXlsx(detected, opts) {
    const XLSX = globalThis.XLSX || window.XLSX;
    if (!XLSX) throw new Error('SheetJS 运行时未加载');
    const wb = XLSX.utils.book_new();
    if (!(detected.sheets || []).length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['（无可提取文本）']]), 'Sheet1');
    } else {
      detected.sheets.forEach((sh, i) => {
        const rows = sh.rows && sh.rows.length ? sh.rows : [['']];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        let name = (sh.name || ('Sheet' + (i + 1))).slice(0, 31);
        if (!name) name = 'Sheet' + (i + 1);
        XLSX.utils.book_append_sheet(wb, ws, name);
      });
    }
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  }

  async function exportToWord(file, opts = {}, onProgress) {
    const extracted = await extractPdfText(file, opts, onProgress);
    const doc = buildDocxDocument(extracted, opts);
    const D = globalThis.docx || window.docx;
    const blob = await D.Packer.toBlob(doc);
    const ab = await blob.arrayBuffer();
    return { bytes: new Uint8Array(ab), pageCount: extracted.pageCount };
  }

  async function exportToExcel(file, opts = {}, onProgress) {
    const extracted = await extractPdfText(file, opts, onProgress);
    const detected = detectTables(extracted, opts);
    const bytes = buildXlsx(detected, opts);
    return { bytes, pageCount: extracted.pageCount, sheets: detected.sheets.length };
  }

  // 表格结构识别：与「导出 Excel」共享同一套提取+聚类管线，但只返回每页网格结构（不生成 xlsx）。
  // 供 UI「表格识别」工具做纯本地结构预览/核对，无需可视化布局。
  async function detectTableStructure(file, opts = {}, onProgress) {
    const extracted = await extractPdfText(file, opts, onProgress);
    const res = detectTables(extracted, opts);
    return { sheets: res.sheets, pageCount: extracted.pageCount };
  }

  // ===== P0-⑤ 红action 脱敏 (Redaction) =====
  // 两种输入：(1) keywords 关键词 —— 用 pdf.js 定位文本包围盒；(2) regions 手动矩形（PDF 用户坐标，原点左下）。
  // 两种处理方式：
  //   cover（默认）：在内容之上绘制不透明色条（黑条/白条）。保留矢量与可检索性，但底层文字仍保留（移除色条后仍可能恢复/可复制）。
  //   burn：含脱敏框的页整体栅格化为图片并把色条 baked 进像素（真正不可逆；该页失去可选中文字），未脱敏页保留矢量。
  // 纯本地，文件不上传。

  function redactionColor(c) {
    if (c === 'white') return rgb(1, 1, 1);
    if (Array.isArray(c)) return rgb(c[0], c[1], c[2]);
    return rgb(0, 0, 0); // 默认黑条
  }

  // 把关键词定位成 PDF 用户坐标的包围盒 [{page, x, y, w, h}]（x,y=左下角，h=向上，原点左下）。
  async function locateKeywords(file, keywords, opts, onProgress) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: buf, password: (opts && opts.password) || '' }).promise;
    const kws = (keywords || []).map((k) => ('' + k).trim()).filter(Boolean);
    const boxes = [];
    const ci = !(opts && opts.caseInsensitive === false);
    const padX = (opts && opts.padX != null) ? opts.padX : 1.5;
    const padY = (opts && opts.padY != null) ? opts.padY : 1.5;
    const n = pdf.numPages;
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      for (const it of (tc.items || [])) {
        const s = it.str || '';
        if (!s) continue;
        const hit = kws.some((k) => ci ? s.toLowerCase().includes(k.toLowerCase()) : s.includes(k));
        if (!hit) continue;
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        const x0 = t[4];          // 文本基线左端 x（PDF 用户单位）
        const yBase = t[5];       // 文本基线 y
        const w = it.width || 0;
        const h = it.height || Math.abs(t[3]) || 10;
        boxes.push({
          page: i,
          x: x0 - padX,
          y: yBase - h * 0.2 - padY,            // 略低于基线
          w: w + padX * 2,
          h: h * 1.3 + padY * 2,                // 覆盖基线之上字形高度
        });
      }
      if (onProgress) onProgress({ phase: `定位第 ${i}/${n} 页`, done: i, total: n });
    }
    await pdf.destroy();
    return boxes;
  }

  // 把 boxes 按页码分组（1 起）。
  function groupByPage(boxes) {
    const m = new Map();
    (boxes || []).forEach((b) => {
      const p = b.page || 1;
      if (!m.has(p)) m.set(p, []);
      m.get(p).push(b);
    });
    return m;
  }

  // cover：在不修改底层内容的前提下，于每页内容之上绘制不透明条。
  async function applyCoverRedaction(doc, boxesByPage, color, opts, onProgress) {
    const pages = doc.getPages();
    let pagesRedacted = 0, boxesCovered = 0;
    for (let i = 0; i < pages.length; i++) {
      const arr = boxesByPage.get(i + 1);
      if (!arr || !arr.length) continue;
      const page = pages[i];
      for (const b of arr) {
        page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color, borderWidth: 0, opacity: 1 });
        boxesCovered++;
      }
      pagesRedacted++;
      if (onProgress) onProgress({ phase: `遮盖第 ${i + 1} 页`, done: i + 1, total: pages.length });
    }
    return { pagesRedacted, boxesCovered };
  }

  // burn：含脱敏框的页栅格化（色条 baked 进像素），其余页保留矢量。真正不可逆。
  async function applyBurnRedaction(bytes, boxesByPage, opts, onProgress) {
    const scale = (opts && opts.scale) || 2;
    const srcDoc = await loadDoc(bytes, opts.password);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), password: opts.password || '' }).promise;
    const n = srcDoc.getPageCount();
    const out = await PDFDocument.create();
    const col = opts.color;
    let css = '#000000';
    if (col === 'white') css = '#ffffff';
    else if (Array.isArray(col)) css = `rgb(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)})`;
    let pagesRedacted = 0, boxesCovered = 0;
    for (let i = 0; i < n; i++) {
      const arr = boxesByPage.get(i + 1);
      if (!arr || !arr.length) {
        const [cp] = await out.copyPages(srcDoc, [i]);
        out.addPage(cp);
        if (onProgress) onProgress({ phase: `保留第 ${i + 1} 页（矢量）`, done: i + 1, total: n });
        continue;
      }
      const pg = await pdf.getPage(i + 1);
      const vp = pg.getViewport({ scale });
      const vpH = pg.getViewport({ scale: 1 }).height;
      const vpW = pg.getViewport({ scale: 1 }).width;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(vp.width));
      cv.height = Math.max(1, Math.ceil(vp.height));
      const ctx = cv.getContext('2d');
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      ctx.fillStyle = css;
      for (const b of arr) {
        const cx = b.x * scale;
        const cyTop = (vpH - (b.y + b.h)) * scale;   // PDF 坐标(下)→ 画布(上)
        ctx.fillRect(cx, cyTop, b.w * scale, b.h * scale);
        boxesCovered++;
      }
      const imgBytes = await blobToBytes(await new Promise((r) => cv.toBlob(r, 'image/png')));
      const img = await out.embedPng(imgBytes);
      const p = out.addPage([vpW, vpH]);
      p.drawImage(img, { x: 0, y: 0, width: vpW, height: vpH });
      pagesRedacted++;
      if (onProgress) onProgress({ phase: `栅格化脱敏第 ${i + 1} 页`, done: i + 1, total: n });
    }
    await pdf.destroy();
    const outBytes = await out.save();
    return { bytes: outBytes, pagesRedacted, boxesCovered };
  }

  async function redactPDF(fileOpts, opts = {}, onProgress) {
    const { file } = fileOpts;
    opts = opts || {};
    const color = redactionColor(opts.color);
    const method = opts.method === 'burn' ? 'burn' : 'cover';

    // 收集脱敏框
    let boxes = [];
    if (opts.keywords && opts.keywords.length) {
      boxes = boxes.concat(await locateKeywords(file, opts.keywords, opts, onProgress));
    }
    if (opts.regions && opts.regions.length) {
      const pagesN = (await loadDoc(new Uint8Array(await file.arrayBuffer()), opts.password)).getPageCount();
      opts.regions.forEach((r) => {
        if (r.page == null) { for (let p = 1; p <= pagesN; p++) boxes.push({ page: p, x: r.x, y: r.y, w: r.w, h: r.h }); }
        else boxes.push({ page: r.page, x: r.x, y: r.y, w: r.w, h: r.h });
      });
    }
    const boxesByPage = groupByPage(boxes);
    if (!boxes.length) throw new Error('未提供任何脱敏目标（关键词或区域）');

    if (method === 'burn') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await applyBurnRedaction(bytes, boxesByPage, opts, onProgress);
      return Object.assign(res, { boxCount: boxes.length });
    }

    // cover
    const doc = await loadDoc(new Uint8Array(await file.arrayBuffer()), opts.password);
    const stat = await applyCoverRedaction(doc, boxesByPage, color, opts, onProgress);
    const out = await doc.save();
    return { bytes: out, pagesRedacted: stat.pagesRedacted, boxesCovered: stat.boxesCovered, boxCount: boxes.length };
  }

  /* ===================== 文本搜索 / 替换 (P1-⑥) ===================== */
  // 说明：pdf.js 把文本拆成「词条(item)」提取，搜索/替换以「单个词条」为最小匹配单位。
  // 因此最适用于「单个词/短语落在同一词条内」的场景；跨多个词条的长句可能无法整体命中（已知限制）。

  // 在 PDF 中搜索文本，返回匹配项（含页码与词条包围盒）与每页全文（用于上下文）。
  // 依赖 pdf.js（window.pdfjsLib）。
  async function searchText(file, query, opts, onProgress) {
    if (!query) throw new Error('请输入要搜索的文本');
    opts = opts || {};
    const ci = !(opts.caseInsensitive === false);
    const buf = await resolveBytes(file);   // 调用方传 {file} 包装，统一走 resolveBytes（此前直接 file.arrayBuffer() 在浏览器报错）
    if (!globalThis.pdfjsLib) throw new Error('pdf.js 未加载');
    const pdf = await globalThis.pdfjsLib.getDocument({ data: buf, password: opts.password || '' }).promise;
    const n = pdf.numPages;
    const matches = [];
    const pages = [];
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let pageText = '';
      for (const it of (tc.items || [])) {
        const s = it.str || '';
        pageText += s + (it.hasEOL ? '\n' : ' ');
        if (!s) continue;
        const hit = ci ? s.toLowerCase().includes(query.toLowerCase()) : s.includes(query);
        if (!hit) continue;
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        const x0 = t[4], yBase = t[5];
        const w = it.width || 0;
        const h = it.height || Math.abs(t[3]) || 10;
        matches.push({ page: i, text: s, x: x0, y: yBase, w, h });
      }
      pages.push({ page: i, text: pageText.trim() });
      if (onProgress) onProgress({ phase: `搜索第 ${i}/${n} 页`, done: i, total: n });
    }
    await pdf.destroy();
    return { matches, pages, pageCount: n, query };
  }

  // 把替换文字「覆盖原词 + 重绘」到页面上（best-effort）。
  // boxesByPage: Map<页码(1起), [{x,y,w,h}]>（PDF 用户坐标，原点左下）。
  // 覆盖用白底矩形；重绘用 textToImagePng 烤成图片（兼容中文等任意语言）。
  async function applyReplace(doc, boxesByPage, replacement, opts, onProgress) {
    const pages = doc.getPages();
    const repl = replacement || '';
    let replaced = 0, drawnImg = 0, drawnText = 0;
    for (const [p, boxes] of boxesByPage) {
      const page = pages[p - 1];
      if (!page) continue;
      for (const b of boxes) {
        // 覆盖原文字（白底）
        page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color: rgb(1, 1, 1), borderWidth: 0, opacity: 1 });
        if (repl.trim() !== '') {
          let png = null;
          if (typeof document !== 'undefined' && document.createElement) {
            try { png = await textToImage(repl, { fontSize: Math.max(6, b.h * 1.6), color: '#000000', opacity: 1, fontWeight: 'normal' }); } catch (e) { png = null; }
          }
          if (png) {
            const pngBytes = await blobToBytes(png);
            const img = await doc.embedPng(pngBytes);
            const drawH = b.h;
            const drawW = img.width * (drawH / img.height);
            page.drawImage(img, { x: b.x, y: b.y, width: drawW, height: drawH });
            drawnImg++;
          } else {
            try {
              page.drawText(repl, { x: b.x, y: b.y, size: Math.max(4, b.h * 0.8), font: await doc.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) });
              drawnText++;
            } catch (e) { /* 编码失败（如中文且无 canvas）则仅覆盖 */ }
          }
        }
        replaced++;
      }
    }
    return { replaced, drawnImg, drawnText };
  }

  // 搜索并把命中的词条（覆盖原词）替换为 replacement。返回修改后的 PDF 字节。
  async function replaceText(file, query, replacement, opts, onProgress) {
    if (!query) throw new Error('请输入要替换的文本');
    opts = opts || {};
    const ci = !(opts.caseInsensitive === false);
    const buf = await resolveBytes(file);   // 调用方传 {file} 包装，统一走 resolveBytes（此前直接 file.arrayBuffer() 在浏览器报错）
    if (!globalThis.pdfjsLib) throw new Error('pdf.js 未加载');
    const pdf = await globalThis.pdfjsLib.getDocument({ data: buf, password: opts.password || '' }).promise;
    const n = pdf.numPages;
    const boxesByPage = new Map();
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      for (const it of (tc.items || [])) {
        const s = it.str || '';
        if (!s) continue;
        const hit = ci ? s.toLowerCase().includes(query.toLowerCase()) : s.includes(query);
        if (!hit) continue;
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        const x0 = t[4], yBase = t[5];
        const w = it.width || 0;
        const h = it.height || Math.abs(t[3]) || 10;
        if (!boxesByPage.has(i)) boxesByPage.set(i, []);
        boxesByPage.get(i).push({ page: i, x: x0 - 1.5, y: yBase - h * 0.2 - 1.5, w: w + 3, h: h * 1.3 + 3 });
      }
      if (onProgress) onProgress({ phase: `定位第 ${i}/${n} 页`, done: i, total: n });
    }
    await pdf.destroy();
    const doc = await loadDoc(buf, opts.password);
    const stat = await applyReplace(doc, boxesByPage, replacement || '', opts, onProgress);
    const out = await doc.save();
    if (onProgress) onProgress({ phase: '完成', done: n, total: n });
    return { bytes: out, replaced: stat.replaced, pages: boxesByPage.size, drawnImg: stat.drawnImg, drawnText: stat.drawnText };
  }

  // 用「用户提供的字体」（TTF/OTF 字节）将文字以真实可选中文本写入 PDF。
  // 与 textToImagePng（栅格化 → 不可选中）相反，此方法嵌入字体并对每个字符生成真正的文本词条，
  // 因此 Acrobat / 浏览器 / 任意阅读器均可选中、复制、搜索这些文字（含中文）。
  // 字体字节由调用方（UI 上传）提供，不随应用打包，符合「本地优先·文件不上传」原则。
  // opts:
  //   fontBytes: Uint8Array  (必填)
  //   text: string
  //   mode: 'single' | 'tile' | 'pagenum'
  //   pages: number[] 1-based（仅 single 模式；tile/pagenum 作用于全部页）
  //   x, y: mm，左上原点（single / pagenum 模式）
  //   size: pt（默认 24）
  //   color: '#rrggbb'（默认 '#222222'）
  //   rotation: 度（默认 0；tile 模式为倾斜水印角，默认 30）
  //   opacity: 0..1（默认 1）
  //   format: pagenum 模板，含 {n}=当前页(1-based) {count}=总页数
  //   tile: { stepX, stepY } mm（平铺间距，默认按字号自适应）
  async function addTextWithFont(file, opts, onProgress) {
    if (!opts || !opts.fontBytes) throw new Error('缺少字体数据（fontBytes）');
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());
    const doc = await loadDoc(bytes, opts.password);
    if (!ensureFontkit(doc)) throw new Error('未加载 fontkit：无法嵌入自定义字体，请确认页面已引入 fontkit。');
    const font = await doc.embedFont(opts.fontBytes, { subset: false });
    const total = doc.getPageCount();
    const size = Number(opts.size) || 24;
    const color = hexToRgb(opts.color || '#222222');
    const opacity = opts.opacity == null ? 1 : Number(opts.opacity);
    const mode = opts.mode || 'single';

    // 在页面上绘制一段文字；rotDeg/origin 用于平铺水印的倾斜与绕中心旋转
    function paint(page, text, x, y, rotDeg, origin) {
      const args = { x, y, size, font, color, opacity };
      if (rotDeg) args.rotation = { type: 'degrees', angle: Number(rotDeg), origin: origin || { x, y } };
      page.drawText(text, args);
    }

    if (mode === 'single') {
      const targets = (opts.pages && opts.pages.length)
        ? opts.pages.map((p) => p - 1).filter((i) => i >= 0 && i < total)
        : [0];
      if (!targets.length) targets.push(0);
      if (onProgress) onProgress({ done: 0, total: targets.length, phase: '写入嵌入文字' });
      for (let k = 0; k < targets.length; k++) {
        const page = doc.getPage(targets[k]);
        const [, ph] = pageSize(page);
        const xPt = (opts.x == null ? 10 : Number(opts.x)) * PT_PER_MM;
        const yTop = (opts.y == null ? 10 : Number(opts.y)) * PT_PER_MM;
        paint(page, opts.text || '', xPt, ph - yTop - size);
        if (onProgress) onProgress({ done: k + 1, total: targets.length, phase: '写入嵌入文字' });
      }
    } else if (mode === 'tile') {
      const ang = opts.rotation == null ? 30 : Number(opts.rotation);
      const stepX = ((opts.tile && opts.tile.stepX) || Math.max(90, size * 6)) * PT_PER_MM;
      const stepY = ((opts.tile && opts.tile.stepY) || Math.max(55, size * 4)) * PT_PER_MM;
      if (onProgress) onProgress({ done: 0, total: total, phase: '平铺水印' });
      for (let i = 0; i < total; i++) {
        const page = doc.getPage(i);
        const [pw, ph] = pageSize(page);
        const diag = Math.sqrt(pw * pw + ph * ph);
        const cols = Math.ceil(diag / stepX) + 1;
        const rows = Math.ceil(diag / stepY) + 1;
        for (let r = -1; r <= rows; r++) {
          for (let c = -1; c <= cols; c++) {
            const cx = c * stepX + stepX / 2;
            const cy = r * stepY + stepY / 2;
            const w = font.widthOfTextAtSize(opts.text || '', size);
            paint(page, opts.text || '', cx - w / 2, cy - size / 2, ang, { x: cx, y: cy });
          }
        }
        if (onProgress) onProgress({ done: i + 1, total, phase: '平铺水印' });
      }
    } else if (mode === 'pagenum') {
      const format = opts.format || '第 {n} 页';
      if (onProgress) onProgress({ done: 0, total, phase: '写入页码' });
      for (let i = 0; i < total; i++) {
        const page = doc.getPage(i);
        const [, ph] = pageSize(page);
        const txt = format.replace(/\{n\}/g, String(i + 1)).replace(/\{count\}/g, String(total));
        const xPt = (opts.x == null ? 10 : Number(opts.x)) * PT_PER_MM;
        const yTop = (opts.y == null ? 10 : Number(opts.y)) * PT_PER_MM;
        paint(page, txt, xPt, ph - yTop - size);
        if (onProgress) onProgress({ done: i + 1, total, phase: '写入页码' });
      }
    } else {
      throw new Error('未知 mode：' + mode);
    }

    const out = await doc.save();
    if (onProgress) onProgress({ done: 1, total: 1, phase: '完成' });
    return out;
  }

  /* ===================== PDF/A 归档 (P2-②) =====================
   * 把任意 PDF 转换为「PDF/A 兼容归档版」（best-effort 自包含化 + 结构合规标记）：
   *   - 移除加密（解密后无密码另存）
   *   - 扁平化交互式表单（消除 AcroForm 交互性，PDF/A 不允许可交互表单残留行为）
   *   - 移除文档级 JavaScript（/JS、/Names/JavaScript、JS 型 OpenAction、页面 /AA）
   *   - 内嵌 sRGB ICC 色彩配置 + 添加 /OutputIntent（GTS_PDFA*）
   *   - 写入 XMP 元数据声明 PDF/A 一致性（pdfaid:part / conformance）
   *   - 设置 /MarkInfo << /Marked true >> 与文档 /ID
   *   - 可选「图像归档」模式：把每页栅格化为图片重排，保证彻底自包含（浏览器端）
   * 已知限制：① 源 PDF 所用字体若未内嵌，本工具无法自动替补（请先用「嵌入字体」工具）；
   *          ② 不内附校验器，不等同官方认证；仅做结构合规标记与自包含化处理；
   *          ③ 底层 pdf-lib 输出为 PDF 1.7，故 1B 仅做标记、无法真正降级到 PDF 1.4，
   *             认证级合规请以 2B/3B 为目标（基于 PDF 1.7，可被标准校验器接受）。
   */
  const PDFA_CONFORMANCE = { '1B': 'GTS_PDFA1', '2B': 'GTS_PDFA2', '3B': 'GTS_PDFA3' };

  // —— 构造一个结构合法的 sRGB v2 ICC 配置文件（参数化 sRGB 传递函数 + D65 矩阵）——
  function u32be(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return b; }
  function s1516be(v) { let i = Math.round(v * 65536); if (i < 0) i += 0x100000000; const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, i >>> 0); return b; }
  function f32be(v) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v); return b; }
  function asciiBytes(s) { return new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff)); }
  function catBuf(arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }
  function buildSRGBICCProfile() {
    const xyz = (x, y, z) => catBuf([asciiBytes('XYZ '), new Uint8Array(4), s1516be(x), s1516be(y), s1516be(z)]);
    const textTag = (t) => { const tb = asciiBytes(t); return catBuf([asciiBytes('text'), new Uint8Array(4), tb, new Uint8Array([0])]); };
    const descTag = (t) => {
      const ascii = asciiBytes(t);
      const asciiN = u32be(ascii.length + 1);                 // 含 null 终止符
      const body = catBuf([asciiN, ascii, new Uint8Array([0]), u32be(0)]); // ascii + null + unicode长度0
      return catBuf([asciiBytes('desc'), new Uint8Array(4), body]);
    };
    const paraTag = () => {                                    // sRGB 参数化曲线 (type 3)
      const G = 2.4, a = 1 / 1.055, b = 0.055 / 1.055, c = 1 / 12.92, d = 0.04045, e = 0.0, f = 0.0;
      return catBuf([asciiBytes('para'), new Uint8Array(4), new Uint8Array([0, 3]), new Uint8Array(2),
        f32be(G), f32be(a), f32be(b), f32be(c), f32be(d), f32be(e), f32be(f)]);
    };
    const blocks = {};
    blocks['desc'] = descTag('sRGB IEC61966-2.1');
    blocks['cprt'] = textTag('Public domain');
    blocks['wtpt'] = xyz(0.95047, 1.0, 1.08883);
    blocks['rXYZ'] = xyz(0.4360657, 0.2224884, 0.0139160);
    blocks['gXYZ'] = xyz(0.3851471, 0.7168732, 0.0970764);
    blocks['bXYZ'] = xyz(0.1430661, 0.0606072, 0.7140961);
    blocks['rTRC'] = paraTag(); blocks['gTRC'] = paraTag(); blocks['bTRC'] = paraTag();
    blocks['chad'] = catBuf([xyz(1.0478112, 0.0228866, -0.0501270), xyz(0.0295424, 0.9904844, -0.0170491), xyz(-0.0092345, 0.0150436, 0.7521316)]);
    const order = ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC', 'chad'];
    const pad4 = (b) => (b.length % 4 ? catBuf([b, new Uint8Array(4 - (b.length % 4))]) : b);
    const entries = []; let off = 128 + 4 + order.length * 12; const dataBufs = [];
    for (const t of order) { const d = pad4(blocks[t]); entries.push({ t, off, size: d.length }); dataBufs.push(d); off += d.length; }
    const total = off;
    const h = new Uint8Array(128);
    h.set(u32be(total), 0);                 // 文件大小
    h.set(asciiBytes('appl'), 4);           // 首选 CMM
    h[8] = 0x02; h[9] = 0x10; h[10] = 0x00; h[11] = 0x00; // 版本 2.1.0
    h.set(asciiBytes('mntr'), 12);          // 设备类：显示器
    h.set(asciiBytes('RGB '), 16);          // 数据色彩空间
    h.set(asciiBytes('XYZ '), 20);          // PCS
    h.set(asciiBytes('acsp'), 36);          // 签名
    h.set(asciiBytes('APPL'), 40);          // 平台
    h.set(u32be(0), 44);                    // 标志
    h.set(asciiBytes('IEC '), 48);          // 设备制造商
    h.set(u32be(0), 52);                    // 设备型号
    h.set(u32be(0), 64);                    // 渲染意图：感知
    h.set(s1516be(0.96420288), 68); h.set(s1516be(1.0), 72); h.set(s1516be(0.82490540), 76); // PCS 光源 D50
    h.set(asciiBytes('appl'), 80);          // 创建者
    const tt = new Uint8Array(4 + order.length * 12);
    new DataView(tt.buffer).setUint32(0, order.length);
    order.forEach((t, i) => { const e = entries[i]; const o = 4 + i * 12; tt.set(asciiBytes(t), o); new DataView(tt.buffer).setUint32(o + 4, e.off); new DataView(tt.buffer).setUint32(o + 8, e.size); });
    return catBuf([h, tt, ...dataBufs]);
  }

  // —— 构造 PDF/A 的 XMP 元数据数据包（UTF-8，含 BOM 与 xpacket）——
  function buildPDFAXMP(conformance) {
    const part = String(conformance[0] || '2');
    const conf = (conformance.length > 1 ? conformance[1] : 'B');
    const now = new Date().toISOString();
    const packet =
      '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
      ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
      '  <rdf:Description rdf:about=""\n' +
      '    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"\n' +
      '    xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
      '    xmlns:xmp="http://ns.adobe.com/xap/1.0/">\n' +
      '   <pdfaid:part>' + part + '</pdfaid:part>\n' +
      '   <pdfaid:conformance>' + conf + '</pdfaid:conformance>\n' +
      '   <dc:format>application/pdf</dc:format>\n' +
      '   <xmp:CreateDate>' + now + '</xmp:CreateDate>\n' +
      '   <xmp:MetadataDate>' + now + '</xmp:MetadataDate>\n' +
      '  </rdf:Description>\n' +
      ' </rdf:RDF>\n' +
      '</x:xmpmeta>\n' +
      '<?xpacket end="w"?>';
    return new TextEncoder().encode(packet);
  }

  function randHex16() {
    const a = new Uint8Array(16);
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a);
    else for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    let s = ''; for (const x of a) s += x.toString(16).padStart(2, '0'); return s;
  }

  // 移除文档中的 JavaScript（best-effort，避免误删合法 GoTo 等动作）
  function stripJavaScript(doc, ctx) {
    try {
      if (doc.catalog.lookup(PDFName.of('JS'))) doc.catalog.delete(PDFName.of('JS'));
      const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict);
      if (names && names.lookup(PDFName.of('JavaScript'))) names.delete(PDFName.of('JavaScript'));
      const oa = doc.catalog.lookup(PDFName.of('OpenAction'));
      if (oa) {
        let d = oa; if (oa instanceof PDFRef) d = ctx.lookup(oa, PDFDict);
        if (d && d.get) {
          const s = d.get(PDFName.of('S'));
          if (s && s.asString && s.asString() === '/JavaScript') doc.catalog.delete(PDFName.of('OpenAction'));
        }
      }
      for (const p of doc.getPages()) {
        try { if (p.node.lookup(PDFName.of('AA'))) p.node.delete(PDFName.of('AA')); } catch (e) {}
      }
    } catch (e) {}
  }

  // 把 PDF/A 合规标记写到当前 doc（ICC + OutputIntent + XMP + MarkInfo + ID）
  function applyPDFAMarkers(doc, opts) {
    opts = opts || {};
    const ctx = doc.context;
    const conformance = opts.conformance || '2B';
    const icc = opts.iccBytes || buildSRGBICCProfile();
    // OutputIntent
    const iccStream = ctx.stream(new Uint8Array(icc), ctx.obj({}));
    const iccRef = ctx.register(iccStream);
    const oiDict = ctx.obj({
      Type: PDFName.of('OutputIntent'),
      S: PDFName.of(PDFA_CONFORMANCE[conformance] || 'GTS_PDFA1'),
      Info: PDFString.of('sRGB IEC61966-2.1'),
      OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
      DestOutputProfile: iccRef,
    });
    const oiRef = ctx.register(oiDict);
    const oiArr = ctx.obj([]); oiArr.push(oiRef);
    doc.catalog.set(PDFName.of('OutputIntents'), oiArr);
    // XMP 元数据
    const metaStream = ctx.stream(buildPDFAXMP(conformance), ctx.obj({ Type: PDFName.of('Metadata'), Subtype: PDFName.of('XML') }));
    const metaRef = ctx.register(metaStream);
    doc.catalog.set(PDFName.of('Metadata'), metaRef);
    // MarkInfo
    doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: PDFBool.True }));
    // 文档 ID
    try { ctx.trailerInfo.ID = ctx.obj([PDFString.of(randHex16()), PDFString.of(randHex16())]); } catch (e) {}
  }

  // 浏览器端：把每页栅格化为 PNG 重排成全新文档（彻底自包含归档）
  async function rasterizeAllToDoc(bytes, password, scale) {
    const srcDoc = await loadDoc(bytes, password);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), password: password || '' }).promise;
    const n = srcDoc.getPageCount();
    const out = await PDFDocument.create();
    for (let i = 0; i < n; i++) {
      const pg = await pdf.getPage(i + 1);
      const vp = pg.getViewport({ scale });
      const vpH = pg.getViewport({ scale: 1 }).height;
      const vpW = pg.getViewport({ scale: 1 }).width;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(vp.width));
      cv.height = Math.max(1, Math.ceil(vp.height));
      const c = cv.getContext('2d');
      await pg.render({ canvasContext: c, viewport: vp }).promise;
      const imgBytes = await blobToBytes(await new Promise((r) => cv.toBlob(r, 'image/png')));
      const img = await out.embedPng(imgBytes);
      const p = out.addPage([vpW, vpH]);
      p.drawImage(img, { x: 0, y: 0, width: vpW, height: vpH });
    }
    await pdf.destroy();
    return out;
  }

  async function toPDFA(file, opts, onProgress) {
    opts = opts || {};
    const conformance = opts.conformance || '2B';
    const mode = opts.mode || 'standard';
    const password = opts.password;
    const bytes = file.bytes || new Uint8Array(await file.file.arrayBuffer());

    if (onProgress) onProgress({ done: 0, total: 6, phase: '加载并解密' });
    let doc = await loadDoc(bytes, password);
    const ctx = doc.context;
    const pageCount = doc.getPageCount();

    // 1. 移除加密（load 已解出内容流，最终 save 不带密码即去加密）
    // 2. 扁平化交互式表单
    if (opts.flatten !== false) {
      if (onProgress) onProgress({ done: 1, total: 6, phase: '扁平化表单' });
      try {
        const form = doc.getForm();
        if (form) { const fs = form.getFields(); for (const f of fs) { try { form.removeField(f); } catch (e) {} } }
        const acro = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
        if (acro) acro.set(PDFName.of('NeedAppearances'), PDFBool.False);
      } catch (e) {}
    }

    // 3. 移除 JavaScript
    if (onProgress) onProgress({ done: 2, total: 6, phase: '清除 JavaScript' });
    stripJavaScript(doc, ctx);

    // 4. 图像归档模式：把每页栅格化为图片重排
    if (mode === 'image' && typeof document !== 'undefined' && typeof pdfjsLib !== 'undefined') {
      if (onProgress) onProgress({ done: 3, total: 6, phase: '栅格化页面' });
      doc = await rasterizeAllToDoc(bytes, password, opts.scale || 2);
    }

    // 5. 写入 PDF/A 标记
    if (onProgress) onProgress({ done: 4, total: 6, phase: '写入 PDF/A 标记' });
    applyPDFAMarkers(doc, { conformance, iccBytes: opts.iccBytes });

    // 6. 保存（关闭对象流，输出经典 xref，更贴近归档要求）
    if (onProgress) onProgress({ done: 5, total: 6, phase: '保存' });
    const out = await doc.save({ useObjectStreams: false });
    if (onProgress) onProgress({ done: 6, total: 6, phase: '完成' });
    return { bytes: out, conformance, mode, pageCount };
  }

  /* ---------- P2-③ 附件增删（文档级嵌入式文件 / EmbeddedFiles 名称树） ---------- */

  async function resolveBytes(x) {
    if (!x) throw new Error('缺少输入文件');
    if (x.bytes) return x.bytes;
    if (x.file) return new Uint8Array(await x.file.arrayBuffer());
    return x; // 已为 Uint8Array
  }

  function safeStr(node, key) {
    const v = node.lookup(PDFName.of(key));
    if (v instanceof PDFString || v instanceof PDFHexString) {
      try { return v.decodeText ? v.decodeText() : v.asString(); } catch (e) { return ''; }
    }
    return '';
  }
  function safeName(node, key) {
    const v = node.lookup(PDFName.of(key));
    return v ? v.asString() : '';
  }
  function cleanMime(raw) {
    let m = raw || '';
    if (m.startsWith('/')) m = m.slice(1);
    m = m.replace(/#2F/gi, '/');
    return m;
  }
  function asciiName(name) {
    return String(name).replace(/[^\x20-\x7E]/g, '_');
  }
  function extToMime(name) {
    const ext = String(name).toLowerCase().split('.').pop();
    const map = {
      pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', html: 'text/html',
      xml: 'text/xml', json: 'application/json', md: 'text/markdown',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
      mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
    };
    return map[ext] || 'application/octet-stream';
  }
  function pdfDateNow() {
    const d = new Date();
    const p = (n, l) => String(n).padStart(l || 2, '0');
    return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // 遍历 /Names /EmbeddedFiles 名称树（兼容 /Names 叶子与 /Kids 分支），返回完整描述符
  function readEmbeddedFiles(doc) {
    const ctx = doc.context;
    const names = doc.catalog.lookup(PDFName.of('Names'));
    if (!names || !(names instanceof PDFDict)) return [];
    const ef = names.lookup(PDFName.of('EmbeddedFiles'));
    if (!ef || !(ef instanceof PDFDict)) return [];
    const out = [];
    function walk(node) {
      const kids = node.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray) { for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i)); return; }
      const arr = node.lookup(PDFName.of('Names'));
      if (!(arr instanceof PDFArray)) return;
      for (let i = 0; i < arr.size(); i += 2) {
        const keyNode = arr.lookup(i);
        const name = (keyNode && (keyNode instanceof PDFString || keyNode instanceof PDFHexString)) ? keyNode.decodeText() : '';
        const fsx = arr.lookup(i + 1);
        if (!(fsx instanceof PDFDict)) continue;
        const F = safeStr(fsx, 'F'), UF = safeStr(fsx, 'UF'), Desc = safeStr(fsx, 'Desc');
        let size = 0, mime = '', created = '', bytes = null;
        const efNode = fsx.lookup(PDFName.of('EF'));
        const streamRef = efNode instanceof PDFDict ? efNode.lookup(PDFName.of('F')) : null;
        const stream = streamRef instanceof PDFRef ? ctx.lookup(streamRef) : (streamRef && streamRef.contents ? streamRef : null);
        if (stream && stream.contents) {
          bytes = stream.contents; size = bytes.length;
          mime = safeName(stream.dict, 'Subtype');
          const params = stream.dict.lookup(PDFName.of('Params'));
          if (params instanceof PDFDict) {
            const ps = params.lookup(PDFName.of('Size'));
            if (ps && typeof ps.asNumber === 'function') size = ps.asNumber();
            const cd = params.lookup(PDFName.of('CreationDate'));
            if (cd instanceof PDFString) created = cd.decodeText();
          }
        }
        out.push({ name: UF || F || name, fileName: F, description: Desc, mimeType: cleanMime(mime), created, size, bytes });
      }
    }
    walk(ef);
    return out;
  }

  // 用描述符列表重建 /Names /EmbeddedFiles /Names（扁平叶子，自动按名称排序）
  function rebuildEmbeddedFiles(doc, descriptors) {
    const ctx = doc.context;
    let names = doc.catalog.lookup(PDFName.of('Names'));
    if (!(names instanceof PDFDict)) { names = ctx.obj({}); doc.catalog.set(PDFName.of('Names'), names); }
    let ef = names.lookup(PDFName.of('EmbeddedFiles'));
    if (!(ef instanceof PDFDict)) { ef = ctx.obj({}); names.set(PDFName.of('EmbeddedFiles'), ef); }
    if (!descriptors || !descriptors.length) {
      names.delete(PDFName.of('EmbeddedFiles'));
      return;
    }
    const sorted = descriptors.slice().sort((a, b) => (a.uName < b.uName ? -1 : a.uName > b.uName ? 1 : 0));
    const pairs = [];
    for (const d of sorted) {
      const fsRef = buildFilespec(doc, d.bytes, d.fName || d.uName, d.uName, d.description, d.mimeType);
      pairs.push(PDFHexString.fromText(d.uName), fsRef);
    }
    ef.set(PDFName.of('Names'), ctx.obj(pairs));
  }

  function buildFilespec(doc, dataBytes, fName, uName, description, mimeType) {
    const ctx = doc.context;
    const efParams = { Size: dataBytes.length, CreationDate: PDFString.of(pdfDateNow()) };
    const efDict = { Type: PDFName.of('EmbeddedFile'), Params: ctx.obj(efParams) };
    if (mimeType) efDict.Subtype = PDFName.of(String(mimeType).replace(/\//g, '#2F'));
    const efStream = ctx.stream(dataBytes, ctx.obj(efDict));
    const efRef = ctx.register(efStream);
    const fsDict = {
      Type: PDFName.of('Filespec'),
      F: PDFString.of(asciiName(fName || uName)),
      EF: ctx.obj({ F: efRef, UF: efRef }),
    };
    try { fsDict.UF = PDFHexString.fromText(uName); } catch (e) { fsDict.UF = PDFString.of(asciiName(fName || uName)); }
    if (description) fsDict.Desc = PDFString.of(description);
    return ctx.register(ctx.obj(fsDict));
  }

  function listAttachments(file) {
    return (async () => {
      const bytes = await resolveBytes(file);
      const doc = await loadDoc(bytes, file && file.password);
      return readEmbeddedFiles(doc);
    })();
  }

  function addAttachment(opts) {
    return (async () => {
      const bytes = await resolveBytes(opts);
      let fileBytes = opts.fileBytes;
      if (!fileBytes && opts.attachFile) fileBytes = new Uint8Array(await opts.attachFile.arrayBuffer());
      if (!fileBytes || !fileBytes.length) throw new Error('未提供附件数据');
      const name = opts.fileName && String(opts.fileName).trim() ? String(opts.fileName).trim() : 'attachment';
      const mime = opts.mimeType && String(opts.mimeType).trim() ? String(opts.mimeType).trim() : extToMime(name);
      const doc = await loadDoc(bytes, opts.password);
      const list = readEmbeddedFiles(doc);
      list.push({ name, fileName: name, description: opts.description || '', mimeType: mime, bytes: fileBytes });
      rebuildEmbeddedFiles(doc, list.map((d) => ({ bytes: d.bytes, fName: d.fileName || d.name, uName: d.name, description: d.description, mimeType: d.mimeType })));
      const out = await doc.save();
      return { bytes: out, added: name, count: list.length };
    })();
  }

  function removeAttachment(opts) {
    return (async () => {
      const bytes = await resolveBytes(opts);
      const removeSet = new Set(((opts.names || [])).map((s) => String(s).trim()).filter(Boolean));
      if (!removeSet.size) throw new Error('未指定要删除的附件名称');
      const doc = await loadDoc(bytes, opts.password);
      const list = readEmbeddedFiles(doc);
      const removed = list.filter((d) => removeSet.has(d.name));
      if (!removed.length) throw new Error('未找到匹配的附件：' + [...removeSet].join('、'));
      const kept = list.filter((d) => !removeSet.has(d.name));
      rebuildEmbeddedFiles(doc, kept.map((d) => ({ bytes: d.bytes, fName: d.fileName || d.name, uName: d.name, description: d.description, mimeType: d.mimeType })));
      const out = await doc.save();
      return { bytes: out, removed: removed.map((d) => d.name), remaining: kept.length };
    })();
  }

  /* ---------- P2-④ 损坏 PDF 修复（轻量级自修复：字节级归一化 + 宽容加载 + 干净重写） ---------- */

  // 诊断字节级问题（不解析对象结构，仅看头部/尾部特征）
  function diagnoseCorruption(bytes) {
    const s = (() => {
      try { return Buffer.from(bytes).toString('latin1'); } catch (e) { return ''; }
    })();
    const d = { size: bytes ? bytes.length : 0, hasHeader: false, headerVersion: '', headerLower: false, leadingJunk: false, hasEOF: false, trailedJunk: false, encrypted: false };
    if (!s) return d;
    const m = s.match(/%PDF-(\d\.\d)/i);
    if (m) {
      d.hasHeader = true;
      d.headerVersion = m[1];
      d.headerLower = /%pdf/i.test(m[0]) && m[0] !== '%PDF-' + m[1];
      d.leadingJunk = m.index > 0;
    }
    const eofIdx = s.lastIndexOf('%%EOF');
    d.hasEOF = eofIdx !== -1;
    if (d.hasEOF && eofIdx + 6 < s.length) d.trailedJunk = true;
    d.encrypted = /\/Encrypt\b/.test(s);
    return d;
  }

  // 把字节修复成「可被解析器接纳」的形态；返回 { bytes, changes:[] }
  function normalizeCorruptBytes(bytes) {
    const changes = [];
    let s = Buffer.from(bytes).toString('latin1');

    // 1) 头部：定位 %PDF-（大小写不敏感）
    let m = s.match(/%PDF-(\d\.\d)/i);
    if (!m) {
      // 没有合法头部，但若有 obj/endobj，尝试在前方补一个标准头
      const objIdx = s.indexOf('obj');
      if (objIdx !== -1) {
        s = '%PDF-1.7\n' + s.slice(objIdx > 0 ? 0 : 0);
        // 若 obj 前还有东西，丢弃（通常是垃圾）
        const obj2 = s.indexOf('obj');
        if (obj2 > 6) s = '%PDF-1.7\n' + s.slice(obj2);
        changes.push('补写缺失的 %PDF- 文件头');
        m = s.match(/%PDF-(\d\.\d)/i);
      }
    }
    if (m) {
      let head = m[0];
      let headIdx = m.index;
      // 1a) 大小写修正：%pdf -> %PDF
      if (head !== '%PDF-' + m[1]) {
        s = s.slice(0, headIdx) + '%PDF-' + m[1] + s.slice(headIdx + head.length);
        head = '%PDF-' + m[1];
        changes.push('文件头小写已修正为大写 %PDF-');
        headIdx = m.index;
      }
      // 1b) 版本号越界修正（如 9.9 / 2.0 之外）
      const major = Number(m[1].charAt(0));
      const minor = Number(m[1].charAt(2) || 0);
      if (major < 1 || major > 1 || minor > 7 || isNaN(minor)) {
        s = s.slice(0, headIdx) + '%PDF-1.7' + s.slice(headIdx + head.length);
        changes.push('非法 PDF 版本号已规范为 1.7');
      }
      // 1c) 头部前有垃圾：删除头部之前的内容
      if (headIdx > 0) {
        s = s.slice(headIdx);
        changes.push('已清除文件头之前的垃圾字节');
      }
    }

    // 2) 尾部：定位最后 %%EOF，删除其后垃圾
    const eofIdx = s.lastIndexOf('%%EOF');
    if (eofIdx === -1) {
      // 没有 EOF 标记 → 补一个
      if (!s.endsWith('\n')) s += '\n';
      s += '%%EOF\n';
      changes.push('已补写缺失的 %%EOF 文件尾');
    } else if (eofIdx + 6 < s.length) {
      s = s.slice(0, eofIdx + 6);
      changes.push('已清除文件尾 %%EOF 之后的垃圾字节');
    }

    return { bytes: new Uint8Array(Buffer.from(s, 'latin1')), changes };
  }

  // 尝试加载；返回 { ok, doc, error }
  async function attemptLoad(bytes, opts) {
    const loadOpts = { throwOnInvalidObject: opts.lenient ? false : true };
    if (opts.password) loadOpts.password = opts.password;
    else loadOpts.ignoreEncryption = true; // 未给密码时别因加密直接抛错，交由调用方判断
    try {
      const doc = await PDFDocument.load(bytes, loadOpts);
      return { ok: true, doc };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // 截断恢复：对「被截断下载」做二分回退，尝试最后一个完整 endobj 之前的前缀
  async function attemptRecoverPrefix(bytes, opts) {
    const s = Buffer.from(bytes).toString('latin1');
    const positions = [];
    let idx = s.lastIndexOf('endobj');
    while (idx !== -1 && positions.length < 4000) {
      positions.push(idx + 6); // 含 endobj + 其后可能的空白
      idx = s.lastIndexOf('endobj', idx - 1);
    }
    for (const cut of positions) {
      const prefix = new Uint8Array(Buffer.from(s.slice(0, cut) + '\n%%EOF\n', 'latin1'));
      const r = await attemptLoad(prefix, opts);
      if (r.ok) return { recovered: prefix, doc: r.doc };
    }
    return null;
  }

  async function repairPDF(file, opts) {
    return (async () => {
      const bytes = await resolveBytes(file);
      if (!bytes || !bytes.length) throw new Error('未提供 PDF 数据');
      opts = opts || {};
      const diag = diagnoseCorruption(bytes);
      const onProgress = opts.onProgress || (() => {});
      onProgress({ done: 1, total: 5, phase: '诊断' });

      // 第一步：字节级归一化
      const norm = normalizeCorruptBytes(bytes);
      onProgress({ done: 2, total: 5, phase: '归一化头部/尾部' });

      // 第二步：宽容加载（关闭 invalid-object 抛错）
      let attempt = await attemptLoad(norm.bytes, { lenient: true, password: opts.password });
      let doc = attempt.ok ? attempt.doc : null;
      let recoveredPrefix = null;

      // 第三步：若失败且疑似截断，尝试前缀恢复
      if (!doc) {
        onProgress({ done: 3, total: 5, phase: '尝试截断恢复' });
        const rec = await attemptRecoverPrefix(norm.bytes, { lenient: true, password: opts.password });
        if (rec) { doc = rec.doc; recoveredPrefix = rec.recovered; }
      }

      // 第四步：若仍失败，给出诊断
      if (!doc) {
        onProgress({ done: 5, total: 5, phase: '无法修复' });
        const encrypted = diag.encrypted;
        const reason = encrypted && !opts.password
          ? '该文件已加密，需要提供打开密码才能修复。'
          : '文件损坏程度超出本地修复能力（如缺少交叉引用表/xref、页面对象被截断缺失）。pdf-lib 无法在缺少 xref 的情况下重建文档。建议从原始来源重新获取文件，或改用专业修复工具。';
        const err = new Error('修复失败：' + reason);
        err.diag = diag;
        err.recoverable = false;
        throw err;
      }

      // 第五步：干净重写（pdf-lib 会重新计算全部偏移、重建 xref）
      onProgress({ done: 4, total: 5, phase: '重写干净 PDF' });
      const out = await doc.save();
      const reloaded = await PDFDocument.load(out);
      const pageCount = reloaded.getPageCount();
      onProgress({ done: 5, total: 5, phase: '完成' });

      const changes = norm.changes.slice();
      if (recoveredPrefix) changes.push('已通过截断恢复，保留了文件前部可解析的页面（尾部损坏部分被舍弃）');
      if (!changes.length) changes.push('文件字节结构正常，已做一次干净重写（重排交叉引用表 / 统一行尾 / 修复各阅读器兼容问题）');

      return {
        bytes: out,
        pageCount,
        changes,
        diagnosis: diag,
        recovered: !!recoveredPrefix,
      };
    })();
  }

  /* ---------- P2-⑤ 两版 PDF 对比（结构 + 文本，纯本地） ---------- */

  // 把书签/大纲树展平为可读字符串数组（含页码与层级缩进），便于集合 diff
  function flattenOutline(tree) {
    const out = [];
    (function walk(nodes, depth) {
      (nodes || []).forEach((n) => {
        const title = n.title || '(无标题)';
        const page = n.page != null ? ('P' + n.page + ' ') : '';
        out.push('  '.repeat(depth) + page + title);
        if (n.children && n.children.length) walk(n.children, depth + 1);
      });
    })(tree, 0);
    return out;
  }

  // 两个字符串数组的集合 diff（忽略顺序）：返回新增 / 移除
  function diffLists(a, b) {
    const added = b.filter((x) => !a.includes(x));
    const removed = a.filter((x) => !b.includes(x));
    return { changed: added.length > 0 || removed.length > 0, added, removed };
  }

  // 附件 diff：按名称匹配，比较是否存在与大小是否变化
  function diffAttachments(atA, atB) {
    const mapA = new Map(atA.map((x) => [x.name, x]));
    const mapB = new Map(atB.map((x) => [x.name, x]));
    const added = [], removed = [], changedNames = [];
    for (const [name, x] of mapB) {
      if (!mapA.has(name)) added.push(name);
      else if (mapA.get(name).size !== x.size) changedNames.push(name);
    }
    for (const [name] of mapA) if (!mapB.has(name)) removed.push(name);
    return { changed: added.length > 0 || removed.length > 0 || changedNames.length > 0, added, removed, changedNames };
  }

  // 行级文本 diff（LCS 回溯），返回新增/删除行与相似度。超大输入降级为集合估算。
  function diffTextBlocks(aLines, bLines) {
    const n = aLines.length, m = bLines.length;
    if (n === 0 && m === 0) return { added: [], removed: [], common: 0, similarity: 1 };
    const THRESH = 4000; // 单边行数上限，避免 O(n*m) 内存爆炸
    if (n > THRESH || m > THRESH || n * m > 4000000) {
      const sa = new Set(aLines), sb = new Set(bLines);
      let common = 0; for (const x of sa) if (sb.has(x)) common++;
      const union = sa.size + sb.size - common;
      const similarity = union === 0 ? 1 : common / union;
      return { added: bLines.filter((l) => !sa.has(l)), removed: aLines.filter((l) => !sb.has(l)), common, similarity, truncated: true };
    }
    const dp = [];
    for (let i = 0; i <= n + 1; i++) dp.push(new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const added = [], removed = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (aLines[i] === bLines[j]) { i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { removed.push(aLines[i]); i++; }
      else { added.push(bLines[j]); j++; }
    }
    while (i < n) { removed.push(aLines[i]); i++; }
    while (j < m) { added.push(bLines[j]); j++; }
    const common = dp[0][0];
    const similarity = (aLines.length + bLines.length) === 0 ? 1 : (2 * common) / (aLines.length + bLines.length);
    return { added, removed, common, similarity };
  }

  // 浏览器端用 pdf.js 抽文本；非浏览器（如 Node 测试）返回 null，由调用方跳过文本对比
  async function safeExtractText(bytes, pw) {
    if (typeof pdfjsLib === 'undefined' || !pdfjsLib.getDocument) return null;
    try {
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const pdf = await pdfjsLib.getDocument({ data: buf, password: pw || '' }).promise;
      const pages = [], allLines = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        let line = ''; const lines = [];
        for (const it of (tc.items || [])) {
          line += (it.str || '');
          if (it.hasEOL) { lines.push(line); line = ''; }
        }
        if (line) lines.push(line);
        const text = lines.join('\n');
        pages.push(text);
        allLines.push('— 第 ' + i + ' 页 —');
        for (const l of lines) allLines.push(l);
      }
      await pdf.destroy();
      return { pages, allLines };
    } catch (e) { return null; }
  }

  // 主入口：对比两个 PDF（结构 + 文本），产出结构化 diff
  async function comparePDFs(a, b, opts, onProgress) {
    opts = opts || {};
    const pwA = opts.passwordA, pwB = opts.passwordB;
    const bytesA = await resolveBytes(a);
    const bytesB = await resolveBytes(b);
    const nA = (await loadDoc(bytesA, pwA)).getPageCount();
    const nB = (await loadDoc(bytesB, pwB)).getPageCount();
    const total = 5; let done = 0;
    const step = (phase) => { if (onProgress) onProgress({ phase, done: ++done, total }); };

    step('对比页数');
    const pageDelta = nB - nA;
    const pages = {
      a: nA, b: nB, delta: pageDelta,
      status: pageDelta === 0 ? 'same' : (pageDelta > 0 ? 'pages_added' : 'pages_removed'),
      detail: '版本 A 共 ' + nA + ' 页，版本 B 共 ' + nB + ' 页',
    };

    step('对比元数据');
    const mA = await getMetadata({ bytes: bytesA }, pwA);
    const mB = await getMetadata({ bytes: bytesB }, pwB);
    const META = [['title', '标题'], ['author', '作者'], ['subject', '主题'], ['keywords', '关键词'], ['creator', '创建者'], ['producer', '生产者']];
    const metaChanges = [];
    for (const kv of META) {
      const k = kv[0], label = kv[1];
      if ((mA[k] || '') !== (mB[k] || '')) metaChanges.push({ key: k, label, a: mA[k] || '（空）', b: mB[k] || '（空）' });
    }
    const metadata = { changed: metaChanges.length > 0, changes: metaChanges };

    step('对比书签/大纲');
    const oA = flattenOutline(await getOutline({ bytes: bytesA }, { password: pwA }));
    const oB = flattenOutline(await getOutline({ bytes: bytesB }, { password: pwB }));
    const outline = diffLists(oA, oB);

    step('对比附件');
    const atA = await listAttachments({ bytes: bytesA, password: pwA });
    const atB = await listAttachments({ bytes: bytesB, password: pwB });
    const attachments = diffAttachments(atA, atB);

    step('对比文本内容');
    let text = null;
    const tA = await safeExtractText(bytesA, pwA);
    const tB = await safeExtractText(bytesB, pwB);
    if (tA && tB) {
      const docDiff = diffTextBlocks(tA.allLines, tB.allLines);
      const perPage = [];
      const minN = Math.min(tA.pages.length, tB.pages.length);
      for (let i = 0; i < minN; i++) perPage.push({ page: i + 1, same: tA.pages[i] === tB.pages[i] });
      const addedPages = [], removedPages = [];
      for (let i = minN; i < tA.pages.length; i++) removedPages.push(i + 1);
      for (let i = minN; i < tB.pages.length; i++) addedPages.push(i + 1);
      text = {
        available: true, similarity: docDiff.similarity,
        addedLines: docDiff.added, removedLines: docDiff.removed,
        perPage, addedPages, removedPages, truncated: !!docDiff.truncated,
        note: '文本相似度约 ' + (docDiff.similarity * 100).toFixed(1) + '%',
      };
    } else {
      text = { available: false, note: '当前运行环境不支持提取文本（需在浏览器中运行本工具才能对比正文内容），已跳过文本对比；其余结构对比仍然有效。' };
    }

    const changedSections = [];
    if (pageDelta !== 0) changedSections.push('pages');
    if (metadata.changed) changedSections.push('metadata');
    if (outline.changed) changedSections.push('outline');
    if (attachments.changed) changedSections.push('attachments');
    if (text && text.available) changedSections.push('text');

    const summary = {
      aName: opts.aName || '版本 A', bName: opts.bName || '版本 B',
      pageCountA: nA, pageCountB: nB,
      changedSections, identical: changedSections.length === 0,
    };

    step('完成');
    return { summary, pages, metadata, outline, attachments, text };
  }

  /* ---------- PDF/A 校验器（validatePDFA） ---------- */
  // 本地启发式校验：把文档与指定 PDF/A 级别（1B/2B/3B，或 auto 自动识别）逐条比对规范要点，
  // 输出结构化报告（每条 pass/fail/warn/info + 总体 verdict）。
  // 注意：这不是官方认证校验器（如 veraPDF），但能快速定位绝大部分硬性不合规项。
  const PDFA_PART = { '1B': 1, '2B': 2, '3B': 3, '1A': 1, '2A': 2, '3A': 3 };
  const PDFA_TRANSPARENCY_ALLOWED = { 1: false, 2: true, 3: true };   // 1B 禁透明度；2B/3B 允许
  const PDFA_EMBEDDED_FILES_ALLOWED = { 1: false, 2: false, 3: true }; // 1B/2B 禁内嵌文件；3B 允许

  function asName(x) { if (!x) return ''; try { const s = x.asString ? x.asString() : ''; return s.replace(/^\//, ''); } catch (e) { return ''; } }
  function textOf(x) {
    if (!x) return '';
    try { if (typeof x.decodeText === 'function') return x.decodeText(); } catch (e) {}
    try { if (typeof x.asString === 'function') return x.asString(); } catch (e) {}
    return String(x);
  }
  function safeLookup(node, name) { try { return node ? node.lookup(PDFName.of(name)) : null; } catch (e) { return null; } }
  function isDict(x) { return x instanceof PDFDict; }
  function isArray(x) { return x instanceof PDFArray; }
  function hasFontFile(fd) { return !!(fd && (safeLookup(fd, 'FontFile') || safeLookup(fd, 'FontFile2') || safeLookup(fd, 'FontFile3'))); }

  // 解析页面有效 Resources（处理页面树继承）
  function getEffectiveResources(pageNode, ctx) {
    let node = pageNode;
    while (node) {
      const r = safeLookup(node, 'Resources');
      if (r) { const rr = r instanceof PDFRef ? ctx.lookup(r, PDFDict) : r; if (rr && isDict(rr)) return rr; }
      const parent = safeLookup(node, 'Parent');
      node = parent ? (parent instanceof PDFRef ? ctx.lookup(parent, PDFDict) : (isDict(parent) ? parent : null)) : null;
    }
    return null;
  }

  // 收集一个 Resources 字典里的所有字体引用（含 XObject 内的，递归）
  function collectFontRefs(res, ctx, out) {
    if (!res || !isDict(res)) return;
    const fonts = safeLookup(res, 'Font');
    if (fonts) {
      if (fonts instanceof PDFRef) out.push(fonts);
      else if (isDict(fonts)) { for (const k of fonts.keys()) { const v = fonts.get(k); if (v instanceof PDFRef) out.push(v); } }
    }
    const xo = safeLookup(res, 'XObject');
    if (xo) {
      const xod = xo instanceof PDFRef ? ctx.lookup(xo, PDFDict) : xo;
      if (xod && isDict(xod)) {
        for (const k of xod.keys()) {
          const v = xod.get(k);
          let xd = null;
          if (v instanceof PDFRef) {
            try {
              const lk = ctx.lookup(v); // 不带类型：图片 XObject 是 PDFStream 而非 PDFDict
              xd = lk && isDict(lk) ? lk : (lk && lk.dict && isDict(lk.dict) ? lk.dict : null);
            } catch (e) { xd = null; }
          } else if (v && isDict(v)) xd = v;
          if (xd) {
            const xr = safeLookup(xd, 'Resources');
            if (xr) { const xrd = xr instanceof PDFRef ? ctx.lookup(xr, PDFDict) : xr; if (xrd && isDict(xrd)) collectFontRefs(xrd, ctx, out); }
          }
        }
      }
    }
  }

  function fontIsEmbedded(fontRef, ctx) {
    const f = ctx.lookup(fontRef, PDFDict);
    if (!f || !isDict(f)) return { embedded: false, type: '?', name: '?', note: '' };
    const sub = asName(safeLookup(f, 'Subtype'));
    const name = textOf(safeLookup(f, 'BaseFont'));
    if (sub === 'Type3') return { embedded: true, type: 'Type3', name, note: 'Type3 字体为自包含程序字体，请人工确认其合规性' };
    if (sub === 'Type0') {
      const descs = safeLookup(f, 'DescendantFonts');
      if (descs && isArray(descs)) {
        for (let i = 0; i < descs.size(); i++) {
          const dref = descs.lookup(i);
          const d = dref instanceof PDFRef ? ctx.lookup(dref, PDFDict) : dref;
          if (!d || !isDict(d)) continue;
          const fd = safeLookup(d, 'FontDescriptor');
          const fdr = fd instanceof PDFRef ? ctx.lookup(fd, PDFDict) : fd;
          if (fdr && hasFontFile(fdr)) return { embedded: true, type: 'Type0', name };
        }
      }
      return { embedded: false, type: 'Type0', name };
    }
    const fd = safeLookup(f, 'FontDescriptor');
    const fdr = fd instanceof PDFRef ? ctx.lookup(fd, PDFDict) : fd;
    if (fdr && hasFontFile(fdr)) return { embedded: true, type: sub, name };
    return { embedded: false, type: sub, name };
  }

  function streamContentBytes(node, ctx) {
    if (!node) return null;
    const s = node instanceof PDFRef ? ctx.lookup(node) : node;
    if (!s) return null;
    if (s.contents) return s.contents;
    try { if (typeof s.getContents === 'function') return s.getContents(); } catch (e) {}
    return null;
  }

  function scanDocTransparency(doc, ctx) {
    const flags = { smask: false, softAlpha: false, blend: false };
    for (const pg of doc.getPages()) {
      const res = getEffectiveResources(pg.node, ctx);
      if (res) {
        const g = safeLookup(res, 'ExtGState');
        if (g) {
          const gd = g instanceof PDFRef ? ctx.lookup(g, PDFDict) : g;
          if (gd && isDict(gd)) {
            for (const k of gd.keys()) {
              const e = gd.get(k);
              const ed = e instanceof PDFRef ? ctx.lookup(e, PDFDict) : e;
              if (ed && isDict(ed)) {
                const num = (x) => { if (!x) return null; try { return x.asNumber ? x.asNumber() : Number(x); } catch (e2) { return null; } };
                const caV = num(safeLookup(ed, 'CA')), ca2V = num(safeLookup(ed, 'ca'));
                if ((caV != null && caV !== 1) || (ca2V != null && ca2V !== 1)) flags.softAlpha = true;
                const bm = safeLookup(ed, 'BM');
                if (bm && asName(bm) !== 'Normal') flags.blend = true;
              }
            }
          }
        }
      }
      const c = safeLookup(pg.node, 'Contents');
      const streams = [];
      if (c) { if (isArray(c)) { for (let i = 0; i < c.size(); i++) streams.push(c.lookup(i)); } else streams.push(c); }
      for (const st of streams) {
        const b = streamContentBytes(st, ctx);
        if (b) { const s = (b instanceof Uint8Array) ? new TextDecoder('latin1').decode(b) : String(b); if (/\/SMask/.test(s)) flags.smask = true; }
      }
    }
    return flags;
  }

  function actionIsLaunch(a, ctx) {
    if (!a) return false;
    const d = a instanceof PDFRef ? ctx.lookup(a, PDFDict) : a;
    if (!d || !isDict(d)) return false;
    return asName(safeLookup(d, 'S')) === 'Launch';
  }
  function scanLaunch(doc, ctx) {
    let found = false;
    const cat = doc.catalog;
    if (actionIsLaunch(safeLookup(cat, 'OpenAction'), ctx)) found = true;
    const caa = safeLookup(cat, 'AA');
    if (caa) { const caad = caa instanceof PDFRef ? ctx.lookup(caa, PDFDict) : caa; if (caad && isDict(caad)) for (const k of caad.keys()) { if (actionIsLaunch(caad.get(k), ctx)) found = true; } }
    for (const pg of doc.getPages()) {
      const an = safeLookup(pg.node, 'Annots');
      if (an) {
        const ad = an instanceof PDFRef ? ctx.lookup(an, PDFArray) : an;
        if (ad && isArray(ad)) {
          for (let i = 0; i < ad.size(); i++) {
            const a = ad.lookup(i);
            const ann = a instanceof PDFRef ? ctx.lookup(a, PDFDict) : a;
            if (ann && isDict(ann)) {
              if (actionIsLaunch(safeLookup(ann, 'A'), ctx)) found = true;
              const aa = safeLookup(ann, 'AA');
              if (aa) { const aad = aa instanceof PDFRef ? ctx.lookup(aa, PDFDict) : aa; if (aad && isDict(aad)) for (const k of aad.keys()) { if (actionIsLaunch(aad.get(k), ctx)) found = true; } }
            }
          }
        }
      }
    }
    return found;
  }

  function detectPDFVersion(bytes) {
    try { const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048)); const m = head.match(/%PDF-(\d+)\.(\d+)/); if (m) return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) }; } catch (e) {}
    return null;
  }
  function detectLevelFromXMP(doc, ctx) {
    try {
      const meta = safeLookup(doc.catalog, 'Metadata');
      const mref = meta instanceof PDFRef ? ctx.lookup(meta, PDFDict) : meta;
      if (mref && mref.contents) {
        const s = new TextDecoder('latin1').decode(mref.contents);
        const pm = s.match(/pdfaid:part>(\d+)</);
        const cm = s.match(/pdfaid:conformance>([AB])</) || s.match(/pdfaid:conformance>([ab])</);
        if (pm) { const part = pm[1]; const conf = cm ? cm[1].toUpperCase() : 'B'; return part + conf; }
      }
    } catch (e) {}
    return '2B';
  }

  async function validatePDFA(file, opts, onProgress) {
    opts = opts || {};
    const bytes = await resolveBytes(file);
    const rawVersion = detectPDFVersion(bytes);
    let level = (opts.level || 'auto').toUpperCase();

    let doc, ctx, fatal = null;
    try { doc = await loadDoc(bytes, opts.password); ctx = doc.context; }
    catch (e) { fatal = (e && e.message) ? e.message : String(e); }

    if (fatal) {
      const checks = [{ id: 'parse', label: '文件可被解析', status: 'fail', detail: '无法加载文档：' + fatal + '（可能已加密但未填密码，或文件损坏）' }];
      if (onProgress) onProgress({ done: 1, total: 1, phase: '完成' });
      return { level: (level === 'AUTO' ? '2B' : level), verdict: 'non-compliant', passCount: 0, failCount: 1, warnCount: 0, infoCount: 0, checks, parseError: fatal, rawVersion };
    }

    if (level === 'AUTO' || !PDFA_PART[level]) level = detectLevelFromXMP(doc, ctx);
    const part = PDFA_PART[level] || 2;
    const cls = level.slice(-1) === 'A' ? 'A' : 'B';
    const checks = [];
    const add = (id, label, status, detail) => checks.push({ id, label, status, detail: detail || '' });

    // 1 无加密（从原始字节的 trailer 区域扫描 /Encrypt 标记；pdf-lib 解密后内存中的 trailer 不再保留 /Encrypt）
    let encrypted = false;
    try {
      const tailStart = Math.max(0, bytes.length - 16 * 1024);
      const tail = new TextDecoder('latin1').decode(bytes.subarray(tailStart));
      if (/\/Encrypt\b/.test(tail)) encrypted = true;
    } catch (e) {}
    add('encrypt', '无加密', encrypted ? 'fail' : 'pass', encrypted ? '文档包含 /Encrypt，PDF/A 禁止加密' : '');

    // 2 字体嵌入
    {
      const fontRefs = [];
      for (const pg of doc.getPages()) { const res = getEffectiveResources(pg.node, ctx); if (res) collectFontRefs(res, ctx, fontRefs); }
      const seen = new Set();
      const unembedded = [];
      let type3 = 0;
      for (const ref of fontRefs) {
        const key = ref.objectNumber + ':' + ref.generationNumber;
        if (seen.has(key)) continue;
        seen.add(key);
        const info = fontIsEmbedded(ref, ctx);
        if (!info.embedded) unembedded.push(info.name || '未知');
        else if (info.note) type3++;
      }
      if (unembedded.length === 0) add('fonts', '全部字体已嵌入', 'pass', type3 ? ('含 ' + type3 + ' 个 Type3 字体，请人工确认') : '');
      else add('fonts', '全部字体已嵌入', 'fail', '以下字体未嵌入：' + unembedded.join('、'));
    }

    // 3 无 JavaScript
    {
      let js = false;
      if (safeLookup(doc.catalog, 'JS')) js = true;
      const names = safeLookup(doc.catalog, 'Names');
      if (names) { const nd = names instanceof PDFRef ? ctx.lookup(names, PDFDict) : names; if (nd && safeLookup(nd, 'JavaScript')) js = true; }
      const oa = safeLookup(doc.catalog, 'OpenAction');
      const od = oa instanceof PDFRef ? ctx.lookup(oa, PDFDict) : oa;
      if (od && isDict(od) && asName(safeLookup(od, 'S')) === 'JavaScript') js = true;
      let pageAA = false;
      for (const pg of doc.getPages()) { if (safeLookup(pg.node, 'AA')) { pageAA = true; break; } }
      add('javascript', '无 JavaScript', (js || pageAA) ? 'fail' : 'pass', (js || pageAA) ? '文档含有 JavaScript 或页面附加动作（/JS、/Names/JavaScript、JS OpenAction、页面 /AA）' : '');
    }

    // 4 OutputIntent + ICC
    {
      const oi = safeLookup(doc.catalog, 'OutputIntents');
      let ok = false;
      if (oi) {
        const oia = oi instanceof PDFRef ? ctx.lookup(oi, PDFArray) : oi;
        if (oia && isArray(oia)) {
          for (let i = 0; i < oia.size(); i++) {
            const o = oia.lookup(i);
            const od = o instanceof PDFRef ? ctx.lookup(o, PDFDict) : o;
            if (!od || !isDict(od)) continue;
            const s = asName(safeLookup(od, 'S'));
            const dop = safeLookup(od, 'DestOutputProfile');
            const dopRef = dop instanceof PDFRef ? ctx.lookup(dop, PDFDict) : dop;
            if ((s === 'GTS_PDFA1' || s === 'GTS_PDFA2' || s === 'GTS_PDFA3') && dopRef && dopRef.contents) ok = true;
          }
        }
      }
      add('outputIntent', '含 OutputIntent 与 ICC 色彩配置', ok ? 'pass' : 'fail', ok ? '' : '缺少 /OutputIntents 或未内嵌合法的 ICC 配置文件（DestOutputProfile）');
    }

    // 5 XMP pdfaid
    {
      const meta = safeLookup(doc.catalog, 'Metadata');
      let ok = false, detail = '';
      if (meta) {
        const mref = meta instanceof PDFRef ? ctx.lookup(meta, PDFDict) : meta;
        if (mref && mref.contents) {
          const s = new TextDecoder('latin1').decode(mref.contents);
          if (/pdfaid:part/.test(s) && /pdfaid:conformance/.test(s)) ok = true;
          else detail = '存在 /Metadata 但未声明 pdfaid:part/conformance';
        } else detail = '存在 /Metadata 但无法读取流内容';
      } else detail = '缺少 /Metadata XMP 元数据';
      add('xmp', '含 PDF/A 标识 XMP（pdfaid）', ok ? 'pass' : 'fail', ok ? '' : detail);
    }

    // 6 trailer /ID
    {
      let hasID = false;
      try { if (ctx.trailerInfo && ctx.trailerInfo.ID) hasID = true; } catch (e) {}
      if (!hasID) { try { const t = ctx.trailer; const id = t ? t.lookup(PDFName.of('ID')) : null; if (id) hasID = true; } catch (e) {} }
      add('id', '含文档 /ID', hasID ? 'pass' : 'fail', hasID ? '' : 'trailer 缺少 /ID');
    }

    // 7 内嵌文件（按级别）
    {
      const names = safeLookup(doc.catalog, 'Names');
      let hasEF = false;
      if (names) { const nd = names instanceof PDFRef ? ctx.lookup(names, PDFDict) : names; if (nd && safeLookup(nd, 'EmbeddedFiles')) hasEF = true; }
      if (hasEF) {
        if (PDFA_EMBEDDED_FILES_ALLOWED[part]) add('embeddedFiles', '内嵌文件', 'info', '含内嵌文件；PDF/A-' + level + ' 允许内嵌文件');
        else add('embeddedFiles', '无内嵌文件', 'fail', '含内嵌文件（/Names/EmbeddedFiles），PDF/A-' + level + ' 禁止内嵌文件');
      } else add('embeddedFiles', '无内嵌文件', 'pass', '');
    }

    // 8 透明度（按级别）
    {
      const f = scanDocTransparency(doc, ctx);
      const used = f.smask || f.softAlpha || f.blend;
      if (used) {
        if (PDFA_TRANSPARENCY_ALLOWED[part]) add('transparency', '透明度使用', 'info', '检测到透明度（SMask/软遮罩/混合模式）；PDF/A-' + level + ' 允许透明度');
        else add('transparency', '无透明度', 'fail', '检测到透明度（SMask/软遮罩/混合模式），PDF/A-1B 禁止透明度');
      } else add('transparency', '无透明度', 'pass', '');
    }

    // 9 Launch 动作
    {
      const has = scanLaunch(doc, ctx);
      add('launch', '无 Launch 动作', has ? 'fail' : 'pass', has ? '文档含 /Launch 动作，PDF/A 禁止' : '');
    }

    // 10 版本（按级别）
    {
      if (!rawVersion) add('version', 'PDF 版本合规', 'warn', '无法确定 PDF 版本（文件头缺失），请人工确认');
      else {
        const need = part === 1 ? '1.4' : '1.7';
        const ok = part === 1 ? (rawVersion.major === 1 && rawVersion.minor === 4) : (rawVersion.major > 1 || (rawVersion.major === 1 && rawVersion.minor >= 7));
        add('version', 'PDF 版本合规', ok ? 'pass' : 'fail', ok ? ('PDF ' + rawVersion.major + '.' + rawVersion.minor + ' 满足 PDF/A-' + level + ' 要求（' + need + '）') : ('PDF ' + rawVersion.major + '.' + rawVersion.minor + ' 不满足 PDF/A-' + level + ' 要求（需 ' + need + '）'));
      }
    }

    // 11 MarkInfo（A 级强制，B 级建议）
    {
      const mi = safeLookup(doc.catalog, 'MarkInfo');
      let marked = false;
      if (mi) { const mid = mi instanceof PDFRef ? ctx.lookup(mi, PDFDict) : mi; const mv = mid ? safeLookup(mid, 'Marked') : null; if (mv && mv.asBoolean && mv.asBoolean()) marked = true; }
      if (cls === 'A') add('markInfo', '已标记（Marked=true）', marked ? 'pass' : 'fail', marked ? '' : 'PDF/A-' + level + ' 要求 /MarkInfo /Marked true');
      else add('markInfo', '已标记（Marked=true）', 'info', marked ? '已标记，符合规范' : '未标记；B 级不强制，但建议标记以通过更严格校验');
    }

    const failCount = checks.filter((c) => c.status === 'fail').length;
    const warnCount = checks.filter((c) => c.status === 'warn').length;
    const passCount = checks.filter((c) => c.status === 'pass').length;
    const infoCount = checks.filter((c) => c.status === 'info').length;
    const verdict = failCount > 0 ? 'non-compliant' : 'compliant';

    if (onProgress) onProgress({ done: 1, total: 1, phase: '完成' });
    return { level, part, cls, verdict, passCount, failCount, warnCount, infoCount, checks, rawVersion };
  }

  /* ---------------- P4-① 提取内嵌图片 ---------------- */
  const CRC_TABLE = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function concatBytes(arrs) { let len = 0; for (const a of arrs) len += a.length; const out = new Uint8Array(len); let off = 0; for (const a of arrs) { out.set(a, off); off += a.length; } return out; }
  function pngChunk(type, data) { const len = new Uint8Array(4); const ld = new DataView(len.buffer); ld.setUint32(0, data.length); const tn = new TextEncoder().encode(type); const crc = new Uint8Array(4); const cd = new DataView(crc.buffer); cd.setUint32(0, crc32(concatBytes([tn, data]))); return concatBytes([len, tn, data, crc]); }
  async function inflateBytes(bytes) {
    if (typeof require === 'function') { try { return new Uint8Array(require('zlib').inflateSync(Buffer.from(bytes))); } catch (e) {} }
    if (typeof DecompressionStream !== 'undefined') { const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); const r = ds.readable.getReader(); const parts = []; let x; while (!(x = await r.read()).done) parts.push(x.value); let l = 0; for (const p of parts) l += p.length; const o = new Uint8Array(l); let o2 = 0; for (const p of parts) { o.set(p, o2); o2 += p.length; } return o; }
    throw new Error('无可用解压实现');
  }
  async function deflateBytes(bytes) {
    if (typeof require === 'function') { try { return new Uint8Array(require('zlib').deflateSync(Buffer.from(bytes))); } catch (e) {} }
    if (typeof CompressionStream !== 'undefined') { const cs = new CompressionStream('deflate'); const w = cs.writable.getWriter(); w.write(bytes); w.close(); const r = cs.readable.getReader(); const parts = []; let x; while (!(x = await r.read()).done) parts.push(x.value); let l = 0; for (const p of parts) l += p.length; const o = new Uint8Array(l); let o2 = 0; for (const p of parts) { o.set(p, o2); o2 += p.length; } return o; }
    throw new Error('无可用压缩实现');
  }
  function filterNameOf(filter) {
    if (!filter) return null;
    if (typeof filter.asString === 'function') return filter.asString().replace(/^\//, '');
    if (typeof filter.lookup === 'function') { const sz = (typeof filter.size === 'number') ? filter.size : (typeof filter.size === 'function' ? filter.size() : 0); if (sz > 0) { const last = filter.lookup(sz - 1); return last && last.asString ? last.asString().replace(/^\//, '') : 'other'; } }
    return 'other';
  }
  function numOf(x) { return x && x.asNumber ? x.asNumber() : null; }
  function lookupIn(node, name) { const d = (node && node.dict) ? node.dict : node; return d ? d.lookup(name) : null; }
  function colorNameOf(csNode) {
    if (!csNode) return 'Gray(默认)';
    if (typeof csNode.asString === 'function') { const s = csNode.asString().replace(/^\//, ''); return ({ DeviceGray: 'Gray', DeviceRGB: 'RGB', DeviceCMYK: 'CMYK' })[s] || s; }
    if (typeof csNode.lookup === 'function') { const t = csNode.lookup(0); if (t && t.asString) { const s = t.asString().replace(/^\//, ''); return ({ Indexed: 'Indexed', ICCBased: 'ICC', Separation: 'Separation', DeviceN: 'DeviceN', CalGray: 'CalGray', CalRGB: 'CalRGB', Lab: 'Lab' })[s] || s; } }
    return 'Unknown';
  }
  function readHexStringBytes(node) {
    if (!node) return null;
    if (typeof node.bytes !== 'undefined' && node.bytes) return (node.bytes instanceof Uint8Array) ? node.bytes : new Uint8Array(node.bytes);
    if (typeof node.getContents === 'function') { const b = node.getContents(); if (b) return b; }
    if (typeof node.decode === 'function') { try { const b = node.decode(); if (b) return b; } catch (e) {} }
    let s = null;
    if (typeof node.asString === 'function') s = node.asString();
    else if (typeof node.value === 'string') s = node.value;
    else if (typeof node.toString === 'function') s = node.toString();
    if (s == null) return null;
    if (/^[0-9A-Fa-f]*$/.test(s) && s.length % 2 === 0) { const out = new Uint8Array(s.length / 2); for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.substr(i, 2), 16); return out; }
    return new Uint8Array(Array.from(s).map((c) => c.charCodeAt(0)));
  }
  function resolveCS(csNode, ctx) {
    if (!csNode) return { type: 'gray', channels: 1 };
    if (typeof csNode.asString === 'function') { const s = csNode.asString().replace(/^\//, ''); if (s === 'DeviceGray') return { type: 'gray', channels: 1 }; if (s === 'DeviceRGB') return { type: 'rgb', channels: 3 }; if (s === 'DeviceCMYK') return { type: 'cmyk', channels: 4 }; return null; }
    if (typeof csNode.lookup === 'function' || typeof csNode.get === 'function') {
      const arrGet = (arr, i) => (typeof arr.lookup === 'function' ? arr.lookup(i) : arr.get(i));
      const t = arrGet(csNode, 0); const tn = t && t.asString ? t.asString().replace(/^\//, '') : '';
      if (tn === 'ICCBased') { const n = numOf((arrGet(csNode, 1) && arrGet(csNode, 1).lookup(PDFName.of('N')))); const ch = n === 4 ? 4 : (n === 3 ? 3 : 1); return { type: ch === 4 ? 'cmyk' : (ch === 3 ? 'rgb' : 'gray'), channels: ch }; }
      if (tn === 'Indexed') {
        const base = resolveCS(arrGet(csNode, 1), ctx); const hival = numOf(arrGet(csNode, 2)) || 255; const table = arrGet(csNode, 3);
        const lut = readHexStringBytes(table);
        if (!lut || !base) return null;
        return { type: 'indexed', channels: base.channels, base, hival, lut };
      }
      return null;
    }
    return null;
  }
  function expandIndexed(data, cs) { const baseCh = cs.channels; const lut = cs.lut; const hival = cs.hival; const res = new Uint8Array(data.length * baseCh); for (let i = 0; i < data.length; i++) { let v = data[i]; if (v > hival) v = hival; for (let c = 0; c < baseCh; c++) res[i * baseCh + c] = lut[v * baseCh + c]; } return res; }
  function cmykToRgb(data) { const out = new Uint8Array((data.length / 4) * 3); for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { const c = data[i] / 255, m = data[i + 1] / 255, y = data[i + 2] / 255, k = data[i + 3] / 255; out[j] = Math.round(255 * (1 - c) * (1 - k)); out[j + 1] = Math.round(255 * (1 - m) * (1 - k)); out[j + 2] = Math.round(255 * (1 - y) * (1 - k)); } return out; }
  function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); if (pa <= pb && pa <= pc) return a; if (pb <= pc) return b; return c; }
  function undoPNGPredictor(data, w, h, bpp, predictor) {
    const stride = w * bpp; const out = new Uint8Array(stride * h); let pos = 0;
    for (let y = 0; y < h; y++) {
      const method = (predictor === 15) ? data[pos++] : (predictor - 10);
      for (let x = 0; x < stride; x++) {
        const raw = data[pos++]; const left = x >= bpp ? out[y * stride + x - bpp] : 0; const up = y > 0 ? out[(y - 1) * stride + x] : 0; const ul = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
        let val; switch (method) { case 0: val = raw; break; case 1: val = raw + left; break; case 2: val = raw + up; break; case 3: val = raw + ((left + up) >> 1); break; case 4: val = raw + paeth(left, up, ul); break; default: val = raw; }
        out[y * stride + x] = val & 0xff;
      }
    } return out;
  }
  function addAlpha(data, ch, alpha) {
    if (ch === 3) { const out = new Uint8Array(data.length / 3 * 4); for (let i = 0, j = 0; i < data.length; i += 3, j += 4) { out[j] = data[i]; out[j + 1] = data[i + 1]; out[j + 2] = data[i + 2]; out[j + 3] = alpha[i / 3]; } return out; }
    if (ch === 1) { const out = new Uint8Array(data.length * 4); for (let i = 0, j = 0; i < data.length; i++, j += 4) { out[j] = out[j + 1] = out[j + 2] = data[i]; out[j + 3] = alpha[i]; } return out; }
    return data;
  }
  async function encodePNG(w, h, channels, data) {
    const colorType = channels === 1 ? 0 : (channels === 3 ? 2 : 6);
    const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = colorType;
    const stride = w * channels; const raw = new Uint8Array((stride + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; raw.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1); }
    const idat = await deflateBytes(raw);
    const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    return concatBytes([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]);
  }
  async function decodeToPlanar(node, ctx) {
    const d = node.dict || node;
    const w = numOf(d.lookup(PDFName.of('Width'))) || 1; const h = numOf(d.lookup(PDFName.of('Height'))) || 1;
    const bpc = numOf(d.lookup(PDFName.of('BitsPerComponent'))) || 8;
    if (bpc !== 8) return { status: 'unsupported', note: '仅支持 8 位图像（当前 ' + bpc + ' 位）' };
    const filter = d.lookup(PDFName.of('Filter')); const fn = filterNameOf(filter);
    const raw = node.getContents ? node.getContents() : null;
    if (!raw) return { status: 'unsupported', note: '无法读取图像流' };
    if (fn === 'DCTDecode') return { status: 'jpeg', bytes: raw, w, h };
    if (fn === 'FlateDecode') {
      let data; try { data = await inflateBytes(raw); } catch (e) { return { status: 'unsupported', note: 'Flate 解压失败' }; }
      const dp = d.lookup(PDFName.of('DecodeParms')); let predictor = 1; if (dp) { const p = dp.lookup(PDFName.of('Predictor')); if (p) predictor = p.asNumber(); }
      if (predictor === 2) return { status: 'unsupported', note: 'TIFF 预测器(2)暂不支持' };
      const cs = resolveCS(d.lookup(PDFName.of('ColorSpace')), ctx);
      if (!cs) return { status: 'unsupported', note: '不支持的色彩空间' };
      let channels = cs.channels; let pix = data;
      const storedChannels = (cs.type === 'indexed') ? 1 : cs.channels;
      if (predictor === 1) { /* 原始像素，无前缀 */ }
      else if (predictor >= 10) pix = undoPNGPredictor(pix, w, h, storedChannels, predictor);
      else return { status: 'unsupported', note: '不支持的预测器 ' + predictor };
      if (cs.type === 'indexed') { pix = expandIndexed(pix, cs); channels = cs.channels; }
      if (cs.type === 'cmyk') { pix = cmykToRgb(pix); channels = 3; }
      return { status: 'planar', w, h, channels, data: pix };
    }
    return { status: 'unsupported', note: '不支持的压缩：' + (fn || '无') };
  }
  async function processImage(node, ctx, pageLabel) {
    const d = node.dict || node;
    const w = numOf(d.lookup(PDFName.of('Width'))) || 0; const h = numOf(d.lookup(PDFName.of('Height'))) || 0;
    const bpc = numOf(d.lookup(PDFName.of('BitsPerComponent'))) || 8;
    const filter = d.lookup(PDFName.of('Filter')); const filterName = filterNameOf(filter) || '无';
    const csNode = d.lookup(PDFName.of('ColorSpace')); const color = colorNameOf(csNode);
    const dec = await decodeToPlanar(node, ctx);
    if (dec.status === 'jpeg') return { format: 'JPEG', ext: 'jpg', page: pageLabel, w, h, bpc, color, filter: filterName, bytes: dec.bytes, status: 'ok', note: '无损导出' };
    if (dec.status === 'planar') {
      let data = dec.data, ch = dec.channels;
      const smask = d.lookup(PDFName.of('SMask'));
      if (smask) { const m = await decodeToPlanar(ctx.lookup(smask), ctx); if (m.status === 'planar' && m.channels === 1) { data = addAlpha(data, ch, m.data); ch = 4; } }
      const png = await encodePNG(dec.w, dec.h, ch, data);
      return { format: 'PNG', ext: 'png', page: pageLabel, w, h, bpc, color: color + (smask ? '+Alpha' : ''), filter: filterName, bytes: png, status: 'ok', note: '转存 PNG' };
    }
    return { format: '-', ext: null, page: pageLabel, w, h, bpc, color, filter: filterName, bytes: null, status: 'skip', note: dec.note || '不支持的格式' };
  }
  async function collectImages(resDict, ctx, out, seen, pageLabel) {
    if (!resDict) return; const xobj = resDict.lookup(PDFName.of('XObject')); if (!xobj) return;
    for (const [key, val] of xobj.entries()) {
      const refKey = (val && val instanceof PDFRef) ? (val.objectNumber + ':' + val.generationNumber) : null;
      if (refKey && seen.has(refKey)) continue;
      const node = ctx.lookup(val); if (!node) continue;
      const sub = lookupIn(node, PDFName.of('Subtype')); const subName = sub && sub.asString ? sub.asString() : null;
      if (subName === '/Image') { if (refKey) seen.add(refKey); out.push(await processImage(node, ctx, pageLabel)); }
      else if (subName === '/Form') { const fres = lookupIn(node, PDFName.of('Resources')); if (fres) await collectImages(fres, ctx, out, seen, pageLabel); }
    }
  }
  function getInheritedResources(pageNode, ctx) { let node = pageNode; let guard = 0; while (node && guard++ < 50) { const r = node.lookup(PDFName.of('Resources')); if (r) return r; node = node.lookup(PDFName.of('Parent')); } return null; }
  async function extractImages(arg, onProgress) {
    const bytes = arg && (arg.bytes || (arg.file instanceof Uint8Array ? arg.file : new Uint8Array(await arg.file.arrayBuffer())));
    const doc = await loadDoc(bytes, arg && arg.password);
    const ctx = doc.context; const out = []; const seen = new Set();
    const n = doc.getPageCount();
    for (let i = 0; i < n; i++) { const page = doc.getPages()[i]; const res = getInheritedResources(page.node, ctx); await collectImages(res, ctx, out, seen, i + 1); if (onProgress) onProgress({ done: i + 1, total: n, phase: '扫描图片' }); }
    if (onProgress) onProgress({ done: n, total: n, phase: '完成' });
    return { images: out, total: out.length };
  }

  window.PDFEngine = {
    mergePDFs, splitPDF, extractPages, splitByOutline, splitByCount, splitBySize, setPageBackground, deletePages, removeBlankPages, detectBlankPages, detectDuplicatePages, removeDuplicatePages, reorderPages, rotatePages, rotateSelectedPages,
    encryptPDF, decryptPDF,
    addTextWatermark, addImageWatermark, addPageNumbers, addHeaderFooter,
    compressPDF, rasterizeCompress, imagesToPDF, pdfToImages, extractText, pageCount,
    insertPages, replacePage, cropPages, resizePages, placeText, placeImage,
    addHighlight, getFormFields, exportFormFields, importFormFields, fillForm, flattenForms, batchFillForms, parseCSV,
    addVectorAnnotation,
    exportFormFDF,
    setOutline, getOutline,
    addLink, generateTOC,
    getMetadata, setMetadata, getPageLabels, setPageLabels,
    signPDF, verifyPDFSignature,
    ocrPDF, makeSearchablePDF,
    exportToWord, exportToExcel, detectTableStructure, detectTables, buildDocxDocument, buildXlsx,
    redactPDF, locateKeywords,
    searchText, replaceText, applyReplace,
    addTextWithFont,
    toPDFA, buildSRGBICCProfile, buildPDFAXMP,
    listAttachments, addAttachment, removeAttachment, readEmbeddedFiles, rebuildEmbeddedFiles,
    repairPDF, diagnoseCorruption,
    comparePDFs, diffTextBlocks, flattenOutline, diffLists, diffAttachments, safeExtractText,
    validatePDFA, extractImages,
    getAnnotations,
    PT_PER_MM, PAGE_SIZES,
  };
})();
