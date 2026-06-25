// server/tests/db.test.js
describe('db (no DATABASE_URL)', () => {
  const saved = process.env.DATABASE_URL;
  beforeAll(() => { delete process.env.DATABASE_URL; jest.resetModules(); });
  afterAll(() => { if (saved) process.env.DATABASE_URL = saved; });

  test('is disabled and query throws the sentinel; init returns false', async () => {
    const db = require('../db');
    expect(db.enabled).toBe(false);
    await expect(db.query('SELECT 1')).rejects.toBeInstanceOf(db.EconomyDisabledError);
    await expect(db.init()).resolves.toBe(false);
  });
});
