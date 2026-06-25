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
