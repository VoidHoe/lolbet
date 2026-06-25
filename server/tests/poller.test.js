const { isRanked, matchIdFor, RANKED_QUEUES } = require('../poller');

test('RANKED_QUEUES is solo + flex', () => {
  expect(RANKED_QUEUES).toEqual([420, 440]);
});

test('isRanked accepts 420/440, rejects others', () => {
  expect(isRanked(420)).toBe(true);
  expect(isRanked(440)).toBe(true);
  expect(isRanked(1700)).toBe(false);
  expect(isRanked(undefined)).toBe(false);
});

test('matchIdFor builds the match id from a spectator gameId + platformId', () => {
  expect(matchIdFor(7898651765)).toBe('EUW1_7898651765');       // default EUW
  expect(matchIdFor(7898651765, 'EUW1')).toBe('EUW1_7898651765');
  expect(matchIdFor(123, 'EUN1')).toBe('EUN1_123');             // EUNE
});
