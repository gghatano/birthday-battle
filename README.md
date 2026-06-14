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
4. `onDisconnect()` が `ref.onDisconnect()` にマップされることを確認
5. round キーがプレフィックス付き（`r1` 形式・配列化しない）であることを再確認
6. `firebase-rules.json`（テスト用ルール）を投入
7. 結合テスト（§11.2）を別端末で実施

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

## 手動テスト

仕様書 §11 のテスト計画に対応。`window.BB`（`DB` / `Wiki` / `UI` / `Session`）をコンソールから操作して
Sync Adapter テスト（S-01〜08）等を確認できます。

## 既知の制約

- Wikipedia 日本語版依存 / 認証なし / ルーム TTL 未実装
- LocalAdapter は同一マシン前提（真の分散同時性は持たない）
- LocalAdapter にはセキュリティルールが無く、host-only 規律は実装責任で担保
