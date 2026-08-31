/* ============================================================
   绿角犀 Office · 模板库 (OS.Templates)
   为开始页提供「新建」模板画廊：每个模块 1-3 个模板
   （含空白），每个模板含 SVG 缩略图与 build() 构造合法 doc.data
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  function uid(s) {
    if (OS && OS.util && OS.util.uid) return OS.util.uid(s);
    return (s || "el") + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 缩略图（统一 Fluent 风格占位图） ---------- */
  function thumbDoc(accent) {
    return `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect width="160" height="100" rx="6" fill="#ffffff" stroke="#e5e7eb"/>
      <rect x="16" y="14" width="84" height="9" rx="2" fill="${accent}"/>
      <rect x="16" y="34" width="128" height="5" rx="2" fill="#d1d5db"/>
      <rect x="16" y="44" width="128" height="5" rx="2" fill="#d1d5db"/>
      <rect x="16" y="54" width="92" height="5" rx="2" fill="#d1d5db"/>
      <rect x="16" y="68" width="60" height="5" rx="2" fill="#eef2f7"/>
    </svg>`;
  }
  function thumbSheet(accent) {
    return `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect width="160" height="100" rx="6" fill="#ffffff" stroke="#e5e7eb"/>
      <rect x="16" y="14" width="128" height="11" rx="2" fill="${accent}"/>
      <g stroke="#e5e7eb">
        <line x1="16" y1="40" x2="144" y2="40"/><line x1="16" y1="54" x2="144" y2="54"/>
        <line x1="16" y1="68" x2="144" y2="68"/><line x1="16" y1="82" x2="144" y2="82"/>
        <line x1="52" y1="25" x2="52" y2="82"/><line x1="100" y1="25" x2="100" y2="82"/>
      </g>
      <rect x="16" y="25" width="36" height="15" fill="${accent}" opacity="0.12"/>
    </svg>`;
  }
  function thumbPres(accent) {
    return `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect x="38" y="12" width="84" height="76" rx="5" fill="#ffffff" stroke="#e5e7eb"/>
      <rect x="48" y="24" width="58" height="9" rx="2" fill="${accent}"/>
      <rect x="48" y="42" width="68" height="4" rx="2" fill="#d1d5db"/>
      <rect x="48" y="52" width="68" height="4" rx="2" fill="#d1d5db"/>
      <rect x="48" y="62" width="44" height="4" rx="2" fill="#d1d5db"/>
      <circle cx="126" cy="74" r="3" fill="${accent}" opacity="0.5"/>
    </svg>`;
  }
  function thumbMind(accent) {
    return `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect width="160" height="100" rx="6" fill="#ffffff" stroke="#e5e7eb"/>
      <line x1="80" y1="50" x2="42" y2="28" stroke="#cbd5e1"/><line x1="80" y1="50" x2="118" y2="28" stroke="#cbd5e1"/>
      <line x1="80" y1="50" x2="42" y2="72" stroke="#cbd5e1"/><line x1="80" y1="50" x2="118" y2="72" stroke="#cbd5e1"/>
      <circle cx="80" cy="50" r="14" fill="${accent}"/>
      <rect x="30" y="22" width="24" height="12" rx="6" fill="${accent}" opacity="0.55"/>
      <rect x="106" y="22" width="24" height="12" rx="6" fill="${accent}" opacity="0.55"/>
      <rect x="30" y="66" width="24" height="12" rx="6" fill="${accent}" opacity="0.55"/>
      <rect x="106" y="66" width="24" height="12" rx="6" fill="${accent}" opacity="0.55"/>
    </svg>`;
  }

  /* ---------- 模板定义 ---------- */
  const TEMPLATES = [
    /* Writer */
    { id: "writer-blank", module: "writer", name: "空白文档", desc: "从零开始撰写", accent: "#2563eb", thumb: thumbDoc("#2563eb"),
      build: () => ({ html: "<h1>未命名文档</h1><p><br></p>" }) },
    { id: "writer-report", module: "writer", name: "工作报告", desc: "章节式周报 / 月报", accent: "#2563eb", thumb: thumbDoc("#2563eb"),
      build: () => ({ html:
        '<h1>工作报告</h1>' +
        '<p style="color:#64748b">汇报人：________　日期：____年__月__日</p>' +
        '<h2>一、本期工作概述</h2><p>在此填写本期主要工作内容与成果……</p>' +
        '<h2>二、重点项目进展</h2><ul><li>项目 A：……</li><li>项目 B：……</li></ul>' +
        '<h2>三、问题与风险</h2><p>描述当前遇到的阻塞与应对方案。</p>' +
        '<h2>四、下期计划</h2><p>列出下阶段目标与关键里程碑。</p>' }) },
    { id: "writer-minutes", module: "writer", name: "会议纪要", desc: "议程 / 决议 / 待办", accent: "#2563eb", thumb: thumbDoc("#2563eb"),
      build: () => ({ html:
        '<h1>会议纪要</h1>' +
        '<p style="color:#64748b">时间：　　地点：　　主持人：</p>' +
        '<h2>参会人员</h2><p>……</p>' +
        '<h2>会议议程</h2><ol><li>……</li><li>……</li></ol>' +
        '<h2>决议事项</h2><ul><li>……</li></ul>' +
        '<h2>待办跟进</h2><ul><li>……（负责人 / 截止日期）</li></ul>' }) },
    { id: "writer-resume", module: "writer", name: "简历", desc: "教育 / 经历 / 技能", accent: "#2563eb", thumb: thumbDoc("#2563eb"),
      build: () => ({ html:
        '<h1>姓名</h1>' +
        '<p style="color:#64748b">电话 | 邮箱 | 所在城市</p>' +
        '<h2>个人简介</h2><p>一句话概括你的优势与方向。</p>' +
        '<h2>教育经历</h2><ul><li>____ 大学 · 专业（20__–20__）</li></ul>' +
        '<h2>工作经历</h2><ul><li>公司 · 岗位（20__–20__）：负责……</li></ul>' +
        '<h2>专业技能</h2><p>……</p>' }) },

    /* Spreadsheet */
    { id: "sheet-blank", module: "spreadsheet", name: "空白表格", desc: "自由组织数据", accent: "#0e9f6e", thumb: thumbSheet("#0e9f6e"),
      build: () => ({ rows: 100, cols: 16, cells: {}, styles: {} }) },
    { id: "sheet-budget", module: "spreadsheet", name: "月度预算", desc: "预算 / 实际 / 差额（带公式）", accent: "#0e9f6e", thumb: thumbSheet("#0e9f6e"),
      build: () => ({
        rows: 60, cols: 12,
        cells: {
          A1: { v: "月度预算表" },
          A3: { v: "类别" }, B3: { v: "预算" }, C3: { v: "实际" }, D3: { v: "差额" },
          A4: { v: "住房" }, B4: { v: 3000 }, C4: { v: 3200 },
          A5: { v: "餐饮" }, B5: { v: 1500 }, C5: { v: 1400 },
          A6: { v: "交通" }, B6: { v: 600 }, C6: { v: 550 },
          A7: { v: "其他" }, B7: { v: 900 }, C7: { v: 1000 },
          A8: { v: "合计" }, B8: { f: "=SUM(B4:B7)" }, C8: { f: "=SUM(C4:C7)" }, D8: { f: "=C8-B8" }
        },
        styles: {
          A1: { bold: true, fontSize: 16 }, A3: { bold: true }, B3: { bold: true }, C3: { bold: true }, D3: { bold: true },
          A8: { bold: true }, B8: { bold: true }, C8: { bold: true }, D8: { bold: true }
        }
      }) },
    { id: "sheet-project", module: "spreadsheet", name: "项目计划", desc: "任务 / 负责人 / 进度", accent: "#0e9f6e", thumb: thumbSheet("#0e9f6e"),
      build: () => ({
        rows: 60, cols: 12,
        cells: {
          A1: { v: "项目计划" },
          A3: { v: "任务" }, B3: { v: "负责人" }, C3: { v: "开始" }, D3: { v: "结束" }, E3: { v: "状态" },
          A4: { v: "需求调研" }, B4: { v: "张三" }, C4: { v: "2026-08-01" }, D4: { v: "2026-08-07" }, E4: { v: "进行中" },
          A5: { v: "设计" }, B5: { v: "李四" }, C5: { v: "2026-08-08" }, D5: { v: "2026-08-15" }, E5: { v: "待开始" },
          A6: { v: "开发" }, B6: { v: "王五" }, C6: { v: "2026-08-16" }, D6: { v: "2026-09-10" }, E6: { v: "待开始" },
          A7: { v: "测试上线" }, B7: { v: "赵六" }, C7: { v: "2026-09-11" }, D7: { v: "2026-09-20" }, E7: { v: "待开始" }
        },
        styles: {
          A1: { bold: true, fontSize: 16 }, A3: { bold: true }, B3: { bold: true }, C3: { bold: true }, D3: { bold: true }, E3: { bold: true }
        }
      }) },
    { id: "sheet-scores", module: "spreadsheet", name: "成绩表", desc: "各科 / 平均分（带公式）", accent: "#0e9f6e", thumb: thumbSheet("#0e9f6e"),
      build: () => ({
        rows: 60, cols: 12,
        cells: {
          A1: { v: "期末成绩表" },
          A3: { v: "姓名" }, B3: { v: "语文" }, C3: { v: "数学" }, D3: { v: "英语" }, E3: { v: "平均分" },
          A4: { v: "小明" }, B4: { v: 88 }, C4: { v: 92 }, D4: { v: 85 }, E4: { f: "=ROUND(AVERAGE(B4:D4),1)" },
          A5: { v: "小红" }, B5: { v: 95 }, C5: { v: 89 }, D5: { v: 91 }, E5: { f: "=ROUND(AVERAGE(B5:D5),1)" },
          A6: { v: "小刚" }, B6: { v: 78 }, C6: { v: 84 }, D6: { v: 80 }, E6: { f: "=ROUND(AVERAGE(B6:D6),1)" }
        },
        styles: {
          A1: { bold: true, fontSize: 16 }, A3: { bold: true }, B3: { bold: true }, C3: { bold: true }, D3: { bold: true }, E3: { bold: true }
        }
      }) },

    /* Presentation */
    { id: "pres-blank", module: "presentation", name: "空白演示", desc: "从空白幻灯片开始", accent: "#7c3aed", thumb: thumbPres("#7c3aed"),
      build: () => ({ slides: [{ bg: "#ffffff", elements: [{ id: uid("el"), type: "text", x: 220, y: 170, w: 320, h: 90, text: "点击编辑标题", fontSize: 32, color: "#111827", bold: true }] }] }) },
    { id: "pres-business", module: "presentation", name: "商务汇报", desc: "封面 + 内容 + 结尾", accent: "#7c3aed", thumb: thumbPres("#7c3aed"),
      build: () => ({ slides: [
        { bg: "#1e3a5f", elements: [
          { id: uid("el"), type: "text", x: 120, y: 150, w: 520, h: 80, text: "季度业务汇报", fontSize: 40, color: "#ffffff", bold: true },
          { id: uid("el"), type: "text", x: 120, y: 240, w: 520, h: 40, text: "2026 Q3 · 战略与执行", fontSize: 20, color: "#cbd5e1" }
        ] },
        { bg: "#ffffff", elements: [
          { id: uid("el"), type: "text", x: 60, y: 50, w: 640, h: 50, text: "核心进展", fontSize: 28, color: "#1e3a5f", bold: true },
          { id: uid("el"), type: "text", x: 60, y: 120, w: 640, h: 200, text: "• 营收同比增长 18%\n• 新签客户 120 家\n• 产品 NPS 提升至 62", fontSize: 18, color: "#334155" }
        ] },
        { bg: "#1e3a5f", elements: [
          { id: uid("el"), type: "text", x: 240, y: 185, w: 280, h: 60, text: "谢谢观看", fontSize: 36, color: "#ffffff", bold: true }
        ] }
      ] }) },
    { id: "pres-lesson", module: "presentation", name: "教学课件", desc: "标题 + 要点 + 小结", accent: "#7c3aed", thumb: thumbPres("#7c3aed"),
      build: () => ({ slides: [
        { bg: "#ffffff", elements: [
          { id: uid("el"), type: "text", x: 60, y: 60, w: 640, h: 60, text: "第 3 课：光合作用", fontSize: 30, color: "#166534", bold: true }
        ] },
        { bg: "#ffffff", elements: [
          { id: uid("el"), type: "text", x: 60, y: 50, w: 640, h: 50, text: "学习目标", fontSize: 24, color: "#166534", bold: true },
          { id: uid("el"), type: "text", x: 60, y: 120, w: 640, h: 200, text: "• 理解光合作用的原理\n• 掌握反应方程式\n• 认识其在生态系统中的作用", fontSize: 18, color: "#334155" }
        ] },
        { bg: "#ffffff", elements: [
          { id: uid("el"), type: "text", x: 60, y: 50, w: 640, h: 50, text: "小结", fontSize: 24, color: "#166534", bold: true },
          { id: uid("el"), type: "text", x: 60, y: 120, w: 640, h: 160, text: "• 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂\n• 叶绿体是场所，光是能量来源", fontSize: 18, color: "#334155" }
        ] }
      ] }) },

    /* MindMap */
    { id: "mind-blank", module: "mindmap", name: "空白脑图", desc: "从中心主题发散", accent: "#ea580c", thumb: thumbMind("#ea580c"),
      build: () => {
        const r = { id: "r", x: 0, y: 0, text: "中心主题", isRoot: true, color: "#1e3a5f" };
        return { mode: "map", nodes: [r], edges: [], rootId: "r" };
      } },
    { id: "mind-project", module: "mindmap", name: "项目计划", desc: "需求 / 设计 / 开发 / 上线", accent: "#ea580c", thumb: thumbMind("#ea580c"),
      build: () => {
        const mk = (id, text) => ({ id, x: 0, y: 0, text, parent: "r", color: "#ea580c", shape: "rounded", fontSize: 14, isRoot: false });
        const nodes = [
          { id: "r", x: 0, y: 0, text: "项目启动", isRoot: true, color: "#1e3a5f" },
          mk("n1", "需求"), mk("n2", "设计"), mk("n3", "开发"), mk("n4", "上线")
        ];
        const edges = ["n1", "n2", "n3", "n4"].map(n => ({ id: "e_" + n, from: "r", to: n }));
        return { mode: "map", nodes, edges, rootId: "r" };
      } },
    { id: "mind-book", module: "mindmap", name: "读书笔记", desc: "观点 / 人物 / 启发", accent: "#ea580c", thumb: thumbMind("#ea580c"),
      build: () => {
        const mk = (id, text) => ({ id, x: 0, y: 0, text, parent: "r", color: "#ea580c", shape: "rounded", fontSize: 14, isRoot: false });
        const nodes = [
          { id: "r", x: 0, y: 0, text: "《书名》", isRoot: true, color: "#7c2d12" },
          mk("n1", "核心观点"), mk("n2", "人物"), mk("n3", "启发")
        ];
        const edges = ["n1", "n2", "n3"].map(n => ({ id: "e_" + n, from: "r", to: n }));
        return { mode: "map", nodes, edges, rootId: "r" };
      } }
  ];

  const byId = id => {
    const local = TEMPLATES.find(t => t.id === id);
    if (local) return local;
    if (OS.CustomTemplates) { const c = OS.CustomTemplates.byId(id); if (c) return c; }
    return null;
  };
  const MODULE_LABEL = { writer: "文档", spreadsheet: "表格", presentation: "演示", mindmap: "脑图" };
  const groups = ["writer", "spreadsheet", "presentation", "mindmap"].map(m => ({
    module: m, label: MODULE_LABEL[m] || m, items: TEMPLATES.filter(t => t.module === m)
  }));

  OS.Templates = { list: TEMPLATES, byId, groups };

  /* ---------- 模板收藏（UI 偏好，localStorage 持久化） ----------
     收藏是用户偏好，不属于文档数据，因此独立于 IndexedDB 的 docs 存储，
     直接落 localStorage；localStorage 不可用时回退到内存 Set（仅当前会话有效）。 */
  const FAV_KEY = "lvjiaoxi-favorites";
  const favSet = new Set();
  function loadFavs() {
    favSet.clear();
    try {
      const raw = global.localStorage && global.localStorage.getItem(FAV_KEY);
      if (raw) JSON.parse(raw).forEach(id => favSet.add(id));
    } catch (e) { /* 解析失败：保留空集合，回退内存 */ }
  }
  function saveFavs() {
    try { if (global.localStorage) global.localStorage.setItem(FAV_KEY, JSON.stringify([...favSet])); }
    catch (e) { /* localStorage 不可用：仅保留在内存 Set */ }
  }
  loadFavs();
  OS.Favorites = {
    all() { return [...favSet]; },
    has(id) { return favSet.has(id); },
    isFav(id) { return favSet.has(id); },
    toggle(id) { const on = !favSet.has(id); if (on) favSet.add(id); else favSet.delete(id); saveFavs(); return on; },
    set(id, on) { if (on) favSet.add(id); else favSet.delete(id); saveFavs(); }
  };
})(window);
