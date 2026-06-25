// CLI for the de-risk prototype.
//   node src/index.js backtest [RiotID] [matchId]  → form-priced board, settled on a finished game
//   node src/index.js watch    [RiotID]            → poll, auto-price + settle when the NEXT game ends
//
// Odds are computed from the player's recent same-mode form (see markets.js).
// Default Riot ID: GraveDigger#v0id (EUW).

const { getPuuid, getRecentMatchIds, getMatch } = require('./riot');
const { extractStats, buildBoard, settleParlay, priceBoard } = require('./markets');
const { getRecentStats } = require('./form');
const { getLiveGame, summarize } = require('./liveClient');
const { getBalance, placeBet, settleBets } = require('../server/store');
const { makeSingle } = require('../server/bets');
const db = require('../server/db');
const accounts = require('../server/accounts');
const { pollOnce } = require('../server/poller');

const STAKE = 50;
const FORM_WINDOW = 12;    // recent games fetched to find ~5 of the right mode
const POLL_MS = 30000;

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  return `${m}m${String(sec % 60).padStart(2, '0')}`;
}

function printBoard(history, gameStats) {
  const kda = `${gameStats.kills}/${gameStats.deaths}/${gameStats.assists}`;
  const modeLabel = gameStats.gameMode === 'CLASSIC' ? 'Faille (Ranked/Normal)' : gameStats.gameMode;
  const sameModeN = Math.min(5, history.filter((s) => s.gameMode === gameStats.gameMode).length);

  console.log(
    `\n🎮 ${gameStats.matchId} — [${modeLabel}] — ${gameStats.champion} (${kda}) — ` +
    `${gameStats.win ? 'VICTOIRE' : 'DÉFAITE'} — ${fmtDuration(gameStats.durationSec)}`
  );
  console.log(`   Cotes calculées sur ${sameModeN} game(s) de forme (même mode).`);

  const board = buildBoard(history, gameStats);
  console.log('\n📊 MARCHÉS — cote = f(forme récente) · les deux côtés jouables');
  console.log('─'.repeat(70));
  for (const m of board) {
    const yes = `${m.yes.won ? '✅' : '  '} ${m.yes.label} @${m.yes.odds.toFixed(2)}`;
    const no = `${m.no.won ? '✅' : '  '} ${m.no.label} @${m.no.odds.toFixed(2)}`;
    const form = `(${m.hits}/${m.sample})`.padStart(7);
    console.log(`  ${m.title.padEnd(22)} ${form}  ${yes.padEnd(24)} | ${no}`);
  }

  // Combiné demo from the priced board (3-4 YES picks, all must hit).
  const byTitle = (t) => board.find((m) => m.title.startsWith(t));
  const picks = [byTitle('Résultat'), byTitle('Kills'), byTitle('Multi-kill')]
    .filter(Boolean)
    .map((m) => ({ label: `${m.title} ${m.yes.label}`, odds: m.yes.odds, won: m.yes.won }));
  if (gameStats.gameMode === 'CLASSIC' && byTitle('Premier Dragon')) {
    const m = byTitle('Premier Dragon');
    picks.push({ label: `${m.title} ${m.yes.label}`, odds: m.yes.odds, won: m.yes.won });
  }
  const par = settleParlay(picks, STAKE);
  console.log('\n🎰 COMBINÉ DÉMO (cotes de forme — tout doit passer)');
  console.log('─'.repeat(70));
  for (const p of picks) {
    console.log(`  ${p.won ? '✅' : '❌'} ${p.label.padEnd(40)} @${p.odds.toFixed(2)}`);
  }
  console.log('─'.repeat(70));
  console.log(`  Multiplicateur : ×${par.combinedOdds.toFixed(2)}`);
  console.log(par.allWon
    ? `  💰 GAGNÉ — mise ${STAKE} → ${par.payout} (+${par.payout - STAKE})`
    : `  ❌ PERDU — mise ${STAKE} (gain raté : ${Math.round(STAKE * par.combinedOdds)})`);
  console.log('');
}

async function backtest(riotId, matchId) {
  console.log(`\n🔎 Backtest sur ${riotId} (EUW)...`);
  const puuid = await getPuuid(riotId);
  let id = matchId;
  if (!id) {
    const ids = await getRecentMatchIds(puuid, 1, { type: 'ranked' });
    if (!ids.length) { console.log('Aucune game ranked récente trouvée.'); return; }
    id = ids[0];
  }
  const gameStats = extractStats(await getMatch(id), puuid);
  const history = await getRecentStats(puuid, FORM_WINDOW,id); // form = games before this one
  printBoard(history, gameStats);
}

async function watch(riotId) {
  const puuid = await getPuuid(riotId);
  let [last] = await getRecentMatchIds(puuid, 1, { type: 'ranked' });
  console.log(`\n👀 Watch sur ${riotId} (Ranked Solo + Flex uniquement). Dernière ranked connue: ${last || 'aucune'}.`);
  console.log('   Finis une ranked — je price sur ta forme et je règle dès qu\'elle apparaît. (Ctrl+C pour stopper)');

  setInterval(async () => {
    try {
      const [latest] = await getRecentMatchIds(puuid, 1, { type: 'ranked' });
      if (latest && latest !== last) {
        last = latest;
        const gameStats = extractStats(await getMatch(latest), puuid);
        const history = await getRecentStats(puuid, FORM_WINDOW,latest);
        console.log('\n🚨 Nouvelle game détectée — cotes de forme + règlement auto :');
        printBoard(history, gameStats);
      } else {
        process.stdout.write('.');
      }
    } catch (e) {
      console.error('\n[watch]', e.message);
    }
  }, POLL_MS);
}

// Probe the local Live Client Data API: prints live game state every 5s.
async function live() {
  console.log('🔴 Live Client probe — sois en game LoL sur ce PC. (Ctrl+C pour stopper)');
  let dumped = false;
  setInterval(async () => {
    try {
      const g = await getLiveGame();
      if (!g) { process.stdout.write('. '); return; }

      // One-time structural dump so we learn the real field shapes.
      if (!dumped) {
        dumped = true;
        const p0 = (g.allPlayers || [])[0] || {};
        console.log('\n🧬 STRUCTURE (one-time):');
        console.log('   activePlayer keys:', Object.keys(g.activePlayer || {}).join(', '));
        console.log('   player[0] keys   :', Object.keys(p0).join(', '));
        console.log('   player[0].scores :', JSON.stringify(p0.scores));
        console.log('   gameData         :', JSON.stringify(g.gameData));
      }

      const s = summarize(g);
      console.log(
        `\n⏱ ${Math.floor(s.gameTimeSec / 60)}min — ${s.me.name} [${s.me.team}] or:${s.me.gold} | ` +
        `ORDER ${s.ORDER.kills}k/${s.ORDER.cs}cs  vs  CHAOS ${s.CHAOS.kills}k/${s.CHAOS.cs}cs | ` +
        `tours:${s.turrets} drakes:${s.dragons} barons:${s.barons}`
      );
    } catch (e) {
      console.error('\n[live]', e.message);
    }
  }, 5000);
}

async function demoBet(riotId, matchId) {
  await db.init();
  const puuid = await getPuuid(riotId);
  const id = matchId || (await getRecentMatchIds(puuid, 1, { type: 'ranked' }))[0];
  if (!id) { console.log('Aucune game ranked trouvée.'); return; }

  const match = await getMatch(id);
  const gameStats = extractStats(match, puuid);
  const history = await getRecentStats(puuid, 12, id);
  const board = priceBoard(history, { gameMode: gameStats.gameMode, champion: gameStats.champion });

  const user = 'demo';
  const before = await getBalance(user);
  const bet = makeSingle({ player: user, board, marketId: 'win', side: 'yes', stake: 50 });

  const placed = await placeBet(user, id, bet);
  console.log(`\n💰 ${user}: solde ${before} → pari 50 @${bet.odds.toFixed(2)} sur WIN`);
  if (!placed.ok) { console.log(`   ❌ pari refusé (${placed.error}). DB branchée ? (DATABASE_URL)`); return; }

  const { settled } = await settleBets({ match_id: id, board, puuid }, match);
  const after = await getBalance(user);
  console.log(`   réglé (${settled} pari) → solde ${after} (${after - before >= 0 ? '+' : ''}${after - before})`);
}

async function poll() {
  await db.init();
  console.log('🛰️  Poller — détecte les ranked en cours des comptes liés, ouvre/règle les events. (Ctrl+C pour stopper)');
  const tick = async () => {
    try {
      const { opened, settled } = await pollOnce();
      if (opened || settled) console.log(`[poll] +${opened} ouverts, ${settled} réglés`);
      else process.stdout.write('.');
    } catch (e) { console.error('\n[poll]', e.message); }
  };
  await tick();
  setInterval(tick, 30000);
}

async function register() {
  await db.init();
  const [username, password] = process.argv.slice(3);
  if (!username || !password) { console.log('usage: register <username> <password>'); return; }
  const r = await accounts.register(username, password);
  console.log(r.ok ? `✅ compte créé: ${username}` : `❌ échec (${r.error})`);
}

async function link() {
  await db.init();
  const [username, riotId] = process.argv.slice(3);
  if (!username || !riotId) { console.log('usage: link <username> <RiotID (Pseudo#TAG)>'); return; }
  let puuid;
  try {
    puuid = await getPuuid(riotId); // trust-based: just resolves, no OAuth
  } catch (e) {
    console.log(`❌ Riot ID introuvable ou invalide (${riotId}) : ${e.message}`);
    return;
  }
  const r = await accounts.linkRiot(username, riotId, puuid);
  console.log(r.ok ? `✅ ${riotId} lié à ${username}` : `❌ échec (${r.error})`);
  const list = await accounts.listRiot(username);
  console.log(`   comptes Riot de ${username}: ${list.map((a) => a.riot_id).join(', ') || 'aucun'}`);
}

async function main() {
  const [mode = 'backtest', riotId = 'GraveDigger#v0id', matchId] = process.argv.slice(2);
  try {
    if (mode === 'poll') await poll();
    else if (mode === 'register') await register();
    else if (mode === 'link') await link();
    else if (mode === 'demo-bet') await demoBet(riotId, matchId);
    else if (mode === 'live') await live();
    else if (mode === 'watch') await watch(riotId);
    else await backtest(riotId, matchId);
  } catch (e) {
    console.error('\n❌', e.message);
    process.exit(1);
  }
}

main();
