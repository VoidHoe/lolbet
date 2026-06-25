// server/db.js
// Thin Postgres layer. No DATABASE_URL → disabled: query() throws a sentinel so
// the store wrappers fall back to safe no-ops. SSL relaxed for Railway.

const DATABASE_URL = process.env.DATABASE_URL;
const enabled = !!DATABASE_URL;
let pool = null;

if (enabled) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.on('error', (err) => console.error('[db] pool error:', err.message));
}

class EconomyDisabledError extends Error {
  constructor() { super('db disabled (no DATABASE_URL)'); this.name = 'EconomyDisabledError'; }
}

async function query(text, params) {
  if (!enabled) throw new EconomyDisabledError();
  return pool.query(text, params);
}

async function init() {
  if (!enabled) return false;
  await query(`
    CREATE TABLE IF NOT EXISTS players (
      username   TEXT PRIMARY KEY,
      balance    INTEGER NOT NULL DEFAULT 1000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS bets (
      id         BIGSERIAL PRIMARY KEY,
      username   TEXT NOT NULL,
      match_id   TEXT NOT NULL,
      bet        JSONB NOT NULL,
      stake      INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      payout     INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS ledger (
      id         BIGSERIAL PRIMARY KEY,
      username   TEXT NOT NULL,
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      ref        TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS riot_accounts (
      id         BIGSERIAL PRIMARY KEY,
      username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      riot_id    TEXT NOT NULL,
      puuid      TEXT NOT NULL UNIQUE,
      region     TEXT NOT NULL DEFAULT 'euw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS events (
      match_id   TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      riot_id    TEXT NOT NULL,
      puuid      TEXT NOT NULL,
      champion   TEXT NOT NULL,
      queue_id   INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      board      JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at TIMESTAMPTZ
    )`);
  return true;
}

module.exports = { query, init, enabled, EconomyDisabledError };
