// server/store.js
// DB-touching wrappers. NEVER throw — on any DB error (incl. disabled) they
// return a safe fallback. Money changes go through a transaction + ledger.

const db = require('./db');
const { START_BALANCE, canBet } = require('./economy');
const { extractStats } = require('../src/markets');
const { settleBet } = require('./bets');

function isDisabled(err) { return err instanceof db.EconomyDisabledError; }

async function getBalance(username) {
  try {
    const res = await db.query(
      `INSERT INTO players (username) VALUES ($1)
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
       RETURNING balance`,
      [username]
    );
    return res.rows[0].balance;
  } catch (err) {
    if (!isDisabled(err)) console.error('[store] getBalance:', err.message);
    return START_BALANCE;
  }
}

// Debit a stake and record the bet atomically. `bet` is a bets.js record (has
// .stake; single or parlay shape) — stored as JSONB.
async function placeBet(username, matchId, bet) {
  try {
    const balance = await getBalance(username);
    const check = canBet(balance, bet.stake);
    if (!check.ok) return { ok: false, balance, error: check.error };

    await db.query('BEGIN');
    const upd = await db.query(
      `UPDATE players SET balance = balance - $2, updated_at = now()
       WHERE username = $1 AND balance >= $2 RETURNING balance`,
      [username, bet.stake]
    );
    if (upd.rowCount === 0) {
      await db.query('ROLLBACK');
      return { ok: false, balance: null, error: 'insufficient' };
    }
    await db.query(
      `INSERT INTO bets (username, match_id, bet, stake) VALUES ($1, $2, $3::jsonb, $4)`,
      [username, matchId, JSON.stringify(bet), bet.stake]
    );
    await db.query(
      `INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'bet-stake', $3)`,
      [username, -bet.stake, matchId]
    );
    await db.query('COMMIT');
    return { ok: true, balance: upd.rows[0].balance };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[store] placeBet:', err.message);
    return { ok: false, balance: null, error: 'db' };
  }
}

// Settle all open bets for a finished event. event = {match_id, board, puuid};
// match = raw match-v5 object. Resolves each bet via board metadata + per-puuid stats.
async function settleBets(event, match) {
  try {
    const board = event.board || [];
    const puuids = new Set(board.map((m) => m.puuid).filter(Boolean));
    if (event.puuid) puuids.add(event.puuid);
    const statsByPuuid = {};
    for (const pu of puuids) {
      try { statsByPuuid[pu] = extractStats(match, pu); } catch { /* not in match */ }
    }

    const open = await db.query(
      `SELECT id, username, bet FROM bets WHERE match_id = $1 AND status = 'open'`,
      [event.match_id]
    );
    let settled = 0;
    for (const row of open.rows) {
      const bet = typeof row.bet === 'string' ? JSON.parse(row.bet) : row.bet;
      let result;
      try { result = settleBet(bet, board, statsByPuuid, event.puuid); }
      catch (e) { console.error('[store] settleBet:', e.message); continue; }
      await db.query('BEGIN');
      await db.query(`UPDATE bets SET status = $2, payout = $3 WHERE id = $1`,
        [row.id, result.won ? 'won' : 'lost', result.payout]);
      if (result.payout > 0) {
        await db.query(`UPDATE players SET balance = balance + $2, updated_at = now() WHERE username = $1`,
          [row.username, result.payout]);
        await db.query(`INSERT INTO ledger (username, delta, reason, ref) VALUES ($1, $2, 'bet-payout', $3)`,
          [row.username, result.payout, event.match_id]);
      }
      await db.query('COMMIT');
      settled += 1;
    }
    return { settled };
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    if (!isDisabled(err)) console.error('[store] settleBets:', err.message);
    return { settled: 0 };
  }
}

async function listBets(username) {
  try {
    const res = await db.query(
      `SELECT match_id, bet, stake, status, payout, created_at
       FROM bets WHERE username = $1 ORDER BY created_at DESC LIMIT 50`,
      [username]
    );
    return res.rows;
  } catch (err) {
    if (!isDisabled(err)) console.error('[store] listBets:', err.message);
    return [];
  }
}

module.exports = { getBalance, placeBet, settleBets, listBets };
