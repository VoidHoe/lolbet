const { priceMultiBoard } = require('../../src/markets');

const hist = (mode) => Array.from({ length: 5 }, () => ({
  gameMode: mode, win: true, kills: 10, deaths: 2, assists: 5, cs: 200,
  firstBloodKill: false, largestMultiKill: 1, fbMine: true, fdMine: true,
  fbaronMine: false, ftowerMine: true, teamDragons: 3, totalKills: 30, durationSec: 1800,
}));

test('priceMultiBoard namespaces markets per player with metadata', () => {
  const players = [
    { slot: 'p0', puuid: 'PA', name: 'Alice', history: hist('CLASSIC') },
    { slot: 'p1', puuid: 'PB', name: 'Bob', history: hist('CLASSIC') },
  ];
  const board = priceMultiBoard(players, 'CLASSIC');
  const aWin = board.find((m) => m.id === 'p0:win');
  const bKills = board.find((m) => m.id === 'p1:kills');
  expect(aWin).toMatchObject({ kind: 'player', slot: 'p0', puuid: 'PA', name: 'Alice', defId: 'win' });
  expect(aWin.title).toBe('Alice · Résultat');
  expect(bKills).toMatchObject({ puuid: 'PB', defId: 'kills' });
  expect(bKills.title).toBe('Bob · Kills');
  expect(board.filter((m) => m.slot === 'p0').length).toBe(board.filter((m) => m.slot === 'p1').length);
  expect(aWin.yes.odds).toBeGreaterThan(0);
});

test('non-classic excludes classic-only markets', () => {
  const board = priceMultiBoard([{ slot: 'p0', puuid: 'PA', name: 'A', history: hist('CHERRY') }], 'CHERRY');
  expect(board.find((m) => m.id === 'p0:fbteam')).toBeUndefined();
  expect(board.find((m) => m.id === 'p0:win')).toBeDefined();
});
