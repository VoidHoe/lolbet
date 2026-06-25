# Events + Spectator Poller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Detect when a linked Riot account is in a live ranked game (Spectator API), open a betting event with form-priced opening odds, and auto-settle it when the game finishes.

**Architecture:** `riot.getActiveGame` (spectator-v5, platform host) detects in-progress games. An `events` table + never-throw `events.js` store holds open events with their opening board. `poller.js` orchestrates: for each linked account, open an event for a new ranked game, and settle open events whose game has finished (reusing the proven match-v5 settlement). Pure decision helpers are unit-tested; the orchestrator is verified manually (needs live Riot + DB).

**Tech Stack:** Node 20+ (CommonJS), `pg`, jest.

## Global Constraints

- Node `>=20.0.0`, CommonJS. No new dependencies.
- Ranked queues only: 420 (Solo) + 440 (Flex).
- Spectator host (platform routing) for EUW is `https://euw1.api.riotgames.com`; account/match host stays `https://europe.api.riotgames.com`.
- An event's key is the match id `EUW1_<gameId>` derived from the spectator `gameId`.
- The opening board comes from `priceBoard(history, {gameMode:'CLASSIC', champion})` where `champion` is the player's Riot gameName (display only).
- Never-throw DB pattern unchanged. Integer Clout.

---

### Task 1: `riot.getActiveGame` + `events` table

**Files:**
- Modify: `src/riot.js` (add platform host + `getActiveGame`)
- Modify: `server/db.js` (add `events` table to `init()`)

**Interfaces:**
- Produces:
  - `getActiveGame(puuid) -> Promise<object|null>` — spectator-v5 active game, or null when not in a game (404).
  - `events(match_id PK, username, riot_id, puuid, champion, queue_id, status, board JSONB, created_at, settled_at)` table.

- [ ] **Step 1: Add `getActiveGame` to `src/riot.js`.** First read `src/riot.js` (it has `REGIONAL` host and a `riotGet(url)` that throws on non-2xx, with `404` in the message). Add after the `REGIONAL` constant:

```js
const PLATFORM = 'https://euw1.api.riotgames.com'; // spectator-v5 uses platform routing
```

Add this function and export it (keep all existing exports):

```js
// Current live game for a puuid, or null if they are not in a game.
async function getActiveGame(puuid) {
  try {
    return await riotGet(`${PLATFORM}/lol/spectator/v5/active-games/by-summoner/${puuid}`);
  } catch (e) {
    if (/\b404\b/.test(e.message)) return null; // not currently in a game
    throw e;
  }
}
```

- [ ] **Step 2: Add the `events` table to `server/db.js`.** Inside `init()`, after the `riot_accounts` table and before `return true;`:

```js
  await query(`
    CREATE TABLE IF NOT EXISTS events (
      match_id   TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      riot_id    TEXT NOT NULL,
      puuid      TEXT NOT NULL,
      champion   TEXT NOT NULL,
      queue_id   INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      board      JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at TIMESTAMPTZ
    )`);
```

- [ ] **Step 3: Verify** — `node --check src/riot.js && npx jest server/tests/db.test.js && npm test`. Expected: clean + db test still passes (init returns false disabled) + whole suite green.

- [ ] **Step 4: Commit**

```bash
git add src/riot.js server/db.js
git commit -m "feat: spectator getActiveGame + events table"
```

---

### Task 2: Events store (`events.js`)

**Files:**
- Create: `server/events.js`
- Test: `server/tests/events.test.js`

**Interfaces:**
- Consumes: `db` (query/EconomyDisabledError).
- Produces (async, NEVER throw):
  - `openEvent({matchId, username, riotId, puuid, champion, queueId, board}) -> {ok:boolean, opened:boolean}` (insert if new; `opened:false` if it already existed)
  - `listOpen() -> Array<{match_id, username, riot_id, champion, queue_id, board}>` ([] on error)
  - `getEvent(matchId) -> object|null`
  - `markSettled(matchId) -> {ok:boolean}`

- [ ] **Step 1: Write the failing test (hermetic disabled-DB)**

```js
// server/tests/events.test.js
describe('events (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('wrappers fall back safely when DB is disabled', async () => {
    const events = require('../events');
    const e = { matchId: 'EUW1_1', username: 'gd', riotId: 'GraveDigger#v0id', puuid: 'P', champion: 'GraveDigger', queueId: 420, board: [] };
    expect(await events.openEvent(e)).toEqual({ ok: false, opened: false });
    expect(await events.listOpen()).toEqual([]);
    expect(await events.getEvent('EUW1_1')).toBe(null);
    expect(await events.markSettled('EUW1_1')).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest server/tests/events.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `server/events.js`**

```js
// server/events.js
// Betting-event store. NEVER throws — safe fallbacks on any DB error.

const db = require('./db');

function isDisabled(err) { return err instanceof db.EconomyDisabledError; }

async function openEvent({ matchId, username, riotId, puuid, champion, queueId, board }) {
  try {
    const res = await db.query(
      `INSERT INTO events (match_id, username, riot_id, puuid, champion, queue_id, board)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (match_id) DO NOTHING RETURNING match_id`,
      [matchId, username, riotId, puuid, champion, queueId, JSON.stringify(board)]
    );
    return { ok: true, opened: res.rowCount > 0 };
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] openEvent:', err.message);
    return { ok: false, opened: false };
  }
}

async function listOpen() {
  try {
    const res = await db.query(
      `SELECT match_id, username, riot_id, champion, queue_id, board
       FROM events WHERE status = 'open' ORDER BY created_at DESC`
    );
    return res.rows;
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] listOpen:', err.message);
    return [];
  }
}

async function getEvent(matchId) {
  try {
    const res = await db.query(`SELECT * FROM events WHERE match_id = $1`, [matchId]);
    return res.rows[0] || null;
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] getEvent:', err.message);
    return null;
  }
}

async function markSettled(matchId) {
  try {
    await db.query(`UPDATE events SET status = 'settled', settled_at = now() WHERE match_id = $1`, [matchId]);
    return { ok: true };
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] markSettled:', err.message);
    return { ok: false };
  }
}

module.exports = { openEvent, listOpen, getEvent, markSettled };
```

- [ ] **Step 4: Run to verify pass** — `npx jest server/tests/events.test.js`. Expected: PASS (1).

- [ ] **Step 5: Commit**

```bash
git add server/events.js server/tests/events.test.js
git commit -m "feat: events store (open/list/get/markSettled)"
```

---

### Task 3: `accounts.allLinked()`

**Files:**
- Modify: `server/accounts.js` (add `allLinked`)
- Modify: `server/tests/accounts.test.js` (assert disabled fallback)

**Interfaces:**
- Produces: `allLinked() -> Array<{username, riot_id, puuid}>` ([] on error) — every linked Riot account across all users (for the poller).

- [ ] **Step 1: Add an assertion to `server/tests/accounts.test.js`** — inside the existing `test('every wrapper falls back safely when DB is disabled', ...)`, add a line:

```js
    expect(await accounts.allLinked()).toEqual([]);
```

- [ ] **Step 2: Add `allLinked` to `server/accounts.js`** (before `module.exports`):

```js
async function allLinked() {
  try {
    const res = await db.query(`SELECT username, riot_id, puuid FROM riot_accounts ORDER BY created_at`);
    return res.rows;
  } catch (err) {
    if (!isDisabled(err)) console.error('[accounts] allLinked:', err.message);
    return [];
  }
}
```

and add `allLinked` to the `module.exports` list.

- [ ] **Step 3: Run** — `npx jest server/tests/accounts.test.js` then `npm test`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add server/accounts.js server/tests/accounts.test.js
git commit -m "feat: accounts.allLinked for the poller"
```

---

### Task 4: Poller (`poller.js`) + CLI `poll`

**Files:**
- Create: `server/poller.js`
- Test: `server/tests/poller.test.js`
- Modify: `src/index.js` (add `poll` mode)

**Interfaces:**
- Consumes: `getActiveGame`, `getRecentMatchIds`, `getMatch` from `../src/riot`; `extractStats`, `priceBoard` from `../src/markets`; `getRecentStats` from `../src/form`; `accounts.allLinked`; `events.{openEvent,listOpen,getEvent,markSettled}`; `store.settleBets`.
- Produces:
  - `RANKED_QUEUES = [420, 440]`
  - `isRanked(queueId) -> boolean`
  - `matchIdFor(gameId) -> string` (`'EUW1_' + gameId`)
  - `pollOnce() -> Promise<{opened:number, settled:number}>`

- [ ] **Step 1: Write the failing test (pure helpers only)**

```js
// server/tests/poller.test.js
const { isRanked, matchIdFor, RANKED_QUEUES } = require('../poller');

test('RANKED_QUEUES is solo + flex', () => {
  expect(RANKED_QUEUES).toEqual([420, 440]);
});

test('isRanked accepts 420/440, rejects others', () => {
  expect(isRanked(420)).toBe(true);
  expect(isRanked(440)).toBe(true);
  expect(isRanked(1700)).toBe(false); // arena
  expect(isRanked(undefined)).toBe(false);
});

test('matchIdFor builds the EUW match id from a spectator gameId', () => {
  expect(matchIdFor(7898651765)).toBe('EUW1_7898651765');
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest server/tests/poller.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `server/poller.js`**

```js
// server/poller.js
// Orchestrates detection → open event → settle. Pure helpers are unit-tested;
// pollOnce needs live Riot + DB and is verified manually via the CLI `poll` mode.

const { getActiveGame, getRecentMatchIds, getMatch } = require('../src/riot');
const { extractStats, priceBoard } = require('../src/markets');
const { getRecentStats } = require('../src/form');
const accounts = require('./accounts');
const events = require('./events');
const store = require('./store');

const RANKED_QUEUES = [420, 440];
const isRanked = (queueId) => RANKED_QUEUES.includes(queueId);
const matchIdFor = (gameId) => `EUW1_${gameId}`;

// Open events for any linked account currently in a new ranked game.
async function openNewEvents() {
  let opened = 0;
  const linked = await accounts.allLinked();
  for (const acc of linked) {
    let game;
    try { game = await getActiveGame(acc.puuid); } catch (e) { console.error('[poll] active:', e.message); continue; }
    if (!game || !isRanked(game.gameQueueConfigId)) continue;

    const matchId = matchIdFor(game.gameId);
    if (await events.getEvent(matchId)) continue; // already tracked

    const champion = String(acc.riot_id).split('#')[0]; // display name
    let board = [];
    try {
      const history = await getRecentStats(acc.puuid, 12);
      board = priceBoard(history, { gameMode: 'CLASSIC', champion });
    } catch (e) { console.error('[poll] price:', e.message); }

    const r = await events.openEvent({
      matchId, username: acc.username, riotId: acc.riot_id, puuid: acc.puuid,
      champion, queueId: game.gameQueueConfigId, board,
    });
    if (r.opened) { opened += 1; console.log(`[poll] event ouvert: ${acc.riot_id} (${matchId})`); }
  }
  return opened;
}

// Settle any open event whose game has finished (match-v5 result available).
async function settleFinished() {
  let settled = 0;
  for (const ev of await events.listOpen()) {
    let match;
    try { match = await getMatch(ev.match_id); } catch { continue; } // not finished yet → 404
    let gameStats;
    try { gameStats = extractStats(match, ev.puuid); } catch (e) { console.error('[poll] stats:', e.message); continue; }
    await store.settleBets(ev.match_id, gameStats);
    await events.markSettled(ev.match_id);
    settled += 1;
    console.log(`[poll] event réglé: ${ev.match_id}`);
  }
  return settled;
}

async function pollOnce() {
  const opened = await openNewEvents();
  const settled = await settleFinished();
  return { opened, settled };
}

module.exports = { RANKED_QUEUES, isRanked, matchIdFor, pollOnce, openNewEvents, settleFinished };
```

> Note: `events.listOpen()` returns rows without `puuid` (the SELECT in Task 2 omits it). Add `puuid` to that SELECT so `settleFinished` can call `extractStats(match, ev.puuid)`. Update `server/events.js` `listOpen` SELECT to: `SELECT match_id, username, riot_id, puuid, champion, queue_id, board FROM events WHERE status = 'open' ORDER BY created_at DESC`.

- [ ] **Step 4: Apply the note** — edit `server/events.js` `listOpen` to include `puuid` in the SELECT (as above). Re-run `npx jest server/tests/events.test.js` (still passes — disabled fallback returns []).

- [ ] **Step 5: Add the `poll` CLI mode to `src/index.js`.** Add near the top imports:

```js
const { pollOnce } = require('../server/poller');
```

Add a mode function (after `demoBet`):

```js
async function poll() {
  await db.init();
  console.log('🛰️  Poller — détecte les ranked en cours des comptes liés, ouvre/règle les events. (Ctrl+C pour stopper)');
  const tick = async () => {
    try {
      const { opened, settled } = await pollOnce();
      if (opened || settled) console.log(`[poll] +${opened} ouverts, ${settled} réglés`);
      else process.stdout.write('.');
    } catch (e) { console.error('\n[poll]', e.message); }
  };
  await tick();
  setInterval(tick, 30000);
}
```

Add the route in `main()` (first branch):

```js
    if (mode === 'poll') await poll();
    else if (mode === 'register') await register();
```
(keep the rest of the existing routing chain after it).

- [ ] **Step 6: Run the pure tests + syntax + suite** — `node --check src/index.js && npx jest server/tests/poller.test.js && npm test`. Expected: clean + poller helpers pass (3) + whole suite green.

- [ ] **Step 7: Commit**

```bash
git add server/poller.js server/tests/poller.test.js server/events.js src/index.js
git commit -m "feat: poller (open events on live ranked, settle on finish) + poll CLI"
```

---

## Self-Review

**Spec coverage:** Detection of a linked account's live ranked game → open event with opening odds → settle on finish, tying accounts + betting + real games. ✓ (§8 detection; §9 lifecycle open→settle.)

**Placeholder scan:** No TBD/TODO; complete code. The Task 4 note fixes the `puuid` SELECT inline. ✓

**Type consistency:** `matchId` keys events (`EUW1_<gameId>`); `priceBoard(history, {gameMode, champion})` → board stored as JSONB; `store.settleBets(matchId, gameStats)` matches the Slice-1 refactor; `events.listOpen` rows include `puuid` (after the Task 4 note) used by `settleFinished`. `getActiveGame` returns spectator shape with `gameId` + `gameQueueConfigId`. ✓
