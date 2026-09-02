# FD-01-doc-edit · 文档编辑（五大模块 + 思维导图）

## 说明
绿角犀 Office 核心编辑能力：Writer / Presentation / Spreadsheet / MindMap 等五大文档模块，可实跑创建、编辑、保存。

## 注释（细节 · 坑）
- 纯 classic-script SPA 架构：模块用 IIFE + OS 全局 + module.exports 挂载，零依赖优先，沙箱可测纯逻辑抽独立模块。
- 四端同源：iOS / HarmonyOS / Web / Desktop 的 webroot 必与 `app/` 一致，改后跑 `sync-clients`。
- 严格忠实镜像纪律：任一端改动须同步其余三端，否则四端行为漂移。

## 目标（对应 G / VG）
- **G**：核心文档编辑能力（创建/编辑/保存/导出）。
- **VG**：全功能可交付、四端同源。

## 关联（↔报错 / ↔决策 / ↔动作）
- ↔A 模块总纲 `模块/01_文档编辑_总纲.md`
- ↔Dc 字母序特性开发工作流（定字母→侦察→建纯模块→接线→测试→全量门禁→四端同步）
