# lolbet 🎰

Un mini "site de paris sportifs" privé pour parier de la monnaie virtuelle sur les
games **ranked League of Legends** de tes potes. Quand quelqu'un lance une ranked,
un événement de pari s'ouvre automatiquement (cotes calculées sur sa forme récente),
tout le groupe mise, et le règlement se fait tout seul à la fin de la game grâce à
l'API Riot. Pas d'argent réel.

> App desktop (barre des tâches) + backend partagé hébergé. Spun off de MemeDrop.

## Architecture

| Élément | Rôle |
|---------|------|
| `server/` | API Express + Postgres : comptes, économie, événements, règlement |
| `server/poller.js` | détecte les ranked en cours (Spectator API) → ouvre/règle les events |
| `src/` | client Riot API + moteur de cotes (forme) + règlement |
| `desktop/` | app Electron (fenêtre barre des tâches) qui se connecte au serveur partagé |

Pari = **bookmaker à cote fixe** : cotes calculées sur les 5 dernières ranked du joueur,
figées au moment du pari. Anti-inflation = marge maison (~6%) brûlée. Monnaie de départ : 1000 Clout.

## Lancer en local

```bash
npm install
# Web app (mode dégradé sans DB, complet avec une Postgres)
DATABASE_URL=<postgres> RIOT_API_KEY=<clé-dev> npm run serve   # http://localhost:3000
# Détecteur de games (en parallèle)
DATABASE_URL=<postgres> RIOT_API_KEY=<clé-dev> npm run poll
```

Clé Riot dev gratuite : https://developer.riotgames.com (expire toutes les 24h ;
clé production requise pour un vrai déploiement). Région : EUW (`europe` / `euw1`).

## CLI (debug)

```bash
npm run backtest                 # règle les marchés sur ta dernière ranked
npm run watch                    # auto-détecte ta prochaine game finie
npm run live                     # sonde l'état live (Live Client Data, localhost:2999)
node src/index.js register <u> <pw>
node src/index.js link <u> <RiotID>
```

## App desktop

```bash
cd desktop
npm install
npm start                        # lance l'app ; menu « Serveur… » pour pointer vers le backend
npm run build                    # construit l'installeur Windows (NSIS) → desktop/dist/
# Publier dans GitHub Releases (comme MemeDrop) :
GH_TOKEN=<token> npm run build -- --publish always
```

## Tests

```bash
npm test                         # jest (hermétique, sans DB)
```

## Roadmap

- [x] Moteur de paris + économie (Clout, ledger)
- [x] Comptes + liaison Riot (trust-based, pas d'OAuth)
- [x] Détection ranked en cours → événements de pari → règlement auto
- [x] API HTTP + auth + UI web + app desktop
- [ ] Cotes **live in-play** (le client desktop lit `localhost:2999` → modèle P(win) → cotes mouvantes)
- [ ] **Idle clicker** (robinet de monnaie)
- [ ] Marchés "timing" (X kills avant 10min) via l'endpoint timeline
