#!/usr/bin/env node
/** 生成测试用 XMind 文件 — 扁平宽树，2500 节点 */
const JSZip = require("jszip");
const fs = require("fs");

const nodes = [];
nodes.push({ id: "n0", title: "根节点" });

// 先造 50 个一级节点
for (let i = 1; i <= 50; i++) {
  nodes.push({ id: "n" + i, title: "一级" + i, parentId: "n0" });
}

// 每个一级节点造 10 个二级节点 = 500
let id = 51;
for (let i = 1; i <= 50 && id <= 2500; i++) {
  for (let j = 0; j < 10 && id <= 2500; j++, id++) {
    nodes.push({ id: "n" + id, title: "二级" + id + " — " + "x".repeat(30), parentId: "n" + i });
  }
}

// 剩余的随机挂到已有的节点
while (id <= 2500) {
  const parent = "n" + Math.floor(Math.random() * (id - 1));
  nodes.push({ id: "n" + id, title: "长尾" + id, parentId: parent });
  id++;
}

// 转换为 XMind content.json 格式
function toXmindNode(n, childrenByParent) {
  const node = { id: n.id, title: n.title };
  const kids = childrenByParent.get(n.id);
  if (kids && kids.length) {
    node.children = { attached: kids.map(c => toXmindNode(c, childrenByParent)) };
  }
  return node;
}

// 分组
const byParent = new Map();
nodes.forEach(n => {
  const p = n.parentId || null;
  if (!byParent.has(p)) byParent.set(p, []);
  byParent.get(p).push(n);
});

const rootTopic = toXmindNode(nodes[0], byParent);

(async () => {
  const j = new JSZip();
  j.file("content.json", JSON.stringify([{ rootTopic, title: "Big MindMap" }]));
  const buf = await j.generateAsync({ type: "nodebuffer" });
  fs.mkdirSync("logs", { recursive: true });
  fs.writeFileSync("logs/test-big.xmind", buf);
  console.log("✅", id - 1, "节点 xmind, size:", buf.length, "bytes");
})();
