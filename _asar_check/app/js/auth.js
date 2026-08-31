/* ============================================================
   绿角犀 Office · 账户与登录系统 (auth)
   - 统一账号模型：同一用户名/密码既是「本地离线账户」（SHA-256(salt:pass) 存
     localStorage，永远可用、离线可登录），又是「云端账户」（服务端 scrypt + HMAC
     签名 token，50MB 个人云空间）。不区分 local / cloud 两套账户。
   - 登录流程：① 永远先本地校验（离线可用）；② 再尽力登录云端拿 token ——
     · 云端用户不存在(404) → 自动用相同密码补注册，统一本地与云端账号；
     · 密码不一致(401) / 后端不可达 / 超时 → 静默降级为纯本地（token 留空、不报错）。
   - 个人空间：50 MB 配额（QUOTA）
   - 备档策略：每文档保留最近 MAX_BACKUPS 份，计入配额
   - 自动备档：每 BACKUP_INTERVAL 触发一次
   - 记住我：勾选后将会话持久化到 localStorage，下次打开免登录
   对应需求：统一登录系统 + 登录后 50M 个人空间 + 每 5 分钟自动备档
   ============================================================ */
(function (global) {
  "use strict";
  const OS = global.OS || (global.OS = {});

  // ---------- 常量 ----------
  const QUOTA = 50 * 1024 * 1024;        // 个人空间 50 MB
  const MAX_BACKUPS = 20;                // 每文档保留最近 20 份备档
  const BACKUP_INTERVAL = 5 * 60 * 1000; // 每 5 分钟自动备档
  const API_BASE = "/api";               // 云端账号接口前缀（后端契约）
  const CLOUD_TIMEOUT = 8000;            // 云端请求超时（毫秒）

  const ACCOUNTS_KEY = "lvjiaoxi-accounts";
  const SESSION_KEY = "lvjiaoxi-session";
  const REMEMBER_KEY = "lvjiaoxi-remember"; // 「记住我」持久会话（localStorage）
  let _session = null;

  // ---------- 密码哈希（Web Crypto SHA-256 + salt） ----------
  async function sha256Hex(msg) {
    const crypto = global.crypto || global.msCrypto;
    const data = new TextEncoder().encode(msg);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function hashPassword(pass, salt) { return sha256Hex(salt + ":" + pass); }

  // ---------- 本地账户（localStorage，始终作为离线凭证） ----------
  function loadAccounts() {
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveAccounts(a) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); }

  async function ensureLocal(username, pass) {
    username = (username || "").trim();
    if (!username || !pass) throw new Error("用户名与密码均不能为空");
    if (username.length < 2) throw new Error("用户名至少 2 个字符");
    if (pass.length < 6) throw new Error("密码至少 6 位");
    const accounts = loadAccounts();
    let acc = accounts[username];
    if (!acc) {
      const salt = (OS.util && OS.util.uid ? OS.util.uid("s") : ("s" + Math.random())).slice(0, 24);
      acc = { username, salt, passHash: await hashPassword(pass, salt), createdAt: Date.now() };
      accounts[username] = acc;
      saveAccounts(accounts);
    } else if (acc.passHash !== (await hashPassword(pass, acc.salt))) {
      throw new Error("用户名或密码错误");
    }
    return acc;
  }

  // ---------- 云端账户（接口契约对齐 server/index.js，后端已落地） ----------
  // 后端契约（server/index.js 已实现）：
  //   POST /api/auth/register  { username, password }  -> { token, user:{username} }
  //   POST /api/auth/login     { username, password }  -> { token, user:{username} }（用户不存在 404）
  // 任何网络/超时/部署前失败都不抛出，由调用方做静默降级（纯本地可用）。
  async function cloudFetch(path, body) {
    const fetchFn = global.fetch;
    if (!fetchFn) throw new Error("no-fetch");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CLOUD_TIMEOUT);
    try {
      const res = await fetchFn(API_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      let data = null; try { data = await res.json(); } catch (e) {}
      return { res, data: data || {} };
    } catch (e) {
      // TypeError = 网络不可达；AbortError = 超时；统一标记为 no-fetch
      throw new Error("no-fetch");
    } finally {
      clearTimeout(timer);
    }
  }

  // 尽力登录云端：返回 token 或 null（null = 纯本地降级，不抛错）
  async function linkCloud(username, pass) {
    // 先尝试登录
    try {
      const { res, data } = await cloudFetch("/auth/login", { username, password: pass });
      if (res.ok) return data.token || null;
      if (res.status === 404) {
        // 云端尚未有该账号 → 用相同密码补注册（统一本地/云端账号）
        const r2 = await cloudFetch("/auth/register", { username, password: pass });
        if (r2.res.ok) return r2.data.token || null;
      }
      // 401 密码不一致 / 其他 → 降级，不抛错
      return null;
    } catch (e) {
      if (e.message === "no-fetch") return null; // 后端不可达，纯本地
      return null;
    }
  }

  // ---------- 统一注册 / 登录 ----------
  async function register(username, pass, remember) {
    const acc = await ensureLocal(username, pass); // 本地永远写入/校验
    const token = await linkCloud(username, pass); // 尽力连云端（失败静默）
    return setSession({ username: acc.username, token: token || null }, remember);
  }
  async function login(username, pass, remember) {
    const acc = await ensureLocal(username, pass); // 本地离线校验优先
    const token = await linkCloud(username, pass); // 尽力连云端（失败静默）
    return setSession({ username: acc.username, token: token || null }, remember);
  }

  // ---------- 会话（sessionStorage 会话级 + localStorage 记住我持久） ----------
  function setSession(s, remember) {
    s.loginAt = Date.now();
    _session = s;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, JSON.stringify(s));
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (e) {}
    OS.bus && OS.bus.emit("auth", s);
    return s;
  }
  function current() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    // 跨会话恢复（记住我）
    try {
      const raw = localStorage.getItem(REMEMBER_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return _session;
  }
  function isCloudLinked() {
    const c = current();
    return !!(c && c.token);
  }
  async function logout() {
    _session = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
    OS.bus && OS.bus.emit("auth", null);
  }

  const Auth = {
    QUOTA, MAX_BACKUPS, BACKUP_INTERVAL, API_BASE, REMEMBER_KEY, CLOUD_TIMEOUT,
    hashPassword,
    register, login, ensureLocal, linkCloud,
    logout, current, isCloudLinked,
    isLoggedIn: () => !!current(),
    // 按账户隔离的 IndexedDB 库名
    dbNameFor(username) { return "lvjiaoxi-office-" + (username || "anon"); }
  };

  OS.auth = Auth;
})(window);
