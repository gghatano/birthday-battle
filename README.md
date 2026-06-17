# 🎂 誕生日キャラ対決ゲーム

誕生日から有名人・キャラクターを選び、ラウンドごとのお題に沿って投票し合うパーティーゲーム。
仕様書 **v1.2** に準拠した単一 HTML ファイル実装です（ビルド不要・CDN のみ）。

## 特徴

- **単一ファイル** `index.html` — 開くだけで動作（Wikipedia 取得のためネットワークは必要）
- **Sync Adapter 抽象** — ゲームロジックはバックエンド API（`get/set/update/remove/subscribe/transaction/onDisconnect/serverTimestamp`）のみを呼ぶ。Firebase を直接触らない
- **LocalAdapter** — `localStorage`（真実の源）+ `BroadcastChannel`（タブ間リアルタイム）+ ハートビート（離脱検知）。外部依存ゼロ
- **FirebaseAdapter** — 同一 API を Realtime Database へ薄くマッピング（移行用）
- **権威クライアント方式** — 集計・スコア・状態遷移はホストのみが実行
- **Wikipedia 単一リクエスト** — `generator=categorymembers` で N+1 を回避

## ローカルで遊ぶ

```bash
# 任意の静的サーバで配信（BroadcastChannel は同一オリジン必須）
python3 -m http.server 8000
# → http://localhost:8000 を開く
```

擬似マルチプレイヤー（同一マシン・複数タブ）:

| プレイヤー | 開き方 |
|-----------|--------|
| 1（ホスト） | Chrome 通常タブ |
| 2 | Chrome シークレットウィンドウ |
| 3〜 | 別ブラウザ / 別タブ（同一 URL） |

> `file://` でも概ね動きますが、`BroadcastChannel` のタブ間同期を確実にするため静的サーバ配信を推奨します。

## Firebase へ移行する（§2.5 チェックリスト）

1. `index.html` 内の `firebaseConfig` に設定を投入し、`<head>` に Firebase SDK（CDN）を読み込む
2. URL に `?backend=firebase` を付けて起動（`BACKEND` フラグが切り替わる）
3. `serverTimestamp()` が `ServerValue.TIMESTAMP` を返すことを確認
4. `now()` が `.info/serverTimeOffset` 同期で server 時刻を返すことを確認（タイマー／離脱検知の時刻ズレ対策）
5. `onDisconnect()` が `ref.onDisconnect()` にマップされることを確認
6. round キーがプレフィックス付き（`r1` 形式・配列化しない）であることを再確認
7. `firebase-rules.json`（テスト用ルール）を投入
8. 結合テスト（§11.2）を別端末で実施

> ゲームロジックは Adapter API しか呼ばないため、コード変更は **フラグ切替と config 投入のみ** で済みます。

## アーキテクチャ（`index.html` 内）

| セクション | 役割 |
|-----------|------|
| 1. Sync Adapter | `createLocalAdapter` / `createFirebaseAdapter`。パスベースの共通 API |
| 2. Wiki | Wikipedia 日本語版 API（単一リクエスト取得・フィルタ・30件抽選） |
| 3. Session / UI | プレイヤー ID 永続化（`crypto.randomUUID`）、揮発的 UI 状態 |
| 4. ルーム操作 | 作成 / 参加 / 退出 / ホスト移譲 |
| 5. ホスト権威ロジック | 全員確定判定・締切集計・スコア加算・ラウンド進行（ホストのみ） |
| 6. レンダリング | TOP / ロビー / キャラ選択 / テーマ設定 / 投票 / 結果 / 最終結果 |

## データスキーマ

`rooms/{roomCode}` 配下に `host / status / totalRounds / currentRound / currentTheme / players / rounds` を保持。
round キーは RTDB の配列化を避けるため `r1`, `r2`, … のプレフィックス形式（仕様書 §6）。

## 得点ルール（§8）

- 最多得票が **2票以上** の場合のみ、最多得票者に +1（タイは全員 +1）
- 全員ばらけて最多 = 1票 のときは加点しない
- `pointAwarded` フラグで集計の冪等性を担保

## テスト

### 自動テスト（Node・依存ゼロ）

`index.html` の `<script>` を抽出し、最小モック下で実コードを評価して検証します。

```bash
npm test          # adapter + game をまとめて実行
# 個別:
node test/adapter.test.js   # Sync Adapter 契約 (S-01〜07 + transaction)
node test/game.test.js      # 集計・加点・冪等性 (V-03〜08) / 参加バリデーション (R-03,04,09)
```

| ファイル | カバー範囲 |
|---------|-----------|
| `test/adapter.test.js` | S-01 set→get / S-02 浅いマージ・多パス / S-03 null削除 / S-04 subscribe / S-05 子0件votes / S-06 serverTimestamp / S-07 round非配列化 / transaction |
| `test/game.test.js` | V-03〜08（集計・加点・冪等性）/ 切断者除外 / ホスト移譲（ELECT-1〜3）/ R-02,R-03,R-04,R-08,R-09,R-09b（参加・復帰・満員）|

### 手動テスト

S-08（onDisconnect）、W-*（Wikipedia）、I-*（結合）は実ブラウザ/ネットワーク依存のため手動で実施。
`window.BB`（`DB` / `Wiki` / `UI` / `Session` / `host` / `helpers`）をコンソールから操作して確認できます。

## 既知の制約

- Wikipedia 日本語版依存 / 認証なし / ルーム TTL 未実装
- LocalAdapter は同一マシン前提（真の分散同時性は持たない）
- LocalAdapter にはセキュリティルールが無く、host-only 規律は実装責任で担保
