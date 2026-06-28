// server/app.js
// Express REST API over the never-throw stores. Exports the app (no listen()).

const express = require('express');
const path = require('path');
const accounts = require('./accounts');
const store = require('./store');
const events = require('./events');
const session = require('./session');
const challenges = require('./challenges');
const { makeSingle, makeParlay } = require('./bets');
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

// Other registered users — opponent picker for 1v1 challenges.
app.get('/api/users', requireAuth, async (req, res) => {
  res.json(await accounts.listUsers(req.username));
});

// 1v1 challenges. create/accept/decline/cancel escrow & refund coins; the
// poller settles live ones when both players' games finish.
app.get('/api/challenges', requireAuth, async (req, res) => {
  res.json(await challenges.listForUser(req.username));
});
app.post('/api/challenges', requireAuth, async (req, res) => {
  const { toUser, stat, stake } = req.body || {};
  res.json(await challenges.create({ fromUser: req.username, toUser, stat, stake }));
});
app.post('/api/challenges/:id/accept', requireAuth, async (req, res) => {
  res.json(await challenges.accept(req.params.id, req.username));
});
app.post('/api/challenges/:id/decline', requireAuth, async (req, res) => {
  res.json(await challenges.decline(req.params.id, req.username));
});
app.post('/api/challenges/:id/cancel', requireAuth, async (req, res) => {
  res.json(await challenges.cancel(req.params.id, req.username));
});

// Place a bet. `picks` is an array of {marketId, side}: 1 pick = single, more =
// combiné/parlay. (Legacy single fields {marketId, side} are still accepted.)
app.post('/api/bet', requireAuth, async (req, res) => {
  const { matchId, stake } = req.body || {};
  let picks = req.body && req.body.picks;
  if (!Array.isArray(picks) || picks.length === 0) {
    const { marketId, side } = req.body || {};
    if (marketId && side) picks = [{ marketId, side }];
    else return res.json({ ok: false, error: 'no-picks' });
  }
  const ev = await events.getEvent(matchId);
  if (!ev) return res.json({ ok: false, error: 'no-event' });
  let bet;
  try {
    bet = picks.length === 1
      ? makeSingle({ player: req.username, board: ev.board, marketId: picks[0].marketId, side: picks[0].side, stake: Number(stake) })
      : makeParlay({ player: req.username, board: ev.board, picks, stake: Number(stake) });
  } catch (e) { return res.json({ ok: false, error: 'bad-bet' }); }
  res.json(await store.placeBet(req.username, matchId, bet));
});

// Bet history, enriched with human-readable legs resolved from each event's
// board (titles + side labels), so the UI can show full ticket detail.
app.get('/api/bets', requireAuth, async (req, res) => {
  const rows = await store.listBets(req.username);
  const boardCache = {};
  const out = [];
  for (const row of rows) {
    const bet = typeof row.bet === 'string' ? JSON.parse(row.bet) : row.bet;
    if (boardCache[row.match_id] === undefined) {
      const ev = await events.getEvent(row.match_id);
      boardCache[row.match_id] = (ev && ev.board) || [];
    }
    const board = boardCache[row.match_id];
    const rawLegs = bet.type === 'parlay' ? bet.picks : [{ marketId: bet.marketId, side: bet.side, odds: bet.odds }];
    const legs = rawLegs.map((p) => {
      const m = board.find((x) => x.id === p.marketId);
      return {
        title: m ? m.title : p.marketId,
        side: m ? (p.side === 'yes' ? m.yes.label : m.no.label) : p.side,
        odds: p.odds,
      };
    });
    const combinedOdds = legs.reduce((a, l) => a * (l.odds || 1), 1);
    out.push({
      matchId: row.match_id, stake: row.stake, status: row.status, payout: row.payout,
      createdAt: row.created_at, type: bet.type || 'single', legs, combinedOdds,
    });
  }
  res.json(out);
});

module.exports = app;
