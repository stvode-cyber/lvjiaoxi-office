---
name: feedback-to-todo
description: 反馈转任务 — 把用户反馈 / bug 报告转成可复现 + 可修复的 TODO
---

# 反馈转任务

## 输入：用户反馈 / Bug 报告
用户说的可能很模糊："PDF 打不开"、"显示有问题"、"卡住了"

## 转换流程（5 步）

### Step 1：还原上下文
- 用户在哪个模块？（PDF / Writer / Sheet / Presentation / Mindmap）
- 用户做了什么操作？（双击文件 / 新建 / 导入 / AI 润色）
- 用户的文件是什么格式？（.pdf / .docx / .xlsx / .pptx / .ofd / .txt）
- 构建版本是什么？（Setup 版 / Portable / dist:local）

### Step 2：定位可能的根因（穷举法）
以 "PDF 打不开" 为例，依次排查：
| 可能原因 | 验证方法 |
|---------|---------|
| 文件关联没注册 | `reg query HKCU\...Classes\.pdf` |
| pdf-lib 加载失败 | CDP `window.PDFLib` 是不是 undefined |
| renderAll 里 for 循环死锁 | CDP `Runtime.evaluate` 看 `page-box` 数量 |
| view.hidden=true | CDP 查 `.pdf-view.hidden` |
| pdfToolboxRoot DOM 缺失 | CDP 查 `#pdfToolboxRoot` |
| JS 语法错误 | Electron main 的 renderer error 日志 |
| 文件本身损坏 | 用 Acrobat 验证 |
| Electron 缓存坏 | 删掉 `%APPDATA%/绿角犀 Office` 重试 |

### Step 3：写可复现脚本（CDP）
每个 bug 必须有一个最小可复现脚本：

```js
// _repro_pdf_open.js
// 1. 启动 Office + --remote-debugging-port=9222
// 2. CDP 连进去，打开一个真实 PDF
// 3. 检查 DOM / console / network
const W = require("ws"), H = require("http");
H.get("http://127.0.0.1:9222/json", s => { ... });
```

### Step 4：修复 + 验证
- 先修代码（最小改动）
- `node --check` 语法检查
- `npm run dist:local` 构建
- 重跑 Step 3 的脚本，确认 bug 消失
- 跑完整 CDP 冒烟测试（所有模块能 mount）

### Step 5：沉淀
- 修复记录在 `TECH_DEBT.md`（如果是常见根因）
- 特殊修复模式沉淀成 SKILL.md（比如"Electron 进程不重启跑旧代码"）

## 避坑
1. **别凭感觉修** — 必须先写可复现脚本
2. **别一次改多处** — 最小改动，验证后再下
3. **别忽略 Electron 缓存** — 改完代码必须 `taskkill /F` 再启动
4. **别跳过语法检查** — `node --check` 比 Electron 报错清晰 100 倍
5. **别只在一个模块测** — 改 PDF 不影响 Writer 吗？跑一遍全模块 mount
