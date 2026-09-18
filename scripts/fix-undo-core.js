const fs = require("fs");
let c = fs.readFileSync("app/js/modules/mindmap.js", "utf8");

// ===== UndoCore 双次提交 markDirty 模式 =====
// markDirty 在 mutation **之后**被调（ctx.markDirty 被 hook 的场景）：
//   第 1 次 markDirty → pending = clone(data)     // 存当前状态（mutation 后）
//   第 2 次 markDirty → undoStack.push(pending); pending = clone(data)
//                          ↑ 上一次 mutation 后的状态 = 本次 undo 目标
// 这样每次 markDirty 都会让 **上一次状态** 入 undoStack
// undo() 前调 commitSnap() 把 pending 入栈，然后 pop 出上上次 markDirty 存的状态
const oldUndoCore = `  function _undoCore(initialData, options) {
    const {
      onRestore = () => {},         // undo/redo 后由调用方决定怎么重渲染
      maxStack = 100,
      dataRef = initialData         // 支持传引用对象（mount 场景）或 clone（纯逻辑场景）
    } = options || {};

    const undoStack = [], redoStack = [];
    let preSnap = null;
    let commitCount = 0;

    function snapshot() {
      undoStack.push(JSON.parse(JSON.stringify(dataRef)));
      if (undoStack.length > maxStack) undoStack.shift();
      redoStack.length = 0;
    }

    function markDirty() {
      if (preSnap === null) {
        preSnap = JSON.parse(JSON.stringify(dataRef));
      }
    }

    function commitSnap() {
      if (preSnap !== null) {
        undoStack.push(preSnap);
        if (undoStack.length > maxStack) undoStack.shift();
        redoStack.length = 0;
        preSnap = null;
        commitCount++;
      }
    }

    function undo() {
      commitSnap();
      if (!undoStack.length) return false;
      redoStack.push(JSON.parse(JSON.stringify(dataRef)));
      Object.assign(dataRef, JSON.parse(JSON.stringify(undoStack.pop())));
      onRestore('undo');
      return true;
    }

    function redo() {
      commitSnap();
      if (!redoStack.length) return false;
      undoStack.push(JSON.parse(JSON.stringify(dataRef)));
      Object.assign(dataRef, JSON.parse(JSON.stringify(redoStack.pop())));
      onRestore('redo');
      return true;
    }

    function canUndo() { commitSnap(); return undoStack.length > 0; }
    function canRedo() { commitSnap(); return redoStack.length > 0; }
    function stackSize() { commitSnap(); return { undo: undoStack.length, redo: redoStack.length, commits: commitCount }; }

    return { markDirty, commitSnap, undo, redo, canUndo, canRedo, stackSize, snapshot };
  }`;

const newUndoCore = `  function _undoCore(initialData, options) {
    const {
      onRestore = () => {},
      maxStack = 100
    } = options || {};

    const undoStack = [], redoStack = [];
    let pending = null;   // 上一次 markDirty 时的 data clone（"mutation 后"状态）
    // 双次提交模式：
    //   1st markDirty:  pending = clone(data)          // 存下当前状态
    //   2nd markDirty:  undoStack.push(pending);       // pending 是上一次状态 = undo 目标
    //                   pending = clone(data)          // 再存当前
    // undo() 前 commitSnap() 把 pending 入栈，pop 出上上一次状态

    function snapshot() {
      // snapshot() 是 mutation **之前**调的（spreadsheet 风格），立即入栈
      undoStack.push(JSON.parse(JSON.stringify(initialData)));
      if (undoStack.length > maxStack) undoStack.shift();
      redoStack.length = 0;
    }

    function markDirty() {
      const now = JSON.parse(JSON.stringify(initialData));
      if (pending !== null) {
        // pending 是上一次 mutation 后的状态 = 本次 undo 的目标
        undoStack.push(pending);
        if (undoStack.length > maxStack) undoStack.shift();
        redoStack.length = 0;
      }
      pending = now;   // 等下次 markDirty 再处理
    }

    function commitSnap() {
      if (pending !== null) {
        undoStack.push(pending);
        if (undoStack.length > maxStack) undoStack.shift();
        redoStack.length = 0;
        pending = null;
      }
    }

    // 深恢复：先清空所有旧 key 再 Object.assign（避免数组引用残留）
    function _restoreFrom(snapClone) {
      Object.keys(initialData).forEach((k) => delete initialData[k]);
      Object.assign(initialData, snapClone);
    }

    function undo() {
      commitSnap();
      if (!undoStack.length) return false;
      redoStack.push(JSON.parse(JSON.stringify(initialData)));
      _restoreFrom(undoStack.pop());
      onRestore("undo");
      return true;
    }

    function redo() {
      commitSnap();
      if (!redoStack.length) return false;
      undoStack.push(JSON.parse(JSON.stringify(initialData)));
      _restoreFrom(redoStack.pop());
      onRestore("redo");
      return true;
    }

    function canUndo() { commitSnap(); return undoStack.length > 0; }
    function canRedo() { commitSnap(); return redoStack.length > 0; }
    function stackSize() { commitSnap(); return { undo: undoStack.length, redo: redoStack.length }; }

    return { markDirty, commitSnap, undo, redo, canUndo, canRedo, stackSize, snapshot };
  }`;

if (c.includes(oldUndoCore)) {
  c = c.replace(oldUndoCore, newUndoCore);
  console.log("✅ UndoCore 双次提交 + 深恢复");
} else {
  console.log("❌ oldUndoCore not found");
}

// ===== mount 里的闭包版也同步修 =====
const oldRestore = `    function _restore(snap) {
      Object.assign(data, JSON.parse(JSON.stringify(snap)));
      selId = null;
      layoutMap(); render(); syncSide(); _origMarkDirty();
    }`;
const newRestore = `    function _restore(snap) {
      const r = JSON.parse(JSON.stringify(snap));
      Object.keys(data).forEach((k) => delete data[k]);
      Object.assign(data, r);
      selId = null;
      layoutMap(); render(); syncSide(); _origMarkDirty();
    }`;
if (c.includes(oldRestore)) {
  c = c.replace(oldRestore, newRestore);
  console.log("✅ mount _restore 深恢复");
}

// mount 里的 _undoStack 闭包版也要从 preSnap 改成 pending 双次提交
// 因为 hook markDirty 是 mutation 后调的
const oldClosureMarkDirtyHook = `    /* ---------- Undo/Redo（snapshot 模式，hook markDirty 自动快照）---------- */
    const _undoStack = [], _redoStack = [];
    let _preSnap = null;   // mutation 前缓存的快照（等下次 render 时真正入栈）
    const _origMarkDirty = ctx.markDirty;
    ctx.markDirty = function () {
      if (_preSnap === null) _preSnap = JSON.parse(JSON.stringify(data));
      return _origMarkDirty.apply(this, arguments);
    };
    function _commitSnap() {
      if (_preSnap !== null) {
        _undoStack.push(_preSnap);
        if (_undoStack.length > 100) _undoStack.shift();
        _redoStack.length = 0;
        _preSnap = null;
      }
    }
    function _restore(snap) {
      const r = JSON.parse(JSON.stringify(snap));
      Object.keys(data).forEach((k) => delete data[k]);
      Object.assign(data, r);
      selId = null;
      layoutMap(); render(); syncSide(); _origMarkDirty();
    }
    function _undo() {
      _commitSnap();      // 把当前 _preSnap 入栈（如果有）
      if (!_undoStack.length) return false;
      _redoStack.push(JSON.parse(JSON.stringify(data)));
      _restore(_undoStack.pop());
      return true;
    }
    function _redo() {
      _commitSnap();
      if (!_redoStack.length) return false;
      _undoStack.push(JSON.parse(JSON.stringify(data)));
      _restore(_redoStack.pop());
      return true;
    }
    function _canUndo() { _commitSnap(); return _undoStack.length > 0; }
    function _canRedo() { _commitSnap(); return _redoStack.length > 0; }`;

const newClosureMarkDirtyHook = `    /* ---------- Undo/Redo（hook ctx.markDirty 双次提交模式）---------- */
    // markDirty 在 mutation **之后** 被调，所以用 pending 双次提交：
    //   1st markDirty → pending = clone(data)        // 存当前（mutation 后）
    //   2nd markDirty → undoStack.push(pending);     // pending 是上一次 = undo 目标
    //                   pending = clone(data)
    const _undoStack = [], _redoStack = [];
    let _pending = null;
    const _origMarkDirty = ctx.markDirty;
    ctx.markDirty = function () {
      const now = JSON.parse(JSON.stringify(data));
      if (_pending !== null) {
        _undoStack.push(_pending);
        if (_undoStack.length > 100) _undoStack.shift();
        _redoStack.length = 0;
      }
      _pending = now;
      return _origMarkDirty.apply(this, arguments);
    };
    function _commitSnap() {
      if (_pending !== null) {
        _undoStack.push(_pending);
        if (_undoStack.length > 100) _undoStack.shift();
        _redoStack.length = 0;
        _pending = null;
      }
    }
    function _restore(snap) {
      const r = JSON.parse(JSON.stringify(snap));
      Object.keys(data).forEach((k) => delete data[k]);
      Object.assign(data, r);
      selId = null;
      layoutMap(); render(); syncSide(); _origMarkDirty();
    }
    function _undo() {
      _commitSnap();
      if (!_undoStack.length) return false;
      _redoStack.push(JSON.parse(JSON.stringify(data)));
      _restore(_undoStack.pop());
      return true;
    }
    function _redo() {
      _commitSnap();
      if (!_redoStack.length) return false;
      _undoStack.push(JSON.parse(JSON.stringify(data)));
      _restore(_redoStack.pop());
      return true;
    }
    function _canUndo() { _commitSnap(); return _undoStack.length > 0; }
    function _canRedo() { _commitSnap(); return _redoStack.length > 0; }`;

if (c.includes(oldClosureMarkDirtyHook)) {
  c = c.replace(oldClosureMarkDirtyHook, newClosureMarkDirtyHook);
  console.log("✅ mount 闭包版 undo 双次提交");
} else {
  console.log("❌ oldClosureMarkDirtyHook not found");
}

fs.writeFileSync("app/js/modules/mindmap.js", c);
try { new Function(c); console.log("✅ syntax OK"); }
catch (e) { console.error("❌ syntax:", e.message); }
