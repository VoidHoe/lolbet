// Fetches a player's recent games and returns their extracted stats — the
// "form" used to price opening odds. Skips any game we can't read.

const { getRecentMatchIds, getMatch } = require('./riot');
const { extractStats } = require('./markets');

// Up to `n` most recent games' stats for a puuid, optionally excluding one id
// (e.g. the game being settled, so we price on prior form, not the result).
async function getRecentStats(puuid, n = 5, excludeId = null) {
  // Ranked only (solo 420 + flex 440) — the games we price + settle on.
  const ids = await getRecentMatchIds(puuid, excludeId ? n + 1 : n, { type: 'ranked' });
  const out = [];
  for (const id of ids) {
    if (id === excludeId) continue;
    try {
      out.push(extractStats(await getMatch(id), puuid));
    } catch {
      // unreadable game (mode quirk, missing player) — skip it
    }
    if (out.length >= n) break;
  }
  return out;
}

module.exports = { getRecentStats };
