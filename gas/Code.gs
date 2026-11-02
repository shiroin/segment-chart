/**
 * セグメント業績チャート — Google Apps Script（ウェブアプリ）
 *
 * ■ ウェブアプリとして公開する手順
 *  1. https://script.google.com/ で「新しいプロジェクト」を作成
 *  2. このファイルの内容を Code.gs に貼り付け
 *  3. 「＋ → HTML」で index という名前のファイルを作り、index.html の内容を貼り付け
 *  4. 「デプロイ → 新しいデプロイ → 種類：ウェブアプリ」
 *       実行ユーザー：「ウェブアプリにアクセスしているユーザー」（各自が自分の権限でシートを読む）
 *       アクセスできるユーザー：「Google アカウントを持つ全員」または組織内
 *  5. 発行された URL（…/exec）を開き、スプレッドシートの URL を入れて「読み込む」
 *     → ページの URL が …/exec?id=スプレッドシートID になるので、ブックマーク・共有できます
 *
 * ■ スプレッドシートに組み込んで使う場合
 *  スプレッドシートの「拡張機能 → Apps Script」に同じ2ファイルを置くと、
 *  メニュー「📊 セグメント比較 → グラフを開く」で、そのシートをすぐ表示できます。
 *
 * ■ シート構成（シート名は自由。列見出しで自動判別）
 *  セグメント売上高_四半期 / セグメント売上高_年度 / セグメント利益_四半期 / セグメント利益_年度
 *           : A列 period、B列以降がセグメント（1行＝1期）。シート名で 売上/利益・四半期/年度 を判別
 *           （旧形式 data：セグメント | 期 | 売上 | 営業利益 の縦長1シートも可）
 *  segments : セグメント | サブタイトル | 色 | 表示 | 表示名 | 売上色 | 利益色        （任意）
 *  config   : 項目 | 値（タイトル / 単位 / 利益率線の色 / 凡例 / 表示四半期数 / 左軸最大 / 右軸最大 / 高さ / パレット）
 *  ・segments の「色」はカラーコードか色名。空欄ならセルの塗りつぶし色を使います。
 */

const APP_TITLE = 'セグメント業績チャート';

/** ウェブアプリの入口（…/exec?id=スプレッドシートID でそのシートを直接開く） */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** スプレッドシートに組み込んだ場合のメニュー */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 セグメント比較')
    .addItem('グラフを開く', 'showChart')
    .addItem('グラフを開く（大きいウィンドウ）', 'showChartLarge')
    .addSeparator()
    .addItem('設定シート（config / segments）を作成', 'setupSheets')
    .addToUi();
}
function showChart() { openDialog_(1280, 820); }
function showChartLarge() { openDialog_(1800, 1000); }
function openDialog_(w, h) {
  const html = HtmlService.createHtmlOutputFromFile('index').setWidth(w).setHeight(h);
  SpreadsheetApp.getUi().showModelessDialog(html, 'セグメント別業績');
}

function openSpreadsheet_(id) {
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e) { throw new Error('スプレッドシートを開けませんでした。URLと閲覧権限を確認してください。'); }
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートのURLを入力して「読み込む」を押してください。');
  return ss;
}

/** グラフに使うシートの表示値と背景色を返す（クライアント側で列見出しから自動判別）
 *  ・企業マスター（Financials 列がある表）なら isMaster を返し、中身は読まない
 *  ・大きなシートや関係なさそうなシートは読まない（時間切れを防ぐ） */
function getSheetTables(id) {
  const ss = openSpreadsheet_(id);
  const KNOWN = /設定|config|segments|会社全体|セグメント|売上|利益|data|業績/i;
  const sheets = ss.getSheets().filter(sh => !sh.isSheetHidden() && sh.getLastRow() > 0 && sh.getLastColumn() > 0);
  let isMaster = false;
  sheets.forEach(sh => {
    const head = sh.getRange(1, 1, Math.min(10, sh.getLastRow()), Math.min(sh.getLastColumn(), 60)).getDisplayValues();
    if (head.some(r => r.some(c => String(c).trim() === 'Financials'))) isMaster = true;
  });
  const known = sheets.filter(sh => KNOWN.test(sh.getName()));
  const use = (known.length ? known : sheets).filter(sh => sh.getLastRow() <= 5000 && sh.getLastColumn() <= 200).slice(0, 20);
  const tables = isMaster && !known.length ? [] : use.map(sh => {
    const range = sh.getDataRange();
    const small = sh.getLastRow() <= 300;
    return { name: sh.getName(), rows: range.getDisplayValues(), bgs: small ? range.getBackgrounds() : undefined };
  });
  return { id: ss.getId(), name: ss.getName(), url: ss.getUrl(), tables: tables, isMaster: isMaster };
}

/** 画面で調整した色・表示・並び順を segments シートに書き戻す */
function saveSegments(sheetName, items, id) {
  const ss = openSpreadsheet_(id);
  const name = sheetName || 'segments';
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 4).setValues([['セグメント', 'サブタイトル', '色', '表示']]).setFontWeight('bold');
  }
  const norm = s => String(s).replace(/[\s（）()]/g, '').toLowerCase();
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const find = keys => header.findIndex(h => keys.indexOf(norm(h)) >= 0);
  const segC = find(['セグメント', 'セグメント名', 'segment', '部門', '事業', '事業領域', '領域']);
  if (segC < 0) throw new Error('segments シートに「セグメント」列が見つかりません');
  let colC = find(['色', 'カラー', 'ベース色', 'color', 'colour']);
  if (colC < 0) { colC = sh.getLastColumn(); sh.getRange(1, colC + 1).setValue('色').setFontWeight('bold'); }
  let visC = find(['表示', 'visible', 'show']);
  if (visC < 0) { visC = sh.getLastColumn(); sh.getRange(1, visC + 1).setValue('表示').setFontWeight('bold'); }

  const width = sh.getLastColumn();
  const n = Math.max(sh.getLastRow() - 1, 0);
  const rows = n ? sh.getRange(2, 1, n, width).getValues() : [];
  const byName = {};
  rows.forEach(r => { const k = String(r[segC]).trim(); if (k) byName[k] = r; });
  const out = items.map(it => {
    const r = byName[it.name] ? byName[it.name].slice() : new Array(width).fill('');
    r[segC] = it.name; r[colC] = it.color; r[visC] = it.visible ? 'TRUE' : 'FALSE';
    delete byName[it.name];
    return r;
  });
  Object.keys(byName).forEach(k => out.push(byName[k]));
  if (n) sh.getRange(2, 1, n, width).clearContent().setBackground(null).setFontColor(null);
  if (out.length) {
    sh.getRange(2, 1, out.length, width).setValues(out);
    out.forEach((r, i) => {
      const c = String(r[colC]);
      if (/^#[0-9a-f]{6}$/i.test(c)) {
        const v = parseInt(c.slice(1), 16), L = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
        sh.getRange(i + 2, colC + 1).setBackground(c).setFontColor(L > 0.6 ? '#111111' : '#ffffff');
      }
    });
  }
  return true;
}

/* ---------- 設定シートのひな形を作る（既にあるシートは変更しません） ---------- */
const CONFIG_ROWS_ = [
  ['企業名', '', 'タイトルの {企業名} に入ります', null],
  ['タイトル', '', '空欄なら「企業名　セグメント別業績推移（四半期）」。{企業名} {区分} {単位} {通貨} が使えます', null],
  ['通貨', '円', 'シートの数値の通貨。円 / USD / EUR / TWD / HKD / KRW / DKK など', ['円','USD','EUR','CNY','TWD','HKD','KRW','DKK','SEK','NOK','CHF','GBP','SGD','AUD','CAD','INR']],
  ['データの単位', '百万', 'シートに入力した数値の単位', ['千','百万','億','そのまま']],
  ['表示単位', '自動', 'グラフに表示する単位', ['自動','百万','億','十億','兆']],
  ['表示通貨', '', '別の通貨に換算して表示したいときだけ', ['円','USD','EUR','CNY','TWD','HKD','KRW','DKK','GBP']],
  ['換算レート', '', '「1データ通貨＝○表示通貨」（例：USD→円なら 150）', null],
  ['注記', '', 'グラフ左下に小さく表示（出所など）', null],
  ['凡例', '上', '上 / 下 / なし', ['上','下','なし']],
  ['利益率線の色', '#c0151f', 'カラーコードか色名', null],
  ['パレット', '', 'segments に色がないときの配色', ['クラシック','モダン','くすみ','ネイビー']],
  ['表示区分', '四半期', '最初に表示する区分', ['四半期','年度']],
  ['表示四半期数', '', '四半期表示で最新から何四半期を表示するか（空欄で最大30）', null],
  ['表示年数', '', '年度表示で何年分を表示するか（空欄で全部）', null],
  ['抜けた期を空ける', 'する', 'データの無い期も枠を空けて時間軸をそろえる', ['する','しない']],
  ['縦横比', '画面に合わせる', '16:9 / 4:3 / 1:1 / 9:16 など', ['画面に合わせる','16:9','4:3','3:2','21:9','1:1','4:5','9:16']],
  ['幅', '', 'px で指定したいとき', null],
  ['高さ', '', 'px', null],
  ['左軸最大', '', '空欄で自動', null],
  ['右軸最大', '', '空欄で自動（例：50%）', null],
];
const PALETTE_ = ['#3f9b4b','#e47a2e','#4a8ad4','#d4a72c','#8e5cc4','#2a9d8f','#d9536f','#6b7a8f'];

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const made = [];
  const norm = s => String(s).replace(/[\s（）()]/g, '').toLowerCase();
  const findSheet = test => ss.getSheets().find(sh => {
    if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) return false;
    return test(sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(norm));
  });
  const head = (sh, n) => sh.getRange(1, 1, 1, n).setFontWeight('bold').setFontColor('#ffffff').setBackground('#111827');

  if (!findSheet(h => h.includes('項目') && h.includes('値'))) {
    const sh = ss.insertSheet('config');
    sh.getRange(1, 1, 1, 3).setValues([['項目', '値', '説明']]); head(sh, 3);
    sh.getRange(2, 1, CONFIG_ROWS_.length, 3).setValues(CONFIG_ROWS_.map(r => [r[0], r[0] === '企業名' ? ss.getName() : r[1], r[2]]));
    CONFIG_ROWS_.forEach((r, i) => {
      if (r[3]) sh.getRange(i + 2, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(r[3], true).setAllowInvalid(true).build());
    });
    sh.getRange(2, 1, CONFIG_ROWS_.length, 1).setFontWeight('bold');
    sh.getRange(2, 3, CONFIG_ROWS_.length, 1).setFontColor('#6b7280');
    sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 520); sh.setFrozenRows(1);
    made.push('config');
  }

  const isSeg = h => ['セグメント','セグメント名','segment','部門','事業','事業領域','領域'].some(k => h.includes(k));
  if (!findSheet(h => isSeg(h) && (h.includes('色') || h.includes('color')))) {
    // データのシートからセグメント名を拾う（縦長形式：セグメント列 / 期×セグメント形式：見出し行の列名）
    let names = [];
    const PERIOD = ['period','期','四半期','年度','会計年度','決算期','quarter','fiscalyear','fy','year'];
    const SEG = ['セグメント','セグメント名','segment','部門','事業','事業領域','領域'];
    ss.getSheets().forEach(sh => {
      if (sh.getLastRow() < 2 || sh.getLastColumn() < 2) return;
      const vals = sh.getRange(1, 1, Math.min(sh.getLastRow(), 400), sh.getLastColumn()).getDisplayValues();
      const hi = vals.slice(0, 10).findIndex(r => r.map(norm).some(c => PERIOD.indexOf(c) >= 0));
      if (hi < 0) return;
      const h = vals[hi].map(norm);
      const segC = h.findIndex(c => SEG.indexOf(c) >= 0);
      const add = n => { n = String(n).trim(); if (n && names.indexOf(n) < 0) names.push(n); };
      if (segC >= 0) vals.slice(hi + 1).forEach(r => add(r[segC]));
      else vals[hi].forEach((c, j) => { if (PERIOD.indexOf(norm(c)) < 0) add(c); });
    });
    const sh = ss.insertSheet('segments');
    sh.getRange(1, 1, 1, 5).setValues([['セグメント', '表示名', 'サブタイトル', '色', '表示']]); head(sh, 5);
    if (names.length) {
      sh.getRange(2, 1, names.length, 5).setValues(names.map((n, i) => [n, '', '', PALETTE_[i % PALETTE_.length], true]));
      names.forEach((n, i) => sh.getRange(i + 2, 4).setBackground(PALETTE_[i % PALETTE_.length]).setFontColor('#ffffff'));
    }
    sh.getRange('E2:E100').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 160); sh.setColumnWidth(3, 180); sh.setFrozenRows(1);
    made.push('segments');
  }
  ui.alert(made.length ? `${made.join(' と ')} シートを作成しました。値を書き換えて「グラフを開く」で確認できます。` : 'config / segments シートは既にあります。');
}

/* ---------- 会社比較：企業マスターと各社 Financials を読む ---------- */
function getSheetTitles(id) {
  return openSpreadsheet_(id).getSheets().map(sh => sh.getName());
}
/** ranges（A1表記の配列）ごとに表示値を返す。存在しないシートは null */
function getRanges(id, ranges) {
  const ss = openSpreadsheet_(id), out = {};
  (ranges || []).forEach(a1 => {
    // シート名だけ取り出して、そのシートの入力済み範囲を返す（範囲指定がシートより大きいとエラーになるため）
    const m = String(a1).match(/^'((?:[^']|'')*)'(?:!.*)?$/) || String(a1).match(/^([^!]*)(?:!.*)?$/);
    const sh = m ? ss.getSheetByName(m[1].replace(/''/g, "'")) : null;
    out[a1] = sh && sh.getLastRow() > 0 ? sh.getDataRange().getDisplayValues() : null;
  });
  return out;
}
