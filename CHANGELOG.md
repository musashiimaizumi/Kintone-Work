# Changelog

## 2026-03-04

### Added
- 管理者ID/パスワード方式の認証基盤を追加（セッション管理、`/admin/auth/login|logout|me`）。
- 初期セットアップAPI `POST /setup/bootstrap` を追加（初期テナント・初期管理者・互換用トークン生成）。
- 管理UIを外部JS構成へ刷新（CSP互換）。
- 管理者アカウント管理機能（追加・一覧表示）を管理UIに追加。
- テナント一覧API `GET /admin/tenants` と、管理UI上のテナントカード表示を追加。
- 全テナント横断アプリ一覧API `GET /admin/apps` を追加。
- テナント削除API `DELETE /admin/tenants/:tenant` を追加（ローカルDBのみ削除、Kintone側は非破壊）。
- ユーザ入力向けフォーム画面 `/:tenant/:app/form` と動的フォームクライアントを追加。
- レコード一覧画面 `/:tenant/:app/viewer/ui` と一覧データAPI `/:tenant/:app/viewer/data` を追加。
- レコード表示・編集画面 `/:tenant/:app/record/ui` を追加。
- レコードID指定API `GET|PUT /:tenant/:app/record/id/:recordId` を追加。

### Changed
- 管理UIのリンク導線を強化（フォーム/一覧/レコード画面へ遷移）。
- アプリ一覧を JSON 生表示から「1レコード1行」の表形式表示へ改善（viewer）。
- KintoneサービスにID指定取得/更新ロジックを追加（`kintoneGetById`, `kintoneUpdateById`）。
- 既存ルートの監査ログ連携を継続しつつ、一覧/参照/更新の成功・失敗記録を拡張。

### Fixed
- `全件読み込み` が表示されない問題を解消（UI側イベント/表示処理を修正）。
- `Failed to fetch` 問題を解消（CSPでブロックされるインラインscriptを廃止し、`data-*` 属性で文脈を受け渡し）。
- DOM要素未存在時のイベント登録で落ちる実行時エラーを回避。
- APIレスポンスが空配列/想定外形式のときの一覧描画エラーを回避。

### Docs
- 管理UI運用手順書 `server/ADMIN_UI_MANUAL.md` を新規追加。
- 管理UIの最新フロー（ログイン、一覧、リンク遷移、テナント削除、フォーム/一覧/編集画面）を記載。
