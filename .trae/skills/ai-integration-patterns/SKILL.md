---
name: ai-integration-patterns
description: AI 功能集成模式库 — 从 GenOffice/Presenton 等竞品学习的 AI 办公集成
---

# AI 集成模式库

## 模式 1：块级 AI 编辑（GenOffice 核心）
不要在旁边加聊天框，而是**把 AI 操作直接嵌入编辑界面**：

```
用户选中一段文字 → 工具栏弹出 AI 按钮 → 点击 "改写" → AI 直接替换选中内容
```

绿角犀实现位置：
- Writer: 选中文本 → ribbon 出现 "AI 改写/续写/总结/翻译"
- Sheet: 选中公式 → "AI 帮我写这个公式"
- PDF: 选中文字 → "AI 批注/翻译/解释"
- Presentation: 选中幻灯片 → "AI 帮我完善这一页"

## 模式 2：BYOK（Bring Your Own Key）
用户自己填 API Key，绿角犀不托管：

```js
// app/js/ai.js
const PROVIDERS = {
  claude: { endpoint: "https://api.anthropic.com", headers: h => ({ "x-api-key": h.claudeKey }) },
  openai: { endpoint: "https://api.openai.com", headers: h => ({ Authorization: "Bearer " + h.openaiKey }) },
  deepseek: { endpoint: "https://api.deepseek.com", headers: h => ({ Authorization: "Bearer " + h.deepseekKey }) }
};
// 密钥存 Electron 主进程 keytar 或加密 localStorage
```

## 模式 3：本地 AI + 云端混合
- 小模型（改写/翻译）→ 本地 WASM（Ollama WASM 或 llama.cpp WASM）
- 大模型（长文总结/创意生成）→ 用户 BYOK 走云端
- 无密钥时 AI 功能禁用，不降级成广告

## 模式 4：AI 操作 → 可撤销命令
每次 AI 修改内容时，把操作包装成 Command：

```js
{
  type: "ai-rewrite",
  target: { module: "writer", range: [120, 340] },
  before: "原始文字",
  after: "AI 改写的文字",
  apply() { /* DOM diff + 替换 */ },
  undo() { /* 恢复 before */ }
}
```

## 模式 5：AI 不碰字节边界（GenOffice 经验）
永远不让 AI 直接操作 OOXML / PDF 字节。流程是：
1. **提取**：从文档里 AI 需要的部分（纯文本 / 坐标）
2. **传给 AI**：只给纯文本，不给 XML/PDF 结构
3. **接受 AI 输出**：结构化 JSON（不是自由文本）
4. **渲染**：绿角犀自己把 AI 输出写回正确的字节位置

这样 AI 输出有 bug 也不会破坏文件格式。
