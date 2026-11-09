# Suno Timestamp Extension

Suno（`https://suno.com/`）の既存UI（Create / Workspaces / Library の曲一覧および右側の楽曲詳細パネル）に、楽曲の作成日時（`🕒 YYYY/MM/DD HH:mm:ss` ローカルタイムゾーン）をインライン表示する軽量な Chrome 拡張機能（Manifest V3）です。

---

## 主な特徴

- **インライン作成日時表示**: 曲タイトル・スタイルタグの下に `🕒 2026/11/06 21:34:56 JST` 形式で生成日時を表示します。
- **詳細パネル連動**: 右側の楽曲詳細パネルでも選択中の曲の生成日時を表示し、曲を切り替えると即座に更新されます。
- **Clip ID による厳密な照合**: 同じタイトルの曲が複数存在しても、タイトル文字列ではなく UUID（`Clip ID`）で照合するため、別曲の日時が混ざることはありません。
- **ローカルタイムゾーン変換 & UTC ツールチップ**: ブラウザのローカルタイムゾーンに自動変換して表示し、マウスホバー時のツールチップ（`title` 属性）で元の UTC ISO 8601 時刻を確認できます。
- **推測データの排除**: 取得できない場合は非表示とし、推定日時を実データとして表示しません。
- **ゼロ追加通信を優先**: 画面がすでに取得した API レスポンス（Fetch / XHR / Next.js SSR / React Fiber props）とローカルキャッシュ（`chrome.storage.local`）を再利用します。

---

## ディレクトリ構成

```text
src/
  content/
    index.ts             # SPA検出・起動（ISOLATED world）
    ui.ts                # 一覧/詳細パネルへの日時バッジ注入・更新
    clip-id.ts           # DOM・URLからのClip ID（UUID）抽出
    observer.ts          # MutationObserver / スクロール / SPA遷移監視
    page-bridge.ts       # ページ通信レスポンス・React Fiber受動読み取り（MAIN world）
  data/
    provider.ts          # データ取得インターフェイス
    suno-provider.ts     # Sunoデータ抽出・フォールバック取得実装
    cache.ts             # Clip ID -> created_at メモリ & chrome.storage.local キャッシュ
  shared/
    datetime.ts          # 日時パーサー（ISO 8601 / Unix秒 / Unixミリ秒）& フォーマッター
    types.ts             # 共通型定義
docs/
  investigation.md       # サイト通信・DOM構造調査と実機確認ガイド
tests/
  datetime.test.ts
  provider-and-clip-id.test.ts
manifest.json            # Manifest V3 定義
dist/                    # Chrome に Load unpacked で読み込むビルド出力先
```

---

## ビルド・テスト手順

Node.js（v20以降推奨）環境で以下のコマンドを実行します。

```bash
# 依存パッケージのインストール
npm install

# TypeScript 型チェック
npm run typecheck

# ユニットテストの実行
npm test

# 拡張機能のビルド（dist/ に出力されます）
npm run build
```

---

## Chrome への導入手順（Load unpacked）

1. 本リポジトリで `npm run build` を実行し、`dist/` フォルダが生成されていることを確認します（すでに `dist/` が存在する場合はそのまま利用可能です）。
2. Google Chrome のアドレスバーに `chrome://extensions` と入力して開きます。
3. 右上の **「デベロッパー モード (Developer mode)」** スイッチを **ON** にします。
4. 左上の **「パッケージ化されていない拡張機能を読み込む (Load unpacked)」** をクリックします。
5. 本プロジェクト内の **`dist` フォルダ** を選択して読み込みます。
6. `https://suno.com/create`（または Workspaces / Library）を開くか再読み込みすると、各曲に作成日時が表示されます。

---

## 更新手順

1. コードを変更したあと、`npm run build` を実行して `dist/` を更新します。
2. `chrome://extensions` を開き、**Suno Timestamp Extension** カード内の **更新（🔄 アイコン）** をクリックします。
3. 開いている `https://suno.com/` のタブを再読み込み（リロード）します。

---

## 無効化・削除手順

- **一時的に無効化する場合**: `chrome://extensions` の **Suno Timestamp Extension** カード右下のトグルスイッチを **OFF** にし、Suno のタブを再読み込みします。
- **完全に削除する場合**: `chrome://extensions` の **Suno Timestamp Extension** カード内の **「削除 (Remove)」** ボタンをクリックします（`chrome.storage.local` に保存されたキャッシュも同時に削除されます）。
