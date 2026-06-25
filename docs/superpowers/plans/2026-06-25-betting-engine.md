# Betting Engine + Economy Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-authoritative betting core — place bets with frozen odds, hold a per-player virtual balance, and settle bets automatically from a finished game's board — persisted in Postgres.

**Architecture:** Pure money/bet logic (no DB, fully unit-tested) on top of the proven `src/markets.js` board engine, with a thin never-throw Postgres layer mirroring MemeDrop's `db.js` pattern. A CLI `demo-bet` command proves the whole loop end-to-end on a real ranked game.

**Tech Stack:** Node 20+ (CommonJS), `pg` for Postgres, `jest` for tests. No web framework yet (this plan is the engine, not the API).

## Global Constraints

- Node `>=20.0.0` (matches `package.json`); global `fetch`, no extra HTTP deps.
- Reuse `src/markets.js` (`buildBoard`, `settleParlay`) — do NOT duplicate market logic.
- DB layer must NEVER throw: with no `DATABASE_URL` it no-ops via a sentinel (mirror MemeDrop `server/db.js`).
- All money is integer Clout. Starting balance: `1000`.
- Odds are FROZEN into the bet record at placement; settlement pays `round(stake × frozenOdds)`.
- French is fine in user-facing CLI strings; code identifiers and comments in English.

---

### Task 1: Project setup (deps + test runner)

**Files:**
- Modify: `package.json`
- Create: `server/tests/smoke.test.js`

**Interfaces:**
- Produces: `npm test` runs jest over `server/tests/`.

- [ ] **Step 1: Write a smoke test**

```js
// server/tests/smoke.test.js
test('jest runs', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 2: Update package.json (add deps + test script)**

```json
{
  "name": "lolbet-proto",
  "version": "0.0.1",
  "private": true,
  "description": "De-risk prototype + betting engine: auto-settle bets from real LoL games via the Riot API.",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "backtest": "node src/index.js backtest",
    "watch": "node src/index.js watch",
    "live": "node src/index.js live",
    "demo-bet": "node src/index.js demo-bet",
    "test": "jest"
  },
  "dependencies": { "pg": "^8.11.3" },
  "devDependencies": { "jest": "^29.7.0" }
}
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: `node_modules/` created, `pg` and `jest` present.

- [ ] **Step 4: Run the smoke test**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json server/tests/smoke.test.js
git commit -m "chore: add pg + jest, test script"
```

---

### Task 2: Pure money rules (`economy.js`)

**Files:**
- Create: `server/economy.js`
- Test: `server/tests/economy.test.js`

**Interfaces:**
- Produces:
  - `START_BALANCE: number` (1000)
  - `canBet(balance: number, stake: number) -> {ok: true} | {ok: false, error: string}`
  - `payout(stake: number, odds: number, won: boolean) -> number` (round(stake×odds) if won, else 0)

- [ ] **Step 1: Write the failing tests**

```js
// server/tests/economy.test.js
const { START_BALANCE, canBet, payout } = require('../economy');

test('START_BALANCE is 1000', () => {
  expect(START_BALANCE).toBe(1000);
});

test('canBet rejects non-positive and non-finite stakes', () => {
  expect(canBet(1000, 0)).toEqual({ ok: false, error: 'stake-invalid' });
  expect(canBet(1000, -5)).toEqual({ ok: false, error: 'stake-invalid' });
  expect(canBet(1000, NaN)).toEqual({ ok: false, error: 'stake-invalid' });
});

test('canBet rejects a stake above balance', () => {
  expect(canBet(50, 100)).toEqual({ ok: false, error: 'insufficient' });
});

test('canBet accepts a valid stake', () => {
  expect(canBet(100, 100)).toEqual({ ok: true });
  expect(canBet(100, 25)).toEqual({ ok: true });
});

test('payout pays round(stake×odds) on a win, 0 on a loss', () => {
  expect(payout(50, 1.9, true)).toBe(95);
  expect(payout(50, 1.85, true)).toBe(93); // 92.5 rounds to 93
  expect(payout(50, 1.9, false)).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest server/tests/economy.test.js`
Expected: FAIL ("Cannot find module '../economy'").

- [ ] **Step 3: Implement `economy.js`**

```js
// server/economy.js
// Pure money rules — no DB, no side effects. Integer Clout.

const START_BALANCE = 1000;

// Can `balance` cover `stake`? Stake must be a positive finite number.
function canBet(balance, stake) {
  if (!Number.isFinite(stake) || stake <= 0) return { ok: false, error: 'stake-invalid' };
  if (stake > balance) return { ok: false, error: 'insufficient' };
  return { ok: true };
}

// Winnings for a settled bet (gross, includes the returned stake).
function payout(stake, odds, won) {
  return won ? Math.round(stake * odds) : 0;
}

module.exports = { START_BALANCE, canBet, payout };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest server/tests/economy.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/economy.js server/tests/economy.test.js
git commit -m "feat: pure money rules (canBet, payout)"
```

---

### Task 3: Pure bet lifecycle (`bets.js`)

**Files:**
- Create: `server/bets.js`
- Test: `server/tests/bets.test.js`

**Interfaces:**
- Consumes: `buildBoard`, `settleParlay` from `../src/markets`; `payout` from `./economy`.
- Produces:
  - `makeSingle({player, board, marketTitle, side, stake}) -> bet` where `bet = {player, type:'single', marketTitle, side, stake, odds}` (odds FROZEN from the board).
  - `settleSingle(bet, board) -> {won: boolean, payout: number}`
  - `makeParlay({player, board, picks, stake}) -> bet` where `bet = {player, type:'parlay', picks:[{marketTitle, side, odds}], stake}`.
  - `settleParlayBet(bet, board) -> {won: boolean, payout: number, combinedOdds: number}`
  - Board market shape (from `buildBoard`): `{title, yes:{label,odds,won}, no:{label,odds,won}}`; `side` is `'yes'|'no'`.

- [ ] **Step 1: Write the failing tests**

```js
// server/tests/bets.test.js
const { makeSingle, settleSingle, makeParlay, settleParlayBet } = require('../bets');

// Minimal fake board mirroring buildBoard's output shape.
const board = [
  { title: 'Résultat (Galio)', yes: { label: 'WIN', odds: 2.0, won: false }, no: { label: 'LOSE', odds: 1.6, won: true } },
  { title: 'Kills',            yes: { label: '+ de 7.5', odds: 3.0, won: false }, no: { label: '- de 7.5', odds: 1.3, won: true } },
];

test('makeSingle freezes the odds from the chosen side', () => {
  const bet = makeSingle({ player: 'gd', board, marketTitle: 'Résultat (Galio)', side: 'yes', stake: 50 });
  expect(bet).toEqual({ player: 'gd', type: 'single', marketTitle: 'Résultat (Galio)', side: 'yes', stake: 50, odds: 2.0 });
});

test('makeSingle throws on unknown market or bad side', () => {
  expect(() => makeSingle({ player: 'gd', board, marketTitle: 'Nope', side: 'yes', stake: 50 })).toThrow();
  expect(() => makeSingle({ player: 'gd', board, marketTitle: 'Kills', side: 'maybe', stake: 50 })).toThrow();
});

test('settleSingle pays a winning side and zeroes a losing side', () => {
  const win = makeSingle({ player: 'gd', board, marketTitle: 'Résultat (Galio)', side: 'no', stake: 50 }); // LOSE won
  expect(settleSingle(win, board)).toEqual({ won: true, payout: 80 }); // 50 * 1.6
  const lose = makeSingle({ player: 'gd', board, marketTitle: 'Kills', side: 'yes', stake: 50 }); // over lost
  expect(settleSingle(lose, board)).toEqual({ won: false, payout: 0 });
});

test('makeParlay freezes each leg odds; settleParlayBet multiplies and is all-or-nothing', () => {
  const par = makeParlay({ player: 'gd', board, stake: 50, picks: [
    { marketTitle: 'Résultat (Galio)', side: 'no' }, // 1.6, won
    { marketTitle: 'Kills', side: 'no' },            // 1.3, won
  ] });
  expect(par.picks).toEqual([
    { marketTitle: 'Résultat (Galio)', side: 'no', odds: 1.6 },
    { marketTitle: 'Kills', side: 'no', odds: 1.3 },
  ]);
  const r = settleParlayBet(par, board);
  expect(r.won).toBe(true);
  expect(r.combinedOdds).toBeCloseTo(2.08, 2); // 1.6 * 1.3
  expect(r.payout).toBe(104); // round(50 * 2.08)
});

test('settleParlayBet loses if any leg loses', () => {
  const par = makeParlay({ player: 'gd', board, stake: 50, picks: [
    { marketTitle: 'Résultat (Galio)', side: 'no' }, // won
    { marketTitle: 'Kills', side: 'yes' },           // lost
  ] });
  const r = settleParlayBet(par, board);
  expect(r.won).toBe(false);
  expect(r.payout).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest server/tests/bets.test.js`
Expected: FAIL ("Cannot find module '../bets'").

- [ ] **Step 3: Implement `bets.js`**

```js
// server/bets.js
// Pure bet lifecycle on a board produced by src/markets.buildBoard. Odds are
// frozen into the bet at placement; settlement reads the won-flag off the board.

const { settleParlay } = require('../src/markets');
const { payout } = require('./economy');

function findMarket(board, title) {
  const m = board.find((x) => x.title === title);
  if (!m) throw new Error(`Marché inconnu: ${title}`);
  return m;
}

function sideOf(market, side) {
  if (side !== 'yes' && side !== 'no') throw new Error(`Côté invalide: ${side}`);
  return market[side];
}

function makeSingle({ player, board, marketTitle, side, stake }) {
  const sel = sideOf(findMarket(board, marketTitle), side);
  return { player, type: 'single', marketTitle, side, stake, odds: sel.odds };
}

function settleSingle(bet, board) {
  const won = sideOf(findMarket(board, bet.marketTitle), bet.side).won;
  return { won, payout: payout(bet.stake, bet.odds, won) };
}

function makeParlay({ player, board, picks, stake }) {
  const legs = picks.map((p) => {
    const sel = sideOf(findMarket(board, p.marketTitle), p.side);
    return { marketTitle: p.marketTitle, side: p.side, odds: sel.odds };
  });
  return { player, type: 'parlay', picks: legs, stake };
}

function settleParlayBet(bet, board) {
  const legs = bet.picks.map((p) => ({
    odds: p.odds,
    won: sideOf(findMarket(board, p.marketTitle), p.side).won,
  }));
  const r = settleParlay(legs, bet.stake);
  return { won: r.allWon, payout: r.payout, combinedOdds: r.combinedOdds };
}

module.exports = { makeSingle, settleSingle, makeParlay, settleParlayBet };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest server/tests/bets.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/bets.js server/tests/bets.test.js
git commit -m "feat: pure bet lifecycle (single + parlay, frozen odds)"
```

---

### Task 4: Postgres layer (`db.js`)

**Files:**
- Create: `server/db.js`
- Test: `server/tests/db.test.js`

**Interfaces:**
- Produces:
  - `enabled: boolean` (true iff `DATABASE_URL` set)
  - `query(text, params) -> Promise` (throws `EconomyDisabledError` when disabled)
  - `init() -> Promise<boolean>` (creates tables; returns false when disabled)
  - `EconomyDisabledError` class

- [ ] **Step 1: Write the failing test (disabled fallback — hermetic, no real DB)**

```js
// server/tests/db.test.js
describe('db (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('is disabled and query throws the sentinel; init returns false', async () => {
    const db = require('../db');
    expect(db.enabled).toBe(false);
    await expect(db.query('SELECT 1')).rejects.toBeInstanceOf(db.EconomyDisabledError);
    await expect(db.init()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest server/tests/db.test.js`
Expected: FAIL ("Cannot find module '../db'").

- [ ] **Step 3: Implement `db.js` (mirror MemeDrop's pattern)**

```js
// server/db.js
// Thin Postgres layer. No DATABASE_URL → disabled: query() throws a sentinel so
// the store wrappers fall back to safe no-ops. SSL relaxed for Railway.

const DATABASE_URL = process.env.DATABASE_URL;
const enabled = !!DATABASE_URL;
let pool = null;

if (enabled) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.on('error', (err) => console.error('[db] pool error:', err.message));
}

class EconomyDisabledError extends Error {
  constructor() { super('db disabled (no DATABASE_URL)'); this.name = 'EconomyDisabledError'; }
}

async function query(text, params) {
  if (!enabled) throw new EconomyDisabledError();
  return pool.query(text, params);
}

async function init() {
  if (!enabled) return false;
  await query(`
    CREATE TABLE IF NOT EXISTS players (
      username   TEXT PRIMARY KEY,
      balance    INTEGER NOT NULL DEFAULT 1000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS bets (
      id         BIGSERIAL PRIMARY KEY,
      username   TEXT NOT NULL,
      match_id   TEXT NOT NULL,
      bet        JSONB NOT NULL,
      stake      INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      payout     INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS ledger (
      id         BIGSERIAL PRIMARY KEY,
      username   TEXT NOT NULL,
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      ref        TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  return true;
}

module.exports = { query, init, enabled, EconomyDisabledError };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest server/tests/db.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/tests/db.test.js
git commit -m "feat: postgres layer (players/bets/ledger schema, disabled fallback)"
```

---

### Task 5: Store wrappers (`store.js`)

**Files:**
- Create: `server/store.js`
- Test: `server/tests/store.test.js`

**Interfaces:**
- Consumes: `db` (query/init/EconomyDisabledError), `economy.START_BALANCE`.
- Produces (all async, NEVER throw):
  - `getBalance(username) -> Promise<number>` (auto-creates player at START_BALANCE; returns START_BALANCE on DB error)
  - `placeBet(username, matchId, bet) -> Promise<{ok: boolean, balance: number|null, error?: string}>` (checks funds via `canBet`, debits stake, inserts bet row + ledger entry atomically)
  - `settleBets(matchId, board) -> Promise<{settled: number}>` (settles all open bets for a match: credits payouts, marks rows, writes ledger; 0 on DB error)

- [ ] **Step 1: Write the failing test (disabled fallback)**

```js
// server/tests/store.test.js
describe('store (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('falls back safely when DB is disabled', async () => {
    const store = require('../store');
    await expect(store.getBalance('gd')).resolves.toBe(1000);
    const r = await store.placeBet('gd', 'EUW1_1', { stake: 50, odds: 2 });
    expect(r.ok).toBe(false);
    await expect(store.settleBets('EUW1_1', [])).resolves.toEqual({ settled: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest server/tests/store.test.js`
Expected: FAIL ("Cannot find module '../store'").

- [ ] **Step 3: Implement `store.js`**

```js
// server/store.js
// DB-touching wrappers. NEVER throw — on any DB error (incl. disabled) they
// return a safe fallback. Money changes go through a transaction + ledger.

const db = require('./db');
const { START_BALANCE, canBet } = require('./economy');
const { settleSingle, settleParlayBet } = require('./bets');

function isDisabled(err) { return err instanceof db.EconomyDisabledError; }

async function getBalance(username) {
  try {
    const res = await db.query(
      `INSERT INTO players (username) VALUES ($1)
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
       RETURNING balance`,
      [username]
    );
    return res.rows[0].balance;
  } catch (err) {
    if (!isDisabled(err)) console.error('[store] getBalance:', err.message);
    return START_BALANCE;
  }
}

// Debit a stake and record the bet atomically. `bet` is a bets.js record (has
// .stake; single or parlay shape) — stored as JSONB.
async function placeBet(username, matchId, bet) {
  try {
    const balance = await getBalance(username);
    const check = canBet(balance, bet.stake);
    if (!check.ok) return { ok: false, balance, error: check.error };

    const client = await db.query.bind(null); // use single queries in a tx below
    await db.query('BEGIN');
    const upd = await db.query(
      `UPDATE players SET balance = balance - $2, updated_at = now()
       WHERE username = $1 RETURNING balance`,
      [username, bet.stake]
    );
    await db.query(
      `INSERT INTO bets (username, match_id, bet, stake) VALUES ($1, $2, $3::jsonb, $4)`,
      [username, matchId, JSON.stringify(bet), bet.stake]
    );
    await db.query(
      `INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'bet-stake', $3)`,
      [username, -bet.stake, matchId]
    );
    await db.query('COMMIT');
    return { ok: true, balance: upd.rows[0].balance };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[store] placeBet:', err.message);
    return { ok: false, balance: null, error: 'db' };
  }
}

// Settle all open bets for a finished match against its board.
async function settleBets(matchId, board) {
  try {
    const open = await db.query(
      `SELECT id, username, bet FROM bets WHERE match_id = $1 AND status = 'open'`,
      [matchId]
    );
    let settled = 0;
    for (const row of open.rows) {
      const bet = typeof row.bet === 'string' ? JSON.parse(row.bet) : row.bet;
      const result = bet.type === 'parlay' ? settleParlayBet(bet, board) : settleSingle(bet, board);
      await db.query('BEGIN');
      await db.query(
        `UPDATE bets SET status = $2, payout = $3 WHERE id = $1`,
        [row.id, result.won ? 'won' : 'lost', result.payout]
      );
      if (result.payout > 0) {
        await db.query(
          `UPDATE players SET balance = balance + $2, updated_at = now() WHERE username = $1`,
          [row.username, result.payout]
        );
        await db.query(
          `INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'bet-payout', $3)`,
          [row.username, result.payout, matchId]
        );
      }
      await db.query('COMMIT');
      settled += 1;
    }
    return { settled };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[store] settleBets:', err.message);
    return { settled: 0 };
  }
}

module.exports = { getBalance, placeBet, settleBets };
```

> Note: the `client` line is intentionally removed in implementation — delete it; transactions here use sequential `db.query` calls on the shared pool. (Kept out of the test path since tests run disabled.)

- [ ] **Step 4: Remove the stray `client` line and run the test**

Delete the line `const client = await db.query.bind(null); ...` from `placeBet`.

Run: `npx jest server/tests/store.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS (all tasks' tests green).

- [ ] **Step 6: Commit**

```bash
git add server/store.js server/tests/store.test.js
git commit -m "feat: store wrappers (getBalance, placeBet, settleBets) with ledger"
```

---

### Task 6: End-to-end demo command (`demo-bet`)

**Files:**
- Modify: `src/index.js` (add a `demo-bet` mode)

**Interfaces:**
- Consumes: `getPuuid`, `getRecentMatchIds`, `getMatch` from `./riot`; `extractStats`, `buildBoard` from `./markets`; `getRecentStats` from `./form`; `getBalance`, `placeBet`, `settleBets` from `../server/store`; `makeSingle` from `../server/bets`.
- Produces: `node src/index.js demo-bet [RiotID] [matchId]` — opens the board on a real ranked game, places one demo single bet through the store, settles it, prints balance before/after.

- [ ] **Step 1: Add the `demoBet` function and route in `src/index.js`**

Add near the other mode functions:

```js
const { getBalance, placeBet, settleBets } = require('../server/store');
const { makeSingle } = require('../server/bets');
const db = require('../server/db');

async function demoBet(riotId, matchId) {
  await db.init(); // no-op if DATABASE_URL unset
  const puuid = await getPuuid(riotId);
  const id = matchId || (await getRecentMatchIds(puuid, 1, { type: 'ranked' }))[0];
  if (!id) { console.log('Aucune game ranked trouvée.'); return; }

  const gameStats = extractStats(await getMatch(id), puuid);
  const history = await getRecentStats(puuid, 12, id);
  const board = buildBoard(history, gameStats);

  const user = 'demo';
  const before = await getBalance(user);
  // Bet 50 on the player's WIN at the frozen opening odds.
  const winMarket = board.find((m) => m.title.startsWith('Résultat'));
  const bet = makeSingle({ player: user, board, marketTitle: winMarket.title, side: 'yes', stake: 50 });

  const placed = await placeBet(user, id, bet);
  console.log(`\n💰 ${user}: solde ${before} → pari 50 @${bet.odds.toFixed(2)} sur ${winMarket.title} WIN`);
  if (!placed.ok) { console.log(`   ❌ pari refusé (${placed.error}). DB branchée ? (DATABASE_URL)`); return; }

  const { settled } = await settleBets(id, board);
  const after = await getBalance(user);
  console.log(`   réglé (${settled} pari) → solde ${after} (${after - before >= 0 ? '+' : ''}${after - before})`);
}
```

Add the route in `main()`:

```js
    if (mode === 'demo-bet') await demoBet(riotId, matchId);
    else if (mode === 'live') await live();
    else if (mode === 'watch') await watch(riotId);
    else await backtest(riotId, matchId);
```

- [ ] **Step 2: Run with DB disabled (graceful path)**

Run: `RIOT_API_KEY="<key>" node src/index.js demo-bet`
Expected: prints the bet line, then "pari refusé (db)" — proving the no-DB fallback never crashes.

- [ ] **Step 3: Run with a Postgres DB (full loop)**

Run: `DATABASE_URL="<postgres-url>" RIOT_API_KEY="<key>" node src/index.js demo-bet`
Expected: prints `solde 1000 → pari 50 ...` then `réglé (1 pari) → solde <X>` with the balance changed by the settlement (e.g. `-50` on a loss, `+<payout-50>` on a win).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat: demo-bet command — end-to-end place + settle on a real ranked game"
```

---

## Self-Review

**Spec coverage (against §7 Economy, §6 Markets, §9 Bet lifecycle of the design spec):**
- Virtual currency, server-authoritative, append-only ledger → Tasks 4 (ledger table) + 5 (ledger writes). ✓
- Frozen odds at placement → Task 3 (`makeSingle`/`makeParlay` freeze odds) + 5 (stored JSONB). ✓
- Auto-settle every market/parlay from the game board → Tasks 3 + 5 (`settleBets`). ✓
- House vig → already baked into odds by `src/markets.js` (reused, not re-implemented). ✓
- Reuse single source of truth for markets → Tasks 3/6 consume `buildBoard`. ✓
- NOT in this plan (later plans, per scope note): auth/passwords, account linking, real-time event opening, live in-play odds, idle clicker, web UI. Intentional. ✓

**Placeholder scan:** No TBD/TODO. The only "note" (Task 5 stray `client` line) is handled by an explicit removal step (Task 5 Step 4). ✓

**Type consistency:** `bet` record shape is identical across Task 3 (produced), Task 5 (`JSON.stringify(bet)`, `bet.stake`, `bet.type`), and Task 6 (`makeSingle` → `placeBet`). `board` market shape `{title, yes:{label,odds,won}, no:{...}}` consistent across Tasks 3, 5, 6. `side` is `'yes'|'no'` throughout. `settleBets(matchId, board)` signature matches between Task 5 (def) and Task 6 (call). ✓
