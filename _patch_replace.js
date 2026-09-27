const fs = require("fs");
const path = require("path");
function patch(file, reps) {
  let s = fs.readFileSync(file, "utf8");
  for (const [oldStr, newStr] of reps) {
    if (!s.includes(oldStr)) { console.log("  MISS: " + oldStr.slice(0,40)); return false; }
    s = s.replace(oldStr, newStr);
  }
  fs.writeFileSync(file, s, "utf8");
  console.log("  OK: " + path.basename(file));
  return true;
}
const D = "app/js/modules";

// MindMap
patch(path.join(D,"mindmap.js"), [
  ['          <input class="sf-find sf-input" placeholder="查找节点文本..." />\n          <label class="sf-case"><input type="checkbox" /> 区分大小写</label>\n          <div class="sf-count"></div>\n          <div class="sf-find-btns">\n            <button class="btn" data-sf="prev">↑ 上一个</button>\n            <button class="btn" data-sf="next">↓ 下一个</button>\n          </div>',
   '          <input class="sf-find sf-input" placeholder="查找节点文本..." />\n          <input class="sf-repl sf-input" placeholder="替换为..." />\n          <label class="sf-case"><input type="checkbox" /> 区分大小写</label>\n          <div class="sf-count"></div>\n          <div class="sf-find-btns">\n            <button class="btn" data-sf="prev">↑ 上一个</button>\n            <button class="btn" data-sf="next">↓ 下一个</button>\n            <button class="btn" data-sf="repl">替换当前</button>\n            <button class="btn primary" data-sf="replall">替换全部</button>\n          </div>'],
  ['    _mmFind.overlay.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => {\n      if (b.dataset.sf === "prev") _mmFindGoto(-1); else _mmFindGoto(1);\n    });',
   '    _mmFind.overlay.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => {\n      const k = b.dataset.sf;\n      if (k === "prev") _mmFindGoto(-1);\n      else if (k === "next") _mmFindGoto(1);\n      else if (k === "repl") _mmFindReplace();\n      else if (k === "replall") _mmReplaceAll();\n    });'],
  ['  function _mmFindClear() { _mmClear(); _mmFind.hits = []; _mmFind.idx = -1; }\n\n  OS.modules = OS.modules || {};',
   '  function _mmFindClear() { _mmClear(); _mmFind.hits = []; _mmFind.idx = -1; }\n  function _mmFindReplace() {\n    if (!_mmFind.hits.length) return OS.toast("无匹配可替换", "warn");\n    const cur = _mmFind.hits[_mmFind.idx]; if (!cur) return;\n    const q = _mmFind.overlay.querySelector(".sf-find").value;\n    const rep = _mmFind.overlay.querySelector(".sf-repl").value;\n    const matchCase = _mmFind.overlay.querySelector(".sf-case input").checked;\n    const tc = cur.textContent || "";\n    const qc = matchCase ? q : q.toLowerCase();\n    const idx = matchCase ? tc.indexOf(q) : tc.toLowerCase().indexOf(qc);\n    if (idx === -1) return OS.toast("当前节点不含查询词", "warn");\n    cur.textContent = tc.slice(0, idx) + rep + tc.slice(idx + q.length);\n    OS.toast("已替换 1 处", "ok"); _mmFindRun(); _mmFindGoto(_mmFind.idx);\n  }\n  function _mmReplaceAll() {\n    if (!_mmFind.hits.length) return OS.toast("无匹配可替换", "warn");\n    const q = _mmFind.overlay.querySelector(".sf-find").value;\n    const rep = _mmFind.overlay.querySelector(".sf-repl").value;\n    const matchCase = _mmFind.overlay.querySelector(".sf-case input").checked;\n    const qc = matchCase ? q : q.toLowerCase(); let n = 0;\n    const esc = q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");\n    const regex = new RegExp(esc, matchCase ? "g" : "gi");\n    _mmFind.hits.forEach(t => {\n      const tc = t.textContent || "";\n      if (matchCase ? tc.includes(q) : tc.toLowerCase().includes(qc)) {\n        t.textContent = tc.replace(regex, rep); n++;\n      }\n    });\n    OS.toast("已替换 " + n + " 处", "ok"); _mmFindRun();\n  }\n\n  OS.modules = OS.modules || {};']
]);

// Presentation
patch(path.join(D,"presentation.js"), [
  ['          <div class="sf-find-btns">\n            <button class="btn" data-sf="prev">↑ 上一个</button>\n            <button class="btn" data-sf="next">↓ 下一个</button>\n          </div>',
   '          <div class="sf-find-btns">\n            <button class="btn" data-sf="prev">↑ 上一个</button>\n            <button class="btn" data-sf="next">↓ 下一个</button>\n            <button class="btn" data-sf="repl">替换当前</button>\n            <button class="btn primary" data-sf="replall">替换全部</button>\n          </div>'],
  ['    _prFind.overlay.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => {\n      if (b.dataset.sf === "prev") _prFindGoto(-1); else _prFindGoto(1);\n    });',
   '    _prFind.overlay.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => {\n      const k = b.dataset.sf;\n      if (k === "prev") _prFindGoto(-1);\n      else if (k === "next") _prFindGoto(1);\n      else if (k === "repl") _prFindReplace();\n      else if (k === "replall") _prReplaceAll();\n    });'],
  ['  function _prFindClear() { _prClear(); _prFind.hits = []; _prFind.idx = -1; }\n\n  OS.modules = OS.modules || {};',
   '  function _prFindClear() { _prClear(); _prFind.hits = []; _prFind.idx = -1; }\n  function _prFindReplace() {\n    if (!_prFind.hits.length) return OS.toast("无匹配可替换", "warn");\n    const cur = _prFind.hits[_prFind.idx];\n    if (!cur || !cur.nodeValue) return;\n    const q = _prFind.overlay.querySelector(".sf-find").value;\n    const rep = _prFind.overlay.querySelector(".sf-repl").value || "";\n    const matchCase = _prFind.overlay.querySelector(".sf-case input").checked;\n    const nv = cur.nodeValue;\n    const qc = matchCase ? q : q.toLowerCase();\n    const idx = matchCase ? nv.indexOf(q) : nv.toLowerCase().indexOf(qc);\n    if (idx === -1) return OS.toast("当前节点不含查询词", "warn");\n    cur.nodeValue = nv.slice(0, idx) + rep + nv.slice(idx + q.length);\n    OS.toast("已替换 1 处", "ok"); _prFindRun(); _prFindGoto(_prFind.idx);\n  }\n  function _prReplaceAll() {\n    if (!_prFind.hits.length) return OS.toast("无匹配可替换", "warn");\n    const q = _prFind.overlay.querySelector(".sf-find").value;\n    const rep = _prFind.overlay.querySelector(".sf-repl").value || "";\n    const matchCase = _prFind.overlay.querySelector(".sf-case input").checked;\n    const qc = matchCase ? q : q.toLowerCase(); let n = 0;\n    const esc = q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");\n    const regex = new RegExp(esc, matchCase ? "g" : "gi");\n    _prFind.hits.forEach(h => {\n      if (!h.nodeValue) return;\n      const nv = h.nodeValue;\n      if (matchCase ? nv.includes(q) : nv.toLowerCase().includes(qc)) {\n        h.nodeValue = nv.replace(regex, rep); n++;\n      }\n    });\n    OS.toast("已替换 " + n + " 处", "ok"); _prFindRun();\n  }\n\n  OS.modules = OS.modules || {};']
]);
