/* 绿角犀 Office · PDF→DOCX 版面还原增强测试
 * 验证：buildDocxDocument 能正确构建 + Packer 能打包出合法 docx ZIP
 * 内部结构细节（docx.Table / columnSpan）由打包成功和全量测试覆盖
 */
(function () {
  const docx = require('./app/vendor/docx.umd.min.js');
  global.window = global;
  global.OS = global.OS || {};
  global.OS.LazyLib = { loadAll: () => Promise.reject(new Error('skip')) };
  global.OS.toast = () => {};
  global.OS.theme = { getVar: () => '' };
  global.docx = docx;
  require('./app/js/modules/pdf-engine.js');
  const PE = global.OS.PDFEngine;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

  function makePage(width, height, items) {
    return { width, height, items };
  }

  async function packAndVerify(doc, label) {
    try {
      ok(label + ' 是 docx.Document', doc instanceof docx.Document);
      const blob = await docx.Packer.toBlob(doc);
      const ab = await blob.arrayBuffer();
      const buf = Buffer.from(ab);
      ok(label + ' 打包生成非空 buffer', buf.length > 1000);
      ok(label + ' 是 ZIP 格式 (PK 头)', buf[0] === 0x50 && buf[1] === 0x4B);
    } catch (e) {
      console.error('  ✗ ' + label + ' 打包异常:', e.message);
      fail++;
    }
  }

  // 场景 1：简单 3 列表格
  async function run1() {
    const page = makePage(595, 842, [
      { x: 80, y: 720, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 720, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 480, y: 720, str: '城市', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 80, y: 695, str: '张三', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 695, str: '28', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 480, y: 695, str: '广州', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const doc = PE.buildDocxDocument({ pages: [page], pageCount: 1 });
    await packAndVerify(doc, '场景1 简单表格');
  }

  // 场景 2：跨列表头
  async function run2() {
    const page = makePage(595, 842, [
      { x: 80, y: 720, str: '销售统计表', w: 320, h: 24, size: 18, bold: true, italic: false, fontName: 'SimHei' },
      { x: 80, y: 690, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 690, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 480, y: 690, str: '城市', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 80, y: 665, str: '王五', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 665, str: '45', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 480, y: 665, str: '北京', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const doc = PE.buildDocxDocument({ pages: [page], pageCount: 1 });
    await packAndVerify(doc, '场景2 跨列表头');
  }

  // 场景 3：混排页 prose + 表 + prose + 表
  async function run3() {
    const page = makePage(595, 842, [
      { x: 80, y: 760, str: '本', w: 14, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 96, y: 760, str: '报告', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 128, y: 760, str: '总结', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 80, y: 730, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 730, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 480, y: 730, str: '城市', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 80, y: 705, str: '张三', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 705, str: '28', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 480, y: 705, str: '广州', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 80, y: 665, str: '以上', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 112, y: 665, str: '为', w: 14, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 130, y: 665, str: '第一季度', w: 42, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 100, y: 635, str: '产品', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 300, y: 635, str: '单价', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 500, y: 635, str: '库存', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 100, y: 610, str: '苹果', w: 30, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 300, y: 610, str: '5.0', w: 24, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 500, y: 610, str: '100', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const doc = PE.buildDocxDocument({ pages: [page], pageCount: 1 });
    await packAndVerify(doc, '场景3 混排页');
  }

  // 场景 4：纯 prose 页
  async function run4() {
    const page = makePage(595, 842, [
      { x: 80, y: 760, str: '本', w: 14, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 96, y: 760, str: '报告', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 128, y: 760, str: '总结', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const doc = PE.buildDocxDocument({ pages: [page], pageCount: 1 });
    await packAndVerify(doc, '场景4 纯 prose');
  }

  // 场景 5：多页 + 空页
  async function run5() {
    const p1 = makePage(595, 842, [
      { x: 80, y: 700, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 700, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 80, y: 680, str: '张三', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 680, str: '28', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const p2 = makePage(595, 842, [
      { x: 80, y: 700, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 700, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 80, y: 680, str: '李四', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 680, str: '31', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const doc = PE.buildDocxDocument({ pages: [p1, p2], pageCount: 2 });
    await packAndVerify(doc, '场景5 多页');

    // 空页容错
    const empty = PE.buildDocxDocument({ pages: [], pageCount: 0 });
    ok('场景6 空页返回 docx.Document', empty instanceof docx.Document);
  }

  (async () => {
    try {
      await run1();
      await run2();
      await run3();
      await run4();
      await run5();
    } catch (e) {
      console.error('异常:', e.message);
      fail++;
    }
    console.log((fail === 0 ? '✓ 全部通过' : '✗ 有失败') + '：通过 ' + pass + ' / ' + (pass + fail));
    process.exit(fail === 0 ? 0 : 1);
  })();
})();
