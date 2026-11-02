# セグメント業績チャート

Google スプレッドシートの業績データ（セグメント別の売上高・利益、会社全体）を、軸をそろえたグラフで並べて比較する Web アプリです。

- GitHub Pages 版：https://shiroin.github.io/segment-chart/
- 入力用テンプレート：[`template/segment_chart_template.xlsx`](template/segment_chart_template.xlsx)
- 開発者向けの説明：[`CLAUDE.md`](CLAUDE.md)

## できること

- セグメントごとの売上高・営業利益・営業利益率を、四半期／年度で切り替えて表示
- 会社全体のグラフを左端に追加（オプション）
- 企業マスターから会社を選んで、全社業績を並べて比較（Claude 版・Apps Script 版）
- 通貨（円・ドル・ユーロ・元・ウォン・台湾ドル・香港ドル・クローネなど）と表示単位（百万・億・十億・兆）、為替換算
- 色・並び順・表示期間・縦横比の変更、PNG / SVG 書き出し

## GitHub Pages 版の使い方

1. スプレッドシートで **ファイル → 共有 → ウェブに公開** を開き、「ドキュメント全体」「Microsoft Excel (.xlsx)」で公開
2. 発行された URL（`https://docs.google.com/spreadsheets/d/e/…`）をアプリの「シート」欄に貼って「読み込む」
3. ページの URL が `?sheet=…` 付きになるので、会社ごとにブックマーク

> 「ウェブに公開」すると、その URL を知っている人はシートの数字を見られます。公開情報（IR データ）向けです。

## シート構成

| シート | 内容 |
| --- | --- |
| config（または 設定） | 企業名・タイトル・通貨・単位・注記など |
| segments | セグメントの表示名・サブタイトル・色・表示 |
| セグメント売上高_四半期 / _年度 | A 列 `period`、B 列以降がセグメント |
| セグメント利益_四半期 / _年度 | 同上 |
| 会社全体_四半期 / _年度 | `period, revenue, operating_profit`（任意） |

## 開発

```
npm i
npx playwright install chromium
npm test        # src/index.html から各版を生成して、ブラウザで動作確認
```

編集するのは `src/index.html` と `gas/Code.gs` だけです。`index.html` と `gas/index.html` は `npm run build` で生成されます。
