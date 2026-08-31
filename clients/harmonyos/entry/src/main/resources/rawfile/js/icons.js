/* ============================================================
   绿角犀 Office · Fluent 图标集 (OS.icons)
   线性图标，currentColor 着色，24×24 viewBox，Fluent 风格
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // 统一描边属性
  const A = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  const PATHS = {
    // —— 顶栏 ——
    home: `<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>`,
    search: `<circle cx="11" cy="11" r="7.5"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
    replace: `<circle cx="10.5" cy="10.5" r="6.5"/><line x1="21" y1="21" x2="15.5" y2="15.5"/><polyline points="7.5 10.5 10.5 7.5 10.5 13.5"/>`,
    contrast: `<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>`,
    user: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7.5" r="4"/>`,
    link: `<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
    // —— 编辑/剪贴板 ——
    cut: `<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>`,
    copy: `<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
    paste: `<path d="M9 3v3a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3"/><path d="M8 5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2"/><path d="M4 9h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>`,
    fill: `<path d="M3 11l8-8 10 10-8 8z"/><path d="M13 5l6 6"/><path d="M3 21h8"/>`,
    edit: `<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M15 5l4 4"/>`,
    pen: `<path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><path d="M18 2l4 4-8 8H10V10z"/>`,
    cursor: `<path d="M5 3l14 7-6 1.5L10 19z"/>`,
    note: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    rect: `<rect x="4" y="4" width="16" height="16" rx="2"/>`,
    highlight: `<path d="M4 20h16"/><path d="M14.5 3.5a2.1 2.1 0 0 1 3 3L7 17l-4 1 1-4z"/>`,
    textfield: `<rect x="3" y="7" width="18" height="10" rx="2"/><line x1="7" y1="11" x2="7" y2="13"/><line x1="11" y1="11" x2="17" y2="11"/>`,
    checkbox: `<rect x="4" y="4" width="16" height="16" rx="3"/><polyline points="8 12 11 15 16 9"/>`,
    "bar-chart": `<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>`,
    "line-chart": `<path d="M3 20h18"/><path d="M4 15l5-6 4 4 7-9"/>`,
    "pie-chart": `<path d="M12 3v9h9a9 9 0 0 0-9-9z"/><path d="M21 12a9 9 0 1 1-9-9v9z"/>`,
    undo: `<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.36L1 10"/>`,
    redo: `<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.36L23 10"/>`,
    // —— 字体 ——
    "font-color": `<path d="M3 18 9 4l6 14"/><line x1="4.6" y1="13" x2="13.4" y2="13"/><rect x="2" y="20" width="20" height="2" rx="1" fill="currentColor" stroke="none"/>`,
    "font-highlight": `<path d="M4 20h16"/><path d="M14.5 3.5a2.1 2.1 0 0 1 3 3L7 17l-4 1 1-4z"/>`,
    "font-size": `<path d="M3 19 9 5l6 14"/><line x1="4.4" y1="14" x2="13.6" y2="14"/><line x1="18" y1="20" x2="21" y2="9"/>`,
    // —— 对齐 ——
    "align-left": `<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/>`,
    "align-center": `<line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>`,
    "align-right": `<line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/>`,
    "align-justify": `<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>`,
    // —— 列表/缩进 ——
    "list-bullet": `<line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none"/>`,
    "list-number": `<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 4h1.5v4H4z"/><path d="M4 8h2"/><path d="M4 14h1.5v3.2H4z"/><path d="M4 17.2h2"/>`,
    indent: `<polyline points="3 8 9 8"/><polyline points="3 16 9 16"/><line x1="13" y1="4" x2="21" y2="4"/><line x1="13" y1="12" x2="21" y2="12"/><line x1="13" y1="20" x2="21" y2="20"/><circle cx="3" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,
    outdent: `<polyline points="9 8 3 8"/><polyline points="9 16 3 16"/><line x1="13" y1="4" x2="21" y2="4"/><line x1="13" y1="12" x2="21" y2="12"/><line x1="13" y1="20" x2="21" y2="20"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,
    // —— 插入 ——
    table: `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="3" y1="15.5" x2="21" y2="15.5"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>`,
    image: `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><polyline points="21 15 16 10 5 21"/>`,
    link: `<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`,
    divider: `<line x1="3" y1="12" x2="21" y2="12"/><circle cx="3" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="21" cy="12" r="1.3" fill="currentColor" stroke="none"/>`,
    "page-break": `<line x1="3" y1="12" x2="21" y2="12"/><path d="M12 4v4M12 16v4"/><polyline points="9 7 12 4 15 7"/><polyline points="9 17 12 20 15 17"/>`,
    comment: `<path d="M21 12a8 8 0 0 1-11.3 7.3L4 21l1.7-5.7A8 8 0 1 1 21 12z"/>`,
    quote: `<path d="M7 7H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v3a3 3 0 0 1-3 3"/><path d="M20 7h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v3a3 3 0 0 1-3 3"/>`,
    // —— 表格 ——
    "sum": `<path d="M3 19 9 5l6 14"/><line x1="4.4" y1="13.5" x2="13.6" y2="13.5"/>`,
    "fx": `<path d="M5 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5"/><line x1="13" y1="9" x2="20" y2="9"/><line x1="16.5" y1="5.5" x2="16.5" y2="12.5"/>`,
    chart: `<line x1="3" y1="3" x2="3" y2="21"/><line x1="3" y1="21" x2="21" y2="21"/><rect x="7" y="12" width="3" height="6"/><rect x="13" y="8" width="3" height="10"/><rect x="19" y="5" width="3" height="13"/>`,
    filter: `<polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/>`,
    sort: `<polyline points="3 6 8 1 13 6"/><polyline points="3 18 8 23 13 18"/><line x1="16" y1="4" x2="21" y2="4"/><line x1="16" y1="9" x2="21" y2="9"/><line x1="16" y1="14" x2="21" y2="14"/><line x1="16" y1="19" x2="21" y2="19"/>`,
    "col-insert": `<rect x="8" y="3" width="8" height="18" rx="1"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8.5" y1="12" x2="15.5" y2="12"/>`,
    "col-delete": `<rect x="8" y="3" width="8" height="18" rx="1"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>`,
    "merge": `<rect x="3" y="6" width="18" height="12" rx="1"/><line x1="12" y1="6" x2="12" y2="18" stroke-dasharray="2 2"/>`,
    "validate": `<path d="M9 12l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="2"/>`,
    "arrow-right": `<line x1="3" y1="12" x2="20" y2="12"/><polyline points="14 6 21 12 14 18"/>`,
    "freeze": `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/>`,
    // —— 演示 ——
    slide: `<rect x="3" y="4" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
    "slide-new": `<rect x="3" y="4" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="10" y1="11" x2="14" y2="11"/>`,
    text: `<path d="M4 6h16"/><path d="M12 6v14"/>`,
    shape: `<rect x="4" y="4" width="16" height="16" rx="2"/>`,
    "shape-circle": `<circle cx="12" cy="12" r="8"/>`,
    transition: `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`,
    design: `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>`,
    play: `<polygon points="6 4 20 12 6 20 6 4"/>`,
    "play-from": `<polygon points="6 4 16 10.7 6 17.3 6 4"/><line x1="19" y1="4" x2="19" y2="20"/>`,
    // —— 脑图 ——
    "node-add": `<circle cx="8" cy="12" r="4"/><line x1="12" y1="12" x2="20" y2="12"/><line x1="17" y1="9" x2="17" y2="15"/>`,
    "node-child": `<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 12h3M15 6l1.5 4.5M15 18l1.5-4.5"/>`,
    "node-color": `<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>`,
    "node-del": `<circle cx="8" cy="12" r="4"/><line x1="12" y1="12" x2="20" y2="12"/><line x1="16" y1="9" x2="16" y2="15"/>`,
    fit: `<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/>`,
    // —— 通用操作 ——
    plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
    trash: `<polyline points="3 6 5 6 21 6"/><path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
    gear: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
    chevron: `<polyline points="6 9 12 15 18 9"/>`,
    "chevron-right": `<polyline points="9 6 15 12 9 18"/>`,
    check: `<polyline points="20 6 9 17 4 12"/>`,
    file: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
    docx: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>`,
    txt: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>`,
    md: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 16V11l2.5 2 2.5-2v5"/><path d="M15.5 16V11h2.1M17.55 13.2V16"/>`,
    "file-new": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/>`,
    save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`,
    "save-as": `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/><path d="M21 16v5M18.5 18.5h5"/>`,
    export: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
    import: `<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><polyline points="9 14 12 17 15 14"/><line x1="12" y1="17" x2="12" y2="12"/>`,
    print: `<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
    pdf: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8.5" y1="13" x2="8.5" y2="17"/><line x1="11.5" y1="13" x2="11.5" y2="17"/><line x1="14.5" y1="13" x2="14.5" y2="17"/>`,
    "page-setup": `<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>`,
    "page-break": `<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 20 8"/><line x1="7" y1="13" x2="17" y2="13" stroke-dasharray="2.5 2.5"/><polyline points="10 10 12 13 14 10"/><polyline points="10 16 12 13 14 16"/>`,
    "toc": `<line x1="9" y1="7" x2="19" y2="7"/><line x1="9" y1="12" x2="19" y2="12"/><line x1="9" y1="17" x2="19" y2="17"/><circle cx="5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1" fill="currentColor" stroke="none"/>`,
    "header": `<path d="M6 3h12a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><line x1="3" y1="13" x2="21" y2="13"/><line x1="3" y1="17" x2="21" y2="17"/><line x1="3" y1="21" x2="21" y2="21"/>`,
    "preview": `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
    "sort-asc": `<path d="M12 5v14"/><polyline points="6 11 12 5 18 11"/>`,
    "sort-desc": `<path d="M12 19V5"/><polyline points="6 13 12 19 18 13"/>`,
    "filter": `<polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5"/>`,
    share: `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>`,
    close: `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`,
    info: `<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/>`,
    zoom: `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>`,
    "zoom-in": `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>`,
    "zoom-out": `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>`,
    eye: `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
    "eye-off": `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>`,
    lock: `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
    download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
    upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
    grid: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
    "arrow-undo": `<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>`,
    "arrow-redo": `<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>`,
    // —— 任务进程 ——
    "tasks": `<path d="M9 4h6a2 2 0 0 1 2 2v14l-5-3-5 3V6a2 2 0 0 1 2-2z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="13" y2="13"/><polyline points="9 17 11 19 14 16"/>`,
    "spinner": `<path d="M12 3a9 9 0 1 0 9 9" opacity=".9"/>`,
    "spark": `<path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/><circle cx="12" cy="11" r="1.5"/>`,
    // —— 审阅 / 批注 ——
    "comment": `<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 3 11.5 8.4 8.4 0 0 1 11.5 3 8.4 8.4 0 0 1 21 11.5z"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/>`,
    "check": `<polyline points="20 6 9 17 4 12"/>`,
    "check-all": `<polyline points="2 13 6 17 11 9"/><polyline points="11 17 16 11 22 5"/>`,
    "trash": `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>`,
    "arrow-up": `<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>`,
    "arrow-down": `<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>`,
    // —— 条件格式 ——
    "format-cond": `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><path d="M3 3h6v6H3z" fill="currentColor" opacity=".35"/><path d="M15 15h6v6h-6z" fill="currentColor" opacity=".35"/>`
  };

  function svg(name, size) {
    const p = PATHS[name];
    if (!p) return "";
    const s = size || 18;
    return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" ${A} aria-hidden="true">${p}</svg>`;
  }

  OS.icons = {
    svg,
    has: n => !!PATHS[n],
    // 文字字形按钮（B/I/U/S/Σ/fx 等，Office 原样渲染字母）
    GLYPHS: { bold: "B", italic: "I", underline: "U", strike: "S", sum: "Σ", fx: "fx" }
  };
})(window);
