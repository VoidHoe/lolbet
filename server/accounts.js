// server/accounts.js
// DB-touching account wrappers. NEVER throw — on any DB error (incl. disabled)
// return a safe fallback. PUUID resolution happens in the caller (trust-based,
// no OAuth); linkRiot just persists the already-resolved puuid.

const db = require('./db');
const { hashPassword, verifyPassword } = require('./auth');

function isDisabled(err) { return err instanceof db.EconomyDisabledError; }

async function register(username, password) {
  try {
    const hash = hashPassword(password);
    const res = await db.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING RETURNING username`,
      [username, hash]
    );
    if (res.rowCount === 0) return { ok: false, error: 'taken' };
    return { ok: true, username };
  } catch (err) {
    if (!isDisabled(err)) console.error('[accounts] register:', err.message);
    return { ok: false, error: 'db' };
  }
}

async function authenticate(username, password) {
  try {
    const res = await db.query(`SELECT password_hash FROM users WHERE username = $1`, [username]);
    if (res.rowCount === 0) return { ok: false, error: 'no-user' };
    if (!verifyPassword(password, res.rows[0].password_hash)) return { ok: false, error: 'bad-password' };
    return { ok: true, username };
  } catch (err) {
    if (!isDisabled(err)) console.error('[accounts] authenticate:', err.message);
    return { ok: false, error: 'db' };
  }
}

async function linkRiot(username, riotId, puuid) {
  try {
    const res = await db.query(
      `INSERT INTO riot_accounts (username, riot_id, puuid) VALUES ($1, $2, $3)
       ON CONFLICT (puuid) DO NOTHING RETURNING id`,
      [username, riotId, puuid]
    );
    if (res.rowCount === 0) return { ok: false, error: 'already-linked' };
    return { ok: true };
  } catch (err) {
    if (!isDisabled(err)) console.error('[accounts] linkRiot:', err.message);
    return { ok: false, error: 'db' };
  }
}

async function listRiot(username) {
  try {
    const res = await db.query(
      `SELECT riot_id, puuid, region FROM riot_accounts WHERE username = $1 ORDER BY created_at`,
      [username]
    );
    return res.rows;
  } catch (err) {
    if (!isDisabled(err)) console.error('[accounts] listRiot:', err.message);
    return [];
  }
}

async function unlinkRiot(username, riotId) {
  try {
    const res = await db.query(
      `DELETE FROM riot_accounts WHERE username = $1 AND riot_id = $2`,
      [username, riotId]
    );
    return { ok: true, removed: res.rowCount };
  } catch (err) {
    if (!isDisabled(err)) console.error('[accounts] unlinkRiot:', err.message);
    return { ok: false, removed: 0 };
  }
}

async function allLinked() {
  try {
    const res = await db.query(`SELECT username, riot_id, puuid FROM riot_accounts ORDER BY created_at`);
    return res.rows;
  } catch (err) {
    if (!isDisabled(err)) console.error('[accounts] allLinked:', err.message);
    return [];
  }
}

module.exports = { register, authenticate, linkRiot, listRiot, unlinkRiot, allLinked };
