/*
 * ゲームロジック テスト (仕様書 §11.1: 得点 V-04〜08 / ルーム管理 R-03,R-04,R-09)
 *
 * index.html の <script> を抽出し、最小 DOM/ブラウザ API モックの下で評価して
 * ホスト権威ロジック (集計・加点・冪等性) と参加バリデーションを実コードで検証する。
 *
 * 実行: node test/game.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- 最小モック (adapter.test.js と同等) --------------------------------
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
function fakeEl() {
  return new Proxy({}, {
    get: (t, p) => (p in t ? t[p] : (p === 'value' ? '' : undefined)),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}
const sandbox = {
  console, URLSearchParams, URL, JSON, Math, Object, Array, Date, Promise,
  localStorage: makeStorage(),
  BroadcastChannel: class { postMessage() {} close() {} },
  addEventListener: () => {}, removeEventListener: () => {},
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  fetch: () => Promise.reject(new Error('no network in test')),
  location: { search: '' },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) },
  document: {
    getElementById: () => fakeEl(), querySelector: () => null, querySelectorAll: () => [],
    createElement: () => fakeEl(), body: { appendChild: () => {} },
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox);

const BB = sandbox.BB;
const { DB, UI, Session, host, helpers } = BB;

// ---- テストランナー ------------------------------------------------------
let pass = 0, fail = 0;
function check(id, desc, cond) {
  if (cond) { pass++; console.log(`  ✓ ${id} ${desc}`); }
  else { fail++; console.error(`  ✗ ${id} ${desc}`); }
}

// 指定の票で1ラウンドをセットアップして集計する補助
// players: { id: {votesFor} }  votes: { voterId: targetId }
async function runTally({ code, players, votes, endsAt, connectedIds }) {
  const now = Date.now();
  const pObj = {};
  let i = 0;
  for (const id of players) {
    pObj[id] = {
      name: id, joinedAt: now + (i++), connected: connectedIds ? connectedIds.includes(id) : true,
      lastSeen: now, score: 0, characterReady: true,
      character: { title: 'C-' + id, description: 'd', thumbnail: null }
    };
  }
  const room = {
    host: players[0], status: 'voting', totalRounds: 5, currentRound: 1,
    currentTheme: '一番強そう', createdAt: now,
    players: pObj,
    rounds: { r1: { theme: '一番強そう', endsAt: endsAt, votes: votes } }
  };
  DB.set('rooms/' + code, room);
  // ホストコンテキストを再現
  UI.roomCode = code;
  UI.room = room;
  Session.playerID = players[0]; // host
  await host.maybeTally(room);
  return DB.get('rooms/' + code);
}
function scoreOf(room, id) { return room.players[id].score || 0; }
function resultOf(room, id) { return (room.rounds.r1.results || {})[id] || { voteCount: 0, pointAwarded: false }; }

(async () => {
  console.log('ゲームロジック テスト (集計・加点・冪等性 / 参加バリデーション)\n');

  // V-05 単独最多 (2票以上) → +1
  {
    const r = await runTally({
      code: 'V05', players: ['A', 'B', 'C'],
      votes: { A: 'B', C: 'B', B: 'A' }, endsAt: Date.now() + 60000
    });
    check('V-05', '単独最多(2票)に +1', scoreOf(r, 'B') === 1 && scoreOf(r, 'A') === 0 && resultOf(r, 'B').pointAwarded);
  }

  // V-06 タイ (複数同票・2票以上) → 全員 +1
  {
    const r = await runTally({
      code: 'V06', players: ['A', 'B', 'C', 'D'],
      votes: { A: 'B', C: 'B', B: 'A', D: 'A' }, endsAt: Date.now() + 60000
    });
    check('V-06', 'タイ(各2票)の全員に +1', scoreOf(r, 'A') === 1 && scoreOf(r, 'B') === 1 && scoreOf(r, 'C') === 0);
  }

  // V-07 全員1票ずつ (最多=1) → 加点なし (§8)
  {
    const r = await runTally({
      code: 'V07', players: ['A', 'B', 'C'],
      votes: { A: 'B', B: 'C', C: 'A' }, endsAt: Date.now() + 60000
    });
    check('V-07', '最多=1票では加点なし', scoreOf(r, 'A') === 0 && scoreOf(r, 'B') === 0 && scoreOf(r, 'C') === 0);
  }

  // V-04 タイムアウト時に未投票をランダム補完
  {
    const past = Date.now() - 1000; // 既に締切
    const r = await runTally({
      code: 'V04', players: ['A', 'B', 'C'],
      votes: { A: 'B' }, endsAt: past   // B,C 未投票
    });
    const v = r.rounds.r1.votes;
    const filled = ['A', 'B', 'C'].every(id => v[id] && v[id] !== id);
    check('V-04', 'タイムアウトで未投票を自分以外へ補完', filled && r.status === 'round_result');
  }

  // 全員投票完了で締切前でも集計され round_result へ (V-03)
  {
    const r = await runTally({
      code: 'V03', players: ['A', 'B'],
      votes: { A: 'B', B: 'A' }, endsAt: Date.now() + 60000
    });
    check('V-03', '全員投票完了で結果画面へ遷移', r.status === 'round_result');
  }

  // 締切前で未投票が残れば集計しない
  {
    const r = await runTally({
      code: 'WAIT', players: ['A', 'B', 'C'],
      votes: { A: 'B' }, endsAt: Date.now() + 60000
    });
    check('WAIT', '締切前・未投票ありでは集計しない', !r.rounds.r1.results && r.status === 'voting');
  }

  // V-08 集計の冪等性: 再実行で二重加算しない
  {
    const r1 = await runTally({
      code: 'V08', players: ['A', 'B', 'C'],
      votes: { A: 'B', C: 'B', B: 'A' }, endsAt: Date.now() + 60000
    });
    const after1 = scoreOf(r1, 'B');
    // DB から再取得して再集計 (results 済みなのでスキップされるべき)
    const room2 = DB.get('rooms/V08');
    UI.room = room2;
    await host.maybeTally(room2);
    const r2 = DB.get('rooms/V08');
    check('V-08', '再集計で二重加算しない (冪等)', after1 === 1 && scoreOf(r2, 'B') === 1);
  }

  // 切断プレイヤーは集計対象外 (connected のみで判定)
  {
    const r = await runTally({
      code: 'DISC', players: ['A', 'B', 'C'],
      votes: { A: 'B', B: 'A' }, endsAt: Date.now() + 60000,
      connectedIds: ['A', 'B']   // C は切断 → 全員(A,B)投票済みとみなし集計
    });
    check('DISC', '切断者を除いて全員投票完了判定', r.status === 'round_result');
  }

  // ---- ホスト移譲 (review M2: ホスト不在を全クライアントが検知し自己昇格) ----
  // 旧ホストが stale。健在で joinedAt 最先頭のプレイヤーが自己昇格する。
  {
    const now = Date.now();
    DB.set('rooms/ELECT', {
      host: 'H', status: 'voting', currentRound: 1, totalRounds: 5,
      players: {
        H: { name: 'H', joinedAt: 1, connected: true, lastSeen: now - 999999, score: 0 }, // stale
        B: { name: 'B', joinedAt: 2, connected: true, lastSeen: now, score: 0 },           // 最先頭健在
        C: { name: 'C', joinedAt: 3, connected: true, lastSeen: now, score: 0 }
      }
    });
    UI.roomCode = 'ELECT';
    // B 視点: 自分が最先頭健在 → 昇格する
    Session.playerID = 'B';
    await host.electHostIfNeeded(DB.get('rooms/ELECT'));
    const afterB = DB.get('rooms/ELECT');
    check('ELECT-1', '健在最先頭(B)が旧ホスト不在を検知し昇格', afterB.host === 'B');

    // C 視点 (B 昇格前を想定し host を H に戻す): 自分は最先頭でない → 昇格しない
    DB.set('rooms/ELECT/host', 'H');
    Session.playerID = 'C';
    await host.electHostIfNeeded(DB.get('rooms/ELECT'));
    check('ELECT-2', '非最先頭(C)は昇格しない', DB.get('rooms/ELECT').host === 'H');
  }

  // ホスト健在なら昇格は起きない
  {
    const now = Date.now();
    DB.set('rooms/ELECT2', {
      host: 'H', status: 'voting', currentRound: 1, totalRounds: 5,
      players: {
        H: { name: 'H', joinedAt: 1, connected: true, lastSeen: now, score: 0 }, // 健在
        B: { name: 'B', joinedAt: 2, connected: true, lastSeen: now, score: 0 }
      }
    });
    UI.roomCode = 'ELECT2';
    Session.playerID = 'B';
    await host.electHostIfNeeded(DB.get('rooms/ELECT2'));
    check('ELECT-3', 'ホスト健在時は移譲しない', DB.get('rooms/ELECT2').host === 'H');
  }

  // ---- ルーム管理バリデーション ----
  // R-03 存在しないコード
  {
    const res = await BB.rooms.joinRoom('Taro', 'NOPE99');
    check('R-03', '存在しないコードはエラー', res.error && /見つかり/.test(res.error));
  }

  // R-04 ゲーム中ルーム
  {
    DB.set('rooms/INGAME', { host: 'x', status: 'voting', players: { x: { name: 'x', connected: true, joinedAt: 1 } } });
    const res = await BB.rooms.joinRoom('Taro', 'INGAME');
    check('R-04', 'ゲーム中ルームはエラー', res.error && /ゲーム中/.test(res.error));
  }

  // R-09 満員 (10人) で11人目拒否
  {
    const players = {};
    for (let i = 0; i < 10; i++) players['p' + i] = { name: 'p' + i, connected: true, joinedAt: i };
    DB.set('rooms/FULL12', { host: 'p0', status: 'waiting', players });
    const res = await BB.rooms.joinRoom('Taro', 'FULL12');
    check('R-09', '満員(10人)で11人目を拒否', res.error && /満員/.test(res.error));
  }

  console.log(`\n結果: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
