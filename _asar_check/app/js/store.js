/* ============================================================
   绿角犀 Office · 统一存储 (IndexedDB) + UOM 文档模型
   对应 PRD：附录 A 数据模型与存储 / 本地优先 / 离线可用
   增强（账户系统）：按账户隔离库、备档 store、50M 配额
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const BASE = "lvjiaoxi-office";
  const STORE_DOCS = "docs";
  const STORE_BACKUPS = "backups";
  const VER = 2;

  let dbp = null;
  const memDocs = new Map();     // localStorage 不可用时的内存兜底（文档）
  const memBackups = new Map();  // 内存兜底（备档）

  // .lvjx 可选口令加密（PBKDF2-SHA256 + AES-GCM-256）
  function bufToB64(buf) { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function b64ToBuf(b64) { const s = atob(b64); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
  async function deriveKey(pass, salt, iter) {
    const enc = new TextEncoder();
    const mat = await global.crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return global.crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptEnvelope(payload, pass) {
    const enc = new TextEncoder();
    const salt = global.crypto.getRandomValues(new Uint8Array(16));
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt, 150000);
    const ct = await global.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload)));
    return { format: "lvjx-space", version: 1, encrypted: true, kdf: "PBKDF2-SHA256", iterations: 150000, salt: bufToB64(salt), iv: bufToB64(iv), cipher: bufToB64(new Uint8Array(ct)), hint: payload.account || "" };
  }
  async function decryptEnvelope(env, pass) {
    const salt = b64ToBuf(env.salt), iv = b64ToBuf(env.iv);
    const key = await deriveKey(pass, salt, env.iterations || 150000);
    const pt = await global.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBuf(env.cipher));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // 当前账户（未登录时为 anon）
  function accountName() {
    const a = (OS.auth && OS.auth.current && OS.auth.current.username) || "anon";
    return a;
  }
  function dbName() {
    return (OS.auth && OS.auth.dbNameFor) ? OS.auth.dbNameFor(accountName()) : (BASE + "-" + accountName());
  }

  function openDB() {
    if (dbp) return dbp;
    if (!global.indexedDB) { dbp = Promise.reject(new Error("no-idb")); return dbp; }
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName(), VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          db.createObjectStore(STORE_DOCS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
          const bs = db.createObjectStore(STORE_BACKUPS, { keyPath: "id" });
          bs.createIndex("docId", "docId", { unique: false });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(mode, storeName) {
    return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
  }

  const idbAvailable = () => !!global.indexedDB;

  // ---------- API ----------
  const Store = {
    async init() {
      dbp = null; // 每次初始化重置（账户可能切换）
      try { await openDB(); OS._storeMode = "indexeddb"; }
      catch (e) { OS._storeMode = "localstorage"; }
      return OS._storeMode;
    },

    async list() {
      if (OS._storeMode === "localstorage") return [...memDocs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      const store = await tx("readonly", STORE_DOCS);
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
      if (OS._storeMode === "localstorage") return memDocs.get(id) || null;
      const store = await tx("readonly", STORE_DOCS);
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    },

    async put(doc) {
      doc.updatedAt = Date.now();
      doc.size = JSON.stringify(doc.data || {}).length;
      if (OS._storeMode === "localstorage") { memDocs.set(doc.id, doc); return doc; }
      const store = await tx("readwrite", STORE_DOCS);
      return new Promise((res, rej) => {
        const r = store.put(doc);
        r.onsuccess = () => res(doc);
        r.onerror = () => rej(r.error);
      });
    },

    async remove(id) {
      if (OS._storeMode === "localstorage") { memDocs.delete(id); return; }
      const store = await tx("readwrite", STORE_DOCS);
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
    },

    // ---------- 备档（每隔 N 分钟自动调用） ----------
    async backup(doc) {
      const snap = {
        id: OS.util.uid("bk"),
        docId: doc.id,
        docName: doc.name,
        type: doc.type,
        data: doc.data,
        size: JSON.stringify(doc.data || {}).length,
        createdAt: Date.now()
      };
      if (OS._storeMode === "localstorage") { memBackups.set(snap.id, snap); await this.pruneBackups(doc.id); return snap; }
      const store = await tx("readwrite", STORE_BACKUPS);
      return new Promise((res, rej) => {
        const r = store.put(snap);
        r.onsuccess = () => { this.pruneBackups(doc.id); res(snap); };
        r.onerror = () => rej(r.error);
      });
    },

    // 对当前账户所有文档各备档一次
    async backupAll(docs) {
      docs = docs || (await this.list());
      let n = 0;
      for (const d of docs) {
        try { await this.backup(d); n++; } catch (e) { console.error("backup failed", d.id, e); }
      }
      return n;
    },

    async listBackups(docId) {
      if (OS._storeMode === "localstorage") {
        return [...memBackups.values()].filter(b => b.docId === docId).sort((a, b) => b.createdAt - a.createdAt);
      }
      const store = await tx("readonly", STORE_BACKUPS);
      return new Promise((res, rej) => {
        const out = [];
        const cur = store.index("docId").openCursor(IDBKeyRange.only(docId));
        cur.onsuccess = e => {
          const c = e.target.result;
          if (c) { out.push(c.value); c.continue(); }
          else res(out.sort((a, b) => b.createdAt - a.createdAt));
        };
        cur.onerror = () => rej(cur.error);
      });
    },

    async listAllBackups() {
      if (OS._storeMode === "localstorage") return [...memBackups.values()].sort((a, b) => b.createdAt - a.createdAt);
      const store = await tx("readonly", STORE_BACKUPS);
      return new Promise((res, rej) => {
        const out = [];
        const cur = store.openCursor();
        cur.onsuccess = e => {
          const c = e.target.result;
          if (c) { out.push(c.value); c.continue(); }
          else res(out.sort((a, b) => b.createdAt - a.updatedAt));
        };
        cur.onerror = () => rej(cur.error);
      });
    },

    async getBackup(id) {
      if (OS._storeMode === "localstorage") return memBackups.get(id) || null;
      const store = await tx("readonly", STORE_BACKUPS);
      return new Promise((res, rej) => {
        const r = store.get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    },

    // 直接写入一条备档快照（云端同步拉取 / 迁移导入使用；不触发自动 prune）
    async putBackup(snap) {
      if (!snap || !snap.id) throw new Error("备档无效");
      if (OS._storeMode === "localstorage") { memBackups.set(snap.id, snap); return snap; }
      const store = await tx("readwrite", STORE_BACKUPS);
      return new Promise((res, rej) => {
        const r = store.put(snap);
        r.onsuccess = () => res(snap);
        r.onerror = () => rej(r.error);
      });
    },

    async removeBackup(id) {
      if (OS._storeMode === "localstorage") { memBackups.delete(id); return; }
      const store = await tx("readwrite", STORE_BACKUPS);
      return new Promise((res, rej) => {
        const r = store.delete(id);
        r.onsuccess = () => res(); r.onerror = () => rej(r.error);
      });
    },

    // 每文档仅保留最近 MAX_BACKUPS 份（最新的在前）
    async pruneBackups(docId) {
      const max = (OS.auth && OS.auth.MAX_BACKUPS) || 20;
      const list = await this.listBackups(docId);
      if (list.length <= max) return;
      const toDelete = list.slice(max); // listBackups 已倒序，尾部为最旧
      for (const b of toDelete) await this.removeBackup(b.id);
    },

    // 回滚：用备档覆盖原文档（保留 docId）
    async restoreBackup(id) {
      const b = await this.getBackup(id);
      if (!b) throw new Error("备档不存在");
      const prev = await this.get(b.docId);
      const doc = {
        id: b.docId, type: b.type, name: b.docName, data: b.data,
        createdAt: (prev && prev.createdAt) || Date.now(),
        updatedAt: Date.now(), compat: "A"
      };
      return this.put(doc);
    },

    // ---------- 配额（50 MB 个人空间） ----------
    quota() { return (OS.auth && OS.auth.QUOTA) || (50 * 1024 * 1024); },
    async spaceUsed() {
      const docs = await this.list();
      const backups = await this.listAllBackups();
      let total = 0;
      docs.forEach(d => total += (d.size || 0));
      backups.forEach(b => total += (b.size || 0));
      return total;
    },
    async withinQuota(extra) {
      return (await this.spaceUsed()) + (extra || 0) <= this.quota();
    },
    async docBytes() { const d = await this.list(); let t = 0; d.forEach(x => t += (x.size || 0)); return t; },
    async backupBytes() { const b = await this.listAllBackups(); let t = 0; b.forEach(x => t += (x.size || 0)); return t; },

    // ---------- 个人空间导出 / 导入（迁移 / 外部备份） ----------
    async exportSpace(opts) {
      opts = opts || {};
      const docs = await this.list();
      const backups = await this.listAllBackups();
      const payload = {
        format: "lvjx-space",
        version: 1,
        exportedAt: Date.now(),
        account: accountName(),
        docs: docs.map(d => ({
          id: d.id, type: d.type, name: d.name, data: d.data,
          createdAt: d.createdAt, updatedAt: d.updatedAt, compat: d.compat, size: d.size
        })),
        backups: backups.map(b => ({
          id: b.id, docId: b.docId, docName: b.docName, type: b.type,
          data: b.data, size: b.size, createdAt: b.createdAt
        }))
      };
      if (opts.passphrase) return await encryptEnvelope(payload, opts.passphrase);
      return payload;
    },

    async importSpace(data, opts) {
      opts = opts || {};
      let payload = data;
      if (data && data.encrypted) {
        if (!opts.passphrase) throw new Error("该文件已加密，请先输入导出口令");
        try { payload = await decryptEnvelope(data, opts.passphrase); }
        catch (e) { throw new Error("解密失败：口令错误或文件已损坏"); }
      }
      if (!payload || payload.format !== "lvjx-space" || !Array.isArray(payload.docs))
        throw new Error("文件格式不支持或已损坏");
      if (opts.replace) {
        const all = await this.list(); for (const d of all) await this.remove(d.id);
        const bks = await this.listAllBackups(); for (const b of bks) await this.removeBackup(b.id);
      }
      let docCount = 0, bkCount = 0;
      for (const d of payload.docs) {
        if (!d || !d.id) continue;
        const doc = {
          id: d.id, type: d.type, name: d.name, data: d.data,
          createdAt: d.createdAt || Date.now(), updatedAt: d.updatedAt || Date.now(),
          compat: d.compat || "A", size: d.size || (JSON.stringify(d.data || {}).length)
        };
        await this.put(doc); docCount++;
      }
      const bks = payload.backups || [];
      if (OS._storeMode === "localstorage") {
        for (const b of bks) { if (b && b.id) { memBackups.set(b.id, b); bkCount++; } }
      } else {
        const store = await tx("readwrite", STORE_BACKUPS);
        for (const b of bks) {
          if (!b || !b.id) continue;
          await new Promise((res, rej) => { const r = store.put(b); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
          bkCount++;
        }
      }
      return { docs: docCount, backups: bkCount };
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
