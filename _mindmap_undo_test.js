/* 绿角犀 Office · MindMap UndoCore 单元测试（纯逻辑，node 直跑）
   UndoCore 语义：snapshot() 在 mutation **之前** 调，立即入 undoStack。
   覆盖：基本 undo/redo、多次 snapshot 节流（无，每次都入）、空栈边界、
         redoStack 清空、maxStack 截断、多实例隔离、onRestore 回调、
         mount 返回 undo API 暴露。 */
(function () {
  global.window = global;
  global.OS = {};
  require("./app/js/modules/mindmap.js");
  const MM = global.OS.modules.mindmap;
  const UndoCore = MM._undoCore;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } }
  function eq(name, actual, expected) {
    const jA = JSON.stringify(actual);
    const jE = JSON.stringify(expected);
    if (jA === jE) { pass++; }
    else { fail++; console.error("  ✗ " + name + "  expected=" + jE + "  actual=" + jA); }
  }

  /* ============ 基础 undo/redo（snapshot 在 mutation 之前） ============ */
  {
    const data = { nodes: [{ id: "r", text: "root", isRoot: true, parent: null }], rootId: "r", edges: [] };
    const core = UndoCore(data);

    ok("初始 canUndo=false, canRedo=false", !core.canUndo() && !core.canRedo());

    // 第 1 次 mutation：先 snapshot（存 [r]），再 push
    core.snapshot();          // undoStack: [[r]]
    data.nodes.push({ id: "a", text: "branch A", parent: "r" });  // data 变 [r, a]
    ok("push 后 canUndo=true", core.canUndo());
    ok("redo 仍为空", !core.canRedo());

    eq("undo 成功返回 true", core.undo(), true);
    eq("undo 后 nodes 长度恢复 1（回到 snapshot 时刻的状态）", data.nodes.length, 1);
    ok("undo 后 redoStack 有 1 项", core.canRedo());

    // redo
    eq("redo 成功", core.redo(), true);
    eq("redo 后 nodes 长度回到 2", data.nodes.length, 2);
    ok("redo 后 redoStack 空", !core.canRedo());
  }

  /* ============ 连续 undo 到底 ============ */
  {
    const data = { nodes: [{ id: "r", text: "root", isRoot: true, parent: null }], rootId: "r", edges: [] };
    const core = UndoCore(data);

    // 3 次独立 mutation，每次先 snapshot
    core.snapshot(); data.nodes.push({ id: "a", text: "A", parent: "r" });
    core.snapshot(); data.nodes.push({ id: "b", text: "B", parent: "r" });
    core.snapshot(); data.nodes.push({ id: "c", text: "C", parent: "r" });

    eq("初始 undoStack 3", core.stackSize().undo, 3);

    core.undo(); eq("undo 1 → undoStack=2, nodes 恢复到 push(B) 前", core.stackSize().undo, 2);
    core.undo(); eq("undo 2 → undoStack=1", core.stackSize().undo, 1);
    core.undo(); eq("undo 3 → undoStack=0", core.stackSize().undo, 0);
    ok("undo 到底返回 false", core.undo() === false);
    ok("canUndo() false", !core.canUndo());
  }

  /* ============ redoStack 在新 mutation 后清空 ============ */
  {
    const data = { nodes: [{ id: "r", text: "root", isRoot: true, parent: null }], rootId: "r", edges: [] };
    const core = UndoCore(data);

    core.snapshot(); data.nodes.push({ id: "a", text: "A", parent: "r" });
    core.snapshot(); data.nodes.push({ id: "b", text: "B", parent: "r" });
    core.undo();
    ok("undo 后 redoStack 有 1", core.canRedo());

    // 新 mutation（不是 redo）→ snapshot 时 redoStack.length = 0
    core.snapshot(); data.nodes.push({ id: "c", text: "C", parent: "r" });
    ok("新 mutation 后 redoStack 被清（snapshot 里 redoStack.length=0）", !core.canRedo());
  }

  /* ============ maxStack 截断 ============ */
  {
    const data = { nodes: [{ id: "r", text: "root", isRoot: true, parent: null }], rootId: "r", edges: [] };
    const core = UndoCore(data, { maxStack: 5 });

    for (let i = 0; i < 10; i++) {
      core.snapshot();
      data.nodes.push({ id: "n" + i, text: "node-" + i, parent: "r" });
    }
    eq("超过 maxStack 后栈被截断到 5", core.stackSize().undo, 5);
    ok("截断后 undo 能走通", core.undo());
  }

  /* ============ 多实例隔离 ============ */
  {
    const d1 = { nodes: [{ id: "r1", text: "doc1", isRoot: true, parent: null }], rootId: "r1", edges: [] };
    const d2 = { nodes: [{ id: "r2", text: "doc2", isRoot: true, parent: null }], rootId: "r2", edges: [] };
    const c1 = UndoCore(d1);
    const c2 = UndoCore(d2);

    c1.snapshot(); d1.nodes.push({ id: "a", text: "A", parent: "r1" });
    c2.snapshot(); d2.nodes.push({ id: "x", text: "X", parent: "r2" });

    ok("c1 undoStack=1, c2 undoStack=1（独立）", c1.stackSize().undo === 1 && c2.stackSize().undo === 1);
    c1.undo();
    ok("c1 undo 后 d1.nodes.length=1, c2 不受影响", d1.nodes.length === 1 && d2.nodes.length === 2);
    c2.undo();
    ok("c2 undo 后 d2.nodes.length=1", d2.nodes.length === 1);
  }

  /* ============ onRestore 回调 ============ */
  {
    const events = [];
    const data = { nodes: [{ id: "r", text: "root", isRoot: true, parent: null }], rootId: "r", edges: [] };
    const core = UndoCore(data, { onRestore: (action) => events.push(action) });

    core.snapshot(); data.nodes.push({ id: "a", text: "A", parent: "r" });
    core.undo();
    core.redo();
    core.undo();
    eq("onRestore 回调序列", events, ["undo", "redo", "undo"]);
  }

  /* ============ 深恢复：恢复后新节点引用不残留 ============ */
  {
    const data = { nodes: [{ id: "r", text: "root", isRoot: true, parent: null }], rootId: "r", edges: [] };
    const core = UndoCore(data);

    core.snapshot();
    data.nodes.push({ id: "a", text: "A", parent: "r" });
    data.nodes.push({ id: "b", text: "B", parent: "r" });

    core.undo();
    eq("undo 恢复后 nodes 只有 1 个", data.nodes.length, 1);
    eq("唯一节点是 root", data.nodes[0].id, "r");
    ok("没有残留的 a 节点", !data.nodes.some((n) => n.id === "a"));

    // 再做一次 mutation 确认恢复后 data 能正常变化
    core.snapshot();
    data.nodes.push({ id: "c", text: "C", parent: "r" });
    eq("恢复后能正常 mutation", data.nodes.length, 2);
  }

  /* ============ markDirty 兼容别名 ============ */
  {
    const data = { nodes: [{ id: "r", text: "root" }] };
    const core = UndoCore(data);
    ok("markDirty 是函数", typeof core.markDirty === "function");
    // markDirty = snapshot（当前实现），所以在 mutation 前调也能入栈
    core.markDirty();
    data.nodes.push({ id: "a" });
    ok("markDirty（=snapshot）入 undoStack", core.canUndo());
  }

  /* ============ 空栈边界 ============ */
  {
    const data = { nodes: [{ id: "r" }] };
    const core = UndoCore(data);
    ok("空 undo 栈 undo() 返回 false", core.undo() === false);
    ok("空 redo 栈 redo() 返回 false", core.redo() === false);
    ok("空栈 canUndo=false, canRedo=false", !core.canUndo() && !core.canRedo());
  }

  /* ============ mount 返回值应暴露 undo/redo ============ */
  {
    ok("MM._undoCore 是函数", typeof MM._undoCore === "function");
  }

  console.log("\n" + pass + " passed, " + fail + " failed  (total " + (pass + fail) + ")");
  process.exit(fail ? 1 : 0);
})();
