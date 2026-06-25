// server/tests/bets.test.js
const { makeSingle, settleSingle, makeParlay, settleParlayBet } = require('../bets');

// Minimal fake board mirroring buildBoard's output shape.
const board = [
  { title: 'Résultat (Galio)', yes: { label: 'WIN', odds: 2.0, won: false }, no: { label: 'LOSE', odds: 1.6, won: true } },
  { title: 'Kills',            yes: { label: '+ de 7.5', odds: 3.0, won: false }, no: { label: '- de 7.5', odds: 1.3, won: true } },
];

test('makeSingle freezes the odds from the chosen side', () => {
  const bet = makeSingle({ player: 'gd', board, marketTitle: 'Résultat (Galio)', side: 'yes', stake: 50 });
  expect(bet).toEqual({ player: 'gd', type: 'single', marketTitle: 'Résultat (Galio)', side: 'yes', stake: 50, odds: 2.0 });
});

test('makeSingle throws on unknown market or bad side', () => {
  expect(() => makeSingle({ player: 'gd', board, marketTitle: 'Nope', side: 'yes', stake: 50 })).toThrow();
  expect(() => makeSingle({ player: 'gd', board, marketTitle: 'Kills', side: 'maybe', stake: 50 })).toThrow();
});

test('settleSingle pays a winning side and zeroes a losing side', () => {
  const win = makeSingle({ player: 'gd', board, marketTitle: 'Résultat (Galio)', side: 'no', stake: 50 }); // LOSE won
  expect(settleSingle(win, board)).toEqual({ won: true, payout: 80 }); // 50 * 1.6
  const lose = makeSingle({ player: 'gd', board, marketTitle: 'Kills', side: 'yes', stake: 50 }); // over lost
  expect(settleSingle(lose, board)).toEqual({ won: false, payout: 0 });
});

test('makeParlay freezes each leg odds; settleParlayBet multiplies and is all-or-nothing', () => {
  const par = makeParlay({ player: 'gd', board, stake: 50, picks: [
    { marketTitle: 'Résultat (Galio)', side: 'no' }, // 1.6, won
    { marketTitle: 'Kills', side: 'no' },            // 1.3, won
  ] });
  expect(par.picks).toEqual([
    { marketTitle: 'Résultat (Galio)', side: 'no', odds: 1.6 },
    { marketTitle: 'Kills', side: 'no', odds: 1.3 },
  ]);
  const r = settleParlayBet(par, board);
  expect(r.won).toBe(true);
  expect(r.combinedOdds).toBeCloseTo(2.08, 2); // 1.6 * 1.3
  expect(r.payout).toBe(104); // round(50 * 2.08)
});

test('settleParlayBet loses if any leg loses', () => {
  const par = makeParlay({ player: 'gd', board, stake: 50, picks: [
    { marketTitle: 'Résultat (Galio)', side: 'no' }, // won
    { marketTitle: 'Kills', side: 'yes' },           // lost
  ] });
  const r = settleParlayBet(par, board);
  expect(r.won).toBe(false);
  expect(r.payout).toBe(0);
});
