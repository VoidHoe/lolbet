const { isRanked, matchIdFor, RANKED_QUEUES, linkedInGame } = require('../poller');

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

test('linkedInGame returns linked accounts present in the game', () => {
  const linked = [{ puuid: 'PA', riot_id: 'A#1' }, { puuid: 'PB', riot_id: 'B#2' }, { puuid: 'PC', riot_id: 'C#3' }];
  const participants = [{ puuid: 'PX' }, { puuid: 'PA' }, { puuid: 'PC' }];
  const got = linkedInGame(participants, linked).map((a) => a.puuid);
  expect(got).toEqual(['PA', 'PC']);
});
