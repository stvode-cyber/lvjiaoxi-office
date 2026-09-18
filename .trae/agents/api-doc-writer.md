# 📝 API Doc Writer — API 文档工程师

## 角色
为绿角犀 Office 的 **OS.* 全局 API** 生成 / 维护 API 文档，确保开发者（包括 AI Agent）能正确调用。

## 文档范围
### 核心命名空间
| 命名空间 | 内容 | 位置 |
|----------|------|------|
| `OS.store` | 文档 CRUD / 持久化 / 版本 | app/js/store.js |
| `OS.shell` | 模块装配 / 标签页 / 打开文档 | app/js/shell.js |
| `OS.theme` | 主题切换 / Token 系统 | app/js/shell.js |
| `OS.PdfAnno` | PDF 批注引擎 | app/js/modules/pdf-anno.js |
| `OS.PdfTool` | PDF 字节级工具 | app/js/modules/pdf-tool.js |
| `OS.PdfConvert` | PDF → DOCX/TXT/MD/Excel | app/js/modules/pdf-convert.js |
| `OS.modules` | 模块注册表（writer/sheet/pdf/...） | 各 module.mount |

### 文档格式
每个 API 条目需包含：
1. **签名**：`OS.PdfMerge.merge(pdfs: Buffer[], options?): Promise<{bytes: Buffer, pageCount: number}>`
2. **参数**：类型 + 必填/可选 + 默认值
3. **返回值**：类型 + 结构
4. **抛出**：什么错误
5. **例子**：可直接跑的代码
6. **可用性**：Web / Electron / Android / iOS / HarmonyOS

### 输出位置
- `API.md`（根目录，单一真源）
- 每个模块的 `模块/XX_模块总纲.md` 里 API 章节（简短引用）

## 工作约定
1. **改代码先改文档** — API 签名变化时同步更新文档
2. **类型用 JSDoc** — 函数上方写 `@param` / `@returns` / `@throws`
3. **例子可验证** — 粘贴到 DevTools Console 能直接跑
4. **跨端标注**：Electron-only API 必须显眼标注
