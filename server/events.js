// server/events.js
// Betting-event store. NEVER throws — safe fallbacks on any DB error.

const db = require('./db');

function isDisabled(err) { return err instanceof db.EconomyDisabledError; }

async function openEvent({ matchId, username, riotId, puuid, champion, queueId, board }) {
  try {
    const res = await db.query(
      `INSERT INTO events (match_id, username, riot_id, puuid, champion, queue_id, board)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (match_id) DO NOTHING RETURNING match_id`,
      [matchId, username, riotId, puuid, champion, queueId, JSON.stringify(board)]
    );
    return { ok: true, opened: res.rowCount > 0 };
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] openEvent:', err.message);
    return { ok: false, opened: false };
  }
}

async function listOpen() {
  try {
    const res = await db.query(
      `SELECT match_id, username, riot_id, puuid, champion, queue_id, board
       FROM events WHERE status = 'open' ORDER BY created_at DESC`
    );
    return res.rows;
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] listOpen:', err.message);
    return [];
  }
}

async function getEvent(matchId) {
  try {
    const res = await db.query(`SELECT * FROM events WHERE match_id = $1`, [matchId]);
    return res.rows[0] || null;
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] getEvent:', err.message);
    return null;
  }
}

async function markSettled(matchId) {
  try {
    await db.query(`UPDATE events SET status = 'settled', settled_at = now() WHERE match_id = $1`, [matchId]);
    return { ok: true };
  } catch (err) {
    if (!isDisabled(err)) console.error('[events] markSettled:', err.message);
    return { ok: false };
  }
}

module.exports = { openEvent, listOpen, getEvent, markSettled };
