---
name: unit-test-spec
description: 绿角犀 Office 单元测试规范
---

# 单元测试规范

## 框架
- 裸 Node assert（零依赖）
- 文件根目录 _*_test.js
- 运行: npm test -> node scripts/run-tests.js

## 约定
1. 零副作用 — 不写磁盘、不改全局
2. 数据内联 — PDF/OOXML 用 Buffer.from 内联 base64
3. 断言粒度 — 一个 assert 只验证一个点
4. 覆盖率 — 新功能 >= 80%

## 模板
const assert = require('assert');
async function test(name, fn) {
  try { await fn(); console.log('OK', name); }
  catch(e) { console.log('FAIL', name, e.message); process.exitCode = 1; }
}
(async () => {
  console.log('=== PdfMerge ===');
  await test('合并 2 页 PDF 返回正确页数', async () => {
    const out = await PdfMerge.merge([pdf1, pdf2]);
    assert.strictEqual(out.pageCount, pdf1.pageCount + pdf2.pageCount);
  });
})();
