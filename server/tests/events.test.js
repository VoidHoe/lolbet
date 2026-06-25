describe('events (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('wrappers fall back safely when DB is disabled', async () => {
    const events = require('../events');
    const e = { matchId: 'EUW1_1', username: 'gd', riotId: 'GraveDigger#v0id', puuid: 'P', champion: 'GraveDigger', queueId: 420, board: [] };
    expect(await events.openEvent(e)).toEqual({ ok: false, opened: false });
    expect(await events.listOpen()).toEqual([]);
    expect(await events.getEvent('EUW1_1')).toBe(null);
    expect(await events.markSettled('EUW1_1')).toEqual({ ok: false });
  });
});
