/*
 * Sync Adapter 契約テスト (仕様書 §11.1 S-01〜07)
 *
 * index.html の <script> を抽出し、最小限の DOM/ブラウザ API モックの下で評価して
 * LocalAdapter の実挙動を検証する（コードの二重実装を避ける）。
 *
 * 実行: node test/adapter.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- 最小モック ---------------------------------------------------------
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
  console,
  URLSearchParams,
  URL,
  JSON,
  Math,
  Object,
  Array,
  Date,
  localStorage: makeStorage(),
  BroadcastChannel: class { postMessage() {} close() {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  fetch: () => Promise.reject(new Error('no network in test')),
  location: { search: '' },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) },
  document: {
    getElementById: () => fakeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeEl(),
    body: { appendChild: () => {} },
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(script, sandbox);

const DB = sandbox.BB.DB;

// ---- テストランナー ------------------------------------------------------
let pass = 0, fail = 0;
function check(id, desc, cond) {
  if (cond) { pass++; console.log(`  ✓ ${id} ${desc}`); }
  else { fail++; console.error(`  ✗ ${id} ${desc}`); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

console.log('Sync Adapter (LocalAdapter) 契約テスト\n');

// S-01 set -> get
DB.set('rooms/T/a', 123);
check('S-01', 'set→get で書いた値が読める', DB.get('rooms/T/a') === 123);

// S-02 update 浅いマージ + 多パス
DB.set('rooms/T/obj', { x: 1, y: 2 });
DB.update('rooms/T/obj', { y: 9, z: 3 });
check('S-02a', 'update: 指定キー更新・他キー保持', eq(DB.get('rooms/T/obj'), { x: 1, y: 9, z: 3 }));
DB.update('rooms/T', { 'multi/p1': 'A', 'multi/p2': 'B' });
check('S-02b', 'update: 多パス {"a/b":..} 対応', DB.get('rooms/T/multi/p1') === 'A' && DB.get('rooms/T/multi/p2') === 'B');

// S-03 remove / null 書込
DB.set('rooms/T/del', 'bye');
DB.remove('rooms/T/del');
check('S-03a', 'remove でノード消滅 (get=null)', DB.get('rooms/T/del') === null);
DB.set('rooms/T/del2', 'x');
DB.set('rooms/T/del2', null);
check('S-03b', 'null 書込で削除', DB.get('rooms/T/del2') === null);

// S-04 subscribe で変更通知
let fired = null;
const unsub = DB.subscribe('rooms/T/sub', (v) => { fired = v; });
DB.set('rooms/T/sub', 'hello');
check('S-04', 'subscribe が書込で発火', fired === 'hello');
unsub();
DB.set('rooms/T/sub', 'after');
check('S-04b', 'unsubscribe 後は発火しない', fired === 'hello');

// S-05 子0件の votes は「無い=0票」扱い
DB.set('rooms/T/rounds/r1/theme', '一番強そう'); // votes 子なし
const votes = DB.get('rooms/T/rounds/r1/votes');
check('S-05', '子0件の votes は null（=0票扱い）', votes === null);

// S-06 serverTimestamp はローカルで数値 / endsAt 計算成立
const ts = DB.serverTimestamp();
check('S-06', 'serverTimestamp が数値で返り endsAt 計算可', typeof ts === 'number' && (ts + 60000) > ts);

// S-07 round キーは r1 形式で配列化しない
DB.set('rooms/T/rounds/r1/x', 1);
DB.set('rooms/T/rounds/r2/x', 2);
const rounds = DB.get('rooms/T/rounds');
check('S-07', 'rounds が配列化せずオブジェクト', !Array.isArray(rounds) && eq(Object.keys(rounds).sort(), ['r1', 'r2']));

// transaction: read-modify-write
DB.set('rooms/T/score', 5);
DB.transaction('rooms/T/score', (cur) => (cur || 0) + 3);
check('TXN', 'transaction で原子的更新', DB.get('rooms/T/score') === 8);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
