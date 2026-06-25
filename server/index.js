// server/index.js — HTTP entrypoint.
const app = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 3000;

db.init().then((ready) => {
  if (!ready) console.warn('[serve] DATABASE_URL absent — l\'app tourne mais rien n\'est persisté.');
  app.listen(PORT, () => console.log(`🎰 lolbet sur http://localhost:${PORT}`));
});
