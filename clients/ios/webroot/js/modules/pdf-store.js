/* =========================================================================
 * 绿角犀 PDF · 跨端统一本地持久化层（设置 + 最近文件）
 *
 * 设计说明：
 *  - 五端（网页/PWA、Electron 桌面、Capacitor Android/iOS、HarmonyOS）的
 *    WebView 都原生支持且持久化 localStorage，因此用 localStorage 作唯一后端，
 *    一份代码全平台共用，无需为某个端做独立文件存储，避免了平台分支。
 *  - 只存「元数据」（最近文件的 name/path/time、设置项），绝不存 base64 内容，
 *    规避 WebView localStorage 的小配额限制。真正打开文件仍走各端已有的
 *    读回/注入通道（Electron 走主进程 IPC，移动端走 Filesystem.readFile）。
 *  - 全部同步读写（数据极小），并对 localStorage 配额/解析异常做 try/catch 兜底。
 * ========================================================================= */
window.PDFStore = (function () {
  const P_ = 'pdfx:';                 // 命名空间前缀，避免与其他应用的 key 冲突
  const K_SET = P_ + 'settings';      // 设置整段 JSON 的 key
  const K_REC = P_ + 'recent';        // 最近文件 JSON 的 key
  const DEFAULTS = { recentsMax: 12 }; // 默认设置：最近文件条数上限
  const store = window.localStorage;  // 全平台 WebView 均有，无需判空平台

  // 安全地从 localStorage 读回 JSON；解析失败或不存在时返回 fallback，绝不抛错。
  function readJSON(key, fallback) {
    try {
      const raw = store.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('PDFStore 读取失败', key, e);
      return fallback;
    }
  }

  // 安全地写 JSON 到 localStorage；配额超限等异常时兜底，不影响主流程。
  function writeJSON(key, value) {
    try { store.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('PDFStore 写入失败', key, e); }
  }

  // 设置缓存：启动时读一次，之后内存读写 + 变更即持久化。
  const settingsCache = Object.assign({}, DEFAULTS, readJSON(K_SET, {}));

  const settings = {
    // 读取设置项，未设置时返回默认值。
    get(key) {
      return Object.prototype.hasOwnProperty.call(settingsCache, key) ? settingsCache[key] : DEFAULTS[key];
    },
    // 写入设置项并立即持久化。
    set(key, value) {
      settingsCache[key] = value;
      writeJSON(K_SET, settingsCache);
      return value;
    },
  };

  // —— 最近文件（新→旧，去重 + 条数上限）——
  // 条目字段：{ name, path, time(ms), reopenable:boolean }
  // 去重键 = path || name：同一文件重复打开会移动到最前，而非新增重复条目。
  const recent = {
    // 读出并按当前条数上限截断后的列表。
    list() {
      const arr = readJSON(K_REC, []).filter(function (it) { return it && it.name; });
      const max = Number(settings.get('recentsMax')) || DEFAULTS.recentsMax;
      return arr.slice(0, max);
    },
    // 新增/置前一条记录。
    add(entry) {
      entry = entry || {};
      const key = entry.path || entry.name;      // 去重键
      if (!key) return;
      const max = Number(settings.get('recentsMax')) || DEFAULTS.recentsMax;
      const list = recent.list();
      const idx = list.findIndex(function (it) { return (it.path || it.name) === key; });
      if (idx >= 0) list.splice(idx, 1);         // 命中则删除旧条目
      list.unshift({                             // 新条目置顶
        name: entry.name,
        path: entry.path || null,
        time: Date.now(),
        reopenable: !!entry.reopenable,
      });
      writeJSON(K_REC, list.slice(0, max));
    },
    // 按 name 移除单条。
    remove(name) {
      writeJSON(K_REC, recent.list().filter(function (it) { return it.name !== name; }));
    },
    // 清空全部最近文件。
    clear() { writeJSON(K_REC, []); },
  };

  return { settings: settings, recent: recent };
})();