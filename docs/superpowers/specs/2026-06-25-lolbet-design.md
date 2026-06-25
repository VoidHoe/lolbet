# lolbet — Design Spec

> Working name. A sportsbook for betting virtual currency on your friends' ranked
> League of Legends games. Spun off from MemeDrop on 2026-06-25.

## 1. Vision

A private betting app for a friend group. When anyone in the group launches a
ranked LoL game on any of their accounts, it surfaces for everyone to bet on —
like a real sportsbook, with odds, live in-play odds that move with the game,
combinés (parlays), and a virtual currency you grow through an idle game on the
side. No real money. Pure fun + trash-talk fuel.

## 2. What's already proven (de-risk prototype)

A throwaway Node CLI (`src/`) validated every hard technical unknown against
real data (test account `GraveDigger#v0id`, EUW):

- **Resolve + read games** — Riot ID → PUUID (account-v1) → game result & stats
  (match-v5, `europe` routing).
- **Ranked-only filter** — match ids via `?type=ranked` (queues 420 solo + 440 flex).
- **Auto-detection** — poll match history; a finished ranked game is detected
  ~30s later and settled with zero human input. Confirmed live.
- **Form-based odds** — odds priced from the player's last 5 same-mode games
  (Laplace-smoothed hit-rate → `1/p` shortened by vig). Confirmed: a support
  profile prices "Kills +7.5" long and "Assists +8.5" short.
- **Live game state** — the **Live Client Data API** (`https://127.0.0.1:2999`,
  local, self-signed cert) streams gold / CS / kills / towers / dragons in real
  time. Proven in Practice Tool: values updated live as the player farmed and
  took objectives.

**Conclusion: no remaining technical unknowns.** Everything below is building,
not proving.

## 3. Scope & non-goals

**In scope (v1 horizon):** ranked Solo/Flex only; virtual currency; friend-group
scale (tens of users); fixed-odds book with form + live pricing; combinés;
account system with multi-account linking; idle-clicker faucet.

**Non-goals:** real money (legal/licensing — never); non-ranked modes (Arena,
ARAM, Swiftplay, normals); public/open signup at scale; anti-cheat against
collusion (friend-group trust assumed).

## 4. Architecture

Mirrors the MemeDrop stack (the team already knows it):

| Layer | Tech | Role |
|-------|------|------|
| Backend | Node + Express | API, auth, bet engine, settlement |
| DB | Postgres | users, linked accounts, bets, balances, ledger |
| Realtime | socket.io | push odds + bet events to clients |
| Desktop client | Electron | runs on the in-game player's PC; reads `localhost:2999`; streams live state |
| Poller | Node service | watches all linked accounts (match history + spectator) |

**Live data flow:**
```
In-game player's Electron client → reads localhost:2999 (live state)
   → streams to backend → backend computes P(win) → live odds
   → socket.io push to all bettors → they bet (odds frozen at placement)
   → game ends → match-v5 settles every market → balances updated
```

**Client model (decision):** desktop-first. The in-game player MUST run the
Electron client (only their machine can read live state). Bettors use the same
desktop app. A web bettor view is a possible later addition, not v1.

## 5. Data sources (Riot)

- **account-v1** — Riot ID → PUUID (link accounts).
- **match-v5** `?type=ranked` — detect finished ranked games; final stats for settlement.
- **spectator-v5** — detect a linked account *entering* a game (opens the market
  before the player's own client is even up). Secondary to the Live Client feed.
- **Live Client Data API** (local, per-player) — real-time in-game state for live odds.
- **match-v5 timeline** (future) — frame-by-frame events for *timing* markets
  ("5 kills before 10min"). Not in v1.

**Keys:** dev key expires every 24h. A **production key** (Riot app registration)
is required before real use.

## 6. Markets & odds

15 two-sided markets (both sides always bettable). Single source of truth:
`MARKET_DEFS` define each market's predicate ONCE, used for both pricing and
settlement so odds and results can't drift.

- **Player:** result W/L, kills O/U, deaths O/U, assists O/U, first blood (self),
  multi-kill (double+/triple+).
- **Team/game:** CS O/U, total kills O/U, dragons O/U, duration O/U, first blood,
  first dragon, first baron, first tower (all team-vs-team).
- **Combinés (parlays):** stack N selections, odds multiply, all must hit.

**Two odds phases:**
1. **Opening (pre-game):** form-based — `p = smoothed hit-rate over last 5 ranked
   games`, `odds = (1/p) × (1 − vig)`, clamped [1.05, 15.0].
2. **Live (in-game):** a win-probability model recomputes P(win) each tick from
   the live state and moves the relevant odds. **Odds freeze at the moment a bet
   is placed** (like a real book).

**v1 win-prob model:** heuristic logistic on per-team diffs — gold proxy
(CS×~20 + kills×~300, since only the active player's gold is exposed), tower
diff, dragon/baron diff, level diff — scaled by game time (leads matter more
late). No ML in v1.

## 7. Economy (the heart — anti-inflation)

**Model: fixed-odds bookmaker** (NOT parimutuel). This follows directly from
wanting form + live moving odds, which are bookmaker concepts. (Parimutuel pools
are a possible future alternate mode.)

**Currency:** virtual ("Clout"-style). Server-authoritative, every change written
to an append-only ledger.

**Faucet (Clout in):** the **idle clicker** is the primary, controlled source
(see §10 — needs its own design pass). Plus a starting balance and maybe a small
daily allowance so the broke stay in the game.

**Sink (Clout out / anti-inflation):** the **house edge**. Every market's odds
bake in a ~6% vig, so over many bets the house nets positive — and that net is
**burned** (removed from circulation). Betting is therefore a slow, activity-
proportional Clout sink. The house bankroll is finite and system-managed (it is
NOT an infinite source — that's what would cause runaway inflation).

**Balance rule:** tune idle-clicker output ≈ expected house-edge burn, so total
Clout stays roughly stable. Good bettors lose less / profit; bad bettors feed the
sink. The vig guarantees the house wins long-term, keeping the economy sound.

## 8. Accounts & social

- **1 app account per person:** username + password (hashed).
- **Profile → linked Riot accounts:** one app account links N Riot IDs (main +
  smurfs). Linking is **trust-based** in v1 (enter Riot ID, resolve PUUID, done —
  no ownership verification; fine for a friend group). Ownership verification
  (RSO OAuth / icon challenge) is a later hardening step.
- **Detection:** the poller watches every linked account of every user. A ranked
  game on ANY linked account opens a betting event for the whole group.

## 9. Bet lifecycle

```
detect ranked game (spectator / live client)
   → OPEN market with form opening odds
   → [in-game] live odds move each tick; each placed bet freezes its own odds
   → game ends (match-v5 result available)
   → SETTLE every market + parlay, credit/debit balances, write ledger
```
v1: betting stays open during the game; hard-close at game end. (Optional later:
soft-lock when one side's P(win) passes a threshold.)

## 10. Build roadmap (vertical slices)

- **Phase 0 — De-risk** ✅ done. All data sources proven.
- **Phase 1 — Core betting loop (MVP):** auth + accounts + link Riot ID +
  auto-detect ranked + form opening odds + bet slip + place bet + auto-settle on
  result + minimal desktop UI + ledger. Currency = starting balance (clicker
  later). *This is a complete, playable product with friends — no live odds yet.*
- **Phase 2 — Live in-play odds:** Electron client reads Live Client Data → win-
  prob model → moving odds during the game → odds freeze at placement.
- **Phase 3 — Idle-clicker economy:** the currency faucet game (own design brainstorm).
- **Phase 4 — Depth & polish:** timeline/timing markets, combinés UX, leaderboards,
  account-ownership verification, production Riot key.

## 11. Open questions / future

- **Idle clicker** — theme, core loop, generation rate, upgrades: undefined,
  needs its own brainstorm before Phase 3.
- **Win-prob tuning** — heuristic weights need real-game calibration.
- **Economy balance** — clicker output vs house-edge burn ratio: tune with data.
- **Parimutuel alt mode** — keep as a possible future bet type.
- **Account ownership verification** — defer; revisit if the group grows.
