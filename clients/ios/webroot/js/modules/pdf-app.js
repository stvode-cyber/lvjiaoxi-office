/* =========================================================================
 * 绿角犀 PDF · 交互层 (app.js)  —  Adobe Acrobat 风格布局
 * ========================================================================= */
(function () {

  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const E = window.PDFEngine;
  const PDF$ = (s) => document.querySelector(s);

  const sidebar = PDF$('#sidebar');
  const homePanel = PDF$('#homePanel');
  const opPanel = PDF$('#opPanel');
  const form = PDF$('#opForm');
  const titleEl = PDF$('#opTitle');
  const descEl = PDF$('#opDesc');
  const opGlyph = PDF$('#opGlyph');
  const previewPanel = PDF$('#previewPanel');
  const previewCanvas = PDF$('#previewCanvas');
  const previewMeta = PDF$('#previewMeta');
  const prevBtn = PDF$('#prevPage');
  const nextBtn = PDF$('#nextPage');
  const pageCounter = PDF$('#pageCounter');
  const resultPanel = PDF$('#resultPanel');
  const resultList = PDF$('#resultList');
  const runProgress = PDF$('#runProgress');
  const progFill = runProgress.querySelector('.progress-fill');
  const progText = runProgress.querySelector('.progress-text');
  const taskPanel = PDF$('#taskPanel');
  const taskList = PDF$('#taskList');
  const taskEmpty = PDF$('#taskEmpty');
  const taskCount = PDF$('#taskCount');
  const breadcrumb = PDF$('#breadcrumb');
  const crumbHome = PDF$('#crumbHome');

  const state = { files: {}, op: null, pdfDoc: null, currentPage: 1, formValues: {} };
  const PT_PER_MM = 72 / 25.4;
  let pickCanvases = []; // 交互式预览画布（裁剪框选/定点放置），renderOp 时重置
  const pagePickers = {}; // key -> 页面多选器 wrap（_pagesValue() 输出 pages 字符串）

  /* ---------------- 图标（24x24 描边，currentColor） ---------------- */
  const ICONS = {
    merge: '<rect x="4" y="4" width="9" height="16" rx="1.5"/><rect x="11" y="6" width="9" height="16" rx="1.5"/><path d="M6 12h12"/>',
    split: '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><path d="M8 7l12 10M8 17L20 7"/>',
    splitn: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    bg: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 15l4-4 3 3 4-4 3 3v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="currentColor"/>',
    splitbm: '<path d="M4 6h7v12H4zM13 6h7v12h-7z"/><path d="M11 12h2"/>',
    splitmb: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M7 8h10M7 12h7M7 16h4"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>',
    rotatepages: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/><rect x="3" y="14" width="5" height="7" rx="1" fill="currentColor" opacity="0.25"/>',
    delete: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    reorder: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3 5l1.6 2L3 9M3 15l1.6 2L3 19"/>',
    extract: '<path d="M14 3v5h5"/><path d="M14 3H6v18h12V8z"/><path d="M9 13h6m0 0-2-2m2 2-2 2"/>',
    encrypt: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    decrypt: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    textwm: '<path d="M5 6h14M12 6v13"/><path d="M4 9h16M4 14h16" stroke-dasharray="2 2" opacity=".45"/>',
    imgwm: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l4-4 3 3 3-3 4 4"/>',
    pagenum: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M10 9l-2 6 2 0M14 9l-2 6 2 0"/>',
    font: '<path d="M5 19L12 4l7 15M8.5 14h7"/>',
    hf: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 8h16M4 16h16"/>',
    compress: '<path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4"/><path d="M9 12h6"/>',
    raster: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    img2pdf: '<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="6" rx="1"/><circle cx="10" cy="9" r="1"/><path d="M8 17l3-3 2 2 3-3 3 3"/>',
    pdf2img: '<rect x="8" y="3" width="8" height="14" rx="1"/><path d="M3 13l3-3 3 3 3-3 3 3"/><path d="M3 21h18"/>',
    formfields: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M7 7h10M7 11h10M7 15h6"/><circle cx="16" cy="15" r="1.6"/>',
    formimport: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M8 13l3 3 3-3"/><path d="M11 16V9"/>',
    formfdf: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16"/><path d="M12 6v7M9 10l3 3 3-3"/><path d="M8 17h8"/>',
    text: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/>',
    'cat-page': '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5"/>',
    'cat-sec': '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    'cat-wm': '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    'cat-conv': '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    'cat-edit': '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    insert: '<rect x="4" y="5" width="10" height="14" rx="1.5"/><rect x="9" y="2" width="10" height="14" rx="1.5"/><path d="M14 9v6M11 12h6" stroke-width="2.2"/>',
    replace: '<rect x="4" y="4" width="10" height="14" rx="1.5"/><path d="M14 8l5-3v9l-5-3"/><path d="M3 14l5 3 5-3" opacity=".5"/>',
    crop: '<path d="M5 2v13a2 2 0 0 0 2 2h13"/><path d="M2 5h13a2 2 0 0 1 2 2v13"/>',
    resize: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
    placetext: '<path d="M4 6h16M4 10h10M4 14h16M4 18h9"/>',
    placeimg: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l4-4 3 3 3-3 4 4"/><path d="M18 8v6M15 11h6" stroke-width="2"/>',
    fillform: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    batchform: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>',
    highlight: '<rect x="5" y="11" width="14" height="6" rx="1.5" transform="rotate(-12 12 14)"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    arrow: '<path d="M4 18L20 6M20 6h-7M20 6v7"/>',
    ink: '<path d="M3 17c2-1 3-5 6-5s3 4 6 2 3-8 6-9"/><path d="M18 4l3 3-1 1-3-3z"/>',
    comment: '<path d="M4 5h16v10H9l-4 4z"/>',
    bookmarks: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
    pagelabels: '<path d="M3 4h12l6 6-9 9-9-9V4z"/><circle cx="8" cy="9" r="1.4"/>',
    link: '<path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
    toc: '<path d="M4 6h11M4 12h11M4 18h7M17 5v14M17 5l3 2M17 5l-3 2"/>',
    metadata: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    batch: '<rect x="4" y="4" width="16" height="5" rx="1"/><rect x="4" y="15" width="16" height="5" rx="1"/><path d="M8 9v6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    replacext: '<path d="M7 4L4 7l3 3M4 7h11M17 20l3-3-3-3M20 17H9"/>',
    pdfa: '<rect x="4" y="4" width="16" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M5 9h14"/><path d="M10 13h4"/>',
    attach: '<path d="M21 11l-8.5 8.5a4 4 0 0 1-5.7-5.7L15 5.3a2.5 2.5 0 0 1 3.5 3.5l-8.5 8.5a1 1 0 0 1-1.4-1.4l8-8"/>',
    repair: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2 2 0 1 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.1-2.1 2.9-2.3z"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/><path d="M10.5 9l3 3-3 3"/>',
    pdfacheck: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 11l2 2 4-4"/>',
    extractimg: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 15l-5-5-4 4-2.5-2.5L3 21"/>',
    dedupe: '<rect x="3" y="4" width="8" height="11" rx="1.5"/><rect x="13" y="4" width="8" height="11" rx="1.5" opacity=".35"/><path d="M3 19h8M13 19h8" opacity=".5"/><path d="M9 9.5l1.5 1.5L9 12.5" stroke-dasharray="0"/><path d="M7 9l5 5M12 9l-5 5" opacity=".6"/>',
    pcount: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    locate: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="2"/>',
    difflist: '<path d="M8 4H4v16h4zM20 4h-4v16h4z"/><path d="M11 8h2M11 12h2M11 16h2"/>',
    difftext: '<path d="M4 5h7M4 9h7M4 13h5M13 5h7M13 9h7M13 13h5M4 17h16"/>',
    diffatt: '<path d="M9 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2M15 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1-2 2"/>',
    diagnose: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
    flattenol: '<path d="M4 6h16M4 12h10M4 18h10"/><circle cx="18" cy="12" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
    annotate: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h6"/>',
    antexport: '<path d="M12 3v12M6 9l6 6 6-6"/><path d="M4 19h16"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1l-.5-2.6h-4l-.5 2.6a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7.6 7.6 0 0 0 1.7 1l.5 2.6h4l.5-2.6a7.6 7.6 0 0 0 1.7-1l2.3 1 2-3.4z"/>',
  };

  function iconSvg(name) {
    const tmp = document.createElement('div');
    tmp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return tmp.firstElementChild;
  }

  /* ---------------- 分类与工具 ---------------- */
  const CAT_COLOR = { page: 'var(--cat-page)', sec: 'var(--cat-sec)', wm: 'var(--cat-wm)', conv: 'var(--cat-conv)', edit: 'var(--cat-edit)' };
  const CATEGORIES = [
    { key: 'page', title: '页面操作', icon: 'cat-page', tools: ['merge', 'split', 'rotate', 'rotatepages', 'splitbm', 'splitn', 'splitmb', 'bg', 'delete', 'reorder', 'extract', 'blank', 'dedupe', 'pcount'] },
    { key: 'sec', title: '加密 / 解密', icon: 'cat-sec', tools: ['encrypt', 'decrypt', 'verify', 'redact', 'pdfa', 'pdfacheck'] },
    { key: 'wm', title: '水印 / 标注', icon: 'cat-wm', tools: ['textwm', 'imgwm', 'pagenum', 'hf', 'font'] },
    { key: 'edit', title: '编辑', icon: 'cat-edit', tools: ['insert', 'replace', 'crop', 'resize', 'placetext', 'placeimg', 'highlight', 'rect', 'arrow', 'ink', 'comment', 'fillform', 'sign', 'bookmarks', 'link', 'toc', 'metadata', 'batch', 'search', 'replacext', 'attach', 'downatt', 'repair', 'compare', 'batchform', 'pagelabels', 'formfields', 'formimport', 'formfdf', 'locate', 'difflist', 'difftext', 'diffatt', 'diagnose', 'flattenol', 'annotate', 'antexport'] },
    { key: 'conv', title: '压缩 / 转换', icon: 'cat-conv', tools: ['compress', 'raster', 'img2pdf', 'pdf2img', 'text', 'extracttext', 'table', 'ocr', 'word', 'excel', 'extractimg'] },
  ];
  function catOf(tk) { const c = CATEGORIES.find((c) => c.tools.includes(tk)); return c ? CAT_COLOR[c.key] : 'var(--accent)'; }

  /* ---------------- 操作定义 ---------------- */
  const OPS = {
    merge: {
      title: '合并 PDF', desc: '把多个 PDF 按顺序合并成一个文件。',
      fields: [
        { key: 'files', label: '选择 PDF 文件（按顺序）', type: 'file', accept: 'application/pdf', multiple: true },
      ],
      run: async (v, onProgress) => {
        if (!v.files || !v.files.length) throw new Error('请至少选择两个 PDF');
        const bytes = await E.mergePDFs(v.files.map((f) => ({ file: f })), onProgress);
        return single('merged.pdf', bytes);
      },
    },
    split: {
      title: '拆分为单页', desc: '把每一页导出为独立的 PDF 文件（打包下载）。',
      fields: [ { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' } ],
      run: async (v, onProgress) => {
        const parts = await E.splitPDF({ file: v.file }, onProgress);
        const zip = new JSZip();
        parts.forEach((p) => zip.file(`page-${String(p.index + 1).padStart(3, '0')}.pdf`, p.bytes));
        const blob = await zip.generateAsync({ type: 'blob' });
        return { message: `已拆分为 ${parts.length} 页`, results: [{ name: 'split-pages.zip', blob, kind: 'zip' }] };
      },
    },
    splitbm: {
      title: '按书签拆分', desc: '按文档大纲/书签把大 PDF 切成若干独立 PDF：每个顶层书签（或所有书签）切成一章。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择带书签的 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'mode', label: '拆分依据', type: 'select', options: [
          { value: 'top', label: '仅顶层书签（按章拆分）' },
          { value: 'all', label: '所有书签（含子级）' },
        ] },
        { key: 'password', label: '打开密码（可选）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const res = await E.splitByOutline({ file: v.file }, { mode: v.mode, password: v.password }, onProgress);
        if (!res.count) {
          const msg = res.noBookmarks ? '该 PDF 没有书签/大纲，无法按书签拆分。可改用「拆分为单页」或「提取页面」。' : '未找到有效书签切分点。';
          return { message: msg, results: [{ name: '提示', kind: 'text', text: msg }] };
        }
        const zip = new JSZip();
        res.files.forEach((f) => zip.file(f.name, f.bytes));
        const report = '按书签拆分结果：\n共 ' + res.count + ' 个文件，原文档 ' + res.totalPages + ' 页。\n' +
          res.files.map((f, i) => (i + 1) + '. ' + f.name + '（第 ' + f.start + '-' + f.end + ' 页，' + f.pages + ' 页）').join('\n');
        zip.file('split-by-outline-report.txt', report);
        const blob = await zip.generateAsync({ type: 'blob' });
        return { message: '已按书签拆分为 ' + res.count + ' 个 PDF', results: [{ name: 'split-by-outline.zip', blob, kind: 'zip' }, { name: 'split-by-outline-report.txt', kind: 'text', text: report }] };
      },
    },
    splitn: {
      title: '按页数拆分', desc: '把 PDF 按固定页数切成若干独立文件（如每 5 页一组）：与「拆分为单页」「按书签拆分」互补，适合按固定长度拆分长文档。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'count', label: '每组页数', type: 'number', value: 5, min: 1, placeholder: '如 5 表示每 5 页一组' },
        { key: 'password', label: '打开密码（可选）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const per = Math.max(1, Math.floor(Number(v.count) || 1));
        const res = await E.splitByCount({ file: v.file }, { count: per, password: v.password }, onProgress);
        if (!res.count) return { message: '未生成任何文件。', results: [{ name: '提示', kind: 'text', text: '该 PDF 没有可拆分的页面。' }] };
        const zip = new JSZip();
        res.files.forEach((f) => zip.file(f.name, f.bytes));
        const report = '按页数拆分结果（每组 ' + per + ' 页）：\n共 ' + res.count + ' 个文件，原文档 ' + res.totalPages + ' 页。\n' +
          res.files.map((f) => (f.index) + '. ' + f.name + '（第 ' + f.start + '-' + f.end + ' 页，' + f.pages + ' 页）').join('\n');
        zip.file('split-by-count-report.txt', report);
        const blob = await zip.generateAsync({ type: 'blob' });
        return { message: '已按每 ' + per + ' 页拆分为 ' + res.count + ' 个 PDF', results: [{ name: 'split-by-count.zip', blob, kind: 'zip' }, { name: 'split-by-count-report.txt', kind: 'text', text: report }] };
      },
    },
    splitmb: {
      title: '按文件大小拆分', desc: '把 PDF 按目标文件大小切成若干独立文件（如每个不超过 2MB）：采用贪心装箱，从某页起不断并入下一页直到再加一页会超限为止；若单页本身已超限则单独成段（不强压）。适合按体积拆分长文档/控制单文件大小。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'maxSizeKB', label: '每个文件上限（KB）', type: 'number', value: 2048, min: 1, placeholder: '如 2048 表示每个文件约 2MB 以内' },
        { key: 'password', label: '打开密码（可选）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const maxKB = Math.max(1, Math.floor(Number(v.maxSizeKB) || 1));
        const res = await E.splitBySize({ file: v.file }, { maxSizeKB: maxKB, password: v.password }, onProgress);
        if (!res.count) return { message: '未生成任何文件。', results: [{ name: '提示', kind: 'text', text: '该 PDF 没有可拆分的页面。' }] };
        const zip = new JSZip();
        res.files.forEach((f) => zip.file(f.name, f.bytes));
        const report = '按文件大小拆分结果（每个 ≤ ' + maxKB + ' KB）：\n共 ' + res.count + ' 个文件，原文档 ' + res.totalPages + ' 页。\n' +
          res.files.map((f) => (f.index) + '. ' + f.name + '（第 ' + f.start + '-' + f.end + ' 页，' + f.pages + ' 页，' + f.sizeKB + ' KB' + (f.overSingle ? '，单页已超限' : '') + '）').join('\n');
        zip.file('split-by-size-report.txt', report);
        const blob = await zip.generateAsync({ type: 'blob' });
        return { message: '已按大小拆分为 ' + res.count + ' 个 PDF（每个 ≤ ' + maxKB + ' KB）', results: [{ name: 'split-by-size.zip', blob, kind: 'zip' }, { name: 'split-by-size-report.txt', kind: 'text', text: report }] };
      },
    },
    rotate: {
      title: '整体旋转', desc: '把所有页面统一旋转指定角度（90 的倍数）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'angle', label: '旋转角度', type: 'select', options: [ {value:'90',label:'顺时针 90°'}, {value:'180',label:'180°'}, {value:'270',label:'顺时针 270°'}, {value:'0',label:'归正 0°'} ] },
      ],
      run: async (v, onProgress) => single('rotated.pdf', await E.rotatePages({ file: v.file }, null, Number(v.angle), onProgress)),
    },
    rotatepages: {
      title: '指定页旋转', desc: '只旋转选定页面（专治单页扫描歪斜）：支持奇数页 / 偶数页 / 指定页（如 1-3,5），角度相对当前叠加。与「整体旋转」互补——后者把所有页设成同一绝对角度，本工具只动你选的页。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'mode', label: '旋转范围', type: 'select', options: [
          { value: 'odd', label: '奇数页' },
          { value: 'even', label: '偶数页' },
          { value: 'custom', label: '指定页' },
          { value: 'all', label: '全部页面' },
        ] },
        { key: 'pages', label: '指定页（如 1-3,5,8）', type: 'text', group: 'custom', placeholder: '1-3,5,8' },
        { key: 'delta', label: '旋转方向 / 角度', type: 'select', options: [
          { value: '90', label: '顺时针 90°' },
          { value: '-90', label: '逆时针 90°' },
          { value: '180', label: '180°' },
        ] },
        { key: 'password', label: '打开密码（可选）', type: 'password' },
      ],
      afterRender: (form) => {
        const modeSel = form.querySelector('[data-key="mode"]');
        if (!modeSel) return;
        const apply = () => {
          const show = modeSel.value === 'custom';
          form.querySelectorAll('[data-group="custom"]').forEach((el) => { el.style.display = show ? '' : 'none'; });
        };
        modeSel.addEventListener('change', apply);
        apply();
      },
      run: async (v, onProgress) => single('rotated-pages.pdf', await E.rotateSelectedPages({ file: v.file }, { mode: v.mode, pages: v.pages, delta: Number(v.delta), password: v.password }, onProgress)),
    },
    bg: {
      title: '页面背景', desc: '给页面加纯色或图片背景，绘制在现有内容「下层」（即显示为页面背景，不遮挡文字）。支持全部页 / 指定页（如 1-3,5），图片可铺满或平铺。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'mode', label: '背景类型', type: 'select', options: [ { value: 'color', label: '纯色' }, { value: 'image', label: '图片' } ] },
        { key: 'color', label: '背景颜色', type: 'color', value: 'OS.theme.getVar("--bg2")', group: 'color' },
        { key: 'image', label: '背景图片', type: 'file', accept: 'image/*', group: 'image' },
        { key: 'fit', label: '图片适配', type: 'select', options: [ { value: 'cover', label: '拉伸铺满整页' }, { value: 'tile', label: '按原尺寸平铺' } ], group: 'image' },
        { key: 'scope', label: '作用范围', type: 'select', options: [ { value: 'all', label: '全部页面' }, { value: 'custom', label: '指定页' } ] },
        { key: 'pages', label: '指定页（如 1-3,5,8）', type: 'text', group: 'custom', placeholder: '1-3,5,8' },
        { key: 'password', label: '打开密码（可选）', type: 'password' },
      ],
      afterRender: (form) => {
        const modeSel = form.querySelector('[data-key="mode"]');
        const scopeSel = form.querySelector('[data-key="scope"]');
        if (!modeSel) return;
        const apply = () => {
          const isImage = modeSel.value === 'image';
          form.querySelectorAll('[data-group="color"]').forEach((el) => { el.style.display = isImage ? 'none' : ''; });
          form.querySelectorAll('[data-group="image"]').forEach((el) => { el.style.display = isImage ? '' : 'none'; });
          if (scopeSel) {
            const showPages = scopeSel.value === 'custom';
            form.querySelectorAll('[data-group="custom"]').forEach((el) => { el.style.display = showPages ? '' : 'none'; });
          }
        };
        modeSel.addEventListener('change', apply);
        if (scopeSel) scopeSel.addEventListener('change', apply);
        apply();
      },
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const opts = { mode: v.mode || 'color', color: v.color || 'OS.theme.getVar("--bg2")', password: v.password };
        if (opts.mode === 'image') {
          if (!v.image) throw new Error('请选择背景图片');
          opts.imageBytes = new Uint8Array(await v.image.arrayBuffer());
          opts.fit = v.fit || 'cover';
        }
        if (v.scope === 'custom' && v.pages) opts.pageRanges = v.pages;
        const res = await E.setPageBackground({ file: v.file }, opts, onProgress);
        return single('bg.pdf', res.bytes);
      },
    },
    delete: {
      title: '删除页面', desc: '在下方缩略图中勾选要删除的页面（默认不选＝不删除）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pages', label: '勾选要删除的页面（默认不选＝不删除）', type: 'pagepicker', purpose: 'remove' },
      ],
      run: async (v, onProgress) => single('deleted.pdf', await E.deletePages({ file: v.file }, parsePages(v.pages), onProgress)),
    },
    reorder: {
      title: '重排页面', desc: '输入新的页码顺序，例如：3,1,2',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pages', label: '新顺序', type: 'text', placeholder: '3,1,2', hint: '逗号分隔的 1 起页码' },
      ],
      run: async (v, onProgress) => single('reordered.pdf', await E.reorderPages({ file: v.file }, parsePages(v.pages), onProgress)),
    },
    extract: {
      title: '提取页面', desc: '在下方缩略图中勾选要保留的页面（默认全选）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pages', label: '勾选要提取的页面（默认全选）', type: 'pagepicker', purpose: 'keep' },
      ],
      run: async (v, onProgress) => single('extracted.pdf', await E.extractPages({ file: v.file }, parsePages(v.pages), onProgress)),
    },
    blank: {
      title: '去除空白页', desc: '自动扫描并移除完全空白的页面（无文本 / 无图像 / 无绘制 / 无批注），用于扫描件、拍照件的整理。支持「仅预览」先确认，或「直接删除并下载」。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'action', label: '操作', type: 'select', value: 'remove',
          options: [ {value:'remove',label:'删除空白页并下载'}, {value:'list',label:'仅列出空白页（预览）'} ] },
        { key: 'password', label: '密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (v.action === 'list') {
          const det = await E.detectBlankPages({ file: v.file }, { password: v.password }, onProgress);
          const text = (det.blank.length ? '检测到空白页（1-based 页码）：\n' + det.blank.join(', ') : '未发现空白页') + '\n共 ' + det.total + ' 页';
          return { message: det.blank.length ? ('发现 ' + det.blank.length + ' 个空白页') : '无空白页', results: [{ name: '空白页检测结果', kind: 'text', text }] };
        }
        const res = await E.removeBlankPages({ file: v.file }, { password: v.password }, onProgress);
        if (res.keptAll) {
          return { message: '没有空白页，原文件未改动', results: [{ name: '结果', kind: 'text', text: '未发现空白页，共 ' + res.total + ' 页，原文件保持不变。' }] };
        }
        const note = res.allBlank ? '\n（原文档全部为空白页，已删除内容并保留 1 个空白占位页，避免生成无效 PDF）' : '';
        const report = '已删除 ' + res.removed.length + ' 个空白页（页码：' + res.removed.join(', ') + '）。\n剩余页数：' + (res.total - res.removed.length) + note;
        const base = single('no-blank.pdf', res.bytes);
        base.message = '已删除 ' + res.removed.length + ' 个空白页';
        base.results.push({ name: 'blank-report.txt', blob: new Blob([report], { type: 'text/plain;charset=utf-8' }), kind: 'text' });
        return base;
      },
    },
    dedupe: {
      title: '删除重复页', desc: '按「页面内容签名」自动找出完全相同的页面并移除，保留每个内容的第一份。用于扫描件、批量导出产生的重复页整理。可选「全部重复」或「仅相邻重复」两种判定模式，支持「仅预览」先确认。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'mode', label: '判定模式', type: 'select', value: 'all',
          options: [ {value:'all',label:'全部重复（任意位置内容相同即视为重复）'}, {value:'consecutive',label:'仅相邻重复（连续相同页）'} ] },
        { key: 'action', label: '操作', type: 'select', value: 'remove',
          options: [ {value:'remove',label:'删除重复页并下载'}, {value:'list',label:'仅列出重复页（预览）'} ] },
        { key: 'password', label: '密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (v.action === 'list') {
          const det = await E.detectDuplicatePages({ file: v.file }, { mode: v.mode, password: v.password }, onProgress);
          const text = (det.duplicate.length ? '检测到重复页（将保留其首次出现的页）：\n重复页（1-based 页码）：' + det.duplicate.join(', ') + '\n保留页：' + det.kept.join(', ') : '未发现重复页') + '\n共 ' + det.total + ' 页';
          return { message: det.duplicate.length ? ('发现 ' + det.duplicate.length + ' 个重复页') : '无重复页', results: [{ name: '重复页检测结果', kind: 'text', text }] };
        }
        const res = await E.removeDuplicatePages({ file: v.file }, { mode: v.mode, password: v.password }, onProgress);
        if (res.keptAll) {
          return { message: '没有重复页，原文件未改动', results: [{ name: '结果', kind: 'text', text: '未发现重复页，共 ' + res.total + ' 页，原文件保持不变。' }] };
        }
        const report = '已删除 ' + res.removed.length + ' 个重复页（页码：' + res.removed.join(', ') + '）。\n保留页数：' + res.kept.length + '\n保留页（1-based）：' + res.kept.join(', ');
        const base = single('deduped.pdf', res.bytes);
        base.message = '已删除 ' + res.removed.length + ' 个重复页';
        base.results.push({ name: 'dedupe-report.txt', blob: new Blob([report], { type: 'text/plain;charset=utf-8' }), kind: 'text' });
        return base;
      },
    },
    pcount: {
      title: '页数统计', desc: '快速读取 PDF 总页数，输出文本报告。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const n = await E.pageCount({ file: v.file }, onProgress);
        const report = `文件：${v.file.name || '未命名'}\n总页数：${n} 页`;
        return { message: `共 ${n} 页`, results: [{ name: 'page-count.txt', text: report, kind: 'text' }] };
      },
    },
    locate: {
      title: '关键词定位', desc: '在 PDF 中定位关键词出现的页面与坐标（PDF 用户坐标，原点左下），用于脱敏 / 目录 / 批注前的精准落点。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'keywords', label: '关键词（每行一个，命中任一即列出）', type: 'textarea', rows: 4, placeholder: '发票\n合同\n甲方' },
        { key: 'matchCase', label: '', type: 'checks', options: [ { key: 'matchCase', label: '区分大小写（默认不区分）' } ], checked: [] },
        { key: 'password', label: '密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        if (!v.keywords || !v.keywords.trim()) throw new Error('请输入至少一个关键词');
        const kws = v.keywords.split('\n').map((s) => s.trim()).filter(Boolean);
        const boxes = await E.locateKeywords(v.file, kws, { caseInsensitive: !(v.matchCase && v.matchCase.matchCase), password: v.password }, onProgress);
        const byPage = {};
        boxes.forEach((b) => { (byPage[b.page] = byPage[b.page] || []).push(b); });
        let report = `关键词：${kws.join('、')}\n命中框总数：${boxes.length}，分布 ${Object.keys(byPage).length} 页。\n\n`;
        Object.keys(byPage).sort((a, b) => a - b).forEach((p) => {
          report += `第 ${p} 页（${byPage[p].length} 处）：\n`;
          byPage[p].forEach((b, i) => { report += `  ${i + 1}. x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.w.toFixed(1)} h=${b.h.toFixed(1)}\n`; });
        });
        return { message: `共定位 ${boxes.length} 处`, results: [{ name: 'keyword-locations.txt', text: report, kind: 'text' }] };
      },
    },
    difflist: {
      title: '列表对比', desc: '对比两份「每行一条」的文本列表（如书签清单、字段名清单），列出新增 / 移除项。纯本地、不依赖 PDF。',
      fields: [
        { key: 'textA', label: '列表 A（每行一条）', type: 'textarea', rows: 6, placeholder: '第一行\n第二行' },
        { key: 'textB', label: '列表 B（每行一条）', type: 'textarea', rows: 6, placeholder: '第一行\n第三行' },
      ],
      run: async (v, onProgress) => {
        const a = (v.textA || '').split('\n').map((s) => s.trim()).filter(Boolean);
        const b = (v.textB || '').split('\n').map((s) => s.trim()).filter(Boolean);
        const res = E.diffLists(a, b);
        let report = `列表 A：${a.length} 条，列表 B：${b.length} 条。\n`;
        report += res.changed ? `发现差异（新增 ${res.added.length} / 移除 ${res.removed.length}）。\n` : '两份列表完全一致。\n';
        if (res.added.length) report += '\n【B 中新增】\n' + res.added.map((x) => '  + ' + x).join('\n') + '\n';
        if (res.removed.length) report += '\n【B 中移除】\n' + res.removed.map((x) => '  - ' + x).join('\n') + '\n';
        return { message: res.changed ? '发现差异' : '无差异', results: [{ name: 'list-diff.txt', text: report, kind: 'text' }] };
      },
    },
    difftext: {
      title: '文本块对比', desc: '对比两段文本（按行）的差异，列出新增 / 删除行与整体相似度，超大文本自动降级估算。纯本地、不依赖 PDF。',
      fields: [
        { key: 'textA', label: '文本 A（按行）', type: 'textarea', rows: 6, placeholder: '旧版文本，每行一句' },
        { key: 'textB', label: '文本 B（按行）', type: 'textarea', rows: 6, placeholder: '新版文本，每行一句' },
      ],
      run: async (v, onProgress) => {
        const a = (v.textA || '').split('\n');
        const b = (v.textB || '').split('\n');
        const res = E.diffTextBlocks(a, b);
        let report = `文本 A：${a.length} 行，文本 B：${b.length} 行。\n`;
        report += `相似度：${(res.similarity * 100).toFixed(1)}%${res.truncated ? '（已降级估算）' : ''}\n`;
        report += `新增 ${res.added.length} 行 / 删除 ${res.removed.length} 行 / 共有 ${res.common} 行。\n`;
        if (res.added.length) report += '\n【新增】\n' + res.added.map((x) => '  + ' + x).join('\n') + '\n';
        if (res.removed.length) report += '\n【删除】\n' + res.removed.map((x) => '  - ' + x).join('\n') + '\n';
        return { message: `相似度 ${(res.similarity * 100).toFixed(1)}%`, results: [{ name: 'text-diff.txt', text: report, kind: 'text' }] };
      },
    },
    diffatt: {
      title: '附件对比', desc: '对比两份 PDF 的嵌入式附件（按名称），列出新增 / 移除 / 大小变更。纯本地、文件不上传。',
      fields: [
        { key: 'fileA', label: 'PDF A', type: 'file', accept: 'application/pdf' },
        { key: 'fileB', label: 'PDF B', type: 'file', accept: 'application/pdf' },
        { key: 'passwordA', label: 'A 密码（若已加密）', type: 'password' },
        { key: 'passwordB', label: 'B 密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.fileA || !v.fileB) throw new Error('请同时选择两个 PDF');
        const atA = await E.listAttachments({ file: v.fileA, password: v.passwordA });
        const atB = await E.listAttachments({ file: v.fileB, password: v.passwordB });
        const res = E.diffAttachments(atA, atB);
        let report = `PDF A 附件：${atA.length} 个，PDF B 附件：${atB.length} 个。\n`;
        report += res.changed ? '发现差异。\n' : '两份附件清单一致。\n';
        if (res.added.length) report += '\n【B 中新增】\n' + res.added.map((x) => '  + ' + x).join('\n') + '\n';
        if (res.removed.length) report += '\n【B 中移除】\n' + res.removed.map((x) => '  - ' + x).join('\n') + '\n';
        if (res.changedNames.length) report += '\n【大小变更】\n' + res.changedNames.map((x) => '  ~ ' + x).join('\n') + '\n';
        return { message: res.changed ? '发现差异' : '无差异', results: [{ name: 'attachment-diff.txt', text: report, kind: 'text' }] };
      },
    },
    diagnose: {
      title: 'PDF 损坏诊断', desc: '只读分析 PDF 文件头/尾结构：是否缺失 %PDF- 文件头、版本号异常、头部前垃圾字节、尾部 %%EOF 是否存在、%%EOF 后残留数据、是否疑似加密。与「损坏 PDF 修复」配套——先看清坏在哪，再决定是否修复。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
      ],
      run: async (v) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const bytes = new Uint8Array(await v.file.arrayBuffer());
        const d = E.diagnoseCorruption(bytes);
        const lines = [
          `文件大小： ${d.size} 字节`,
          `文件头 %PDF-： ${d.hasHeader ? '有（版本 ' + d.headerVersion + '）' : '缺失'}`,
          `文件头小写异常： ${d.headerLower ? '是（%pdf 应改为 %PDF-）' : '否'}`,
          `文件头前有垃圾字节： ${d.leadingJunk ? '是' : '否'}`,
          `文件尾 %%EOF： ${d.hasEOF ? '有' : '缺失'}`,
          `%%EOF 后有残留数据： ${d.trailedJunk ? '是' : '否'}`,
          `疑似加密： ${d.encrypted ? '是（含 /Encrypt 标记）' : '否'}`,
        ];
        const bad = !d.hasHeader || !d.hasEOF || d.leadingJunk || d.headerLower || d.trailedJunk;
        const verdict = bad
          ? '诊断结论：存在可修复的轻度字节损坏特征，建议用「损坏 PDF 修复」处理。'
          : '诊断结论：文件头/尾结构正常，无明显字节级损坏。';
        return { message: 'PDF 损坏诊断完成', results: [{ name: 'diagnose.txt', text: lines.join('\n') + '\n\n' + verdict, kind: 'text' }] };
      },
    },
    flattenol: {
      title: '大纲扁平化', desc: '读取 PDF 书签（大纲）并展开为带层级缩进与页码前缀的纯文本列表，便于查看/复制全文目录结构。与「书签 / 大纲」编辑配套。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '打开密码（若已加密）', type: 'password' },
      ],
      run: async (v) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const bytes = new Uint8Array(await v.file.arrayBuffer());
        const tree = await E.getOutline({ bytes });
        const flat = E.flattenOutline(tree || []);
        const text = flat.length ? flat.join('\n') : '（该 PDF 无书签 / 大纲）';
        return { message: `共 ${flat.length} 个大纲条目`, results: [{ name: 'outline-flat.txt', text, kind: 'text' }] };
      },
    },
    annotate: {
      title: '批注汇总报告', desc: '读取 PDF 中的标准批注对象（Link 链接 / Text 批注泡泡 / FreeText / Highlight 高亮 / Underline / StrikeOut / Circle / Square / Ink 手绘等），按类型与页码分页呈现中文汇总，便于审阅后盘点。纯本地、文件不上传。注：矢量绘制型标注（矩形/箭头等）是 page 直接绘图，不是 Annot 对象，不在本报告覆盖范围内。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '打开密码（若已加密）', type: 'password' },
      ],
      run: async (v) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const r = await E.getAnnotations({ file: v.file }, { password: v.password });
        if (r.count === 0) return { message: '该 PDF 无标准批注（/Annots）', results: [] };
        const subtypeCN = {
          Link: '链接', Text: '批注泡泡', FreeText: '自由文字', Highlight: '高亮',
          Underline: '下划线', StrikeOut: '删除线', Squiggly: '波浪线',
          Circle: '圆形', Square: '矩形', Line: '直线', PolyLine: '折线',
          PolyGon: '多边形', Ink: '手绘', PopUp: '弹出框', Sound: '声音',
        };
        const byPage = new Map();
        const byType = new Map();
        for (const a of r.annotations) {
          const typeCN = subtypeCN[a.subtype] || a.subtype;
          const pgKey = '页 ' + a.page;
          if (!byPage.has(pgKey)) byPage.set(pgKey, []);
          byPage.get(pgKey).push(a);
          if (!byType.has(typeCN)) byType.set(typeCN, []);
          byType.get(typeCN).push(a);
        }
        const lines = [];
        lines.push(`PDF 批注汇总 · 共 ${r.count} 条 / ${r.totalPages} 页`);
        lines.push('');
        lines.push('— 按类型 —');
        for (const [type, arr] of byType) {
          lines.push(`${type} (${arr.length} 条)`);
          for (const a of arr) {
            const loc = `页${a.page} [${a.rect.map((x) => x.toFixed(1)).join(',')}]`;
            const action = a.subtype === 'Link' && a.action
              ? (a.action.type === 'URI' ? `→ ${a.action.url}` : a.action.type === 'GoTo' ? `→ 页${a.action.targetPage || '?'}` : '')
              : '';
            const txt = a.contents ? a.contents : (a.subtype === 'Link' ? action : '');
            if (txt) lines.push(`  · ${loc} ${txt}`);
            else lines.push(`  · ${loc}${action ? ' ' + action : ''}`);
          }
        }
        lines.push('');
        lines.push('— 按页码 —');
        for (const [pg, arr] of byPage) {
          lines.push(`${pg} (${arr.length} 条)`);
          for (const a of arr) {
            const typeCN = subtypeCN[a.subtype] || a.subtype;
            const action = a.subtype === 'Link' && a.action
              ? (a.action.type === 'URI' ? a.action.url : a.action.type === 'GoTo' ? `内部跳转→页${a.action.targetPage || '?'}` : '')
              : '';
            const txt = a.contents || action || '(无内容)';
            lines.push(`  [${typeCN}] ${txt}`);
          }
        }
        return { message: `共 ${r.count} 条批注，详见下方报告`, results: [{ name: 'annotations.txt', text: lines.join('\n'), kind: 'text' }] };
      },
    },
    antexport: {
      title: '批注导出 JSON', desc: '把 PDF 中的标准批注对象（Link / Text / FreeText / Highlight / Underline / StrikeOut / Ink 等）导出为 JSON 文件，包含页码、Subtype、Rect(pt)、Contents、Author、Flags、Action 等完整字段，便于后续审计 / 二次处理。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '打开密码（若已加密）', type: 'password' },
      ],
      run: async (v) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const r = await E.getAnnotations({ file: v.file }, { password: v.password });
        const summary = { source: v.file.name || 'unknown.pdf', totalPages: r.totalPages, count: r.count, exportedAt: new Date().toISOString() };
        const payload = summary.count ? { ...summary, annotations: r.annotations } : { ...summary, annotations: [] };
        const json = JSON.stringify(payload, null, 2);
        return { message: `已导出 ${r.count} 条批注为 JSON`, results: [{ name: 'annotations.json', text: json, kind: 'text' }] };
      },
    },
    encrypt: {
      title: '加密并设置权限', desc: '为 PDF 设置打开密码与操作权限。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'userPassword', label: '打开密码', type: 'password' },
        { key: 'ownerPassword', label: '权限密码(可选)', type: 'password', hint: '留空则等同打开密码' },
        { key: 'cur', label: '当前密码(若已加密)', type: 'password' },
        { key: 'perm', label: '允许的操作', type: 'checks', options: [ {key:'printing',label:'打印'},{key:'modifying',label:'修改'},{key:'copying',label:'复制内容'},{key:'annotating',label:'批注'} ], checked: ['printing','modifying','copying','annotating'] },
      ],
      run: async (v, onProgress) => {
        if (!v.userPassword && !v.ownerPassword) throw new Error('请至少设置打开密码或权限密码，否则不会真正加密');
        return single('encrypted.pdf', await E.encryptPDF({ file: v.file }, {
          userPassword: v.userPassword, ownerPassword: v.ownerPassword, currentPassword: v.cur,
          permissions: v.perm,
        }, onProgress));
      },
    },
    decrypt: {
      title: '移除密码', desc: '用密码打开后另存为无密码文件。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '打开密码', type: 'password' },
      ],
      run: async (v, onProgress) => single('decrypted.pdf', await E.decryptPDF({ file: v.file }, v.password, onProgress)),
    },
    textwm: {
      title: '文字水印', desc: '在每页平铺文字水印（支持中文）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'text', label: '水印文字', type: 'text', placeholder: '机密 CONFIDENTIAL' },
        { key: 'fontSize', label: '字号', type: 'number', value: 42 },
        { key: 'color', label: '颜色', type: 'color', value: '#9aa0aa' },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.22 },
        { key: 'angle', label: '倾斜角度', type: 'number', value: -30 },
        { key: 'scale', label: '大小比例', type: 'range', min: 0.1, max: 0.6, step: 0.05, value: 0.28 },
        { key: 'cur', label: '当前密码(若已加密)', type: 'password' },
      ],
      run: async (v, onProgress) => single('watermarked.pdf', await E.addTextWatermark({ file: v.file }, {
        text: v.text, fontSize: Number(v.fontSize), color: v.color, opacity: Number(v.opacity),
        angleDeg: Number(v.angle), scale: Number(v.scale), password: v.cur,
      }, onProgress)),
    },
    font: {
      title: '嵌入字体文字', desc: '上传字体文件（TTF/OTF/TTC），在 PDF 中写入可选中的真实文字（解决中文水印不可选的问题）。支持单页文字、平铺水印、自动页码三种模式，文字以嵌入字体渲染，复制/搜索可见。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'font', label: '字体文件 (TTF/OTF/TTC)', type: 'file', accept: '.ttf,.otf,.ttc,font/ttf,font/otf' },
        { key: 'mode', label: '模式', type: 'select', options: [ {value:'single',label:'单页文字'},{value:'tile',label:'平铺水印'},{value:'pagenum',label:'自动页码'} ] },
        { key: 'text', label: '文字内容', type: 'text', placeholder: '机密 绿角犀 / 第 {n} 页', hint: '单页/平铺模式必填；自动页码模式忽略此处，改用下方页码格式' },
        { key: 'pages', label: '页码(单页模式,逗号分隔,留空=第1页)', type: 'text', placeholder: '1,3,5' },
        { key: 'fontSize', label: '字号(pt)', type: 'number', value: 24 },
        { key: 'color', label: '颜色', type: 'color', value: '#222222' },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.05, max: 1, step: 0.05, value: 1 },
        { key: 'x', label: '水平位置(mm,左上原点)', type: 'number', value: 10 },
        { key: 'y', label: '垂直位置(mm,左上原点)', type: 'number', value: 10 },
        { key: 'rotation', label: '倾斜角度(平铺水印)', type: 'number', value: 30 },
        { key: 'format', label: '页码格式(自动页码模式)', type: 'text', value: '第 {n} / {count} 页', hint: '{n}=当前页 {count}=总页数' },
        { key: 'cur', label: '当前密码(若已加密)', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        if (!v.font) throw new Error('请上传字体文件（TTF/OTF/TTC）');
        const fontBytes = new Uint8Array(await v.font.arrayBuffer());
        const mode = v.mode || 'single';
        if (mode !== 'pagenum' && !(v.text && v.text.trim())) throw new Error('单页/平铺模式请填写文字内容');
        const pages = (mode === 'single' && v.pages && v.pages.trim())
          ? v.pages.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
          : undefined;
        const opts = {
          fontBytes,
          mode,
          text: v.text || '',
          size: Number(v.fontSize) || 24,
          color: v.color || '#222222',
          opacity: v.opacity == null ? 1 : Number(v.opacity),
          x: (v.x === '' || v.x == null) ? undefined : Number(v.x),
          y: (v.y === '' || v.y == null) ? undefined : Number(v.y),
          rotation: (v.rotation === '' || v.rotation == null) ? undefined : Number(v.rotation),
          format: (mode === 'pagenum') ? (v.format || '第 {n} / {count} 页') : undefined,
          pages,
          password: v.cur,
        };
        const bytes = await E.addTextWithFont({ file: v.file }, opts, onProgress);
        return single('embedded-font.pdf', bytes);
      },
    },
    imgwm: {
      title: '图片水印', desc: '上传 PNG/JPG 作为平铺水印。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'image', label: '水印图片', type: 'file', accept: 'image/*' },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.1, max: 1, step: 0.05, value: 0.5 },
        { key: 'angle', label: '倾斜角度', type: 'number', value: 0 },
        { key: 'scale', label: '大小比例', type: 'range', min: 0.1, max: 0.6, step: 0.05, value: 0.25 },
        { key: 'cur', label: '当前密码(若已加密)', type: 'password' },
      ],
      run: async (v, onProgress) => single('img-watermarked.pdf', await E.addImageWatermark({ file: v.file }, v.image, {
        opacity: Number(v.opacity), angleDeg: Number(v.angle), scale: Number(v.scale), password: v.cur,
      }, onProgress)),
    },
    pagenum: {
      title: '添加页码', desc: '在每页指定位置添加页码。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'format', label: '格式', type: 'text', value: '第 {n} 页', hint: '{n}=当前页 {total}=总页数' },
        { key: 'position', label: '位置', type: 'select', options: [ {value:'bottom-center',label:'底部居中'},{value:'bottom-right',label:'右下'},{value:'bottom-left',label:'左下'},{value:'top-center',label:'顶部居中'},{value:'top-right',label:'右上'},{value:'top-left',label:'左上'} ] },
        { key: 'color', label: '颜色', type: 'color', value: '#555555' },
        { key: 'cur', label: '当前密码(若已加密)', type: 'password' },
      ],
      run: async (v, onProgress) => single('paged.pdf', await E.addPageNumbers({ file: v.file }, {
        format: v.format, position: v.position, color: v.color, password: v.cur,
      }, onProgress)),
    },
    hf: {
      title: '页眉 / 页脚', desc: '为页面添加统一页眉与页脚文字。页眉/页脚文字支持占位符：{n}=当前页码，{N}=总页数（例如页脚填「第 {n} / {N} 页」）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'header', label: '页眉文字', type: 'text', placeholder: '公司名称 / 文档标题' },
        { key: 'footer', label: '页脚文字（支持 {n}/{N}）', type: 'text', placeholder: '第 {n} / {N} 页' },
        { key: 'align', label: '对齐', type: 'select', value: 'center', options: [ {value:'left',label:'左对齐'}, {value:'center',label:'居中'}, {value:'right',label:'右对齐'} ] },
        { key: 'line', label: '显示分隔线', type: 'checkbox', value: false },
        { key: 'fontSize', label: '字号', type: 'number', value: 11 },
        { key: 'pageRanges', label: '页码范围（留空=全部，如 1-3,5）', type: 'text', placeholder: '1-3,5' },
        { key: 'color', label: '颜色', type: 'color', value: '#333333' },
        { key: 'cur', label: '当前密码(若已加密)', type: 'password' },
      ],
      run: async (v, onProgress) => single('header-footer.pdf', await E.addHeaderFooter({ file: v.file }, {
        header: v.header, footer: v.footer, align: v.align, line: v.line,
        fontSize: Number(v.fontSize) || 11, pageRanges: v.pageRanges || '', color: v.color, password: v.cur,
      }, onProgress)),
    },
    compress: {
      title: '无损压缩', desc: '重新序列化并清理元数据，体积通常略有下降（不损失清晰度）。',
      fields: [ { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' } ],
      run: async (v, onProgress) => single('compressed.pdf', await E.compressPDF({ file: v.file }, onProgress)),
    },
    raster: {
      title: '有损压缩（转图）', desc: '把每页转为图片后重排，体积显著变小，但文字不再可选中。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'scale', label: '清晰度(越大越清晰体积越大)', type: 'number', value: 1.4 },
      ],
      run: async (v, onProgress) => single('raster-compressed.pdf', await E.rasterizeCompress({ file: v.file }, Number(v.scale), onProgress)),
    },
    img2pdf: {
      title: '图片转 PDF', desc: '把多张图片合成为一个 PDF 文件。',
      fields: [ { key: 'images', label: '选择图片', type: 'file', accept: 'image/*', multiple: true } ],
      run: async (v, onProgress) => {
        if (!v.images || !v.images.length) throw new Error('请选择至少一张图片');
        return single('images.pdf', await E.imagesToPDF(v.images, {}, onProgress));
      },
    },
    pdf2img: {
      title: 'PDF 转图片', desc: '把每一页渲染为 PNG/JPG（打包下载）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'format', label: '格式', type: 'select', options: [ {value:'image/png',label:'PNG(无损)'}, {value:'image/jpeg',label:'JPG(更小)'} ] },
        { key: 'scale', label: '清晰度', type: 'number', value: 2 },
        { key: 'quality', label: 'JPG 质量', type: 'range', min: 0.3, max: 1, step: 0.05, value: 0.92 },
      ],
      run: async (v, onProgress) => {
        const imgs = await E.pdfToImages({ file: v.file }, { format: v.format, scale: Number(v.scale), quality: Number(v.quality) }, onProgress);
        const zip = new JSZip(); const ext = v.format === 'image/jpeg' ? 'jpg' : 'png';
        imgs.forEach((it) => zip.file(`page-${String(it.page).padStart(3, '0')}.${ext}`, it.blob));
        const blob = await zip.generateAsync({ type: 'blob' });
        return { message: `已导出 ${imgs.length} 张图片`, results: [{ name: 'pdf-images.zip', blob, kind: 'zip' }] };
      },
    },
    text: {
      title: '提取文本', desc: '从 PDF 中提取全部文字内容。',
      fields: [ { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' } ],
      run: async (v, onProgress) => {
        const t = await E.extractText({ file: v.file }, onProgress);
        const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
        return { message: `已提取 ${t.length} 个字符`, results: [{ name: 'extracted.txt', blob, kind: 'text' }] };
      },
    },
    'extracttext': {
      title: '健壮文本提取', desc: '用 pdf.js 容错提取全文（支持带密码的 PDF、逐页结构化；提取失败返回空而非中断），比普通「提取文本」更抗破损/加密文件。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const bytes = new Uint8Array(await v.file.arrayBuffer());
        const r = await E.safeExtractText(bytes, v.password || '');
        if (!r) throw new Error('提取失败：文档可能已损坏或密码错误。');
        const all = (r.allLines || []).join('\n');
        const blob = new Blob([all], { type: 'text/plain;charset=utf-8' });
        return { message: `已提取 ${r.pages.length} 页`, results: [{ name: 'robust-text.txt', blob, kind: 'text' }] };
      },
    },
    table: {
      title: '表格识别', desc: '把 PDF 页内文字按坐标聚成表格网格（每页一个表），纯本地输出结构；与「导出 Excel」互补——本工具用于预览/核对表格结构而不生成文件。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'rowTol', label: '行间距容差(pt，默认 6)', type: 'number', value: 6 },
        { key: 'colTol', label: '列间距容差(pt，默认 12)', type: 'number', value: 12 },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const r = await E.detectTableStructure({ file: v.file }, {
          password: v.password,
          rowTol: v.rowTol ? Number(v.rowTol) : 6,
          colTol: v.colTol ? Number(v.colTol) : 12,
        }, onProgress);
        const blocks = [];
        (r.sheets || []).forEach((sh) => {
          const rows = (sh.rows || []).map((row) => {
            let end = row.length; while (end > 0 && row[end - 1] === '') end--;
            return row.slice(0, end).join(' | ');
          }).filter((s) => s !== '');
          if (!rows.length) return;
          const pageNo = String(sh.name || '').replace(/^Page/, '');
          blocks.push(`【第 ${pageNo} 页 · ${rows.length} 行】\n` + rows.join('\n'));
        });
        if (!blocks.length) return { message: '未识别到表格/对齐文本', results: [{ name: '表格识别', kind: 'text', text: '该 PDF 未提取到可识别的对齐文本，可尝试调大列/行容差。' }] };
        const text = blocks.join('\n\n');
        return { message: `共识别 ${r.sheets.length} 页表格`, results: [{ name: 'table-structure.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), kind: 'text' }] };
      },
    },

    /* ---------------- 编辑 ---------------- */
    insert: {
      title: '插入页面', desc: '从另一份 PDF 在指定位置插入整份页面的内容。',
      fields: [
        { key: 'file', label: '主 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'ins', label: '要插入的 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'atPage', label: '插入到第几页之后（0=最前，留空=最后）', type: 'number', value: 0, placeholder: '如 2' },
      ],
      run: async (v, onProgress) => {
        if (!v.file || !v.ins) throw new Error('请选择主 PDF 与要插入的 PDF');
        const bytes = await E.insertPages({ file: v.file }, { file: v.ins }, { atPage: v.atPage ? Number(v.atPage) : 0 }, onProgress);
        return single('inserted.pdf', bytes);
      },
    },
    replace: {
      title: '替换页面', desc: '用另一份 PDF 的某一页，替换主 PDF 的指定页。',
      fields: [
        { key: 'file', label: '主 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'src', label: '来源 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pageIndex', label: '主 PDF 中要替换的页码', type: 'number', value: 1 },
        { key: 'srcPageIndex', label: '来源 PDF 使用的页码', type: 'number', value: 1 },
      ],
      run: async (v, onProgress) => {
        if (!v.file || !v.src) throw new Error('请选择主 PDF 与来源 PDF');
        const bytes = await E.replacePage({ file: v.file }, { file: v.src },
          { pageIndex: Number(v.pageIndex), srcPageIndex: Number(v.srcPageIndex) }, onProgress);
        return single('replaced.pdf', bytes);
      },
    },
    crop: {
      title: '裁剪页面', desc: '在预览上拖拽选择保留区域，或手动输入四边边距（毫米）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pick', label: '', type: 'pickcanvas', mode: 'crop' },
        { key: 'pages', label: '勾选要裁剪的页面（默认全选）', type: 'pagepicker', purpose: 'keep' },
        { key: 'top', label: '上边距 (mm)', type: 'number', value: 10 },
        { key: 'right', label: '右边距 (mm)', type: 'number', value: 10 },
        { key: 'bottom', label: '下边距 (mm)', type: 'number', value: 10 },
        { key: 'left', label: '左边距 (mm)', type: 'number', value: 10 },
      ],
      run: async (v, onProgress) => single('cropped.pdf', await E.cropPages({ file: v.file },
        { top: Number(v.top), right: Number(v.right), bottom: Number(v.bottom), left: Number(v.left), pages: v.pages }, onProgress)),
    },
    resize: {
      title: '调整页面尺寸', desc: '将选中页面缩放/适配到目标纸张尺寸（如 A4），其余页保持原样。预览红框即目标尺寸。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pick', label: '', type: 'pickcanvas', mode: 'resize' },
        { key: 'pages', label: '勾选要调整尺寸的页面（默认全选）', type: 'pagepicker', purpose: 'keep' },
        { key: 'size', label: '目标尺寸', type: 'select', options: [
          { value: 'A4', label: 'A4 (210×297mm)' }, { value: 'A3', label: 'A3 (297×420mm)' },
          { value: 'A5', label: 'A5 (148×210mm)' }, { value: 'LETTER', label: 'Letter (8.5×11in)' },
          { value: 'CUSTOM', label: '自定义' } ] },
        { key: 'fit', label: '适配方式', type: 'select', options: [
          { value: 'contain', label: '完整保留(Contain)' }, { value: 'cover', label: '铺满(Cover)' }, { value: 'stretch', label: '拉伸填满(Stretch)' } ] },
        { key: 'width', label: '自定义宽 (mm，仅自定义尺寸)', type: 'number', value: 210 },
        { key: 'height', label: '自定义高 (mm，仅自定义尺寸)', type: 'number', value: 297 },
      ],
      run: async (v, onProgress) => single('resized.pdf', await E.resizePages({ file: v.file },
        { size: v.size, fit: v.fit, width: Number(v.width), height: Number(v.height), pages: v.pages }, onProgress)),
      afterRender(form) {
        const sizeSel = form.querySelector('select[data-key="size"]');
        const wInp = form.querySelector('input[data-key="width"]');
        const hInp = form.querySelector('input[data-key="height"]');
        const toggle = () => {
          const custom = sizeSel.value === 'CUSTOM';
          [wInp, hInp].forEach((el) => { if (el) { el.disabled = !custom; el.style.opacity = custom ? '1' : '0.5'; } });
        };
        if (sizeSel) sizeSel.addEventListener('change', toggle);
        toggle();
      },
    },
    placetext: {
      title: '定点添加文字', desc: '在预览上点击/拖拽设置位置，或手动输入坐标（左上原点，mm）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pick', label: '', type: 'pickcanvas', mode: 'point' },
        { key: 'text', label: '文字内容', type: 'text', placeholder: '在此输入文字' },
        { key: 'pages', label: '勾选要添加文字的页面（默认全选）', type: 'pagepicker', purpose: 'keep' },
        { key: 'x', label: 'X (mm，距左)', type: 'number', value: 20 },
        { key: 'y', label: 'Y (mm，距上)', type: 'number', value: 20 },
        { key: 'fontSize', label: '字号', type: 'number', value: 14 },
        { key: 'color', label: '颜色', type: 'color', value: '#222222' },
      ],
      run: async (v, onProgress) => {
        if (!v.text) throw new Error('请输入文字内容');
        return single('placed-text.pdf', await E.placeText({ file: v.file },
          { text: v.text, pages: v.pages, x: Number(v.x), y: Number(v.y), fontSize: Number(v.fontSize), color: v.color }, onProgress));
      },
    },
    placeimg: {
      title: '定点添加图片', desc: '在预览上点击/拖拽设置位置，或手动输入坐标（左上原点，mm）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pick', label: '', type: 'pickcanvas', mode: 'point' },
        { key: 'image', label: '图片', type: 'file', accept: 'image/*' },
        { key: 'pages', label: '勾选要添加图片的页面（默认全选）', type: 'pagepicker', purpose: 'keep' },
        { key: 'x', label: 'X (mm，距左)', type: 'number', value: 20 },
        { key: 'y', label: 'Y (mm，距上)', type: 'number', value: 20 },
        { key: 'width', label: '宽度 (mm)', type: 'number', value: 50 },
        { key: 'angle', label: '旋转角度', type: 'number', value: 0 },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.1, max: 1, step: 0.05, value: 1 },
      ],
      run: async (v, onProgress) => {
        if (!v.image) throw new Error('请选择图片');
        return single('placed-image.pdf', await E.placeImage({ file: v.file }, v.image,
          { pages: v.pages, x: Number(v.x), y: Number(v.y), width: Number(v.width), angle: Number(v.angle), opacity: Number(v.opacity) }, onProgress));
      },
    },
    highlight: {
      title: '高亮标注', desc: '在指定区域添加半透明高亮（以左上角为原点，单位 mm）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'pages', label: '勾选要高亮的页面（默认全选）', type: 'pagepicker', purpose: 'keep' },
        { key: 'x', label: 'X (mm，距左)', type: 'number', value: 20 },
        { key: 'y', label: 'Y (mm，距上)', type: 'number', value: 20 },
        { key: 'w', label: '宽 (mm)', type: 'number', value: 100 },
        { key: 'h', label: '高 (mm)', type: 'number', value: 12 },
        { key: 'color', label: '颜色', type: 'color', value: '#ffeb3b' },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.1, max: 0.8, step: 0.05, value: 0.35 },
      ],
      run: async (v, onProgress) => single('highlighted.pdf', await E.addHighlight({ file: v.file },
        { pages: v.pages, x: Number(v.x), y: Number(v.y), w: Number(v.w), h: Number(v.h), color: v.color, opacity: Number(v.opacity) }, onProgress)),
    },
    rect: {
      title: '矩形标注', desc: '在指定页面拖拽绘制矩形框（支持填充与描边）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'page', label: '目标页码（在哪一页绘制）', type: 'number', value: 1 },
        { key: 'x0', type: 'hidden' }, { key: 'y0', type: 'hidden' }, { key: 'x1', type: 'hidden' }, { key: 'y1', type: 'hidden' },
        { key: 'draw', label: '在预览上拖拽绘制矩形（左上原点，单位 mm）', type: 'drawcanvas', mode: 'rect' },
        { key: 'color', label: '边框颜色', type: 'color', value: '#e53935' },
        { key: 'fillOn', label: '填充', type: 'checks', options: [{ key: 'on', label: '启用填充' }] },
        { key: 'fill', label: '填充颜色', type: 'color', value: '#fff3e0' },
        { key: 'borderWidth', label: '线宽 (mm)', type: 'number', value: 1.2 },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.1, max: 1, step: 0.05, value: 1 },
      ],
      run: async (v, onProgress) => {
        const b = await E.addVectorAnnotation({ file: v.file }, {
          type: 'rect', page: Number(v.page) || 1,
          x0: Number(v.x0), y0: Number(v.y0), x1: Number(v.x1), y1: Number(v.y1),
          color: v.color, fill: (v.fillOn && v.fillOn.on) ? v.fill : null,
          borderWidth: Number(v.borderWidth), opacity: Number(v.opacity),
        }, onProgress);
        return single('rect-annotated.pdf', b);
      },
    },
    arrow: {
      title: '箭头标注', desc: '拖拽绘制带箭头的指示线，常用于指向重点。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'page', label: '目标页码（在哪一页绘制）', type: 'number', value: 1 },
        { key: 'x0', type: 'hidden' }, { key: 'y0', type: 'hidden' }, { key: 'x1', type: 'hidden' }, { key: 'y1', type: 'hidden' },
        { key: 'draw', label: '在预览上拖拽绘制箭头（起点→终点）', type: 'drawcanvas', mode: 'arrow' },
        { key: 'color', label: '颜色', type: 'color', value: '#1e88e5' },
        { key: 'borderWidth', label: '线宽 (mm)', type: 'number', value: 2 },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.1, max: 1, step: 0.05, value: 1 },
      ],
      run: async (v, onProgress) => {
        const b = await E.addVectorAnnotation({ file: v.file }, {
          type: 'arrow', page: Number(v.page) || 1,
          x0: Number(v.x0), y0: Number(v.y0), x1: Number(v.x1), y1: Number(v.y1),
          color: v.color, borderWidth: Number(v.borderWidth), opacity: Number(v.opacity),
        }, onProgress);
        return single('arrow-annotated.pdf', b);
      },
    },
    ink: {
      title: '手绘标注', desc: '自由绘制任意形状/笔迹（手绘线）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'page', label: '目标页码（在哪一页绘制）', type: 'number', value: 1 },
        { key: 'points', type: 'hidden' },
        { key: 'draw', label: '在预览上按住拖拽自由绘制', type: 'drawcanvas', mode: 'ink' },
        { key: 'color', label: '颜色', type: 'color', value: '#43a047' },
        { key: 'borderWidth', label: '笔宽 (mm)', type: 'number', value: 1.5 },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.1, max: 1, step: 0.05, value: 0.95 },
      ],
      run: async (v, onProgress) => {
        let pts = []; try { pts = JSON.parse(v.points || '[]'); } catch (e) { console.error("[pdf-app] 操作失败:", e); }
        if (!pts.length) throw new Error('请先在预览上拖拽绘制手绘线');
        const b = await E.addVectorAnnotation({ file: v.file }, {
          type: 'ink', page: Number(v.page) || 1, points: pts,
          color: v.color, borderWidth: Number(v.borderWidth), opacity: Number(v.opacity),
        }, onProgress);
        return single('ink-annotated.pdf', b);
      },
    },
    comment: {
      title: '批注（便签）', desc: '在指定位置放置便签图标与文字说明，适合审阅批注。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'page', label: '目标页码', type: 'number', value: 1 },
        { key: 'pick', label: '在预览上点击设置便签位置（或手动输入 X/Y）', type: 'pickcanvas', mode: 'point' },
        { key: 'x', label: 'X (mm，距左)', type: 'number', value: 20 },
        { key: 'y', label: 'Y (mm，距上)', type: 'number', value: 20 },
        { key: 'note', label: '批注内容', type: 'text', placeholder: '例如：此处数据需复核' },
        { key: 'color', label: '便签颜色', type: 'color', value: '#fb8c00' },
        { key: 'opacity', label: '不透明度', type: 'range', min: 0.3, max: 1, step: 0.05, value: 1 },
      ],
      run: async (v, onProgress) => {
        if (!v.note) throw new Error('请输入批注内容');
        const b = await E.addVectorAnnotation({ file: v.file }, {
          type: 'comment', page: Number(v.page) || 1,
          x: Number(v.x), y: Number(v.y), color: v.color, note: v.note, opacity: Number(v.opacity),
        }, onProgress);
        return single('comment-annotated.pdf', b);
      },
    },
    bookmarks: {
      title: '书签 / 大纲', desc: '添加或编辑 PDF 书签（大纲）。每行一个：页号 | 标题（可选追加 | 顶部mm | 左侧mm | 缩放）；行首每 2 空格为下一级。点「读取现有书签」可载入当前文件已有大纲。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'items', label: '书签列表', type: 'textarea', placeholder: '1 | 封面\n2 | 第一章\n  2 | 第一节\n  2 | 第二节\n5 | 第二章 | 50' },
        { key: 'read', label: '读取现有书签', type: 'button', action: 'readOutline' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const tree = parseOutline(v.items);
        if (!tree.length) throw new Error('请至少填写一个书签（格式：页号 | 标题）');
        const out = await E.setOutline({ file: v.file }, { tree, password: v.password }, onProgress);
        const res = single('bookmarked.pdf', out.bytes);
        res.message = `已写入 ${out.count} 个书签`;
        return res;
      },
    },
    pagelabels: {
      title: '页面标签（逻辑页码）', desc: '设置 PDF 原生页面标签（阅读器导航栏显示的逻辑页码），如 封面(i)/前言(ii)/第1章(1)/附录A(A-1)。与「绘制页码水印」是两套东西：这里是 PDF 原生编号，不改页面内容。每行一个区间：起始页码 | 样式 | 前缀 | 起始编号。样式填 D(十进制)/r(小写罗马)/R(大写罗马)/a(小写字母)/A(大写字母)，留空则仅前缀。点「读取现有标签」可载入。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'items', label: '标签区间（每行：起始页码 | 样式 | 前缀 | 起始编号）', type: 'textarea', placeholder: '1 | D | 第 | 1（每行一个区间；样式 D/r/R/a/A，留空仅前缀）' },
        { key: 'read', label: '读取现有标签', type: 'button', action: 'readLabels' },
        { key: 'clearAll', label: '清空全部标签', type: 'checkbox', value: false },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (v.clearAll) {
          const out = await E.setPageLabels({ file: v.file }, { clearAll: true, password: v.password }, onProgress);
          return { message: '已清除全部页面标签', results: [{ name: 'page-labels.pdf', blob: new Blob([out.bytes], { type: 'application/pdf' }), kind: 'pdf' }] };
        }
        const ranges = parseLabels(v.items);
        if (!ranges.length) throw new Error('请至少填写一个标签区间（格式：起始页码 | 样式 | 前缀 | 起始编号）');
        const out = await E.setPageLabels({ file: v.file }, { ranges, password: v.password }, onProgress);
        const report = formatLabelsReport(out.labels);
        return {
          message: '已写入 ' + out.labels.length + ' 组页面标签',
          results: [
            { name: 'page-labels.pdf', blob: new Blob([out.bytes], { type: 'application/pdf' }), kind: 'pdf' },
            { name: 'page-labels-report.txt', text: report, kind: 'text' },
          ],
        };
      },
    },
    formfields: {
      title: '导出表单域结构', desc: '提取 PDF 中所有可填表单字段的结构：字段名、类型（文本/勾选框/单选/下拉）、当前值、可选项、所在页码。导出为 JSON（供程序消费）与中文报告（供人工查看）两个文件，便于核对字段或对接自动填表。',
      fields: [
        { key: 'file', label: '选择带表单的 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const out = await E.exportFormFields({ file: v.file }, { password: v.password }, onProgress);
        if (!out.count) return { message: '该 PDF 没有可识别的表单字段（可能不含交互式表单）', results: [] };
        const json = JSON.stringify(out.fields, null, 2);
        const report = formatFormFieldsReport(out.fields);
        return {
          message: '已提取 ' + out.count + ' 个表单字段',
          results: [
            { name: 'form-fields.json', text: json, kind: 'text' },
            { name: 'form-fields-report.txt', text: report, kind: 'text' },
          ],
        };
      },
    },
    formimport: {
      title: '表单域反向导入填充', desc: '把一份「字段名→值」映射（JSON 或 CSV）回填进 PDF 表单：支持对象/数组/「导出表单域结构」的 form-fields.json 三种 JSON，以及 name,value 两列 CSV。与「导出表单域结构」形成闭环——改完 value 直接回灌。产出回填后的 PDF + 匹配/缺失/跳过报告。',
      fields: [
        { key: 'file', label: '选择带表单的 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'mapfile', label: '映射文件（JSON/CSV，可选；与下方文本框二选一）', type: 'file', accept: '.json,.csv,application/json,text/csv' },
        { key: 'read', label: '载入映射文件到文本框', type: 'button', action: 'readMapFile' },
        { key: 'mapping', label: '字段映射（JSON/CSV 文本；支持 form-fields.json 形态）', type: 'textarea', placeholder: '可粘贴：\n{\n  "FullName": "张三",\n  "City": "Shanghai",\n  "Agree": true\n}\n或 CSV：\nname,value\nFullName,张三\nCity,Shanghai', rows: 8 },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        let text = (v.mapping || '').trim();
        if (!text && v.mapfile) {
          const buf = new Uint8Array(await v.mapfile.arrayBuffer());
          text = new TextDecoder('utf-8').decode(buf);
        }
        if (!text) throw new Error('请粘贴映射文本，或上传一份 JSON/CSV 映射文件');
        const res = await E.importFormFields({ file: v.file }, text, { password: v.password }, onProgress);
        const report = formatImportReport(res.report, v.file && v.file.name);
        return {
          message: '已回填 ' + res.report.filled + ' 个字段' + (res.report.missing.length ? ('，' + res.report.missing.length + ' 个映射项在 PDF 中未找到') : ''),
          results: [
            { name: 'form-imported.pdf', bytes: res.bytes, kind: 'pdf' },
            { name: 'form-import-report.txt', text: report, kind: 'text' },
          ],
        };
      },
    },
    formfdf: {
      title: '导出表单为 FDF', desc: '把 PDF 表单字段名与当前值导出为 Acrobat FDF（Forms Data Format）文件。FDF 是标准表单数据交换格式，可被 Acrobat/Reader 导入回填，也兼容本工具的「表单域反向导入填充」直接回灌到同名表单。导出为 .fdf 文件 + 中文概要。',
      fields: [
        { key: 'file', label: '选择带表单的 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const res = await E.exportFormFDF({ file: v.file }, { password: v.password }, onProgress);
        if (!res.count) return { message: '该 PDF 没有可识别的表单字段（可能不含交互式表单）', results: [] };
        const lines = ['FDF 表单数据导出概要', '共 ' + res.count + ' 个字段：', ''];
        res.fields.forEach((f) => {
          let val = f.value;
          if (f.type === 'checkbox') val = f.value ? '☒ 已勾选' : '☐ 未勾选';
          lines.push('· [' + f.type + '] ' + f.name + ' = ' + (val === null || val === undefined ? '' : val));
        });
        const report = lines.join('\n');
        return {
          message: '已导出 ' + res.count + ' 个字段为 FDF（可用「表单域反向导入填充」回灌同名表单）',
          results: [
            { name: 'form-data.fdf', blob: new Blob([res.bytes], { type: 'application/vnd.fdf' }), kind: 'file' },
            { name: 'form-fdf-report.txt', text: report, kind: 'text' },
          ],
        };
      },
    },
    link: {
      title: '添加链接', desc: '在指定页矩形区域添加可点击链接：内部跳转（指向某页）或外部网址。可选下划线/边框以可见标记。坐标单位 mm，左上原点。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'kind', label: '链接类型', type: 'select', value: 'internal', options: [{ value: 'internal', label: '内部跳转（指向某页）' }, { value: 'external', label: '外部网址' }] },
        { key: 'page', label: '链接所在页码', type: 'number', value: 1 },
        { key: 'x0', label: '区域左上 X (mm，距左)', type: 'number', value: 20 },
        { key: 'y0', label: '区域左上 Y (mm，距上)', type: 'number', value: 20 },
        { key: 'x1', label: '区域右下 X (mm，距左)', type: 'number', value: 120 },
        { key: 'y1', label: '区域右下 Y (mm，距上)', type: 'number', value: 28 },
        { key: 'targetPage', label: '跳转目标页码（内部）', type: 'number', value: 2 },
        { key: 'top', label: '目标顶部偏移 mm（内部，可选）', type: 'number' },
        { key: 'left', label: '目标左侧偏移 mm（内部，可选）', type: 'number' },
        { key: 'zoom', label: '目标缩放（内部，可选）', type: 'number' },
        { key: 'url', label: '网址 URL（外部）', type: 'text', placeholder: 'https://example.com' },
        { key: 'style', label: '可见标记', type: 'select', value: 'underline', options: [{ value: 'underline', label: '下划线' }, { value: 'box', label: '矩形框' }, { value: 'none', label: '仅可点击（无标记）' }] },
        { key: 'color', label: '标记颜色', type: 'color', value: '#1565c0' },
        { key: 'borderWidth', label: '边框宽度 (mm，box 用)', type: 'number', value: 0.5 },
        { key: 'lineWidth', label: '线宽 (mm)', type: 'number', value: 1 },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const internal = v.kind !== 'external';
        const numOrUndef = (s) => (s === '' || s == null) ? undefined : Number(s);
        const b = await E.addLink({ file: v.file }, {
          page: Number(v.page) || 1,
          x0: Number(v.x0), y0: Number(v.y0), x1: Number(v.x1), y1: Number(v.y1),
          kind: internal ? 'internal' : 'external',
          targetPage: Number(v.targetPage) || 1,
          top: numOrUndef(v.top), left: numOrUndef(v.left), zoom: numOrUndef(v.zoom),
          url: v.url,
          style: v.style || 'underline',
          color: v.color || '#1565c0',
          borderWidth: Number(v.borderWidth) || 0,
          lineWidth: Number(v.lineWidth) || 1,
          password: v.password,
        }, onProgress);
        return single(internal ? 'internal-link.pdf' : 'external-link.pdf', b.bytes);
      },
    },
    toc: {
      title: '生成目录 (TOC)', desc: '在指定页生成可点击目录：每行「页码 | 标题」，空格缩进表示层级。点「读取现有书签」可基于已有大纲一键生成。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'targetPage', label: '目录放置页码（默认首页）', type: 'number', value: 1 },
        { key: 'items', label: '目录条目（每行：页码 | 标题）', type: 'textarea', placeholder: '1 | 封面\n2 | 第一章 简介\n  2 | 第一节\n3 | 第二章' },
        { key: 'read', label: '读取现有书签', type: 'button', action: 'readOutline' },
        { key: 'fontSizeMM', label: '字号 (mm)', type: 'number', value: 5 },
        { key: 'lineHeightMM', label: '行距 (mm)', type: 'number', value: 9 },
        { key: 'margin', label: '页边距 (mm)', type: 'number', value: 15 },
        { key: 'color', label: '文字颜色', type: 'color', value: 'OS.theme.getVar("--ink")' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const tree = parseOutline(v.items);
        const items = [];
        (function walk(ns, d) {
          for (const n of (ns || [])) {
            items.push({ title: (d ? '　'.repeat(d) : '') + (n.title || ('第 ' + n.page + ' 页')), page: n.page });
            if (n.children) walk(n.children, d + 1);
          }
        })(tree, 0);
        if (!items.length) throw new Error('请填写目录条目（每行：页码 | 标题）或先点「读取现有书签」');
        const out = await E.generateTOC({ file: v.file }, {
          targetPage: Number(v.targetPage) || 1,
          items,
          fontSizeMM: Number(v.fontSizeMM) || 5,
          lineHeightMM: Number(v.lineHeightMM) || 9,
          margin: Number(v.margin) || 15,
          color: v.color || 'OS.theme.getVar("--ink")',
          password: v.password,
        }, onProgress);
        const res = single('table-of-contents.pdf', out.bytes);
        res.message = `已在第 ${Number(v.targetPage) || 1} 页生成 ${out.count} 条目录`;
        return res;
      },
    },
    metadata: {
      title: '元数据编辑', desc: '读取或修改 PDF 文档信息（标题/作者/主题/关键词/创建者）。点「读取现有元数据」可载入当前文件信息再编辑。坐标仅编辑文本属性，不改页面内容。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'title', label: '标题 (Title)', type: 'text', placeholder: '文档标题' },
        { key: 'author', label: '作者 (Author)', type: 'text', placeholder: '作者姓名' },
        { key: 'subject', label: '主题 (Subject)', type: 'text', placeholder: '文档主题' },
        { key: 'keywords', label: '关键词 (Keywords)', type: 'text', placeholder: '关键词1, 关键词2', hint: '多个用逗号或空格分隔' },
        { key: 'creator', label: '创建者 (Creator)', type: 'text', placeholder: '创建程序 / 人员' },
        { key: 'producer', label: '生成器 (Producer · 只读)', type: 'text', readonly: true, hint: '由 PDF 生成库在保存时强制写入，不可自定义' },
        { key: 'mode', label: '应用方式', type: 'select', value: 'update', options: [ { value: 'update', label: '仅更新已填写的字段（未填写保持不变）' }, { value: 'replace', label: '整体替换（未填写字段清空）' } ] },
        { key: 'clearAll', label: '', type: 'checks', options: [ { key: 'clearAll', label: '清空全部可编辑元数据（标题/作者/主题/关键词/创建者，Producer 除外）' } ], checked: [] },
        { key: 'read', label: '读取现有元数据', type: 'button', action: 'readMetadata' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const opts = {};
        if (v.clearAll && v.clearAll.clearAll) {
          opts.clearAll = true;
        } else {
          const keys = ['title', 'author', 'subject', 'keywords', 'creator'];
          const replaceMode = v.mode === 'replace';
          for (const k of keys) {
            const val = (v[k] == null ? '' : String(v[k])).trim();
            if (val !== '') { opts[k] = val; }
            else if (replaceMode) { opts[k] = ''; } // 整体替换：未填写即清空
          }
          if (Object.keys(opts).length === 0) throw new Error('请至少填写一项要修改的元数据，或勾选「清空全部」');
        }
        const out = await E.setMetadata({ file: v.file }, opts, onProgress);
        const res = single('metadata.pdf', out);
        res.message = opts.clearAll
          ? '已清空全部可编辑元数据（Producer 由生成库强制写入）'
          : '已更新元数据：' + Object.keys(opts).map((k) => ({ title: '标题', author: '作者', subject: '主题', keywords: '关键词', creator: '创建者' }[k] || k)).join('、');
        return res;
      },
    },
    batch: {
      title: '批量处理', desc: '对多个 PDF 套用同一操作并打包下载（ZIP）。支持：压缩、去除空白页、删除重复页、修复损坏、重栅格化压缩、旋转、加密、文字水印、添加页码；个别文件处理失败会在结果中单独报告，其余照常产出。纯本地、文件不上传。',
      fields: [
        { key: 'files', label: '选择多个 PDF', type: 'file', accept: 'application/pdf', multiple: true },
        { key: 'op', label: '批量操作', type: 'select', value: 'compress', options: [
          { value: 'compress', label: '压缩（减小体积）' },
          { value: 'blank', label: '去除空白页' },
          { value: 'dedupe', label: '删除重复页' },
          { value: 'repair', label: '修复损坏' },
          { value: 'raster', label: '重栅格化压缩（图片化）' },
          { value: 'rotate', label: '旋转' },
          { value: 'encrypt', label: '加密' },
          { value: 'wm', label: '文字水印' },
          { value: 'pagenum', label: '添加页码' },
        ] },
        { key: 'angle', label: '旋转角度（旋转操作用，顺时针）', type: 'select', value: '90', options: [ {value:'90',label:'90°'},{value:'180',label:'180°'},{value:'270',label:'270°'},{value:'0',label:'归正 0°'} ] },
        { key: 'downscale', label: '重栅格化倍率（1=原尺寸… 越小越省空间，图片化操作用，默认 2.5）', type: 'number', value: 2.5, group: 'raster' },
        { key: 'password', label: '打开密码（加密操作用）', type: 'password' },
        { key: 'text', label: '水印文字（文字水印用）', type: 'text', placeholder: '机密 CONFIDENTIAL' },
        { key: 'pageFormat', label: '页码格式（添加页码用）', type: 'text', value: '第 {n} 页', placeholder: '第 {n} 页 / 第 {n} / {total} 页' },
      ],
      afterRender: (form) => {
        const opSel = form.querySelector('[data-key="op"]');
        if (!opSel) return;
        const apply = () => { form.querySelectorAll('[data-group="raster"]').forEach((el) => { el.style.display = opSel.value === 'raster' ? '' : 'none'; }); };
        opSel.addEventListener('change', apply);
        apply();
      },
      run: async (v, onProgress) => {
        const files = v.files;
        if (!files || !files.length) throw new Error('请至少选择一个 PDF');
        const zip = new JSZip();
        let done = 0;
        const errorLog = [];
        const labels = { compress: '压缩', blank: '去空白页', dedupe: '去重复页', repair: '修复', raster: '重栅格化', rotate: '旋转', encrypt: '加密', wm: '文字水印', pagenum: '添加页码' };
        for (const f of files) {
          if (onProgress) onProgress({ done, total: files.length, phase: '批量处理中（' + labels[v.op] + '）' });
          try {
            let bytes;
            if (v.op === 'compress') bytes = await E.compressPDF({ file: f }, null);
            else if (v.op === 'blank') { const r = await E.removeBlankPages({ file: f }, {}, null); bytes = r.bytes; if (r.keptAll) { errorLog.push(f.name + '：未发现空白页（未改动）'); continue; } }
            else if (v.op === 'dedupe') { const r = await E.removeDuplicatePages({ file: f }, {}, null); bytes = r.bytes; }
            else if (v.op === 'repair') { const r = await E.repairPDF({ file: f }, {}, null); bytes = r.bytes; }
            else if (v.op === 'raster') bytes = await E.rasterizeCompress({ file: f }, Number(v.downscale) || 2.5, null);
            else if (v.op === 'rotate') bytes = await E.rotatePages({ file: f }, null, Number(v.angle) || 0, null);
            else if (v.op === 'encrypt') { if (!v.password) throw new Error('加密操作需要设置打开密码'); bytes = await E.encryptPDF({ file: f }, { userPassword: v.password }, null); }
            else if (v.op === 'wm') { if (!v.text) throw new Error('文字水印需要填写水印文字'); bytes = await E.addTextWatermark({ file: f }, { text: v.text }, null); }
            else if (v.op === 'pagenum') bytes = await E.addPageNumbers({ file: f }, { format: v.pageFormat || '第 {n} 页' }, null);
            else throw new Error('未知批量操作');
            const base = (f.name || 'file.pdf').replace(/\.pdf$/i, '');
            zip.file(`${base}-${v.op}.pdf`, bytes);
            done++;
          } catch (e) {
            errorLog.push(f.name + '：失败（' + ((e && e.message) || e) + '）');
          }
        }
        if (onProgress) onProgress({ done, total: files.length, phase: '打包中' });
        let blob;
        try { blob = await zip.generateAsync({ type: 'blob' }); } catch (e) { throw new Error('打包失败：' + ((e && e.message) || e)); }
        const results = [];
        if (done) results.push({ name: 'batch.zip', blob, kind: 'zip' });
        if (errorLog.length) results.push({ name: 'batch-report.txt', kind: 'text', text: '以下文件未成功处理：\n' + errorLog.join('\n') });
        const msgTotal = files.length + ' 个文件：成功 ' + done + (errorLog.length ? '，跳过/失败 ' + errorLog.length + ' 个' : '');
        return { message: `批量 ${labels[v.op]}完成（${msgTotal}）`, results };
      },
    },
    search: {
      title: '搜索文本', desc: '在 PDF 中查找文本，返回每页命中数量与上下文，便于快速定位关键词。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'query', label: '搜索关键词', type: 'text', placeholder: '要查找的文本' },
        { key: 'matchCase', label: '', type: 'checks', options: [ { key: 'matchCase', label: '区分大小写（默认不区分）' } ], checked: [] },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.query || !v.query.trim()) throw new Error('请输入要搜索的文本');
        const res = await E.searchText({ file: v.file }, v.query.trim(), { caseInsensitive: !(v.matchCase && v.matchCase.matchCase), password: v.password }, onProgress);
        const byPage = {};
        res.matches.forEach((m) => { byPage[m.page] = (byPage[m.page] || 0) + 1; });
        let report = `搜索「${res.query}」：共 ${res.matches.length} 处命中，分布在 ${Object.keys(byPage).length} 页。\n\n`;
        Object.keys(byPage).sort((a, b) => a - b).forEach((p) => { report += `第 ${p} 页：${byPage[p]} 处\n`; });
        report += '\n--- 命中上下文（前若干条）---\n';
        res.matches.slice(0, 50).forEach((m) => {
          const ctx = (res.pages[m.page - 1] && res.pages[m.page - 1].text) || '';
          const idx = ctx.indexOf(m.text);
          const snip = idx >= 0 ? ctx.slice(Math.max(0, idx - 20), idx + m.text.length + 20).replace(/\s+/g, ' ') : m.text;
          report += `· 第${m.page}页: …${snip}…\n`;
        });
        return { message: `找到 ${res.matches.length} 处命中`, results: [{ name: 'search-result.txt', text: report, kind: 'text' }] };
      },
    },
    'replacext': {
      title: '替换文本', desc: '查找文本并覆盖替换为新文字（best-effort）。覆盖原词后叠加重绘新文字——中文走图片烤入兼容任意语言。适用于落在同一文本词条内的关键词；跨词条长句可能无法整体命中（已知限制）。纯本地、文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'query', label: '要替换的文本', type: 'text', placeholder: '被替换的旧文本' },
        { key: 'replacement', label: '替换为', type: 'text', placeholder: '新文本（留空＝仅删除/遮盖原文字）' },
        { key: 'matchCase', label: '', type: 'checks', options: [ { key: 'matchCase', label: '区分大小写（默认不区分）' } ], checked: [] },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.query || !v.query.trim()) throw new Error('请输入要替换的文本');
        const out = await E.replaceText({ file: v.file }, v.query.trim(), v.replacement || '', { caseInsensitive: !(v.matchCase && v.matchCase.matchCase), password: v.password }, onProgress);
        const res = single('replaced.pdf', out.bytes);
        res.message = `已替换 ${out.replaced} 处（涉及 ${out.pages} 页）。注：覆盖原词后重绘新文字，复杂排版请手动校对。`;
        return res;
      },
    },
    fillform: {
      title: '填充表单', desc: '读取 PDF 中的表单字段并填写，适用于带表单的 PDF（如合同、申报表）。',
      fields: [
        { key: 'file', label: '选择带表单的 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'dyn', label: '', type: 'dynform' },
      ],
      run: async (v, onProgress) => {
        const vals = state.formValues || {};
        const bytes = await E.fillForm({ file: v.file }, vals, null, onProgress);
        return single('filled.pdf', bytes);
      },
      // 文件选好后动态读取表单字段并生成输入控件
      onFilesReady() {
        const cont = document.getElementById('dynFormFields');
        if (!cont) return;
        const file = state.files.file && state.files.file[0];
        if (!file) { cont.innerHTML = ''; return; }
        cont.innerHTML = '<div class="hint">正在读取表单字段…</div>';
        E.getFormFields({ file }).then((fields) => {
          state.formValues = state.formValues || {};
          cont.innerHTML = '';
          if (!fields.length) { cont.innerHTML = '<div class="hint">未检测到可填写的表单字段（该 PDF 可能不含交互式表单）。</div>'; return; }
          fields.forEach((f) => {
            const wrap = document.createElement('div'); wrap.className = 'field';
            const label = document.createElement('label'); label.textContent = f.name; wrap.appendChild(label);
            if (f.type === 'text') {
              const inp = document.createElement('input'); inp.type = 'text'; inp.value = f.value || '';
              inp.oninput = () => { state.formValues[f.name] = inp.value; };
              wrap.appendChild(inp);
            } else if (f.type === 'checkbox') {
              const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!f.value;
              c.onchange = () => { state.formValues[f.name] = c.checked; };
              wrap.appendChild(c);
            } else if (f.type === 'radio' || f.type === 'dropdown') {
              const sel = document.createElement(f.type === 'dropdown' ? 'select' : 'select');
              (f.options || []).forEach((o) => { const op = document.createElement('option'); op.value = o; op.textContent = o; if (o === f.value) op.selected = true; sel.appendChild(op); });
              sel.onchange = () => { state.formValues[f.name] = sel.value; };
              wrap.appendChild(sel);
            }
            cont.appendChild(wrap);
          });
        }).catch(() => { cont.innerHTML = '<div class="hint">读取表单字段时出错。</div>'; });
      },
    },
    flatten: {
      title: '表单扁平化', desc: '把已填表单值烤成静态内容并删除表单字段，使内容不可再编辑（脱敏 / 归档用）。保留中文显示。',
      fields: [
        { key: 'file', label: '选择带表单的 PDF（可先填后扁平）', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '当前密码(若已加密)', type: 'password' },
      ],
      run: async (v, onProgress) => single('flattened.pdf', await E.flattenForms({ file: v.file }, { password: v.password }, onProgress)),
    },
    sign: {
      title: '数字签名', desc: '生成自签证书并对 PDF 进行 PKCS#7 数字签名（adbe.pkcs7.detached）。签名后文件可校验完整性。',
      fields: [
        { key: 'file', label: '选择待签名 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'name', label: '签名人 / 标题', type: 'text', value: '绿角犀用户' },
        { key: 'reason', label: '签名理由', type: 'text', value: '本人已审阅并确认文档内容' },
        { key: 'location', label: '地点（可选）', type: 'text' },
        { key: 'contact', label: '联系方式（可选）', type: 'text' },
        { key: 'fieldName', label: '签名域名称', type: 'text', value: 'Signature1' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => single('signed.pdf', await E.signPDF({ file: v.file }, {
        name: v.name, reason: v.reason, location: v.location, contact: v.contact,
        fieldName: v.fieldName, password: v.password,
      }, onProgress)),
    },
    verify: {
      title: '验签', desc: '校验 PDF 中的数字签名：验证文档完整性（是否被篡改）与签名算法有效性，并提取签名者。',
      fields: [
        { key: 'file', label: '选择已签名的 PDF', type: 'file', accept: 'application/pdf' },
      ],
      run: async (v, onProgress) => {
        const res = await E.verifyPDFSignature({ file: v.file }, onProgress);
        if (res.error) {
          const text = '验签失败：' + res.error;
          return { message: text, results: [{ name: '验签结果', kind: 'text', text }] };
        }
        const lines = [];
        lines.push(res.valid ? '签名有效' : '签名无效');
        lines.push('文档完整性（messageDigest）：' + (res.mdOk ? '通过' : '未通过'));
        lines.push('签名算法校验：' + (res.sigOk ? '通过' : '未通过'));
        if (res.signer) lines.push('签名者：' + res.signer);
        const text = lines.join('\n');
        return { message: res.valid ? '签名有效' : '签名无效', results: [{ name: '验签结果', kind: 'text', text }] };
      },
    },
    redact: {
      title: '脱敏 / 红action', desc: '对 PDF 中的敏感内容做遮盖：支持「关键词自动定位」与「手动区域」两种方式，提供黑条/白条遮盖；可选「彻底栅格化」模式（含脱敏页整体转为图片，真正不可恢复）。纯本地处理，文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'keywords', label: '敏感关键词（每行一个或用逗号分隔，自动覆盖匹配到的文本）', type: 'text', placeholder: '张三, 身份证号, 机密', hint: '例：张三 / 机密 / 13700000000' },
        { key: 'method', label: '处理方式', type: 'select', value: 'cover',
          options: [ {value:'cover',label:'遮盖条（保留可检索，黑/白条覆盖）'}, {value:'burn',label:'彻底栅格化（不可恢复，含脱敏页转图片）'} ] },
        { key: 'color', label: '遮盖颜色', type: 'select', value: 'black',
          options: [ {value:'black',label:'黑条'}, {value:'white',label:'白条'} ] },
        { key: 'regions', label: '高级：手动区域 JSON（可选）', type: 'text', placeholder: '[{"page":1,"x":100,"y":700,"w":120,"h":16}]',
          hint: 'PDF 用户坐标（原点左下，单位 pt）。不填 page 则应用到所有页。' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        const keywords = (v.keywords || '').split(/[\n,，]/).map((s) => s.trim()).filter(Boolean);
        let regions = [];
        if (v.regions && v.regions.trim()) {
          try { regions = JSON.parse(v.regions); }
          catch (e) { throw new Error('区域 JSON 解析失败：' + e.message); }
          if (!Array.isArray(regions)) throw new Error('区域必须是数组');
        }
        const res = await E.redactPDF({ file: v.file }, { keywords, regions, method: v.method, color: v.color, password: v.password }, onProgress);
        const out = single('redacted.pdf', res.bytes);
        const irreversible = v.method === 'burn';
        out.message = `已脱敏 ${res.pagesRedacted} 页 / 覆盖 ${res.boxCount} 处。` + (irreversible ? '（已彻底栅格化，不可恢复）' : '（遮盖条：底层文字仍保留，若需不可恢复请改用「彻底栅格化」）');
        return out;
      },
    },
    pdfa: {
      title: 'PDF/A 归档', desc: '把 PDF 转换为 PDF/A 兼容归档版：移除加密、扁平化交互表单、清除 JavaScript，并写入 sRGB 色彩配置（OutputIntent）+ XMP 一致性声明（pdfaid）+ MarkInfo + 文档 ID，满足长期自包含存档要求。纯本地处理，文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'conformance', label: '合规级别', type: 'select', value: '2B',
          options: [ {value:'2B',label:'PDF/A-2B（推荐，兼容性好）'}, {value:'3B',label:'PDF/A-3B（可含附件）'}, {value:'1B',label:'PDF/A-1B（仅做标记，见下方说明）'} ] },
        { key: 'mode', label: '归档模式', type: 'select', value: 'standard',
          options: [ {value:'standard',label:'标准（保留文本/矢量，体积小）'}, {value:'image',label:'图像归档（每页栅格化，彻底自包含）'} ] },
        { key: 'flatten', label: '扁平化交互表单', type: 'checkbox', value: true },
        { key: 'removeJS', label: '移除 JavaScript', type: 'checkbox', value: true },
        { key: 'scale', label: '图像模式清晰度(默认 2)', type: 'number', value: 2 },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const res = await E.toPDFA({ file: v.file }, {
          conformance: v.conformance || '2B',
          mode: v.mode || 'standard',
          flatten: v.flatten !== false,
          password: v.password,
          scale: Number(v.scale) || 2,
        }, onProgress);
        const out = single('archived-' + res.conformance + '.pdf', res.bytes);
        let note = `已生成 ${res.conformance} 归档版（${res.pageCount} 页，模式：${res.mode === 'image' ? '图像' : '标准'}）。`;
        if (res.conformance === '1B') note += ' 注：底层引擎输出为 PDF 1.7，1B 仅写入一致性标记、无法真正降级到 PDF 1.4；若需严格 1B 认证，请用 2B/3B。';
        note += ' 说明：已尽量做自包含化与合规标记，但不内附校验器，不等同官方认证；字体未内嵌的源文件请先「嵌入字体」。';
        out.message = note;
        return out;
      },
    },
    pdfacheck: {
      title: 'PDF/A 合规校验', desc: '检查 PDF 是否符合 PDF/A 归档规范：逐项校验「无加密 / 字体全部嵌入 / 无 JavaScript / 含 OutputIntent+ICC 色彩配置 / 含 XMP(pdfaid) / 含文档 ID / 按级别检查内嵌文件·透明度·PDF 版本 / 无 Launch 动作」等硬性要点，并给出总体合规结论与逐条明细。纯本地处理，文件不上传。注意：这是本地启发式校验，不等同官方认证（如 veraPDF）。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'level', label: '校验级别', type: 'select', value: 'auto',
          options: [ {value:'auto',label:'自动识别（读取文件内 XMP 声明）'}, {value:'1B',label:'PDF/A-1B'}, {value:'2B',label:'PDF/A-2B'}, {value:'3B',label:'PDF/A-3B'} ] },
        { key: 'password', label: '打开密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const res = await E.validatePDFA({ file: v.file }, {
          level: v.level || 'auto',
          password: v.password,
        }, onProgress);
        const report = formatPDFAReport(res);
        const message = res.verdict === 'compliant'
          ? ('校验通过：该 PDF 符合 PDF/A-' + res.level + ' 规范（' + res.passCount + ' 项通过' + (res.warnCount ? '，' + res.warnCount + ' 项警告' : '') + '）')
          : ('校验未通过：该 PDF 不符合 PDF/A-' + res.level + ' 规范（' + res.failCount + ' 项失败，' + res.passCount + ' 项通过）');
        return { message, results: [{ name: 'pdfa-check-report.txt', text: report, kind: 'text' }] };
      },
    },
    attach: {
      title: '附件增删', desc: '查看 / 添加 / 删除 PDF 内的嵌入式文件附件（文档级附件，可在阅读器的「附件」面板查看）。纯本地处理，文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'op', label: '操作', type: 'select', value: 'list',
          options: [ {value:'list',label:'列出附件'}, {value:'add',label:'添加附件'}, {value:'remove',label:'删除附件'} ] },
        { key: 'attachFile', label: '选择要附加的文件', type: 'file', accept: '*/*', group: 'add' },
        { key: 'attachName', label: '附件名称（默认文件名）', type: 'text', group: 'add', placeholder: '例如：合同扫描件.pdf' },
        { key: 'attachMime', label: 'MIME 类型（留空自动识别）', type: 'text', group: 'add', placeholder: '例如：application/pdf、text/plain' },
        { key: 'attachDesc', label: '描述（可选）', type: 'text', group: 'add' },
        { key: 'removeNames', label: '要删除的附件名称（每行一个，可先用「列出附件」查看）', type: 'textarea', group: 'remove' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      afterRender: (form) => {
        const opSel = form.querySelector('[data-key="op"]');
        if (!opSel) return;
        const apply = () => {
          const op = opSel.value;
          form.querySelectorAll('[data-group]').forEach((el) => {
            const g = el.dataset.group;
            const show = (g === 'add' && op === 'add') || (g === 'remove' && op === 'remove');
            el.style.display = show ? '' : 'none';
          });
        };
        opSel.addEventListener('change', apply);
        apply();
      },
      run: async (v) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const srcBytes = new Uint8Array(await v.file.arrayBuffer());

        if (v.op === 'list') {
          const list = await E.listAttachments({ bytes: srcBytes, password: v.password });
          if (!list.length) {
            return { message: '该 PDF 没有附件', results: [{ name: '附件列表.txt', kind: 'text', text: '（此文件不包含任何嵌入式附件）' }] };
          }
          const text = list.map((a, i) =>
            `${i + 1}. ${a.name}\n   大小：${a.size} 字节\n   类型：${a.mimeType || '（未声明）'}\n   描述：${a.description || '（无）'}\n   创建：${a.created || '（未知）'}`
          ).join('\n\n');
          return { message: `共 ${list.length} 个附件`, results: [{ name: 'attachments.txt', kind: 'text', text }] };
        }

        if (v.op === 'add') {
          if (!v.attachFile) throw new Error('请选择要附加的文件');
          const fileBytes = new Uint8Array(await v.attachFile.arrayBuffer());
          const r = await E.addAttachment({
            bytes: srcBytes,
            fileBytes,
            fileName: v.attachName && v.attachName.trim() ? v.attachName.trim() : v.attachFile.name,
            description: v.attachDesc || '',
            mimeType: v.attachMime || '',
            password: v.password,
          });
          const blob = new Blob([r.bytes], { type: 'application/pdf' });
          return { message: `已附加「${r.added}」，现有 ${r.count} 个附件`, results: [{ name: 'with-attachment.pdf', blob, kind: 'pdf' }] };
        }

        if (v.op === 'remove') {
          const names = (v.removeNames || '').split('\n').map((s) => s.trim()).filter(Boolean);
          if (!names.length) throw new Error('请在文本框中填入要删除的附件名称（每行一个）');
          const r = await E.removeAttachment({ bytes: srcBytes, names, password: v.password });
          const blob = new Blob([r.bytes], { type: 'application/pdf' });
          return { message: `已删除 ${r.removed.length} 个附件（剩余 ${r.remaining} 个）`, results: [{ name: 'without-attachment.pdf', blob, kind: 'pdf' }] };
        }
        throw new Error('请选择操作类型');
      },
    },
    downatt: {
      title: '附件内容导出', desc: '把 PDF 内嵌入的文件附件全部取出来，打包成 ZIP 下载（保留附件原名与扩展名）；与「附件增删」互补——这里不查看、可一键导回嵌入的文件本体。纯本地处理，文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const srcBytes = new Uint8Array(await v.file.arrayBuffer());
        const list = await E.listAttachments({ bytes: srcBytes, password: v.password });
        if (!list.length) {
          return { message: '该 PDF 没有附件', results: [{ name: '附件列表.txt', kind: 'text', text: '（此文件不包含任何嵌入式附件）' }] };
        }
        const zip = new JSZip();
        const used = {};
        list.forEach((a) => {
          const name = a.name || ('attachment-' + (a.index || 0));
          let base = name, ext = '';
          const dot = name.lastIndexOf('.');
          if (dot > 0) { base = name.slice(0, dot); ext = name.slice(dot); }
          let uniq = name; let n = 1;
          while (used[uniq]) { uniq = base + '(' + n + ')' + ext; n++; }
          used[uniq] = 1;
          zip.file(uniq, a.bytes || new Uint8Array(0));
        });
        if (onProgress) onProgress({ done: 1, total: 1, phase: '打包附件中' });
        const blob = await zip.generateAsync({ type: 'blob' });
        const manifest = '共导出 ' + list.length + ' 个附件：\n' + list.map((a, i) => `${i + 1}. ${a.name}（${a.size} 字节，${a.mimeType || '未声明类型'}）`).join('\n');
        return {
          message: `已导出 ${list.length} 个附件（ZIP）`,
          results: [
            { name: 'attachments.zip', blob, kind: 'zip' },
            { name: '附件清单.txt', kind: 'text', text: manifest },
          ],
        };
      },
    },
    repair: {
      title: '损坏 PDF 修复', desc: '尝试修复轻度损坏的 PDF：修正大小写错误的文件头（如 %pdf→%PDF）、清理文件头前的垃圾字节与文件尾 %%EOF 之后的残留数据、补写缺失的 %%EOF、规范非法版本号、统一换行符，并对被截断下载做前缀恢复；最后做一次干净重写（重排交叉引用表、修复各阅读器兼容问题）。纯本地处理，文件不上传。',
      fields: [
        { key: 'file', label: '选择损坏的 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'password', label: '打开密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF 文件');
        const res = await E.repairPDF({ file: v.file }, { password: v.password }, onProgress);
        const out = single('repaired.pdf', res.bytes);
        const changes = (res.changes || []).map((c) => '• ' + c).join('\n');
        let note = `修复完成：输出 ${res.pageCount} 页的可正常打开 PDF。\n已执行的修复：\n${changes}`;
        if (res.recovered) note += '\n提示：本次为截断恢复，仅保留了文件前部可解析的页面，尾部损坏部分已舍弃。';
        note += '\n说明：本工具针对「头部/尾部字节损坏、版本号异常、截断下载、换行符混乱」等轻度损坏有效；若文件缺失交叉引用表(xref)或页面对象被截断缺失，pdf-lib 无法重建，将给出明确提示。已加密文件请在密码框填写打开密码。';
        out.message = note;
        return out;
      },
    },
    compare: {
      title: '两版 PDF 对比', desc: '对比两份 PDF（旧版 A 与新版 B）在「页数 / 元数据 / 书签大纲 / 附件 / 文本内容」上的差异，生成结构化对比报告。纯本地处理，文件不上传。',
      fields: [
        { key: 'fileA', label: '选择旧版 PDF（版本 A）', type: 'file', accept: 'application/pdf' },
        { key: 'fileB', label: '选择新版 PDF（版本 B）', type: 'file', accept: 'application/pdf' },
        { key: 'passwordA', label: '版本 A 打开密码（若已加密）', type: 'password' },
        { key: 'passwordB', label: '版本 B 打开密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.fileA || !v.fileB) throw new Error('请同时选择两个 PDF（旧版 A 与新版 B）');
        const res = await E.comparePDFs({ file: v.fileA }, { file: v.fileB }, {
          passwordA: v.passwordA, passwordB: v.passwordB, aName: '版本 A', bName: '版本 B',
        }, onProgress);
        const report = formatCompareReport(res);
        const changed = res.summary.changedSections.length;
        const message = res.summary.identical ? '两份 PDF 未发现差异' : '对比完成：在 ' + changed + ' 个维度发现差异';
        return { message, results: [
          { name: 'compare-report.txt', text: report, kind: 'text' },
          { name: 'compare-report.html', text: buildCompareHTML(res), kind: 'text' },
        ] };
      },
    },
    batchform: {
      title: '批量填表', desc: '上传一份含表单的 PDF 模板 + 一个 CSV 数据表（首行为字段名，须与 PDF 表单字段名一致；可选列名为 filename / 文件名 / name / 名称 来指定该份输出文件名），每行生成一份已填好的 PDF。支持中文与勾选框（CSV 中 是/yes/1/true 表示勾选）。纯本地处理，文件不上传。',
      fields: [
        { key: 'file', label: '选择表单模板 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'csv', label: '选择 CSV 数据表（UTF-8，首行表头为字段名）', type: 'file', accept: '.csv,text/csv' },
        { key: 'password', label: '模板打开密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file || !v.csv) throw new Error('请同时选择「表单模板 PDF」和「CSV 数据表」');
        let csvText;
        try { csvText = await v.csv.text(); } catch (e) { throw new Error('读取 CSV 失败：' + (e && e.message ? e.message : e)); }
        const res = await E.batchFillForms({ file: v.file }, csvText, { password: v.password }, onProgress);
        const results = res.files.map((f) => ({ name: f.name, blob: new Blob([f.bytes], { type: 'application/pdf' }), kind: 'pdf' }));
        const preview = res.files.map((f) => f.name).slice(0, 5).join('、') + (res.count > 5 ? ' …' : '');
        const fieldsNote = res.dataFields.length ? '；识别到数据字段：' + res.dataFields.join('、') : '';
        return { message: `已生成 ${res.count} 份填好的 PDF（${preview}）${fieldsNote}`, results };
      },
    },
    ocr: {
      title: 'OCR 文字识别', desc: '对扫描版（图片型）PDF 做本地 OCR 识别（中英文），全程在设备内完成、文件不上传。可导出文本，或生成可检索 PDF（文字烤入隐藏文本层）。',
      fields: [
        { key: 'file', label: '选择扫描版 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'langs', label: '识别语言', type: 'select', value: 'chi_sim+eng',
          options: [{ value: 'chi_sim+eng', label: '中英文（推荐）' }, { value: 'chi_sim', label: '仅中文' }, { value: 'eng', label: '仅英文' }] },
        { key: 'makeSearchable', label: '生成可检索 PDF（把文字烤入隐藏文本层，可选中/搜索）', type: 'checkbox', value: false },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const ocr = await E.ocrPDF({ file: v.file }, { langs: v.langs, password: v.password }, onProgress);
        const results = [];
        const txt = ocr.fullText || '';
        results.push({ name: 'ocr_text.txt', kind: 'text', text: txt || '（未识别到文字）' });
        let message = `OCR 完成：${ocr.pageCount} 页，约 ${txt.length} 个字符`;
        if (v.makeSearchable) {
          const sr = await E.makeSearchablePDF({ file: v.file }, ocr, { password: v.password }, onProgress);
          results.push({ name: 'searchable.pdf', blob: new Blob([sr.bytes], { type: 'application/pdf' }), kind: 'pdf' });
          message += `；已写入 ${sr.drawn} 段文字${sr.skipped ? '，跳过 ' + sr.skipped + ' 段（字体不支持，建议配置中文字体）' : ''}`;
        }
        return { message, results };
      },
    },
    word: {
      title: '导出 Word', desc: '把 PDF 的文字内容（保留布局、粗体、斜体、字号）导出为可编辑的 .docx。纯本地生成，文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'rowTol', label: '同行容差(pt，默认 6)', type: 'number', value: 6 },
        { key: 'paraTol', label: '段落间距容差(pt，默认 14)', type: 'number', value: 14 },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const r = await E.exportToWord({ file: v.file }, {
          password: v.password,
          rowTol: v.rowTol ? Number(v.rowTol) : 6,
          paraTol: v.paraTol ? Number(v.paraTol) : 14,
        }, onProgress);
        const blob = new Blob([r.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        return { message: `已导出 Word：${r.pageCount} 页`, results: [{ name: 'exported.docx', blob, kind: 'file' }] };
      },
    },
    excel: {
      title: '导出 Excel', desc: '用坐标聚类把 PDF 中的表格/对齐文本识别为 .xlsx（每页一个工作表）。纯本地生成，文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'colTol', label: '列间距容差(pt，默认 12)', type: 'number', value: 12 },
        { key: 'rowTol', label: '行间距容差(pt，默认 6)', type: 'number', value: 6 },
        { key: 'password', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const r = await E.exportToExcel({ file: v.file }, {
          password: v.password,
          colTol: v.colTol ? Number(v.colTol) : 12,
          rowTol: v.rowTol ? Number(v.rowTol) : 6,
        }, onProgress);
        const blob = new Blob([r.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        return { message: `已导出 Excel：${r.sheets} 个工作表`, results: [{ name: 'exported.xlsx', blob, kind: 'file' }] };
      },
    },
    extractimg: {
      title: '提取图片', desc: '从 PDF 中提取所有内嵌图片。JPEG 直接无损导出；PNG / 灰度 / 索引色等尽力转存为 PNG（含透明通道）；不支持的格式（如 JBIG2 / CCITT / JPEG2000）会在报告中标注。纯本地处理，文件不上传。',
      fields: [
        { key: 'file', label: '选择 PDF', type: 'file', accept: 'application/pdf' },
        { key: 'cur', label: '当前密码（若已加密）', type: 'password' },
      ],
      run: async (v, onProgress) => {
        if (!v.file) throw new Error('请选择 PDF');
        const res = await E.extractImages({ file: v.file, password: v.cur }, onProgress);
        const zip = new JSZip();
        let count = 0;
        res.images.forEach((im, idx) => {
          if (im.bytes) { const name = `image-${String(idx + 1).padStart(3, '0')}-p${im.page}.${im.ext}`; zip.file(name, im.bytes); count++; }
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const report = formatExtractReport(res);
        const rblob = new Blob([report], { type: 'text/plain;charset=utf-8' });
        return { message: `共发现 ${res.total} 张图片，已导出 ${count} 张`, results: [{ name: 'images.zip', blob, kind: 'zip' }, { name: 'extract-report.txt', blob: rblob, kind: 'text' }] };
      },
    },
  };

  /* ---------------- 工具函数 ---------------- */
  function parsePages(s) {
    if (!s) return [];
    const out = [];
    s.split(/[,\s]+/).forEach((part) => {
      if (!part) return;
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
      } else out.push(Number(part));
    });
    return [...new Set(out)].sort((x, y) => x - y);
  }

  function single(name, bytes) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return { message: '处理完成', results: [{ name, blob, kind: 'pdf' }] };
  }

  // 把 comparePDFs 的结构化结果渲染为中文对比报告
  function formatCompareReport(res) {
    const L = [];
    const s = res.summary;
    L.push('═══ 两版 PDF 对比报告 ═══');
    L.push('对比对象：' + s.aName + '（旧版） vs ' + s.bName + '（新版）');
    L.push('页数：' + s.pageCountA + ' 页 → ' + s.pageCountB + ' 页');
    L.push('');
    if (s.identical) {
      L.push('结论：两份文件在「页数 / 元数据 / 书签 / 附件 / 文本」维度上均未发现差异。');
      L.push('（注：像素级图像差异与版面微调本工具不比对；如需核验，请用阅读器逐页目视。）');
      return L.join('\n');
    }
    L.push('结论：在 ' + s.changedSections.length + ' 个维度发现差异：' + s.changedSections.join('、') + '。');
    L.push('');

    L.push('【1】页数');
    if (res.pages.delta === 0) L.push('  • 页数一致：均为 ' + res.pages.a + ' 页');
    else if (res.pages.delta > 0) L.push('  • 新版比旧版多出 ' + res.pages.delta + ' 页（' + res.pages.a + ' → ' + res.pages.b + '）');
    else L.push('  • 新版比旧版减少 ' + (-res.pages.delta) + ' 页（' + res.pages.a + ' → ' + res.pages.b + '）');
    L.push('');

    L.push('【2】元数据');
    if (!res.metadata.changed) L.push('  • 未变化');
    else res.metadata.changes.forEach((c) => { L.push('  • ' + c.label + '：' + c.a + '  →  ' + c.b); });
    L.push('');

    L.push('【3】书签 / 大纲');
    if (!res.outline.changed) L.push('  • 未变化');
    else {
      if (res.outline.added.length) L.push('  • 新增：\n' + res.outline.added.map((x) => '      + ' + x).join('\n'));
      if (res.outline.removed.length) L.push('  • 移除：\n' + res.outline.removed.map((x) => '      - ' + x).join('\n'));
    }
    L.push('');

    L.push('【4】附件');
    if (!res.attachments.changed) L.push('  • 未变化');
    else {
      if (res.attachments.added.length) L.push('  • 新增：' + res.attachments.added.join('、'));
      if (res.attachments.removed.length) L.push('  • 移除：' + res.attachments.removed.join('、'));
      if (res.attachments.changedNames.length) L.push('  • 内容变更（同名不同大小）：' + res.attachments.changedNames.join('、'));
    }
    L.push('');

    L.push('【5】文本内容');
    const t = res.text;
    if (!t || !t.available) L.push('  • ' + (t ? t.note : '未对比'));
    else {
      L.push('  • 整体文本相似度：约 ' + (t.similarity * 100).toFixed(1) + '%' + (t.truncated ? '（文档过大，已用近似算法）' : ''));
      if (t.addedPages.length) L.push('  • 新增页：第 ' + t.addedPages.join('、') + ' 页');
      if (t.removedPages.length) L.push('  • 移除页：第 ' + t.removedPages.join('、') + ' 页');
      const changedPages = (t.perPage || []).filter((p) => !p.same).map((p) => p.page);
      if (changedPages.length) L.push('  • 内容有改动的页：第 ' + changedPages.join('、') + ' 页');
      const MAX = 50;
      if (t.addedLines.length) {
        L.push('  • 新增文本片段（最多 ' + MAX + ' 行）：');
        t.addedLines.slice(0, MAX).forEach((l) => L.push('      + ' + (l || '').slice(0, 200)));
        if (t.addedLines.length > MAX) L.push('      …… 其余 ' + (t.addedLines.length - MAX) + ' 行省略');
      }
      if (t.removedLines.length) {
        L.push('  • 删除文本片段（最多 ' + MAX + ' 行）：');
        t.removedLines.slice(0, MAX).forEach((l) => L.push('      - ' + (l || '').slice(0, 200)));
        if (t.removedLines.length > MAX) L.push('      …… 其余 ' + (t.removedLines.length - MAX) + ' 行省略');
      }
      if (!t.addedLines.length && !t.removedLines.length && !t.addedPages.length && !t.removedPages.length && !changedPages.length) L.push('  • 逐页文本一致');
    }
    L.push('');
    L.push('说明：本对比为纯本地结构化比对（页数 / 元数据 / 书签 / 附件 / 文本），不涉及像素级图像差异与版面微调。文件不上传。');
    return L.join('\n');
  }

  // 把 comparePDFs 的结构化结果再渲染为可双击打开的 HTML 并排报告（浏览器查看更直观）
  function buildCompareHTML(res) {
    const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const s = res.summary;
    const C = [];
    C.push('<!doctype html><meta charset="utf-8"><title>两版 PDF 对比报告</title>');
    C.push('<style>body{font-family:-apple-system,Segoe UI,Microsoft YaHei,sans-serif;margin:24px;color:#222;line-height:1.6}');
    C.push('h1{font-size:20px}h2{font-size:16px;margin-top:26px;border-left:4px solid #2C9678;padding-left:8px}');
    C.push('.meta{color:#666;font-size:13px}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;color:#fff}');
    C.push('.ok{background:#2C9678}.chg{background:#c96d00}.row{padding:6px 0;border-bottom:1px solid #eee}');
    C.push('.add{color:#137a2f;background:#e8f5ec;padding:2px 9px;border-radius:4px;display:block;white-space:pre-wrap;word-break:break-all}');
    C.push('.del{color:#b23a3a;background:#fbe9e9;padding:2px 9px;border-radius:4px;display:block;white-space:pre-wrap;word-break:break-all}');
    C.push('.same{color:#999;font-size:13px}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ddd;padding:5px 9px;font-size:13px}th{background:#f4f4f4}</style>');
    C.push('<h1>两版 PDF 对比报告</h1>');
    C.push('<div class="meta">' + esc(s.aName) + '（旧版） · ' + esc(s.bName) + '（新版） · 本报告由浏览器本地生成，不涉及文件上传</div>');
    C.push('<p>页数：' + s.pageCountA + ' → ' + s.pageCountB + ' 页');
    const sec = res.text && res.text.available && res.text.similarity != null ? ('　全文相似度：约 ' + (res.text.similarity * 100).toFixed(1) + '%') : '';
    C.push(sec + '</p>');
    if (s.identical) {
      C.push('<p><span class="badge ok">未发现差异</span>　页数 / 元数据 / 书签 / 附件 / 文本 均一致（像素级图像与版面微调不在比对范围）。</p></body></html>');
      return C.join('\n');
    }
    C.push('<p><span class="badge chg">发现差异</span>　' + s.changedSections.map(esc).join('、') + '</p>');

    C.push('<h2>页数</h2><p class="row">' + (res.pages.delta === 0 ? '页数一致：' + res.pages.a + ' 页' :
      (res.pages.delta > 0 ? '新版比旧版多出 ' + res.pages.delta + ' 页（' + res.pages.a + ' → ' + res.pages.b + '）' :
        '新版比旧版减少 ' + (-res.pages.delta) + ' 页（' + res.pages.a + ' → ' + res.pages.b + '）')) + '</p>');

    C.push('<h2>元数据</h2>');
    if (!res.metadata.changed) C.push('<p class="same">未变化</p>');
    else {
      C.push('<table><tr><th>字段</th><th>旧版</th><th>新版</th></tr>');
      res.metadata.changes.forEach((c) => C.push('<tr><td>' + esc(c.label) + '</td><td>' + esc(c.a) + '</td><td>' + esc(c.b) + '</td></tr>'));
      C.push('</table>');
    }

    C.push('<h2>书签 / 大纲</h2>');
    if (!res.outline.changed) C.push('<p class="same">未变化</p>');
    else {
      if (res.outline.added.length) C.push('<span class="add">+' + res.outline.added.map(esc).join('</span><span class="add">+') + '</span>');
      if (res.outline.removed.length) C.push('<span class="del">-' + res.outline.removed.map(esc).join('</span><span class="del">-') + '</span>');
    }

    C.push('<h2>附件</h2>');
    if (!res.attachments.changed) C.push('<p class="same">未变化</p>');
    else {
      if (res.attachments.added.length) C.push('<p><span class="badge ok">新增</span> ' + res.attachments.added.map(esc).join('、') + '</p>');
      if (res.attachments.removed.length) C.push('<p><span class="badge chg">移除</span> ' + res.attachments.removed.map(esc).join('、') + '</p>');
      if (res.attachments.changedNames.length) C.push('<p><span class="badge chg">内容变更</span> ' + res.attachments.changedNames.map(esc).join('、') + '</p>');
    }

    C.push('<h2>文本内容</h2>');
    const t = res.text;
    if (!t || !t.available) C.push('<p class="same">' + esc(t ? t.note : '未对比') + '</p>');
    else {
      C.push('<p class="row">整体相似度 <b>' + (t.similarity * 100).toFixed(1) + '%</b>' + (t.truncated ? '（近似算法）' : '') + '</p>');
      if (t.addedPages.length) C.push('<p><span class="badge ok">新增页</span> 第 ' + t.addedPages.map(esc).join('、') + ' 页</p>');
      if (t.removedPages.length) C.push('<p><span class="badge chg">移除页</span> 第 ' + t.removedPages.map(esc).join('、') + ' 页</p>');
      const changedPages = (t.perPage || []).filter((p) => !p.same).map((p) => p.page);
      if (changedPages.length) C.push('<p><span class="badge chg">有改动页</span> 第 ' + changedPages.map(esc).join('、') + ' 页</p>');
      const MAX = 50;
      if (t.addedLines.length) {
        C.push('<p class="row">新增文本片段：</p>');
        t.addedLines.slice(0, MAX).forEach((l) => C.push('<span class="add">+ ' + esc((l || '').slice(0, 200)) + '</span>'));
        if (t.addedLines.length > MAX) C.push('<p class="same">…… 其余 ' + (t.addedLines.length - MAX) + ' 行省略</p>');
      }
      if (t.removedLines.length) {
        C.push('<p class="row">删除文本片段：</p>');
        t.removedLines.slice(0, MAX).forEach((l) => C.push('<span class="del">- ' + esc((l || '').slice(0, 200)) + '</span>'));
        if (t.removedLines.length > MAX) C.push('<p class="same">…… 其余 ' + (t.removedLines.length - MAX) + ' 行省略</p>');
      }
      if (!t.addedLines.length && !t.removedLines.length && !t.addedPages.length && !t.removedPages.length && !changedPages.length) C.push('<p class="same">逐页文本一致</p>');
    }
    C.push('</body></html>');
    return C.join('\n');
  }

  function formatPDFAReport(res) {
    const L = [];
    const ST = { pass: '通过', fail: '失败', warn: '警告', info: '提示' };
    const verdictText = res.verdict === 'compliant' ? ('符合 PDF/A-' + res.level + ' 规范') : ('不符合 PDF/A-' + res.level + ' 规范');
    L.push('═══ PDF/A 合规校验报告 ═══');
    L.push('目标级别：' + (res.level || '?') + (res.rawVersion ? ('（源文件 PDF ' + res.rawVersion.major + '.' + res.rawVersion.minor + '）') : ''));
    L.push('总体结论：' + verdictText);
    L.push('统计：通过 ' + res.passCount + ' 项 / 失败 ' + res.failCount + ' 项 / 警告 ' + res.warnCount + ' 项 / 提示 ' + res.infoCount + ' 项');
    L.push('');
    if (res.parseError) {
      L.push('【前置检查】文件可解析');
      L.push('  • [失败] ' + res.parseError);
      L.push('');
      L.push('说明：本工具无法加载该文件，可能已加密（请在密码框填写打开密码）或文件已损坏。');
      return L.join('\n');
    }
    res.checks.forEach((c) => {
      L.push('[' + (ST[c.status] || c.status) + '] ' + c.label + (c.detail ? (' — ' + c.detail) : ''));
    });
    L.push('');
    L.push('说明：本校验为本地启发式检查，覆盖最常见的硬性违规项；不等同官方认证校验器（如 veraPDF）。如需权威认证，请用专业工具复核。文件不上传。');
    return L.join('\n');
  }

  function formatExtractReport(res) {
    const L = [];
    const ok = res.images.filter((i) => i.status === 'ok').length;
    const skip = res.images.filter((i) => i.status === 'skip').length;
    L.push('═══ PDF 内嵌图片提取报告 ═══');
    L.push('共发现 ' + res.total + ' 张图片：已成功导出 ' + ok + ' 张' + (skip ? ('，不支持跳过 ' + skip + ' 张') : '') + '。');
    L.push('');
    if (res.total === 0) {
      L.push('（该 PDF 未检测到内嵌图片资源。）');
      return L.join('\n');
    }
    L.push('序号 | 页码 | 格式 | 尺寸 | 色彩/通道 | 压缩 | 状态');
    L.push('---- | ---- | ---- | ---- | ---- | ---- | ----');
    res.images.forEach((im, idx) => {
      const dim = im.w && im.h ? (im.w + '×' + im.h) : '-';
      const color = im.color || '-';
      const filter = im.filter || '-';
      const status = im.status === 'ok' ? ('已导出 .' + im.ext) : ('跳过：' + (im.note || '不支持'));
      L.push([String(idx + 1), 'p' + im.page, im.format, dim, color, filter, status].join(' | '));
    });
    L.push('');
    L.push('说明：');
    L.push('• JPEG（DCTDecode）为字节级无损提取；PNG / 灰度 / 索引色 / CMYK / 含透明(SMask) 尽力转存为 PNG。');
    L.push('• 不支持的格式（LZW / CCITT / JBIG2 / JPEG2000 等）仅在此列出，不写入压缩包，可用「PDF 转图片」逐页导出替代。');
    L.push('• 全程在本机完成，文件不上传。');
    return L.join('\n');
  }

  // ---------------- 书签/大纲：文本 <-> 树 互转 ----------------
  // 文本格式：每行一个「页号 | 标题」；可选「| 顶部mm | 左侧mm | 缩放」；行首每 2 空格为下一级。
  function parseOutline(text) {
    if (!text) return [];
    const lines = String(text).split('\n');
    const root = [];
    const stack = [{ level: -1, children: root }];
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const indent = (raw.match(/^[ \t]*/)[0] || '').replace(/\t/g, '  ').length;
      const level = Math.floor(indent / 2);
      const parts = raw.trim().split(/\s*[|｜]\s*/);
      const page = parseInt(parts[0], 10);
      if (!page || isNaN(page)) continue;
      const node = { title: (parts[1] || '').trim(), page, children: [] };
      if (parts[2] !== undefined && parts[2].trim() !== '') { const x = parseFloat(parts[2]); if (!isNaN(x)) node.top = x; }
      if (parts[3] !== undefined && parts[3].trim() !== '') { const x = parseFloat(parts[3]); if (!isNaN(x)) node.left = x; }
      if (parts[4] !== undefined && parts[4].trim() !== '') { const x = parseFloat(parts[4]); if (!isNaN(x)) node.zoom = x; }
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push({ level, children: node.children });
    }
    return root;
  }
  function serializeOutline(tree, level) {
    level = level || 0;
    let s = '';
    for (const n of (tree || [])) {
      let line = '  '.repeat(level) + (n.page || '') + ' | ' + (n.title || '');
      if (n.top != null || n.left != null || n.zoom != null) {
        line += ' | ' + (n.top != null ? n.top : '') + ' | ' + (n.left != null ? n.left : '') + ' | ' + (n.zoom != null ? n.zoom : '');
      }
      s += line + '\n';
      if (n.children && n.children.length) s += serializeOutline(n.children, level + 1);
    }
    return s;
  }
  function parseLabels(text) {
    if (!text) return [];
    const out = [];
    const lines = String(text).split('\n');
    const alias = { '十进制':'D','数字':'D','decimal':'D','小写罗马':'r','罗马小写':'r','roman':'r','大写罗马':'R','罗马大写':'R','小写字母':'a','字母小写':'a','alpha':'a','大写字母':'A','字母大写':'A','无':'','none':'','空':'' };
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const parts = raw.trim().split(/\s*[|｜]\s*/);
      const page = parseInt(parts[0], 10);
      if (!page || isNaN(page)) continue;
      let style = (parts[1] || '').trim();
      if (alias[style] !== undefined) style = alias[style];
      else if (!{ '':1, D:1, r:1, R:1, a:1, A:1 }.hasOwnProperty(style)) style = '';
      const prefix = (parts[2] || '').trim();
      let start = 1;
      if (parts[3] !== undefined && parts[3].trim() !== '') { const x = parseInt(parts[3], 10); if (!isNaN(x) && x >= 1) start = x; }
      out.push({ page, style, prefix, start });
    }
    return out;
  }
  function serializeLabels(labels) {
    if (!labels || !labels.length) return '';
    return labels.map((l) => (l.page || '') + ' | ' + (l.style || '') + ' | ' + (l.prefix || '') + ' | ' + (l.start || 1)).join('\n');
  }
  function formatLabelsReport(labels) {
    const L = [];
    L.push('═══ PDF 页面标签报告 ═══');
    if (!labels || !labels.length) { L.push('（无页面标签）'); return L.join('\n'); }
    const NAME = { '': '仅前缀（无数字）', D: '十进制 (1,2,3)', r: '小写罗马 (i,ii,iii)', R: '大写罗马 (I,II,III)', a: '小写字母 (a,b,c)', A: '大写字母 (A,B,C)' };
    L.push('共 ' + labels.length + ' 个区间：');
    L.push('');
    labels.forEach((l, i) => {
      let line = '[' + (i + 1) + '] 起始页 ' + l.page + '  →  样式：' + (NAME[l.style] || l.style);
      if (l.prefix) line += '  |  前缀：「' + l.prefix + '」';
      line += '  |  起始编号：' + (l.start || 1);
      L.push(line);
    });
    L.push('');
    L.push('说明：页面标签为 PDF 原生逻辑页码（阅读器导航栏显示），不影响页面内容，也不等同于「绘制页码水印」。');
    return L.join('\n');
  }
  function formatFormFieldsReport(fields) {
    const L = [];
    L.push('═══ PDF 表单域结构报告 ═══');
    L.push('共 ' + (fields ? fields.length : 0) + ' 个表单字段：');
    L.push('');
    const TYPE = { text: '文本', checkbox: '勾选框', radio: '单选', dropdown: '下拉' };
    if (!fields || !fields.length) { L.push('（无表单字段）'); return L.join('\n'); }
    fields.forEach((f, i) => {
      L.push('[' + (i + 1) + '] ' + (f.name || '(未命名)'));
      L.push('    类型：' + (TYPE[f.type] || f.type || '未知') + (f.page ? '    |    所在页：第 ' + f.page + ' 页' : ''));
      if (f.options && f.options.length) L.push('    可选项：' + f.options.join(' / '));
      let v = f.value;
      if (typeof v === 'boolean') v = v ? '已勾选' : '未勾选';
      else if (v == null) v = '（空）';
      L.push('    当前值：' + v);
      L.push('');
    });
    L.push('说明：本表由「导出表单域结构」生成，JSON 版（form-fields.json）字段名与字段类型与「填充表单」完全一致，可直接用于自动填表或字段核对。');
    return L.join('\n');
  }
  function formatImportReport(r, fileName) {
    const L = [];
    L.push('═══ 表单域反向导入填充报告 ═══');
    if (fileName) L.push('源文件：' + fileName);
    L.push('映射项总数：' + (r.total || 0));
    L.push('匹配到字段并写入：' + (r.matched || 0) + '（其中实际写入值 ' + (r.filled || 0) + ' 个，空值项 ' + (r.skippedEmpty ? r.skippedEmpty.length : 0) + ' 个已按清除/取消勾选处理）');
    L.push('映射中存在但 PDF 无此字段：' + ((r.missing && r.missing.length) || 0) + ' 个');
    L.push('');
    if (r.filled) {
      L.push('✔ 已写入值的字段：' + r.filled + ' 个');
    }
    if (r.skippedEmpty && r.skippedEmpty.length) {
      L.push('');
      L.push('空值项（按清除/取消勾选处理，未改动原值）：');
      r.skippedEmpty.forEach((n) => L.push('   · ' + n));
    }
    if (r.missing && r.missing.length) {
      L.push('');
      L.push('✘ 映射中存在但 PDF 找不到对应字段（已忽略）：');
      r.missing.forEach((n) => L.push('   · ' + n));
    }
    L.push('');
    L.push('说明：与「导出表单域结构」形成闭环——导出 form-fields.json 后改 value 再回灌即可批量填表；支持对象/数组/CSV 三种映射格式，中文值经原始 UTF-16 写入，由阅读器绘制外观。');
    return L.join('\n');
  }

  function handleFieldAction(action, formEl) {
    if (action === 'readOutline') return readOutlineInto(formEl);
    if (action === 'readMetadata') return readMetadataInto(formEl);
    if (action === 'readLabels') return readLabelsInto(formEl);
    if (action === 'readMapFile') return readMapFileInto(formEl);
  }
  async function readOutlineInto(formEl) {
    const file = state.files.file && state.files.file[0];
    if (!file) { toast('请先选择 PDF 文件', true); return; }
    try {
      toast('正在读取现有书签…');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const tree = await E.getOutline({ bytes });
      const ta = formEl.querySelector('[data-key="items"]');
      if (ta) ta.value = serializeOutline(tree);
      toast(tree.length ? '已读取现有书签' : '该文件暂无书签');
    } catch (e) { toast('读取失败：' + (e && e.message ? e.message : e), true); }
  }
  async function readLabelsInto(formEl) {
    const file = state.files.file && state.files.file[0];
    if (!file) { toast('请先选择 PDF 文件', true); return; }
    try {
      toast('正在读取现有标签…');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const labels = await E.getPageLabels({ bytes });
      const ta = formEl.querySelector('[data-key="items"]');
      if (ta) ta.value = serializeLabels(labels);
      toast(labels.length ? ('已读取 ' + labels.length + ' 组标签') : '该文件暂无页面标签');
    } catch (e) { toast('读取失败：' + (e && e.message ? e.message : e), true); }
  }
  async function readMapFileInto(formEl) {
    const file = state.files.mapfile && state.files.mapfile[0];
    if (!file) { toast('请先在「映射文件」处选择一份 JSON/CSV', true); return; }
    try {
      toast('正在读取映射文件…');
      const buf = new Uint8Array(await file.arrayBuffer());
      const text = new TextDecoder('utf-8').decode(buf);
      const ta = formEl.querySelector('[data-key="mapping"]');
      if (ta) ta.value = text;
      toast('已载入映射文件到文本框');
    } catch (e) { toast('读取失败：' + (e && e.message ? e.message : e), true); }
  }

  async function readMetadataInto(formEl) {
    const file = state.files.file && state.files.file[0];
    if (!file) { toast('请先选择 PDF 文件', true); return; }
    try {
      toast('正在读取现有元数据…');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const m = await E.getMetadata({ bytes });
      const setF = (k, val) => { const el = formEl.querySelector(`[data-key="${k}"]`); if (el) el.value = val || ''; };
      setF('title', m.title); setF('author', m.author); setF('subject', m.subject);
      setF('keywords', m.keywords); setF('creator', m.creator); setF('producer', m.producer);
      toast('已读取现有元数据');
    } catch (e) { toast('读取失败：' + (e && e.message ? e.message : e), true); }
  }

  function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; }

  function toast(msg, isErr) {
    const t = PDF$('#toast');
    t.textContent = msg; t.hidden = false; t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 3200);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => {
        const res = r.result;
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function downloadBlob(name, blob) {
    // iOS 的 WKWebView 与 Android 的 WebView 都不稳定支持 a.download + blob 直接存盘
    // （Android 常把文件名改成 download 或静默失败），统一改用 Capacitor 写文件 + 系统分享面板。
    // 仅在 iOS / Android 原生平台激活；网页 / Electron 仍走原生 blob 下载，行为不变。
    const Cap = window.Capacitor;
    const platform = Cap && Cap.getPlatform ? Cap.getPlatform() : null;
    if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() &&
        Cap.Plugins && Cap.Plugins.Filesystem &&
        (platform === 'ios' || platform === 'android')) {
      const Filesystem = Cap.Plugins.Filesystem;
      const Share = Cap.Plugins.Share;
      blobToBase64(blob).then(async (b64) => {
        await Filesystem.writeFile({ path: name, data: b64, directory: Filesystem.Directory.Documents, recursive: true });
        const uri = await Filesystem.getUri({ path: name, directory: Filesystem.Directory.Documents });
        if (Share) await Share.share({ title: name, path: uri.uri, type: 'application/pdf' });
        else toast(platform === 'ios' ? '已保存到「我的 iPhone › 绿角犀PDF」' : '已通过系统分享面板保存');
        recordRecentDownload(name, true); // 已写入 Documents，可回读
      }).catch((e) => { console.warn('iOS 原生保存失败，回退', e); fallbackDownload(name, blob); });
      return;
    }
    // 华为 HarmonyOS：通过 javaScriptProxy 暴露的 window.__harmonyBridge.save(base64, name) 保存
    if (window.__harmonyBridge && window.__harmonyBridge.save) {
      blobToBase64(blob).then((b64) => {
        window.__harmonyBridge.save(b64, name);
        recordRecentDownload(name, false); // 本端暂无读回桥，仅记录
      }).catch((e) => { console.warn('HarmonyOS 原生保存失败，回退', e); fallbackDownload(name, blob); });
      return;
    }
    fallbackDownload(name, blob);
    recordRecentDownload(name, false); // 网页/桌面回退下载：仅记录，不可回读
  }

  function fallbackDownload(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ---------------- 任务进程管理 ---------------- */
  const Tasks = {
    seq: 0,
    items: [],
    add(title) {
      const id = ++this.seq;
      const t = { id, title, status: 'running', done: 0, total: 0, phase: '', time: new Date(), results: null, message: '' };
      this.items.unshift(t);
      this.render();
      openTaskPanel();
      return id;
    },
    update(id, info) {
      const t = this.items.find((x) => x.id === id);
      if (!t) return;
      if (info.done != null) t.done = info.done;
      if (info.total != null) t.total = info.total;
      if (info.phase != null) t.phase = info.phase;
      this.render();
    },
    finish(id, success, results, message) {
      const t = this.items.find((x) => x.id === id);
      if (!t) return;
      t.status = success ? 'done' : 'error';
      t.results = results || null;
      t.message = message || '';
      t.done = t.total || 1;
      this.render();
      // 成功后若用户未手动打开抽屉，则自动收起，避免遮挡右侧结果面板
      if (success && !taskPanelUserOpened) {
        taskPanel.classList.remove('open');
        taskPanel.hidden = true;
      }
    },
    render() {
      taskList.innerHTML = '';
      taskCount.textContent = String(this.items.length);
      taskEmpty.hidden = this.items.length > 0;
      this.items.forEach((t) => {
        const card = document.createElement('div');
        card.className = 'task-card ' + t.status;
        const head = document.createElement('div'); head.className = 'task-head';
        const name = document.createElement('span'); name.className = 'task-name'; name.textContent = t.title;
        const badge = document.createElement('span');
        badge.className = 'task-badge ' + t.status;
        badge.textContent = t.status === 'running' ? '进行中' : t.status === 'done' ? '完成' : '失败';
        head.appendChild(name); head.appendChild(badge);
        const meta = document.createElement('div'); meta.className = 'task-meta';
        const time = t.time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        let sub = time;
        if (t.total) sub += ' · ' + t.done + '/' + t.total;
        if (t.phase && t.status === 'running') sub += ' · ' + t.phase;
        meta.textContent = sub;
        card.appendChild(head); card.appendChild(meta);
        if (t.status === 'running' && t.total) {
          const bar = document.createElement('div'); bar.className = 'task-bar';
          const fill = document.createElement('div'); fill.className = 'task-fill';
          fill.style.width = (t.done / t.total * 100) + '%';
          bar.appendChild(fill); card.appendChild(bar);
        }
        if (t.status === 'done' && t.results) {
          const dls = document.createElement('div'); dls.className = 'task-dls';
          t.results.forEach((r) => {
            const b = document.createElement('button'); b.className = 'dl'; b.textContent = r.name;
            b.onclick = () => downloadBlob(r.name, r.blob);
            dls.appendChild(b);
          });
          card.appendChild(dls);
        }
        if (t.message && t.status !== 'running') {
          const m = document.createElement('div'); m.className = 'task-msg'; m.textContent = t.message;
          card.appendChild(m);
        }
        taskList.appendChild(card);
      });
    },
  };

  function makeProgress(taskId) {
    return ({ done, total, phase }) => {
      Tasks.update(taskId, { done, total, phase });
      if (total && total > 0) {
        const pct = Math.round((done / total) * 100);
        runProgress.classList.remove('indeterminate');
        progFill.style.width = pct + '%';
        progText.textContent = (phase || '处理中') + ' ' + done + '/' + total + ' (' + pct + '%)';
      } else {
        runProgress.classList.add('indeterminate');
        progText.textContent = (phase || '处理中') + ' …';
      }
    };
  }

  function showRunProgress(show) {
    runProgress.hidden = !show;
    if (show) {
      runProgress.classList.add('indeterminate');
      progFill.style.width = '';
      progText.textContent = '准备中…';
    }
  }

  let taskPanelUserOpened = false;
  function toggleTaskPanel() {
    const open = taskPanel.classList.toggle('open');
    taskPanel.hidden = !open;
    taskPanelUserOpened = open;
  }

  function openTaskPanel() {
    taskPanel.classList.add('open');
    taskPanel.hidden = false;
  }

  /* ---------------- 导航：侧边栏 + 首页 + 工具页 ---------------- */
  function buildSidebar() {
    sidebar.innerHTML = '';
    CATEGORIES.forEach((cat) => {
      const group = document.createElement('div'); group.className = 'nav-group';
      const titleEl2 = document.createElement('div'); titleEl2.className = 'ng-title';
      titleEl2.appendChild(iconSvg(cat.icon));
      const lbl = document.createElement('span'); lbl.textContent = cat.title;
      titleEl2.appendChild(lbl);
      group.appendChild(titleEl2);
      cat.tools.forEach((tk) => {
        const b = document.createElement('button'); b.className = 'nav-item'; b.dataset.op = tk;
        b.appendChild(iconSvg(tk));
        const span = document.createElement('span'); span.textContent = OPS[tk].title;
        b.appendChild(span);
        b.addEventListener('click', () => renderOp(tk));
        group.appendChild(b);
      });
      sidebar.appendChild(group);
    });
    // 底部固定入口：设置（独立于工具分类，始终可见）
    const setGroup = document.createElement('div'); setGroup.className = 'nav-group';
    const setBtn = document.createElement('button'); setBtn.className = 'nav-item'; setBtn.dataset.op = 'settings';
    setBtn.appendChild(iconSvg('settings'));
    const setSpan = document.createElement('span'); setSpan.textContent = '设置';
    setBtn.appendChild(setSpan);
    setBtn.addEventListener('click', renderSettings);
    setGroup.appendChild(setBtn);
    sidebar.appendChild(setGroup);
  }

  function buildHome() {
    homePanel.innerHTML = '';
    const head = document.createElement('div'); head.className = 'home-head';
    head.innerHTML = '<h2>PDF 工具箱</h2><p>选择一项功能开始 · 全部在你的设备本地完成，文件不会离开本机</p>';
    homePanel.appendChild(head);
    // 最近文件区（动态刷新）
    const rec = document.createElement('div'); rec.className = 'home-recent'; rec.id = 'homeRecents';
    homePanel.appendChild(rec);
    renderRecents();
    CATEGORIES.forEach((cat) => {
      const block = document.createElement('div'); block.className = 'cat-block';
      const h3 = document.createElement('h3');
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = CAT_COLOR[cat.key];
      h3.appendChild(dot); h3.appendChild(document.createTextNode(cat.title));
      block.appendChild(h3);
      const grid = document.createElement('div'); grid.className = 'tool-grid';
      cat.tools.forEach((tk) => {
        const card = document.createElement('button'); card.className = 'tool-card'; card.dataset.op = tk;
        const icon = document.createElement('div'); icon.className = 'tool-icon'; icon.style.background = CAT_COLOR[cat.key];
        icon.appendChild(iconSvg(tk));
        const name = document.createElement('div'); name.className = 'tool-name'; name.textContent = OPS[tk].title;
        const desc = document.createElement('div'); desc.className = 'tool-desc'; desc.textContent = OPS[tk].desc;
        card.appendChild(icon); card.appendChild(name); card.appendChild(desc);
        card.addEventListener('click', () => renderOp(tk));
        grid.appendChild(card);
      });
      block.appendChild(grid); homePanel.appendChild(block);
    });
  }

  function setBreadcrumb(title) {
    breadcrumb.querySelectorAll('.crumb-dyn').forEach((n) => n.remove());
    const sep = document.createElement('span'); sep.className = 'sep crumb-dyn'; sep.textContent = '›';
    const cur = document.createElement('span'); cur.className = 'crumb-cur crumb-dyn'; cur.textContent = title;
    breadcrumb.appendChild(sep); breadcrumb.appendChild(cur);
  }
  function clearBreadcrumb() { breadcrumb.querySelectorAll('.crumb-dyn').forEach((n) => n.remove()); }

  function showHome() {
    renderRecents(); // 回到首页时刷新最近文件（可能刚有新产出）
    homePanel.hidden = false; opPanel.hidden = true;
    sidebar.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    clearBreadcrumb();
    previewPanel.hidden = true; resultPanel.hidden = true; runProgress.hidden = true;
    state.op = null; state.files = {}; state.pdfDoc = null; state.currentPage = 1; state.formValues = {};
  }

  /* ---------------- 最近文件 + 设置（PDFStore 持久化层） ---------------- */

  // 把最近条目的毫秒时间戳格式化为易读文本（今天→HH:mm；今年→M月d日 HH:mm；跨年→带年份）。
  function fmtRecTime(ts) {
    if (!ts) return '';
    const d = new Date(ts); const now = new Date();
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    const sameYear = d.getFullYear() === now.getFullYear();
    return (sameYear ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  // 记录一条「下载/保存」产物进最近文件；移动端写入了 Documents 所以可回读（reopenable）。
  function recordRecentDownload(name, reopenable) {
    try {
      PDFStore.recent.add({ name: name || 'output.pdf', path: reopenable ? (name || 'output.pdf') : null, reopenable: !!reopenable });
      renderRecents();
    } catch (e) { console.warn('记录最近文件失败', e); }
  }

  // 渲染首页「最近文件」列表（含清空入口与空态）。
  function renderRecents() {
    const holder = document.getElementById('homeRecents');
    if (!holder) return;
    const items = PDFStore.recent.list();
    holder.innerHTML = '';
    const headRow = document.createElement('div'); headRow.className = 'recent-head';
    const t = document.createElement('span'); t.textContent = '最近文件';
    headRow.appendChild(t);
    if (items.length) {
      const clr = document.createElement('button'); clr.className = 'btn ghost small'; clr.textContent = '清空';
      clr.onclick = () => { PDFStore.recent.clear(); renderRecents(); toast('已清空最近文件'); };
      headRow.appendChild(clr);
    }
    holder.appendChild(headRow);
    if (!items.length) {
      const e = document.createElement('p'); e.className = 'recent-empty muted';
      e.textContent = '还没有最近文件。在桌面双击 PDF，或用工具产出文件后，会显示在这里。';
      holder.appendChild(e);
      return;
    }
    const listEl = document.createElement('div'); listEl.className = 'recent-list';
    items.forEach((it) => {
      const row = document.createElement('button'); row.className = 'recent-item'; row.type = 'button';
      const name = document.createElement('span'); name.className = 'r-name'; name.textContent = it.name;
      const time = document.createElement('span'); time.className = 'r-time'; time.textContent = fmtRecTime(it.time);
      row.appendChild(name); row.appendChild(time);
      row.onclick = () => reopenRecent(it);
      listEl.appendChild(row);
    });
    holder.appendChild(listEl);
  }

  // 点击最近文件：按端选择读回通道重新打开。
  function reopenRecent(it) {
    if (!it || !it.reopenable || !it.path) { toast('该文件已下载或已不在本端可读范围，无法直接重新打开'); return; }
    // 桌面 Electron：渲染端无法直接访问文件系统，走主进程重读该路径
    if (window.electronAPI && window.electronAPI.openPdf) { window.electronAPI.openPdf(it.path); return; }
    // 移动端（iOS/Android）：从 Documents 读回后注入预览
    const Cap = window.Capacitor;
    if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.Filesystem) {
      const Filesystem = Cap.Plugins.Filesystem;
      Filesystem.readFile({ path: it.path, directory: Filesystem.Directory.Documents })
        .then((res) => { window.__ghOpenPdfFromSystem(it.name, res.data, it.path); })
        .catch((e) => { console.error('reopen recent failed', e); toast('读取最近文件失败', true); });
      return;
    }
    // 其余（纯网页 / HarmonyOS）：无读回通道，诚实提示
    toast('该文件无法在本端直接重新打开');
  }

  // 设置面板：复用 opPanel 壳，非某个 PDF 工具，仅承载偏好控件。
  function renderSettings() {
    homePanel.hidden = true; opPanel.hidden = false;
    opGlyph.style.background = '#5b5f66'; opGlyph.innerHTML = '';
    opGlyph.appendChild(iconSvg('settings'));
    titleEl.textContent = '设置'; descEl.textContent = '偏好与本地数据管理（仅本地存储，不会上传）';
    form.innerHTML = ''; resultPanel.hidden = true; resultList.innerHTML = '';
    sidebar.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    const si = sidebar.querySelector('.nav-item[data-op="settings"]'); if (si) si.classList.add('active');
    setBreadcrumb('设置');
    previewPanel.hidden = true; runProgress.hidden = true; state.op = null;

    // 最近文件条数上限：改动立即截断并持久化
    const fMax = document.createElement('div'); fMax.className = 'field';
    const lMax = document.createElement('label'); lMax.textContent = '最近文件条数上限';
    const inMax = document.createElement('input'); inMax.type = 'number'; inMax.min = 1; inMax.max = 20; inMax.value = PDFStore.settings.get('recentsMax');
    inMax.onchange = () => {
      const v = Math.max(1, Math.min(20, Math.floor(Number(inMax.value) || 12)));
      inMax.value = v;
      PDFStore.settings.set('recentsMax', v);
      renderRecents();
      toast('已保存，最近列表已按新上限截断');
    };
    fMax.appendChild(lMax); fMax.appendChild(inMax); form.appendChild(fMax);

    // 清空最近文件
    const fClr = document.createElement('div'); fClr.className = 'field';
    const bClr = document.createElement('button'); bClr.type = 'button'; bClr.className = 'btn ghost';
    bClr.textContent = '清空最近文件';
    bClr.onclick = () => { PDFStore.recent.clear(); renderRecents(); toast('已清空最近文件'); };
    fClr.appendChild(bClr); form.appendChild(fClr);
  }

  function renderOp(opKey) {
    const op = OPS[opKey];
    if (!op) return;
    state.op = op; state.opKey = opKey; state.files = {}; state.formValues = {};
    pickCanvases = [];
    Object.keys(pagePickers).forEach((k) => delete pagePickers[k]);
    homePanel.hidden = true; opPanel.hidden = false;
    const col = catOf(opKey);
    opGlyph.style.background = col; opGlyph.innerHTML = ''; opGlyph.appendChild(iconSvg(opKey));
    titleEl.textContent = op.title; descEl.textContent = op.desc;
    form.innerHTML = ''; resultPanel.hidden = true; resultList.innerHTML = '';
    op.fields.forEach((f) => form.appendChild(buildField(f)));
    const actions = document.createElement('div'); actions.className = 'actions';
    const runBtn = document.createElement('button'); runBtn.className = 'btn primary'; runBtn.type = 'button'; runBtn.textContent = '开始处理';
    runBtn.onclick = () => runOp(op); actions.appendChild(runBtn); form.appendChild(actions);
    sidebar.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.op === opKey));
    setBreadcrumb(op.title);
    previewPanel.hidden = true; runProgress.hidden = true;
    if (op.afterRender) op.afterRender(form);
  }

  /* ---------------- 表单渲染 ---------------- */
  function buildField(f) {
    if (f.type === 'file') return buildFileField(f);
    if (f.type === 'dynform') {
      const wrap = document.createElement('div'); wrap.className = 'field full';
      const cont = document.createElement('div'); cont.id = 'dynFormFields';
      wrap.appendChild(cont);
      return wrap;
    }
    if (f.type === 'pickcanvas') return buildPickCanvas(f);
    if (f.type === 'drawcanvas') return buildDrawCanvas(f);
    if (f.type === 'hidden') { const i = document.createElement('input'); i.type = 'hidden'; i.dataset.key = f.key; if (f.value != null) i.value = f.value; return i; }
    if (f.type === 'pagepicker') { const w = buildPagePicker(f); pagePickers[f.key] = w; return w; }
    if (f.type === 'button') {
      const w = document.createElement('div'); w.className = 'field';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.textContent = f.label || '按钮';
      b.onclick = () => handleFieldAction(f.action, form);
      w.appendChild(b); return w;
    }
    const wrap = document.createElement('div');
    wrap.className = 'field' + (f.type === 'checks' ? ' full' : '');
    if (f.group) wrap.dataset.group = f.group;
    const label = document.createElement('label'); label.textContent = f.label; wrap.appendChild(label);

    if (f.type === 'checks') {
      const box = document.createElement('div'); box.style.display = 'flex'; box.style.gap = '1rem'; box.style.flexWrap = 'wrap';
      f.options.forEach((o) => {
        const id = `chk_${f.key}_${o.key}`;
        const l = document.createElement('label'); l.className = 'field row'; l.style.margin = '0';
        const c = document.createElement('input'); c.type = 'checkbox'; c.id = id; c.checked = f.checked && f.checked.includes(o.key);
        l.appendChild(c); l.appendChild(document.createTextNode(o.label)); box.appendChild(l);
      });
      wrap.appendChild(box);
    } else if (f.type === 'select') {
      const sel = document.createElement('select');
      f.options.forEach((o) => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; sel.appendChild(op); });
      if (f.value) sel.value = f.value;
      sel.dataset.key = f.key; wrap.appendChild(sel);
    } else if (f.type === 'range') {
      const r = document.createElement('input'); r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.value = f.value; r.dataset.key = f.key;
      const val = document.createElement('span'); val.className = 'hint'; val.textContent = f.value;
      r.oninput = () => (val.textContent = r.value);
      wrap.appendChild(r); wrap.appendChild(val);
    } else {
      const inp = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
      if (f.type !== 'textarea') inp.type = (f.type === 'text' || f.type === 'password' || f.type === 'number' || f.type === 'color') ? f.type : 'text';
      if (f.value != null) inp.value = f.value;
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.readonly) inp.disabled = true;
      inp.dataset.key = f.key; wrap.appendChild(inp);
    }
    if (f.hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = f.hint; wrap.appendChild(h); }
    return wrap;
  }

  const fileRefreshers = {}; // key -> 刷新该文件字段（用于链式处理预填）

  /* 交互式预览画布：在 PDF 首页上可视化选择裁剪框 / 拖拽定位点
   * mode: 'crop'  → 拖拽矩形，换算成 top/right/bottom/left(mm) 回填输入框
   *       'point' → 点击/拖拽落点，换算成 x/y(mm，左上原点) 回填输入框
   */
  function buildPickCanvas(f) {
    const mode = f.mode || 'crop';
    const wrap = document.createElement('div'); wrap.className = 'field full';
    const label = document.createElement('label');
    label.textContent = f.label || (mode === 'crop' ? '在预览上拖拽选择「保留区域」'
      : mode === 'resize' ? '预览：红框表示「目标尺寸」，随下方设置实时更新'
      : '在预览上点击/拖拽设置放置位置');
    wrap.appendChild(label);

    const box = document.createElement('div'); box.className = 'pc-box';
    const canvas = document.createElement('canvas'); canvas.className = 'pc-canvas';
    const overlay = document.createElement('div'); overlay.className = 'pc-overlay';
    const sel = document.createElement('div'); sel.className = 'pc-sel'; sel.hidden = true;
    const marker = document.createElement('div'); marker.className = 'pc-marker'; marker.hidden = true;
    overlay.appendChild(sel); overlay.appendChild(marker);
    box.appendChild(canvas); box.appendChild(overlay);
    const hint = document.createElement('div'); hint.className = 'pc-hint'; hint.textContent = '请先选择 PDF 文件';
    wrap.appendChild(box); wrap.appendChild(hint);

    let pagePtW = 0, pagePtH = 0, scale = 1, ready = false, curPage = null, curR = null;
    const clampMM = (v) => Math.max(0, Math.round(v * 10) / 10);

    function numInput(key) { return form.querySelector(`input[data-key="${key}"]`); }

    function setSelFromInputs() {
      if (mode !== 'crop' || !ready) return;
      const top = Number((numInput('top') || {}).value) || 0;
      const bottom = Number((numInput('bottom') || {}).value) || 0;
      const left = Number((numInput('left') || {}).value) || 0;
      const right = Number((numInput('right') || {}).value) || 0;
      const x1 = left * PT_PER_MM * scale, y1 = top * PT_PER_MM * scale;
      const x2 = (pagePtW - right * PT_PER_MM) * scale, y2 = (pagePtH - bottom * PT_PER_MM) * scale;
      sel.style.left = x1 + 'px'; sel.style.top = y1 + 'px';
      sel.style.width = Math.max(0, x2 - x1) + 'px'; sel.style.height = Math.max(0, y2 - y1) + 'px';
      sel.hidden = false;
    }

    function writeCropFromSel() {
      const x1 = parseFloat(sel.style.left) || 0, y1 = parseFloat(sel.style.top) || 0;
      const x2 = x1 + (parseFloat(sel.style.width) || 0), y2 = y1 + (parseFloat(sel.style.height) || 0);
      const top = clampMM(y1 / scale / PT_PER_MM);
      const left = clampMM(x1 / scale / PT_PER_MM);
      const right = clampMM((pagePtW * scale - x2) / scale / PT_PER_MM);
      const bottom = clampMM((pagePtH * scale - y2) / scale / PT_PER_MM);
      if (numInput('top')) numInput('top').value = top;
      if (numInput('bottom')) numInput('bottom').value = bottom;
      if (numInput('left')) numInput('left').value = left;
      if (numInput('right')) numInput('right').value = right;
    }

    function writePointFromMarker() {
      const mx = parseFloat(marker.style.left) || 0, my = parseFloat(marker.style.top) || 0;
      const x = clampMM(mx / scale / PT_PER_MM);
      const y = clampMM(my / scale / PT_PER_MM);
      if (numInput('x')) numInput('x').value = x;
      if (numInput('y')) numInput('y').value = y;
    }

    // 拖拽交互
    let dragging = false, sx = 0, sy = 0;
    function localXY(e) {
      const r = overlay.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x: Math.max(0, Math.min(r.width, cx)), y: Math.max(0, Math.min(r.height, cy)) };
    }
    overlay.addEventListener('mousedown', (e) => {
      if (!ready) return;
      dragging = true; const p = localXY(e);
      if (mode === 'crop') {
        sx = p.x; sy = p.y; sel.style.left = p.x + 'px'; sel.style.top = p.y + 'px';
        sel.style.width = '0px'; sel.style.height = '0px'; sel.hidden = false;
      } else {
        marker.style.left = p.x + 'px'; marker.style.top = p.y + 'px'; marker.hidden = false;
      }
      e.preventDefault();
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging || !ready) return;
      const p = localXY(e);
      if (mode === 'crop') {
        const x1 = Math.min(sx, p.x), y1 = Math.min(sy, p.y);
        sel.style.left = x1 + 'px'; sel.style.top = y1 + 'px';
        sel.style.width = Math.abs(p.x - sx) + 'px'; sel.style.height = Math.abs(p.y - sy) + 'px';
      } else {
        marker.style.left = p.x + 'px'; marker.style.top = p.y + 'px';
      }
    });
    overlay.addEventListener('mouseup', () => {
      if (!dragging) return; dragging = false;
      if (mode === 'crop') writeCropFromSel(); else writePointFromMarker();
    });
    overlay.addEventListener('mouseleave', () => { if (dragging) { dragging = false; if (mode === 'crop') writeCropFromSel(); else writePointFromMarker(); } });
    // 触摸支持
    overlay.addEventListener('touchstart', (e) => { overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { passive: true });
    overlay.addEventListener('touchmove', (e) => { overlay.dispatchEvent(new MouseEvent('mousemove', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { passive: true });
    overlay.addEventListener('touchend', () => { overlay.dispatchEvent(new MouseEvent('mouseup')); });

    // 改尺寸预览：在首页背景上叠加「目标尺寸」红框（按同一显示比例）
    function drawTarget(page, r) {
      const sizeSel = form.querySelector('select[data-key="size"]');
      const fitSel = form.querySelector('select[data-key="fit"]');
      const wInp = numInput('width'), hInp = numInput('height');
      let tw, th;
      if (sizeSel && sizeSel.value === 'CUSTOM') {
        tw = (Number(wInp && wInp.value) || 210) * PT_PER_MM;
        th = (Number(hInp && hInp.value) || 297) * PT_PER_MM;
      } else {
        const s = (E.PAGE_SIZES && E.PAGE_SIZES[sizeSel ? sizeSel.value : 'A4']) || (E.PAGE_SIZES && E.PAGE_SIZES.A4) || [595, 842];
        tw = s[0]; th = s[1];
      }
      const fit = fitSel ? fitSel.value : 'contain';
      const ctx = canvas.getContext('2d');
      page.render({ canvasContext: ctx, viewport: r }).promise.then(() => {
        const rw = tw * scale, rh = th * scale;
        ctx.save();
        ctx.fillStyle = 'rgba(225,29,143,0.08)'; ctx.fillRect(0, 0, rw, rh);
        ctx.strokeStyle = '#e11d8f'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(0, 0, rw, rh);
        ctx.setLineDash([]); ctx.fillStyle = '#e11d8f'; ctx.font = '12px sans-serif';
        const mmw = (tw / PT_PER_MM).toFixed(0), mmh = (th / PT_PER_MM).toFixed(0);
        ctx.fillText(`目标 ${mmw}×${mmh}mm · ${fit}`, 6, 16);
        ctx.restore();
      }).catch(e => console.error("[PdfApp] 渲染预览失败:", e));
    }

    async function init(file) {
      if (!file) return;
      hint.textContent = '渲染预览中…';
      try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        const page = await pdf.getPage(1);
        const vp1 = page.getViewport({ scale: 1 });
        pagePtW = vp1.width; pagePtH = vp1.height;
        scale = Math.min(1.4, 360 / vp1.width);
        const r = page.getViewport({ scale });
        canvas.width = r.width; canvas.height = r.height;
        overlay.style.width = r.width + 'px'; overlay.style.height = r.height + 'px';
        sel.hidden = true; marker.hidden = true;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: r }).promise;
        ready = true; curPage = page; curR = r;
        if (mode === 'resize') {
          drawTarget(page, r);
          hint.textContent = '✓ 预览首页 · 红框为「目标尺寸」';
          // 尺寸/适配/自定义变更时刷新红框
          ['size', 'fit', 'width', 'height'].forEach((k) => {
            const el = form.querySelector(`[data-key="${k}"]`);
            if (!el) return;
            el.addEventListener('change', () => drawTarget(page, r));
            if (k === 'width' || k === 'height') el.addEventListener('input', () => drawTarget(page, r));
          });
        } else if (mode === 'crop') {
          setSelFromInputs();
          hint.textContent = '✓ 已加载首页 · 拖拽选择保留区域';
        } else { // point
          const x = (numInput('x') ? Number(numInput('x').value) : 20) * PT_PER_MM * scale;
          const y = (numInput('y') ? Number(numInput('y').value) : 20) * PT_PER_MM * scale;
          marker.style.left = Math.min(x, r.width) + 'px'; marker.style.top = Math.min(y, r.height) + 'px'; marker.hidden = false;
          hint.textContent = '✓ 已加载首页 · 点击/拖拽设置位置';
        }
      } catch (e) { hint.textContent = '预览渲染失败'; }
    }

    // 非 crop 模式下，若用户手动改了 x/y 输入框，同步落点
    if (mode === 'point') {
      ['x', 'y'].forEach((k) => {
        const inp = numInput(k);
        if (inp) inp.addEventListener('input', () => {
          if (!ready) return;
          const x = (numInput('x') ? Number(numInput('x').value) : 20) * PT_PER_MM * scale;
          const y = (numInput('y') ? Number(numInput('y').value) : 20) * PT_PER_MM * scale;
          marker.style.left = Math.min(x, canvas.width) + 'px'; marker.style.top = Math.min(y, canvas.height) + 'px';
        });
      });
    }

    wrap._init = init;
    pickCanvases.push(wrap);
    return wrap;
  }

  /* 交互式绘图画布：在所选页面预览上绘制矢量注释
   * mode: 'rect'  → 拖拽矩形，输出 x0,y0(左上) x1,y1(右下)（mm，左上原点）
   *       'arrow' → 拖拽箭头，输出 x0,y0(起点) x1,y1(终点)
   *       'ink'   → 自由绘制，输出 points: [[x,y],...]（mm，左上原点）
   * 坐标经隐藏 input[data-key] 回填，run() 通过 collectValues 读取。
   */
  function buildDrawCanvas(f) {
    const mode = f.mode || 'rect';
    const wrap = document.createElement('div'); wrap.className = 'field full';
    const label = document.createElement('label'); label.textContent = f.label || '在预览上拖拽绘制标注'; wrap.appendChild(label);

    const box = document.createElement('div'); box.className = 'pc-box';
    const canvas = document.createElement('canvas'); canvas.className = 'pc-canvas';
    const overlay = document.createElement('div'); overlay.className = 'pc-overlay';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'pc-svg');
    overlay.appendChild(svg);
    box.appendChild(canvas); box.appendChild(overlay);
    const hint = document.createElement('div'); hint.className = 'pc-hint'; hint.textContent = '请先选择 PDF 文件';
    wrap.appendChild(box); wrap.appendChild(hint);

    // 隐藏坐标输入（优先用表单内已声明的，否则自建）
    const keys = mode === 'ink' ? ['points'] : ['x0', 'y0', 'x1', 'y1'];
    const hidden = {};
    keys.forEach((k) => {
      let i = form.querySelector('input[data-key="' + k + '"]');
      if (!i) { i = document.createElement('input'); i.type = 'hidden'; i.dataset.key = k; wrap.appendChild(i); }
      hidden[k] = i;
    });

    let scale = 1, ready = false, pdfDoc = null, curPageNo = 1;
    const clampMM = (v) => Math.max(0, Math.round(v * 10) / 10);
    const SVGNS = 'http://www.w3.org/2000/svg';
    const pageInput = () => form.querySelector('input[data-key="page"]');

    function setHint(t) { hint.textContent = t; }
    function toMM(px, py) { return { x: clampMM(px / scale / PT_PER_MM), y: clampMM(py / scale / PT_PER_MM) }; }
    function clearSVG() { while (svg.firstChild) svg.removeChild(svg.firstChild); }
    function setSVGSize(w, h) { svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); }

    function addRectShape(x1, y1, x2, y2) {
      const el = document.createElementNS(SVGNS, 'rect');
      el.setAttribute('x', Math.min(x1, x2)); el.setAttribute('y', Math.min(y1, y2));
      el.setAttribute('width', Math.abs(x2 - x1)); el.setAttribute('height', Math.abs(y2 - y1));
      el.setAttribute('fill', 'rgba(229,57,53,0.16)'); el.setAttribute('stroke', '#e53935'); el.setAttribute('stroke-width', '2');
      svg.appendChild(el);
    }
    function addArrowShape(ax, ay, bx, by) {
      const mk = (x1, y1, x2, y2) => { const l = document.createElementNS(SVGNS, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); l.setAttribute('stroke', '#e53935'); l.setAttribute('stroke-width', '2'); svg.appendChild(l); };
      mk(ax, ay, bx, by);
      const ang = Math.atan2(by - ay, bx - ax), len = 12;
      [ang + Math.PI - 0.4, ang + Math.PI + 0.4].forEach((ag) => mk(bx, by, bx + len * Math.cos(ag), by + len * Math.sin(ag)));
    }
    function addInkShape(pts) {
      const el = document.createElementNS(SVGNS, 'polyline');
      el.setAttribute('points', pts.map((p) => p.x + ',' + p.y).join(' '));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', '#e53935'); el.setAttribute('stroke-width', '2');
      svg.appendChild(el);
    }
    function renderLive() {
      clearSVG();
      if (mode === 'rect' && dragging) { const r = rectFromDrag(); addRectShape(r.x1, r.y1, r.x2, r.y2); }
      else if (mode === 'arrow' && dragging) { addArrowShape(sx, sy, ex, ey); }
      else if (mode === 'ink' && inkPts.length) { addInkShape(inkPts); }
    }
    function rectFromDrag() { return { x1: Math.min(sx, ex), y1: Math.min(sy, ey), x2: Math.max(sx, ex), y2: Math.max(sy, ey) }; }

    let dragging = false, sx = 0, sy = 0, ex = 0, ey = 0, inkPts = [];
    function localXY(e) {
      const r = overlay.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x: Math.max(0, Math.min(r.width, cx)), y: Math.max(0, Math.min(r.height, cy)) };
    }
    overlay.addEventListener('mousedown', (e) => {
      if (!ready) return; dragging = true; const p = localXY(e);
      sx = p.x; sy = p.y; ex = p.x; ey = p.y; if (mode === 'ink') inkPts = [p]; e.preventDefault();
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging || !ready) return; const p = localXY(e);
      if (mode === 'ink') inkPts.push(p); else { ex = p.x; ey = p.y; } renderLive();
    });
    function finishDrag() {
      if (!dragging) return; dragging = false;
      if (mode === 'rect') {
        const r = rectFromDrag(); const a = toMM(r.x1, r.y1), b = toMM(r.x2, r.y2);
        hidden.x0.value = a.x; hidden.y0.value = a.y; hidden.x1.value = b.x; hidden.y1.value = b.y;
        setHint('已绘制矩形 @ 第' + curPageNo + '页 · (' + a.x + ',' + a.y + ')→(' + b.x + ',' + b.y + ') mm');
      } else if (mode === 'arrow') {
        const a = toMM(sx, sy), b = toMM(ex, ey);
        hidden.x0.value = a.x; hidden.y0.value = a.y; hidden.x1.value = b.x; hidden.y1.value = b.y;
        setHint('已绘制箭头 @ 第' + curPageNo + '页 · 起点(' + a.x + ',' + a.y + ') 终点(' + b.x + ',' + b.y + ')');
      } else if (mode === 'ink') {
        const pts = inkPts.map((p) => { const m = toMM(p.x, p.y); return [m.x, m.y]; });
        hidden.points.value = JSON.stringify(pts);
        setHint('已绘制手绘线 @ 第' + curPageNo + '页 · ' + pts.length + ' 个节点');
      }
    }
    overlay.addEventListener('mouseup', finishDrag);
    overlay.addEventListener('mouseleave', () => { if (dragging) finishDrag(); });
    overlay.addEventListener('touchstart', (e) => { overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { passive: true });
    overlay.addEventListener('touchmove', (e) => { overlay.dispatchEvent(new MouseEvent('mousemove', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { passive: true });
    overlay.addEventListener('touchend', () => { overlay.dispatchEvent(new MouseEvent('mouseup')); });

    async function renderPage(no) {
      if (!pdfDoc || no < 1 || no > pdfDoc.numPages) return;
      const page = await pdfDoc.getPage(no);
      const r = page.getViewport({ scale });
      canvas.width = r.width; canvas.height = r.height;
      overlay.style.width = r.width + 'px'; overlay.style.height = r.height + 'px';
      setSVGSize(r.width, r.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: r }).promise;
      curPageNo = no; clearSVG();
      setHint('✓ 已加载第 ' + no + ' 页 · 拖拽绘制' + (mode === 'rect' ? '矩形' : mode === 'arrow' ? '箭头' : '手绘线'));
    }

    async function init(file) {
      if (!file) return;
      const pn = pageInput(); if (pn && pn.value) curPageNo = Math.max(1, Number(pn.value) || 1);
      setHint('渲染预览中…');
      try {
        const buf = await file.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        scale = Math.min(1.4, 360 / (await pdfDoc.getPage(1)).getViewport({ scale: 1 }).width);
        await renderPage(Math.min(curPageNo, pdfDoc.numPages));
        ready = true;
        if (pn) pn.onchange = () => { const v = Number(pn.value) || 1; if (v >= 1 && v <= pdfDoc.numPages) renderPage(v); };
      } catch (e) { setHint('预览渲染失败'); }
    }

    wrap._init = init;
    pickCanvases.push(wrap);
    return wrap;
  }

  /* ---------------- 页面缩略图多选器 ---------------- */
  // 在表单内渲染每页缩略图 + 复选框，输出 pages 字符串（如 "1,3,5-7"），与 parsePages 完全兼容
  function buildPagePicker(f) {
    const purpose = f.purpose || 'keep'; // 'keep' = 选中保留(如提取)，'remove' = 选中删除
    const wrap = document.createElement('div'); wrap.className = 'field full';
    const label = document.createElement('label');
    label.textContent = f.label || (purpose === 'remove' ? '勾选要删除的页面' : '勾选要保留/操作的页面');
    wrap.appendChild(label);

    const toolbar = document.createElement('div'); toolbar.className = 'pp-toolbar';
    const grid = document.createElement('div'); grid.className = 'pp-grid';
    const hint = document.createElement('div'); hint.className = 'pp-hint'; hint.textContent = '请先选择 PDF 文件';

    function formatRange(arr) {
      const out = []; let i = 0;
      while (i < arr.length) {
        let j = i;
        while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++;
        out.push(i === j ? String(arr[i]) : `${arr[i]}-${arr[j]}`);
        i = j + 1;
      }
      return out.join(',');
    }
    function updateHint() {
      const arr = [...selected].sort((a, b) => a - b);
      hint.textContent = total
        ? `已选 ${selected.size}/${total} 页` + (arr.length ? `：${formatRange(arr)}` : '')
        : '请先选择 PDF 文件';
    }
    function refreshChecks() {
      grid.querySelectorAll('.pp-check').forEach((cb) => { cb.checked = selected.has(Number(cb.dataset.page)); });
    }
    function mkBtn(txt, fn) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ghost pp-tb';
      b.textContent = txt; b.onclick = fn; toolbar.appendChild(b);
    }
    let selected = new Set();
    let total = 0;
    mkBtn('全选', () => { for (let p = 1; p <= total; p++) selected.add(p); refreshChecks(); updateHint(); });
    mkBtn('反选', () => { for (let p = 1; p <= total; p++) { if (selected.has(p)) selected.delete(p); else selected.add(p); } refreshChecks(); updateHint(); });
    mkBtn('奇数页', () => { selected.clear(); for (let p = 1; p <= total; p += 2) selected.add(p); refreshChecks(); updateHint(); });
    mkBtn('偶数页', () => { selected.clear(); for (let p = 2; p <= total; p += 2) selected.add(p); refreshChecks(); updateHint(); });
    mkBtn('清除', () => { selected.clear(); refreshChecks(); updateHint(); });

    wrap.appendChild(toolbar); wrap.appendChild(grid); wrap.appendChild(hint);

    async function init(file) {
      if (!file) return;
      hint.textContent = '渲染缩略图中…'; grid.innerHTML = '';
      try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        total = pdf.numPages;
        selected = new Set();
        if (purpose === 'keep') for (let p = 1; p <= total; p++) selected.add(p); // 提取默认全选
        const thumbScale = Math.min(0.34, 150 / 595);
        for (let p = 1; p <= total; p++) {
          const page = await pdf.getPage(p);
          const r = page.getViewport({ scale: thumbScale });
          const cell = document.createElement('div'); cell.className = 'pp-cell';
          const cv = document.createElement('canvas'); cv.className = 'pp-thumb'; cv.width = r.width; cv.height = r.height;
          await page.render({ canvasContext: cv.getContext('2d'), viewport: r }).promise;
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'pp-check'; cb.dataset.page = p;
          cb.checked = selected.has(p);
          cb.onchange = () => { if (cb.checked) selected.add(p); else selected.delete(p); updateHint(); };
          const num = document.createElement('span'); num.className = 'pp-num'; num.textContent = '第 ' + p + ' 页';
          cell.appendChild(cv); cell.appendChild(cb); cell.appendChild(num);
          grid.appendChild(cell);
        }
        updateHint();
      } catch (e) { hint.textContent = '缩略图渲染失败'; }
    }

    wrap._pagesValue = () => {
      const arr = [...selected].sort((a, b) => a - b);
      return formatRange(arr);
    };
    wrap._init = init;
    pickCanvases.push(wrap);
    return wrap;
  }


  function buildFileField(f) {
    const wrap = document.createElement('div'); wrap.className = 'field full';
    if (f.group) wrap.dataset.group = f.group;
    const label = document.createElement('label'); label.textContent = f.label; wrap.appendChild(label);
    const dz = document.createElement('div'); dz.className = 'dropzone';
    dz.innerHTML = `<div class="dz-icon">📄</div><div class="dz-text">点击选择文件，或拖拽到此处</div><div class="dz-sub">${f.multiple ? '可多选' : '单个文件'} · ${f.accept}</div>`;
    const input = document.createElement('input'); input.type = 'file'; input.accept = f.accept; input.hidden = true; if (f.multiple) input.multiple = true;
    const list = document.createElement('div'); list.className = 'filelist';
    const key = f.key;
    const refresh = () => {
      list.innerHTML = '';
      (state.files[key] || []).forEach((file, i) => {
        const chip = document.createElement('div'); chip.className = 'filechip';
        const nm = document.createElement('span'); nm.className = 'fc-name'; nm.textContent = file.name;
        const x = document.createElement('button'); x.className = 'fc-x'; x.textContent = '✕';
        x.onclick = () => { state.files[key].splice(i, 1); refresh(); };
        chip.appendChild(nm); chip.appendChild(x); list.appendChild(chip);
      });
      if (key === 'file') previewAfterSelect();
      if (state.op && state.op.onFilesReady) state.op.onFilesReady();
      // 初始化本工具页的交互式预览画布（裁剪框选/定点放置）
      if (key === 'file') {
        const fl = state.files.file && state.files.file[0];
        if (fl) pickCanvases.forEach((pc) => { if (pc._init) pc._init(fl); });
      }
    };
    const addFiles = (fileList) => {
      const arr = Array.from(fileList);
      state.files[key] = (state.files[key] || []).concat(arr);
      refresh();
    };
    dz.onclick = () => input.click();
    input.onchange = () => { addFiles(input.files); input.value = ''; };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles(e.dataTransfer.files); };
    wrap.appendChild(dz); wrap.appendChild(input); wrap.appendChild(list);
    fileRefreshers[key] = refresh; // 注册，便于链式处理预填后刷新
    return wrap;
  }

  /* ---------------- 取值 ---------------- */
  function collectValues(op) {
    const vals = {};
    op.fields.forEach((f) => {
      if (f.type === 'file') {
        if (f.multiple) vals[f.key] = state.files[f.key] || [];
        else vals[f.key] = (state.files[f.key] && state.files[f.key][0]) || null;
        return;
      }
      if (f.type === 'pagepicker') {
        vals[f.key] = pagePickers[f.key] ? pagePickers[f.key]._pagesValue() : '';
        return;
      }
      if (f.type === 'checks') {
        const obj = {};
        f.options.forEach((o) => { const c = document.getElementById(`chk_${f.key}_${o.key}`); obj[o.key] = !!c.checked; });
        vals[f.key] = obj; return;
      }
      const el = form.querySelector(`[data-key="${f.key}"]`);
      if (!el) return;
      if (f.type === 'number' || f.type === 'range') vals[f.key] = el.value;
      else vals[f.key] = el.value;
    });
    return vals;
  }

  /* ---------------- 执行 ---------------- */
  async function runOp(op) {
    const vals = collectValues(op);
    const btn = form.querySelector('.btn.primary');
    btn.disabled = true; btn.textContent = '处理中…';
    const taskId = Tasks.add(op.title);
    showRunProgress(true);
    const onProgress = makeProgress(taskId);
    try {
      const res = await op.run(vals, onProgress);
      Tasks.finish(taskId, true, res.results, res.message);
      resultPanel.hidden = false; resultList.innerHTML = '';
      (res.results || []).forEach((r) => {
        const item = document.createElement('div'); item.className = 'result-item';
        if (r.kind === 'text') {
          const nm = document.createElement('span'); nm.className = 'ri-name'; nm.textContent = r.name || '结果';
          item.appendChild(nm);
          if (r.text != null) {
            const pre = document.createElement('pre'); pre.className = 'ri-text';
            pre.style.whiteSpace = 'pre-wrap'; pre.style.margin = '4px 0'; pre.style.fontSize = '13px';
            pre.style.fontFamily = 'inherit'; pre.style.maxHeight = '320px'; pre.style.overflow = 'auto';
            pre.textContent = r.text || '';
            item.appendChild(pre);
            const copy = document.createElement('button'); copy.className = 'dl'; copy.textContent = '复制';
            copy.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(r.text) : Promise.reject()).then(() => toast('已复制到剪贴板')).catch(() => toast('复制失败，请手动选择', true)); };
            const dl = document.createElement('button'); dl.className = 'dl ghost'; dl.textContent = '下载 .txt';
            dl.onclick = () => downloadBlob(r.name && r.name.endsWith('.txt') ? r.name : 'ocr_text.txt', new Blob([r.text], { type: 'text/plain' }));
            item.appendChild(copy); item.appendChild(dl);
          } else if (r.blob) {
            const sz = document.createElement('span'); sz.className = 'ri-size'; sz.textContent = fmtSize(r.blob.size);
            const dl = document.createElement('button'); dl.className = 'dl'; dl.textContent = '下载';
            dl.onclick = () => downloadBlob(r.name || 'file', r.blob);
            item.appendChild(sz); item.appendChild(dl);
          }
          resultList.appendChild(item);
          return;
        }
        if (r.kind === 'pdf') {
          const thumb = document.createElement('canvas'); thumb.className = 'ri-thumb';
          item.appendChild(thumb);
          renderResultThumb(r.blob, thumb);
        }
        const nm = document.createElement('span'); nm.className = 'ri-name'; nm.textContent = r.name;
        const sz = document.createElement('span'); sz.className = 'ri-size'; sz.textContent = fmtSize(r.blob.size);
        const dl = document.createElement('button'); dl.className = 'dl'; dl.textContent = '下载';
        dl.onclick = () => downloadBlob(r.name, r.blob);
        item.appendChild(nm); item.appendChild(sz); item.appendChild(dl);
        if (r.kind === 'pdf') {
          const open = document.createElement('button'); open.className = 'dl ghost'; open.textContent = '预览';
          open.onclick = () => {
            const u = URL.createObjectURL(r.blob);
            window.open(u, '_blank');
            setTimeout(() => URL.revokeObjectURL(u), 60000);
          };
          item.appendChild(open);
          buildChainMenu(item, r);
        }
        resultList.appendChild(item);
      });
      toast(res.message || '完成');
    } catch (e) {
      console.error(e);
      Tasks.finish(taskId, false, null, e && e.message ? e.message : String(e));
      toast('出错：' + (e && e.message ? e.message : e), true);
    } finally {
      btn.disabled = false; btn.textContent = '开始处理';
      showRunProgress(false);
    }
  }

  /* ---------------- 链式处理：把结果送入另一工具 ---------------- */
  // 返回“接受单个 PDF 作为输入”的工具 key 列表（用于继续处理菜单）
  function pdfInputTools() {
    return Object.keys(OPS).filter((k) => {
      const f = OPS[k].fields.find((x) => x.key === 'file' && x.type === 'file');
      return f && !f.multiple && (f.accept || '').includes('application/pdf');
    });
  }

  // 把已生成的 PDF 结果直接载入目标工具，无需下载再上传
  function openChainedTool(opKey, blob, name) {
    renderOp(opKey);
    const file = new File([blob], name || 'output.pdf', { type: 'application/pdf' });
    state.files.file = [file];
    if (fileRefreshers.file) fileRefreshers.file(); // 刷新文件列表 + 触发预览
    toast('已载入上一步结果，可设置参数后继续处理');
  }

  // 结果项的“继续处理”菜单
  let openChainMenu = null; // 当前展开的菜单（全局仅一个）
  function buildChainMenu(resultItem, r) {
    const btn = document.createElement('button'); btn.className = 'dl ghost chain'; btn.textContent = '继续处理 ▾';
    const menu = document.createElement('div'); menu.className = 'chain-menu'; menu.hidden = true;
    const tools = pdfInputTools().filter((k) => k !== state.opKey);
    tools.forEach((k) => {
      const item = document.createElement('button'); item.className = 'chain-item';
      item.appendChild(iconSvg(k));
      const sp = document.createElement('span'); sp.textContent = OPS[k].title; item.appendChild(sp);
      item.onclick = () => { menu.hidden = true; openChainMenu = null; openChainedTool(k, r.blob, r.name); };
      menu.appendChild(item);
    });
    btn.onclick = (e) => {
      e.stopPropagation();
      if (openChainMenu && openChainMenu !== menu) openChainMenu.hidden = true;
      menu.hidden = !menu.hidden;
      openChainMenu = menu.hidden ? null : menu;
    };
    resultItem.appendChild(btn); resultItem.appendChild(menu);
  }
  // 全局：点击菜单外部时收起
  document.addEventListener('click', (e) => {
    if (openChainMenu && !openChainMenu.contains(e.target)) { openChainMenu.hidden = true; openChainMenu = null; }
  });

  /* ---------------- 预览（多页） ---------------- */
  async function previewAfterSelect() {
    const file = state.files.file && state.files.file[0];
    if (!file) { previewPanel.hidden = true; state.pdfDoc = null; return; }
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      state.pdfDoc = pdf;
      state.currentPage = 1;
      renderPreviewPage(1);
      previewMeta.textContent = `共 ${pdf.numPages} 页 · ${file.name}`;
      previewPanel.hidden = false;
    } catch (e) { previewPanel.hidden = true; state.pdfDoc = null; }
  }

  async function renderPreviewPage(num) {
    const pdf = state.pdfDoc;
    if (!pdf || num < 1 || num > pdf.numPages) return;
    state.currentPage = num;
    pageCounter.textContent = `${num} / ${pdf.numPages}`;
    prevBtn.disabled = (num <= 1);
    nextBtn.disabled = (num >= pdf.numPages);
    try {
      const page = await pdf.getPage(num);
      const vp = page.getViewport({ scale: 1.0 });
      const scale = Math.min(1.4, 360 / vp.width);
      const r = page.getViewport({ scale });
      previewCanvas.width = r.width; previewCanvas.height = r.height;
      await page.render({ canvasContext: previewCanvas.getContext('2d'), viewport: r }).promise;
    } catch (_) { console.error("[pdf-app] 操作失败:", e); }
  }

  function goPrev() { if (state.currentPage > 1) renderPreviewPage(state.currentPage - 1); }
  function goNext() { if (state.pdfDoc && state.currentPage < state.pdfDoc.numPages) renderPreviewPage(state.currentPage + 1); }

  /* 渲染结果 PDF 首页缩略图（确认输出正确） */
  async function renderResultThumb(blob, canvas) {
    try {
      const buf = await blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      if (pdf.numPages < 1) return;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1.0 });
      const scale = Math.min(1.0, 220 / vp.width);
      const r = page.getViewport({ scale });
      canvas.width = r.width; canvas.height = r.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: r }).promise;
    } catch (_) { console.error("[pdf-app] 操作失败:", e); }
  }

  /* ---------------- 绑定 ---------------- */
  PDF$('#opBack').addEventListener('click', showHome);
  crumbHome.addEventListener('click', showHome);
  PDF$('#taskNavBtn').addEventListener('click', toggleTaskPanel);
  PDF$('#taskClear').addEventListener('click', () => { Tasks.items = []; Tasks.render(); });
  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') showHome(); });

  // 平台标签
  const ua = navigator.userAgent;
  let tag = '网页';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) tag = '手机 APP';
  else if (/Win|Mac|Linux/i.test(ua)) tag = '桌面软件';
  PDF$('#platformTag').textContent = tag;

  // 可安装（PWA）
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; PDF$('#installBtn').hidden = false; });
  PDF$('#installBtn').onclick = async () => {
    if (!deferredPrompt) { toast('请使用浏览器菜单“添加到主屏幕/安装”'); return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice; deferredPrompt = null; PDF$('#installBtn').hidden = true;
  };

  // 初始化（包 try-catch 确保后续 Office 集成接口一定挂载）
  try {
    buildSidebar();
  } catch (_e) {
    console.warn('[PDF] buildSidebar 失败:', _e.message);
  }
  try {
    buildHome();
  } catch (_e) {
    console.warn('[PDF] buildHome 失败:', _e.message);
  }
  try {
    showHome();
  } catch (_e) {
    console.warn('[PDF] showHome 失败:', _e.message);
  }

  // ===== 原生客户端：从系统（资源管理器双击 .pdf）打开文件并记入最近 =====
  // 把任意本地 PDF File 注入当前工具并刷新预览（各端打开/重开的统一落点）。
  function injectPdfFile(file) {
    const def = pdfInputTools()[0];
    if (def) renderOp(def);            // 跳到第一个接收 PDF 的工具（renderOp 内部会清空 state.files，必须先调用）
    state.files.file = [file];          // renderOp 后再赋值，避免被 state.files = {} 清空
    if (fileRefreshers.file) fileRefreshers.file(); // 刷新文件列表
    if (state.op && state.op.onFilesReady) state.op.onFilesReady();
    previewAfterSelect();
  }

  // ===== 原生客户端：从系统（资源管理器双击 .pdf）打开文件并记入最近 =====
  // 主进程读好文件后通过 IPC 把 base64 传进来，这里经 injectPdfFile 注入到首个 PDF 工具。
  window.__ghOpenPdfFromSystem = function (name, base64, path) {
    try {
      const bin = atob(base64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name || 'document.pdf', { type: 'application/pdf' });
      injectPdfFile(file);
      // 记入最近文件：带 path（桌面绝对路径/移动 Documents 相对路径）可回读；无 path 的仅记录展示
      if (name || path) PDFStore.recent.add({ name: name || file.name, path: path || null, reopenable: !!path });
      renderRecents();
      toast('已打开：' + (name || 'PDF'));
    } catch (e) {
      console.error('open system pdf failed', e);
      toast('打开文件失败：' + ((e && e.message) || e), true);
    }
  };
  if (window.electronAPI && window.electronAPI.onOpenPdf) {
    window.electronAPI.onOpenPdf((p) => window.__ghOpenPdfFromSystem(p && p.name, p && p.data, p && p.path));
  }


  OS = window.OS || {}; OS.PDFToolbox = {
    _initialized: false,
    open: function() {
      var root = document.getElementById('pdfToolboxRoot');
      if (!root) return;
      var dash = document.getElementById('dashboard');
      var ed = document.getElementById('editor');
      root.hidden = false;
      if (dash) dash.hidden = true;
      if (ed) ed.hidden = true;
      // 延迟初始化：pdf.js mount 创建 DOM 骨架后由 open 触发原项目 UI 渲染
      if (!this._initialized) {
        try { buildSidebar(); } catch(_e) { console.warn('[PDF] buildSidebar:', _e.message); }
        try { buildHome(); } catch(_e) { console.warn('[PDF] buildHome:', _e.message); }
        try { showHome(); } catch(_e) { console.warn('[PDF] showHome:', _e.message); }
        this._initialized = true;
      }
      setTimeout(function(){ window.dispatchEvent(new Event('resize')); }, 100);
    },
    close: function() {
      var root = document.getElementById('pdfToolboxRoot');
      if (!root) return;
      root.hidden = true;
      // 回到 dashboard
      if (typeof OS !== 'undefined' && OS.shell && OS.shell.renderDashboard) {
        document.getElementById('editor').hidden = true;
        document.getElementById('dashboard').hidden = false;
        OS.shell.renderDashboard();
      }
    }
  };
})();