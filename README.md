# 東日本大震災ツイートマッピング

東日本大震災発生後24時間以内につぶやかれたジオタグ付きツイートを可視化するデジタルアーカイブです。

- 公開URL（地図版）: [https://tweet.mapping.jp/](https://tweet.mapping.jp/)
- 公開URL（AR版）: [https://tweet.mapping.jp/ar.html](https://tweet.mapping.jp/ar.html)
- 全ジオタグ付きツイートから @付き・BOT投稿などを除外した 5,765 件を利用
- 元コンテンツは 2012 年「[東日本大震災ビッグデータワークショップ](https://sites.google.com/site/prj311/)」成果物
- 運営: [東京大学大学院 渡邉英徳研究室](https://labo.wtnv.jp/)

## 開発者向け概要

このリポジトリはビルド工程をほぼ持たない静的サイトです。  
主な実装は次の 2 画面です。

- `index.html`: Cesium ベースの地図可視化（PC/モバイル）
- `ar.html`: A-Frame + AR.js ベースの AR 可視化（主にスマートフォン）

ツイートデータは `data/czml/tweets.json` を元に、表示性能のためタイル分割した  
`data/czml/tweet-tiles/*.json` を優先利用します。

## 必要環境

- Web サーバーで静的配信できる環境（ローカル検証時も `file://` 直開きは非推奨）
- Node.js（`tools/build-tweet-tiles.js` 実行時のみ）

## ローカル起動

任意の静的サーバーでこのディレクトリを配信してください。例:

```bash
cd /path/to/tweetMapping
python3 -m http.server 8080
```

アクセス先:

- 地図版: `http://localhost:8080/index.html`
- AR版: `http://localhost:8080/ar.html`

## ディレクトリ構成と役割

```text
tweetMapping/
├── index.html                 # 地図版エントリーポイント
├── ar.html                    # AR版エントリーポイント
├── js/
│   ├── main.js                # 地図版アプリ本体（Cesium描画・検索・位置追跡）
│   ├── ar.js                  # AR版アプリ本体（カメラ/位置情報/マーカー描画）
│   ├── app-config.js          # 地図版のAPIキー・トークン・初期視点設定
│   ├── ar-config.js           # AR版の設定（データURL・表示/デバッグ設定）
│   ├── analytics.js           # Google Analytics（UA）初期化
│   └── jquery-2.1.3.min.js    # 依存ライブラリ
├── css/
│   ├── style.css              # 地図版スタイル
│   ├── ar.css                 # AR版スタイル
│   ├── menubutton.css         # 共通ボタン系スタイル
│   └── cesium-widgets.css     # Cesium UI向け補助スタイル
├── data/
│   ├── czml/
│   │   ├── tweets.json        # 元データ（全ツイート）
│   │   └── tweet-tiles/       # 高速表示用のタイル分割データ
│   │       ├── index.json     # タイル索引（tile -> ファイル）
│   │       ├── search.json    # テキスト検索用索引
│   │       └── tiles/*.json   # タイルごとの簡略ツイートデータ
│   ├── icon/                  # アイコン画像
│   ├── og/                    # OGP画像
│   ├── logo.png               # タイトルロゴ
│   └── loading.gif            # ローディング画像
├── tools/
│   └── build-tweet-tiles.js   # tweets.json から tile/search/index を再生成
├── font/                      # アイコンフォント
├── .htaccess                  # Apache向け gzip / cache ヘッダー設定
└── CNAME                      # GitHub Pages用カスタムドメイン設定
```

## 主要ファイル詳細

### `js/main.js`（地図版）

- `data/czml/tweet-tiles/index.json` を読み、現在視野に必要なタイルのみ遅延ロード
- `data/czml/tweet-tiles/search.json` を使って全文検索を実行
- タイル索引が読めない場合は `data/czml/tweets.json` にフォールバック
- 端末判定によりスマホでは軽量寄り挙動（ベースレイヤー、表示文字数など）へ切り替え
- ARページから戻る際、クエリ/`sessionStorage` 経由で位置復元

### `js/ar.js`（AR版）

- カメラ権限・位置情報権限を取得し、近傍ツイートをオーバーレイ描画
- `js/ar-config.js` で表示パラメータ（サイズ、透明度、更新間隔など）を調整
- `DEBUG` モードや仮想位置の切り替えに対応
- 地図版へ戻るとき、現在地を `sessionStorage` に保存して引き継ぎ

### `js/app-config.js`

地図版の運用設定です。主に以下を保持します。

- Google Maps API Key
- Cesium Ion token / asset id
- Analytics tracking id
- 初期カメラ視点（`viewPoints`）

## データ更新フロー

`data/czml/tweets.json` を差し替えたら、タイル索引を再生成してください。

```bash
cd /path/to/tweetMapping
node tools/build-tweet-tiles.js
```

生成物:

- `data/czml/tweet-tiles/index.json`
- `data/czml/tweet-tiles/search.json`
- `data/czml/tweet-tiles/tiles/*.json`

## 運用時の注意

- APIキーやトークンは `js/app-config.js` に平文で置かれるため、公開範囲を確認して運用する
- OGP/Twitter Card の画像URL・サイトURLを変更する場合は `index.html` / `ar.html` のメタタグを更新する
- Apache配信時は `.htaccess` のキャッシュ設定が有効になる
- `Cesium/` ディレクトリは現状実装で直接参照していないため、用途を確認してから整理する

## ライセンス / 連絡先

- ライセンス: `LICENSE` を参照
- お問い合わせ: `hwtnv(at)iii.u-tokyo.ac.jp`
