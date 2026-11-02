// src/index.html から各版を生成する（依存パッケージなし）
//   index.html      … GitHub Pages 版（「ウェブに公開」したシートを読む）
//   gas/index.html  … Apps Script 版（Code.gs と一緒に Apps Script に置く）
// Claude 上のアーティファクト版は src/index.html をそのまま公開する。
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

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

writeFileSync(new URL('../index.html', import.meta.url), web);
writeFileSync(new URL('../gas/index.html', import.meta.url), src);
console.log('OK: index.html（GitHub Pages 版）と gas/index.html（Apps Script 版）を生成しました');
