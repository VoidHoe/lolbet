const { makeSingle, settleSingle, makeParlay, settleParlayBet } = require('../bets');

const board = [
  { id: 'win',   title: 'Résultat (Galio)', yes: { label: 'WIN', odds: 2.0 }, no: { label: 'LOSE', odds: 1.6 } },
  { id: 'kills', title: 'Kills',            yes: { label: '+ de 7.5', odds: 3.0 }, no: { label: '- de 7.5', odds: 1.3 } },
];

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
  const onLose = makeSingle({ player: 'gd', board, marketId: 'win', side: 'no', stake: 50 });
  expect(settleSingle(onLose, gameStats)).toEqual({ won: true, payout: 80 });
  const onOver = makeSingle({ player: 'gd', board, marketId: 'kills', side: 'yes', stake: 50 });
  expect(settleSingle(onOver, gameStats)).toEqual({ won: false, payout: 0 });
});

test('makeParlay freezes leg odds; settleParlayBet is all-or-nothing from stats', () => {
  const par = makeParlay({ player: 'gd', board, stake: 50, picks: [
    { marketId: 'win', side: 'no' },
    { marketId: 'kills', side: 'no' },
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
    { marketId: 'win', side: 'no' },
    { marketId: 'kills', side: 'yes' },
  ] });
  expect(settleParlayBet(par, gameStats)).toMatchObject({ won: false, payout: 0 });
});
