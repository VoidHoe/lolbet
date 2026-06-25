// server/tests/store.test.js
describe('store (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('falls back safely when DB is disabled', async () => {
    const store = require('../store');
    await expect(store.getBalance('gd')).resolves.toBe(1000);
    const r = await store.placeBet('gd', 'EUW1_1', { stake: 50, odds: 2 });
    expect(r.ok).toBe(false);
    await expect(store.settleBets('EUW1_1', { win: false })).resolves.toEqual({ settled: 0 });
  });
});
