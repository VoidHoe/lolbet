// Minimal Riot API client. EUW → "europe" regional routing for account-v1 and
// match-v5. No deps: Node 20+ has global fetch.

const REGIONAL = 'https://europe.api.riotgames.com';
const PLATFORM = 'https://euw1.api.riotgames.com'; // spectator-v5 uses platform routing

function key() {
  const k = process.env.RIOT_API_KEY;
  if (!k) {
    throw new Error(
      'RIOT_API_KEY manquant. Récupère une clé dev sur https://developer.riotgames.com ' +
      '(connecte-toi avec ton compte Riot, copie la "Development API Key") puis exporte-la.'
    );
  }
  return k;
}

async function riotGet(url) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': key() } });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Clé invalide ou expirée (401/403). Les clés dev expirent toutes les 24h — régénère-la.');
  }
  if (res.status === 429) {
    throw new Error('Rate limit Riot (429). Attends ~10s et relance.');
  }
  if (res.status === 404) {
    throw new Error(`Introuvable (404) sur ${url} — Riot ID ou match inexistant ?`);
  }
  if (!res.ok) {
    throw new Error(`Riot API a renvoyé ${res.status} sur ${url}`);
  }
  return res.json();
}

// "Pseudo#TAG" → PUUID
async function getPuuid(riotId) {
  const [gameName, tagLine] = String(riotId).split('#');
  if (!gameName || !tagLine) {
    throw new Error(`Riot ID invalide: "${riotId}" (format attendu: Pseudo#TAG)`);
  }
  const data = await riotGet(
    `${REGIONAL}/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  return data.puuid;
}

// Most recent match IDs (newest first). opts.type filters the queue family
// ('ranked' = solo 420 + flex 440), opts.queue pins a single queue id.
async function getRecentMatchIds(puuid, count = 5, opts = {}) {
  const params = new URLSearchParams({ start: '0', count: String(count) });
  if (opts.type) params.set('type', opts.type);
  if (opts.queue) params.set('queue', String(opts.queue));
  return riotGet(`${REGIONAL}/lol/match/v5/matches/by-puuid/${puuid}/ids?${params.toString()}`);
}

// Full match detail.
async function getMatch(matchId) {
  return riotGet(`${REGIONAL}/lol/match/v5/matches/${matchId}`);
}

// Current live game for a puuid, or null if they are not in a game.
async function getActiveGame(puuid) {
  try {
    return await riotGet(`${PLATFORM}/lol/spectator/v5/active-games/by-summoner/${puuid}`);
  } catch (e) {
    if (/\b404\b/.test(e.message)) return null; // not currently in a game
    throw e;
  }
}

module.exports = { getPuuid, getRecentMatchIds, getMatch, getActiveGame };
