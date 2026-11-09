# Suno サイト構造・通信調査レポート (`docs/investigation.md`)

## 1. 調査の前提と方針

本開発環境（CLI/エージェント環境）からは、ユーザーのログイン済みSunoアカウントを伴うブラウザ実機操作（DevToolsの直接閲覧）を行えないため、仕様書（`suno-timestamp-extension-spec.md`）の方針に従い以下を実施した。

1. **仮のAPI仕様をハードコードで断定しない設計**を採用する。
2. Suno Webフロントエンド（Next.js / React SPA）の既知の構造パターンに対応しつつ、**画面がすでに保持・受信しているデータを優先再利用（優先順位A）**するマルチレイヤー方式を実装する。
3. 万が一Suno側のUI変更等で表示されない箇所があった場合に、実機DevToolsで確認・収集すべきNetworkレスポンスとDOM属性の手順を本ドキュメントに明記する。

---

## 2. Suno フロントエンドの通信・データ構造（確認済みパターンと注意点）

### 2.1 内部API通信（Fetch / XHR / Next.js Hydration）
SunoのWebクライアント（`https://suno.com`）はバックエンドAPI（主に `https://studio-api.prod.suno.com/api/...` または同一オリジン `/api/...`、および Next.js Flightデータ `__NEXT_DATA__` / `__next_f`）から楽曲（Clip）メタデータをJSONとして受け取る。

代表的なエンドポイント群（バージョンにより変動する可能性あり）:
- フィード・ライブラリ一覧: `/api/feed/v2`, `/api/feed/`, `/api/clips`
- プロジェクト / ワークスペース: `/api/project/<project_id>`, `/api/project/me`
- 個別クリップ詳細: `/api/clip/<clip_id>`

### 2.2 Clip オブジェクトのフィールド構造
レスポンスJSON内の各楽曲オブジェクト（ルート配列、`clips` 配列、`project_clips[].clip`、または単一 `clip` オブジェクト）には通常以下のフィールドが含まれる:

```json
{
  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "title": "吉野ヶ里 ― 邪馬台国はここにあったのか？",
  "created_at": "2026-11-06T12:34:56.789Z",
  "model_name": "chirp-v4",
  "metadata": {
    "tags": "Electro pop, melodic techno"
  }
}
```

- **`id`**: UUID形式（8-4-4-4-12の16進文字列）。同名曲を区別する唯一無二の識別子。
- **`created_at`**:
  - 主に **ISO 8601 UTC文字列**（例: `"2026-11-06T12:34:56.789Z"` または `"2026-11-06T12:34:56Z"`）
  - エンドポイントやキャッシュ層によっては Unix秒（10桁数値）または Unixミリ秒（13桁数値）の可能性も考慮し、`src/shared/datetime.ts` で厳密にバリデーション・変換する（単位が不確実な数値はエラー扱いとし、推測表示しない）。

---

## 3. DOM構造と Clip ID の特定方法

Sunoの画面（Create / Workspaces / Library / Song Detail Panel）において、各DOM要素と `Clip ID` を紐づける手段は以下の優先順で抽出する（タイトル文字列による照合は一切行わない）:

1. **アンカーリンク (`<a href="/song/<uuid>">`)**
   - 曲一覧のタイトルリンクや詳細パネル内の共有/詳細リンクに含まれる `/song/<uuid>` パスからUUIDを抽出する。
2. **明示的な `data-*` 属性**
   - `data-clip-id`, `data-song-id`, `data-id`, `data-key` 等の属性にUUIDが含まれる場合に抽出する。
3. **React Fiber プロパティの直接参照（MAIN world ブリッジ経由）**
   - SunoはReact（Next.js）で描画されているため、曲一覧の行要素（Row）や右側の詳細パネル（Detail Panel）のDOMノードには `__reactFiber$...` / `__reactProps$...` が紐づいている。
   - リンク `<a href="/song/<uuid>">` がDOM上に出力されない行や詳細パネルであっても、Reactコンポーネントの `props`（`clip`, `song`, `item`, `currentClip` 等）には `{ id: "<uuid>", created_at: "..." }` が保持されている。
   - 本拡張では最小限の静的スクリプト（`src/content/page-bridge.ts`, `world: "MAIN"`）からReact Fiberを安全に読み取ることで、追加のHTTP通信なしで正確な `Clip ID` と `created_at` を同時に解決できる。
4. **検証済みClip IDと一致するメディアURL（補助）**
   - カバー画像や音源URL（例: `image_<uuid>.jpeg`）に含まれるUUIDは、すでにAPIレスポンス等で **実在するClip IDとして確認済みのUUID集合に含まれる場合のみ** 補助的に利用する。

---

## 4. データ取得アーキテクチャ（優先順位 A → B → C）

仕様書の優先順位に従い、以下の3段階でデータを解決する。

| 優先順位 | 手法 | 説明 |
| :--- | :--- | :--- |
| **A. 画面データの再利用** | 1. Networkレスポンスの受動キャプチャ (`fetch` / `XHR`)<br>2. Next.js SSRデータ (`__NEXT_DATA__` / `__next_f`) の走査<br>3. React Fiber props の受動読み取り | ページ自身がすでに行った通信レスポンスやメモリ上のReact propsから `{ id, created_at }` を抽出する。追加のAPIリクエストは **0件**。認証トークンにも一切触れない。 |
| **B. 同一オリジン読み取り専用通信** | `/api/clip/<id>` または `/song/<id>` からの取得（フォールバック） | 優先順位Aおよびキャッシュで解決できないClip IDが画面上に表示されている場合のみ、レート制限・指数バックオフ・重複排除付きで読み取り専用の取得を試みる。失敗時は即座に中断し `null`（非表示）とする。 |
| **C. キャッシュ補完** | メモリキャッシュ + `chrome.storage.local` | 一度取得した `Clip ID -> created_at (UTC ISO)` を永続キャッシュする（作成日時は不変のため）。リロード時やページネーション再表示時に即座に描画する。 |

---

## 5. 実機で追加確認が必要な場合の収集手順（ユーザー向けガイド）

もしSunoのアップデートにより一部画面（Create / Workspaces / Library / 右側詳細パネル）で日時が表示されない場合は、Chrome DevToolsで以下の情報を確認してください。

### 5.1 Networkレスポンスの確認手順
1. Chromeで `https://suno.com/create`（または Workspaces / Library）を開き、ログインする。
2. `F12`（Macは `Cmd + Option + I`）で **DevTools** を開き、**Network** タブ → **Fetch/XHR** フィルタを選択する。
3. ページをリロードするか、曲一覧をスクロール・クリックする。
4. 曲データを含むリクエスト（例: `feed`, `project`, `clip`, `tracks` 等）を選択し、**Response**（または **Preview**）タブで以下を確認する:
   - リクエストURL（例: `https://studio-api.prod.suno.com/api/...`）
   - 曲オブジェクトのパス（例: `clips[0].id`, `clips[0].created_at`）
   - 日時フィールド名と形式（`created_at`: `"2026-11-06T12:34:56.789Z"` など）

### 5.2 DOM構造の確認手順
1. DevToolsの **Elements** タブ左上の要素選択アイコンをクリックし、曲一覧の1行または右側の曲詳細パネルのタイトル部分をクリックする。
2. 以下を確認する:
   - 行要素やタイトル周辺に `<a href="/song/<UUID>">` が存在するか
   - 行コンテナに `data-testid` や `data-clip-id` 等の識別属性があるか
   - 右側詳細パネルのルート要素の特徴（`<aside>`、または特定の構造など）
