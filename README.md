# 汎用Kintone連携サーバ（ゼロ保持）

このリポジトリは、任意のKintoneアプリを後から登録してフォーム送信/閲覧/編集を提供する汎用サーバのコードとドキュメントを含みます。本文（PII/機密）はサーバに保存しないゼロ保持ポリシーです。

## 構成概要
- `server/`: Node.js（Express）本体、Prisma（MariaDB）、Valkey（セッション/レート制限）
- `schemas/`: フォーム/ビュー/アプリ登録のテンプレート
- ドキュメント: 設計/仕様/VM構築ガイド

## クイックスタート（ローカル開発）
```bash
cd server
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run start
# http://localhost:3000/health を確認
```

## 本番/開発VMデプロイ（RockyLinux）
- 詳細手順は [server/DEPLOYMENT.md](server/DEPLOYMENT.md) と [server/VM_SETUP_RockyLinux.md](server/VM_SETUP_RockyLinux.md) を参照。
- 代表手順（要約）:
  1. Node.js/MariaDB/Valkey/Apacheを導入
  2. `server/.env.example` を `.env` にコピーして値設定
  3. `npx prisma generate && npx prisma db push`
  4. `npm run start` または systemd で常時起動

## 推奨ワークフロー（固定）
1. ローカルで開発（ネットワーク共有ではなくローカルディスク推奨）
2. GitHubへ `push`（`main` または PR マージ）
3. 検証VMで `git pull` して動作確認
4. 本番サーバで同じリポジトリを `git pull` して反映

これにより「GitHubの内容＝本番反映可能な内容」を維持しやすくなります。

## GitHubへアップロード
```bash
cd <リポジトリルート>
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<USERNAME>/<REPO>.git
git push -u origin main
```

## セキュリティポリシー（重要）
- ZERO_RETENTION/MEMORY_ONLY_PIPELINE を強制。本文はDB/Valkey/ファイル/ログに保存しません。
- 添付ファイルは現状OFF。将来対応時もメモリStreamのみでディスク書込み禁止。
- 監査はメタのみ（日時/IP/UA/トークン参照/KintoneレコードID/リビジョン/ステータス）。

## ライセンス/注意
- 秘密情報（APIトークン、鍵、.env）はコミットしないでください（.gitignoreに含まれています）。
