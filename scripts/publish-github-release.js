/* 绿角犀 Office · GitHub Release 自动创建 + 上传 assets
 * 运行：node scripts/publish-github-release.js v1.1.4
 * 需要：GH_TOKEN 环境变量（repo: scope）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const VERSION = process.argv[2] || "v1.1.4";
const REPO_OWNER = "stvode-cyber";
const REPO_NAME = "lvjiaoxi-office";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) { console.error("❌ 需要 GH_TOKEN 环境变量"); process.exit(1); }

const distDir = path.join(__dirname, "..", "dist");

// —— HTTPS POST 封装 ——
function ghApi(method, path, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL("https://api.github.com" + path);
    const data = body ? (typeof body === "string" ? Buffer.from(body) : Buffer.from(JSON.stringify(body))) : null;
    const req = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: Object.assign({
        "Authorization": `token ${TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "lvjiaoxi-publish-script"
      }, opts.headers || {}, data ? { "Content-Length": data.length } : {})
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(raw.toString("utf8")); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw.toString("utf8") });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function ghUpload(uploadUrl, filePath) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    // uploadUrl 里带占位符 {?name,label}，替换 ?name=xxx
    const u = new URL(uploadUrl.replace("{?name,label}", `?name=${encodeURIComponent(fileName)}`));
    console.log(`  📤 上传 ${fileName} (${(fileData.length/1024/1024).toFixed(1)} MB)`);
    // GitHub upload endpoint: 直接 POST 原始文件 body
    const contentType = fileName.endsWith(".yml") || fileName.endsWith(".yaml") ? "text/yaml"
                      : fileName.endsWith(".exe") ? "application/vnd.microsoft.portable-executable"
                      : fileName.endsWith(".blockmap") ? "application/octet-stream"
                      : "application/octet-stream";
    const req = https.request({
      method: "POST", hostname: u.hostname, path: u.pathname + u.search,
      headers: {
        "Authorization": `token ${TOKEN}`,
        "Content-Type": contentType,
        "Content-Length": fileData.length,
        "User-Agent": "lvjiaoxi-publish-script"
      },
      timeout: 300000 // 5 分钟大文件
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(raw.toString("utf8")); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(fileData);
    req.end();
  });
}

async function main() {
  console.log("=".repeat(60));
  console.log(`GitHub Release 创建脚本 · ${VERSION}`);
  console.log("=".repeat(60));

  // —— Step 1: 检查 tag 是否存在 ——
  console.log(`\n[1/4] 检查 tag ${VERSION}...`);
  const tagCheck = await ghApi("GET", `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/tags/${VERSION}`);
  if (tagCheck.status === 404) {
    console.error(`  ❌ tag ${VERSION} 不存在！先跑 git tag ${VERSION} && git push origin ${VERSION}`);
    process.exit(1);
  }
  console.log(`  ✅ tag 存在`);

  // —— Step 2: 检查 release 是否已存在 ——
  console.log(`\n[2/4] 检查已有 release...`);
  const existing = await ghApi("GET", `/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${VERSION}`);
  let releaseId = null, uploadUrl = null;

  const bodyText = `## 📦 绿角犀 Office ${VERSION}

### 🆕 本次更新

- **PDF 懒渲染**：300 页 PDF 从全量渲 → IntersectionObserver 进视口才渲（首屏秒出）
- **PDF 缩略图缓存**：同 PDF 第二次打开缩略图秒出
- **MindMap render debounce**：用户快速改文字/批量操作不爆；点击选中零重渲
- **Presentation/MindMap 查找替换 undo 修复**：替换后 Ctrl+Z 可撤销（之前只改 DOM 不改数据）
- **MindMap search/replaceAll 纯函数**：shell globalReplace 跨文档替换现在能调 MindMap 了
- **PDF→PPTX 转换**：每页 canvas render PNG + JSZip 拼 PPTX（零新增依赖）
- **Ctrl+Z 跨模块统一**：OS.Undo 调度器 5 模块全通
- **静默更新端到端验证**：generic provider 链路已本地验证通过

### 📊 测试

- 102 单元测试全绿
- 73 E2E 往返测试全过
- 39/39 快捷键矩阵
- 28 版本比对铁律断言

### 📥 下载

- **Setup 安装包**（推荐）
- **Portable 绿色版**（免安装）

### ⚠️ 已知限制

- Setup.exe **未签名**（NotSigned）—— Windows SmartScreen 会提示风险，首次安装请点"更多信息 → 仍要运行"
- 远程静默更新需要把 dist/ 文件托管到 update.lvjiaoxi.cn（当前是本地验证通过）
`;

  if (existing.status === 200) {
    console.log(`  ⚠️ release 已存在 (id=${existing.body.id})，删除后重建...`);
    await ghApi("DELETE", `/repos/${REPO_OWNER}/${REPO_NAME}/releases/${existing.body.id}`);
  }

  // —— Step 3: 创建 release ——
  console.log(`\n[3/4] 创建 release ${VERSION}...`);
  const createResp = await ghApi("POST", `/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
    tag_name: VERSION,
    name: `绿角犀 Office ${VERSION}`,
    body: bodyText,
    draft: false,
    prerelease: VERSION.includes("rc") || VERSION.includes("beta"),
    generate_release_notes: false
  });

  if (createResp.status !== 201) {
    console.error(`  ❌ 创建失败: ${createResp.status}`, createResp.body || createResp.raw);
    process.exit(1);
  }
  releaseId = createResp.body.id;
  uploadUrl = createResp.body.upload_url;
  console.log(`  ✅ release 创建成功！id=${releaseId}`);
  console.log(`  🔗 ${createResp.body.html_url}`);

  // —— Step 4: 上传 assets ——
  console.log(`\n[4/4] 上传 assets...`);
  const assets = [
    "latest.yml",
    "绿角犀 Office Setup 1.1.4.exe",
    "绿角犀 Office Setup 1.1.4.exe.blockmap",
    "绿角犀 Office 1.1.4.exe"
  ];

  let ok = 0, fail = 0;
  for (const name of assets) {
    const fp = path.join(distDir, name);
    if (!fs.existsSync(fp)) { console.log(`  ⚠️  跳过 ${name}（不存在）`); fail++; continue; }
    try {
      const r = await ghUpload(uploadUrl, fp);
      if (r.status === 201) { console.log(`  ✅ ${name}`); ok++; }
      else { console.log(`  ❌ ${name}: HTTP ${r.status}`, r.body?.message || ""); fail++; }
    } catch (e) {
      console.log(`  ❌ ${name}: ${e.message}`); fail++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  if (fail === 0) {
    console.log(`🎉 Release 创建完成！${ok}/${assets.length} assets 全上传`);
    console.log(`🔗 ${createResp.body.html_url}`);
  } else {
    console.log(`⚠️  ${ok} 成功, ${fail} 失败`);
  }
  console.log("=".repeat(60));
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
