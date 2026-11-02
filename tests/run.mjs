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
const companyBook = (cur, scale) => [
  { name: '設定', rows: [['会社マスター設定'], ['…'], [], ['setting', 'value', '説明', '', '種類', '項目名', '表示名', 'カラー'],
    ['company_name', 'テスト社', '', '', 'セグメント', 'Alpha', 'Alpha', '#1675F8'],
    ['note', '※ 12月決算', '', '', 'セグメント', 'Beta', 'Beta', '#20B779'],
    ['input_currency', cur, '', '', 'セグメント', 'Gamma', 'Gamma', '#FFA126'],
    ['display_unit', '億（現地通貨）', '', '', 'ARR', 'X', 'X', '#000000'],
    ['margin_color', '#FF8A00'], ['revenue_color', '#1675F8'], ['operating_profit_color', '#08A89C']] },
  matrix('会社全体_四半期', ['period', 'revenue', 'operating_profit'], qRows(100 * scale).map(r => [r[0], String(+r[1] * 6), String(+r[1] * 2)])),
  matrix('会社全体_年度', ['period', 'revenue', 'operating_profit'], [['FY2024', String(2000 * scale), String(500 * scale)], ['FY2025', String(2600 * scale), String(700 * scale)]]),
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
  ['2', 'BBB', 'Beta Inc', 'ベータ', ...Array(23).fill(''), 'https://docs.google.com/spreadsheets/d/COMPANY_B_0123456789abcdef/edit', ...Array(16).fill(''), '1月', '', 'ドル']];
master[1][7] = '業種カテゴリー1'; master[2][7] = 'AI'; master[3][7] = 'AI';
const BOOKS = { [MASTER_ID]: [{ name: 'global_company_watch_300', rows: master }], COMPANY_A_0123456789abcdef: companyBook('JPY', 10), COMPANY_B_0123456789abcdef: companyBook('USD', 1), SHEET_ID_0123456789abcdefgh: companyBook('JPY', 10) };
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
  await p.click('#granTabs button[data-g="Y"]');
  ok(await p.evaluate(() => M.gran === 'Y'), '年度に切り替わる');
  await p.evaluate(() => { O.ratio = '9:16'; syncSize(); render(); });
  ok(await p.$('#chart svg') !== null, '縦長でも描ける');
  ok((await p.evaluate(() => svgString())).startsWith('<' + '?xml'), 'SVG 書き出し');
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
  ok(/2社/.test(await status(p)), 'マスターの会社一覧を読む');
  for (const el of await p.$$('#cmpList input[type=checkbox]')) await el.click();
  await p.click('#cmpGo');
  await p.waitForTimeout(1000);
  ok(/2社 を読み込みました/.test(await status(p)), '2社を比較表示');
  ok(await p.evaluate(() => /換算/.test(O.note)), '換算レートを注記に表示');
  await p.screenshot({ path: SHOTS + '3-compare.png' });
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
  ok(/2社/.test(await status(p)), '会社比較のマスター読み込み');
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
