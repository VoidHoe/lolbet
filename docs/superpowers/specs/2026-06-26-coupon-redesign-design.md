# Coupon Redesign — Lobby → Player betting pages

Date: 2026-06-26
Status: Approved (design)

## Problem

When several linked friends are in the same live game, the current UI dumps every
market for every player into one long top-to-bottom vertical scroll grouped by name.
It reads as a wall of text, it's hard to tell who's in the game, and there's no
sense of "I'm betting on *this* friend". We want a clean two-level flow: see who's
in game, tap a friend, get their markets organized by category.

This is a **presentation redesign**. The betting engine, pricing, parlay logic,
`/bet` endpoint, and settlement are unchanged. The only backend change is adding a
market `category` field and one new market.

## Decisions (locked)

- **Navigation**: Lobby → player page (not one big collapsible scroll).
- **Categories**: `Combat` / `Objectives` / `Farm`, with `Result` shown on top.
  (Gold deferred — no gold markets yet, so the category is "Farm" not "Farm & Gold".)
- **Coupon**: mixes picks across multiple friends in the same game (combiné).
- **New market**: "Plus de CS que son adversaire direct" (out-farm your lane
  opponent, whole game). The "@15:00" variant is deferred (needs the Riot timeline API).

## Architecture

Three views rendered in the single `server/public/index.html` page, no router —
a `view` state variable (`'lobby' | 'player'`) plus the selected `matchId`/`slot`
drives what `render()` shows. Auth / account-linking / history / balance cards stay.

```
┌─ WHO'S IN GAME (lobby) ───────────────┐
│  🎮 Flex · live                        │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │  A       │ │  B       │ │  S     │ │   ← one card per linked friend
│  │  Ahri    │ │  Bob     │ │  Sam   │ │     (name headline, avatar circle,
│  │  tap →   │ │  tap →   │ │  tap → │ │      queue, "live")
│  └──────────┘ └──────────┘ └────────┘ │
└────────────────────────────────────────┘
            ↓ tap a card
┌─ AHRI ───────────────────── ← back ────┐
│ Résultat :  WIN 1.65  /  LOSE 2.20      │   ← result line, always on top
│ [ Combat ] [ Objectives ] [ Farm ]      │   ← tabs
│ Kills      + de 7.5     1.85 / 1.95     │   ← market rows for the active tab
│ Deaths     + de 5.5     2.10 / 1.70     │
│ ...                                     │
└──────────────────────────────────────────┘
┌─ COUPON (floating, persists across views) ─┐
│ 3 sélections · combiné ×4.20   [Parier ▾]  │
└──────────────────────────────────────────────┘
```

## Components

### Backend — `src/markets.js` (small change)

1. Add a `cat` field to every entry in `MARKET_DEFS`:
   - `result`: `win`
   - `combat`: `kills, deaths, assists, fbself, mk2, mk3, gkills`
   - `objectives`: `fbteam, fdteam, fbaron, ftower, drakes`
   - `farm`: `cs, dur, csvs` (new)
2. Emit `cat` on every board item in `priceMultiBoard` (and `priceBoard` for parity).
3. New market `csvs`:
   - `id: 'csvs'`, `cat: 'farm'`, `mode: 'classic'`, `kind: 'binary'`,
     `yes: 'OUI'`, `no: 'NON'`, title "Plus de CS que son adversaire direct".
   - `test: (s) => s.outFarmedOpponent === true`.
4. `extractStats` computes `outFarmedOpponent`:
   - Find the enemy participant whose `teamPosition` equals the player's
     `teamPosition` (fallback `individualPosition`).
   - `outFarmedOpponent = myCs > opponentCs`.
   - If no opponent lane can be resolved (empty position), set
     `outFarmedOpponent = null`. **Settlement** then resolves the YES side as
     `false` (did not out-farm) — no changes to `store.js`/`bets.js` are needed.
     **Pricing** excludes `null` samples via an optional `def.sample` predicate so a
     missing-opponent past game doesn't deflate the probability.
   - Rationale: events only open for ranked 5v5 (queues 420/440) where lane
     positions are always populated, so `null` is effectively unreachable in
     practice. A per-leg push pipeline (which does not exist today) would be
     disproportionate.

### Backend — no other changes

`server/poller.js`, `events.js`, `store.js`, `/bet`, settlement: unchanged. The
board already flows as JSON; new fields ride along automatically. The frontend
derives the player list by grouping board items on `slot` → `{ slot, name }`, so
no event schema change is needed.

### Frontend — `server/public/index.html` (rewrite of the betting section)

State:
- `view` (`'lobby'` | `'player'`), `curMatch`, `curSlot`, `curTab` (`'combat'`).
- `slip` (coupon) — unchanged shape `[{matchId, marketId, side}]`. `boards` cache
  unchanged.

Functions:
- `renderEvents()` → renders **lobby**: per event, group `ev.board` items by `slot`
  into players `[{slot, name}]`, render a card grid. Card click → `openPlayer(matchId, slot)`.
- `openPlayer(matchId, slot)` → set state, `view='player'`, render player page.
- `renderPlayer()` → result line (the `slot:win` market), tab bar, and the rows for
  `curTab` (filter board items by `slot` and `cat`). Reuses existing `pick()` /
  `markSelected()`.
- `back()` → `view='lobby'`.
- Coupon (`renderSlip`, `pick`, `placeSlip`, `clearSlip`) — logic unchanged; coupon
  bar is restyled to float at the bottom and persist across both views.

Market row shows `title`, the line/label, and two odds buttons (over/under or
yes/no) exactly like today, just laid out in an aligned row.

## Data flow

1. Poller prices `priceMultiBoard(players, 'CLASSIC')` → board items now carry
   `cat` (+ existing `slot, name, defId, title, yes, no`).
2. `/events` returns events with that board (unchanged endpoint).
3. Frontend groups by `slot` for the lobby, filters by `slot`+`cat` for the player page.
4. Picks → `/bet` with `{ matchId, stake, picks:[{marketId, side}] }` — unchanged.
   `marketId` is still `slot:defId`, so cross-player parlays work as-is.
5. Settlement via `store.settleBets(event, match)` — unchanged; `csvs` resolves
   through `extractStats.outFarmedOpponent`.

## Error handling

- `outFarmedOpponent === null` (no lane opponent) → YES side settles as a loss;
  excluded from pricing samples. No settlement-engine changes.
- Old open events created before this change won't have `cat` on board items. The
  frontend falls back to a tiny `defId → cat` map so grouping still works; events
  are per-game and short-lived regardless.
- Empty lobby (no live events) → existing "Aucun event ouvert" message.

## Testing

- `server/tests/markets.test.js`: assert every `MARKET_DEF` has a valid `cat`; assert
  `priceMultiBoard` items include `cat`; add unit coverage for `extractStats`
  `outFarmedOpponent` (out-farmed, out-farmed-by, no-opponent → null) and for `csvs`
  pricing skipping `null` samples.
- Frontend is static — verified by running the app against a demo/live event:
  lobby shows one card per friend, tapping opens the tabbed page, coupon mixes picks
  across two friends and places a combiné.

## Out of scope / deferred

- Champion portraits on lobby cards (needs championId→name Data Dragon map).
- "More CS than opponent @15:00" (needs Riot timeline API + historical timelines).
- Any new gold markets.
```

## Files touched

- `src/markets.js` — `cat` field, `csvs` market, `outFarmedOpponent` in `extractStats`.
- `server/public/index.html` — lobby/player views, floating coupon.
- `server/tests/markets.test.js` — coverage for the above.
