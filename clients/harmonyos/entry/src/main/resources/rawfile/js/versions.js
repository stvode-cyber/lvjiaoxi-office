/* ============================================================
  绿角犀 Office · 历史版本快照 + Diff
  独立于内存 undoStack —— 持久化到 IndexedDB
  触发：AI edit 前强制存 + markDirty debounce 5s 自动存
  API: OS.Versions.save / list / get / diff / revert / prune
  ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS;
  const MAX_PER_DOC = 50; // 每个文档最多保留 50 个版本
  const MAX_AUTO_INTERVAL = 30000; // 自动快照最小间隔 30 秒

  // IndexedDB 写操作（复用 store.js 的 dbName/VER）
  async function _tx(mode) {
    // 用 store.js 暴露的常量（避免硬编码）
    const dbName = (OS.store && typeof OS.store.dbName === "function") ? OS.store.dbName() : "lvjiaoxi-office-default";
    const ver = (OS.store && OS.store.VER) || 3;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, ver);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("versions")) {
          reject(new Error("versions store 未就绪（DB 版本过低，请重启应用）"));
          return;
        }
        resolve(db.transaction("versions", mode).objectStore("versions"));
      };
      req.onerror = () => reject(req.error);
    });
  }

  function _uid() { return "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6); }

  // ---------------- 简易 diff（按字符/按行，通用跨格式） ----------------
  /** 两个字符串的行级 diff，返回 {added: [], removed: [], unchanged: []} */
  function _lineDiff(a, b) {
    const la = (a || "").split(/\n/), lb = (b || "").split(/\n/);
    const m = la.length, n = lb.length;
    // LCS（最长公共子序列）— O(mn)
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = la[i - 1] === lb[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    // 回溯
    const added = [], removed = [], unchanged = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && la[i - 1] === lb[j - 1]) { unchanged.unshift({ text: la[i - 1], lnB: j - 1 }); i--; j--; }
      else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { added.unshift({ text: lb[j - 1], lnB: j - 1 }); j--; }
      else { removed.unshift({ text: la[i - 1], lnA: i - 1 }); i--; }
    }
    return { added, removed, unchanged };
  }

  // ---------------- 主 API ----------------
  const Versions = {
    /**
     * 存快照
     * @param {string} docId 文档 ID
     * @param {any} state 序列化后的文档状态（JSON-safe）
     * @param {object} [opts] { label, reason }  label 用于手动命名，reason 内部标记 (ai-edit/auto-save/manual)
     */
    async save(docId, state, opts) {
      if (!docId) { console.warn("[Versions] 缺少 docId"); return null; }
      opts = opts || {};
      try {
        const id = _uid();
        const ts = Date.now();
        const rec = {
          id,
          docId,
          ts,
          label: opts.label || new Date(ts).toLocaleString(),
          reason: opts.reason || "manual",
          state,
          size: JSON.stringify(state).length
        };
        const store = await _tx("readwrite");
        await new Promise((res, rej) => {
          const r = store.put(rec);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        });
        await Versions.prune(docId);
        console.info("[Versions] save:", docId, new Date(ts).toLocaleTimeString(), "reason=" + opts.reason);
        return rec;
      } catch (e) {
        console.warn("[Versions] save 失败:", e.message);
        return null;
      }
    },

    /** 列出文档所有版本（按时间倒序） */
    async list(docId) {
      if (!docId) return [];
      try {
        const store = await _tx("readonly");
        const idx = store.index("docId");
        return new Promise((res, rej) => {
          const r = idx.getAll(IDBKeyRange.only(docId));
          r.onsuccess = () => res((r.result || []).sort((a, b) => b.ts - a.ts));
          r.onerror = () => rej(r.error);
        });
      } catch (e) {
        console.warn("[Versions] list 失败:", e.message);
        return [];
      }
    },

    /** 取单个版本 */
    async get(id) {
      if (!id) return null;
      try {
        const store = await _tx("readonly");
        return new Promise((res, rej) => {
          const r = store.get(id);
          r.onsuccess = () => res(r.result || null);
          r.onerror = () => rej(r.error);
        });
      } catch (e) { return null; }
    },

    /** 清理：超过 MAX_PER_DOC 的版本删掉最老的 */
    async prune(docId) {
      try {
        const list = await Versions.list(docId);
        if (list.length > MAX_PER_DOC) {
          const store = await _tx("readwrite");
          for (let i = MAX_PER_DOC; i < list.length; i++) {
            await new Promise((res, rej) => {
              const r = store.delete(list[i].id);
              r.onsuccess = () => res();
              r.onerror = () => rej(r.error);
            });
          }
        }
      } catch (e) { /* 静默失败 */ }
    },

    /** 删除一个版本 */
    async remove(id) {
      try {
        const store = await _tx("readwrite");
        return new Promise((res, rej) => {
          const r = store.delete(id);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        });
      } catch (e) { /* noop */ }
    },

    /**
     * 对比两个版本的差异（文本 diff）
     * @returns {object} { a, b, added, removed, summary }
     */
    async diff(idA, idB) {
      const va = await Versions.get(idA);
      const vb = await Versions.get(idB);
      if (!va || !vb) return null;
      const sa = typeof va.state === "string" ? va.state : JSON.stringify(va.state, null, 2);
      const sb = typeof vb.state === "string" ? vb.state : JSON.stringify(vb.state, null, 2);
      const diff = _lineDiff(sa, sb);
      return {
        a: { ts: va.ts, label: va.label, date: new Date(va.ts).toLocaleString() },
        b: { ts: vb.ts, label: vb.label, date: new Date(vb.ts).toLocaleString() },
        added: diff.added,
        removed: diff.removed,
        unchanged: diff.unchanged,
        summary: {
          addedCount: diff.added.length,
          removedCount: diff.removed.length,
          unchangedCount: diff.unchanged.length
        }
      };
    },

    /**
     * 回退到某个版本 — 不是真的写 Store（那是各模块的事）
     * 而是**返回该版本的 state**，让调用方决定怎么恢复
     * 同时自动存一个"回退前快照"，让用户还能 undo
     */
    async revert(docId, targetId) {
      const target = await Versions.get(targetId);
      if (!target) return null;
      const curDoc = await OS.store.get(docId);
      if (curDoc && curDoc.data) {
        // 存一个回退前快照
        await Versions.save(docId, curDoc.data, { reason: "pre-revert", label: "回退前备份" });
      }
      return target.state;
    },

    /** 简易文本 diff（同步，用于内存中快速比较） */
    quickDiff(textA, textB) { return _lineDiff(textA, textB); },

    /** 清理整个文档的所有版本 */
    async clear(docId) {
      try {
        const list = await Versions.list(docId);
        for (const v of list) await Versions.remove(v.id);
      } catch (e) { /* noop */ }
    },

    // 暴露内部纯函数供单元测试（生产代码不应直接调用）
    _lineDiff,
    _MAX_PER_DOC: MAX_PER_DOC,
    _MAX_AUTO_INTERVAL: MAX_AUTO_INTERVAL
  };

  // 防抖自动快照（各模块共用一个 debounce timer）
  const _autoTimers = new Map(); // docId → setTimeout id
  const _lastAuto = new Map();   // docId → timestamp

  /**
   * 自动快照入口 — 各模块 markDirty 时调用
   * 30s 内只存一次，避免高频操作刷屏
   */
  Versions.autoSnap = function (docId, stateGetter) {
    if (!docId) return;
    const now = Date.now();
    const last = _lastAuto.get(docId) || 0;
    if (now - last < MAX_AUTO_INTERVAL) return; // 间隔不够，跳过
    const existing = _autoTimers.get(docId);
    if (existing) clearTimeout(existing);
    _autoTimers.set(docId, setTimeout(async () => {
      try {
        const state = typeof stateGetter === "function" ? stateGetter() : stateGetter;
        if (state) {
          await Versions.save(docId, state, { reason: "auto-save" });
          _lastAuto.set(docId, Date.now());
        }
      } catch (e) { /* noop */ }
      _autoTimers.delete(docId);
    }, 2000)); // debounce 2s
  };

  global.OS = global.OS || {};
  OS.Versions = Versions;
})(typeof window !== "undefined" ? window : globalThis);
