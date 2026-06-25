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
