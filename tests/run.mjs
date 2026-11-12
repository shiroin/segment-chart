// ブラウザ（Playwright / Chromium）で各モードを動かして確認するテスト
//   npm i && npx playwright install chromium && npm test
// 外部通信はすべて差し替える（Google・CDN にはつながない）。スクリーンショットは tests/shots/ に保存。
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = root + 'tests/shots/';
mkdirSync(SHOTS, { recursive: true });
const SRC = 'file://' + root + 'src/index.html';
const GAS = 'file://' + root + 'gas/index.html';
const WEB = 'file://' + root + 'index.html';

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };

/* ---------- テスト用データ（架空） ---------- */
const note = ['四半期と年度は別シートで管理します。'];
const matrix = (name, header, rows) => ({ name, rows: [[name], note, [], header, ...rows] });
const SEGS = ['Alpha', 'Beta', 'Gamma'];
const qRows = (base) => ['FY2025Q1', 'FY2025Q2', 'FY2025Q3', 'FY2025Q4', 'FY2026Q1'].map((p, i) => [p, ...SEGS.map((_, k) => String(base * (k + 1) + i * 10))]);
const companyBook = (cur, scale, profit = 'operating_profit') => [
  { name: '設定', rows: [['会社マスター設定'], ['…'], [], ['setting', 'value', '説明', '', '種類', '項目名', '表示名', 'カラー'],
    ['company_name', 'テスト社', '', '', 'セグメント', 'Alpha', 'Alpha', '#1675F8'],
    ['note', '※ 12月決算', '', '', 'セグメント', 'Beta', 'Beta', '#20B779'],
    ['input_currency', cur, '', '', 'セグメント', 'Gamma', 'Gamma', '#FFA126'],
    ['display_unit', '億（現地通貨）', '', '', 'ARR', 'X', 'X', '#000000'],
    ['margin_color', '#FF8A00'], ['revenue_color', '#1675F8'], ['operating_profit_color', '#08A89C']] },
  matrix('会社全体_四半期', ['period', 'revenue', profit], qRows(100 * scale).map(r => [r[0], String(+r[1] * 6), String(+r[1] * 2)])),
  matrix('会社全体_年度', ['period', 'revenue', profit], [['FY2024', String(2000 * scale), String(500 * scale)], ['FY2025', String(2600 * scale), String(700 * scale)]]),
  matrix('セグメント売上高_四半期', ['period', ...SEGS], qRows(100 * scale)),
  matrix('セグメント利益_四半期', ['period', ...SEGS], qRows(20 * scale)),
  matrix('セグメント売上高_年度', ['period', ...SEGS], []),
  matrix('セグメント利益_年度', ['period', ...SEGS], []),
  matrix('受注_四半期', ['period', 'orders', 'backlog'], [['FY2025Q1', '1', '2']]),
];
const MASTER_ID = 'MASTER_ID_0123456789abcdef';
const master = [['', '', 'IR資料のまとめ'],
  ['No.', ' Ticker', '企業名', '日本名', ...Array(23).fill(''), 'Financials', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '決算期', '', '通貨'],
  ['1', 'AAA', 'Alpha Corp', 'アルファ', ...Array(23).fill(''), 'https://docs.google.com/spreadsheets/d/COMPANY_A_0123456789abcdef/edit', ...Array(16).fill(''), '12月', '', '円'],
  ['3', 'CCC', 'Gamma Shoji', 'ガンマ商事', ...Array(23).fill(''), 'https://docs.google.com/spreadsheets/d/COMPANY_C_0123456789abcdef/edit', ...Array(16).fill(''), '3月', '', '円'],
  ['2', 'BBB', 'Beta Inc', 'ベータ', ...Array(23).fill(''), 'https://docs.google.com/spreadsheets/d/COMPANY_B_0123456789abcdef/edit', ...Array(16).fill(''), '1月', '', 'ドル']];
master[1][45] = '決算日'; master[2][45] = '2000/01/05'; master[3][45] = '2999-12-31'; master[4][45] = '';
master[1][47] = 'AI'; master[1][48] = '海運'; master[2][47] = '1'; master[3][48] = '1'; master[4][47] = '1';
master[1][7] = '業種カテゴリー1'; master[2][7] = 'AI'; master[3][7] = '総合商社'; master[4][7] = 'AI';
const BOOKS = { [MASTER_ID]: [{ name: 'global_company_watch_300', rows: master }], COMPANY_A_0123456789abcdef: companyBook('JPY', 10), COMPANY_B_0123456789abcdef: companyBook('USD', 1), COMPANY_C_0123456789abcdef: companyBook('JPY', 8, 'profit_before_tax'), SHEET_ID_0123456789abcdefgh: companyBook('JPY', 10) };
const sheetOf = (id, a1) => { const nm = a1.replace(/!.*$/, '').replace(/^'|'$/g, '').replace(/''/g, "'"); return ((BOOKS[id] || []).find(t => t.name === nm) || {}).rows || null; };

async function page(browser, url, init) {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: '', contentType: 'text/css' }));
  await p.exposeFunction('__sheet', (id, a1) => sheetOf(id, a1));
  await p.exposeFunction('__titles', id => (BOOKS[id] || []).map(t => t.name));
  await p.exposeFunction('__book', id => BOOKS[id] || null);
  if (init) await p.addInitScript(init);
  await p.goto(url);
  await p.waitForTimeout(500);
  return { p, errs };
}

/* Claude の Google Sheets 連携のモック */
const mcpMock = () => {
  const mcp = {
    describeTool: async (s, t) => ({ inputSchema: { properties: t === 'get_spreadsheet' ? { spreadsheetId: {}, fields: {} } : { spreadsheetId: {}, range: {} } } }),
    callTool: async (s, t, inp) => {
      if (t === 'get_spreadsheet') { const ts = await window.__titles(inp.spreadsheetId); return { payload: { properties: { title: 'book' }, sheets: ts.map(title => ({ properties: { title } })) } }; }
      const v = await window.__sheet(inp.spreadsheetId, inp.range);
      if (!v) throw { code: 'tool_error', message: 'Unable to parse range' };
      return { payload: { range: inp.range, values: v } };
    },
  };
  window.claude = { use: async n => (n === 'mcp' ? mcp : null) };
};

/* Apps Script（google.script.run）のモック */
const gasMock = () => {
  const run = () => {
    const h = {}; const o = {
      withSuccessHandler(f) { h.ok = f; return o; }, withFailureHandler(f) { h.ng = f; return o; },
      getSheetTables(id) { window.__book(id || 'SHEET_ID_0123456789abcdefgh').then(tables => h.ok({ id: id || 'SHEET_ID_0123456789abcdefgh', name: 'テスト社', url: 'https://docs.google.com/spreadsheets/d/SHEET_ID_0123456789abcdefgh/edit', isMaster: false, tables })); },
      getSheetTitles(id) { window.__titles(id).then(h.ok); },
      getRanges(id, rs) { Promise.all(rs.map(r => window.__sheet(id, r))).then(vs => h.ok(Object.fromEntries(rs.map((r, i) => [r, vs[i]])))); },
      saveSegments() { setTimeout(() => h.ok(true), 5); },
    }; return o;
  };
  window.google = { script: { get run() { return run(); }, url: { getLocation(cb) { cb({ parameter: {} }); } }, history: { replace() {} } } };
};

const browser = await chromium.launch();
const status = p => p.evaluate(() => document.querySelector('#status').innerText);

console.log('1. サンプル表示（src）');
{
  const { p, errs } = await page(browser, SRC);
  ok(/4セグメント/.test(await status(p)), 'サンプルが読み込まれる');
  ok(await p.$('#chart svg') !== null, 'グラフが描かれる');
  const lines0 = await p.$$eval('#chart svg path[stroke-width="2.2"]', a => a.length);
  await p.click('#segList .segrow:not(.total) .mg');
  ok(await p.evaluate(() => M.segs[0].showMargin === false), '利益率の線をセグメントごとに消せる');
  ok(await p.$$eval('#chart svg path[stroke-width="2.2"]', a => a.length) === lines0 - 1, '消したセグメントの線が描かれない');
  await p.click('#segList .segrow:not(.total) .mg');
  await p.evaluate(() => { const rows = [['セグメント', '期', '売上', '営業利益']]; ['2025 1Q', '2025 2Q', '2025 3Q'].forEach(q => { rows.push(['A', q, 1000, 200]); rows.push(['B', q, 100, -300]); }); ingest([{ name: 'd', rows }], 't'); });
  const yb0 = await p.$$eval('#chart svg text', a => a.filter(t => /^-?\d+%$/.test(t.textContent)).map(t => t.textContent));
  await p.fill('#oRMin', '-20');
  const yb1 = await p.$$eval('#chart svg text', a => a.filter(t => /^-?\d+%$/.test(t.textContent)).map(t => t.textContent));
  ok(yb1[0] === '-20%', '右軸の最小値を指定できる: ' + yb1.join(' '));
  ok(await p.$$eval('#chart svg text', a => a.some(t => t.textContent === '\u25bc-300.0%')), '範囲外の最新値は端に ▼ 付きで表示');
  await p.fill('#oRMin', ''); await p.click('#tabs button[data-tab="sample"]'); await p.click('#loadSample');
  const bars = () => p.$$eval('#chart svg g[clip-path] rect', a => a.length);
  const b2 = await bars();
  await p.selectOption('#oBars', 'sales');
  const b1 = await bars();
  ok(b1 * 2 === b2 && await p.$$eval('#chart svg text', a => !a.some(t => t.textContent === '営業利益') && a.some(t => /^売上（/.test(t.textContent))), '売上高だけを表示できる: ' + b2 + '→' + b1);
  await p.selectOption('#oBars', 'op');
  ok(await bars() * 2 === b2 && await p.$$eval('#chart svg text', a => !a.some(t => t.textContent === '売上') && a.some(t => t.textContent === '営業利益')), '営業利益だけを表示できる');
  await p.screenshot({ path: SHOTS + '1b-op-only.png' });
  await p.selectOption('#oBars', 'both');
  ok(await p.evaluate(() => { applyConfig({ [normH('表示する棒')]: '売上高だけ' }); const r = O.bars; O.bars = 'both'; return r === 'sales'; }), '設定シートの「表示する棒」でも指定できる');
  await p.evaluate(() => {
    const rows = [['セグメント', '期', '売上', '営業利益']];
    const segs = { 'ゲーム': [46, 64, 35, 42, 48, 29, 12, -4, 16, 23, 15, 40, 186, 176, 100, 70, 63, 64, 38, 30], 'ライブストリーミング': [8, 16, 13, 14, 16, 12, 5, 3, 1, 2, 1, 0, 3, 2, 10, 12, 10, 5, 10, 8], 'スポーツ': [-20, 10, -5, -25, 10, -2, 2, -20, 25, 18, -30, -2, 2, -2, 40, 50, -40, -38, 45, 55], 'ヘルスケア・メディカル': [-2, -3, -2, -2, -3, -3, -4, -5, -5, -8, -4, -4, -10, -12, -14, -12, -10, -6, -8, -8], '新規・その他': [-3, -2, -3, -4, -3, -3, -3, -3, -3, -4, -3, -3, -4, -4, -4, -4, -5, 5, -5, -5] };
    const qs = []; for (let y = 2021; y <= 2025; y++) for (let q = 1; q <= 4; q++) qs.push(`${y} ${q}Q`);
    Object.entries(segs).forEach(([n, vs]) => vs.forEach((v, i) => rows.push([n, qs[i], v * 5 + 200, v * 100])));
    ingest([{ name: 'd', rows }, { name: 'config', rows: [['項目', '値'], ['企業名', 'テスト'], ['表示単位', '億']] }], 't');
  });
  await p.selectOption('#oLayout', 'stackO');
  const st = await p.$$eval('#chart svg rect title', a => a.map(t => t.textContent));
  ok(st.length > 80 && st.some(t => /-/.test(t.split('：')[1])), 'セグメント積み上げ（利益）：マイナスも下に積む: ' + st.length);
  ok(await p.$$eval('#chart svg text', a => a.some(t => t.textContent === 'ゲーム') && a.some(t => /セグメント別損益/.test(t.textContent))), '凡例とタイトル');
  await p.evaluate(() => { M.segs[0].color = '#ff0000'; render(); });
  ok(await p.$$eval('#chart svg rect[fill="#ff0000"]', a => a.length) >= 19, 'セグメントの色を変えると積み上げにも反映');
  await p.screenshot({ path: SHOTS + '1d-stack.png' });
  await p.selectOption('#oLayout', 'stackS');
  ok(await p.$$eval('#chart svg text', a => a.some(t => /^売上高（/.test(t.textContent))), '売上高の積み上げにも切り替えられる');
  await p.selectOption('#oLayout', 'panels');
  await p.click('#tabs button[data-tab="sample"]'); await p.click('#loadSample');
  await p.click('#granTabs button[data-g="Y"]');
  ok(await p.evaluate(() => M.gran === 'Y'), '年度に切り替わる');
  ok(await p.evaluate(() => { M.segs[0].label = 'とても長いセグメント名（クライアント・コンピューティング／フィジカルAI）'; render(); return ![...document.querySelectorAll('#chart svg text')].some(t => /…/.test(t.textContent)) && [...document.querySelectorAll('#chart svg tspan')].some(t => /フィジカル/.test(t.textContent)); }), '推移のグラフでも見出しを省略せず折り返す');
  await p.screenshot({ path: SHOTS + '1c-longname.png' });
  await p.evaluate(() => { O.ratio = '9:16'; syncSize(); render(); });
  ok(await p.$('#chart svg') !== null, '縦長でも描ける');
  ok((await p.evaluate(() => svgString())).startsWith('<svg'), 'SVG 書き出し');
  await p.screenshot({ path: SHOTS + '1-sample.png' });
  ok(!errs.length, 'エラーなし ' + errs.join(' / '));
  await p.close();
}

console.log('2. Claude 版：シートのURLから読み込み（4シート形式＋会社全体）');
{
  const { p, errs } = await page(browser, SRC, mcpMock);
  await p.click('#tabs button[data-tab="sheet"]');
  await p.fill('#sheetUrl', 'https://docs.google.com/spreadsheets/d/SHEET_ID_0123456789abcdefgh/edit#gid=0');
  await p.click('#reloadSheet');
  await p.waitForTimeout(800);
  const st = await status(p);
  ok(/3セグメント＋会社全体/.test(st), '指定シートだけ読み、会社全体を検出: ' + st.split('\n')[0]);
  ok(await p.evaluate(() => M.segs.map(s => s.color).join() === '#1675f8,#20b779,#ffa126'), '設定シート右側の色を使う（ARR行は無視）');
  ok(await p.evaluate(() => O.marginColor === '#ff8a00' && O.note === '※ 12月決算'), 'setting/value の設定を反映');
  await p.click('#segList .segrow.total input.vis');
  ok(await p.evaluate(() => M.total.visible), '会社全体を表示できる');
  ok(await p.evaluate(() => { const rows = [['period', 'revenue', 'profit_before_tax'], ['FY2025Q1', '100', '10'], ['FY2025Q2', '120', '15']]; ingest([{ name: '会社全体_四半期', rows }], 't'); M.total.visible = true; render(); return M.total.pbt && [...document.querySelectorAll('#chart svg text')].some(t => /会社全体の「営業利益」は税引前当期純利益/.test(t.textContent)); }), '1社表示でも会社全体の税引前利益を読み、注意書きを出す');
  await p.screenshot({ path: SHOTS + '2-claude-sheet.png' });
  ok(!errs.length, 'エラーなし ' + errs.join(' / '));
  await p.close();
}

console.log('3. Claude 版：会社比較');
{
  const { p, errs } = await page(browser, SRC, mcpMock);
  await p.click('#tabs button[data-tab="cmp"]');
  await p.fill('#masterUrl', `https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit`);
  await p.click('#loadMaster');
  await p.waitForTimeout(800);
  ok(/3社/.test(await status(p)), 'マスターの会社一覧を読む');
  ok(await p.$eval('#cmpGroup', e => [...e.options].map(o => o.text).join('|')) === 'カテゴリーでまとめて選ぶ…|AI（2社・発表済み 1/2）|海運（1社・発表済み 0/1）', 'AV〜EE 列のカテゴリーと発表済みの数を読む: ' + await p.$eval('#cmpGroup', e => [...e.options].map(o => o.text).join('|')));
  await p.selectOption('#cmpGroup', '海運');
  ok(/発表済み 0\/1社/.test(await p.$eval('#cmpGroupInfo', e => e.innerText)) && /全社そろう見込み：2999\/12\/31/.test(await p.$eval('#cmpGroupInfo', e => e.innerText)), '決算の進み具合と全社そろう見込みを出す');
  await p.selectOption('#cmpGroup', 'AI');
  ok(/決算日が未登録：ベータ/.test(await p.$eval('#cmpGroupInfo', e => e.innerText)), '決算日がない会社を知らせる');
  await p.selectOption('#cmpGroup', '海運'); await p.screenshot({ path: SHOTS + '3a-group.png', clip: { x: 0, y: 0, width: 310, height: 700 } });
  await p.selectOption('#cmpGroup', '海運'); await p.click('#cmpGroupSet');
  ok(await p.evaluate(() => CMP.sel.length === 1 && CMP.companies.find(c => c.id === CMP.sel[0]).ja === 'ガンマ商事'), '「入れ替え」でカテゴリーの会社だけを選ぶ');
  await p.selectOption('#cmpGroup', 'AI'); await p.click('#cmpGroupAdd');
  ok(await p.evaluate(() => CMP.sel.length === 3) && await p.$$eval('#cmpList input:checked', a => a.length) === 3, '「追加」で今の選択に加える（一覧のチェックにも反映）');
  await p.click('#cmpGo');
  await p.waitForTimeout(1000);
  ok(/3社 を読み込みました/.test(await status(p)), '3社を比較表示');
  ok(await p.evaluate(() => M.segs.filter(s => s.pbt).map(s => s.label).join() === 'ガンマ商事'), 'profit_before_tax しかない会社は税引前利益を「営業利益」として読む');
  const pn = await p.$$eval('#chart svg text', a => a.map(t => t.textContent).filter(t => /税引前当期純利益/.test(t)));
  ok(pn.length === 1 && /ガンマ商事/.test(pn[0]) && !/アルファ|ベータ/.test(pn[0]), '税引前利益の会社だけを注意書きに出す: ' + pn[0]);
  ok(await p.$$eval('#chart svg text', a => a.some(t => t.textContent === '営業利益')), '凡例は「営業利益」のまま');
  ok(await p.evaluate(() => /換算/.test(O.note)), '換算レートを注記に表示');
  const al = await p.evaluate(() => { const lab = M.segs.find(x => /ベータ/.test(x.label)).label; const o = CMP.orig[lab]; return Object.entries(o).find(([k, v]) => /FY2026 1Q/.test(v)); });
  ok(al && al[0] === '20251' && /2025年2-4月/.test(al[1]), '1月決算の FY2026 1Q は暦年 2025 1Q（2-4月）に並ぶ: ' + JSON.stringify(al));
  await p.selectOption('#cmpView', 'donut');
  await p.waitForTimeout(800);
  const dn = await p.$$eval('#chart svg path[stroke="#fff"]', a => a.length);
  ok(dn === 9, '売上構成の円グラフ（3社×3セグメント）: ' + dn);
  ok(await p.$$eval('#chart svg text', a => a.some(t => /セグメント別の売上高構成/.test(t.textContent)) && a.some(t => t.textContent === '売上')), '円グラフのタイトルと中央の売上');
  ok(await p.$eval('#cmpSegPer', e => e.options.length > 2 && /3社/.test(e.options[e.selectedIndex].text)), '3社そろう最新の期を初期選択: ' + await p.$eval('#cmpSegPer', e => e.options[e.selectedIndex].text));
  await p.screenshot({ path: SHOTS + '3b-donut.png' });
  await p.evaluate(() => { const r = CMP.loaded[0].r.seg.oQ; r.names.push('調整額'); r.rows.forEach(x => { x[1]['調整額'] = -150; }); });
  await p.selectOption('#cmpView', 'stack');
  await p.selectOption('#cmpSegMetric', 'o');
  await p.waitForTimeout(500);
  const bars = await p.$$eval('#chart svg rect title', a => a.map(t => t.textContent));
  ok(bars.length === 10 && bars.some(t => /^調整額：-/.test(t)), 'セグメント別利益の積み上げ（マイナスは下に）: ' + bars.length);
  await p.screenshot({ path: SHOTS + '3c-stack.png' });
  await p.selectOption('#cmpSegMetric', 's');
  ok(await p.$$eval('#chart svg text', a => a.some(t => /セグメント別の売上高（/.test(t.textContent))) && await p.$$eval('#chart svg rect title', a => a.length === 9), '売上高も積み上げ棒にできる');
  await p.selectOption('#cmpView', 'donut'); await p.selectOption('#cmpSegMetric', 'o');
  ok(await p.$$eval('#chart svg text', a => a.some(t => /セグメント別の営業利益構成/.test(t.textContent))) && await p.$$eval('#chart svg path[stroke="#fff"]', a => a.length === 9), '利益も円グラフにできる（赤字・調整額は除く）');
  await p.evaluate(() => { CMP.loaded[0].r.segMeta = [{ name: 'Alpha', label: 'クライアント・コンピューティング／フィジカルAI事業（Client Computing / Physical AI）', color: null }]; render(); });
  ok(await p.$$eval('#chart svg text', a => !a.some(t => /…/.test(t.textContent)) && a.some(t => /フィジカル/.test(t.textContent))), '長いセグメント名も省略せずに折り返す');
  await p.screenshot({ path: SHOTS + '3d-donut-profit.png' });
  await p.selectOption('#cmpView', 'stack');
  ok(await p.$$eval('#chart svg text', a => !a.some(t => /…/.test(t.textContent))), '積み上げ棒でも省略しない');
  await p.screenshot({ path: SHOTS + '3e-stack-wrap.png' });
  await p.selectOption('#cmpSegMetric', 's'); await p.selectOption('#cmpView', 'donut');
  await p.selectOption('#cmpSegGran', 'Y');
  ok(await p.$eval('#cmpSegPer', e => e.options.length >= 1), '年度に切り替えられる');
  await p.selectOption('#cmpSegGran', 'Q');
  await p.selectOption('#cmpView', 'trend');
  ok(await p.$$eval('#chart svg text', a => a.some(t => /全社業績の比較/.test(t.textContent))), '業績の推移に戻せる');
  await p.selectOption('#cmpAlign', 'latest');
  ok(await p.evaluate(() => /最新期を右端/.test(O.note)), '「最新期を右端にそろえる」に切り替えられる');
  await p.screenshot({ path: SHOTS + '3-compare.png' });
  ok(!errs.length, 'エラーなし ' + errs.join(' / '));
  await p.close();
}

console.log('3b. Claude 版：「シート」タブで企業マスターから1社を選ぶ');
{
  const { p, errs } = await page(browser, SRC, mcpMock);
  await p.click('#tabs button[data-tab="cmp"]');
  await p.fill('#masterUrl', `https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit`);
  await p.click('#tabs button[data-tab="sheet"]');
  await p.click('#sheetPickOpen');
  await p.waitForTimeout(800);
  ok(await p.$$eval('#sheetList input', a => a.length) === 3, 'シートタブにマスターの会社一覧を出す');
  await p.selectOption('#sheetCat', 'g:海運');
  ok(await p.$$eval('#sheetList input', a => a.length) === 1, 'カテゴリーで絞り込める');
  await p.selectOption('#sheetCat', '');
  const boxes = await p.$$('#sheetList input');
  await boxes[0].click(); await p.waitForTimeout(800);
  ok(/3セグメント/.test(await status(p)) && /COMPANY_A/.test(await p.$eval('#sheetUrl', e => e.value)), 'チェックした会社の Financials を読み込む: ' + (await status(p)).split('\n')[0]);
  await (await p.$$('#sheetList input'))[2].click(); await p.waitForTimeout(800);
  ok(await p.$$eval('#sheetList input:checked', a => a.length) === 1 && /COMPANY_B/.test(await p.$eval('#sheetUrl', e => e.value)), '1社だけ選べる（別の会社に切り替わる）');
  await p.screenshot({ path: SHOTS + '2b-sheet-pick.png' });
  ok(!errs.length, 'エラーなし ' + errs.join(' / '));
  await p.close();
}

console.log('4. Apps Script 版');
{
  const { p, errs } = await page(browser, GAS, gasMock);
  await p.waitForTimeout(500);
  ok(/3セグメント/.test(await status(p)), '紐づいたシートを自動で読む');
  await p.click('#tabs button[data-tab="cmp"]');
  await p.fill('#masterUrl', `https://docs.google.com/spreadsheets/d/${MASTER_ID}/edit`);
  await p.click('#loadMaster');
  await p.waitForTimeout(600);
  ok(/3社/.test(await status(p)), '会社比較のマスター読み込み');
  ok(!errs.length, 'エラーなし ' + errs.join(' / '));
  await p.close();
}

console.log('5. GitHub Pages 版');
{
  const { p, errs } = await page(browser, WEB);
  ok(await p.evaluate(() => document.body.classList.contains('web')), 'web モードで起動');
  await p.fill('#sheetUrl', 'https://docs.google.com/spreadsheets/d/SHEET_ID_0123456789abcdefgh/edit');
  await p.route('https://docs.google.com/**', r => r.fulfill({ status: 404, body: 'no', headers: { 'access-control-allow-origin': '*' } }));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ body: 'window.XLSX={read(){},utils:{}}', contentType: 'application/javascript' }));
  await p.click('#reloadSheet');
  await p.waitForTimeout(600);
  ok(/ウェブに公開/.test(await status(p)), '編集用URLには「ウェブに公開」の案内を出す');
  ok(!errs.length, 'エラーなし ' + errs.join(' / '));
  await p.close();
}

await browser.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
