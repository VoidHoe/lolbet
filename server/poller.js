// server/poller.js
// Detection → open multiplayer event → settle. Pure helpers unit-tested;
// pollOnce needs live Riot + DB and is verified manually via the CLI `poll` mode.

const { getActiveGame, getMatch } = require('../src/riot');
const { priceMultiBoard } = require('../src/markets');
const { getRecentStats } = require('../src/form');
const accounts = require('./accounts');
const events = require('./events');
const store = require('./store');

const RANKED_QUEUES = [420, 440];
const isRanked = (queueId) => RANKED_QUEUES.includes(queueId);
const matchIdFor = (gameId, platformId = 'EUW1') => `${platformId}_${gameId}`;

// Linked accounts whose puuid appears among a game's participants.
function linkedInGame(participants, linked) {
  const byPuuid = new Map(linked.map((a) => [a.puuid, a]));
  const out = [];
  for (const part of participants || []) {
    const acc = byPuuid.get(part.puuid);
    if (acc) out.push(acc);
  }
  return out;
}

async function openNewEvents() {
  let opened = 0;
  const linked = await accounts.allLinked();
  const seen = new Set();
  for (const acc of linked) {
    let game;
    try { game = await getActiveGame(acc.puuid); } catch (e) { console.error('[poll] active:', e.message); continue; }
    if (!game || !isRanked(game.gameQueueConfigId)) continue;

    const matchId = matchIdFor(game.gameId, game.platformId);
    if (seen.has(matchId)) continue;
    seen.add(matchId);
    if (await events.getEvent(matchId)) continue;

    const inGame = linkedInGame(game.participants, linked);
    const players = [];
    for (let i = 0; i < inGame.length; i += 1) {
      const a = inGame[i];
      let history = [];
      try { history = await getRecentStats(a.puuid, 12); } catch (e) { console.error('[poll] form:', e.message); }
      players.push({ slot: 'p' + i, puuid: a.puuid, name: String(a.riot_id).split('#')[0], history });
    }
    if (!players.length) continue;

    const board = priceMultiBoard(players, 'CLASSIC');
    const names = players.map((p) => p.name).join(' + ');
    const r = await events.openEvent({
      matchId, username: acc.username, riotId: acc.riot_id, puuid: acc.puuid,
      champion: names, queueId: game.gameQueueConfigId, board,
    });
    if (r.opened) { opened += 1; console.log(`[poll] event ouvert: ${names} (${matchId})`); }
  }
  return opened;
}

async function settleFinished() {
  let settled = 0;
  for (const ev of await events.listOpen()) {
    let match;
    try { match = await getMatch(ev.match_id); } catch { continue; }
    await store.settleBets(ev, match);
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

module.exports = { RANKED_QUEUES, isRanked, matchIdFor, linkedInGame, pollOnce, openNewEvents, settleFinished };
