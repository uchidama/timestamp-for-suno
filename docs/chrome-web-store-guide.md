# Chrome ウェブストア公開・審査入力ガイド (`docs/chrome-web-store-guide.md`)

Chrome ウェブストア（[Developer Dashboard](https://chrome.google.com/webstore/devconsole)）に提出する際の手順と、各入力欄にそのままコピペできる文面です。

---

## 1. アップロードする ZIP ファイル

プロジェクトルートで以下を実行すると、提出用の **`timestamp-for-suno.zip`** が生成されます。

```bash
npm run package
```

この `timestamp-for-suno.zip` を Developer Dashboard の「新しいアイテム」からアップロードしてください。

---

## 2. ストア掲載情報（Store Listing）コピペ用

### 拡張機能名（Title）
```text
Timestamp for Suno
```

### 概要（Summary / 132文字以内）
**日本語:**
```text
Suno (suno.com) の曲一覧（Create / Workspaces / Library）と曲詳細パネルに、正確な楽曲生成日時（YYYY/MM/DD HH:mm:ss）をインライン表示する非公式拡張機能。
```
**英語（併記または英語圏向け）:**
```text
Displays exact song creation timestamps (YYYY/MM/DD HH:mm:ss) inline in Suno's Create, Workspaces, Library, and Song Detail panels.
```

### 詳細説明（Description）
```text
Timestamp for Suno は、Suno（https://suno.com/）の既存UIを邪魔することなく、各楽曲の正確な作成日時（秒単位）をインライン表示する軽量な非公式（Unofficial）Chrome拡張機能です。

【主な機能】
・Create / Workspaces / Library の曲一覧の各行に「🕒 YYYY/MM/DD HH:mm:ss」形式で生成日時を表示
・右側の楽曲詳細パネルにも作成日時を表示し、曲の切り替えにリアルタイム追従
・お使いのブラウザのローカルタイムゾーンに自動変換（ホバー時のツールチップで元の UTC ISO 8601 時刻も確認可能）
・同名曲が複数あっても、タイトルではなく Clip ID（UUID）で厳密に照合するため別曲の時刻が混ざりません
・SPA画面遷移、ページネーション、無限スクロール、新曲生成時に自動反映

【プライバシーと安全性】
・外部サーバーへのデータ送信、アクセス解析、トラッキングは一切行いません。
・認証トークン、Cookie、歌詞、プロンプト、音声データには一切触れず、ブラウザ内のみで安全に動作します。
・オープンソース（GitHub）で全ソースコードを公開しています。

---

[English]
Timestamp for Suno is a lightweight, unofficial Chrome extension that displays exact song creation timestamps (YYYY/MM/DD HH:mm:ss) directly inline on Suno (https://suno.com/).

Key Features:
- Displays creation timestamps inline on every song row across Create, Workspaces, and Library views.
- Displays and dynamically updates the creation timestamp in the right-hand Song Detail panel.
- Automatically converts timestamps to your local timezone (hover tooltip shows the exact UTC ISO 8601 timestamp).
- Matches tracks strictly by Clip ID (UUID) rather than title, ensuring accurate timestamps even for multiple tracks with identical titles.
- Zero external network tracking: All processing happens 100% locally in your browser. No tokens, cookies, prompts, lyrics, or audio data are ever collected or transmitted.

Disclaimer: This is an independent, unofficial community extension and is not affiliated with or endorsed by Suno, Inc.
```

### カテゴリ（Category）
- **生産性（Productivity）** または **ツール（Workflow & Planning / Tools）**

---

## 3. プライバシータブ（Privacy Practices）の回答コピペ用

審査時間を最短にするための回答例です。

### 単一目的の説明（Single Purpose Description）
```text
Suno (https://suno.com/) の楽曲一覧および楽曲詳細パネル上に、各楽曲の作成日時（タイムスタンプ）をインライン表示することのみを目的としています。
(Displays the creation timestamp of each song inline on Suno's track list and song detail panel.)
```

### 各権限の理由（Permission Justifications）

- **`storage` の理由 (storage justification):**
  ```text
  一度取得した楽曲ID（Clip ID）と作成日時（created_at）のペアをブラウザ内のローカルストレージ（chrome.storage.local）にキャッシュし、ページ再読み込み時やスクロール時に即座に表示するために使用します。外部への送信は一切行いません。
  (Used solely to cache Clip ID to creation timestamp mappings locally in chrome.storage.local for instant rendering on page reload.)
  ```

- **ホスト権限 `https://suno.com/*` の理由 (Host permission justification):**
  ```text
  https://suno.com/ の楽曲一覧および詳細パネルのDOM要素に作成日時テキストを表示するため、およびページ自身が読み込んだ楽曲メタデータから作成日時（created_at）を取得するために必要です。
  (Required to read song creation timestamps from https://suno.com/ page data and render the formatted timestamp inline in the Suno UI.)
  ```

- **リモートコードを使用していますか？ (Are you using remote code?)**
  - **「いいえ、リモートコードは使用していません (No, I am not using remote code)」** を選択

- **データ使用状況（Data Usage）のチェックボックス**
  - 「ユーザーデータを収集・使用する」のチェック項目は **すべてオフ（収集しない）**
  - 最後の3つの宣誓チェックボックスにチェックを入れる

- **プライバシーポリシーのURL（必要な場合）**
  - `https://github.com/uchidama/timestamp-for-suno/blob/main/PRIVACY.md`
