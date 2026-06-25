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
