// server/tests/accounts.test.js
describe('accounts (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('every wrapper falls back safely when DB is disabled', async () => {
    const accounts = require('../accounts');
    expect(await accounts.register('gd', 'pw')).toEqual({ ok: false, error: 'db' });
    expect(await accounts.authenticate('gd', 'pw')).toEqual({ ok: false, error: 'db' });
    expect(await accounts.linkRiot('gd', 'GraveDigger#v0id', 'PUUID')).toEqual({ ok: false, error: 'db' });
    expect(await accounts.listRiot('gd')).toEqual([]);
    expect(await accounts.unlinkRiot('gd', 'GraveDigger#v0id')).toEqual({ ok: false, removed: 0 });
    expect(await accounts.allLinked()).toEqual([]);
  });
});
