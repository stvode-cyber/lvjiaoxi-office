/* 绿角犀 Office · PDF→Excel 版面还原增强测试
 * 验证：精细列边界检测 + 合并单元格识别 + 样式保留 + XLSX 真实生成
 * 纯逻辑 node 直跑，需要最小 OS mock
 *
 * PDF 坐标：y 向上为正（原点左下），页面顶部行 y 值最大
 *           x 向右递增
 *           gapThresh 默认 30pt（≥ 此值判为表格列间距）
 */
(function () {
  const XLSX = require('./app/vendor/xlsx.full.min.js');
  global.window = global;
  global.XLSX = XLSX;
  global.OS = global.OS || {};
  global.OS.LazyLib = { loadAll: () => Promise.reject(new Error('skip')) };
  global.OS.toast = () => {};
  global.OS.theme = { getVar: () => '' };
  require('./app/js/modules/pdf-engine.js');
  const PE = global.OS.PDFEngine;

  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

  // ============ 构造提取结果 ============

  // 构造一页 A4 竖版（595×842pt）的 extracted 数据
  // 行 y 从顶部 720 向下递减（PDF 坐标 y 向上）
  function makePage(width, height, items) {
    return { width, height, items };
  }

  // ============ 场景 1：简单 3 列表格 + bold 表头 ============

  {
    const page = makePage(595, 842, [
      // 表头行 y=720
      { x: 80, y: 720, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 720, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 480, y: 720, str: '城市', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      // 数据行 y=700（间距 20pt，表格行）
      { x: 80, y: 700, str: '张三', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 700, str: '28', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 480, y: 700, str: '广州', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      // 数据行 y=680
      { x: 80, y: 680, str: '李四', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 680, str: '31', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 480, y: 680, str: '深圳', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const detected = PE.detectTables({ pages: [page] });
    const sh = detected.sheets[0];

    ok('场景1 有 1 个 sheet', detected.sheets.length === 1);
    ok('场景1 有 3 行', sh.rows.length === 3);
    ok('场景1 有 3 列', sh._maxCols === 3);
    ok('场景1 表头第 1 行第 1 列=姓名', sh.rows[0][0] && sh.rows[0][0].text === '姓名');
    ok('场景1 表头 bold=true', sh.rows[0][0] && sh.rows[0][0].bold === true);
    ok('场景1 数据行张三 正确', sh.rows[1][0] && sh.rows[1][0].text === '张三');
    ok('场景1 数据行 28 正确', sh.rows[1][1] && sh.rows[1][1].text === '28');
    ok('场景1 数据行 深圳 正确', sh.rows[2][2] && sh.rows[2][2].text === '深圳');
    ok('场景1 无 merge（单列行）', !sh.merges || sh.merges.length === 0);

    // 验证 XLSX 生成
    const bytes = PE.buildXlsx(detected);
    ok('场景1 生成了 bytes', bytes && bytes.length > 1000);

    // SheetJS 社区版读回时 cell.s 会丢失 font/alignment/border，但 merges 正常
    const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
    const ws = wb.Sheets['Page1'];
    ok('场景1 读回有 sheet', !!ws);
    ok('场景1 A1 值正确', ws['A1'] && ws['A1'].v === '姓名');
    ok('场景1 C3 值正确', ws['C3'] && ws['C3'].v === '深圳');
    // merges 正常读回
    ok('场景1 !merges 为空（无合并）', !ws['!merges'] || ws['!merges'].length === 0);
  }

  // ============ 场景 2：带跨列表头的表格 ============

  {
    const page = makePage(595, 842, [
      // 跨列表头 "销售统计表" 宽度跨全表
      { x: 80, y: 720, str: '销售统计表', w: 320, h: 24, size: 18, bold: true, italic: false, fontName: 'SimHei' },
      // 列表头
      { x: 80, y: 690, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 690, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 480, y: 690, str: '城市', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      // 数据行
      { x: 80, y: 670, str: '王五', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 670, str: '45', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 480, y: 670, str: '北京', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const detected = PE.detectTables({ pages: [page] });
    const sh = detected.sheets[0];

    ok('场景2 有 3 行', sh.rows.length === 3);
    ok('场景2 有 3 列', sh._maxCols === 3);
    // 第一行应该是跨列表头
    ok('场景2 标题行在 row0', sh.rows[0][0] && sh.rows[0][0].text === '销售统计表');
    ok('场景2 标题行 bold=true', sh.rows[0][0] && sh.rows[0][0].bold === true);
    // 应该有 1 个 merge（row 0, col 0 → col 2）
    ok('场景2 detected 有 merge', sh.merges && sh.merges.length >= 1);
    if (sh.merges && sh.merges.length >= 1) {
      const m = sh.merges[0];
      ok('场景2 merge 行号=0', m.s.r === 0 && m.e.r === 0);
      ok('场景2 merge 列 0→2', m.s.c === 0 && m.e.c === 2);
    }

    // XLSX 验证：merges 能正常读回
    const bytes = PE.buildXlsx(detected);
    const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
    const ws = wb.Sheets['Page1'];
    ok('场景2 !merges 存在', ws['!merges'] && ws['!merges'].length >= 1);
    if (ws['!merges']) {
      ok('场景2 !merges[0] 列 0→2', ws['!merges'][0].s.c === 0 && ws['!merges'][0].e.c === 2);
      ok('场景2 !merges[0] 行都是 0', ws['!merges'][0].s.r === 0 && ws['!merges'][0].e.r === 0);
    }
    ok('场景2 A1 值=销售统计表', ws['A1'] && ws['A1'].v === '销售统计表');
  }

  // ============ 场景 3：混排页（prose + 表格 + prose + 另一表格） ============

  {
    const page = makePage(595, 842, [
      // prose 段落（紧密字间距 ~2pt，< gapThresh 30pt → 非表格行）
      { x: 80, y: 760, str: '本', w: 14, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 96, y: 760, str: '报告', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 128, y: 760, str: '总结', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      // 表格块 1（3 列，gap ~200pt）
      { x: 80, y: 730, str: '姓名', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 280, y: 730, str: '年龄', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 480, y: 730, str: '城市', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 80, y: 710, str: '张三', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 710, str: '28', w: 16, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 480, y: 710, str: '广州', w: 36, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      // prose 段落
      { x: 80, y: 670, str: '以上', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 112, y: 670, str: '为', w: 14, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 130, y: 670, str: '第一季度', w: 42, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      // 表格块 2（3 列，不同 x 位置）
      { x: 100, y: 640, str: '产品', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 300, y: 640, str: '单价', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 500, y: 640, str: '库存', w: 30, h: 18, size: 14, bold: true, italic: false, fontName: 'SimHei' },
      { x: 100, y: 620, str: '苹果', w: 30, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 300, y: 620, str: '5.0', w: 24, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 500, y: 620, str: '100', w: 28, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const detected = PE.detectTables({ pages: [page] });
    const sh = detected.sheets[0];

    ok('场景3 有 6 行（prose1+table2+prose1+table2）', sh.rows.length === 6);
    ok('场景3 最大列数 3', sh._maxCols === 3);
    // prose 行应该单格在 col0
    ok('场景3 第 1 行是 prose（含 报告）', sh.rows[0][0] && sh.rows[0][0].text.indexOf('报告') >= 0);
    ok('场景3 第 4 行是 prose（含 第一季度）', sh.rows[3][0] && sh.rows[3][0].text.indexOf('第一季度') >= 0);
    // prose 行的 col1/col2 应该是 null
    ok('场景3 prose 行 col1 为空', sh.rows[0][1] === null);
    ok('场景3 prose 行 col2 为空', sh.rows[0][2] === null);
    // 两个表格块独立分列：表格1 张三在 row2，表格2 苹果在 row5
    ok('场景3 row2 col0=张三', sh.rows[2] && sh.rows[2][0] && sh.rows[2][0].text === '张三');
    ok('场景3 row1 col0=姓名', sh.rows[1] && sh.rows[1][0] && sh.rows[1][0].text === '姓名');
    ok('场景3 row5 col2=100', sh.rows[5] && sh.rows[5][2] && sh.rows[5][2].text === '100');
    ok('场景3 无跨列表头 merge', !sh.merges || sh.merges.length === 0);
  }

  // ============ 场景 4：多页 ============

  {
    const page1 = makePage(595, 842, [
      { x: 80, y: 720, str: 'A1', w: 20, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 720, str: 'B1', w: 20, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const page2 = makePage(595, 842, [
      { x: 80, y: 720, str: 'A2', w: 20, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
      { x: 280, y: 720, str: 'B2', w: 20, h: 16, size: 12, bold: false, italic: false, fontName: 'SimSun' },
    ]);
    const detected = PE.detectTables({ pages: [page1, page2] });
    ok('场景4 有 2 个 sheet', detected.sheets.length === 2);
    ok('场景4 第 1 页名 Page1', detected.sheets[0].name === 'Page1');
    ok('场景4 第 2 页名 Page2', detected.sheets[1].name === 'Page2');

    const bytes = PE.buildXlsx(detected);
    const wb = XLSX.read(bytes, { type: 'array' });
    ok('场景4 有 2 个 workbook sheet', wb.SheetNames.length === 2);
  }

  // ============ 场景 5：空页 + 无可提取文本 ============

  {
    const detected = PE.detectTables({ pages: [] });
    ok('场景5 空输入返回空 sheets', detected.sheets.length === 0);

    const bytes = PE.buildXlsx({ sheets: [] });
    ok('场景5 空 detected 也能生成 bytes', bytes && bytes.length > 0);
  }

  // ============ 场景 6：buildXlsx 老格式兼容（纯字符串数组） ============

  {
    const detected = { sheets: [{ name: 'Legacy', rows: [['a', 'b'], ['1', '2']] }] };
    const bytes = PE.buildXlsx(detected);
    ok('场景6 老格式也能生成 bytes', bytes && bytes.length > 0);
    const wb = XLSX.read(bytes, { type: 'array' });
    const ws = wb.Sheets['Legacy'];
    ok('场景6 A1=a', ws['A1'] && ws['A1'].v === 'a');
    ok('场景6 B2=2', ws['B2'] && ws['B2'].v === '2');
    // 老格式 cell 没有 s 属性（没加 cellStyles 也正常）
  }

  console.log((fail === 0 ? '✓ 全部通过' : '✗ 有失败') + '：通过 ' + pass + ' / ' + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})();
