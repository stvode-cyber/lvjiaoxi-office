/*
 * _pdf_encrypt_test.js — OS.PdfEncrypt 单元测试（纯 node 运行）
 * 覆盖：未加密识别 / 算法判定 / 权限位解码 / CFM 嵌套字典 / 导出。
 */
const assert = require("assert");
const Crypto = require("./app/js/modules/pdf-encrypt.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  try { assert.ok(cond, name); console.log("  ✅ " + name); pass++; }
  catch (e) { console.log("  ❌ " + name + " → " + e.message); fail++; }
}

const HEX32 = "ab".repeat(32); // 64 hex = 32 bytes

function makePdf(encBody) {
  const s =
    "%PDF-1.7\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R/Encrypt 3 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[4 0 R]/Count 1>>endobj\n" +
    "3 0 obj<<" + encBody + ">>endobj\n" +
    "4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
    "trailer<</Root 1 0 R/Encrypt 3 0 R>>\n" +
    "%%EOF";
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

const AES128_BODY =
  "/Filter /Standard /V 4 /R 4 /Length 128 /P -1 /EncryptMetadata false " +
  "/O <" + HEX32 + "> /U <" + HEX32 + "> " +
  "/CF << /StdCF << /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF";

const AES128_RESTRICT =
  "/Filter /Standard /V 4 /R 4 /Length 128 /P -1028 /EncryptMetadata true " +
  "/O <" + HEX32 + "> /U <" + HEX32 + "> " +
  "/CF << /StdCF << /CFM /AESV2 /Length 16 >> >> /StmF /StdCF /StrF /StdCF";

const RC4_BODY =
  "/Filter /Standard /V 2 /R 3 /Length 40 /P -1 " +
  "/O <" + HEX32 + "> /U <" + HEX32 + ">";

console.log("PDF 加密与权限检测 · 单元测试");

// —— 1. 未加密识别 ——
function makePlainPdf() {
  const s = "%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}
const noEncBytes = Crypto.parseEncryption(new Uint8Array([37, 80, 68, 70])); // "%PDF" 无关
ok("未加密 PDF 返回 encrypted=false", noEncBytes.encrypted === false);
ok("无 /Encrypt 引用返回 encrypted=false", Crypto.parseEncryption(makePlainPdf()).encrypted === false);

// —— 2. AES-128 全字段 ——
const a = Crypto.parseEncryption(makePdf(AES128_BODY));
ok("encrypted=true", a.encrypted === true);
ok("detected=true", a.detected === true);
ok("filter=Standard", a.filter === "Standard");
ok("version V=4", a.version === 4);
ok("revision R=4", a.revision === 4);
ok("keyLength=128", a.keyLength === 128);
ok("algorithm=AES-128", a.algorithm === "AES-128");
ok("strength=中", a.strength === "中");
ok("encryptMetadata=false", a.encryptMetadata === false);
ok("cfm=AESV2", a.cfm === "AESV2");
ok("stmF=StdCF", a.stmF === "StdCF");
ok("strF=StdCF", a.strF === "StdCF");
ok("ownerHash 长度 64", typeof a.ownerHash === "string" && a.ownerHash.length === 64);
ok("userHash 长度 64", typeof a.userHash === "string" && a.userHash.length === 64);
ok("requiresPassword=true", a.requiresPassword === true);

// —— 3. 权限位解码（P=-1 全开）——
ok("P=-1 unsigned=4294967295", a.permissions.unsigned === 4294967295);
ok("P=-1 允许项=8/8", a.permissions.allowedCount === 8 && a.permissions.total === 8);
ok("P=-1 全部 allowed", a.permissions.items.every(i => i.allowed === true));

// —— 4. 权限位解码（P=-1028 仅禁提取无障碍）——
const b = Crypto.parseEncryption(makePdf(AES128_RESTRICT));
ok("P=-1028 unsigned 正确", b.permissions.unsigned === (4294967296 - 1028));
ok("P=-1028 允许项=7/8", b.permissions.allowedCount === 7);
ok("P=-1028 提取无障碍被禁", b.permissions.items.find(i => i.key === "extractAccess").allowed === false);
ok("P=-1028 打印仍允许", b.permissions.items.find(i => i.key === "print").allowed === true);
ok("P=-1028 组装仍允许", b.permissions.items.find(i => i.key === "assemble").allowed === true);
ok("P=-1028 元数据加密=是", b.encryptMetadata === true);

// —— 5. RC4 判定 ——
const c = Crypto.parseEncryption(makePdf(RC4_BODY));
ok("RC4: algorithm=RC4", c.algorithm === "RC4");
ok("RC4: strength=弱", c.strength === "弱");
ok("RC4: version V=2", c.version === 2);
ok("RC4: revision R=3", c.revision === 3);

// —— 6. 算法/权限纯函数 ——
ok("algorithmOf(2,1,null)=RC4-40", Crypto.algorithmOf(2, 1, null).algo === "RC4-40");
ok("algorithmOf(4,4,'V2')=RC4", Crypto.algorithmOf(4, 4, "V2").algo === "RC4");
ok("algorithmOf(6,5,null)=AES-256", Crypto.algorithmOf(6, 5, null).algo === "AES-256");
ok("decodePermissions(-1) 全开", Crypto.decodePermissions(-1).allowedCount === 8);
ok("decodePermissions(0) 全禁", Crypto.decodePermissions(0).allowedCount === 0);
ok("decodePermissions(8) 仅打印", Crypto.decodePermissions(8).allowedCount === 1 && Crypto.decodePermissions(8).items.find(i => i.key === "print").allowed === true);

// —— 7. 导出 ——
const md = Crypto.toMarkdown(a);
ok("toMarkdown 含『加密』", /加密/.test(md));
ok("toMarkdown 含算法 AES-128", /AES-128/.test(md));
const mdPlain = Crypto.toMarkdown({ encrypted: false });
ok("toMarkdown(未加密) 提示未发现", /未发现加密/.test(mdPlain));
const html = Crypto.toHtml(a);
ok("toHtml 含 AES-128", /AES-128/.test(html));
ok("toHtml 含 ✅ 允许", /✅/.test(html));
ok("toHtml(未加密) 空提示", /未检测到加密/.test(Crypto.toHtml({ encrypted: false })));

// —— 8. 嵌套字典切分（sliceDict）——
ok("sliceDict 平衡切分嵌套 <<>>", (function () {
  const t = "<< /CF << /StdCF << /CFM /AESV2 >> >> /StmF /StdCF >>";
  const d = Crypto.sliceDict(t, 0);
  return d && d.indexOf("/CFM /AESV2") > 0 && d.indexOf("/StmF /StdCF") > 0;
})());

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
