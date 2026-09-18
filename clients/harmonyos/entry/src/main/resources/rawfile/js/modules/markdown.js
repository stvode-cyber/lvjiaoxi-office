/* ============================================================
   Markdown 编辑器 · 源码/所见即所得双模式
   对标 WPS 2026 / A3S Office 的 Markdown split view
   — 左栏源码 textarea + 右栏实时预览 div + 中间拖拽分隔条
   ============================================================ */
(function (global) {
  "use strict";

  // ---------- 轻量 Markdown → HTML（支持 GFM 常用语法） ----------
  function mdToHtml(md) {
    if (!md) return "";
    let src = md.replace(/\r\n/g, "\n");
    const out = [];
    const lines = src.split("\n");
    let i = 0;
    let inCode = false;
    let codeLang = "";
    let codeBuf = [];

    function fmtInline(t) {
      return t
        // [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
        // **bold**
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        // *italic*
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        // `code`
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        // --- → hr
        .replace(/^\s*---+\s*$/, "<hr>");
    }

    while (i < lines.length) {
      const line = lines[i];

      // 代码块 ```lang
      if (/^```/.test(line)) {
        if (!inCode) {
          inCode = true;
          codeLang = line.replace(/^```\s*/, "").trim();
          codeBuf = [];
        } else {
          inCode = false;
          out.push(`<pre><code${codeLang ? ' class="lang-' + codeLang + '"' : ""}>${OS.util.escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        }
        i++; continue;
      }
      if (inCode) { codeBuf.push(line); i++; continue; }

      // 标题 # / ## / ### ...
      const h = line.match(/^(#{1,6})\s+(.+)/);
      if (h) { out.push(`<h${h[1].length}>${fmtInline(h[2])}</h${h[1].length}>`); i++; continue; }

      // 引用 >
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
        out.push(`<blockquote>${fmtInline(buf.join("<br>"))}</blockquote>`);
        continue;
      }

      // 列表 - 或 *
      if (/^[\-\*]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^[\-\*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^[\-\*]\s+/, "")); i++; }
        out.push("<ul>" + buf.map(x => `<li>${fmtInline(x)}</li>`).join("") + "</ul>");
        continue;
      }

      // 有序列表 1. 2.
      if (/^\d+\.\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
        out.push("<ol>" + buf.map(x => `<li>${fmtInline(x)}</li>`).join("") + "</ol>");
        continue;
      }

      // 分隔线
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

      // 空行
      if (!line.trim()) { i++; continue; }

      // 普通段落：收集连续非空行
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !/^[\-\*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^```/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push(`<p>${fmtInline(buf.join("<br>"))}</p>`);
    }
    return out.join("\n");
  }

  // ---------- 空白模板 ----------
  function blank() {
    return {
      mode: "split",       // "source" | "preview" | "split"
      source: "# 新建文档\n\n在这里写 Markdown...\n\n## 二级标题\n\n- 列表项 1\n- 列表项 2\n\n**粗体**  *斜体*  `代码`\n\n> 引用块\n\n```javascript\nconsole.log('hello');\n```\n",
      html: ""
    };
  }

  // ---------- mount ----------
  function mount(host, doc, ctx) {


    // Undo/Redo：用 textarea 原生栈 + 暴露给 OS.Undo
    function undo() { try { document.execCommand("undo"); } catch (e) {} return true; }
    function redo() { try { document.execCommand("redo"); } catch (e) {} return true; }
    const data = (doc.data && typeof doc.data.source === "string") ? doc.data : blank();
    if (!data.html) data.html = mdToHtml(data.source);
    let mode = data.mode || "split";

    host.innerHTML = "";
    host.style.cssText = "position:relative;height:100%;overflow:hidden;display:flex;flex-direction:column;";

    // 顶部模式切换栏
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:4px;padding:6px 12px;background:var(--chrome);border-bottom:1px solid var(--rule);align-items:center;";
    ["split", "source", "preview"].forEach((m) => {
      const btn = document.createElement("button");
      btn.textContent = m === "split" ? "分栏" : m === "source" ? "源码" : "预览";
      btn.dataset.mode = m;
      btn.style.cssText = "padding:4px 12px;border-radius:4px;font-size:12px;cursor:pointer;border:1px solid transparent;";
      btn.addEventListener("click", () => {
        mode = m;
        updateLayout();
        updateBar();
      });
      bar.appendChild(btn);
    });
    host.appendChild(bar);

    function updateBar() {
      [...bar.children].forEach((b) => {
        if (b.dataset.mode === mode) {
          b.style.background = "var(--accent)";
          b.style.color = "var(--accent-ink)";
        } else {
          b.style.background = "var(--hover)";
          b.style.color = "var(--ink)";
          b.style.border = "1px solid var(--rule)";
        }
      });
    }

    // 主内容区
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;position:relative;";
    host.appendChild(main);

    // 源码 textarea
    const src = document.createElement("textarea");
    src.value = data.source;
    src.placeholder = "# 在这里写 Markdown...";
    src.style.cssText = "flex:1;padding:16px;border:none;outline:none;resize:none;background:var(--bg2);color:var(--ink);font-family:var(--mono);font-size:14px;line-height:1.6;overflow:auto;tab-size:2;";
    src.addEventListener("input", () => {
      data.source = src.value;
      data.html = mdToHtml(src.value);
      preview.innerHTML = data.html;
      ctx.markDirty && ctx.markDirty();
    });
    src.addEventListener("keydown", (e) => {
      // Tab 插入两个空格
      if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); }
    });

    // 分隔条
    const splitter = document.createElement("div");
    splitter.style.cssText = "width:4px;background:var(--rule);cursor:col-resize;display:none;";
    let dragging = false;
    let startX = 0, startFlex = 0;
    splitter.addEventListener("mousedown", (e) => { dragging = true; startX = e.clientX; startFlex = parseFloat(src.style.flex || 1); e.preventDefault(); });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const total = main.clientWidth;
      const ratio = Math.max(0.15, Math.min(0.85, (startFlex * 100 + (dx / total) * 100) / 100));
      src.style.flex = ratio;
      preview.style.flex = (1 - ratio);
    });
    document.addEventListener("mouseup", () => { dragging = false; });

    // 预览 div
    const preview = document.createElement("div");
    preview.innerHTML = data.html;
    preview.style.cssText = "flex:1;padding:24px;background:var(--bg);color:var(--ink);overflow:auto;font-family:var(--font);line-height:1.7;";
    // 预览区基础样式（内联，不依赖外部 CSS）
    preview.style.cssText += ";word-wrap:break-word;";
    // 注入 heading 样式
    const _style = document.createElement("style");
    _style.textContent = `
      #markdown-preview h1{font-size:28px;margin:16px 0 12px;border-bottom:1px solid var(--rule);padding-bottom:8px}
      #markdown-preview h2{font-size:22px;margin:14px 0 10px;border-bottom:1px solid var(--rule2);padding-bottom:6px}
      #markdown-preview h3{font-size:18px;margin:12px 0 8px}
      #markdown-preview h4{font-size:16px;margin:10px 0 6px}
      #markdown-preview p{margin:8px 0}
      #markdown-preview ul,#markdown-preview ol{margin:8px 0;padding-left:24px}
      #markdown-preview li{margin:2px 0}
      #markdown-preview blockquote{border-left:3px solid var(--accent);padding:4px 12px;margin:8px 0;background:var(--accent-soft);border-radius:0 4px 4px 0}
      #markdown-preview code{background:var(--hover);padding:1px 6px;border-radius:3px;font-family:var(--mono);font-size:13px}
      #markdown-preview pre{background:var(--bg2);border:1px solid var(--rule);border-radius:4px;padding:12px;margin:10px 0;overflow:auto}
      #markdown-preview pre code{background:transparent;padding:0;border:none}
      #markdown-preview hr{border:none;border-top:1px solid var(--rule);margin:16px 0}
      #markdown-preview a{color:var(--accent);text-decoration:none}
      #markdown-preview a:hover{text-decoration:underline}
    `;
    document.head.appendChild(_style);
    preview.id = "markdown-preview";

    main.appendChild(src);
    main.appendChild(splitter);
    main.appendChild(preview);

    function updateLayout() {
      if (mode === "split") {
        src.style.display = ""; preview.style.display = ""; splitter.style.display = "";
        src.style.flex = 1; preview.style.flex = 1;
      } else if (mode === "source") {
        src.style.display = ""; preview.style.display = "none"; splitter.style.display = "none";
      } else {
        src.style.display = "none"; preview.style.display = ""; splitter.style.display = "none";
      }
      data.mode = mode;
    }
    updateLayout();
    updateBar();

    // 暴露导出
    function saveNow() {
      doc.data = data;
    }

    // 暴露 toMarkdown / toHtml 方便导出
    function toMarkdown() { return data.source; }
    function toHtml() { return data.html || mdToHtml(data.source); }

    // 自动保存到 store（节流）
    let saveTimer = null;
    ctx.markDirty && ctx.markDirty();
    const origMark = ctx.markDirty;
    ctx.markDirty = () => {
      origMark && origMark();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (ctx.saveNow) ctx.saveNow();
      }, 800);
    };

    return {
      el: host,
      saveNow,
      toMarkdown,
      toHtml,
      undo,
      redo,
      canUndo: () => true,
      canRedo: () => true,
      getSource: () => src.value,
      setSource: (txt) => { src.value = txt; data.source = txt; data.html = mdToHtml(txt); preview.innerHTML = data.html; },
      destroy: () => { /* 清理 */ }
    };
  }

  // 注册到 OS
  if (global.OS) {
    OS.modules = OS.modules || {};
    OS.modules.markdown = { type: "markdown", blank, mount };

    // 注册 blankDoc
    const prevBlank = OS.blankDoc;
    OS.blankDoc = function (t) {
      if (t === "markdown") return blank();
      return prevBlank ? prevBlank(t) : { type: t, data: {} };
    };
  }
})(window);
