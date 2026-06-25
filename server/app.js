// server/app.js
// Express REST API over the never-throw stores. Exports the app (no listen()).

const express = require('express');
const path = require('path');
const accounts = require('./accounts');
const store = require('./store');
const events = require('./events');
const session = require('./session');
const { makeSingle } = require('./bets');
const { getPuuid } = require('../src/riot');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  const raw = (req.headers.cookie || '')
    .split(';').map((c) => c.trim()).find((c) => c.startsWith('session='));
  req.username = raw ? session.read(decodeURIComponent(raw.slice('session='.length))) : null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.username) return res.status(401).json({ error: 'auth' });
  next();
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  res.json(await accounts.register(username, password));
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const r = await accounts.authenticate(username, password);
  if (r.ok) res.cookie('session', session.sign(username), { httpOnly: true, sameSite: 'lax' });
  res.json(r);
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  res.json({ username: req.username, balance: await store.getBalance(req.username) });
});

app.get('/api/accounts', requireAuth, async (req, res) => {
  res.json(await accounts.listRiot(req.username));
});

app.post('/api/link', requireAuth, async (req, res) => {
  const { riotId } = req.body || {};
  let puuid;
  try { puuid = await getPuuid(riotId); }
  catch (e) { return res.json({ ok: false, error: 'riot-id' }); }
  res.json(await accounts.linkRiot(req.username, riotId, puuid));
});

app.get('/api/events', async (_req, res) => {
  res.json(await events.listOpen());
});

app.post('/api/bet', requireAuth, async (req, res) => {
  const { matchId, marketId, side, stake } = req.body || {};
  const ev = await events.getEvent(matchId);
  if (!ev) return res.json({ ok: false, error: 'no-event' });
  let bet;
  try { bet = makeSingle({ player: req.username, board: ev.board, marketId, side, stake: Number(stake) }); }
  catch (e) { return res.json({ ok: false, error: 'bad-bet' }); }
  res.json(await store.placeBet(req.username, matchId, bet));
});

app.get('/api/bets', requireAuth, async (req, res) => {
  res.json(await store.listBets(req.username));
});

module.exports = app;
