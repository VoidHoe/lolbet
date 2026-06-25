# Multiplayer Events (per-player markets) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** When several linked accounts are in the same ranked game, the event's board carries the full markets for EACH of them (priced on each player's form) and settles per-player — so you can bet on your friends' stats. (Head-to-head markets are a later phase.)

**Architecture:** Markets become self-describing (each carries `puuid`/`defId`/`name`). The poller finds all linked players in a detected game and prices a combined board. Settlement extracts stats per-puuid from the finished match and resolves each market via the board metadata, reusing `marketWon`. Backward-compatible with existing single-player events.

**Tech Stack:** Node 20+ (CommonJS), `pg`, jest.

## Global Constraints

- Node `>=20.0.0`, CommonJS. No new deps.
- Reuse `MARKET_DEFS`/`priceMarket`/`marketWon` in `src/markets.js` — no duplicated market logic.
- Per-player market id = `'<slot>:<defId>'` (slot = `p0`,`p1`,…). Markets carry `kind:'player'`, `slot`, `puuid`, `name`, `defId`.
- Settlement reuses `marketWon(defId, side, statsForThatPuuid)`.
- Never-throw DB pattern unchanged. Integer Clout. Backward-compat: a board market without `puuid`/`defId` falls back to the event's `puuid` and `m.id`.

---

### Task 1: `markets.priceMultiBoard`

**Files:** Modify `src/markets.js`; Test `server/tests/multiboard.test.js`

**Interfaces:**
- Produces: `priceMultiBoard(players, gameMode) -> Array<market>` where `players = [{slot, puuid, name, history}]`. Each market: `{id:'<slot>:<defId>', kind:'player', slot, puuid, name, defId, title:'<name> · <baseTitle>', yes:{label,odds}, no:{label,odds}}`. Classic-only defs included only when `gameMode==='CLASSIC'`.

- [ ] **Step 1: Write the failing test** — `server/tests/multiboard.test.js`:

```js
const { priceMultiBoard } = require('../../src/markets');

const hist = (mode) => Array.from({ length: 5 }, () => ({
  gameMode: mode, win: true, kills: 10, deaths: 2, assists: 5, cs: 200,
  firstBloodKill: false, largestMultiKill: 1, fbMine: true, fdMine: true,
  fbaronMine: false, ftowerMine: true, teamDragons: 3, totalKills: 30, durationSec: 1800,
}));

test('priceMultiBoard namespaces markets per player with metadata', () => {
  const players = [
    { slot: 'p0', puuid: 'PA', name: 'Alice', history: hist('CLASSIC') },
    { slot: 'p1', puuid: 'PB', name: 'Bob', history: hist('CLASSIC') },
  ];
  const board = priceMultiBoard(players, 'CLASSIC');
  const aWin = board.find((m) => m.id === 'p0:win');
  const bKills = board.find((m) => m.id === 'p1:kills');
  expect(aWin).toMatchObject({ kind: 'player', slot: 'p0', puuid: 'PA', name: 'Alice', defId: 'win' });
  expect(aWin.title).toBe('Alice · Résultat');
  expect(bKills).toMatchObject({ puuid: 'PB', defId: 'kills' });
  expect(bKills.title).toBe('Bob · Kills');
  // both players present, each with the full classic board
  expect(board.filter((m) => m.slot === 'p0').length).toBe(board.filter((m) => m.slot === 'p1').length);
  expect(aWin.yes.odds).toBeGreaterThan(0);
});

test('non-classic excludes classic-only markets', () => {
  const board = priceMultiBoard([{ slot: 'p0', puuid: 'PA', name: 'A', history: hist('CHERRY') }], 'CHERRY');
  expect(board.find((m) => m.id === 'p0:fbteam')).toBeUndefined();
  expect(board.find((m) => m.id === 'p0:win')).toBeDefined();
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest server/tests/multiboard.test.js`. FAIL.

- [ ] **Step 3: Implement in `src/markets.js`** — read it first (it has `MARKET_DEFS`, `priceMarket`, `labelsFor`). Add:

```js
// Clean per-player title for a def (no champion injected).
function baseTitle(def) {
  return def.id === 'win' ? 'Résultat' : def.title({});
}

// Combined board for several players in one game. players: [{slot,puuid,name,history}].
function priceMultiBoard(players, gameMode) {
  const board = [];
  for (const p of players) {
    const sameMode = (p.history || []).filter((s) => s.gameMode === gameMode).slice(0, 5);
    for (const def of MARKET_DEFS) {
      if (!(def.mode === 'all' || gameMode === 'CLASSIC')) continue;
      const price = priceMarket(def, sameMode);
      const lab = labelsFor(def);
      board.push({
        id: p.slot + ':' + def.id,
        kind: 'player', slot: p.slot, puuid: p.puuid, name: p.name, defId: def.id,
        title: p.name + ' · ' + baseTitle(def),
        yes: { label: lab.yes, odds: price.oddsYes },
        no: { label: lab.no, odds: price.oddsNo },
      });
    }
  }
  return board;
}
```

Add `priceMultiBoard` to `module.exports` (keep all existing exports).

- [ ] **Step 4: Run to verify pass** — `npx jest server/tests/multiboard.test.js`. PASS (2).

- [ ] **Step 5: Run full suite** — `npm test`. Green.

- [ ] **Step 6: Commit**

```bash
git add src/markets.js server/tests/multiboard.test.js
git commit -m "feat: priceMultiBoard (per-player namespaced markets)"
```

---

### Task 2: `bets` — metadata-driven settlement (`legWon` + `settleBet`)

**Files:** Modify `server/bets.js`; Modify `server/tests/bets.test.js`

**Interfaces:**
- Consumes: `marketWon`, `settleParlay` from `../src/markets`; `payout` from `./economy`.
- Produces (REPLACES `settleSingle`/`settleParlayBet`):
  - `legWon(marketId, side, board, statsByPuuid, fallbackPuuid) -> boolean` — resolves one leg via the board market's `{puuid, defId}` (falls back to `fallbackPuuid` and `m.id`).
  - `settleBet(bet, board, statsByPuuid, fallbackPuuid) -> {won, payout}` — single or parlay (all-or-nothing).
  - Keep `makeSingle`, `makeParlay` unchanged.

- [ ] **Step 1: Replace `server/tests/bets.test.js`** with:

```js
const { makeSingle, makeParlay, legWon, settleBet } = require('../bets');

// Multiplayer priced board (no won), markets carry puuid + defId.
const board = [
  { id: 'p0:win',   title: 'Alice · Résultat', kind: 'player', puuid: 'PA', defId: 'win',   yes: { label: 'WIN', odds: 2.0 }, no: { label: 'LOSE', odds: 1.6 } },
  { id: 'p0:kills', title: 'Alice · Kills',    kind: 'player', puuid: 'PA', defId: 'kills', yes: { label: '+ de 7.5', odds: 3.0 }, no: { label: '- de 7.5', odds: 1.3 } },
  { id: 'p1:kills', title: 'Bob · Kills',      kind: 'player', puuid: 'PB', defId: 'kills', yes: { label: '+ de 7.5', odds: 2.0 }, no: { label: '- de 7.5', odds: 1.8 } },
];
const statsByPuuid = {
  PA: { win: false, kills: 3, gameMode: 'CLASSIC' },   // Alice lost, 3 kills
  PB: { win: true, kills: 12, gameMode: 'CLASSIC' },    // Bob won, 12 kills
};

test('makeSingle still freezes odds by market id', () => {
  const bet = makeSingle({ player: 'u', board, marketId: 'p1:kills', side: 'yes', stake: 50 });
  expect(bet).toEqual({ player: 'u', type: 'single', marketId: 'p1:kills', side: 'yes', stake: 50, odds: 2.0 });
});

test('legWon resolves against the right player stats', () => {
  expect(legWon('p0:win', 'no', board, statsByPuuid)).toBe(true);   // Alice lost → LOSE wins
  expect(legWon('p1:kills', 'yes', board, statsByPuuid)).toBe(true); // Bob 12 > 7.5
  expect(legWon('p0:kills', 'yes', board, statsByPuuid)).toBe(false);// Alice 3 < 7.5
});

test('legWon falls back to fallbackPuuid + m.id for legacy markets', () => {
  const legacy = [{ id: 'win', yes: { label: 'WIN', odds: 2 }, no: { label: 'LOSE', odds: 1.6 } }];
  expect(legWon('win', 'no', legacy, { PA: { win: false } }, 'PA')).toBe(true);
});

test('settleBet pays a winning single from the right player', () => {
  const bet = makeSingle({ player: 'u', board, marketId: 'p1:kills', side: 'yes', stake: 50 });
  expect(settleBet(bet, board, statsByPuuid)).toEqual({ won: true, payout: 100 }); // 50*2.0
});

test('settleBet parlay is all-or-nothing across players', () => {
  const par = makeParlay({ player: 'u', board, stake: 50, picks: [
    { marketId: 'p0:win', side: 'no' },   // Alice LOSE wins (1.6)
    { marketId: 'p1:kills', side: 'yes' },// Bob over wins (2.0)
  ] });
  const r = settleBet(par, board, statsByPuuid);
  expect(r.won).toBe(true);
  expect(r.payout).toBe(160); // round(50 * 1.6 * 2.0)
  const par2 = makeParlay({ player: 'u', board, stake: 50, picks: [
    { marketId: 'p0:win', side: 'no' },
    { marketId: 'p0:kills', side: 'yes' }, // Alice over loses
  ] });
  expect(settleBet(par2, board, statsByPuuid)).toMatchObject({ won: false, payout: 0 });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest server/tests/bets.test.js`. FAIL.

- [ ] **Step 3: Rewrite `server/bets.js`**:

```js
// server/bets.js
// Pure bet lifecycle. Bets reference a market by id and freeze odds at placement.
// Settlement resolves each leg via the board market's metadata (puuid + defId)
// against per-puuid stats — reusing marketWon.

const { marketWon, settleParlay } = require('../src/markets');
const { payout } = require('./economy');

function findMarket(board, id) {
  const m = board.find((x) => x.id === id);
  if (!m) throw new Error('Marché inconnu: ' + id);
  return m;
}
function sideOf(market, side) {
  if (side !== 'yes' && side !== 'no') throw new Error('Côté invalide: ' + side);
  return market[side];
}

function makeSingle({ player, board, marketId, side, stake }) {
  const sel = sideOf(findMarket(board, marketId), side);
  return { player, type: 'single', marketId, side, stake, odds: sel.odds };
}
function makeParlay({ player, board, picks, stake }) {
  const legs = picks.map((p) => {
    const sel = sideOf(findMarket(board, p.marketId), p.side);
    return { marketId: p.marketId, side: p.side, odds: sel.odds };
  });
  return { player, type: 'parlay', picks: legs, stake };
}

// Resolve one leg: pick the right player's stats from the board market metadata.
function legWon(marketId, side, board, statsByPuuid, fallbackPuuid) {
  const m = findMarket(board, marketId);
  const puuid = m.puuid || fallbackPuuid;
  const defId = m.defId || m.id;
  return marketWon(defId, side, statsByPuuid[puuid]);
}

function settleBet(bet, board, statsByPuuid, fallbackPuuid) {
  if (bet.type === 'parlay') {
    const legs = bet.picks.map((p) => ({ odds: p.odds, won: legWon(p.marketId, p.side, board, statsByPuuid, fallbackPuuid) }));
    const r = settleParlay(legs, bet.stake);
    return { won: r.allWon, payout: r.payout };
  }
  const won = legWon(bet.marketId, bet.side, board, statsByPuuid, fallbackPuuid);
  return { won, payout: payout(bet.stake, bet.odds, won) };
}

module.exports = { makeSingle, makeParlay, legWon, settleBet };
```

- [ ] **Step 4: Run to verify pass** — `npx jest server/tests/bets.test.js`. PASS (5). (Other suites may fail until Task 3 updates store — that's expected.)

- [ ] **Step 5: Commit**

```bash
git add server/bets.js server/tests/bets.test.js
git commit -m "refactor: metadata-driven settlement (legWon/settleBet, per-puuid)"
```

---

### Task 3: `store.settleBets(event, match)`

**Files:** Modify `server/store.js`; Modify `server/tests/store.test.js`

**Interfaces:**
- Consumes: `extractStats` from `../src/markets`; `settleBet` from `./bets`.
- Produces: `settleBets(event, match) -> {settled}` — `event` = the event row (`{match_id, board, puuid}`), `match` = raw match-v5 object. Extracts stats per board-referenced puuid (+ event.puuid), settles each open bet via `settleBet`, credits payouts + ledger. Never throws.

- [ ] **Step 1: Update `server/tests/store.test.js`** — replace the `settleBets` line with the new signature:

```js
    await expect(store.settleBets({ match_id: 'EUW1_1', board: [], puuid: 'P' }, { info: { participants: [], teams: [] } })).resolves.toEqual({ settled: 0 });
```

- [ ] **Step 2: Update `server/store.js`** — add imports at top (after the existing requires):

```js
const { extractStats } = require('../src/markets');
const { settleBet } = require('./bets');
```

Replace the whole `settleBets` function with:

```js
// Settle all open bets for a finished event. event = {match_id, board, puuid};
// match = raw match-v5 object. Resolves each bet via board metadata + per-puuid stats.
async function settleBets(event, match) {
  try {
    const board = event.board || [];
    const puuids = new Set(board.map((m) => m.puuid).filter(Boolean));
    if (event.puuid) puuids.add(event.puuid);
    const statsByPuuid = {};
    for (const pu of puuids) {
      try { statsByPuuid[pu] = extractStats(match, pu); } catch { /* not in match */ }
    }

    const open = await db.query(
      `SELECT id, username, bet FROM bets WHERE match_id = $1 AND status = 'open'`,
      [event.match_id]
    );
    let settled = 0;
    for (const row of open.rows) {
      const bet = typeof row.bet === 'string' ? JSON.parse(row.bet) : row.bet;
      let result;
      try { result = settleBet(bet, board, statsByPuuid, event.puuid); }
      catch (e) { console.error('[store] settleBet:', e.message); continue; }
      await db.query('BEGIN');
      await db.query(`UPDATE bets SET status = $2, payout = $3 WHERE id = $1`,
        [row.id, result.won ? 'won' : 'lost', result.payout]);
      if (result.payout > 0) {
        await db.query(`UPDATE players SET balance = balance + $2, updated_at = now() WHERE username = $1`,
          [row.username, result.payout]);
        await db.query(`INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'bet-payout', $3)`,
          [row.username, result.payout, event.match_id]);
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
```

(Remove the old `settleSingle`/`settleParlayBet` import line in store.js — they no longer exist; only `settleBet` is imported.)

- [ ] **Step 3: Run** — `npx jest server/tests/store.test.js` (PASS), then `npm test` (green except poller/index which Task 4/5 update).

- [ ] **Step 4: Commit**

```bash
git add server/store.js server/tests/store.test.js
git commit -m "refactor: store.settleBets(event, match) — per-puuid resolution"
```

---

### Task 4: Poller builds multiplayer events

**Files:** Modify `server/poller.js`; Modify `server/tests/poller.test.js`

**Interfaces:**
- Consumes: `getActiveGame`, `getMatch` from `../src/riot`; `priceMultiBoard` from `../src/markets`; `getRecentStats` from `../src/form`; `accounts.allLinked`; `events.*`; `store.settleBets`.
- Produces: `linkedInGame(participants, linked) -> Array<account>` (linked accounts whose puuid is in the game). `openNewEvents` builds a multiplayer board; `settleFinished` calls `store.settleBets(event, match)`.

- [ ] **Step 1: Add a test to `server/tests/poller.test.js`** — append:

```js
const { linkedInGame } = require('../poller');

test('linkedInGame returns linked accounts present in the game', () => {
  const linked = [{ puuid: 'PA', riot_id: 'A#1' }, { puuid: 'PB', riot_id: 'B#2' }, { puuid: 'PC', riot_id: 'C#3' }];
  const participants = [{ puuid: 'PX' }, { puuid: 'PA' }, { puuid: 'PC' }];
  const got = linkedInGame(participants, linked).map((a) => a.puuid);
  expect(got).toEqual(['PA', 'PC']);
});
```

- [ ] **Step 2: Run** — `npx jest server/tests/poller.test.js`. The new test FAILS (linkedInGame undefined).

- [ ] **Step 3: Rewrite `server/poller.js`**:

```js
// server/poller.js
// Detection → open multiplayer event → settle. Pure helpers unit-tested;
// pollOnce needs live Riot + DB and is verified manually via the CLI `poll` mode.

const { getActiveGame, getMatch } = require('../src/riot');
const { priceMultiBoard } = require('../src/markets');
const { getRecentStats } = require('../src/form');
const accounts = require('./accounts');
const events = require('./events');
const store = require('./store');

const RANKED_QUEUES = [420, 440];
const isRanked = (queueId) => RANKED_QUEUES.includes(queueId);
const matchIdFor = (gameId, platformId = 'EUW1') => `${platformId}_${gameId}`;

// Linked accounts whose puuid appears among a game's participants.
function linkedInGame(participants, linked) {
  const byPuuid = new Map(linked.map((a) => [a.puuid, a]));
  const out = [];
  for (const part of participants || []) {
    const acc = byPuuid.get(part.puuid);
    if (acc) out.push(acc);
  }
  return out;
}

async function openNewEvents() {
  let opened = 0;
  const linked = await accounts.allLinked();
  const seen = new Set();
  for (const acc of linked) {
    let game;
    try { game = await getActiveGame(acc.puuid); } catch (e) { console.error('[poll] active:', e.message); continue; }
    if (!game || !isRanked(game.gameQueueConfigId)) continue;

    const matchId = matchIdFor(game.gameId, game.platformId);
    if (seen.has(matchId)) continue; // already handled this game this cycle
    seen.add(matchId);
    if (await events.getEvent(matchId)) continue; // already tracked

    const inGame = linkedInGame(game.participants, linked);
    const players = [];
    for (let i = 0; i < inGame.length; i += 1) {
      const a = inGame[i];
      let history = [];
      try { history = await getRecentStats(a.puuid, 12); } catch (e) { console.error('[poll] form:', e.message); }
      players.push({ slot: 'p' + i, puuid: a.puuid, name: String(a.riot_id).split('#')[0], history });
    }
    if (!players.length) continue;

    const board = priceMultiBoard(players, 'CLASSIC');
    const names = players.map((p) => p.name).join(' + ');
    const r = await events.openEvent({
      matchId, username: acc.username, riotId: acc.riot_id, puuid: acc.puuid,
      champion: names, queueId: game.gameQueueConfigId, board,
    });
    if (r.opened) { opened += 1; console.log(`[poll] event ouvert: ${names} (${matchId})`); }
  }
  return opened;
}

async function settleFinished() {
  let settled = 0;
  for (const ev of await events.listOpen()) {
    let match;
    try { match = await getMatch(ev.match_id); } catch { continue; } // not finished yet → 404
    await store.settleBets(ev, match);
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

module.exports = { RANKED_QUEUES, isRanked, matchIdFor, linkedInGame, pollOnce, openNewEvents, settleFinished };
```

- [ ] **Step 4: Run** — `npx jest server/tests/poller.test.js` (PASS, 4), then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add server/poller.js server/tests/poller.test.js
git commit -m "feat: poller builds multiplayer events (all linked players in a game)"
```

---

### Task 5: UI groups markets by player + fix demo-bet

**Files:** Modify `server/public/index.html`; Modify `src/index.js`

**Interfaces:**
- UI groups the board markets by `name` (per player) into sub-sections; `demo-bet` updated to the new `settleBets(event, match)` signature.

- [ ] **Step 1: Update `renderEvents` in `server/public/index.html`.** Find the `renderEvents` function and replace its `$('events').innerHTML = evs.map(...)` body so markets are grouped by player name (markets carry `name`; legacy markets without `name` group under the event champion):

```js
  $('events').innerHTML = evs.map((ev) => {
    boards[ev.match_id] = ev.board || [];
    const groups = {};
    for (const m of ev.board || []) { const k = m.name || ev.champion; (groups[k] = groups[k] || []).push(m); }
    const sections = Object.keys(groups).map((nm) => {
      const rows = groups[nm].map((m) =>
        '<div class="mkt"><span>' + m.title + '</span><span class="sides">' +
        '<button class="odd" id="o_' + ev.match_id + '_' + m.id + '_yes" onclick="pick(\'' + ev.match_id + '\',\'' + m.id + '\',\'yes\')">' + m.yes.label + ' <b>' + m.yes.odds.toFixed(2) + '</b></button>' +
        '<button class="odd" id="o_' + ev.match_id + '_' + m.id + '_no" onclick="pick(\'' + ev.match_id + '\',\'' + m.id + '\',\'no\')">' + m.no.label + ' <b>' + m.no.odds.toFixed(2) + '</b></button>' +
        '</span></div>').join('');
      return '<div class="pl"><h4>' + nm + '</h4>' + rows + '</div>';
    }).join('');
    return '<div class="ev"><h3>🎮 ' + ev.champion + ' <span class="muted">(' + ev.riot_id + ')</span></h3>' + sections + '</div>';
  }).join('');
  markSelected();
  renderSlip();
```

(The market-id-based `pick`/`markSelected`/coupon logic is unchanged — composite ids like `p0:win` work as element ids and bet ids.)

- [ ] **Step 2: Add player-section CSS** — in the `<style>` block, after the `.ev h3` rule add:

```css
  .pl { margin-top:8px; } .pl h4 { margin:6px 0 2px; font-size:13px; color:var(--acc); }
```

- [ ] **Step 3: Fix `demo-bet` in `src/index.js`.** It calls `settleBets(id, gameStats)` — update to the new signature. Find `demoBet` and change its settle section: keep `const match = await getMatch(id);` (or add it), build `gameStats`/board as today, then settle with an event-shaped object:

Replace the body of `demoBet` with:

```js
async function demoBet(riotId, matchId) {
  await db.init();
  const puuid = await getPuuid(riotId);
  const id = matchId || (await getRecentMatchIds(puuid, 1, { type: 'ranked' }))[0];
  if (!id) { console.log('Aucune game ranked trouvée.'); return; }

  const match = await getMatch(id);
  const gameStats = extractStats(match, puuid);
  const history = await getRecentStats(puuid, 12, id);
  const board = priceBoard(history, { gameMode: gameStats.gameMode, champion: gameStats.champion });

  const user = 'demo';
  const before = await getBalance(user);
  const bet = makeSingle({ player: user, board, marketId: 'win', side: 'yes', stake: 50 });

  const placed = await placeBet(user, id, bet);
  console.log(`\n💰 ${user}: solde ${before} → pari 50 @${bet.odds.toFixed(2)} sur WIN`);
  if (!placed.ok) { console.log(`   ❌ pari refusé (${placed.error}). DB branchée ? (DATABASE_URL)`); return; }

  const { settled } = await settleBets({ match_id: id, board, puuid }, match);
  const after = await getBalance(user);
  console.log(`   réglé (${settled} pari) → solde ${after} (${after - before >= 0 ? '+' : ''}${after - before})`);
}
```

(`makeSingle`, `placeBet`, `settleBets`, `getBalance` are already imported; `priceBoard`, `extractStats`, `getMatch`, `getRecentStats`, `getPuuid`, `getRecentMatchIds`, `db` too. The board here is single-player legacy format — `settleBets` falls back to the event `puuid`.)

- [ ] **Step 4: Verify** — `node --check src/index.js`, then `node -e "const h=require('fs').readFileSync('server/public/index.html','utf8'); new Function(h.match(/<script>([\\s\\S]*)<\\/script>/)[1]); console.log('UI OK')"`, then `npm test` (ALL green).

- [ ] **Step 5: Commit**

```bash
git add server/public/index.html src/index.js
git commit -m "feat: UI groups markets per player; demo-bet uses new settle signature"
```

---

## Self-Review

**Spec coverage:** per-player markets for all linked players in a game (Tasks 1+4), per-player settlement reusing marketWon (Tasks 2+3), UI grouped by player (Task 5). H2H deferred (Phase 2). ✓

**Placeholder scan:** complete code throughout. ✓

**Type consistency:** market id `'<slot>:<defId>'` and metadata `{kind,slot,puuid,name,defId}` consistent across `priceMultiBoard` (Task 1), `legWon`/`settleBet` (Task 2), `store.settleBets` (Task 3), poller (Task 4), UI grouping by `name` (Task 5). `settleBets(event, match)` signature consistent between store (Task 3), poller (Task 4), demo-bet (Task 5). Backward-compat fallback (`m.puuid||fallback`, `m.defId||m.id`) covers legacy single-player boards. ✓
