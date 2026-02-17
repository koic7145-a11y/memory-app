# 暗記マスター (Memory App) 要件定義書

このドキュメントは、エビングハウスの忘却曲線に基づいた学習アプリ「暗記マスター」の開発要件を定義したものです。
AIエージェントにこのドキュメントを渡すことで、迷いなく実装・デプロイまで完了できることを目指しています。

## 1. プロジェクト概要

*   **アプリ名**: 暗記マスター (Memory App)
*   **目的**: ユーザーが効率的に記憶を定着させるためのフラッシュカードアプリを提供する。
*   **コアコンセプト**: エビングハウスの忘却曲線に基づく学習アルゴリズム (SM-2変種) を採用し、適切なタイミングで復習を促す。
*   **プラットフォーム**: Webブラウザ (PC/SP)。PWA対応によりアプリライクな利用が可能。
*   **デプロイ先**: GitHub Pages (Netlify等は使用しない)。

## 2. 技術スタック

一貫性とメンテナンス性を重視し、以下のスタックを採用する。

*   **フロントエンド**:
    *   **HTML5 / CSS3**: フレームワークなし(Vanilla)。CSS Variablesを活用したモダンなデザイン。
    *   **JavaScript (ES6+)**: フレームワークなし(Vanilla)。
    *   **PWA**: Service Worker (`sw.js`) によるオフラインキャッシュ、`manifest.json` によるインストール対応。
*   **ローカルデータ保存**:
    *   **IndexedDB**: `Dexie.js` ライブラリを使用。大量のカードデータや画像データのキャッシュに使用。
*   **バックエンド / クラウド同期**:
    *   **Supabase**:
        *   **Auth**: メールアドレス認証、Google認証。
        *   **Database**: PostgreSQL。ユーザーごとのデータ同期。
        *   **Storage**: 画像ファイルの保存。
        *   **Realtime**: 複数デバイス間のリアルタイム同期。
*   **開発・デプロイ**:
    *   **GitHub**: ソースコード管理。
    *   **GitHub Actions**: `main` ブランチへのプッシュ時に GitHub Pages へ自動デプロイ。

## 3. 機能要件

### 3.1. 学習機能 (Core)
*   **SM-2 アルゴリズム**:
    *   カードごとに `easeFactor` (易しさ), `interval` (次回までの日数), `repetitions` (連続正解回数) を保持。
    *   回答評価は「やり直し(0)」「難しい(1)」「普通(2)」「簡単(3)」の4段階。
    *   評価に応じて次回の復習日 (`nextReview`) を計算して更新。
*   **学習モード**:
    *   今日復習すべきカードのみを抽出して出題。
    *   カードの表（問題）を表示 -> クリックで裏（解答）を表示 -> 評価ボタンを押下。

### 3.2. カード管理
*   **作成**:
    *   問題画像、解答画像の2枚をセットで登録。
    *   画像アップロードは「クリック」「ドラッグ＆ドロップ」「クリップボードからの貼り付け (Ctrl+V)」に対応。
    *   **連続登録モード**: 保存後、直ちに次のカード入力へ移行（デッキ選択などは維持）。
*   **編集・削除**:
    *   既存カードの内容修正、削除機能。
*   **カテゴリ (デッキ)**:
    *   「テクノロジ系」「マネジメント系」「ストラテジ系」などの大分類と、ユーザー定義の小分類（デッキ）。
    *   新規デッキ作成、削除機能。

### 3.3. データ同期・バックアップ
*   **クラウド同期 (Supabase)**:
    *   ログインユーザーのデータをクラウドDBと双方向同期。
    *   「最終更新日時 (`updated_at`)」に基づく "Last Write Wins" 戦略で衝突解決。
    *   画像の同期（Supabase Storage）。DataURLでローカル保存しつつ、バックグラウンドでStorageへアップロードしてPathを保存。
*   **データのインポート/エクスポート**:
    *   全データをJSON形式でファイルに書き出し/読み込み。
    *   バックアップおよび別アカウントへの移行用。

### 3.4. UX/UI
*   **デザイン**:
    *   シンプルで集中できるUI。
    *   レスポンシブ対応（スマホ、タブレット、PC）。
    *   ダークモード/ライトモード対応（CSS変数で管理）。
*   **ショートカットキー**:
    *   `Ctrl + Enter`: カード保存。
    *   `Space`: カードをめくる。
    *   数字キー `1-4`: 回答評価。

## 4. データスキーマ (Supabase & IndexedDB)

クラウド(Supabase)とローカル(Dexie.js)で同一のデータ構造を持つことを原則とする。

### 4.1. テーブル定義 (Supabase SQL)

```sql
-- Cards Table
create table public.cards (
  id text primary key, -- UUID generated on client
  user_id uuid references auth.users not null,
  question text default '',
  answer text default '',
  question_image_path text, -- Path in Storage
  answer_image_path text, -- Path in Storage
  category text default '未分類',
  level integer default 0,
  ease_factor float default 2.5,
  interval_days integer default 0,
  repetitions integer default 0,
  next_review text, -- ISO Date String (YYYY-MM-DD)
  review_history jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false
);

-- Decks Table
create table public.decks (
  id text primary key,
  user_id uuid references auth.users not null,
  name text not null,
  group_name text, -- 'テクノロジ系' etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted boolean default false
);

-- RLS Policies (Security)
alter table public.cards enable row level security;
alter table public.decks enable row level security;

create policy "Users can view their own cards" on cards for select using (auth.uid() = user_id);
create policy "Users can insert their own cards" on cards for insert with check (auth.uid() = user_id);
create policy "Users can update their own cards" on cards for update using (auth.uid() = user_id);
create policy "Users can delete their own cards" on cards for delete using (auth.uid() = user_id);
-- (Same for decks)
```

### 4.2. Storage
*   **Bucket Name**: `card-images`
*   **Policy**: Authenticated users can upload/read/delete their own folder `{user_id}/*`.

## 5. デプロイフロー (GitHub Pages)

GitHub Actionsを使用して自動デプロイを行う。

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Pages
        uses: actions/configure-pages@v4
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## 6. ディレクトリ構造

```
memory-app/
├── .github/
│   └── workflows/
│       └── deploy.yml  # GitHub Actions設定
├── index.html          # メインUI
├── styles.css          # デザイン定義
├── app.js              # アプリロジック (UI操作, IndexedDB連携)
├── db.js               # Dexie.js データベース定義
├── supabase-sync.js    # Supabase同期ロジック
├── sw.js               # Service Worker (オフライン対応)
├── manifest.json       # PWA設定
├── icon.svg            # アプリアイコン
├── robots.txt          # クローラー制御
└── README.md           # プロジェクト説明
```

## 7. 今後の拡張性 (Future Work)
*   **統計機能の強化**: 学習効率のグラフ化。
*   **共有機能**: デッキの公開・共有（パブリックデッキ）。
*   **音声読み上げ**: TTSによる問題文・解答文の読み上げ。
