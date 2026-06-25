# Pre-Game Pricing Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split market PRICING (from form, known before the game) from SETTLEMENT (from the result, known after), so a betting event can open with odds while the game is still being played.

**Architecture:** Add a stable `id` to every market, a `priceBoard(history, meta)` that quotes odds without a result, and a `marketWon(marketId, side, gameStats)` that resolves a single market from the finished game. Bets store the market `id` (not just the title) and settle against `gameStats` directly. Keep `buildBoard` working for the CLI backtest.

**Tech Stack:** Node 20+ (CommonJS), jest.

## Global Constraints

- Node `>=20.0.0`, CommonJS. No new dependencies.
- Single source of truth: `MARKET_DEFS` in `src/markets.js` already defines each market once (predicate/line/mode). Do NOT duplicate market logic.
- A market `id` is the def `id` already present in `MARKET_DEFS` (e.g. `'win'`, `'kills'`, `'fbteam'`).
- `side` is `'yes' | 'no'`.
- Odds are FROZEN into the bet at placement; settlement pays `round(stake × frozenOdds)` (unchanged).
- Integer Clout. Never-throw DB pattern unchanged.

---

### Task 1: Add `id` + `priceBoard` + `marketWon` to `src/markets.js`

**Files:**
- Modify: `src/markets.js`
- Test: `server/tests/markets.test.js`

**Interfaces:**
- Consumes: existing `MARKET_DEFS`, `priceMarket`, `extractStats` in `src/markets.js`.
- Produces:
  - Each market object returned by `buildBoard` AND `priceBoard` gains an `id` field (the def id).
  - `priceBoard(history, meta) -> Array<{id, title, yes:{label,odds}, no:{label,odds}}>` where `meta = {gameMode, champion}`. Prices from `history` (same-mode, last 5), NO `won` field. Mode gating: a def with `mode:'classic'` is included only when `meta.gameMode === 'CLASSIC'`.
  - `marketWon(marketId, side, gameStats) -> boolean` — resolves whether `side` of market `marketId` won given the finished-game `gameStats`. Throws if `marketId` is unknown.

- [ ] **Step 1: Write the failing tests**

```js
// server/tests/markets.test.js
const { priceBoard, marketWon, buildBoard } = require('../../src/markets');

// Five fake CLASSIC form games where the player always won and always got >7.5 kills.
const history = Array.from({ length: 5 }, () => ({
  gameMode: 'CLASSIC', win: true, kills: 10, deaths: 2, assists: 5, cs: 200,
  firstBloodKill: false, largestMultiKill: 1, fbMine: true, fdMine: true,
  fbaronMine: false, ftowerMine: true, teamDragons: 3, totalKills: 30, durationSec: 1800,
}));

test('priceBoard quotes odds with ids and no won field', () => {
  const board = priceBoard(history, { gameMode: 'CLASSIC', champion: 'Galio' });
  const win = board.find((m) => m.id === 'win');
  expect(win).toBeDefined();
  expect(win.yes.won).toBeUndefined();          // pre-game: no result
  expect(win.yes.odds).toBeLessThan(win.no.odds); // always-won form → WIN is the short side
  expect(win.title).toContain('Galio');
});

test('priceBoard excludes classic-only markets for non-classic modes', () => {
  const board = priceBoard(history, { gameMode: 'CHERRY', champion: 'Briar' });
  expect(board.find((m) => m.id === 'fbteam')).toBeUndefined(); // first-blood-team is classic-only
  expect(board.find((m) => m.id === 'win')).toBeDefined();      // result is universal
});

test('marketWon resolves a single market from final stats', () => {
  const gameStats = { win: true, kills: 10, deaths: 2, assists: 5, cs: 200, firstBloodKill: false,
    largestMultiKill: 1, fbMine: true, fdMine: false, fbaronMine: false, ftowerMine: true,
    teamDragons: 1, totalKills: 20, durationSec: 1700, gameMode: 'CLASSIC', champion: 'Galio' };
  expect(marketWon('win', 'yes', gameStats)).toBe(true);   // they won
  expect(marketWon('win', 'no', gameStats)).toBe(false);
  expect(marketWon('kills', 'yes', gameStats)).toBe(true);  // 10 > 7.5
  expect(marketWon('kills', 'no', gameStats)).toBe(false);
  expect(() => marketWon('nope', 'yes', gameStats)).toThrow();
});

test('buildBoard still works and now carries ids', () => {
  const gameStats = { win: false, kills: 3, deaths: 7, assists: 9, cs: 120, firstBloodKill: false,
    largestMultiKill: 1, fbMine: false, fdMine: false, fbaronMine: true, ftowerMine: false,
    teamDragons: 2, totalKills: 25, durationSec: 2000, gameMode: 'CLASSIC', champion: 'Galio' };
  const board = buildBoard(history, gameStats);
  const win = board.find((m) => m.id === 'win');
  expect(win.no.won).toBe(true); // they lost → LOSE side won
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest server/tests/markets.test.js`
Expected: FAIL (`priceBoard`/`marketWon` not exported, or `id` missing).

- [ ] **Step 3: Implement in `src/markets.js`**

First READ `src/markets.js`. It has `MARKET_DEFS` (each `{id, title, kind, mode, ...}`), `priceMarket(def, history)` (returns `{n, hits, pYes, oddsYes, oddsNo}`), `settleYes(def, stats)`, and `buildBoard(history, gameStats)`.

Add these helpers and exports. `defById` looks a def up; `marketLabels` derives the yes/no labels (same logic `buildBoard` uses):

```js
function defById(id) {
  const def = MARKET_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Marché inconnu: ${id}`);
  return def;
}

// yes/no display labels for a def (ou markets show the line, others their words).
function labelsFor(def) {
  return def.kind === 'ou'
    ? { yes: `+ de ${def.line}`, no: `- de ${def.line}` }
    : { yes: def.yes, no: def.no };
}

// Price the board from form, WITHOUT a result. meta = {gameMode, champion}.
function priceBoard(history, meta) {
  const mode = meta.gameMode;
  const sameMode = history.filter((s) => s.gameMode === mode).slice(0, 5);
  const champ = meta.champion;
  return MARKET_DEFS
    .filter((def) => def.mode === 'all' || mode === 'CLASSIC')
    .map((def) => {
      const price = priceMarket(def, sameMode);
      const lab = labelsFor(def);
      const title = def.title({ champion: champ });
      return {
        id: def.id,
        title,
        yes: { label: lab.yes, odds: price.oddsYes },
        no: { label: lab.no, odds: price.oddsNo },
      };
    });
}

// Did `side` of market `id` win, given the finished game's stats?
function marketWon(marketId, side, gameStats) {
  const yesWon = settleYes(defById(marketId), gameStats);
  return side === 'yes' ? yesWon : !yesWon;
}
```

Then update `buildBoard` so each market it returns also includes `id: def.id` (find the `.map((def) => { ... return { title: ..., ... } })` and add `id: def.id` to the returned object).

Finally add `priceBoard` and `marketWon` to `module.exports` (alongside the existing exports — keep all current exports).

- [ ] **Step 4: Run to verify pass**

Run: `npx jest server/tests/markets.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all green (existing 19 + these 4).

- [ ] **Step 6: Commit**

```bash
git add src/markets.js server/tests/markets.test.js
git commit -m "feat: split market pricing (priceBoard) from settlement (marketWon)"
```

---

### Task 2: Refactor `bets.js` to market ids + settle from stats

**Files:**
- Modify: `server/bets.js`
- Modify: `server/tests/bets.test.js`

**Interfaces:**
- Consumes: `marketWon`, `settleParlay` from `../src/markets`; `payout` from `./economy`.
- Produces (CHANGED signatures):
  - `makeSingle({player, board, marketId, side, stake}) -> {player, type:'single', marketId, side, stake, odds}` (board is a priced board with `id`/`yes`/`no`; freezes odds).
  - `settleSingle(bet, gameStats) -> {won, payout}` (resolves via `marketWon(bet.marketId, bet.side, gameStats)`).
  - `makeParlay({player, board, picks:[{marketId, side}], stake}) -> {player, type:'parlay', picks:[{marketId, side, odds}], stake}`.
  - `settleParlayBet(bet, gameStats) -> {won, payout, combinedOdds}`.

- [ ] **Step 1: Rewrite the tests** — replace `server/tests/bets.test.js` with:

```js
// server/tests/bets.test.js
const { makeSingle, settleSingle, makeParlay, settleParlayBet } = require('../bets');

// Priced board (no won) mirroring priceBoard's shape — markets keyed by id.
const board = [
  { id: 'win',   title: 'Résultat (Galio)', yes: { label: 'WIN', odds: 2.0 }, no: { label: 'LOSE', odds: 1.6 } },
  { id: 'kills', title: 'Kills',            yes: { label: '+ de 7.5', odds: 3.0 }, no: { label: '- de 7.5', odds: 1.3 } },
];

// Final game stats: lost, 3 kills (< 7.5).
const gameStats = { win: false, kills: 3, deaths: 7, assists: 9, cs: 120, firstBloodKill: false,
  largestMultiKill: 1, fbMine: false, fdMine: false, fbaronMine: false, ftowerMine: false,
  teamDragons: 0, totalKills: 20, durationSec: 1700, gameMode: 'CLASSIC', champion: 'Galio' };

test('makeSingle freezes odds from the chosen side by market id', () => {
  const bet = makeSingle({ player: 'gd', board, marketId: 'win', side: 'yes', stake: 50 });
  expect(bet).toEqual({ player: 'gd', type: 'single', marketId: 'win', side: 'yes', stake: 50, odds: 2.0 });
});

test('makeSingle throws on unknown market or bad side', () => {
  expect(() => makeSingle({ player: 'gd', board, marketId: 'nope', side: 'yes', stake: 50 })).toThrow();
  expect(() => makeSingle({ player: 'gd', board, marketId: 'kills', side: 'maybe', stake: 50 })).toThrow();
});

test('settleSingle resolves from gameStats and pays frozen odds', () => {
  const onLose = makeSingle({ player: 'gd', board, marketId: 'win', side: 'no', stake: 50 }); // they lost → LOSE wins
  expect(settleSingle(onLose, gameStats)).toEqual({ won: true, payout: 80 }); // 50 * 1.6
  const onOver = makeSingle({ player: 'gd', board, marketId: 'kills', side: 'yes', stake: 50 }); // 3 < 7.5 → lost
  expect(settleSingle(onOver, gameStats)).toEqual({ won: false, payout: 0 });
});

test('makeParlay freezes leg odds; settleParlayBet is all-or-nothing from stats', () => {
  const par = makeParlay({ player: 'gd', board, stake: 50, picks: [
    { marketId: 'win', side: 'no' },   // 1.6, wins (they lost)
    { marketId: 'kills', side: 'no' }, // 1.3, wins (3 < 7.5)
  ] });
  expect(par.picks).toEqual([
    { marketId: 'win', side: 'no', odds: 1.6 },
    { marketId: 'kills', side: 'no', odds: 1.3 },
  ]);
  const r = settleParlayBet(par, gameStats);
  expect(r.won).toBe(true);
  expect(r.combinedOdds).toBeCloseTo(2.08, 2);
  expect(r.payout).toBe(104);
});

test('settleParlayBet loses if any leg loses', () => {
  const par = makeParlay({ player: 'gd', board, stake: 50, picks: [
    { marketId: 'win', side: 'no' },   // wins
    { marketId: 'kills', side: 'yes' },// loses
  ] });
  expect(settleParlayBet(par, gameStats)).toMatchObject({ won: false, payout: 0 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest server/tests/bets.test.js`
Expected: FAIL (old `bets.js` uses `marketTitle`/board-based settle).

- [ ] **Step 3: Rewrite `server/bets.js`**

```js
// server/bets.js
// Pure bet lifecycle. Bets reference a market by id, freeze odds from the priced
// board at placement, and settle against the finished game's stats.

const { marketWon, settleParlay } = require('../src/markets');
const { payout } = require('./economy');

function findMarket(board, id) {
  const m = board.find((x) => x.id === id);
  if (!m) throw new Error(`Marché inconnu: ${id}`);
  return m;
}

function sideOf(market, side) {
  if (side !== 'yes' && side !== 'no') throw new Error(`Côté invalide: ${side}`);
  return market[side];
}

function makeSingle({ player, board, marketId, side, stake }) {
  const sel = sideOf(findMarket(board, marketId), side);
  return { player, type: 'single', marketId, side, stake, odds: sel.odds };
}

function settleSingle(bet, gameStats) {
  const won = marketWon(bet.marketId, bet.side, gameStats);
  return { won, payout: payout(bet.stake, bet.odds, won) };
}

function makeParlay({ player, board, picks, stake }) {
  const legs = picks.map((p) => {
    const sel = sideOf(findMarket(board, p.marketId), p.side);
    return { marketId: p.marketId, side: p.side, odds: sel.odds };
  });
  return { player, type: 'parlay', picks: legs, stake };
}

function settleParlayBet(bet, gameStats) {
  const legs = bet.picks.map((p) => ({
    odds: p.odds,
    won: marketWon(p.marketId, p.side, gameStats),
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
git commit -m "refactor: bets reference market id, settle from gameStats"
```

---

### Task 3: Update `store.settleBets` + `demoBet` to settle from stats

**Files:**
- Modify: `server/store.js` (`settleBets` signature: board → gameStats)
- Modify: `server/tests/store.test.js` (the disabled-fallback call)
- Modify: `src/index.js` (`demoBet` passes gameStats; bet uses marketId)

**Interfaces:**
- Consumes: `settleSingle(bet, gameStats)`, `settleParlayBet(bet, gameStats)`.
- Produces: `settleBets(matchId, gameStats) -> {settled:number}` (unchanged return; second arg is now the finished-game stats object, passed straight to the settle fns).

- [ ] **Step 1: Update the store test call** — in `server/tests/store.test.js`, change the `settleBets` line to pass a stats object instead of `[]`:

```js
    await expect(store.settleBets('EUW1_1', { win: false })).resolves.toEqual({ settled: 0 });
```

- [ ] **Step 2: Update `settleBets` in `server/store.js`** — change the parameter name and what is passed to the settle functions. Find:

```js
async function settleBets(matchId, board) {
```
change to:
```js
async function settleBets(matchId, gameStats) {
```
and inside the loop, find:
```js
      const result = bet.type === 'parlay' ? settleParlayBet(bet, board) : settleSingle(bet, board);
```
change to:
```js
      const result = bet.type === 'parlay' ? settleParlayBet(bet, gameStats) : settleSingle(bet, gameStats);
```
(Leave everything else in `settleBets` unchanged.)

- [ ] **Step 3: Update `demoBet` in `src/index.js`** — it currently builds a board with `buildBoard`, makes a bet by `marketTitle`, and calls `settleBets(id, board)`. Change it to use a priced board + market id + settle from stats. Find the `demoBet` function and replace its body with:

```js
async function demoBet(riotId, matchId) {
  await db.init();
  const puuid = await getPuuid(riotId);
  const id = matchId || (await getRecentMatchIds(puuid, 1, { type: 'ranked' }))[0];
  if (!id) { console.log('Aucune game ranked trouvée.'); return; }

  const gameStats = extractStats(await getMatch(id), puuid);
  const history = await getRecentStats(puuid, 12, id);
  // Price the board as if pre-game (from form + champion/mode only).
  const board = priceBoard(history, { gameMode: gameStats.gameMode, champion: gameStats.champion });

  const user = 'demo';
  const before = await getBalance(user);
  const bet = makeSingle({ player: user, board, marketId: 'win', side: 'yes', stake: 50 });

  const placed = await placeBet(user, id, bet);
  console.log(`\n💰 ${user}: solde ${before} → pari 50 @${bet.odds.toFixed(2)} sur WIN`);
  if (!placed.ok) { console.log(`   ❌ pari refusé (${placed.error}). DB branchée ? (DATABASE_URL)`); return; }

  const { settled } = await settleBets(id, gameStats);
  const after = await getBalance(user);
  console.log(`   réglé (${settled} pari) → solde ${after} (${after - before >= 0 ? '+' : ''}${after - before})`);
}
```

Then update the import line in `src/index.js` that pulls from `./markets` to also import `priceBoard` (it currently imports `extractStats, buildBoard, settleParlay` — add `priceBoard`). Keep `buildBoard` in the import (still used by `printBoard`).

- [ ] **Step 4: Verify syntax + full suite**

Run: `node --check src/index.js && npm test`
Expected: `node --check` clean; all tests green (24 total).

- [ ] **Step 5: Commit**

```bash
git add server/store.js server/tests/store.test.js src/index.js
git commit -m "refactor: settle bets from gameStats end-to-end"
```

---

## Self-Review

**Spec coverage:** Enables pre-game odds (priceBoard, no result) + result-time settlement (marketWon/gameStats) — the prerequisite for opening betting events on in-progress games (next slice). ✓

**Placeholder scan:** No TBD/TODO; complete code in every step. ✓

**Type consistency:** `marketId` (def id string) used consistently across markets (`priceBoard` emits `id`, `marketWon` takes `marketId`), bets (`makeSingle`/`makeParlay` store `marketId`, settle via `marketWon`), store (`settleBets(matchId, gameStats)`), and `demoBet`. `side` is `'yes'|'no'` throughout. `priceBoard` market shape `{id,title,yes:{label,odds},no:{label,odds}}` matches what `bets.makeSingle` consumes. ✓
