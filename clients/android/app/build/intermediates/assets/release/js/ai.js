/* ============================================================
   绿角犀 Office · AI 助手框架 (OS.AI)
   本地优先（离线规则引擎）+ 可插拔云端（OpenAI 风格流式）
   对应 PRD 3.6：上下文感知、可逆改动、数据不出域。

   设计原则：
   - 本地引擎为纯函数（无 DOM 依赖），可直接单元测试；
   - 默认零网络：所有能力在离线环境给出真实可用的输出；
   - 云端为增强项：配置 provider 后自动切换为真实 LLM 流式；
   - 「数据不出域」开关开启时，绝不向云端发送内容。
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;

  /* ---------------- 基础工具 ---------------- */
  const STOP = new Set(("的 了 和 是 在 我 你 他 她 它 我们 你们 他们 这 那 有 与 及 或 也 都 就 还 很 个 们 之 其 此 为 以 对 等 把 被 让 使 而 但 因为 所以 如果 虽然 但是 一种 一些 这个 那个 可以 可能 通过 以及 进行 方面 问题 情况 目前 现在 应该 需要 由于 这些 那些 一个 没有 就是 已经 这样 那样 什么 怎么 如何 我们 你们 他们 自己 起来 出来 其中 一直 一定 一直 不是 都是 不会 不能 这种 那种 这里 那里 然后 于是 因此 而且 并且 或者 只有 只要 无论 尽管 然而 不过 而是 以及 加以 予以 对于 关于 根据 按照 随着 成为 作为 表示 认为 指出 显示 说明 包括 涉及 体现 反映 确保 实现 推动 促进 提升 提高 降低 影响 作用 意义 价值 优势 特点 目标 任务 措施 方式 过程 结果 内容 形式 范围 标准 要求 原则 体系 机制 模式 能力 水平 效率 质量 安全 稳定 发展 建设 改革 创新 优化 完善 加强 推进 落实 取得 获得 形成 建立 构建 探索 研究 分析 总结 提出 发现 验证 支持 满足 解决 处理 管理 服务 应用 推广 普及 覆盖 整合 共享 协同 融合 智能 数字 数据 信息 网络 平台 系统 用户 客户 企业 行业 市场 社会 国家 全球 世界 时代 未来 今天 明天 去年 今年 明年 上午 下午 晚上 时候 时间 地点 人物 事件 原因 结果 条件 环境 资源 技术 产品 项目 计划 方案 策略 政策 法规 规范 制度 流程 指标 规模 速度 成本 收益 利润 风险 机会 挑战 趋势 变化 增长 下降 上升 保持 维持 突破 领先 竞争 合作 交流 沟通 学习 培训 经验 知识 文化 教育 健康 生活 工作 学习 家庭 个人 公共 基础 核心 关键 重要 主要 基本 根本 本质 总体 局部 内部 外部 正面 负面 积极 消极 明显 显著 突出 普遍 特殊 具体 抽象 简单 复杂 快速 缓慢 长期 短期 直接 间接 主动 被动 静态 动态 线上 线下 国内 国外 本地 远程 实时 高效 优质 规范 标准 科学 合理 可行 可持续 现代化 数字化 智能化").split(/\s+/));

  function clean(s) {
    return (s || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  function stripHtml(html) {
    const d = (global.document || {});
    if (d.createElement) {
      const el = d.createElement("div"); el.innerHTML = html || ""; return clean(el.textContent || "");
    }
    return clean((html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
  }
  function splitSentences(text) {
    const raw = clean(text).split(/[。！？；\n]+/).map(s => s.trim()).filter(Boolean);
    const out = [];
    raw.forEach(s => {
      // 超长句（>60 字）按逗号再切，提升摘要颗粒度
      if (s.length > 60 && /[，,]/.test(s)) {
        s.split(/[，,]/).forEach(x => { const t = x.trim(); if (t.length > 6) out.push(t); });
      } else out.push(s);
    });
    return out;
  }
  function tokenize(text) {
    const lower = (text || "").toLowerCase();
    const en = (lower.match(/[a-z][a-z0-9\-]{1,}/g) || []).filter(w => w.length > 1);
    const cn = (text || "").match(/[一-龥]{2,4}/g) || [];
    return en.concat(cn).filter(w => !STOP.has(w));
  }
  function wordFreq(text) {
    const f = {}; tokenize(text).forEach(w => { f[w] = (f[w] || 0) + 1; });
    return f;
  }
  function topKeywords(text, n) {
    const f = wordFreq(text);
    return Object.keys(f).sort((a, b) => f[b] - f[a]).slice(0, n || 6);
  }

  /* ---------------- 本地规则引擎 ---------------- */
  const local = {};

  // 摘要：抽取式（词频 + 位置权重），按原文顺序输出
  local.summarize = function (text, n) {
    const sents = splitSentences(text);
    if (sents.length <= (n || 3)) return clean(text);
    const freq = wordFreq(sents.join(" "));
    const scored = sents.map((s, i) => {
      const words = tokenize(s);
      let score = 0;
      words.forEach(w => { score += freq[w] || 0; });
      score = score / Math.sqrt(s.length + 1);
      if (i === 0) score += 2.2;            // 首句常含主旨
      if (i === sents.length - 1) score += 1.0;
      return { s, score, i };
    });
    scored.sort((a, b) => b.score - a.score);
    const picked = scored.slice(0, n || 3).sort((a, b) => a.i - b.i).map(x => x.s);
    return picked.join("。") + "。";
  };

  // 润色：冗余删除 + 口语转书面 + 标点规范
  const POLISH_RULES = [
    [/(的\s*的)+/g, "的"], [/(了\s*了)+/g, "了"], [/(然后\s*然后)+/g, "然后"],
    [/(其实)/g, "事实上"], [/(我觉得|我感觉)/g, "我们认为"], [/(搞|弄)/g, "处理"],
    [/(的话)/g, "若"], [/(大概|差不多|大约)/g, "约"], [/(好多|很多)/g, "大量"],
    [/(靠谱|行)/g, "可行"], [/(事儿|事情)/g, "事项"], [/(现在目前|目前现在)/g, "目前"],
    [/\s{2,}/g, " "], [/([，。！？；])\1+/g, "$1"], [/(。|；)\s*([a-z一-龥])/g, (m, p, c) => p + c]
  ];
  local.polish = function (text) {
    let s = clean(text);
    POLISH_RULES.forEach(([re, rep]) => { s = s.replace(re, rep); });
    // 句末缺标点补全
    s = s.replace(/([一-龥a-zA-Z0-9）)])(\s*$)/g, "$1。");
    return clean(s);
  };

  // 改写：在润色基础上做同义词替换与句式微调
  const SYN = [
    ["重要", "关键"], ["必须", "应当"], ["使用", "采用"], ["增加", "提升"], ["减少", "降低"],
    ["帮助", "协助"], ["建立", "构建"], ["显示", "表明"], ["问题", "挑战"], ["方法", "路径"],
    ["提高", "优化"], ["分析", "研判"], ["解决", "应对"], ["完成", "落实"], ["需要", "应当"],
    ["非常", "尤为"], ["很多", "众多"], ["一些", "若干"], ["考虑", "兼顾"], ["说明", "阐述"]
  ];
  local.rewrite = function (text) {
    let s = local.polish(text);
    SYN.forEach(([a, b]) => { s = s.replace(new RegExp(a, "g"), b); });
    // 句式微调：把"因为X，所以Y"改为"X 导致了 Y"
    s = s.replace(/因为(.+?)[，,]\s*所以(.+)/g, "$1 直接推动了 $2");
    return clean(s);
  };

  // 扩写：基于关键词生成结构化展开
  local.expand = function (text) {
    const kws = topKeywords(text, 3);
    const kw = kws[0] || "该主题";
    const lead = splitSentences(text)[0] || "";
    return clean(
      (lead ? lead + "。" : "") +
      `进一步来看，${kw} 的相关内容值得深入探讨。具体而言，可以从以下几个维度展开：首先，需要明确 ${kw} 的定义与边界，避免概念混淆；其次，应结合实际情况分析其内在机理与影响因素；最后，关注 ${kw} 在实践中的应用路径与潜在价值。` +
      `此外，围绕 ${(kws[1] || kw)} 的协同配合，也能为整体方案提供更稳固的支撑。`
    );
  };

  // 续写：基于末尾主题推进
  local.continueWriting = function (text) {
    const kws = topKeywords(text, 3);
    const kw = kws[0] || "该议题";
    return clean(
      `在此基础上，我们需要进一步考量 ${kw} 的影响因素与边界条件。实践表明，科学的方法与清晰的流程能够显著提升执行效率。` +
      `面向未来，随着相关能力的成熟，${kw} 的应用场景也将持续丰富——从单点尝试走向体系化落地，最终实现可度量、可复制的价值闭环。`
    );
  };

  // 大纲：基于主题生成结构化大纲
  local.outline = function (topic) {
    const t = clean(topic) || "该主题";
    const kws = topKeywords(topic, 3);
    const k1 = kws[0] || t, k2 = kws[1] || t;
    return clean(
      `一、${t}的背景与意义\n` +
      `二、现状分析（含 ${k1} 的进展与瓶颈）\n` +
      `三、关键要点\n  3.1 ${k1} 的核心机制\n  3.2 ${k2} 的关键指标\n  3.3 风险与应对\n` +
      `四、实施建议（分阶段、可落地）\n` +
      `五、总结与展望`
    );
  };

  // 翻译：诚实的本地辅助版（术语对照 + 云端预留说明）
  const TERM = {
    "hello": "你好", "world": "世界", "file": "文件", "data": "数据", "system": "系统",
    "user": "用户", "network": "网络", "model": "模型", "api": "接口", "cloud": "云端",
    "local": "本地", "security": "安全", "privacy": "隐私", "document": "文档", "image": "图像",
    "text": "文本", "report": "报告", "analysis": "分析", "summary": "摘要", "project": "项目",
    "plan": "计划", "design": "设计", "test": "测试", "deploy": "部署", "service": "服务"
  };
  local.translate = function (text) {
    const s = clean(text);
    const enWords = (s.toLowerCase().match(/[a-z][a-z0-9\-]{1,}/g) || []).filter(w => TERM[w]);
    const hasCn = /[一-龥]/.test(s), hasEn = /[a-z]/i.test(s);
    let lang = "中文";
    if (hasCn && hasEn) lang = "中英混合"; else if (hasEn) lang = "英文"; else lang = "中文";
    const terms = enWords.length
      ? enWords.map(w => `${w} → ${TERM[w]}`).join("；") + "。"
      : "（未发现可对照的常用英文术语）";
    return clean(
      `【本地翻译 · 演示版】\n已识别语言：${lang}。\n常用术语对照：${terms}\n` +
      `说明：离线环境不提供整句神经翻译。请在「账户与存储」中配置云端翻译接口（兼容 OpenAI 风格）以启用完整译文；开启「数据不出域」时所有内容仅在本机处理。`
    );
  };

  // 解释：常见概念表 + 关键词提示
  const CONCEPT = {
    "ooxml": "OOXML（Office Open XML）是微软提出的基于 XML 的开放文档格式标准（ECMA-376 / ISO 29500），.docx/.xlsx/.pptx 均属此类，采用 ZIP 包 + XML 部件组织内容。",
    "ofd": "OFD（Open Fixed-layout Document）是我国国家标准版式文件格式（GB/T 33190），与 PDF 定位相似，强调版面固定、不可篡改，常用于公文与存档。",
    "pdf": "PDF（Portable Document Format）由 Adobe 提出的版式文件格式，跨平台保真显示，适合打印与分发。",
    "ai": "AI（人工智能）指让机器模拟人类认知的技术总称；在办公场景中常指文档理解、生成与自动化处理。",
    "协同": "协同编辑指多人在同一文档上实时或异步协作，通常依赖 CRDT/OT 算法保证无冲突合并。",
    "json": "JSON（JavaScript Object Notation）是轻量数据交换格式，易于人读与机器解析，常用于配置与接口。",
    "svg": "SVG（Scalable Vector Graphics）是基于 XML 的矢量图形格式，放大不失真，适合图表与图标。",
    "api": "API（应用程序接口）是不同软件之间交互的约定，分为本地调用与网络调用两类。",
    "缓存": "缓存是把高频访问数据暂存于更快介质以提速的机制；合理失效策略是难点。",
    "索引": "索引是加速检索的数据结构，以额外空间换取查询时间的大幅下降。",
    "crdt": "CRDT（无冲突复制数据类型）可在无中心协调下合并多副本修改，是离线优先协同的核心技术。"
  };
  local.explain = function (text) {
    const s = clean(text);
    const lower = s.toLowerCase();
    const hits = Object.keys(CONCEPT).filter(k => lower.includes(k));
    if (hits.length) {
      return clean(hits.map(k => `· ${k.toUpperCase()}：${CONCEPT[k]}`).join("\n"));
    }
    const kws = topKeywords(s, 5);
    return clean(
      `所选内容围绕「${kws.join("、")}」展开。\n建议从三个层面深入理解：` +
      `① 定义与边界；② 原理与机制；③ 应用场景与价值。如需针对具体术语解释，可在选中后再次点击「解释」。`
    );
  };

  // 审阅建议：本地诚实版——基于结构特征给出可落地的修改提示（非整句改写）
  local.critique = function (text) {
    const s = clean(text);
    if (!s) return "（未选中有效内容，无法给出建议。）";
    const sentences = splitSentences(s);
    const tips = [];
    if (s.length < 30) tips.push("内容偏短，建议补充具体细节或例证，增强说服力。");
    if (sentences.length >= 2 && !/(因此|所以|综上|总之|结论|可见|总体而言)/.test(s))
      tips.push("段落较长但缺少总结句，可在末尾补一句结论，帮助读者收束。");
    const filler = (s.match(/我觉得|我感觉|其实|然后|的话|大概|差不多|就是|应该说/g) || []).length;
    if (filler) tips.push("出现 " + filler + " 处口语化表达，可改为更书面的措辞以提升正式感。");
    const punct = (s.match(/[，,]。|[。；：，](\s*$)/g) || []).length;
    if (punct >= 2) tips.push("存在 " + punct + " 处标点使用可规范，注意句末统一用句号、避免中英文标点混用。");
    const kws = topKeywords(s, 3);
    if (kws.length) tips.push("核心关键词：" + kws.join("、") + "，可作为后续段落展开的主线。");
    const body = (tips.length ? tips : ["整体表达清晰，结构完整，未见明显问题。"]).join("\n");
    return clean("【AI 审阅建议】\n" + body);
  };

  const MODES = {
    summarize: { label: "总结", hint: "凝练全文要点" },
    polish: { label: "润色", hint: "更书面、更通顺" },
    rewrite: { label: "改写", hint: "换一种表达" },
    expand: { label: "扩写", hint: "展开论述" },
    continue: { label: "续写", hint: "接着写下去" },
    outline: { label: "大纲", hint: "生成结构" },
    translate: { label: "翻译", hint: "术语对照" },
    explain: { label: "解释", hint: "概念讲解" }
  };

  function runLocal(mode, text) {
    const fn = local[mode] || local.summarize;
    const out = fn(text || "");
    return out && out.trim() ? out.trim() : "（暂无足够内容可供处理，请先输入或选中文本。）";
  }

  /* ---------------- 云端流式（OpenAI 风格，可插拔） ---------------- */
  let provider = null;

  function setProvider(cfg) {
    provider = cfg && cfg.endpoint ? {
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey || "",
      model: cfg.model || "gpt-4o-mini",
      headers: cfg.headers || null
    } : null;
    if (OS && OS.settings) OS.settings.set("aiProvider", provider);
    return provider;
  }
  function getProvider() { return provider; }

  // 云端流式补全；无 provider 时抛错（由调用方回退本地）
  async function completeCloud({ system, user, onDelta, signal }) {
    if (!provider) throw new Error("no-provider");
    const headers = Object.assign({ "Content-Type": "application/json" }, provider.headers || {});
    if (provider.apiKey) headers["Authorization"] = "Bearer " + provider.apiKey;
    const resp = await fetch(provider.endpoint, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: provider.model,
        stream: true,
        messages: [
          { role: "system", content: system || "你是一个专业的办公助手。" },
          { role: "user", content: user || "" }
        ]
      })
    });
    if (!resp.ok) throw new Error("云端返回 " + resp.status);
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "", acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return acc;
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) { acc += d; onDelta && onDelta(d); }
        } catch (e) { /* 跳过非 JSON 行 */ }
      }
    }
    return acc;
  }

  // 把长文本切成流式片段（按标点/换行切，单段不超过 ~16 字）
  function streamChunks(text) {
    const raw = String(text || "").split(/([。！？；\n])/);
    const out = []; let buf = "";
    raw.forEach(p => {
      buf += p;
      if (/[。！？；\n]/.test(p) || buf.length >= 16) { out.push(buf); buf = ""; }
    });
    if (buf) out.push(buf);
    return out.length ? out : [text || ""];
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 统一入口：有 provider 且允许云端则走真实流式；否则本地模拟流式。
  // 返回 { text, source }，source 为 "cloud" 或 "local"，便于 UI 标注来源。
  async function run({ mode, system, user, onDelta, signal, allowCloud }) {
    const localOnly = !!(OS && OS.settings && OS.settings.get("dataLocalOnly"));
    if (provider && allowCloud !== false && !localOnly) {
      try {
        const text = await completeCloud({ system, user, onDelta, signal });
        return { text: text || "", source: "cloud" };
      } catch (e) {
        if (e.message !== "no-provider") OS && OS.toast && OS.toast("云端调用失败，已切换本地引擎：" + e.message, "warn");
      }
    }
    // 本地：模拟流式（按片段逐步回调，呈现打字机效果）
    const out = runLocal(mode, user);
    const chunks = streamChunks(out);
    for (const c of chunks) {
      if (signal && signal.aborted) break;
      onDelta && onDelta(c);
      await sleep(12);
    }
    return { text: out, source: "local" };
  }

  OS.AI = {
    local, runLocal, run, completeCloud,
    setProvider, getProvider,
    MODES,
    available: function () { return { local: true, cloud: !!provider }; },
    stripHtml
  };
})(window);
