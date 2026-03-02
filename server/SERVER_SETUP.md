# 汎用Kintone連携サーバ 構築手順書（RockyLinux 10）

本手順書は、Toyokumo相当のゼロ保持ポリシーに準拠した汎用Kintone連携サーバを、オンプレミスの RockyLinux 10 環境に構築・運用するためのガイドです。リポジトリの現行実装は Express（Node.js）+ Prisma（MariaDB）+ Zod + pino を採用しています（NestJS移行は将来選択肢）。

---

## 0. 推奨運用フロー（ローカル開発 → GitHub → VM検証 → 本番）
- 開発はローカルPC（NTFS）で実施し、Gitでコミット。
- GitHubへ`main`に反映（またはPRでレビュー）。
- 検証VM（RockyLinux）では`git clone`/`git pull`で同一コードを取得して動作確認。
- 本番サーバも同じリポジトリを`git pull`してデプロイ（再現性を確保）。

### 0.1 ローカル開発側（例）
```bash
git add .
git commit -m "feat: update kintone bridge"
git push origin main
```

### 0.2 検証VM/本番サーバ側（初回）
```bash
sudo mkdir -p /opt/kintone-bridge
sudo chown $USER:$USER /opt/kintone-bridge
cd /opt/kintone-bridge
git clone <YOUR_REPO_URL> .
cd server
npm install
npx prisma generate
npx prisma db push
sudo systemctl restart kintone-bridge
```

### 0.3 検証VM/本番サーバ側（更新）
```bash
cd /opt/kintone-bridge
git pull origin main
cd server
npm install
npx prisma db push
sudo systemctl restart kintone-bridge
```

---

## 1. 目的と方針
- **目的**: 任意のKintoneアプリに対して、フォーム入力・表示・編集・ランダムURLアクセスを提供する汎用サーバを構築。
- **ゼロ保持**: サーバはPII本文を保存しない。DBは監査・設定・トークン・短期ジョブのみ使用。
- **コア**:
  - AppRegistry: テナント/アプリ登録（`Tenant`, `App`）
  - SchemaRegistry: フォーム/ビュー定義（`Schema`）
  - TokenService: ランダムURL（DBはハッシュ+期限+スコープ、Kintone側で平文）
  - Audit: 構造化ログ＋DB監査（`AuditLog`、本文なし）

---

## 2. 前提条件
- OS: RockyLinux 10（SELinux Enforcing 推奨）
- ネットワーク: 外部HTTPS/TLS終端（Apache）および内部HTTP（アプリ）
- Kintone: 対象アプリのフィールド構成とAPIトークン準備、トークン平文フィールド（例: `token`）
- DB: MariaDB 10.x系（UTF8MB4）
- ドメイン: 例 `bridge.example.com`（TLS証明書用）

---

## 3. サーバ基盤構築

### 3.1 OSパッケージ・サービス
```bash
# 更新と基本パッケージ
sudo dnf -y update
sudo dnf -y install git curl unzip

# Apache（HTTPSリバースプロキシ）
sudo dnf -y install httpd mod_ssl

# MariaDB（サーバ & クライアント）
sudo dnf -y install mariadb-server mariadb

# Node.js（LTS推奨、例: 20.x）
# RockyLinux AppStreamに適切なバージョンがない場合はNodeSourceを利用
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf -y install nodejs

# （任意）Valkey/Redis互換が必要なら別途導入
```

### 3.2 サービス起動と永続化
```bash
# Apache
sudo systemctl enable --now httpd

# MariaDB
sudo systemctl enable --now mariadb

# SELinux: Apacheのネットワーク接続を許可
sudo setsebool -P httpd_can_network_connect 1

# Firewall（例）
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

### 3.3 MariaDB 初期化
```bash
# mysql_secure_installation を実施してrootパスワード等を設定
sudo mysql_secure_installation

# DBとユーザの作成（例）
mysql -u root -p <<'SQL'
CREATE DATABASE bridge_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bridge_user'@'%' IDENTIFIED BY 'strong-password';
GRANT ALL PRIVILEGES ON bridge_db.* TO 'bridge_user'@'%';
FLUSH PRIVILEGES;
SQL
```

---

## 4. アプリのデプロイ

### 4.1 リポジトリ取得
```bash
# デプロイ先例
sudo mkdir -p /opt/kintone-bridge
sudo chown $USER:$USER /opt/kintone-bridge
cd /opt/kintone-bridge

# GitHubからクローン
git clone <YOUR_REPO_URL> .
```

### 4.2 環境変数設定
```bash
cd server
cp .env.example .env
# .env を編集（主要項目）
# PORT=3000
# DATABASE_URL=mysql://bridge_user:strong-password@127.0.0.1:3306/bridge_db
# ZERO_RETENTION=true
# MEMORY_ONLY_PIPELINE=true
# RETRY_BUFFER=false
# LOG_LEVEL=info
# SECRET_KEY=<32byte鍵をhex64で設定>  # 例: openssl rand -hex 32
# KINTONE_TOKEN_FIELD=token
# KINTONE_TIMEOUT_MS=10000
```

### 4.3 依存インストールとDBスキーマ反映
```bash
npm install
npx prisma generate
npx prisma db push
```

### 4.4 動作確認（開発起動）
```bash
npm run start
# または、フォアグラウンド: node src/app.js
# ヘルスチェック: curl http://127.0.0.1:3000/health
```

---

## 5. systemdによる常駐起動

### 5.1 ユニットファイル配置
既存ユニット雛形: `server/deploy/systemd/kintone-bridge.service`

```bash
sudo cp deploy/systemd/kintone-bridge.service /etc/systemd/system/kintone-bridge.service
# 必要に応じて WorkingDirectory/ExecStart/Environment を編集

sudo systemctl daemon-reload
sudo systemctl enable --now kintone-bridge
sudo systemctl status kintone-bridge
```

---

## 6. Apache リバースプロキシ設定（HTTPS）

### 6.1 仮想ホスト設定例
`/etc/httpd/conf.d/kintone-bridge.conf`
```apache
<VirtualHost *:443>
  ServerName bridge.example.com

  SSLEngine on
  SSLCertificateFile /etc/letsencrypt/live/bridge.example.com/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/bridge.example.com/privkey.pem

  ProxyPreserveHost On
  ProxyPass / http://127.0.0.1:3000/
  ProxyPassReverse / http://127.0.0.1:3000/

  # セキュリティヘッダ（helmet併用）
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set Referrer-Policy "no-referrer"
</VirtualHost>
```
```bash
sudo apachectl configtest
sudo systemctl reload httpd
```

---

## 7. 管理API初期化フロー

### 7.1 テナント作成
```bash
curl -s -X POST https://bridge.example.com/admin/tenants \
  -H 'Content-Type: application/json' \
  -d '{"name":"acme"}'
# => { "tenant_id": "t_xxx" }
```

### 7.2 アプリ登録
```bash
curl -s -X POST https://bridge.example.com/admin/tenants/t_xxx/apps \
  -H 'Content-Type: application/json' \
  -d '{
    "kintone_domain":"your-subdomain.kintone.com",
    "app_code":"1234",  # KintoneのアプリID（または内部コード）
    "auth_type":"api_token",
    "api_token_enc":"<平文トークン>"  # 平文で送るとサーバ側で暗号化保存します
  }'
# => { "app_id": "a_xxx" }
```

注記:
- `app_code` は現在、KintoneのアプリID（数値）として扱います（内部IDではなくKintone側ID）。
- `api_token_enc` は平文でも送信できます。サーバ側で暗号化保存され、実行時に復号してKintone APIへ接続します。

### 7.3 スキーマ登録
```bash
# フォーム
curl -s -X POST https://bridge.example.com/admin/tenants/t_xxx/schemas/forms \
  -H 'Content-Type: application/json' \
  -d '{ "app_id":"a_xxx", "json": { "version":1, "title":"汎用フォーム", "fields":[ {"id":"name","label":"氏名","type":"text","required":true,"kintoneField":"name"} ] } }'

# ビュー
curl -s -X POST https://bridge.example.com/admin/tenants/t_xxx/schemas/views \
  -H 'Content-Type: application/json' \
  -d '{ "app_id":"a_xxx", "json": { "version":1, "list": { "columns":[ {"label":"氏名","kintoneField":"name"} ] } } }'
```

### 7.4 トークン発行（ランダムURL）
```bash
curl -s -X POST https://bridge.example.com/admin/tenants/t_xxx/apps/a_xxx/tokens \
  -H 'Content-Type: application/json' \
  -d '{ "scope":"view", "expiry_minutes":30, "record_ref":"rec_123" }'
# => { "token":"<plaintext>", "scope":"view", "expiry":"2026-..." }
# 平文トークンはDB保存しないため、このレスポンスをユーザへ配布
```

---

## 8. 公開API動作確認（ゼロ保持）
```bash
# フォーム送信（モック）
curl -s -X POST https://bridge.example.com/t_xxx/a_xxx/form/submit \
  -H 'Content-Type: application/json' \
  -d '{"payload": {"name": "山田太郎"}}'

# レコード閲覧
curl -s https://bridge.example.com/t_xxx/a_xxx/record/<token>

# レコード更新（編集トークンが必要）
curl -s -X PUT https://bridge.example.com/t_xxx/a_xxx/record/<edit_token> \
  -H 'Content-Type: application/json' \
  -d '{"name": "山田花子"}'

# ビュー一覧（モック）
curl -s https://bridge.example.com/t_xxx/a_xxx/viewer
```

---

## 9. セキュリティと保持
- **本文非保存**: 入力データはKintoneへ直送。サーバは監査・設定・トークンのみ。
- **トークン**: DBはSHA-256ハッシュ・期限・スコープのみ。平文は配布時のみ取得。
- **レート制限**: `express-rate-limit` により基本的な制限を適用。
- **ヘッダ**: `helmet` によるCSP/安全ヘッダ（必要に応じて強化）。
- **監査**: `AuditLog` にメタのみ保存（PIIなし）。
- **添付**: 現状OFF。必要時はメモリストリーム＋即時Kintone転送を検討。

---

## 10. 監査・運用
- ログ: `pino` によるJSON構造化（systemd-journald連携推奨）。
- 監査DB: 成功/失敗・クライアントIP・UA・トークンハッシュ参照・KintoneレコードID等。
- バックアップ: 設定/監査/スキーマ/トークン等のメタデータのみ対象。
- アップデート: Git Pull → `npm install` → `prisma generate` → `systemctl restart`。

---

## 11. Kintoneオンボーディング手順（再掲）
1. 管理UI/APIでテナント作成 → アプリ登録（domain/app_code/auth）。
2. Kintone側でトークン平文フィールド（例: `token`）を追加、権限設定。
3. FormSchemaとViewSchemaをアップロード（フィールドコードマッピング）。
4. 対象レコードに対しトークン発行 → ユーザへURL配布（平文トークンはレスポンス時のみ取得）。
5. submit/view/editがゼロ保持で通ることを監査ログ含め確認。

---

## 12. トラブルシュート
- **401 invalid_or_expired_token**: スコープ不一致・期限切れ・テナント/アプリ不一致。
- **DB接続失敗**: `DATABASE_URL` を再確認、Firewall/SELinuxの許可。
- **TLSエラー**: 証明書/鍵のパス、`apachectl configtest`で構文確認。
- **Kintone連携失敗**: `kintone.js` 実装（現状モック）とAPIトークン/権限を確認。

---

## 付録: 主要テーブル（Prisma）
- `Tenant(id, name)`
- `App(id, tenantId, kintoneDomain, appCode, authType, apiTokenEnc?, oauthClientRef?)`
- `Schema(id, tenantId, appId, type(form|view), json, version)`
- `Token(hash, tenantId, appId, recordRef?, scope(view|edit), expiry)`
- `AuditLog(...)`（本文なし）

---

以上。
