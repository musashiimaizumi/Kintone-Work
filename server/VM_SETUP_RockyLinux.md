# 開発用 RockyLinux VM 構築ガイド（ローカルディスク運用版）

本ガイドはゼロ保持仕様（ZERO_RETENTION/MEMORY_ONLY_PIPELINE）を満たしつつ、VM内ローカルディスクにアプリを配置して運用する手順を示します（NFS/SMB共有なし）。

## 0. 現実環境プロファイル（前提）
- ハイパーバイザ: VMware Workstation 17 Pro（Windows 11 ホスト）
- ゲストOS: Rocky Linux 10
- ゲストIP: 192.168.44.133（ホスト名未設定でも可）
- ゲストアカウント: `niu-admin`（または任意の開発ユーザ）
- コード配置: RockyLinux ローカルディスク（例: `/opt/Kintone-Work`）
- セキュリティ方針: ZERO_RETENTION / MEMORY_ONLY_PIPELINE（本文データの保存禁止）

## 1. VM の用意（選択肢）
- Hyper-V（Windows Pro/Enterprise 推奨）
- VirtualBox（Windows Home でも可）
- VMware Workstation Pro（推奨：豊富なネットワーク設定とスナップショット）
- いずれも RockyLinux 10 ISO を事前に取得

### Hyper-V 例（PowerShell・要管理者）
```powershell
# 変数
$VMName = "rocky-dev"
$VMSwitch = "Default Switch"   # 既存スイッチ名。必要に応じて変更
$VMMem = 4096MB
$VHDPath = "C:\\VMs\\rocky-dev.vhdx"
$ISO = "C:\\ISO\\Rocky-10.iso"  # ISOパスに置換

New-VM -Name $VMName -MemoryStartupBytes $VMMem -Generation 2 -SwitchName $VMSwitch
New-VHD -Path $VHDPath -SizeBytes 40GB -Dynamic
Add-VMHardDiskDrive -VMName $VMName -Path $VHDPath
Add-VMDvdDrive -VMName $VMName -Path $ISO
Set-VMFirmware -VMName $VMName -EnableSecureBoot On -SecureBootTemplate "MicrosoftUEFICertificateAuthority"
Start-VM -Name $VMName
```

### VirtualBox 例（コマンドライン）
```powershell
$VMName = "rocky-dev"
$ISO = "C:\\ISO\\Rocky-10.iso"

VBoxManage createvm --name $VMName --register
VBoxManage modifyvm $VMName --memory 4096 --cpus 2 --nic1 nat
VBoxManage createmedium disk --filename $env:USERPROFILE\VirtualBox VMs\$VMName\$VMName.vdi --size 40960
VBoxManage storagectl $VMName --name "SATA" --add sata --controller IntelAhci
VBoxManage storageattach $VMName --storagectl "SATA" --port 0 --device 0 --type hdd --medium "$env:USERPROFILE\VirtualBox VMs\$VMName\$VMName.vdi"
VBoxManage storageattach $VMName --storagectl "SATA" --port 1 --device 0 --type dvddrive --medium $ISO
VBoxManage modifyvm $VMName --boot1 dvd --boot2 disk
VBoxManage startvm $VMName
```

以降は VM にログイン後（SSH でも可）の手順です。

### VMware Workstation Pro（GUI 例）
1) Create a New Virtual Machine → Typical（または Custom）
2) Installer disc image file（ISO）で RockyLinux 10 の ISO を指定
3) Guest OS: Linux / Other Linux 5.x kernel 64-bit（相当を選択）
4) CPU/メモリ: 2 vCPU, 4–8GB RAM、ディスク: 40GB（単一ファイル推奨）
5) Network: NAT か Bridged を選択（社内アクセス要件に応じ選択）
  - NAT の場合、ホストからゲストへのポート転送は「Virtual Network Editor → VMnet8 → NAT Settings」で 3000/443 を追加
  - Bridged の場合、ゲストのIPに直接アクセス可能
6) セキュリティ: 共有フォルダ/共有クリップボード/ドラッグ&ドロップは無効（ゼロ保持方針）
7) OS インストール後、VMware Tools 相当: `open-vm-tools` を導入

ゲスト内（RockyLinux）:
```bash
sudo dnf -y install open-vm-tools
sudo systemctl enable --now vmtoolsd
```

#### ネットワークの選択（NAT/Bridged）
- NAT: ホストからゲストへのアクセスをポート転送で設定（Virtual Network Editor → VMnet8 → NAT Settings）。例: 3000/443
- Bridged: ゲストが同一ネットワークのIPを持ち、直接アクセス可能（推奨：社内NWでの疎通確認が容易）。
- SSH 接続が失敗する場合（例: `ssh niu-admin@192.168.44.133` で失敗）
  - ゲスト側で `sudo firewall-cmd --add-service=ssh --permanent && sudo firewall-cmd --reload`
  - VMware の仮想NIC種別/ネットワークセグメントを確認（NAT/Bridged切替やIP重複の有無）
  - Windows側から `ping 192.168.44.133` で疎通確認、ARP衝突がないか確認

## 2. RockyLinux 初期設定
```bash
sudo dnf -y update
sudo dnf -y install epel-release
sudo dnf -y install git curl unzip firewalld policycoreutils-python-utils
sudo systemctl enable --now firewalld
# ユーザ方針: 既存の niu-admin を使用（必要に応じ sudo 権限付与）
sudo usermod -aG wheel niu-admin

# SELinux 状態確認（Enforcing推奨）
sestatus
```

## 3. 必要ミドルウェアの導入
### Node.js（AppStream 例）
```bash
sudo dnf module -y reset nodejs || true
sudo dnf module -y enable nodejs:20
sudo dnf -y install nodejs
node -v && npm -v
```

### MariaDB
```bash
sudo dnf -y install mariadb-server
sudo systemctl enable --now mariadb
sudo mysql_secure_installation
```

### Valkey（Redis互換）
- いずれかを選択
  1) パッケージが提供されていれば dnf で導入
  2) コンテナで起動（推奨・簡単）

```bash
# コンテナ例（podman）
sudo dnf -y install podman
sudo podman run -d --name valkey -p 6379:6379 docker.io/valkey/valkey:latest
# 再起動自動化（簡易）
echo -e "[Unit]\nDescription=Valkey Container\nAfter=network-online.target\n[Service]\nRestart=always\nExecStart=/usr/bin/podman start -a valkey\nExecStop=/usr/bin/podman stop -t 10 valkey\n[Install]\nWantedBy=multi-user.target" | sudo tee /etc/systemd/system/valkey.service
sudo systemctl enable --now valkey
```

### Apache（リバースプロキシ/TLS）
```bash
sudo dnf -y install httpd mod_ssl
sudo systemctl enable --now httpd
# HTTP/HTTPS 開放
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

`/etc/httpd/conf.d/app.conf` の例:
```apache
<VirtualHost *:443>
  ServerName your.domain.example
  SSLEngine on
  SSLCertificateFile /path/to/fullchain.pem
  SSLCertificateKeyFile /path/to/privkey.pem

  ProxyPreserveHost On
  ProxyPass / http://127.0.0.1:3000/
  ProxyPassReverse / http://127.0.0.1:3000/

  Protocols h2 http/1.1
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</VirtualHost>
```

SELinux（httpd→ネットワーク接続許可）:
```bash
sudo setsebool -P httpd_can_network_connect 1
```

## 3.1 アプリ配置先の作成（ローカルディスク）
```bash
sudo mkdir -p /opt/Kintone-Work
sudo chown -R $USER:$USER /opt/Kintone-Work
ls -la /opt/Kintone-Work
```
注意:
- 共有ストレージは使わず、VM内ローカルディスクに配置してください。
- Git操作はVM内で実施すると、Windows側ネットワークドライブ由来のロック問題を回避できます。

## 4. アプリ配置と起動（ゼロ保持）
```bash
# ローカル配置先へ移動
cd /opt/Kintone-Work

# GitHub から直接クローン（推奨）
git clone <your-repo-url> .

cd server
cp .env.example .env
npm install
npx prisma generate
npx prisma db push
npm run start &
```

systemd 化（任意）: `/etc/systemd/system/kintone-bridge.service`
```ini
[Unit]
Description=Kintone Generic Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/dev/apps/Kintone-Work/server
Environment=ZERO_RETENTION=true
Environment=MEMORY_ONLY_PIPELINE=true
Environment=RETRY_BUFFER=false
ExecStart=/usr/bin/node src/app.js
Restart=always
User=dev
Group=dev

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kintone-bridge
```

## 5. 疎通確認
```bash
curl -s http://127.0.0.1:3000/health | jq .
```
Apache 経由（TLS設定後）:
```bash
curl -sk https://your.domain.example/health | jq .
```

## 6. セキュリティとポリシー順守
- ZERO_RETENTION/MEMORY_ONLY_PIPELINE は `.env` または systemd の `Environment=` で強制
- GETで取得したKintoneデータはメモリ通過のみ（DB/Valkey/ファイルへ保存禁止）
- 添付ファイル機能は現状OFF。将来対応時もメモリStream処理のみ、ディスク書込み禁止
- ログはPIIスクラビング＆本文出力禁止

### VS Code（Windows）との連携
- 推奨は VS Code 拡張「Remote - SSH」でゲストに直接接続し、`/opt/Kintone-Work` を開く構成です。
- 端末操作は `ssh niu-admin@192.168.44.133` でも可能です（必要時のみ `sudo`）。
- NFS/SMB共有を介さないため、Gitオブジェクトのロックやパーミッション競合を回避できます。

## 7. 次のステップ
- MariaDB/Valkey 実装（監査/レジストリ/トークン）を差し替え
- Kintone Adapter を実API接続へ（APIトークン/OAuth）
- 監査DDLとマイグレーション導入（Prisma 予定）

---

## 設定ログ例（抜粋・参考）
> 実行結果は環境により異なります。PII/秘密情報は含めない出力例です。

SSH 疎通失敗時の確認:
```bash
ping 192.168.44.133
sudo firewall-cmd --list-services
ip a
```

ユーザ/UID/GID確認:
```bash
id niu-admin
id imaizumi
getent passwd imaizumi
getent group imaizumi
```

ローカル配置確認:
```bash
pwd
ls -la /opt/Kintone-Work
```

アプリ起動ログ（pino・JSON）:
```text
{"level":"info","time":1738590000000,"port":3000,"msg":"server started"}
{"level":"info","time":1738590001000,"method":"POST","path":"/default/sample-app/form/submit","ip":"192.168.44.1","ua":"curl/8.4.0","msg":"request"}
{"level":"info","time":1738590002000,"event":"audit","tenant":"default","app":"sample-app","action":"create","result":"success","kintone_record_id":"1001","kintone_revision":"2","msg":"audit recorded"}
```
