/* mock.js — placeholder data for fields the backend API does not (yet) expose.
 *
 * The real API (/api/events, /api/bets, /api/me, /api/accounts) drives everything
 * that exists. Rank tiers, the profit leaderboard, and a per-game live timer are
 * NOT in the data model, so we synthesize them here — clearly cosmetic, friends-
 * only flavor. Swap any of these for a real endpoint later without touching app.js
 * beyond the call site. Exposed on window.MOCK.
 */
(function () {
  const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master'];
  const DIVS = ['IV', 'III', 'II', 'I'];

  // Stable hash so the same name always gets the same fake rank/colour.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Deterministic fake rank per player name (placeholder until ranks come from Riot).
  function rankOf(name) {
    const h = hash(name || 'player');
    const tier = TIERS[h % TIERS.length];
    if (tier === 'Master') return 'Master';
    return tier + ' ' + DIVS[(h >> 5) % DIVS.length];
  }

  // Avatar gradient seed (0..360 hue) per name, for subtle per-friend variety.
  function hueOf(name) { return hash(name || 'x') % 360; }

  // A demo leaderboard. Real version = aggregate settled bet profit per user.
  // `you` is injected by app.js so the current user always appears.
  function leaderboard(youName, youProfit) {
    const base = [
      { name: 'Sylas_Diff', profit: 8420 },
      { name: 'jglDi999', profit: 5110 },
      { name: 'midGapAndy', profit: 3275 },
      { name: 'wardbot', profit: 1890 },
      { name: 'ScuttleKing', profit: -640 },
      { name: 'intGod', profit: -2150 },
    ].filter((r) => r.name !== youName);
    if (youName) base.push({ name: youName, profit: youProfit || 0, you: true });
    return base.sort((a, b) => b.profit - a.profit);
  }

  // ---- 1v1 challenges (frontend prototype) ----
  // Stat the duel is decided on. `fmt` renders a player's value for that stat.
  const CHAL_STATS = [
    { key: 'kills', label: 'Most kills', short: 'kills', fmt: (v) => String(v) },
    { key: 'kda', label: 'Best KDA', short: 'KDA', fmt: (v) => Number(v).toFixed(1) },
    { key: 'cs', label: 'Most CS', short: 'CS', fmt: (v) => String(v) },
    { key: 'win', label: 'Win your game', short: 'win', fmt: (v) => (v ? 'WIN' : 'LOSS') },
  ];

  window.MOCK = { rankOf, hueOf, leaderboard, CHAL_STATS };
})();
