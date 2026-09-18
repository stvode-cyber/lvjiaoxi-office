/* 绿角犀 Office · OS.Versions 历史版本快照单元测试
   运行：node _versions_test.js
   覆盖：
     - _lineDiff (LCS) 纯函数：增/删/不变/空输入/同串
     - quickDiff 公开入口
     - save/list/get/remove/prune/clear/revert/diff（基于 in-memory IDB shim）
     - autoSnap 节流（30s 间隔 + debounce）
   无需第三方依赖：手写最小 IDB mock（仅覆盖 versions.js 用到的 API） */
"use strict";
global.window = global;

// ========== 最小 in-memory IndexedDB shim ==========
class MockCursor {
  constructor(values) { this._values = values; this._i = 0; this.value = null; }
  continue() {
    this._i++;
    if (this._i < this._values.length) {
      this.value = this._values[this._i];
      if (this.onsuccess) this.onsuccess({ target: this });
    } else {
      this.value = null;
      if (this.onsuccess) this.onsuccess({ target: this });
    }
  }
}
class MockIndex {
  constructor(store, name, keyPath) { this._store = store; this.name = name; this.keyPath = keyPath; }
  getAll(key) {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      // key 是 IDBKeyRange.only(docId)
      const want = key && key._lower !== undefined ? key._lower : key;
      req.result = this._store._records.filter(r => r[this.keyPath] === want);
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
}
class MockStore {
  constructor(name, keyPath) { this.name = name; this.keyPath = keyPath; this._records = []; this._indexes = {}; }
  put(rec) {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      const i = this._records.findIndex(r => r[this.keyPath] === rec[this.keyPath]);
      if (i >= 0) this._records[i] = rec; else this._records.push(rec);
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
  get(key) {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      req.result = this._records.find(r => r[this.keyPath] === key) || null;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
  delete(key) {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      this._records = this._records.filter(r => r[this.keyPath] !== key);
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
  index(name) { return this._indexes[name]; }
  _addIndex(name, keyPath) { this._indexes[name] = new MockIndex(this, name, keyPath); }
}
class MockDB {
  constructor() {
    this.objectStoreNames = { contains: n => n === "versions" };
    const s = new MockStore("versions", "id");
    s._addIndex("docId", "docId");
    s._addIndex("ts", "ts");
    this._store = s;
  }
  transaction(name, mode) { return { objectStore: n => this._store }; }
}
class MockIDBOpenDBRequest {
  constructor() { this.onsuccess = null; this.onerror = null; this.result = null; }
}
global.IDBKeyRange = { only: v => ({ _lower: v, _upper: v }) };
const _sharedDB = new MockDB();
global.indexedDB = {
  open(name, ver) {
    const req = new MockIDBOpenDBRequest();
    setTimeout(() => {
      req.result = _sharedDB;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
};

// OS 桩
global.OS = { store: { dbName: () => "test-db", VER: 3 } };

// 加载 versions.js
require("./app/js/versions.js");
const V = global.OS.Versions;

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); console.error("  ✗ " + name); } }
function eq(name, actual, expected) {
  const jA = JSON.stringify(actual), jE = JSON.stringify(expected);
  if (jA === jE) pass++; else { fail++; fails.push(name); console.error("  ✗ " + name + "  expected=" + jE + "  actual=" + jA); }
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("=== _lineDiff (LCS) 纯函数 ===");
  // 两串完全相同 → added/removed 为空
  eq("完全相同 - added 0", V._lineDiff("a\nb\nc", "a\nb\nc").added.length, 0);
  eq("完全相同 - removed 0", V._lineDiff("a\nb\nc", "a\nb\nc").removed.length, 0);
  eq("完全相同 - unchanged 3", V._lineDiff("a\nb\nc", "a\nb\nc").unchanged.length, 3);

  // 纯新增
  eq("纯新增 - added 1", V._lineDiff("a", "a\nb").added.length, 1);
  eq("纯新增 - removed 0", V._lineDiff("a", "a\nb").removed.length, 0);

  // 纯删除
  eq("纯删除 - added 0", V._lineDiff("a\nb", "a").added.length, 0);
  eq("纯删除 - removed 1", V._lineDiff("a\nb", "a").removed.length, 1);

  // 空输入
  eq("空串 vs 有内容 - added 2", V._lineDiff("", "x\ny").added.length, 2);
  eq("有内容 vs 空串 - removed 2", V._lineDiff("x\ny", "").removed.length, 2);
  eq("两空串 - unchanged 1", V._lineDiff("", "").unchanged.length, 1); // "" split 后是 [""]

  // 替换中间行
  const d = V._lineDiff("a\nb\nc", "a\nX\nc");
  eq("替换中间行 - added 1", d.added.length, 1);
  eq("替换中间行 - removed 1", d.removed.length, 1);
  eq("替换中间行 - 保留首尾 2", d.unchanged.length, 2);

  console.log("=== quickDiff 公开入口 ===");
  ok("quickDiff 与 _lineDiff 同结果", JSON.stringify(V.quickDiff("a\nb", "a")) === JSON.stringify(V._lineDiff("a\nb", "a")));

  console.log("=== save / list / get / remove（IndexedDB shim） ===");
  await wait(10);
  const r1 = await V.save("doc1", { html: "v1" }, { reason: "manual", label: "首次" });
  ok("save 返回记录", !!r1 && !!r1.id);
  ok("save 记录 docId 正确", r1.docId === "doc1");
  ok("save 记录 reason 落库", r1.reason === "manual");
  ok("save 记录 size 计算", r1.size > 0);

  await V.save("doc1", { html: "v2" }, { reason: "auto-save" });
  await V.save("doc1", { html: "v3" }, { reason: "auto-save" });
  await wait(10);
  const list = await V.list("doc1");
  eq("list 返回 3 条", list.length, 3);
  // 倒序（最新在前）
  ok("list 倒序 - 第一条是最新 v3", list[0].state.html === "v3");
  ok("list 倒序 - 第三条是最旧 v1", list[2].state.html === "v1");

  const got = await V.get(list[0].id);
  ok("get 返回正确记录", got && got.id === list[0].id);

  // 多文档隔离
  await V.save("doc2", { html: "其他文档" }, { reason: "manual" });
  await wait(10);
  const list2 = await V.list("doc2");
  eq("多文档隔离 - doc2 仅 1 条", list2.length, 1);

  // 空 docId
  ok("save 空 docId 返回 null", await V.save(null, {}) === null);
  eq("list 空 docId 返回空数组", (await V.list(null)).length, 0);
  ok("get 空 id 返回 null", await V.get(null) === null);

  // remove
  await V.remove(list[0].id);
  await wait(10);
  const listAfter = await V.list("doc1");
  eq("remove 后 doc1 剩 2 条", listAfter.length, 2);
  ok("get 删除后返回 null", await V.get(list[0].id) === null);

  console.log("=== diff（行级 LCS 对比） ===");
  // 先存两个已知 state，再 diff
  await V.save("docDiff", "line1\nline2\nline3", { label: "A" });
  await V.save("docDiff", "line1\nCHANGED\nline3", { label: "B" });
  await wait(10);
  const dl = await V.list("docDiff");
  // dl[0] = B（最新），dl[1] = A
  const df = await V.diff(dl[1].id, dl[0].id);
  ok("diff 返回非空", !!df);
  ok("diff 标识 A/B", df.a.label === "A" && df.b.label === "B");
  eq("diff added 1", df.summary.addedCount, 1);
  eq("diff removed 1", df.summary.removedCount, 1);
  eq("diff unchanged 2", df.summary.unchangedCount, 2);
  ok("diff added 内容 = CHANGED", df.added[0].text === "CHANGED");
  ok("diff removed 内容 = line2", df.removed[0].text === "line2");

  // diff 找不到版本
  ok("diff 不存在版本返回 null", await V.diff("nonexistent", "alsogone") === null);

  console.log("=== revert（回退 + pre-revert 备份） ===");
  await V.save("docRev", "stateA", { label: "A" });
  await V.save("docRev", "stateB", { label: "B" });
  await wait(10);
  const rl = await V.list("docRev");
  // 当前 docRev 的 Store.get 模拟返回 data
  global.OS.store.get = async (id) => id === "docRev" ? { data: "currentB" } : null;
  const reverted = await V.revert("docRev", rl[1].id); // 回退到 A
  ok("revert 返回 target.state", reverted === "stateA");
  await wait(10);
  const rlAfter = await V.list("docRev");
  // 应多了一条 pre-revert 备份
  ok("revert 自动存 pre-revert 备份", rlAfter.some(v => v.reason === "pre-revert"));
  // 还原 stub
  delete global.OS.store.get;

  console.log("=== autoSnap 节流（debounce + 30s 间隔） ===");
  // 第一次调用应触发 debounce timer
  let called = 0;
  const getter = () => { called++; return { html: "snap" }; };
  V.autoSnap("snapTest", getter);
  // 立即再调一次 — 应被节流（同一 debounce 周期内只算一次）
  V.autoSnap("snapTest", getter);
  V.autoSnap("snapTest", getter);
  // debounce 2s — 我们等到 2.1s 后再检查
  await wait(2100);
  ok("autoSnap debounce 后调用一次 getter", called === 1);
  await wait(10);
  // 30s 间隔未到，再调应被跳过
  V.autoSnap("snapTest", getter);
  await wait(2100);
  ok("autoSnap 30s 间隔内不重复存", called === 1); // 仍是 1

  console.log("=== clear（清理整文档） ===");
  await V.clear("doc1");
  await wait(10);
  eq("clear 后 doc1 为空", (await V.list("doc1")).length, 0);
  // 其他文档不受影响
  ok("clear 不影响 doc2", (await V.list("doc2")).length === 1);

  console.log("=== MAX_PER_DOC 常数 ===");
  eq("MAX_PER_DOC = 50", V._MAX_PER_DOC, 50);
  eq("MAX_AUTO_INTERVAL = 30000", V._MAX_AUTO_INTERVAL, 30000);

  console.log("\n========= 结果 =========");
  console.log("通过: " + pass + "  失败: " + fail);
  if (fail) { console.error("失败用例:\n  - " + fails.join("\n  - ")); process.exit(1); }
  else console.log("✓ 全部通过");
})();
