// src/index.html から各版を生成する（依存パッケージなし）
//   index.html      … GitHub Pages 版（「ウェブに公開」したシートを読む）
//   gas/index.html  … Apps Script 版（Code.gs と一緒に Apps Script に置く）
// Claude 上のアーティファクト版は src/index.html をそのまま公開する。
import { readFileSync, writeFileSync } from 'node:fs';

const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');  // 日本時間
const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8').replace('__BUILD__', stamp);

// Apps Script（HtmlService）で壊れる書き方を検出する
const problems = [];
src.split('\n').forEach((line, i) => {
  if (line.includes('<?') || line.includes('?>')) problems.push(`${i + 1}行目: 「<?」「?>」は Apps Script がスクリプトレットとして扱うので使わない`);
  for (const ch of line) if (ch.codePointAt(0) > 0xffff) { problems.push(`${i + 1}行目: 絵文字など U+FFFF を超える文字（${ch}）は Apps Script で壊れるので使わない`); break; }
});
if (problems.length) { console.error('ビルド中止:\n' + problems.join('\n')); process.exit(1); }

const marker = "<script>\n'use strict';";
if (!src.includes(marker)) { console.error('ビルド中止: メインの <script> の先頭が見つかりません'); process.exit(1); }
const web = src.replace(marker, "<script>window.SEGCHART_MODE = 'web';</script>\n" + marker);

// Apps Script 版：メインのプログラムを Base64 にして埋め込み、画面側で元に戻して実行する。
// HtmlService はページを書き出すときにプログラム内の記号を誤って解釈することがあるため（実際に SyntaxError が出た）、
// 英数字と + / = だけの形にして、中身に一切触らせない。
const start = src.indexOf(marker) + '<script>\n'.length;
const end = src.indexOf('</script>', start);
const code = src.slice(start, end);
const b64 = Buffer.from(code, 'utf8').toString('base64').replace(/.{1,100}/g, '$&\n');
const loader = `
(function () {
  var b64 = document.getElementById('app-code').textContent.replace(/\\s+/g, '');
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { (0, eval)(new TextDecoder('utf-8').decode(bytes) + '\\n//# sourceURL=segment-chart.js'); }
  catch (e) { window.__showErr && window.__showErr((e && e.stack) || e); }
})();
`;
const gas = src.slice(0, start - '<script>\n'.length)
  + `<script type="text/plain" id="app-code">\n${b64}</script>\n<script>${loader}`
  + src.slice(end);

writeFileSync(new URL('../index.html', import.meta.url), web);
writeFileSync(new URL('../gas/index.html', import.meta.url), gas);
console.log('OK: index.html（GitHub Pages 版）と gas/index.html（Apps Script 版）を生成しました');
