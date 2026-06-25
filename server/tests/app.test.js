const request = require('supertest');
const app = require('../app');

describe('API (no DATABASE_URL)', () => {
  test('GET /api/events returns an array', async () => {
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/me without a session is 401', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  test('POST /api/register with no DB returns ok:false', async () => {
    const res = await request(app).post('/api/register').send({ username: 'a', password: 'b' });
    expect(res.body.ok).toBe(false);
  });

  test('POST /api/login with no DB does not authenticate (ok:false)', async () => {
    const res = await request(app).post('/api/login').send({ username: 'a', password: 'b' });
    expect(res.body.ok).toBe(false);
  });
});
