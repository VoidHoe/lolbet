# Coupon Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat top-to-bottom market dump with a "who's in game" lobby → tap a friend → tabbed betting page (Combat / Objectives / Farm), plus a new "out-farm your lane opponent" market.

**Architecture:** Almost entirely a frontend rewrite of `server/public/index.html` (a single static page with a `view` state machine, no router). The only backend change is in `src/markets.js`: a `category` field on every market, one new market (`csvs`), and an `outFarmedOpponent` stat in `extractStats`. The betting engine, `/bet`, parlay logic, and settlement are unchanged — cross-player combinés already work because each player's markets are namespaced `slot:defId`.

**Tech Stack:** Node 20 (CommonJS), Jest, vanilla HTML/CSS/JS (no build step, no framework).

## Global Constraints

- Node 20+, CommonJS (`require`/`module.exports`). No new dependencies.
- French UI copy (matches existing app).
- `src/markets.js` is the single source of truth: a market is defined once (predicate + line + category) and used for both pricing and settlement — they must never drift.
- Events only open for ranked 5v5 (queues 420/440).
- Tests: Jest, run from repo root with `npm test`. Test files live in `server/tests/`.

---

### Task 1: Market categories (`cat` field)

Add a `cat` field to every market definition and emit it on every board item, so the frontend can group markets into tabs.

**Files:**
- Modify: `src/markets.js`
- Test: `server/tests/markets.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: every `MARKET_DEFS` entry has `cat` ∈ `{'result','combat','objectives','farm'}`. Board items from `priceBoard`, `priceMultiBoard`, and `buildBoard` each include a `cat: string` field.

- [ ] **Step 1: Write the failing test**

Add to `server/tests/markets.test.js`:

```javascript
const { MARKET_DEFS, priceMultiBoard } = require('../../src/markets');

test('every market def has a valid category', () => {
  const valid = new Set(['result', 'combat', 'objectives', 'farm']);
  for (const def of MARKET_DEFS) {
    expect(valid.has(def.cat)).toBe(true);
  }
});

test('priceMultiBoard items carry slot, defId and cat', () => {
  const players = [{ slot: 'p0', puuid: 'x', name: 'Ahri', history }];
  const board = priceMultiBoard(players, 'CLASSIC');
  const kills = board.find((m) => m.defId === 'kills');
  expect(kills.slot).toBe('p0');
  expect(kills.cat).toBe('combat');
  const win = board.find((m) => m.defId === 'win');
  expect(win.cat).toBe('result');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- markets.test.js`
Expected: FAIL — `def.cat` is undefined, `valid.has(undefined)` is false; `kills.cat` is undefined.

- [ ] **Step 3: Add `cat` to every market def**

In `src/markets.js`, replace the `MARKET_DEFS` array (lines ~52-69) with the same defs plus a `cat` on each:

```javascript
const MARKET_DEFS = [
  { id: 'win',    cat: 'result',     title: (s) => `Résultat (${s.champion})`, kind: 'binary', yes: 'WIN', no: 'LOSE', mode: 'all', test: (s) => s.win },
  { id: 'kills',  cat: 'combat',     title: () => 'Kills',   kind: 'ou', line: LINES.kills,   mode: 'all', value: (s) => s.kills },
  { id: 'deaths', cat: 'combat',     title: () => 'Deaths',  kind: 'ou', line: LINES.deaths,  mode: 'all', value: (s) => s.deaths },
  { id: 'assists',cat: 'combat',     title: () => 'Assists', kind: 'ou', line: LINES.assists, mode: 'all', value: (s) => s.assists },
  { id: 'fbself', cat: 'combat',     title: () => 'Fait le First Blood', kind: 'binary', yes: 'OUI', no: 'NON', mode: 'all', test: (s) => s.firstBloodKill },
  { id: 'mk2',    cat: 'combat',     title: () => 'Multi-kill (double+)', kind: 'binary', yes: 'OUI', no: 'NON', mode: 'all', test: (s) => s.largestMultiKill >= 2 },
  { id: 'mk3',    cat: 'combat',     title: () => 'Triple kill+',         kind: 'binary', yes: 'OUI', no: 'NON', mode: 'all', test: (s) => s.largestMultiKill >= 3 },
  // Summoner's Rift only
  { id: 'cs',     cat: 'farm',       title: () => 'CS (farm)',           kind: 'ou', line: LINES.cs,        mode: 'classic', value: (s) => s.cs },
  { id: 'gkills', cat: 'combat',     title: () => 'Kills totaux (game)', kind: 'ou', line: LINES.totalKills, mode: 'classic', value: (s) => s.totalKills },
  { id: 'drakes', cat: 'objectives', title: () => 'Dragons (équipe)',    kind: 'ou', line: LINES.dragons,   mode: 'classic', value: (s) => s.teamDragons },
  { id: 'dur',    cat: 'farm',       title: () => 'Durée (min)',         kind: 'ou', line: LINES.durMin,     mode: 'classic', value: (s) => Math.floor(s.durationSec / 60) },
  { id: 'fbteam', cat: 'objectives', title: () => 'First Blood',     kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.fbMine },
  { id: 'fdteam', cat: 'objectives', title: () => 'Premier Dragon',  kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.fdMine },
  { id: 'fbaron', cat: 'objectives', title: () => 'Premier Baron',   kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.fbaronMine },
  { id: 'ftower', cat: 'objectives', title: () => 'Première Tour',   kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.ftowerMine },
];
```

- [ ] **Step 4: Emit `cat` on board items**

In `priceMultiBoard` (the `board.push({...})` call, ~line 159), add `cat: def.cat`:

```javascript
      board.push({
        id: p.slot + ':' + def.id,
        kind: 'player', slot: p.slot, puuid: p.puuid, name: p.name, defId: def.id, cat: def.cat,
        title: p.name + ' · ' + baseTitle(def),
        yes: { label: lab.yes, odds: price.oddsYes },
        no: { label: lab.no, odds: price.oddsNo },
      });
```

In `priceBoard` (the `return {...}` inside `.map`, ~line 136), add `cat: def.cat` and `defId: def.id`:

```javascript
      return {
        id: def.id,
        defId: def.id,
        cat: def.cat,
        title: def.title({ champion: meta.champion }),
        yes: { label: lab.yes, odds: price.oddsYes },
        no: { label: lab.no, odds: price.oddsNo },
      };
```

In `buildBoard` (the `return {...}` inside `.map`, ~line 102), add `cat: def.cat` and `defId: def.id`:

```javascript
      return {
        id: def.id,
        defId: def.id,
        cat: def.cat,
        title: def.title(gameStats),
        sample: price.n,
        hits: price.hits,
        yes: { label: yesLabel, odds: price.oddsYes, won: yesWon },
        no: { label: noLabel, odds: price.oddsNo, won: !yesWon },
      };
```

- [ ] **Step 5: Export `MARKET_DEFS` (already exported) and run tests**

`MARKET_DEFS` is already in the `module.exports` list — no change needed.

Run: `npm test -- markets.test.js`
Expected: PASS (all tests, including the existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/markets.js server/tests/markets.test.js
git commit -m "feat: category field on markets + emit cat on board items"
```

---

### Task 2: "Out-farm your lane opponent" market (`csvs`)

Add the `outFarmedOpponent` stat to `extractStats`, make pricing skip null samples, and register the `csvs` market in the `farm` category.

**Files:**
- Modify: `src/markets.js`
- Test: `server/tests/markets.test.js`

**Interfaces:**
- Consumes: `extractStats(match, puuid)` (existing). A raw match-v5 object's `info.participants[]` carries `teamPosition`, `individualPosition`, `totalMinionsKilled`, `neutralMinionsKilled`, `teamId`, `puuid`.
- Produces: `extractStats` returns `outFarmedOpponent: boolean | null`. New market def `csvs` (cat `farm`, classic-only, binary). `priceMarket` honors an optional `def.sample(stat) → boolean` filter.

- [ ] **Step 1: Write the failing test**

Add to `server/tests/markets.test.js`:

```javascript
const { extractStats, priceMarket, marketWon } = require('../../src/markets');

function fakeMatch({ myCs, oppCs, oppPos = 'MIDDLE', myPos = 'MIDDLE' }) {
  return {
    metadata: { matchId: 'EUW1_1' },
    info: {
      queueId: 420, gameMode: 'CLASSIC', gameDuration: 1800,
      teams: [
        { teamId: 100, objectives: {} },
        { teamId: 200, objectives: {} },
      ],
      participants: [
        { puuid: 'ME', teamId: 100, championName: 'Ahri', win: true, kills: 1, deaths: 1, assists: 1,
          totalMinionsKilled: myCs, neutralMinionsKilled: 0, teamPosition: myPos, individualPosition: myPos,
          largestMultiKill: 1, firstBloodKill: false },
        { puuid: 'OPP', teamId: 200, championName: 'Zed', win: false, kills: 1, deaths: 1, assists: 1,
          totalMinionsKilled: oppCs, neutralMinionsKilled: 0, teamPosition: oppPos, individualPosition: oppPos,
          largestMultiKill: 1, firstBloodKill: false },
      ],
    },
  };
}

test('extractStats: outFarmedOpponent true when player out-CSes lane opponent', () => {
  expect(extractStats(fakeMatch({ myCs: 200, oppCs: 150 }), 'ME').outFarmedOpponent).toBe(true);
});

test('extractStats: outFarmedOpponent false when out-CSed by lane opponent', () => {
  expect(extractStats(fakeMatch({ myCs: 100, oppCs: 150 }), 'ME').outFarmedOpponent).toBe(false);
});

test('extractStats: outFarmedOpponent null when no lane opponent resolvable', () => {
  expect(extractStats(fakeMatch({ myCs: 200, oppCs: 150, myPos: '' }), 'ME').outFarmedOpponent).toBe(null);
});

test('csvs market: YES wins when out-farmed, settles null as loss', () => {
  const won = extractStats(fakeMatch({ myCs: 200, oppCs: 150 }), 'ME');
  expect(marketWon('csvs', 'yes', won)).toBe(true);
  const nullStat = extractStats(fakeMatch({ myCs: 200, oppCs: 150, myPos: '' }), 'ME');
  expect(marketWon('csvs', 'yes', nullStat)).toBe(false);
});

test('priceMarket skips null samples via def.sample', () => {
  const def = { kind: 'binary', test: (s) => s.outFarmedOpponent === true, sample: (s) => s.outFarmedOpponent !== null };
  const hist = [{ outFarmedOpponent: true }, { outFarmedOpponent: true }, { outFarmedOpponent: null }];
  const price = priceMarket(def, hist);
  expect(price.n).toBe(2); // null excluded from sample
  expect(price.hits).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- markets.test.js`
Expected: FAIL — `outFarmedOpponent` undefined, `marketWon('csvs', ...)` throws "Marché inconnu: csvs", `priceMarket` ignores `def.sample` so `price.n` is 3.

- [ ] **Step 3: Add `outFarmedOpponent` to `extractStats`**

In `src/markets.js`, inside `extractStats`, after the `enemyTeam` line and before the `return`, add the lane-opponent comparison:

```javascript
  const myCs = (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0);
  const myPos = me.teamPosition || me.individualPosition || '';
  let outFarmedOpponent = null;
  if (myPos) {
    const opp = (info.participants || []).find(
      (p) => p.teamId !== me.teamId && (p.teamPosition || p.individualPosition) === myPos
    );
    if (opp) {
      const oppCs = (opp.totalMinionsKilled ?? 0) + (opp.neutralMinionsKilled ?? 0);
      outFarmedOpponent = myCs > oppCs;
    }
  }
```

Then in the returned object, replace the existing `cs:` line and add the new field:

```javascript
    cs: myCs,
    outFarmedOpponent,
```

(Remove the old `cs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0),` line — `myCs` now holds it.)

- [ ] **Step 4: Make `priceMarket` honor `def.sample`**

In `src/markets.js`, replace the body of `priceMarket` (lines ~76-83) with:

```javascript
function priceMarket(def, history) {
  const usable = def.sample ? history.filter(def.sample) : history;
  const n = usable.length;
  const hits = def.kind === 'binary'
    ? usable.filter(def.test).length
    : usable.filter((s) => def.value(s) > def.line).length;
  const pYes = n > 0 ? smoothedProb(hits, n) : 0.5;
  return { n, hits, pYes, oddsYes: priceFromProb(pYes), oddsNo: priceFromProb(1 - pYes) };
}
```

- [ ] **Step 5: Register the `csvs` market**

In `MARKET_DEFS`, add this entry in the Summoner's Rift section (e.g. right after the `cs` entry):

```javascript
  { id: 'csvs', cat: 'farm', title: () => "Plus de CS que l'adversaire direct", kind: 'binary', yes: 'OUI', no: 'NON', mode: 'classic', sample: (s) => s.outFarmedOpponent !== null, test: (s) => s.outFarmedOpponent === true },
```

- [ ] **Step 6: Run tests**

Run: `npm test -- markets.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite (settlement must still pass)**

Run: `npm test`
Expected: PASS — `markets`, `store`, `bets`, `multiboard`, etc. The `csvs` leg settles through the existing `marketWon` → `legWon` → `settleBet` path with no engine changes.

- [ ] **Step 8: Commit**

```bash
git add src/markets.js server/tests/markets.test.js
git commit -m "feat: csvs market (out-farm lane opponent) + null-safe pricing"
```

---

### Task 3: Frontend redesign — lobby → player page + floating coupon

Rewrite the betting section of `server/public/index.html`: a "who's in game" lobby of player cards, a per-player tabbed page (Result on top; Combat / Objectives / Farm tabs), and a floating coupon that persists across views and mixes picks across friends.

**Files:**
- Modify: `server/public/index.html` (full file replacement below).

**Interfaces:**
- Consumes: `/api/events` returns `[{ match_id, riot_id, champion, queue_id, board }]`; board items have `{ id, slot, name, defId, cat, title, yes:{label,odds}, no:{label,odds} }`. `/api/bet` accepts `{ matchId, stake, picks:[{marketId, side}] }`. `/api/me`, `/api/accounts`, `/api/bets`, `/api/login`, `/api/register`, `/api/logout`, `/api/link` unchanged.
- Produces: nothing consumed by other tasks (terminal UI task).

- [ ] **Step 1: Replace `server/public/index.html` with the new version**

Write the entire file:

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>lolbet</title>
<style>
  :root { --bg:#0e1015; --card:#1a1d27; --ink:#e7e9ee; --mut:#8a90a2; --acc:#f0b132; --win:#3ad17a; --lose:#e2545a; }
  * { box-sizing:border-box; } body { margin:0; font-family:system-ui,sans-serif; background:var(--bg); color:var(--ink); }
  header { padding:14px 18px; background:var(--card); display:flex; justify-content:space-between; align-items:center; }
  header b { color:var(--acc); } .bal { color:var(--acc); font-weight:700; }
  main { max-width:760px; margin:0 auto; padding:18px; padding-bottom:240px; }
  .card { background:var(--card); border-radius:12px; padding:16px; margin-bottom:16px; }
  h2 { margin:0 0 10px; font-size:15px; color:var(--mut); text-transform:uppercase; letter-spacing:.5px; }
  input,button { font:inherit; padding:9px 12px; border-radius:8px; border:1px solid #2b2f3c; background:#11141c; color:var(--ink); }
  button { background:var(--acc); color:#1a1205; border:0; font-weight:700; cursor:pointer; }
  button.ghost { background:#222633; color:var(--ink); }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .ev { border:1px solid #262a36; border-radius:10px; padding:12px; margin-bottom:10px; }
  .ev h3 { margin:0 0 8px; font-size:15px; }
  .muted { color:var(--mut); font-size:13px; }

  /* Lobby */
  .lobby { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; margin-top:8px; }
  .pcard { display:flex; flex-direction:column; align-items:center; gap:6px; background:#222633; border:1px solid #2b2f3c; border-radius:12px; padding:14px 10px; cursor:pointer; color:var(--ink); }
  .pcard:hover { background:#2c3142; border-color:var(--acc); }
  .ava { width:46px; height:46px; border-radius:50%; background:var(--acc); color:#1a1205; font-weight:800; font-size:20px; display:flex; align-items:center; justify-content:center; }
  .pname { font-weight:700; font-size:14px; }
  .live { font-size:11px; color:var(--win); }

  /* Player page */
  .phead { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .phead h3 { margin:0; font-size:18px; }
  .back { padding:6px 10px; }
  .card2 { background:#11141c; border:1px solid #262a36; border-radius:10px; padding:10px 12px; margin-bottom:10px; }
  .result { display:flex; gap:8px; margin-top:6px; }
  .result .odd { flex:1; text-align:center; }
  .tabs { display:flex; gap:6px; margin-bottom:10px; }
  .tab { flex:1; background:#222633; color:var(--mut); border:1px solid #2b2f3c; padding:8px; border-radius:8px; cursor:pointer; font-weight:700; }
  .tab.on { background:#3a2f12; border-color:var(--acc); color:var(--ink); }

  .mkt { display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-top:1px solid #20242f; }
  .mkt:first-child { border-top:0; }
  .mkt .sides { display:flex; gap:6px; }
  .odd { background:#222633; border:1px solid transparent; color:var(--ink); padding:6px 9px; border-radius:7px; cursor:pointer; font-weight:600; }
  .odd:hover { background:#2c3142; }
  .odd.sel { background:#3a2f12; border-color:var(--acc); }
  .odd b { color:var(--acc); }

  /* Coupon (floating bottom sheet) */
  .slipbar { position:fixed; left:0; right:0; bottom:0; max-width:760px; margin:0 auto; background:var(--card); border-top:1px solid #2b2f3c; border-radius:12px 12px 0 0; padding:12px 16px; box-shadow:0 -6px 24px rgba(0,0,0,.45); }
  .slipbar h2 { margin:0 0 8px; }
  .bet { display:flex; justify-content:space-between; padding:5px 0; font-size:14px; font-weight:600; }
  .x { padding:2px 7px; }

  /* History */
  .ticket { border:1px solid #262a36; border-radius:10px; padding:8px 12px; margin-bottom:8px; }
  .leg { display:flex; justify-content:space-between; padding:3px 0; font-size:13px; border-top:1px solid #20242f; }
  .won { color:var(--win); } .lost { color:var(--lose); }
  .hide { display:none; }
</style>
</head>
<body>
<header><span><b>lolbet</b> 🎰</span><span id="who" class="muted"></span></header>
<main>
  <div class="card" id="authCard">
    <h2>Connexion</h2>
    <div class="row">
      <input id="u" placeholder="pseudo" /><input id="p" type="password" placeholder="mot de passe" />
      <button onclick="login()">Login</button><button class="ghost" onclick="register()">Créer</button>
    </div>
    <div id="authMsg" class="muted"></div>
  </div>

  <div id="app" class="hide">
    <div class="card">
      <h2>Mes comptes LoL</h2>
      <div id="accs" class="muted"></div>
      <div class="row" style="margin-top:8px">
        <input id="riot" placeholder="Pseudo#TAG" /><button onclick="link()">Lier</button>
      </div>
      <div id="linkMsg" class="muted"></div>
    </div>

    <div class="card">
      <h2>Paris en cours</h2>
      <div id="view" class="muted">Aucun event ouvert. Lance une ranked (avec le poller actif) 👀</div>
    </div>

    <div class="card">
      <h2>Mes paris</h2>
      <div id="bets" class="muted">—</div>
    </div>
    <button class="ghost" onclick="logout()">Déconnexion</button>
  </div>
</main>

<div id="slip" class="slipbar hide">
  <h2>Coupon</h2>
  <div id="slipLegs"></div>
  <div class="row" style="margin-top:8px">
    <input id="stake" type="number" min="1" value="50" style="width:90px" oninput="renderSlip()" />
    <button onclick="placeSlip()">Parier</button>
    <button class="ghost" onclick="clearSlip()">Vider</button>
  </div>
  <div id="slipInfo" class="muted" style="margin-top:8px"></div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const api = (p, opt) => fetch('/api' + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt)).then((r) => r.json());
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

let poll = null;
let slip = [];          // coupon: [{matchId, marketId, side}]
let eventsCache = [];   // last /events payload
const boards = {};      // matchId → board (for odds/labels)
let view = 'lobby';     // 'lobby' | 'player'
let curMatch = null, curSlot = null, curTab = 'combat';

const CATS = [{ key:'combat', label:'Combat' }, { key:'objectives', label:'Objectifs' }, { key:'farm', label:'Farm' }];
// Fallback for board items created before the cat field existed.
const CAT_OF = { win:'result', kills:'combat', deaths:'combat', assists:'combat', fbself:'combat', mk2:'combat', mk3:'combat', gkills:'combat', fbteam:'objectives', fdteam:'objectives', fbaron:'objectives', ftower:'objectives', drakes:'objectives', cs:'farm', dur:'farm', csvs:'farm' };
const defOf = (m) => m.defId || String(m.id || '').split(':').pop();
const catOf = (m) => m.cat || CAT_OF[defOf(m)] || 'combat';
const queueName = (q) => q === 440 ? 'Flex' : q === 420 ? 'Solo/Duo' : 'Ranked';
const shortTitle = (t) => { const p = String(t).split(' · '); return p.length > 1 ? p.slice(1).join(' · ') : t; };

function setBal(me) { $('who').innerHTML = esc(me.username) + ' · <span class="bal">' + me.balance + ' Clout</span>'; }

async function refresh() {
  const me = await api('/me').catch(() => null);
  if (!me || !me.username) {
    $('authCard').classList.remove('hide'); $('app').classList.add('hide'); $('who').textContent = '';
    if (poll) { clearInterval(poll); poll = null; }
    return;
  }
  $('authCard').classList.add('hide'); $('app').classList.remove('hide');
  setBal(me);
  renderAccounts(); await loadEvents(); renderBets();
  if (!poll) poll = setInterval(tick, 12000);
}
async function tick() {
  const me = await api('/me').catch(() => null);
  if (!me || !me.username) { if (poll) { clearInterval(poll); poll = null; } return; }
  setBal(me);
  await loadEvents(); renderBets();
}
async function register() {
  const r = await api('/register', { method:'POST', body: JSON.stringify({ username:$('u').value, password:$('p').value }) });
  $('authMsg').textContent = r.ok ? 'Compte créé, connecte-toi.' : 'Échec: ' + r.error;
}
async function login() {
  const r = await api('/login', { method:'POST', body: JSON.stringify({ username:$('u').value, password:$('p').value }) });
  if (r.ok) refresh(); else $('authMsg').textContent = 'Échec: ' + r.error;
}
async function logout() { await api('/logout', { method:'POST' }); refresh(); }
async function link() {
  const r = await api('/link', { method:'POST', body: JSON.stringify({ riotId:$('riot').value }) });
  $('linkMsg').textContent = r.ok ? 'Lié ✅' : 'Échec: ' + r.error; renderAccounts();
}
async function renderAccounts() {
  const a = await api('/accounts');
  $('accs').textContent = a.length ? a.map((x) => x.riot_id).join(' · ') : 'aucun compte lié';
}

async function loadEvents() {
  eventsCache = await api('/events');
  for (const ev of eventsCache) boards[ev.match_id] = ev.board || [];
  render();
}

// ---- View router ----
function render() {
  if (view === 'player') {
    const ev = eventsCache.find((e) => e.match_id === curMatch);
    const items = ev ? (ev.board || []).filter((m) => (m.slot || 'p0') === curSlot) : [];
    if (!ev || !items.length) view = 'lobby'; // player/game gone → fall back
  }
  if (view === 'player') renderPlayer(); else renderLobby();
  renderSlip(); markSelected();
}

function playersOf(ev) {
  const map = {};
  for (const m of ev.board || []) {
    const slot = m.slot || 'p0';
    if (!map[slot]) map[slot] = { slot, name: m.name || ev.champion || ev.riot_id || 'Joueur' };
  }
  return Object.values(map);
}

function renderLobby() {
  if (!eventsCache.length) { $('view').className = 'muted'; $('view').textContent = 'Aucun event ouvert. Lance une ranked (avec le poller actif) 👀'; return; }
  $('view').className = '';
  $('view').innerHTML = eventsCache.map((ev) => {
    const cards = playersOf(ev).map((p) =>
      '<button class="pcard" onclick="openPlayer(\'' + ev.match_id + '\',\'' + p.slot + '\')">' +
        '<span class="ava">' + esc((p.name[0] || '?').toUpperCase()) + '</span>' +
        '<span class="pname">' + esc(p.name) + '</span>' +
        '<span class="live">● live</span>' +
      '</button>').join('');
    return '<div class="ev"><h3>🎮 ' + queueName(ev.queue_id) + '</h3><div class="lobby">' + cards + '</div></div>';
  }).join('');
}

function openPlayer(matchId, slot) { curMatch = matchId; curSlot = slot; curTab = 'combat'; view = 'player'; render(); }
function back() { view = 'lobby'; render(); }
function setTab(t) { curTab = t; render(); }

function oddBtn(matchId, m, side) {
  const s = m[side]; if (!s) return '';
  return '<button class="odd" id="o_' + matchId + '_' + m.id + '_' + side + '" ' +
    'onclick="pick(\'' + matchId + '\',\'' + m.id + '\',\'' + side + '\')">' +
    esc(s.label) + ' <b>' + s.odds.toFixed(2) + '</b></button>';
}

function renderPlayer() {
  const ev = eventsCache.find((e) => e.match_id === curMatch);
  const items = (ev.board || []).filter((m) => (m.slot || 'p0') === curSlot);
  const name = (items[0] && items[0].name) || ev.champion || 'Joueur';
  const winM = items.find((m) => defOf(m) === 'win');
  const result = winM ? '<div class="result">' + oddBtn(ev.match_id, winM, 'yes') + oddBtn(ev.match_id, winM, 'no') + '</div>' : '<div class="muted">—</div>';
  const tabs = CATS.map((c) => '<button class="tab' + (c.key === curTab ? ' on' : '') + '" onclick="setTab(\'' + c.key + '\')">' + c.label + '</button>').join('');
  const rows = items.filter((m) => defOf(m) !== 'win' && catOf(m) === curTab).map((m) =>
    '<div class="mkt"><span>' + esc(shortTitle(m.title)) + '</span>' +
    '<span class="sides">' + oddBtn(ev.match_id, m, 'yes') + oddBtn(ev.match_id, m, 'no') + '</span></div>'
  ).join('') || '<div class="muted">Aucun marché ici.</div>';
  $('view').className = '';
  $('view').innerHTML =
    '<div class="phead"><button class="ghost back" onclick="back()">← Retour</button><h3>' + esc(name) + '</h3></div>' +
    '<div class="card2"><div class="muted">Résultat</div>' + result + '</div>' +
    '<div class="tabs">' + tabs + '</div>' +
    '<div class="card2">' + rows + '</div>';
}

// ---- Coupon (1 pick = simple, plusieurs = combiné; mixe les amis du même match) ----
function selOf(matchId, marketId, side) {
  const m = (boards[matchId] || []).find((x) => x.id === marketId);
  return m ? m[side] : null;
}
function pick(matchId, marketId, side) {
  if (slip.length && slip[0].matchId !== matchId) slip = []; // un seul match à la fois
  const i = slip.findIndex((p) => p.marketId === marketId);
  if (i >= 0) {
    if (slip[i].side === side) slip.splice(i, 1); // re-clic = retire
    else slip[i].side = side;                     // autre côté = bascule
  } else {
    slip.push({ matchId, marketId, side });
  }
  renderSlip(); markSelected();
}
function markSelected() {
  document.querySelectorAll('.odd').forEach((b) => b.classList.remove('sel'));
  for (const p of slip) {
    const el = document.getElementById('o_' + p.matchId + '_' + p.marketId + '_' + p.side);
    if (el) el.classList.add('sel');
  }
}
function renderSlip() {
  const bar = $('slip');
  if (!slip.length) { bar.classList.add('hide'); return; }
  bar.classList.remove('hide');
  let combined = 1;
  $('slipLegs').innerHTML = slip.map((p) => {
    const m = (boards[p.matchId] || []).find((x) => x.id === p.marketId);
    const s = selOf(p.matchId, p.marketId, p.side);
    combined *= s.odds;
    return '<div class="bet"><span>' + esc(m ? m.title : p.marketId) + ' · ' + esc(s.label) + '</span><span>@' + s.odds.toFixed(2) +
      ' <button class="ghost x" onclick="pick(\'' + p.matchId + '\',\'' + p.marketId + '\',\'' + p.side + '\')">✕</button></span></div>';
  }).join('');
  const stake = Number($('stake').value) || 0;
  const kind = slip.length > 1 ? 'Combiné ×' + combined.toFixed(2) : 'Simple @' + combined.toFixed(2);
  $('slipInfo').textContent = kind + ' — gain potentiel : ' + Math.round(stake * combined) + ' Clout';
}
function clearSlip() { slip = []; render(); }
async function placeSlip() {
  if (!slip.length) return;
  const stake = Number($('stake').value);
  const r = await api('/bet', { method:'POST', body: JSON.stringify({
    matchId: slip[0].matchId, stake, picks: slip.map((p) => ({ marketId: p.marketId, side: p.side })),
  }) });
  if (r.ok) { slip = []; refresh(); }
  else { $('slipInfo').textContent = 'Pari refusé: ' + r.error; }
}

async function renderBets() {
  const bs = await api('/bets');
  if (!bs.length) { $('bets').textContent = 'aucun pari'; return; }
  $('bets').innerHTML = bs.map((b) => {
    const cls = b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'muted';
    const res = b.status === 'open' ? 'en cours'
      : b.status === 'won' ? 'GAGNÉ +' + b.payout
      : b.status === 'pushed' ? 'remboursé'
      : 'PERDU';
    const kind = (b.type === 'parlay' ? 'Combiné ×' + b.combinedOdds.toFixed(2) : 'Simple @' + b.combinedOdds.toFixed(2));
    const legs = (b.legs || []).map((l) =>
      '<div class="leg"><span>' + esc(l.title) + ' · <b>' + esc(l.side) + '</b></span><span class="muted">@' + l.odds.toFixed(2) + '</span></div>'
    ).join('');
    return '<div class="ticket">' +
      '<div class="bet"><span>' + kind + ' · mise ' + b.stake + '</span><span class="' + cls + '">' + res + '</span></div>' +
      legs +
      '<div class="muted" style="font-size:11px">' + esc(b.matchId) + '</div></div>';
  }).join('');
}
refresh();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual verification — start the server**

Run (PowerShell, from repo root):

```
npm run serve
```

Open the printed URL (default `http://localhost:3000`). Log in with an existing account.

- [ ] **Step 3: Manual verification — checklist**

Verify against a live event (or a demo event — see Task notes). Confirm each:
- The "Paris en cours" card shows a **lobby** of player cards (one per linked friend in the game), each with an avatar circle, name, and "● live". No top-to-bottom market dump.
- Clicking a card opens the **player page**: name header with "← Retour", a "Résultat" line with WIN/LOSE odds, and three tabs **Combat / Objectifs / Farm**.
- Switching tabs swaps the market rows; **Farm** shows CS, "Plus de CS que l'adversaire direct", and Durée.
- Clicking an odds button adds it to the **floating coupon** at the bottom; the coupon persists when you go Back to the lobby and open a different friend.
- Picking markets from **two different friends** in the same game builds a combiné (the coupon lists both, combined odds multiply).
- "Parier" places the bet and it appears under "Mes paris"; "Vider" clears the coupon.

- [ ] **Step 4: Commit**

```bash
git add server/public/index.html
git commit -m "feat: lobby → player betting pages + floating cross-friend coupon"
```

---

## Task notes — getting a board to test against

Task 3's manual checklist needs at least one open event. Options:
- A real ranked game with ≥1 linked account currently in it (the poller opens an event ~30s in).
- The existing demo path used in development (see `package.json` scripts / `server/` for a demo-bet or demo-event helper if present). If a demo helper exists, run it to seed a multiplayer event, then verify the UI.

If no live game and no demo helper is available, verification is limited to the empty-lobby state ("Aucun event ouvert") plus a code read-through; note that in the commit/PR.

---

## Self-Review

**Spec coverage:**
- Navigation (lobby → player) → Task 3 (`renderLobby`, `openPlayer`, `renderPlayer`, `back`). ✓
- Categories Combat/Objectives/Farm + Result on top → Task 1 (`cat` field) + Task 3 (tabs, result line). ✓
- Coupon mixes picks across friends → Task 3 (`pick` resets only on different `matchId`; combiné across slots). ✓
- New `csvs` market + `outFarmedOpponent` + null-safe pricing + null-as-loss settlement → Task 2. ✓
- Frontend derives player list from board `slot` grouping (no event schema change) → Task 3 (`playersOf`). ✓
- Fallback `defId → cat` map for old events → Task 3 (`CAT_OF`, `catOf`). ✓
- Testing (markets cat, priceMultiBoard cat, extractStats outFarmedOpponent, csvs, null sampling) → Tasks 1 & 2. ✓
- Deferred (gold markets, champion portraits, @15 variant) → not implemented, by design. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full; the new `index.html` is a complete file. ✓

**Type consistency:** Board item fields (`id`, `slot`, `name`, `defId`, `cat`, `title`, `yes/no.{label,odds}`) are produced in Task 1 and consumed by the same names in Task 3. `outFarmedOpponent` (boolean|null) defined in Task 2 `extractStats`, consumed by `csvs.test`/`sample` in the same task. `def.sample` predicate defined and consumed in Task 2. `priceMarket` return shape `{n,hits,pYes,oddsYes,oddsNo}` unchanged. ✓
