// server/tests/challenges.test.js
const challenges = require('../challenges');

describe('challenges — pure duel logic', () => {
  const { statValue, compare, resolveDuel } = challenges;

  test('statValue per stat key', () => {
    expect(statValue('kills', { kills: 7 })).toBe(7);
    expect(statValue('cs', { cs: 213 })).toBe(213);
    expect(statValue('win', { win: true })).toBe(1);
    expect(statValue('win', { win: false })).toBe(0);
    expect(statValue('kda', { kills: 6, assists: 4, deaths: 2 })).toBe(5);
    // deaths=0 must not divide by zero
    expect(statValue('kda', { kills: 3, assists: 0, deaths: 0 })).toBe(3);
    expect(statValue('kills', null)).toBe(null);
  });

  test('compare picks the higher side, null on tie', () => {
    expect(compare(7, 4)).toBe('from');
    expect(compare(4, 7)).toBe('to');
    expect(compare(5, 5)).toBe(null);
  });

  test('resolveDuel returns both values and the winner', () => {
    expect(resolveDuel('kills', { kills: 8 }, { kills: 3 }))
      .toEqual({ fromVal: 8, toVal: 3, winner: 'from' });
    expect(resolveDuel('win', { win: false }, { win: true }))
      .toEqual({ fromVal: 0, toVal: 1, winner: 'to' });
    const tie = resolveDuel('cs', { cs: 150 }, { cs: 150 });
    expect(tie.winner).toBe(null);
  });
});

describe('challenges — DB wrappers (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('validation happens before any DB call', async () => {
    const c = require('../challenges');
    expect(await c.create({ fromUser: 'a', toUser: 'a', stat: 'kills', stake: 50 }))
      .toEqual({ ok: false, error: 'bad-opponent' });
    expect(await c.create({ fromUser: 'a', toUser: 'b', stat: 'nope', stake: 50 }))
      .toEqual({ ok: false, error: 'bad-stat' });
  });

  test('wrappers fall back safely when DB is disabled', async () => {
    const c = require('../challenges');
    expect(await c.create({ fromUser: 'a', toUser: 'b', stat: 'kills', stake: 50 }))
      .toEqual({ ok: false, error: 'db' });
    expect(await c.accept(1, 'b')).toEqual({ ok: false, error: 'db' });
    expect(await c.decline(1, 'b')).toEqual({ ok: false, error: 'db' });
    expect(await c.cancel(1, 'a')).toEqual({ ok: false, error: 'db' });
    expect(await c.listForUser('a')).toEqual([]);
    await expect(c.recordMatch({ metadata: { matchId: 'X' }, info: { participants: [] } }))
      .resolves.toBeUndefined();
  });
});
