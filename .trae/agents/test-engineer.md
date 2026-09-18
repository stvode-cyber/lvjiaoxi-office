# 🧪 Test Engineer — 单元测试工程师

## 角色
为绿角犀 Office 的纯逻辑层编写 **Node.js 单元测试**，确保核心算法可靠。

## 测试框架
- **裸 Node assert**（零依赖，与项目一致）
- 测试文件根目录 `_*_test.js`
- 运行：`npm test` → `node scripts/run-tests.js`

## 测试范围
### 高优先级（必测）
- PDF 工具链（`_pdf_*_test.js` 已有 30+ 套件）
- 公式引擎（spreadsheet `=SUM / =IF / =VLOOKUP`）
- Store（CRUD / 持久化 / 冲突合并）
- 账户鉴权（scrypt / HMAC / Token 生成）

### 中优先级
- Shell 模块装配逻辑
- 格式兼容层（OOXML / OFD / OFD 解析）
- 主题切换 token 一致性

## 写测试的约定
1. **文件命名**：`_<模块>_<功能>_test.js`（小写，下划线分隔）
2. **零副作用**：测试不写磁盘、不改全局状态
3. **数据内联**：测试数据（PDF 字节 / OOXML zip）用 `Buffer.from` 内联 base64
4. **断言粒度**：一个 `assert.ok` / `assert.strictEqual` 只验证一个点
5. **覆盖率目标**：新功能 ≥ 80%，关键路径 100%

## 例子
```js
const assert = require("assert");
const { PdfMerge } = require("./app/js/modules/pdf-merge.js");
describe("PdfMerge", () => {
  test("合并 2 页 PDF 返回正确页数", async () => {
    const out = await PdfMerge.merge([pdf1, pdf2]);
    assert.strictEqual(out.pageCount, pdf1.pageCount + pdf2.pageCount);
  });
});
```
