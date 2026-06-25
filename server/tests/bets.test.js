const { makeSingle, makeParlay, legWon, settleBet } = require('../bets');

const board = [
  { id: 'p0:win',   title: 'Alice · Résultat', kind: 'player', puuid: 'PA', defId: 'win',   yes: { label: 'WIN', odds: 2.0 }, no: { label: 'LOSE', odds: 1.6 } },
  { id: 'p0:kills', title: 'Alice · Kills',    kind: 'player', puuid: 'PA', defId: 'kills', yes: { label: '+ de 7.5', odds: 3.0 }, no: { label: '- de 7.5', odds: 1.3 } },
  { id: 'p1:kills', title: 'Bob · Kills',      kind: 'player', puuid: 'PB', defId: 'kills', yes: { label: '+ de 7.5', odds: 2.0 }, no: { label: '- de 7.5', odds: 1.8 } },
];
const statsByPuuid = {
  PA: { win: false, kills: 3, gameMode: 'CLASSIC' },
  PB: { win: true, kills: 12, gameMode: 'CLASSIC' },
};

test('makeSingle still freezes odds by market id', () => {
  const bet = makeSingle({ player: 'u', board, marketId: 'p1:kills', side: 'yes', stake: 50 });
  expect(bet).toEqual({ player: 'u', type: 'single', marketId: 'p1:kills', side: 'yes', stake: 50, odds: 2.0 });
});

test('legWon resolves against the right player stats', () => {
  expect(legWon('p0:win', 'no', board, statsByPuuid)).toBe(true);
  expect(legWon('p1:kills', 'yes', board, statsByPuuid)).toBe(true);
  expect(legWon('p0:kills', 'yes', board, statsByPuuid)).toBe(false);
});

test('legWon falls back to fallbackPuuid + m.id for legacy markets', () => {
  const legacy = [{ id: 'win', yes: { label: 'WIN', odds: 2 }, no: { label: 'LOSE', odds: 1.6 } }];
  expect(legWon('win', 'no', legacy, { PA: { win: false } }, 'PA')).toBe(true);
});

test('settleBet pays a winning single from the right player', () => {
  const bet = makeSingle({ player: 'u', board, marketId: 'p1:kills', side: 'yes', stake: 50 });
  expect(settleBet(bet, board, statsByPuuid)).toEqual({ won: true, payout: 100 });
});

test('settleBet parlay is all-or-nothing across players', () => {
  const par = makeParlay({ player: 'u', board, stake: 50, picks: [
    { marketId: 'p0:win', side: 'no' },
    { marketId: 'p1:kills', side: 'yes' },
  ] });
  const r = settleBet(par, board, statsByPuuid);
  expect(r.won).toBe(true);
  expect(r.payout).toBe(160);
  const par2 = makeParlay({ player: 'u', board, stake: 50, picks: [
    { marketId: 'p0:win', side: 'no' },
    { marketId: 'p0:kills', side: 'yes' },
  ] });
  expect(settleBet(par2, board, statsByPuuid)).toMatchObject({ won: false, payout: 0 });
});
