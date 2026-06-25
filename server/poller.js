// server/poller.js
// Orchestrates detection → open event → settle. Pure helpers are unit-tested;
// pollOnce needs live Riot + DB and is verified manually via the CLI `poll` mode.

const { getActiveGame, getMatch } = require('../src/riot');
const { extractStats, priceBoard } = require('../src/markets');
const { getRecentStats } = require('../src/form');
const accounts = require('./accounts');
const events = require('./events');
const store = require('./store');

const RANKED_QUEUES = [420, 440];
const isRanked = (queueId) => RANKED_QUEUES.includes(queueId);
const matchIdFor = (gameId) => `EUW1_${gameId}`;

// Open events for any linked account currently in a new ranked game.
async function openNewEvents() {
  let opened = 0;
  const linked = await accounts.allLinked();
  for (const acc of linked) {
    let game;
    try { game = await getActiveGame(acc.puuid); } catch (e) { console.error('[poll] active:', e.message); continue; }
    if (!game || !isRanked(game.gameQueueConfigId)) continue;

    const matchId = matchIdFor(game.gameId);
    if (await events.getEvent(matchId)) continue; // already tracked

    const champion = String(acc.riot_id).split('#')[0]; // display name
    let board = [];
    try {
      const history = await getRecentStats(acc.puuid, 12);
      board = priceBoard(history, { gameMode: 'CLASSIC', champion });
    } catch (e) { console.error('[poll] price:', e.message); }

    const r = await events.openEvent({
      matchId, username: acc.username, riotId: acc.riot_id, puuid: acc.puuid,
      champion, queueId: game.gameQueueConfigId, board,
    });
    if (r.opened) { opened += 1; console.log(`[poll] event ouvert: ${acc.riot_id} (${matchId})`); }
  }
  return opened;
}

// Settle any open event whose game has finished (match-v5 result available).
async function settleFinished() {
  let settled = 0;
  for (const ev of await events.listOpen()) {
    let match;
    try { match = await getMatch(ev.match_id); } catch { continue; } // not finished yet → 404
    let gameStats;
    try { gameStats = extractStats(match, ev.puuid); } catch (e) { console.error('[poll] stats:', e.message); continue; }
    await store.settleBets(ev.match_id, gameStats);
    await events.markSettled(ev.match_id);
    settled += 1;
    console.log(`[poll] event réglé: ${ev.match_id}`);
  }
  return settled;
}

async function pollOnce() {
  const opened = await openNewEvents();
  const settled = await settleFinished();
  return { opened, settled };
}

module.exports = { RANKED_QUEUES, isRanked, matchIdFor, pollOnce, openNewEvents, settleFinished };
