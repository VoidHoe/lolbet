# Multiplayer Events — Design Spec

> When several linked accounts are in the SAME ranked game, the event should
> expose markets for EACH of them (plus head-to-head bets), instead of one event
> attributed to whichever player the poller saw first.

## 1. Problem

Today an event is keyed by `match_id` and attributed to one player: the poller
opens it for the first linked account it processes, prices the board on that
player's form, and the markets describe only that player (champion, kills…).
A second linked account in the same game hits `getEvent(matchId)` → already
exists → skipped. So duo/premade games show only one player's markets.

## 2. Goal

One event per game (still keyed by `match_id`), whose board contains:
- **Per-player markets** — the full single-player board for EACH linked account
  in the game, priced on THAT player's form.
- **Head-to-head (H2H) markets** — direct comparisons between two linked players
  in the game ("Le plus de kills : A ou B ?", same for CS and assists).

This makes duo games the fun part: bet on your mate's stats and bet one friend
against another.

## 3. Market taxonomy & board format

The event board stays a **flat array of two-sided markets** (UI iterates it, bets
freeze odds from it — unchanged), but each market becomes **self-describing** so
settlement knows how to resolve it. Two kinds:

```js
// Per-player market — the existing MARKET_DEFS applied to one player.
{ id: 'p0:kills', kind: 'player', slot: 'p0', puuid: '…', name: 'GraveDigger',
  defId: 'kills', title: 'GraveDigger — Kills',
  yes: { label: '+ de 7.5', odds: 3.29 }, no: { label: '- de 7.5', odds: 1.32 } }

// Head-to-head market — compare two linked players on one stat.
{ id: 'h2h:p0:p1:kills', kind: 'h2h', a: 'p0', b: 'p1', stat: 'kills',
  aPuuid: '…', bPuuid: '…', title: 'Le plus de kills',
  yes: { label: 'GraveDigger', odds: 1.85 }, no: { label: 'Mate', odds: 1.95 } }
```

- `slot` (`p0`, `p1`, …) is a short stable key per linked player in the game.
- Market `id` is composite and unique within the event; bets reference it as
  today. `makeSingle`/`makeParlay` (find market by `id`, freeze odds) are
  **unchanged**.
- Per-player titles are prefixed with the player name so the same def for two
  players never collides.

## 4. Detection (poller)

When `getActiveGame(puuid)` returns a game, its `participants[]` carry every
player's `puuid`. Cross-reference with `accounts.allLinked()` to find **all
linked accounts in this game** (1..N). Build the multiplayer board from that set.

```
detect game G via any linked account
  → linkedInGame = participants ∩ allLinked()   (by puuid)
  → for each linked player: fetch their form, price their per-player markets (slot pN)
  → for each pair (a,b) of linked players: build H2H markets (kills/cs/assists)
  → openEvent(matchId, board, players=[{slot,puuid,name,riotId}, …])
```

The existing dedup (`getEvent(matchId)` → skip) still prevents reopening, but now
the FIRST detection builds the full multiplayer board, so the per-account loop no
longer needs to open one-per-player.

## 5. Pricing

- **Per-player markets:** `priceBoard(playerHistory, { gameMode:'CLASSIC',
  champion: playerName })` per linked player, then namespace each returned market
  `id`/`title` with the player's slot/name. Reuses the existing pricing.
- **H2H markets:** v1 = form-based-lite. `p(A beats B on stat)` from each
  player's recent average for that stat (smoothed), `odds = (1/p)·(1−vig)`,
  clamped — same formula as `priceFromProb`. If form is missing for either,
  fall back to even `1.90 / 1.90`.

## 6. Settlement

This is the main change. `settleBets` currently calls `marketWon(marketId, side,
gameStats)` with one player's stats. Now it must resolve each market via its
metadata + per-player stats.

```
settleBets(matchId, match):                 // pass the raw match-v5 object
  event = events.getEvent(matchId)          // board carries market metadata
  statsByPuuid = {}                          // extractStats(match, puuid) per linked puuid, cached
  for each open bet on matchId:
    for each leg (single = 1 leg):
      mkt = event.board.find(id === leg.marketId)
      if mkt.kind === 'player':
        won = marketWon(mkt.defId, leg.side, statsByPuuid[mkt.puuid])   // REUSED
      if mkt.kind === 'h2h':
        av = statsByPuuid[mkt.aPuuid][mkt.stat], bv = statsByPuuid[mkt.bPuuid][mkt.stat]
        if av === bv → PUSH (void leg)         // tie
        else aWins = av > bv; won = (leg.side === 'yes') === aWins
    settle bet (all-or-nothing for parlays; a PUSH leg is treated as odds 1.0)
```

- **Per-player** resolution **reuses `marketWon`** + `extractStats(match, puuid)`.
- **H2H ties** → **push** (refund that leg: single bet refunded, parlay leg
  priced at odds 1.0). New: settlement gains a `push` outcome alongside won/lost.
- `store.settleBets` signature changes from `(matchId, gameStats)` to
  `(matchId, match)`; the poller already has the match object at settle time.

## 7. Data model

- `events.board` (JSONB) stores the richer self-describing markets (above). No
  new column needed — markets carry their own `kind`/`slot`/`puuid`/`defId`/
  `stat`. The player roster is derivable from the markets (or stored alongside
  for convenience).
- `bets` unchanged: still stores the bet record (composite `marketId` + side +
  frozen odds). Settlement reads the event board for resolution metadata.
- New bet status `pushed` (or a `push`-aware payout) for refunded H2H ties.

## 8. API & UI

- **API:** `/api/bet` unchanged (picks reference composite market ids).
- **UI (`index.html`):** group the board by player — a sub-section per linked
  player (heading = name) listing their markets, plus a **"Face à face"** section
  for H2H markets. The coupon/parlay flow is unchanged (still keys on one event).

## 9. Edge cases

- **One linked player in the game** → board = just their per-player markets, no
  H2H. (Effectively today's behaviour, namespaced.)
- **No form for a player** → flat odds (existing `priceMarket` n=0 → 0.5).
- **>2 linked players in one game** → per-player markets for all; H2H for all
  pairs. If that's too many markets, cap H2H to the first 2 players (log the
  cap). A single multi-way "leader" market is future work.
- **Same team vs different teams:** per-player `win`/team markets resolve from
  each player's own team (`extractStats` is per-puuid), so duos (same team) show
  identical WIN — acceptable; opposite-team (flex) resolves correctly per side.
- **A linked player dodges / game never starts** → no match-v5 result → event
  stays open; existing settle-on-finish handles it when (if) a match appears.

## 10. Scope / phasing

- **v1 (this spec):** per-player markets for all linked players in a game + H2H
  (kills/CS/assists) for the duo case, with push-on-tie. Settlement refactor to
  `(matchId, match)` + metadata-driven resolution.
- **Later:** multi-way "leader" markets for 3+ stacks; H2H on derived stats
  (KDA, damage); cross-game parlays.

## 11. Non-goals

No change to: the bookmaker/fixed-odds economy, the coupon UX, accounts/auth,
the EUW+EUNE detection, or the one-event-per-match key.
