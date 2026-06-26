const { priceBoard, marketWon, buildBoard, MARKET_DEFS, priceMultiBoard } = require('../../src/markets');

const history = Array.from({ length: 5 }, () => ({
  gameMode: 'CLASSIC', win: true, kills: 10, deaths: 2, assists: 5, cs: 200,
  firstBloodKill: false, largestMultiKill: 1, fbMine: true, fdMine: true,
  fbaronMine: false, ftowerMine: true, teamDragons: 3, totalKills: 30, durationSec: 1800,
}));

test('priceBoard quotes odds with ids and no won field', () => {
  const board = priceBoard(history, { gameMode: 'CLASSIC', champion: 'Galio' });
  const win = board.find((m) => m.id === 'win');
  expect(win).toBeDefined();
  expect(win.yes.won).toBeUndefined();
  expect(win.yes.odds).toBeLessThan(win.no.odds);
  expect(win.title).toContain('Galio');
});

test('priceBoard excludes classic-only markets for non-classic modes', () => {
  const board = priceBoard(history, { gameMode: 'CHERRY', champion: 'Briar' });
  expect(board.find((m) => m.id === 'fbteam')).toBeUndefined();
  expect(board.find((m) => m.id === 'win')).toBeDefined();
});

test('marketWon resolves a single market from final stats', () => {
  const gameStats = { win: true, kills: 10, deaths: 2, assists: 5, cs: 200, firstBloodKill: false,
    largestMultiKill: 1, fbMine: true, fdMine: false, fbaronMine: false, ftowerMine: true,
    teamDragons: 1, totalKills: 20, durationSec: 1700, gameMode: 'CLASSIC', champion: 'Galio' };
  expect(marketWon('win', 'yes', gameStats)).toBe(true);
  expect(marketWon('win', 'no', gameStats)).toBe(false);
  expect(marketWon('kills', 'yes', gameStats)).toBe(true);
  expect(marketWon('kills', 'no', gameStats)).toBe(false);
  expect(() => marketWon('nope', 'yes', gameStats)).toThrow();
});

test('buildBoard still works and now carries ids', () => {
  const gameStats = { win: false, kills: 3, deaths: 7, assists: 9, cs: 120, firstBloodKill: false,
    largestMultiKill: 1, fbMine: false, fdMine: false, fbaronMine: true, ftowerMine: false,
    teamDragons: 2, totalKills: 25, durationSec: 2000, gameMode: 'CLASSIC', champion: 'Galio' };
  const board = buildBoard(history, gameStats);
  const win = board.find((m) => m.id === 'win');
  expect(win.no.won).toBe(true);
});

test('every market def has a valid category', () => {
  const valid = new Set(['result', 'combat', 'objectives', 'farm']);
  for (const def of MARKET_DEFS) {
    expect(valid.has(def.cat)).toBe(true);
  }
});

test('priceMultiBoard items carry slot, defId and cat', () => {
  const players = [{ slot: 'p0', puuid: 'x', name: 'Ahri', history }];
  const board = priceMultiBoard(players, 'CLASSIC');
  const kills = board.find((m) => m.defId === 'kills');
  expect(kills.slot).toBe('p0');
  expect(kills.cat).toBe('combat');
  const win = board.find((m) => m.defId === 'win');
  expect(win.cat).toBe('result');
});
