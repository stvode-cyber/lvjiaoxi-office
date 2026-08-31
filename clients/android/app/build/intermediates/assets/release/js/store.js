/* ============================================================
   绿角犀 Office · 统一存储 (IndexedDB) + UOM 文档模型
   对应 PRD：附录 A 数据模型与存储 / 本地优先 / 离线可用
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const DB_NAME = "lvjiaoxi-office";
  const STORE = "docs";
  const VER = 1;

  let dbp = null;
  const memFallback = new Map(); // localStorage 不可用时的内存兜底

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error("no-idb")); return; }
      const req = indexedDB.open(DB_NAME, VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(mode) {
    return openDB().then(db => db.transaction(STORE, mode).objectStore(STORE));
  }

  const idbAvailable = () => !!global.indexedDB;

  // ---------- API ----------
  const Store = {
    async init() {
      try { await openDB(); OS._storeMode = "indexeddb"; }
      catch { OS._storeMode = "localstorage"; }
      return OS._storeMode;
    },

    async list() {
      if (OS._storeMode === "localstorage") return [...memFallback.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      const store = await tx("readonly");
      return new Promise((res, rej) => {
        const out = [];
        const cur = store.openCursor();
        cur.onsuccess = e => {
          const c = e.target.result;
          if (c) { out.push(c.value); c.continue(); }
          else res(out.sort((a, b) => b.updatedAt - a.updatedAt));
        };
        cur.onerror = () => rej(cur.error);
      });
    },

    async get(id) {
      if (OS._storeMode === "localstorage") return memFallback.get(id) || null;
      const store = await tx("readonly");
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    },

    async put(doc) {
      doc.updatedAt = Date.now();
      doc.size = JSON.stringify(doc.data || {}).length;
      if (OS._storeMode === "localstorage") { memFallback.set(doc.id, doc); return doc; }
      const store = await tx("readwrite");
      return new Promise((res, rej) => {
        const r = store.put(doc);
        r.onsuccess = () => res(doc);
        r.onerror = () => rej(r.error);
      });
    },

    async remove(id) {
      if (OS._storeMode === "localstorage") { memFallback.delete(id); return; }
      const store = await tx("readwrite");
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res(); r.onerror = () => rej(r.error);
      });
    },

    // 新建空白文档（基于类型模板）
    async create(meta) {
      const tpl = OS.blankDoc ? OS.blankDoc(meta.type) : { type: meta.type, data: {} };
      const doc = Object.assign({
        id: OS.util.uid(meta.type),
        type: meta.type,
        name: meta.name || defaultName(meta.type),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        compat: "A"
      }, tpl);
      return this.put(doc);
    }
  };

  function defaultName(type) {
    return { writer: "未命名文档", spreadsheet: "未命名表格", presentation: "未命名演示", pdf: "PDF 文件", mindmap: "未命名脑图" }[type] || "未命名";
  }

  OS.store = Store;
  OS.docMeta = { defaultName };

  // 兼容等级含义
  OS.COMPAT = {
    A: { label: "完全兼容", color: "var(--ok)", desc: "OOXML 元素完整保留，可往返编辑无损" },
    B: { label: "基本兼容", color: "var(--warn)", desc: "视觉一致，部分高级特性降级" },
    C: { label: "只读兼容", color: "var(--danger)", desc: "仅查看，编辑可能丢失格式" }
  };

  // 类型图标/中文名
  OS.TYPE_INFO = {
    writer: { ico: "📝", name: "文档", ext: "docx" },
    spreadsheet: { ico: "📊", name: "表格", ext: "xlsx" },
    presentation: { ico: "📽️", name: "演示", ext: "pptx" },
    mindmap: { ico: "🧠", name: "脑图", ext: "json" },
    pdf: { ico: "📄", name: "PDF", ext: "pdf" }
  };
})(window);
