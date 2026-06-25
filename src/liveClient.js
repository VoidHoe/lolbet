// Reads the LoL Live Client Data API — runs LOCALLY on the player's machine at
// https://127.0.0.1:2999 with a self-signed Riot cert (so we disable cert
// verification). Only responds while a game is actively in progress; otherwise
// the connection is refused. This is the live state that will move odds in-play.

const https = require('https');

const BASE = 'https://127.0.0.1:2999/liveclientdata';

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(`${BASE}${path}`, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON invalide')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}

// Full live snapshot, or null if no game is currently running on this machine.
async function getLiveGame() {
  try {
    return await get('/allgamedata');
  } catch (e) {
    // No game / not loaded yet: refused, timeout, or 404 during the loading screen.
    if (e.code === 'ECONNREFUSED' || /ECONNREFUSED|timeout|HTTP 404/.test(e.message)) return null;
    throw e;
  }
}

// Condense the raw snapshot into the numbers a win-probability model needs.
function summarize(g) {
  const players = g.allPlayers || [];
  const order = players.filter((p) => p.team === 'ORDER');
  const chaos = players.filter((p) => p.team === 'CHAOS');
  const sum = (arr, f) => arr.reduce((s, p) => s + f(p), 0);
  const kills = (arr) => sum(arr, (p) => p.scores?.kills || 0);
  const cs = (arr) => sum(arr, (p) => p.scores?.creepScore || 0);

  const ev = (g.events && g.events.Events) || [];
  const countEvt = (name, team) =>
    ev.filter((e) => e.EventName === name && (!team || (e.TurretKilled || e.KillerName || '').includes(team))).length;

  const ap = g.activePlayer || {};
  const apName = ap.summonerName || ap.riotIdGameName || ap.riotId || '?';
  const meRow = players.find((p) =>
    (p.summonerName && apName.startsWith(p.summonerName)) ||
    (p.riotIdGameName && p.riotIdGameName === ap.riotIdGameName));
  const myTeam = meRow ? meRow.team : '?';

  return {
    gameTimeSec: g.gameData?.gameTime ?? 0,
    gameMode: g.gameData?.gameMode,
    me: { name: apName, team: myTeam, gold: ap.currentGold, level: ap.level },
    ORDER: { kills: kills(order), cs: cs(order) },
    CHAOS: { kills: kills(chaos), cs: cs(chaos) },
    turrets: countEvt('TurretKilled'),
    dragons: countEvt('DragonKill'),
    barons: countEvt('BaronKill'),
    eventNames: [...new Set(ev.map((e) => e.EventName))],
  };
}

module.exports = { getLiveGame, summarize };
