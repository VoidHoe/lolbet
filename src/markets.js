// Single source of truth: each market is defined ONCE (its predicate + line +
// which modes it applies to). The same definition is used to (a) price the odds
// from recent form and (b) settle the result on the actual game — so the quoted
// odds and the settled outcome can never drift apart.
//
// Pricing = bookmaker opening line from form:
//   p = smoothed hit-rate over the player's recent same-mode games
//   odds = (1 / p) shortened by the house vig (the burned anti-inflation margin)
// Smoothing (Laplace +1) keeps 0/5 and 5/5 from producing infinite / 1.00 odds.

const LINES = { kills: 7.5, deaths: 5.5, assists: 8.5, cs: 150.5, totalKills: 25.5, dragons: 2.5, durMin: 30 };
const VIG = 0.06;          // 6% house margin baked into every quoted price
const SMOOTH = 1;          // Laplace pseudo-count
const ODDS_MIN = 1.05;
const ODDS_MAX = 15.0;

// Pull every betting-relevant fact for one player + their team vs the enemy.
function extractStats(match, puuid) {
  const info = match.info;
  const me = (info.participants || []).find((p) => p.puuid === puuid);
  if (!me) throw new Error('Joueur introuvable dans ce match (mauvais puuid ?)');

  const myTeam = (info.teams || []).find((t) => t.teamId === me.teamId) || {};
  const enemyTeam = (info.teams || []).find((t) => t.teamId !== me.teamId) || {};
  const o = myTeam.objectives || {};
  const e = enemyTeam.objectives || {};

  return {
    matchId: match.metadata.matchId,
    queueId: info.queueId,
    gameMode: info.gameMode, // CLASSIC = Summoner's Rift, CHERRY = Arena, ARAM…
    champion: me.championName,
    win: !!me.win,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0),
    firstBloodKill: !!me.firstBloodKill,
    largestMultiKill: me.largestMultiKill ?? 0,
    fbMine: !!(o.champion && o.champion.first),
    fdMine: !!(o.dragon && o.dragon.first),
    fbaronMine: !!(o.baron && o.baron.first),
    ftowerMine: !!(o.tower && o.tower.first),
    teamDragons: (o.dragon && o.dragon.kills) ?? 0,
    totalKills: ((o.champion && o.champion.kills) ?? 0) + ((e.champion && e.champion.kills) ?? 0),
    durationSec: info.gameDuration,
  };
}

// Market catalogue. kind:'binary' (test→bool = YES side) or 'ou' (value→number vs line).
// mode:'all' = every game mode; 'classic' = Summoner's Rift only.
const MARKET_DEFS = [
  { id: 'win',    title: (s) => `Résultat (${s.champion})`, kind: 'binary', yes: 'WIN', no: 'LOSE', mode: 'all', test: (s) => s.win },
  { id: 'kills',  title: () => 'Kills',   kind: 'ou', line: LINES.kills,   mode: 'all', value: (s) => s.kills },
  { id: 'deaths', title: () => 'Deaths',  kind: 'ou', line: LINES.deaths,  mode: 'all', value: (s) => s.deaths },
  { id: 'assists',title: () => 'Assists', kind: 'ou', line: LINES.assists, mode: 'all', value: (s) => s.assists },
  { id: 'fbself', title: () => 'Fait le First Blood', kind: 'binary', yes: 'OUI', no: 'NON', mode: 'all', test: (s) => s.firstBloodKill },
  { id: 'mk2',    title: () => 'Multi-kill (double+)', kind: 'binary', yes: 'OUI', no: 'NON', mode: 'all', test: (s) => s.largestMultiKill >= 2 },
  { id: 'mk3',    title: () => 'Triple kill+',         kind: 'binary', yes: 'OUI', no: 'NON', mode: 'all', test: (s) => s.largestMultiKill >= 3 },
  // Summoner's Rift only
  { id: 'cs',     title: () => 'CS (farm)',           kind: 'ou', line: LINES.cs,        mode: 'classic', value: (s) => s.cs },
  { id: 'gkills', title: () => 'Kills totaux (game)', kind: 'ou', line: LINES.totalKills, mode: 'classic', value: (s) => s.totalKills },
  { id: 'drakes', title: () => 'Dragons (équipe)',    kind: 'ou', line: LINES.dragons,   mode: 'classic', value: (s) => s.teamDragons },
  { id: 'dur',    title: () => 'Durée (min)',         kind: 'ou', line: LINES.durMin,     mode: 'classic', value: (s) => Math.floor(s.durationSec / 60) },
  { id: 'fbteam', title: () => 'First Blood',     kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.fbMine },
  { id: 'fdteam', title: () => 'Premier Dragon',  kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.fdMine },
  { id: 'fbaron', title: () => 'Premier Baron',   kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.fbaronMine },
  { id: 'ftower', title: () => 'Première Tour',   kind: 'binary', yes: 'son équipe', no: 'adverse', mode: 'classic', test: (s) => s.ftowerMine },
];

const clampOdds = (o) => Math.max(ODDS_MIN, Math.min(ODDS_MAX, o));
const smoothedProb = (hits, n) => (hits + SMOOTH) / (n + 2 * SMOOTH);
const priceFromProb = (p) => clampOdds((1 / p) * (1 - VIG));

// Price one market from recent form (array of stats, already same-mode).
function priceMarket(def, history) {
  const n = history.length;
  const hits = def.kind === 'binary'
    ? history.filter(def.test).length
    : history.filter((s) => def.value(s) > def.line).length;
  const pYes = n > 0 ? smoothedProb(hits, n) : 0.5;
  return { n, hits, pYes, oddsYes: priceFromProb(pYes), oddsNo: priceFromProb(1 - pYes) };
}

// Settle one market on the actual game.
function settleYes(def, stats) {
  return def.kind === 'binary' ? !!def.test(stats) : def.value(stats) > def.line;
}

// Build the full board: price each market from form, settle on the played game.
function buildBoard(history, gameStats) {
  const mode = gameStats.gameMode;
  // Price on the 5 most recent SAME-MODE games (history may include other modes).
  const sameMode = history.filter((s) => s.gameMode === mode).slice(0, 5);
  return MARKET_DEFS
    .filter((def) => def.mode === 'all' || mode === 'CLASSIC')
    .map((def) => {
      const price = priceMarket(def, sameMode);
      const yesWon = settleYes(def, gameStats);
      const yesLabel = def.kind === 'ou' ? `+ de ${def.line}` : def.yes;
      const noLabel = def.kind === 'ou' ? `- de ${def.line}` : def.no;
      return {
        id: def.id,
        title: def.title(gameStats),
        sample: price.n,
        hits: price.hits,
        yes: { label: yesLabel, odds: price.oddsYes, won: yesWon },
        no: { label: noLabel, odds: price.oddsNo, won: !yesWon },
      };
    });
}

// Look up a def by id, throw if unknown.
function defById(id) {
  const def = MARKET_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Marché inconnu: ${id}`);
  return def;
}

// Return yes/no labels for a def (mirrors buildBoard label logic).
function labelsFor(def) {
  return def.kind === 'ou'
    ? { yes: `+ de ${def.line}`, no: `- de ${def.line}` }
    : { yes: def.yes, no: def.no };
}

// Price all applicable markets for a given mode — no settlement, no won field.
function priceBoard(history, meta) {
  const mode = meta.gameMode;
  const sameMode = history.filter((s) => s.gameMode === mode).slice(0, 5);
  return MARKET_DEFS
    .filter((def) => def.mode === 'all' || mode === 'CLASSIC')
    .map((def) => {
      const price = priceMarket(def, sameMode);
      const lab = labelsFor(def);
      return {
        id: def.id,
        title: def.title({ champion: meta.champion }),
        yes: { label: lab.yes, odds: price.oddsYes },
        no: { label: lab.no, odds: price.oddsNo },
      };
    });
}

// Resolve whether a side ('yes'|'no') of a given market won, given final game stats.
function marketWon(marketId, side, gameStats) {
  const yesWon = settleYes(defById(marketId), gameStats);
  return side === 'yes' ? yesWon : !yesWon;
}

// A combiné/parlay = several picks, all must win. Odds multiply.
function settleParlay(picks, stake) {
  const combinedOdds = picks.reduce((m, p) => m * p.odds, 1);
  const allWon = picks.every((p) => p.won);
  const payout = allWon ? Math.round(stake * combinedOdds) : 0;
  return { combinedOdds, allWon, payout };
}

module.exports = { LINES, MARKET_DEFS, extractStats, priceMarket, settleYes, buildBoard, priceBoard, marketWon, settleParlay };
