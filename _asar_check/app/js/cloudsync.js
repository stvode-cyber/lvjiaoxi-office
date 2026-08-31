/* ============================================================
 * 绿角犀 Office · 云端同步 (OS.CloudSync)
 * ------------------------------------------------------------
 * 在「云端账户」登录后激活，把本地文档/备档同步到云端服务器
 * （server/index.js），使其具备真正的「个人云空间」与「可跨设备/
 * 跨浏览器恢复」的自动备档——解决本地 IndexedDB 被清空即全丢的问题。
 *
 * 设计原则：
 *   - 优雅降级：网络/超时/配额满都不抛错、不阻塞 UI；失败自动延后重试。
 *   - 双向合并：登录时拉取云端缺失/更新的内容，上传本地缺失/更新的内容。
 *   - 纯函数抽离（shouldSync / mergePlan 等）便于单测，无需联网。
 *   - 仅在会话含 token（云端链接成功）时生效；未连云端（纯本地）完全不触碰网络。
 * ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  const PUSH_INTERVAL = 60 * 1000; // 周期兜底同步（秒级轻量）
  const REQ_TIMEOUT = 8000;

  const S = {
    enabled: false,
    token: null,
    username: null,
    base: (OS.auth && OS.auth.API_BASE) || "/api",
    connected: false,
    lastSync: 0,
    lastPush: 0,
    pendingDocs: new Set(),
    pendingBackups: new Set(),
    seenDocIds: new Set(),
    seenBackupIds: new Set(),
    timer: null,
    pushing: false
  };

  /* ---------------- 纯函数（可测） ---------------- */
  // 统一账号模型：只要有 token（云端链接成功），即激活同步；本地无 token 不联网。
  function shouldSync(session) {
    return !!(session && session.token);
  }
  function authHeaders(token) {
    return { "Content-Type": "application/json", "Authorization": "Bearer " + token };
  }
  function docEndpoint(base, id) { return base.replace(/\/+$/, "") + "/docs/" + encodeURIComponent(id); }
  function backupEndpoint(base, id) { return base.replace(/\/+$/, "") + "/backups/" + encodeURIComponent(id); }

  // 文档双向合并计划：remote 较新或本地缺失→pull；本地较新或云端缺失→push
  function mergePlan(localDocs, remoteDocs) {
    const rem = {}; remoteDocs.forEach(d => { rem[d.id] = d; });
    const loc = {}; localDocs.forEach(d => { loc[d.id] = d; });
    const toPull = [], toPush = [];
    for (const id in rem) {
      const l = loc[id];
      if (!l) toPull.push(id);
      else if ((rem[id].updatedAt || 0) > (l.updatedAt || 0)) toPull.push(id);
    }
    for (const id in loc) {
      const r = rem[id];
      if (!r) toPush.push(id);
      else if ((loc[id].updatedAt || 0) > (r.updatedAt || 0)) toPush.push(id);
    }
    return { toPull, toPush };
  }

  // 备档：不可变快照，云端缺失即上传
  function backupMergePlan(localBackups, remoteBackups, seen) {
    const rem = {}; remoteBackups.forEach(b => { rem[b.id] = true; });
    const toPush = [];
    localBackups.forEach(b => {
      if (!rem[b.id] && !seen.has(b.id)) toPush.push(b.id);
    });
    return { toPush };
  }

  /* ---------------- 带超时的 fetch ---------------- */
  async function req(method, url, token, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
    try {
      const res = await fetch(url, {
        method,
        headers: authHeaders(token),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } finally { clearTimeout(t); }
  }

  /* ---------------- 同步核心 ---------------- */
  async function pull() {
    const [d, b] = await Promise.all([
      req("GET", S.base.replace(/\/+$/, "") + "/docs", S.token),
      req("GET", S.base.replace(/\/+$/, "") + "/backups", S.token)
    ]);
    if (!d.ok || !b.ok) { S.connected = false; return; }
    S.connected = true;
    S.seenDocIds = new Set((d.data.docs || []).map(x => x.id));
    S.seenBackupIds = new Set((b.data.backups || []).map(x => x.id));

    // 拉取云端新于本地的文档
    const localDocs = await OS.store.list();
    const plan = mergePlan(localDocs, d.data.docs || []);
    for (const id of plan.toPull) {
      const rd = (d.data.docs || []).find(x => x.id === id);
      if (rd) { try { await OS.store.put(rd); } catch (e) {} }
    }
    // 拉取云端存在、本地缺失的备档（不可变快照）
    const localBks = await OS.store.listAllBackups();
    const bp = backupMergePlan(localBks, b.data.backups || [], new Set());
    for (const id of bp.toPush) {
      const rb = (b.data.backups || []).find(x => x.id === id);
      if (rb) { try { await OS.store.putBackup(rb); } catch (e) {} }
    }
    return { pulledDocs: plan.toPull.length, pulledBackups: bp.toPush.length };
  }

  async function pushDocsAndBackups() {
    const localDocs = await OS.store.list();
    const localBks = await OS.store.listAllBackups();
    let pushed = 0, quotaFull = false;

    for (const doc of localDocs) {
      if (S.seenDocIds.has(doc.id) && (doc.updatedAt || 0) <= S.lastPush) continue;
      const r = await req("PUT", docEndpoint(S.base, doc.id), S.token, doc);
      if (r.ok) { S.seenDocIds.add(doc.id); pushed++; }
      else if (r.status === 413) { quotaFull = true; }
      else { S.connected = false; }
    }
    for (const bk of localBks) {
      if (S.seenBackupIds.has(bk.id)) continue;
      const r = await req("PUT", backupEndpoint(S.base, bk.id), S.token, bk);
      if (r.ok) { S.seenBackupIds.add(bk.id); pushed++; }
      else if (r.status === 413) { quotaFull = true; }
      else { S.connected = false; }
    }
    if (quotaFull && OS.toast) OS.toast("云端个人空间已满（50 MB），部分内容未同步", "warn");
    return pushed;
  }

  async function syncNow() {
    if (!S.enabled || !S.token) return { skipped: true };
    if (S.pushing) return { skipped: true };
    S.pushing = true;
    try {
      await pull();
      const pushed = await pushDocsAndBackups();
      S.lastSync = Date.now();
      S.lastPush = Date.now();
      return { connected: S.connected, pushed };
    } catch (e) {
      S.connected = false;
      return { connected: false, error: String(e && e.message || e) };
    } finally {
      S.pushing = false;
    }
  }

  /* ---------------- 生命周期 ---------------- */
  function start() {
    const sess = OS.auth && OS.auth.current && OS.auth.current();
    if (!shouldSync(sess)) { stop(); return Promise.resolve(false); }
    S.enabled = true;
    S.token = sess.token;
    S.username = sess.username;
    S.base = (OS.auth && OS.auth.API_BASE) || "/api";
    S.seenDocIds = new Set();
    S.seenBackupIds = new Set();
    // 等待首次同步完成后再启动周期兜底，便于调用方 await
    return syncNow().finally(() => {
      if (S.timer) clearInterval(S.timer);
      S.timer = setInterval(() => { syncNow(); }, PUSH_INTERVAL);
    });
  }
  function stop() {
    S.enabled = false;
    S.token = null;
    S.connected = false;
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
  }
  function status() {
    return {
      enabled: S.enabled, connected: S.connected,
      username: S.username, lastSync: S.lastSync, lastPush: S.lastPush,
      pendingDocs: S.pendingDocs.size, pendingBackups: S.pendingBackups.size,
      seenDocs: S.seenDocIds.size, seenBackups: S.seenBackupIds.size
    };
  }

  OS.CloudSync = {
    start, stop, syncNow, status, shouldSync,
    docEndpoint, backupEndpoint, authHeaders, mergePlan, backupMergePlan,
    _state: S
  };

  if (OS.util && OS.util.log) OS.util.log("CloudSync ready");
})(window);
