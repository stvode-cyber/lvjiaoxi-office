# STATUS · 状态总览

> **状态-only 导航**。详细功能完成度见 [FEATURES.md](FEATURES.md)；模块划分与关系见 [工程总纲.md](工程总纲.md) 与各 [模块总纲](模块/)。
> 本文件只汇总「到哪了、卡哪了、去哪看」，不展开实现细节。

---

## 一、模块状态

| 模块 | 总纲 | 整体状态 | 一句话 |
|------|------|----------|--------|
| 01 文档编辑 | [总纲](模块/01_文档编辑_总纲.md) | ✅ 核心已实现 | 五模块 + MindMap 可实跑 |
| 02 PDF | [总纲](模块/02_PDF_总纲.md) | 🟡 部分实现 | 阅读/合并拆分/批注(类型齐全+图层+AP图像/矢量)/表单/文本层/多格式导出/属性解析/书签目录/附件提取 ✅；PDF→Excel/PDF→DOCX 版面还原有限；链接提取（外链审计）✅ |
| 03 格式兼容 | [总纲](模块/03_格式兼容_总纲.md) | ✅ 已实现 | OOXML / ODF / OFD 打通；PDF⇄Office 部分 |
| 04 账户与云端 | [总纲](模块/04_账户与云端_总纲.md) | ✅ 已实现 | 统一账号 / 云端 / 备档 / .lvjx 加密 |
| 05 外壳与通用 | [总纲](模块/05_外壳与通用_总纲.md) | ✅ 已实现 | 开始页 / ribbon / 命令面板 / 主题 / AI |
| 06 客户端与交付 | [总纲](模块/06_客户端与交付_总纲.md) | 🟡 部分实现 | Win / Android / PWA ✅；iOS / HarmonyOS ⚠️ 源码工程 |
| 07 发版与更新 | [总纲](模块/07_发版与更新_总纲.md) | ✅ 已实现 | 版本单一真源 / 全自动更新模式(启动检查+后台自动下载+退出自动装，generic feed 已接通 lujax.fun/releases) / 合规素材 |
| 08 测试与质量 | [总纲](模块/08_测试与质量_总纲.md) | ✅ 已实现 | 87 套件 0 失败；缺完整 E2E |

---

## 二、关键阻塞 / 大型 / 边界

| 级别 | 项 | 归属 | 说明 |
|------|----|------|------|
| 🟡 边界 | PDF→Excel（版面还原有限：文本+列边界聚类，无像素级表格） | 02 / 03 | 已实现可用，版面还原有限 |
| 🟡 边界 | PDF→DOCX/TXT/MD（版面还原有限） | 02 | 仅文本层 + 标题判别，无图片/表格/多栏 |
| 🟡 边界 | PDF→DOCX 版面还原 | 02 | 纯文本提取，非像素级版面 |
| ⚠️ 人工 | iOS / HarmonyOS 编译与上架 | 06 | 需 Mac / DevEco + 签名证书 + 隐私页 |
| ⚠️ 人工 | 商店合规（Android 自适应图标 / iOS LaunchScreen / PrivacyInfo） | 07 | 素材已生成，上架为人工项 |

---

## 三、基线指标（实跑证据）

- **测试**：`npm test` 整链 **89 套件 0 失败**（含 AK=PDF 表单字段提取 34 断言、AL=PDF 文档信息/元数据提取 33 断言、AM=PDF 页面属性/页面树信息提取 50 断言、AN=PDF 字体信息提取 74 断言、AP=PDF 动作/JavaScript 安全审计 37 断言、AQ=PDF 结构预检 42 断言；_updater_autoupdate_test 11 断言锁定 v1.0.15 自动更新正向链路）。
- **同源**：四端经 `sync-clients` 与 `app/` 一致 ✅。
- **2026-09-01 新增 PDF 1.5+ 对象流(ObjStm)合并/拆分支持**：`parsePdf`/`mergePdfs`/`splitPdf` 改异步（ObjStm 解压依赖 DecompressionStream），并修复 `extractStreamData` 末行 EOL 与 `extractFirstBalancedDict` 末位 `>` 偏移两处解析 bug（后者会让 ObjStm 对象字典丢失末位 `>`，合并真实 1.5+ PDF 时会输出畸形页面字典）；新增 `_pdf_merge_test` 12 断言 + `_pdf_tool_test` 回归全覆盖，整链 87 套件 0 失败。
- **2026-09-02 新增 AP=PDF 动作/JavaScript 安全审计**：`OS.PdfActions`（app/js/modules/pdf-actions.js）解析 /OpenAction（动作引用/内联动作/目标数组三形态）+ /AA 附加动作（Catalog/页面/批注，事件 O/E/X/U/D/Po/PC/WP/WC/DS/DC…）+ /A 动作引用 + /Names /JavaScript 名称树 + 全文档动作对象（JavaScript/Launch/SubmitForm/ImportData/GoTo(R/E)/URI/Named 等）；/JS 片段字节级解码（字面串 PDF 转义+八进制 / 十六进制；UTF-16BE→UTF-8→Latin-1）；Launch/SubmitForm/ImportData 目标（文件/URL）提取；风险分级 高(JS·Launch)/中(SubmitForm·ImportData)/低/info + 自动执行判定；面板（风险降序 + data-page 跳页）+ 导出审计报告 MD；_pdf_actions_test 37 断言。**同轮修复 sliceDict 族潜在缺陷**：pdf-actions/pdf-fonts/pdf-docinfo/pdf-encrypt/pdf-formfields/pdf-pageinfo 六模块平衡切分闭合 `>>` 处丢末位 `>`（与 AO 同族），嵌套字典解析失衡，统一改 `slice(startIdx, i + 1)`，六模块单测回归全绿。整链 **88 套件 0 失败**。

- **2026-09-02 新增 AQ=PDF 结构预检/完整性诊断**：`OS.PdfPreflight`（app/js/modules/pdf-preflight.js，复用 OS.PdfTool._inflate/parseObjStm 展开 PDF 1.5+ 对象流）只读体检 17 项：PDF 头版本、%%EOF、startxref、xref 表/流、trailer /Root、Root 对象定义、/Catalog 类型、/Size 一致性、悬挂引用（字典部分全文引用扫描，流二进制不参与）、重复对象定义、页面树环（自带 visited 安全走树，不依赖 OS.PdfTool.parsePdf 的无环保护递归）、页数 0、流 /Length 缺失/间接引用/失配（±2 容差，endstream 前 EOL 剥除后比对）、ObjStm 解压失败、孤儿对象；按 错误/警告/提示 三级 + verdict(errors/warnings/pass)；面板（级别色条 + 对象/页数/引用统计）+ 导出诊断报告 MD；_pdf_preflight_test 42 断言（8 组合成 PDF：健康/悬挂引用/重复对象/缺 trailer/页面树环/流 Length 三态/ObjStm 健康/缺 EOF+版本 2.9 + MD/HTML 导出）。整链 **89 套件 0 失败**。
- **最后更新**：2026-08-31（新增 AG=PDF 批注时间线（按天分组时序流 + 跳页 + 导出 MD），整链 76 套件 0 失败；S→AG 全特性已落地。Android APK 因本环境无 SDK 阻塞（未伪造）；正式发版本地已落地：release:check 通过 + 重建 dist 安装包（含 S→AG，verify 4/4）+ `git tag v1.0.0`（无 remote，push 待配置；CI 静默源待 LVJX_UPDATE_FEED）；新增 AH=PDF 链接/URI 提取（外链审计，27 断言，整链 78 套件 0 失败）；新增「登录设定」：默认游客直接进入（不强制登录），可在「账户与存储」开启「启动时要求登录」，登录页提供「以游客身份进入」跳过入口，纯逻辑 OS.AuthPolicy.shouldGate（_auth_policy_test 7 断言）；新增 AI=PDF 加密与权限检测（/Encrypt 字典解析 + 权限位八项 + 算法族判定，纯解析不解密，_pdf_encrypt_test 43 断言，整链 79 套件 0 失败）；新增 AJ=PDF 数字签名验证（扫描 /Type /Sig 签名对象，提取签名者/原因/地点/时间/子过滤器 PKCS#7·CAdES·X.509/原始 CMS 容器字节/证书引用/引用类型 DocMDP，字面串字节级解码兼容 UTF-8 中文签名者名，纯元数据提取不验证真实性，_pdf_signature_test 25 断言，整链 80 套件 0 失败）；**2026-08-31 新增 Windows 安装包「文件关联 / 默认打开方式」：NSIS 安装写入注册表（卸载项 + App Paths + 文件类型关联 HKCR），关联 .pdf/.ofd/.lvjx/.docx/.xlsx/.pptx，双击文件经 argv / second-instance 捕获路径 → IPC 推前端直接打开；bump 1.0.3，全链 81 套件 0 失败**）；**2026-08-31 新增 AK=PDF 表单字段提取（OS.PdfFormFields 解析 /AcroForm → /Fields 含 /Kids 递归，提取字段名/类型(文本框·复选·单选·下拉·列表·签名域)/当前值/默认值/选项/只读·必填等标志位/所在页，兼容 UTF-16BE/UTF-8 中文名值，面板浏览 + 导出清单 MD，34 断言，整链 82 套件 0 失败）**；**2026-08-31 新增 AL=PDF 文档信息/元数据提取（OS.PdfDocInfo 解析 /Info 字典 + /Metadata XMP 流，兼容 UTF-16BE·UTF-8·Latin-1 字面值与 XMP 元素/属性双形式，PDF 日期串 D:…→可读，面板浏览 Info+XMP + 导出报告 MD，33 断言；取代旧「文档属性」按钮为更全面的中文解码，整链 83 套件 0 失败）**；**2026-08-31 新增 AM=PDF 页面属性/页面树信息提取（OS.PdfPageInfo 解析页面树 /Pages→/Kids 递归（支持嵌套 /Pages 与间接 MediaBox 引用），逐页提取 MediaBox/CropBox/Rotate/资源(字体·图像·XObject 计数，图像含间接引用解析)，识别标准纸张 A4/Letter…，有效方向(旋转90/270翻转盒方向)，派生纸张尺寸分布·一致性·主流纸张·方向·旋转摘要，面板逐页浏览(点击跳页)+导出 MD，50 断言，整链 84 套件 0 失败）**；**2026-09-01 新增 AN=PDF 字体信息提取（OS.PdfFonts 遍历页面树收集每页 /Resources /Font（页面缺失时沿 /Parent 链继承），解析 BaseFont(子集前缀剥离)/Subtype/Encoding/ToUnicode/嵌入标志(FontFile·2·3，Type0 经 DescendantFonts 下钻 CIDFont；Type3 视为已嵌入)/Flags 九位(规范上属 FontDescriptor，字体字典优先·descriptor 兜底)/字符范围与宽度表，按字体对象去重合并使用页，标出「未嵌入且非标准 14」的显示·打印·转换风险字体，面板浏览(风险红条)+导出 MD，74 断言，整链 85 套件 0 失败）**；**2026-09-01 桌面端应用内静默更新接通：electron/feed-config.js 把非 GitHub 的 version.json.url（https://lujax.fun/releases）解析为 generic provider，桌面默认启用 electron-updater 静默下载安装；前端 app/js/updater.js 去掉 _autoEnabled 前置、按钮统一「立即更新」、下载失败兜底打开发布页；本地装 electron-updater(^6.8.9)；新增 _feed_config_test 10 断言、_updater_fallback_test 适配新契约，整链 85 套件 0 失败；bump 1.0.14 + 四端同源同步 + 重建 Windows 安装包（nsis+portable，latest.yml 指向 1.0.14），git tag v1.0.14（无 remote 未 push）**；**2026-09-01 桌面端更新升级为全自动更新模式（v1.0.15）：electron/main.js autoDownload=true（启动即 checkForUpdates+后台静默下载）+ autoInstallOnAppQuit=true（退出自动安装）；前端 app/js/updater.js 去掉「立即更新」按钮，改「后台自动下载中…」，下载完成给「立即重启/稍后」二选一；整链 85 套件 0 失败；bump 1.0.15+四端同源+重建安装包（latest.yml→1.0.15）+ tag v1.0.15（无 remote 未 push）**。**。

---

## 四、导航

- 功能明细 → [FEATURES.md](FEATURES.md)
- 范围 / 模块地图 / 关系 → [工程总纲.md](工程总纲.md)
- 各模块详情 → [模块/](模块/)
- 讨论与未定方案 → [讨论与处理/](讨论与处理/)
- 长期决策 → [MEMORY.md](MEMORY.md)
