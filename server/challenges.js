// server/challenges.js
// 1v1 head-to-head challenges. Two users wager `stake` coins on a single stat,
// each measured in their OWN next finished ranked game (cross-game stat duel).
// Stakes are escrowed (debited) when each side commits and paid out when both
// games complete. DB wrappers NEVER throw — safe fallbacks on any DB error.
//
// Pure helpers (statValue / compare / resolveDuel) are exported and unit-tested
// independently of the database, mirroring economy.js / bets.js.

const db = require('./db');
const store = require('./store');
const { canBet } = require('./economy');
const { extractStats } = require('../src/markets');

function isDisabled(err) { return err instanceof db.EconomyDisabledError; }

const ALLOWED_STATS = ['kills', 'kda', 'cs', 'win'];

// ---- pure logic ----

// The numeric value of `stat` for one player's extracted game stats.
function statValue(stat, s) {
  if (!s) return null;
  if (stat === 'win') return s.win ? 1 : 0;
  if (stat === 'kda') return (s.kills + s.assists) / Math.max(1, s.deaths);
  if (stat === 'cs') return s.cs;
  return s.kills; // default + 'kills'
}

// Who wins given two values: 'from' | 'to' | null (tie = push).
function compare(fromVal, toVal) {
  if (fromVal > toVal) return 'from';
  if (toVal > fromVal) return 'to';
  return null;
}

// Resolve a duel from both players' raw stats. Returns vals + winner side.
function resolveDuel(stat, fromStats, toStats) {
  const fromVal = statValue(stat, fromStats);
  const toVal = statValue(stat, toStats);
  return { fromVal, toVal, winner: compare(fromVal, toVal) };
}

// ---- DB helpers ----

async function firstPuuid(username) {
  const res = await db.query(
    `SELECT puuid FROM riot_accounts WHERE username = $1 ORDER BY created_at LIMIT 1`,
    [username]
  );
  return res.rows[0] ? res.rows[0].puuid : null;
}

async function getById(id) {
  const res = await db.query(`SELECT * FROM challenges WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

// ---- public API (never throws) ----

// Create a pending challenge and escrow the challenger's stake.
async function create({ fromUser, toUser, stat, stake }) {
  try {
    stake = Number(stake);
    if (!ALLOWED_STATS.includes(stat)) return { ok: false, error: 'bad-stat' };
    if (!toUser || toUser === fromUser) return { ok: false, error: 'bad-opponent' };
    const balance = await store.getBalance(fromUser); // materializes players row
    const chk = canBet(balance, stake);
    if (!chk.ok) return { ok: false, error: chk.error };

    const fromPuuid = await firstPuuid(fromUser);
    if (!fromPuuid) return { ok: false, error: 'link-account' };
    const toPuuid = await firstPuuid(toUser);
    if (!toPuuid) return { ok: false, error: 'opponent-no-account' };

    await db.query('BEGIN');
    const upd = await db.query(
      `UPDATE players SET balance = balance - $2, updated_at = now()
       WHERE username = $1 AND balance >= $2 RETURNING balance`,
      [fromUser, stake]
    );
    if (upd.rowCount === 0) { await db.query('ROLLBACK'); return { ok: false, error: 'insufficient' }; }
    const ins = await db.query(
      `INSERT INTO challenges (from_user, to_user, stat, stake, status, from_puuid, to_puuid)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id`,
      [fromUser, toUser, stat, stake, fromPuuid, toPuuid]
    );
    await db.query(
      `INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'challenge-stake', $3)`,
      [fromUser, -stake, 'chal:' + ins.rows[0].id]
    );
    await db.query('COMMIT');
    return { ok: true, id: ins.rows[0].id };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[challenges] create:', err.message);
    return { ok: false, error: 'db' };
  }
}

// Opponent accepts: escrow their stake, go live.
async function accept(id, username) {
  try {
    id = Number(id);
    const ch = await getById(id);
    if (!ch) return { ok: false, error: 'not-found' };
    if (ch.to_user !== username) return { ok: false, error: 'not-yours' };
    if (ch.status !== 'pending') return { ok: false, error: 'bad-state' };
    const balance = await store.getBalance(username);
    if (!canBet(balance, ch.stake).ok) return { ok: false, error: 'insufficient' };

    await db.query('BEGIN');
    const upd = await db.query(
      `UPDATE players SET balance = balance - $2, updated_at = now()
       WHERE username = $1 AND balance >= $2 RETURNING balance`,
      [username, ch.stake]
    );
    if (upd.rowCount === 0) { await db.query('ROLLBACK'); return { ok: false, error: 'insufficient' }; }
    await db.query(`UPDATE challenges SET status = 'live', accepted_at = now() WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'challenge-stake', $3)`,
      [username, -ch.stake, 'chal:' + id]
    );
    await db.query('COMMIT');
    return { ok: true };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[challenges] accept:', err.message);
    return { ok: false, error: 'db' };
  }
}

// Refund the challenger and close a still-pending challenge (decline/cancel).
async function closePending(id, username, role, newStatus) {
  try {
    id = Number(id);
    const ch = await getById(id);
    if (!ch) return { ok: false, error: 'not-found' };
    if (ch.status !== 'pending') return { ok: false, error: 'bad-state' };
    if (role === 'to' && ch.to_user !== username) return { ok: false, error: 'not-yours' };
    if (role === 'from' && ch.from_user !== username) return { ok: false, error: 'not-yours' };

    await db.query('BEGIN');
    await db.query(
      `UPDATE players SET balance = balance + $2, updated_at = now() WHERE username = $1`,
      [ch.from_user, ch.stake]
    );
    await db.query(
      `INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'challenge-refund', $3)`,
      [ch.from_user, ch.stake, 'chal:' + id]
    );
    await db.query(`UPDATE challenges SET status = $2, settled_at = now() WHERE id = $1`, [id, newStatus]);
    await db.query('COMMIT');
    return { ok: true };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[challenges] closePending:', err.message);
    return { ok: false, error: 'db' };
  }
}
const decline = (id, username) => closePending(id, username, 'to', 'declined');
const cancel = (id, username) => closePending(id, username, 'from', 'cancelled');

async function listForUser(username) {
  try {
    const res = await db.query(
      `SELECT id, from_user, to_user, stat, stake, status, winner, from_val, to_val, created_at
       FROM challenges
       WHERE (from_user = $1 OR to_user = $1) AND status IN ('pending', 'live', 'settled')
       ORDER BY created_at DESC LIMIT 50`,
      [username]
    );
    return res.rows;
  } catch (err) {
    if (!isDisabled(err)) console.error('[challenges] listForUser:', err.message);
    return [];
  }
}

// Pay the pot to the winner (or refund both on a push) and mark settled.
async function settle(ch) {
  const winnerSide = compare(ch.from_val, ch.to_val);
  const pot = ch.stake * 2;
  await db.query('BEGIN');
  if (winnerSide === 'from' || winnerSide === 'to') {
    const winUser = winnerSide === 'from' ? ch.from_user : ch.to_user;
    await db.query(`UPDATE players SET balance = balance + $2, updated_at = now() WHERE username = $1`, [winUser, pot]);
    await db.query(`INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'challenge-payout', $3)`, [winUser, pot, 'chal:' + ch.id]);
    await db.query(`UPDATE challenges SET status = 'settled', winner = $2, settled_at = now() WHERE id = $1`, [ch.id, winUser]);
  } else {
    for (const u of [ch.from_user, ch.to_user]) {
      await db.query(`UPDATE players SET balance = balance + $2, updated_at = now() WHERE username = $1`, [u, ch.stake]);
      await db.query(`INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'challenge-refund', $3)`, [u, ch.stake, 'chal:' + ch.id]);
    }
    await db.query(`UPDATE challenges SET status = 'settled', winner = NULL, settled_at = now() WHERE id = $1`, [ch.id]);
  }
  await db.query('COMMIT');
}

// Poller hook: given a finished match, record the stat for any live challenge
// whose participant played in it, and settle once both sides are in.
async function recordMatch(match) {
  try {
    const live = await db.query(`SELECT * FROM challenges WHERE status = 'live'`);
    for (const ch of live.rows) {
      let touched = false;
      if (!ch.from_match && ch.from_puuid) {
        let s; try { s = extractStats(match, ch.from_puuid); } catch { s = null; }
        if (s) {
          await db.query(`UPDATE challenges SET from_match = $2, from_val = $3 WHERE id = $1`,
            [ch.id, match.metadata.matchId, statValue(ch.stat, s)]);
          touched = true;
        }
      }
      if (!ch.to_match && ch.to_puuid) {
        let s; try { s = extractStats(match, ch.to_puuid); } catch { s = null; }
        if (s) {
          await db.query(`UPDATE challenges SET to_match = $2, to_val = $3 WHERE id = $1`,
            [ch.id, match.metadata.matchId, statValue(ch.stat, s)]);
          touched = true;
        }
      }
      if (!touched) continue;
      const fresh = await getById(ch.id);
      if (fresh && fresh.status === 'live' && fresh.from_match && fresh.to_match) {
        await settle(fresh);
      }
    }
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[challenges] recordMatch:', err.message);
  }
}

module.exports = {
  ALLOWED_STATS, statValue, compare, resolveDuel,
  create, accept, decline, cancel, listForUser, recordMatch,
};
