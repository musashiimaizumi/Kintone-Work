# デプロイメントガイド（RockyLinux / 汎用展開）

この文書は、GitHubから`git clone`した後に任意のサーバで展開できる汎用手順です。ゼロ保持ポリシーを満たしています。

## 前提
- OS: Rocky Linux 10（他のRHEL系でも可）
- Node.js: v20以降
- MariaDB: 10.5+（例）
- Valkey: Redis互換（セッション/レート制限用途）
- Apache: リバースプロキシ + TLS（任意）

## 1. ソース取得
```bash
cd /opt
sudo git clone https://github.com/<ORG>/<REPO>.git Kintone-Work
sudo chown -R <user>:<group> Kintone-Work
cd Kintone-Work/server
```

## 2. 依存導入・初期化
```bash
cp .env.example .env
# .env の値（DATABASE_URL など）を設定
npm install
npx prisma generate
npx prisma db push
```

## 3. 起動（選択）
- 手動起動
```bash
npm run start
```
- systemd（サンプルユニット）
  - テンプレート: [server/deploy/systemd/kintone-bridge.service](deploy/systemd/kintone-bridge.service)
```bash
sudo cp deploy/systemd/kintone-bridge.service /etc/systemd/system/kintone-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable --now kintone-bridge
sudo journalctl -u kintone-bridge -f
```

## 4. Apache（任意）
- 例: `/etc/httpd/conf.d/app.conf` を作成し、TLS終端 + リバプロ
- SELinux: `httpd_can_network_connect` を有効化

## 5. 動作確認
```bash
curl -s http://127.0.0.1:3000/health
curl -s -X POST http://127.0.0.1:3000/default/sample-app/form/submit -H "Content-Type: application/json" -d '{"payload":{"name":"テスト"}}'
```

## 6. 運用ポリシー
- ZERO_RETENTION=true / MEMORY_ONLY_PIPELINE=true を `.env` で保持
- 監査はMariaDBの`AuditLog`にメタのみ保存。PIIは保存禁止
- Valkeyはセッション/レート制限用。本文キャッシュ禁止

## 7. 障害時
- systemdログ: `journalctl -u kintone-bridge`
- 監査DB: 失敗記録は `AuditLog.errorStatusCode/errorMessageSanitized`
- Kintone接続失敗: ネットワーク/TLS/APIトークン/OAuth設定を確認

## 8. 更新/再デプロイ
```bash
cd /opt/Kintone-Work
sudo git pull
cd server
npm install
npx prisma db push
sudo systemctl restart kintone-bridge
```
