# 汎用Kintone連携サーバ（雛形）

- ZERO_RETENTION / MEMORY_ONLY_PIPELINE に従い、本文は保存しないモック実装。
- 管理API（/admin）と業務APIの一部（/form/submit, /record/:token, /viewer）を用意。

## セットアップ
```bash
cd server
npm install
cp .env.example .env
npx prisma generate
```

### MariaDB 初期化（例）
```sql
-- MariaDBに接続後、初期ユーザ/DB作成
CREATE DATABASE bridge_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bridge_user'@'%' IDENTIFIED BY 'strong-password';
GRANT ALL PRIVILEGES ON bridge_db.* TO 'bridge_user'@'%';
FLUSH PRIVILEGES;
```

### Prisma スキーマ適用
```bash
npx prisma db push
npm run start
```

## エンドポイント（モック）
- POST /admin/tenants
- POST /admin/tenants/{tenant}/apps
- POST /admin/tenants/{tenant}/schemas/forms
- POST /admin/tenants/{tenant}/schemas/views
- POST /admin/tenants/{tenant}/apps/{app}/tokens  ← 追加（scope=view|edit, expiry_minutes）
- POST /{tenant}/{app}/form/submit
- GET  /{tenant}/{app}/record/{token}
- PUT  /{tenant}/{app}/record/{token}
- GET  /{tenant}/{app}/viewer

## 方針
- 本文はメモリで処理し、応答後即破棄。
- Valkey等への本文キャッシュ禁止。
- 添付ファイルは現状OFF（実装なし）。
- ログはJSON構造化（pino）でPII出力禁止。監査はMariaDBへメタのみ保存。

## 管理情報の永続化
- `Tenant`, `App`, `Schema`, `Token` はPrisma経由でMariaDBに保存。
- 発行トークンはプレーンを返すのみでDBにはSHA-256ハッシュを保存。

## 監査ログ（MariaDB）
- 詳細な構築・運用手順は [server/SERVER_SETUP.md](server/SERVER_SETUP.md) を参照。
- テーブル: `AuditLog`（Prisma）
- 保存項目: tenantId, appId, action, result, timestamp, clientIp, userAgent, tokenHashRef, kintoneRecordId, kintoneRevision, errorStatusCode, errorMessageSanitized（本文なし）
