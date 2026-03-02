schemasディレクトリの使い方（汎用Kintone連携）

目的：任意のKintoneアプリを後から登録して即フォーム/ビューを提供するための雛形。

ファイル一覧：
- form.schema.template.json：入力フォームの項目定義とKintoneフィールド対応を記述。
- view.schema.template.json：一覧/詳細/検索/ソート/エクスポートの定義を記述。
- app.registry.template.json：テナント/アプリ登録情報（ドメイン、appId、認証、トークン用フィールド）を記述。

手順（概要）：
1) app.registry.template.json をコピーし、あなたのKintoneドメイン/appId/認証方式を設定。
2) Kintone側でトークン用フィールド（例：token、token_expiry、editable_flag）を用意。
3) form.schema.template.json をコピーし、kintoneField に各フィールドコードを対応付け。
4) view.schema.template.json をコピーし、表示列のkintoneFieldやフィルタ条件を設定。
5) 管理UI/APIから、AppRegistry/SchemaRegistryへ登録。
6) ランダムURL発行（TokenService）→ユーザへ配布→submit/view/editがゼロ保持で動作。

注意：
- ゼロ保持前提のため、サーバ側に本文データは保存しない設計。
- 再送保証が必要な場合のみ暗号化短期保持（TTL）を有効化。
- フィールドコードはKintone側の設定と一致させること。
