# セグメント業績チャート — 開発メモ（Claude Code 向け）

Google スプレッドシートの業績データ（セグメント別／会社全体）を、軸をそろえた小さなグラフの並びで表示する 1 ファイルの Web アプリ。
利用者は日本語話者。UI 文言・コメント・コミットメッセージは日本語で書く。

## ファイル構成

| パス | 役割 |
| --- | --- |
| `src/index.html` | **唯一のソース**。HTML・CSS・JS をすべてこの 1 ファイルに持つ |
| `index.html` | GitHub Pages 版（生成物。`npm run build` で作る。直接編集しない） |
| `gas/index.html` | Apps Script 版の画面（生成物。直接編集しない） |
| `gas/Code.gs` | Apps Script のサーバー側（手で編集する） |
| `scripts/build.mjs` | `src/index.html` から上の 2 つを生成。Apps Script で壊れる書き方も検査する |
| `tests/run.mjs` | Playwright で 5 つの場面を確認（外部通信はすべてモック） |
| `template/segment_chart_template.xlsx` | 入力用テンプレート（config / segments / 売上高・利益 × 四半期・年度） |

## 3 つの版（同じソースで、データの取り方だけが違う）

| 版 | 判定 | シートの読み方 | 会社比較 |
| --- | --- | --- | --- |
| Claude 上のアーティファクト | 既定 | `window.claude.use('mcp')` で利用者の **Google Sheets コネクタ**（`get_spreadsheet` / `get_values`）を呼ぶ | 可 |
| Apps Script（ウェブアプリ） | `google.script.run` がある（`IS_GAS`） | `Code.gs` の `getSheetTables` / `getSheetTitles` / `getRanges` | 可 |
| GitHub Pages | `window.SEGCHART_MODE === 'web'`（`IS_WEB`、ビルド時に注入） | 「ウェブに公開」した `…/pub?output=xlsx` を fetch → SheetJS | 不可（各社シートを公開しないと読めない） |

- アーティファクトは CSP で外部 fetch 不可。読み込めるのは cdnjs など許可された CDN と Google Fonts のみ。ダウンロードは `claude.use('downloads')`。
- `localStorage` は環境によって例外になるので必ず try/catch（`store` を使う）。

## 編集ルール

1. 変更は `src/index.html`（と必要なら `gas/Code.gs`）だけにする。その後 `npm run build`。
2. **Apps Script で壊れる書き方は禁止**（build が検出して止まる）
   - `<?` と `?>`：HtmlService がスクリプトレットとして解釈し、JS の文法が壊れる（実際に起きた。`'<' + '?xml'` のように分けて書く）
   - 絵文字など U+FFFF を超える文字：HtmlService の document.write で壊れる
3. 1 ファイル構成を保つ。新しいライブラリは CDN（cdnjs 推奨）から。npm パッケージを実行時に使わない。
4. 変更後は `npm test` を通す。見た目の変更は `tests/shots/` のスクリーンショットで確認する。
5. 画面上部の `window.addEventListener('error', …)` は、利用者が赤字のエラーを送れるようにするためのもの。消さない。

## データ形式（中身で自動判別。シート名は自由）

- **期 × セグメント形式**（推奨）：A 列 `period`、B 列以降がセグメント。シート名か 1 行目のタイトルに「売上／利益」「四半期／年度」を含める。
  - `セグメント売上高_四半期` / `セグメント売上高_年度` / `セグメント利益_四半期` / `セグメント利益_年度` という名前のシートがあれば **それ（と `会社全体_*`）だけを読む**（`STRICT_SEG`）。受注・ARR などは無視。
  - 売上と利益は「同じ period・同じセグメント名」で結合。
- **会社全体**：`会社全体_四半期` / `会社全体_年度`（`period, revenue, operating_profit`）。左端のパネルとしてオプション表示（初期はオフ）。
- **縦長形式**（旧）：`セグメント | 期 | 売上 | 営業利益`。
- **設定**：`config`（項目 / 値）または各社の `設定` シート（`setting, value` の英語キー）。左右に並んだ表は `splitTable` で分割。右側の `種類 | 項目名 | 表示名 | カラー` は `種類=セグメント` の行だけ使う。
- 期の表記：`FY2025Q1`・`2025 1Q`・`2025年3月期 1Q`（四半期）、`FY2025`・`2025年度`（年度）。数値は `1,234` `△30` `(30)` に対応。
- 金額は既定で **百万** 単位入力。表示単位（百万・億・十億・兆・自動）と通貨は設定で変更。

主な設定キー（日本語・英語どちらも可）：企業名 `company_name`、タイトル（`{企業名}` `{区分}` `{単位}` `{通貨}` を置換）、`company_subtitle`、通貨 `input_currency`、データの単位、表示単位 `display_unit`、表示通貨・換算レート、注記 `note`、凡例、利益率線の色 `margin_color`、`revenue_color` / `operating_profit_color`（会社全体の色）、会社全体を表示、表示区分、表示四半期数、表示年数、抜けた期を空ける、目盛り（共通／グラフごと）、縦横比、幅・高さ、左軸最大、右軸最大、パレット。

## 会社比較モード

企業マスター（既定は `DEFAULT_MASTER`。`Financials` 列＝AB 列に各社シートの URL）から会社を選び、各社の `設定` と `会社全体_四半期/年度` を読み、1 社 1 パネルで並べる。
通貨は各社の `input_currency`（なければマスターの「通貨」列）。比較通貨に換算（`FX_JPY` が初期値＝2026 年 8 月末ごろの目安、画面で変更可）。
会社の規模差が 8 倍超なら初回だけ目盛りを「グラフごと」に自動切り替え。FY は各社の会計年度表記のまま並べる（決算月の違いは注記で明示）。

## コードの地図（`src/index.html` 内）

- 読み取り：`parsePeriod` / `parseYear` / `num` / `parseDelimited` / `classify` / `matrixKind` / `splitTable` / `buildModel`
- 状態：`O`（表示設定）、`M`（読み込んだモデル。`views.Q` / `views.Y`、`segs`、`total`）、`ingest` → `applyConfig` → `setGran`（期の絞り込みと `fillGaps`）
- 描画：`axes`（左右の目盛りをそろえる）、`render`（SVG を文字列で組み立てる。サイズに応じて viewBox で拡大縮小）
- 取得：`loadFromSheet`（版ごとに分岐）、`loadViaMcp`、`loadViaPublished`、会社比較は `loadMaster` / `fetchCompany` / `buildCompare`

## テスト

```
npm i
npx playwright install chromium
npm test
```

## デプロイ

- **GitHub Pages**：`main` に push すると https://shiroin.github.io/segment-chart/ に反映（Settings → Pages → main / root）。
- **Apps Script**：`gas/Code.gs` の `doGet` が、開かれるたびに GitHub の `gas/index.html`（raw.githubusercontent.com）を取得して表示する（10 分キャッシュ。`…/exec?refresh=1` で即時更新）。
  - つまり **画面の変更は `npm run build` → `main` に push するだけで Apps Script 版にも反映**される。デプロイ不要。
  - `gas/Code.gs`（サーバー側）を変えたときだけは、利用者に Apps Script への貼り替えと「デプロイを管理 → 新バージョン」を頼む必要がある。サーバー側の変更はなるべく避ける。
  - GitHub に届かないときは、Apps Script 内の `index` ファイルを使う（古い版になる）。
- **Claude 上のアーティファクト**：claude.ai の会話で `src/index.html` を同じアーティファクトに再公開してもらう（Claude Code からは公開できない）。
