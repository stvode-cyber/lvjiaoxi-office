// 绿角犀 Office · Electron 文件关联参数解析（纯函数，零依赖，可单测）
// 负责从 process.argv / second-instance argv 中筛选出被"双击打开"的文档路径。
const KNOWN_EXT = [".pdf", ".ofd", ".lvjx", ".docx", ".xlsx", ".pptx", ".csv", ".txt", ".md", ".html", ".htm", ".xmind"];

function isKnownExt(s) {
  const l = (s || "").toLowerCase();
  return KNOWN_EXT.some(e => l.endsWith(e));
}

// argv 形如 [exePath, projectRootOrFilePath, ...]；Windows 下双击关联文件启动时 argv[1] 即文件路径。
// 过滤掉项目根 "." 以及非文档参数，返回绝对/相对文件路径数组。
function extractFilePaths(argv) {
  const out = [];
  for (const a of (argv || [])) {
    if (typeof a !== "string") continue;
    if (a === "." || a === "--" || a === "-") continue;
    if (!isKnownExt(a)) continue;
    out.push(a);
  }
  return out;
}

module.exports = { KNOWN_EXT, isKnownExt, extractFilePaths };
