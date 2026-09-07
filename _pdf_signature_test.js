/*
 * _pdf_signature_test.js · OS.PdfSignature 单测（node 直接跑，零依赖）
 */
const C = require("D:/源码存档/绿角犀办公软件/app/js/modules/pdf-signature.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name); }
}

function enc(s) { return new TextEncoder().encode(s); }

// 无签名 PDF（仅一个空对象）
const noSig = enc("%PDF-1.7\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n");

// 含 1 个 PKCS#7 detached 签名的 PDF
const hex400 = "AB".repeat(200);
const sigBody =
  "13 0 obj\n" +
  "<< /Type /Sig /Filter /Adobe.PPKLite /Subtype /enveloped /SubFilter /adbe.pkcs7.detached " +
  "/Contents <" + hex400 + "> " +
  "/M (D:20240830120000+08'00') /Name (张三) /Reason (审批通过) /Location (广州) /ContactInfo (a@b.com) " +
  "/Reference [ << /Type /SigRef /TransformMethod /DocMDP /TransformParams << /Type /TransformParams /P 1 >> >> ] " +
  ">>\nendobj\n";
const oneSig = enc("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n" + sigBody + "trailer\n<< >>\n%%EOF\n");

// 含 /Cert 引用的签名
const sigCert =
  "14 0 obj\n" +
  "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached " +
  "/Contents <" + hex400 + "> /Name (李四) /Reason (归档) /Cert [ 8 0 R ] " +
  ">>\nendobj\n";
const certSig = enc("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n" + sigCert + "trailer\n<< >>\n%%EOF\n");

console.log("PDF 数字签名验证 · 单测");
const r0 = C.parseSignatures(noSig);
ok("无签名 → signed=false", r0.signed === false);
ok("无签名 → count=0", r0.count === 0);

const r1 = C.parseSignatures(oneSig);
ok("有签名 → signed=true", r1.signed === true);
ok("有签名 → count=1", r1.count === 1);
ok("子过滤器 adbe.pkcs7.detached", r1.signatures[0].subFilter === "adbe.pkcs7.detached");
ok("签名者 /Name = 张三", r1.signatures[0].name === "张三");
ok("原因 /Reason = 审批通过", r1.signatures[0].reason === "审批通过");
ok("地点 /Location = 广州", r1.signatures[0].location === "广州");
ok("联系 /ContactInfo = a@b.com", r1.signatures[0].contactInfo === "a@b.com");
ok("时间 /M 含 D:2024", !!r1.signatures[0].date && r1.signatures[0].date.indexOf("D:2024") === 0);
ok("原始容器已嵌入 (200 字节)", r1.signatures[0].hasContents && r1.signatures[0].contentsBytes === 200);
ok("引用类型 /Reference = DocMDP", r1.signatures[0].referenceType === "DocMDP");
ok("无证书引用 → hasCertRef=false", r1.hasCertRef === false);
ok("摘要提示含 SHA256", r1.signatures[0].digestHint.indexOf("SHA256") >= 0);
ok("格式 formats.pkcs7=true", r1.formats.pkcs7 === true);
ok("格式 formats.cades=false", r1.formats.cades === false);

const r2 = C.parseSignatures(certSig);
ok("CAdES 变体 → count=1", r2.count === 1);
ok("CAdES 子过滤器识别", r2.signatures[0].subFilter === "ETSI.CAdES.detached");
ok("有证书引用 → hasCertRef=true", r2.hasCertRef === true);
ok("格式 formats.cades=true", r2.formats.cades === true);

const sum = C.summarize(r1);
ok("summarize.signed=true", sum.signed === true && sum.count === 1);

const md = C.toMarkdown(r1, { title: "测试文档 签名验证" });
ok("toMarkdown 含标题", md.indexOf("测试文档 签名验证") >= 0);
ok("toMarkdown 含签名者名", md.indexOf("张三") >= 0);
ok("toMarkdown 含真实性免责", md.indexOf("不验证签名真实性") >= 0);

const md0 = C.toMarkdown(r0);
ok("无签名 toMarkdown 提示未检测", md0.indexOf("未检测到数字签名") >= 0);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
