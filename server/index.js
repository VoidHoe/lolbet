// server/index.js — HTTP entrypoint. Serves the API + UI, and (when a Riot key
// and DB are present) runs the poller in-process so a single deploy does both
// the web app and live ranked detection.
const app = require('./app');
const db = require('./db');
const { pollOnce } = require('./poller');

const PORT = process.env.PORT || 3000;
const POLL_MS = 30000;

if (!process.env.SESSION_SECRET) {
  console.warn('[serve] SESSION_SECRET absent — cookies signés avec un secret public par défaut. Définis-le avant tout déploiement.');
}

db.init().then((ready) => {
  if (!ready) console.warn('[serve] DATABASE_URL absent — l\'app tourne mais rien n\'est persisté.');
  app.listen(PORT, () => console.log(`🎰 lolbet sur http://localhost:${PORT}`));

  // In-process poller: only with both a DB and a Riot key (i.e. a real deploy).
  if (ready && process.env.RIOT_API_KEY) {
    console.log('[serve] poller actif — détection des ranked toutes les 30s.');
    const tick = () => pollOnce().catch((e) => console.error('[poll]', e.message));
    tick();
    setInterval(tick, POLL_MS);
  }
});
