# CHANGELOG · 变更日志

> **导航-only**。每个版本记「一句话变更 + 关键数字 + 明细链接」，不在此堆细节；明细见对应模块总纲 / FD 卡 / `.workbuddy/memory/` 日志。
> 版本单一真源 = `package.json`（`node scripts/bump-version.js` 同步四端）。
> 当前版本 **1.0.17**（tag `v1.0.17`，已推 GitHub）。

***

## 版本总览

| 版本      | 日期         | 一句话                                  | 门禁         |
| ------- | ---------- | ------------------------------------ | ---------- |
| v1.0.17 | 2026-09-04 | 顶部导航五板块（工作台/订单/库存/审批/我的）+ 台账 CRUD + CSV 导出 | 99 套件 0 失败 |
| v1.0.16 | 2026-09-02 | PDF 1.5+ 对象流(ObjStm) 合并/拆分支持         | 87 套件 0 失败 |
| v1.0.15 | 2026-09-01 | 桌面端**全自动更新**（后台下载 + 退出自动装）           | 85 套件 0 失败 |
| v1.0.14 | 2026-09-01 | 桌面端应用内**静默更新**（generic provider 接通）  | 85 套件 0 失败 |
| v1.0.13 | 2026-09-01 | AN = PDF 字体信息提取 `OS.PdfFonts`        | 85 套件 0 失败 |
| v1.0.12 | 2026-08-31 | AM = PDF 页面属性/页面树信息 `OS.PdfPageInfo` | 84 套件 0 失败 |
| v1.0.11 | 2026-08-31 | AL = PDF 文档信息/元数据 `OS.PdfDocInfo`    | 83 套件 0 失败 |
| v1.0.10 | 2026-08-31 | AK = PDF 表单字段提取 `OS.PdfFormFields`   | 82 套件 0 失败 |
| v1.0.9  | 2026-08-31 | Writer P1 补齐（边框/底纹/排序/扩展样式）          | 81 套件 0 失败 |
| v1.0.8  | 2026-08-31 | Writer「开始」选项卡补齐 Word P0 功能区          | 81 套件 0 失败 |
| v1.0.7  | 2026-08-31 | 桌面端顶部菜单栏中文化                          | 81 套件 0 失败 |
| v1.0.6  | 2026-08-31 | 安装器铺盖前自动强杀旧进程                        | 81 套件 0 失败 |
| v1.0.5  | 2026-08-31 | NSIS 安装包自动铺盖/修复模式                    | 81 套件 0 失败 |
| v1.0.4  | 2026-08-31 | 修复主进程启动崩溃（`const PORT` 重赋值）          | 81 套件 0 失败 |
| v1.0.3  | 2026-08-31 | Windows 安装包**文件关联 / 默认打开方式**         | 81 套件 0 失败 |
| v1.0.2  | 2026-08-31 | 登录设定(游客直进) + AI 加密检测 + AJ 签名验证       | 80 套件 0 失败 |
| v1.0.1  | 2026-08-31 | AH = PDF 链接/URI 提取（外链审计）             | 77 套件 0 失败 |
| v1.0.0  | 2026-08-31 | **正式发布**：S→AG 全特性收口                  | 76 套件 0 失败 |

***

## 未发版（已提交，随下次打包）

### 2026-09-08 · 库存出入库（数量调整 + 流水）

- **库存** 新增 `planAdjust` / `adjustQty`（`app/js/modules/inventory.js`）：入库（+）/ 出库（−）非负整数校验、**出库超库存拒绝**（不改写数据）、`history` 流水记录（delta / cur / note）。
- 台账每行新增**数量输入 + 入库 / 出库**按钮，点击即调整并 toast 结果。
- 测试 `_inventory_adjust_test.js` **24 断言**（含 DOM 交互）→ 全量 **101 套件 0 失败** + 四端同源 ✅。

### 2026-09-08 · 业务板块批量操作

- 新增 `app/js/modules/biz-common.js`（`OS.biz.common`）：批量勾选工具条（全选 / 计数 / 批量按钮），订单·库存·审批三板块复用。
- **订单 / 库存**：`batchRemove`（幂等去重、缺失项回显、**不误删其他类型**）+ 列表复选框 + 批量删除。
- **审批**：`batchRemove` + `batchSetStatus`（**仅待审批项可流转**，终态 / 无效 / 他类型跳过）+ 批量通过 / 批量驳回 / 批量删除。
- 测试 `_biz_batch_test.js` **24 断言**（含 DOM 勾选→工具条→批量删除交互）→ 全量 **100 套件 0 失败** + 四端同源 ✅。

## 已发版明细

### v1.0.17 · 2026-09-04 · 顶部导航五板块 + 台账 CRUD + CSV 导出

- **顶部主导航**（`app/js/shell.js`）：工作台 / 订单 / 库存 / 审批 / 我的 五视图切换 + 面板骨架（`initTopNav` / `switchTopNav` / `renderTopPanel`），编辑态自动复位高亮。

- **订单板块**（`app/js/modules/orders.js`，`OS.biz.orders`）：本地 CRUD（IndexedDB，doc type="order"）+ 状态机（待处理/进行中/已完成/已取消）+ 统计（成交额/数量/状态分布）+ 表单/列表渲染；纯逻辑 `validateOrder`/`summarize` 与 DOM 分离。`_orders_biz_test.js` 25 断言。

- **库存板块**（`app/js/modules/inventory.js`，`OS.biz.inventory`）：商品库存台账 CRUD + 低库存预警 + 出入库记录。`_inventory_biz_test.js` 55 断言（与审批合计 30 断言）。

- **审批板块**（`app/js/modules/approvals.js`，`OS.biz.approvals`）：待办/已办 CRUD + 通过·驳回流转。`_approvals_biz_test.js`。

- **「我的」板块**（`app/js/modules/profile.js`，`OS.biz.profile`）：账户与存储（登录状态/50MB 空间）、偏好设置（主题/自动保存/数据本地化开关）、关于（版本号 `x-app-version` meta）。`_profile_biz_test.js` 15 断言。

- **业务 CSV 导出**（`app/js/modules/export.js`）：订单/库存/审批 一键导出 CSV（RFC4180 转义 + UTF-8 BOM）。`_export_csv_test.js` 14 断言。

- **随包并入**（v1.0.16 未发版部分）：E2E 测试（roundtrip 73 + scenarios 98 断言）、PDF 转换版面还原改进（段落合并/列表检测/多级标题）、GitHub 仓库 `stvode-cyber/lvjiaoxi-office` 推送、发布脚本版本无关化（`publish-latest.bat` 从 latest.yml 动态读版本）。

- 全量测试 **99 套件，0 失败** + 四端同源 ✅。

### v1.0.16 · 2026-09-02 · PDF 1.5+ 对象流(ObjStm) + 审计族 AP/AQ/AR

- `parsePdf` / `mergePdfs` / `splitPdf` 改**异步**（ObjStm 解压依赖 `DecompressionStream`），修复 `extractStreamData` 末行 EOL 与 `extractFirstBalancedDict` 末位 `>` 两处解析 bug；新增 `_pdf_merge_test` 12 断言 + `_pdf_tool_test` 回归 → **87 套件 0 失败**。明细：[`FD/FD-objstm.md`](FD/FD-objstm.md)

- **AR = PDF 文档历史 / 增量更新审计**（`OS.PdfHistory`，零依赖字节级）：沿 trailer `/Prev` 链回溯每次保存版本，检测线性化 `/Linearized` / `/Prev` 链断裂 / 计数不一致，verdict = single / multi / broken；面板版本表 + 导出报告 MD。`_pdf_history_test.js` **39 断言** → 90 套件 0 失败。明细：[`FD/FD-ar-history.md`](FD/FD-ar-history.md)

- **AQ = PDF 结构预检 / 完整性诊断**（`OS.PdfPreflight`，异步·展开 PDF 1.5+ 对象流）：只读体检 **17 项**（头版本/%%EOF/startxref/xref/trailer Root/Catalog 类型/Size 一致性/悬挂引用/重复对象/**页面树环**/页数 0/流 Length 三态/ObjStm 失败/孤儿对象），错误·警告·提示三级 + verdict，自带 visited 安全走树（不依赖 `parsePdf` 无环保护的递归）。`_pdf_preflight_test.js` **42 断言** → 89 套件 0 失败。明细：[`FD/FD-aq-preflight.md`](FD/FD-aq-preflight.md)

- **AP = PDF 动作 / JavaScript 安全审计**（`OS.PdfActions`）：/OpenAction(引用/内联/目标数组) + /AA 附加动作 + /A 引用 + /Names JavaScript 名称树 + 全文档动作对象，/JS 片段字节级解码（PDF 转义+八进制/十六进制，UTF-16BE→UTF-8→Latin-1），风险分级 高(JS·Launch)/中(SubmitForm·ImportData)/低/info + 自动执行判定；面板风险降序 + 导出报告 MD。**跨模块修复** sliceDict 族闭合丢末位 `>` 缺陷（6 模块统一 `slice(startIdx, i + 1)`）。`_pdf_actions_test.js` **37 断言** → 88 套件 0 失败。明细：[`FD/FD-ap-actions.md`](FD/FD-ap-actions.md)

> **PDF 只读审计族至此收齐**：加密 → 签名 → 动作 → 字体 → 结构 → 历史。

### v1.0.15 · 2026-09-01 · 桌面端全自动更新

- `electron/main.js`：`autoDownload=true`（启动即 checkForUpdates + 后台静默下载）+ `autoInstallOnAppQuit=true`（退出自动安装）。

- 前端 `app/js/updater.js`：去掉「立即更新」按钮，改「后台自动下载中…」，下载完成给「立即重启 / 稍后」。

- 顺带：`publish-desktop-feed` 支持 `--latest-only` 与自动定位 `REMOTE_DIR`；新增 `scripts/publish-latest.sh` 一键发布封装。

- `_updater_autoupdate_test` 11 断言锁定正向链路 → **85→86 套件 0 失败**。

### v1.0.14 · 2026-09-01 · 桌面端应用内静默更新

- `electron/feed-config.js`：把非 GitHub 的 `version.json.url`（`https://lujax.fun/releases`）解析为 **generic provider**。

- 装 `electron-updater ^6.8.9`；新增 `_feed_config_test` 10 断言 → **85 套件 0 失败**。

### v1.0.13 · 2026-09-01 · AN = PDF 字体信息提取

- `OS.PdfFonts`：页面树收集 `/Resources /Font`（缺失沿 `/Parent` 继承），解析 BaseFont（子集前缀剥离）/ Subtype / Encoding / ToUnicode / 嵌入标志（Type0 经 DescendantFonts 下钻；Type3 视已嵌入）/ Flags 九位。

- 标出「未嵌入且非标准 14」风险字体 → **74 断言**，**85 套件 0 失败**。

### v1.0.12 · 2026-08-31 · AM = PDF 页面属性 / 页面树信息

- `OS.PdfPageInfo`：MediaBox / CropBox / Rotate / 资源计数 + 标准纸张识别 + 方向·旋转摘要，逐页浏览(跳页) + 导出 MD → **50 断言**，**84 套件 0 失败**。

### v1.0.11 · 2026-08-31 · AL = PDF 文档信息 / 元数据

- `OS.PdfDocInfo`：`/Info` 字典 + `/Metadata` XMP 流（元素/属性双形式），UTF-16BE·UTF-8·Latin-1 兼容，`D:` 日期串可读化 → **33 断言**，**83 套件 0 失败**。

### v1.0.10 · 2026-08-31 · AK = PDF 表单字段提取

- `OS.PdfFormFields`：`/AcroForm → /Fields` 含 `/Kids` 递归，字段名/类型/值/选项/标志位/所在页 → **34 断言**，**82 套件 0 失败**。

### v1.0.9 · v1.0.8 · 2026-08-31 · Writer 功能区补齐

- P0：「开始」选项卡 Word 功能区对齐；P1：字符/段落边框、底纹、排序、扩展样式。

### v1.0.7 · 2026-08-31 · 桌面端菜单栏中文化

### v1.0.6 · v1.0.5 · 2026-08-31 · 安装包铺盖体验

- v1.0.5 NSIS 自动铺盖/修复模式；v1.0.6 铺盖前先强杀运行中旧进程，避免卡在「请关闭应用」。

### v1.0.4 · 2026-08-31 · 修复主进程启动崩溃

- 根因：`const PORT` 被重赋值。

### v1.0.3 · 2026-08-31 · Windows 文件关联 / 默认打开方式

- NSIS 写注册表（卸载项 + App Paths + 文件类型关联 HKCR），关联 `.pdf/.ofd/.lvjx/.docx/.xlsx/.pptx`；双击文件经 argv / second-instance 捕获 → IPC 推前端直接打开 → **81 套件 0 失败**。

### v1.0.2 · 2026-08-31 · 登录设定 + AI 加密检测 + AJ 签名验证

- 登录设定：默认游客直进（不强制登录），`OS.AuthPolicy.shouldGate` 纯逻辑 + 设置开关 → 7 断言（78 套件）。

- AI：`OS.PdfEncrypt` `/Encrypt` 字典 + 权限位八项 + 算法族判定（纯解析不解密）→ 43 断言（79 套件）。

- AJ：`OS.PdfSignature` `/Type /Sig` 扫描，签名者/原因/地点/时间/子过滤器/原始 CMS 字节/证书引用/DocMDP，UTF-8 中文解码 → 25 断言（**80 套件**）。

### v1.0.1 · 2026-08-31 · AH = PDF 链接 / URI 提取

- 外链审计 → 27 断言，**77 套件 0 失败**。

### v1.0.0 · 2026-08-31 · 正式发布

- S→AG 全特性落地与收口：五大编辑 + MindMap + OOXML + OFD + 云端 + 单账号 + 商店；PDF 阅读/批注/光栅/签名/文本层/表单/导出。

- `release:check` 通过 + 重建 dist 安装包（nsis + portable）+ `git tag v1.0.0` → **76 套件 0 失败**。

***

## 文档治理

### 2026-08-19 · 文档治理重构

- 建立 [工程总纲.md](工程总纲.md)：项目范围与导航的**单一真源**（目的 / 模块地图 / 技术栈 / 状态 / 关系 / 文档治理规范）。

- 建立 [模块/](模块/)：各模块带 `总纲.md`（目的 / 子文件 / 状态 / 关系），具体内容下沉到子文件。

- 建立 [讨论与处理/](讨论与处理/)：固定流程（发现问题→专题→推演→确认→回写→更新状态）+ 专题模板，与正式资料分离。

- 新建导航文件 [STATUS.md](STATUS.md) / [MEMORY.md](MEMORY.md) / 本文件，均只「指路 + 状态」。

- [AGENTS.md](AGENTS.md) 收敛为「自主运作宪法 + 导航指针」，原 §8 项目简介 / §9 清单迁入工程总纲。

### 2026-09-02 · FD 功能开发记录体系

- 新增 `FD/` 卡体系（说明 / 注释·坑 / 目标 G·VG / 关联 ↔E·↔Dc·↔A），现有 **12 张**（FD-01\~08 模块卡 + FD-objstm + FD-ap / FD-aq / FD-ar）。

- 每特性一张卡、可溯源，用于跨会话承接与踩坑沉淀。

***

## 已知遗留（非阻断）

| 项                          | 状态               | 说明                                                                           |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| 发布 1.0.16 到 VPS            | ⛔ 待用户侧           | 沙箱→`8.149.245.252` 全端口被出口防火墙丢弃，SSH/HTTPS 均超时；双击 `scripts/publish-latest.bat` |
| Android APK                | ⛔ 环境无 SDK/gradle | 未伪造；`clients/android/app/build` 已移出 git 索引                                   |
| PDF→DOCX/TXT/MD/Excel 版面还原 | 🟢 已改进           | 段落合并 + 列表检测 + 多级标题已实现；仍非像素级                                                  |

