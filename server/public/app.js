/* RiftBook — frontend logic.
 *
 * Plain vanilla JS (no build step). Preserves the exact backend contract:
 *   GET  /api/me        -> { username, balance }
 *   GET  /api/accounts  -> [{ riot_id }]
 *   POST /api/link      -> { ok, error }
 *   GET  /api/events    -> [{ match_id, riot_id, champion, queue_id, board:[market] }]
 *   POST /api/bet       -> { ok, error }   body: { matchId, stake, picks:[{marketId,side}] }
 *   GET  /api/bets      -> [{ matchId, stake, status, payout, type, legs, combinedOdds }]
 *   POST /api/register|login|logout
 *
 * market = { id, slot, name, defId, cat, title, yes:{label,odds}, no:{label,odds} }
 *
 * Components are plain functions returning HTML strings: TopBar, Sidebar,
 * MatchCard, OddsButton, BetSlip, RecentBets, Leaderboard.
 */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const api = (p, opt) =>
  fetch('/api' + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt)).then((r) => r.json());
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/* ---------------- state ---------------- */
let me = null;
let slip = [];            // [{ matchId, marketId, side }]
let eventsCache = [];     // last /api/events payload
let betsCache = [];       // last /api/bets payload
const boards = {};        // matchId -> board[]
const cardTab = {};       // cardKey -> 'combat'|'objectives'|'farm'
const firstSeen = {};     // matchId -> epoch ms (synthetic live timer origin)
let friendFilter = 'all'; // all | live | lobby | finished
let currentView = 'live'; // live | challenges | mybets | leaderboard
let poll = null;

// 1v1 challenges (backed by /api/challenges)
let challenges = [];      // rows from /api/challenges
let chalUsers = [];       // other usernames, from /api/users
const CHAL_STATS = window.MOCK.CHAL_STATS;
const statDef = (k) => CHAL_STATS.find((s) => s.key === k) || CHAL_STATS[0];

/* ---------------- market taxonomy (mirrors src/markets.js) ---------------- */
const CATS = [
  { key: 'combat', label: 'Combat' },
  { key: 'objectives', label: 'Objectives' },
  { key: 'farm', label: 'Farm' },
];
const CAT_OF = {
  win: 'result', kills: 'combat', deaths: 'combat', assists: 'combat', fbself: 'combat',
  mk2: 'combat', mk3: 'combat', gkills: 'combat', fbteam: 'objectives', fdteam: 'objectives',
  fbaron: 'objectives', ftower: 'objectives', drakes: 'objectives', cs: 'farm', dur: 'farm', csvs: 'farm',
};
const defOf = (m) => m.defId || String(m.id || '').split(':').pop();
const catOf = (m) => m.cat || CAT_OF[defOf(m)] || 'combat';
const queueName = (q) => (q === 440 ? 'Flex' : q === 420 ? 'Solo/Duo' : 'Ranked');
const shortTitle = (t) => { const p = String(t).split(' · '); return p.length > 1 ? p.slice(1).join(' · ') : t; };
const cardKeyOf = (matchId, slot) => matchId + '|' + slot;
const domId = (s) => 'card_' + String(s).replace(/[^a-zA-Z0-9]/g, '_');

function hostNameOf(ev) { return ev.riot_id ? String(ev.riot_id).split('#')[0] : null; }

function playersOf(ev) {
  const map = {};
  for (const m of ev.board || []) {
    const slot = m.slot || 'p0';
    if (!map[slot]) map[slot] = { slot, name: m.name || ev.champion || ev.riot_id || 'Player' };
  }
  return Object.values(map);
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/* =====================================================================
   COMPONENTS
   ===================================================================== */

function TopBar(meObj) {
  $('balanceVal').textContent = fmt(meObj.balance);
  $('avatarBtn').textContent = (meObj.username[0] || '?').toUpperCase();
  $('avatarBtn').title = meObj.username;
}

function OddsButton(matchId, m, side) {
  const s = m[side];
  if (!s) return '';
  return (
    `<button class="odd" data-act="pick" data-match="${esc(matchId)}" data-market="${esc(m.id)}" data-side="${side}">` +
    `<span class="ol">${esc(s.label)}</span> <b>${s.odds.toFixed(2)}</b></button>`
  );
}

function MatchCard(ev, player, opts) {
  opts = opts || {};
  const items = (ev.board || []).filter((m) => (m.slot || 'p0') === player.slot);
  const name = player.name;
  const key = cardKeyOf(ev.match_id, player.slot);
  const tab = cardTab[key] || 'combat';
  const since = firstSeen[ev.match_id] || Date.now();

  const champ = name === hostNameOf(ev) && ev.champion
    ? `<span class="chip-tag champ">⚔ ${esc(ev.champion)}</span>` : '';
  const rank = `<span class="chip-tag rank">▲ ${esc(window.MOCK.rankOf(name))}</span>`;
  const queue = `<span class="chip-tag">${esc(queueName(ev.queue_id))}</span>`;

  const winM = items.find((m) => defOf(m) === 'win');
  const result = winM
    ? `<div class="mc-result">${OddsButton(ev.match_id, winM, 'yes')}${OddsButton(ev.match_id, winM, 'no')}</div>`
    : '';

  const tabs = CATS.map((c) =>
    `<button class="tab ${c.key === tab ? 'on' : ''}" data-act="tab" data-card="${esc(key)}" data-cat="${c.key}">${c.label}</button>`
  ).join('');

  const rows = items
    .filter((m) => defOf(m) !== 'win' && catOf(m) === tab)
    .map((m) =>
      `<div class="market"><span class="mname">${esc(shortTitle(m.title))}</span>` +
      `<span class="sides">${OddsButton(ev.match_id, m, 'yes')}${OddsButton(ev.match_id, m, 'no')}</span></div>`
    ).join('') || '<div class="market-empty">No markets in this section.</div>';

  return (
    `<article class="mcard" id="${domId(key)}">` +
      `<div class="mc-h">` +
        `<div class="mc-ava">${esc((name[0] || '?').toUpperCase())}</div>` +
        `<div class="mc-id"><div class="mc-name">${esc(name)}</div>` +
          `<div class="mc-meta">${champ}${rank}${queue}</div></div>` +
        `<div class="mc-timer"><div class="t js-timer" data-since="${since}">0:00</div><div class="l">live</div></div>` +
      `</div>` +
      `<div class="mc-body">` +
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">` +
          `<span class="badge-live"><span class="pulse"></span>LIVE</span>` +
          `<span class="muted" style="font-size:11.5px">Match Result</span></div>` +
        result +
        `<div class="tabs">${tabs}</div>` +
        `<div class="mc-markets">${rows}</div>` +
      `</div>` +
    `</article>`
  );
}

function Hero(ev) {
  if (!ev) return '';
  const player = playersOf(ev)[0];
  if (!player) return '';
  const items = (ev.board || []).filter((m) => (m.slot || 'p0') === player.slot);
  const winM = items.find((m) => defOf(m) === 'win');
  const since = firstSeen[ev.match_id] || Date.now();
  const champ = ev.champion ? `<span class="chip-tag champ">⚔ ${esc(ev.champion)}</span>` : '';
  const odds = winM
    ? `<div class="hodds">${OddsButton(ev.match_id, winM, 'yes')}${OddsButton(ev.match_id, winM, 'no')}</div>`
    : '';
  return (
    `<div class="hero">` +
      `<span class="htag"><span class="pulse" style="width:7px;height:7px;border-radius:50%;background:var(--live)"></span> Featured live match</span>` +
      `<div class="hbody">` +
        `<div class="hava">${esc((player.name[0] || '?').toUpperCase())}</div>` +
        `<div><div class="hname">${esc(player.name)}</div>` +
          `<div class="hmeta">${champ}` +
            `<span class="chip-tag rank">▲ ${esc(window.MOCK.rankOf(player.name))}</span>` +
            `<span class="chip-tag">${esc(queueName(ev.queue_id))}</span>` +
            `<span class="badge-live"><span class="pulse"></span>LIVE</span></div></div>` +
        `<div class="spacer"></div>` +
        `<div class="htimer"><div class="t js-timer" data-since="${since}">0:00</div><div class="l">game timer</div></div>` +
      `</div>` +
      odds +
    `</div>`
  );
}

function Sidebar() {
  // Friends = every player across every open event. All open events are "live".
  const friends = [];
  for (const ev of eventsCache) {
    for (const p of playersOf(ev)) {
      friends.push({
        name: p.name, slot: p.slot, matchId: ev.match_id,
        status: 'live', sub: queueName(ev.queue_id), rank: window.MOCK.rankOf(p.name),
        champ: p.name === hostNameOf(ev) ? ev.champion : null,
      });
    }
  }
  const counts = {
    all: friends.length,
    live: friends.filter((f) => f.status === 'live').length,
    lobby: friends.filter((f) => f.status === 'lobby').length,
    finished: friends.filter((f) => f.status === 'finished').length,
  };
  const FILTERS = [['all', 'All'], ['live', 'Live Now'], ['lobby', 'In Lobby'], ['finished', 'Finished']];
  const chips = FILTERS.map(([k, label]) =>
    `<button class="chip ${friendFilter === k ? 'on' : ''}" data-act="filter" data-filter="${k}">${label} ${counts[k]}</button>`
  ).join('');

  const shown = friends.filter((f) => friendFilter === 'all' || f.status === friendFilter);
  const list = shown.length
    ? shown.map((f) => {
        const sub = f.champ ? `${esc(f.champ)} · ${esc(f.sub)}` : esc(f.sub);
        return (
          `<button class="friend" data-act="friend" data-match="${esc(f.matchId)}" data-slot="${esc(f.slot)}">` +
            `<div class="fava">${esc((f.name[0] || '?').toUpperCase())}<span class="stat ${f.status}"></span></div>` +
            `<div class="fmeta"><div class="fname">${esc(f.name)}</div><div class="fsub">${sub}</div></div>` +
            `<span class="frank">${esc(f.rank)}</span>` +
          `</button>`
        );
      }).join('')
    : `<div class="empty-mini">No friends ${friendFilter === 'all' ? 'in a game' : 'here'} right now.</div>`;

  $('friendsPanel').innerHTML =
    `<div class="panel-h"><h2>Friends</h2><span class="count">${counts.live} live</span></div>` +
    `<div class="filters">${chips}</div>` +
    `<div class="friends">${list}</div>`;
}

function BetSlip() {
  const host = $('betslip');
  // keep only picks that still resolve to a live market
  slip = slip.filter((p) => selOf(p.matchId, p.marketId, p.side));

  let combined = 1;
  const legsHtml = slip.map((p) => {
    const m = (boards[p.matchId] || []).find((x) => x.id === p.marketId);
    const s = selOf(p.matchId, p.marketId, p.side);
    combined *= s.odds;
    return (
      `<div class="leg"><div class="lmain"><div class="lt">${esc(m ? shortTitle(m.title) : p.marketId)}</div>` +
      `<div class="ls">${esc(m ? m.name : '')}${m && m.name ? ' · ' : ''}${esc(s.label)}</div></div>` +
      `<div class="lo">${s.odds.toFixed(2)}</div>` +
      `<button class="lx" data-act="pick" data-match="${esc(p.matchId)}" data-market="${esc(p.marketId)}" data-side="${esc(p.side)}" title="Remove">✕</button></div>`
    );
  }).join('');

  const n = slip.length;
  const stake = Number($('stakeInput') ? $('stakeInput').value : 50) || 0;
  const payout = Math.round(stake * combined);
  const kindLabel = n > 1 ? `Parlay ×${combined.toFixed(2)}` : n === 1 ? `Single @${combined.toFixed(2)}` : '';

  const drawerHandle =
    `<div class="drawer-handle" data-act="toggle-slip">` +
      `<span class="dh-count">${n}</span><span class="dh-title">Bet Slip</span>` +
      `<span class="chev">▲</span></div>`;

  let inner;
  if (!n) {
    inner =
      drawerHandle +
      `<div class="slip-h"><h2>Bet Slip</h2></div>` +
      `<div class="slip-body"><div class="slip-empty"><div class="ic">🎟️</div>` +
        `<div class="t">Pick an odd to build your slip</div>` +
        `<div class="muted" style="font-size:12px;margin-top:4px">Tap any odds button on a match.</div></div>` +
        `<div class="warn"><b>Fake coins only.</b> Friends-only · no real money.</div></div>`;
    host.classList.remove('has-picks');
  } else {
    inner =
      drawerHandle +
      `<div class="slip-h"><h2>Bet Slip</h2><span class="kind">${kindLabel}</span></div>` +
      `<div class="slip-body">` +
        legsHtml +
        `<div class="stake-row"><label>Stake</label>` +
          `<div class="stake-field"><input id="stakeInput" type="number" min="1" value="${stake}" />` +
            `<span class="suffix">coins</span></div></div>` +
        `<div class="quick-stakes">` +
          `<button data-act="quick" data-stake="50">50</button>` +
          `<button data-act="quick" data-stake="100">100</button>` +
          `<button data-act="quick" data-stake="250">250</button>` +
          `<button data-act="quick" data-stake="max">Max</button></div>` +
        `<div class="payout"><span class="pl">Potential payout</span><span class="pv">${fmt(payout)} coins</span></div>` +
        `<div class="slip-actions">` +
          `<button class="btn-ghost" data-act="clear">Clear</button>` +
          `<button class="btn-primary" data-act="place">Place Bet</button></div>` +
        `<div class="slip-msg" id="slipMsg"></div>` +
        `<div class="warn"><b>Fake coins only.</b> Friends-only · no real money.</div>` +
      `</div>`;
    host.classList.add('has-picks');
  }
  host.innerHTML = inner;
}

function RecentBets(rows, targetId, limit) {
  const body = $(targetId || 'recentBody');
  if (!body) return;
  if (!rows.length) { body.innerHTML = `<div class="empty-mini">No bets yet — build a slip to get started.</div>`; return; }
  const statusMap = {
    won: ['won', 'Won'], lost: ['lost', 'Lost'],
    open: ['pending', 'Pending'], pushed: ['pending', 'Refunded'],
  };
  const trs = rows.slice(0, limit || 12).map((b) => {
    const [cls, label] = statusMap[b.status] || ['pending', b.status];
    const kind = b.type === 'parlay'
      ? `Parlay <span class="o">×${(b.combinedOdds || 1).toFixed(2)}</span>`
      : `Single <span class="o">@${(b.combinedOdds || 1).toFixed(2)}</span>`;
    const legs = (b.legs || []).map((l) => `${esc(shortTitle(l.title))} · ${esc(l.side)}`).join(' + ');
    const ret = b.status === 'won' ? `+${fmt(b.payout)}` : b.status === 'lost' ? `−${fmt(b.stake)}` : '—';
    const retCls = b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'pending';
    return (
      `<tr><td><div class="t-kind">${kind}</div><div class="t-legs">${legs}</div></td>` +
      `<td>${fmt(b.stake)}</td>` +
      `<td><span class="res-badge ${cls}"><span class="d"></span>${label}</span></td>` +
      `<td><span class="res-badge ${retCls}" style="background:transparent;padding:0">${ret}</span></td></tr>`
    );
  }).join('');
  body.innerHTML =
    `<table class="table"><thead><tr><th>Ticket</th><th>Stake</th><th>Result</th><th>Return</th></tr></thead>` +
    `<tbody>${trs}</tbody></table>`;
}

function Leaderboard(rows, targetId) {
  const youProfit = betsCache.reduce((acc, b) => {
    if (b.status === 'won') return acc + (b.payout - b.stake);
    if (b.status === 'lost') return acc - b.stake;
    return acc;
  }, 0);
  const data = window.MOCK.leaderboard(me ? me.username : null, youProfit);
  const body = $(targetId || 'leaderboardBody');
  if (!body) return;
  body.innerHTML = data.map((r, i) => {
    const cls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const dir = r.profit >= 0 ? 'up' : 'down';
    const sign = r.profit >= 0 ? '+' : '−';
    return (
      `<div class="lb-row ${cls}">` +
        `<div class="lb-rank">${i + 1}</div>` +
        `<div class="lb-ava">${esc((r.name[0] || '?').toUpperCase())}</div>` +
        `<div class="lb-name">${esc(r.name)}${r.you ? '<span class="you">YOU</span>' : ''}</div>` +
        `<div class="lb-profit ${dir}">${sign}${fmt(Math.abs(r.profit))}</div>` +
      `</div>`
    );
  }).join('');
}

/* =====================================================================
   1v1 CHALLENGES (backed by /api/challenges)
   ===================================================================== */
// Map a raw challenge row to a viewer-relative display model.
function chalView(r) {
  const mine = me && r.from_user === me.username;
  const opponent = mine ? r.to_user : r.from_user;
  let disp;
  if (r.status === 'pending') disp = mine ? 'pending' : 'incoming';
  else if (r.status === 'live') disp = 'live';
  else disp = r.winner == null ? 'push' : (r.winner === (me && me.username) ? 'won' : 'lost');
  return {
    id: r.id, opponent, stat: r.stat, stake: r.stake, disp,
    youVal: mine ? r.from_val : r.to_val,
    oppVal: mine ? r.to_val : r.from_val,
  };
}

function chalScore(v) {
  if (v.youVal == null || v.oppVal == null) return '<div class="chal-progress">Waiting for both games to finish…</div>';
  const d = statDef(v.stat);
  const youWin = v.youVal > v.oppVal, oppWin = v.oppVal > v.youVal;
  return `<div class="chal-score"><span class="${youWin ? 'lead' : ''}">You ${esc(d.fmt(v.youVal))}</span>` +
    `<span class="vs-dash">—</span><span class="${oppWin ? 'lead' : ''}">${esc(v.opponent)} ${esc(d.fmt(v.oppVal))}</span></div>`;
}

function ChallengeCard(r) {
  const v = chalView(r);
  const d = statDef(v.stat);
  const pot = v.stake * 2;
  const badge = (v.disp === 'incoming' || v.disp === 'live')
    ? `<span class="badge-live"><span class="pulse"></span>${v.disp === 'incoming' ? 'NEW' : 'LIVE'}</span>`
    : v.disp === 'pending'
      ? `<span class="res-badge pending"><span class="d"></span>Pending</span>`
      : `<span class="res-badge ${v.disp}"><span class="d"></span>${v.disp === 'won' ? 'Won' : v.disp === 'lost' ? 'Lost' : 'Push'}</span>`;
  let actions = '';
  if (v.disp === 'incoming')
    actions = `<button class="btn-primary" data-act="chal-accept" data-id="${esc(v.id)}">Accept</button>` +
      `<button class="btn-ghost" data-act="chal-decline" data-id="${esc(v.id)}">Decline</button>`;
  else if (v.disp === 'pending')
    actions = `<span class="muted" style="flex:1;font-size:12px">Waiting for ${esc(v.opponent)}…</span>` +
      `<button class="btn-ghost" data-act="chal-cancel" data-id="${esc(v.id)}">Cancel</button>`;
  else if (v.disp === 'live')
    actions = `<span class="muted" style="font-size:12px">Settles when both games end</span>`;
  const showScore = v.disp === 'live' || ['won', 'lost', 'push'].includes(v.disp);
  return `<div class="chal-card">` +
    `<div class="chal-top"><div class="chal-vs">` +
      `<span class="chal-ava">Y</span><b>You</b><span class="chal-x">vs</span>` +
      `<span class="chal-ava opp">${esc((v.opponent[0] || '?').toUpperCase())}</span><b>${esc(v.opponent)}</b>` +
    `</div>${badge}</div>` +
    `<div class="chal-meta"><span class="chip-tag">${esc(d.label)}</span><span class="chal-pot">🏆 ${fmt(pot)} coins</span></div>` +
    (showScore ? chalScore(v) : '') +
    (actions ? `<div class="chal-actions">${actions}</div>` : '') +
  `</div>`;
}

function NewChallengeForm() {
  if (!chalUsers.length) {
    return `<div class="panel chal-form"><div class="panel-b"><div class="empty-mini" style="padding:20px">` +
      `No one to challenge yet — another friend needs to register and link a Riot account.</div></div></div>`;
  }
  return `<div class="panel chal-form"><div class="panel-h"><h2>New Challenge</h2></div>` +
    `<div class="panel-b"><div class="chal-form-row">` +
      `<select id="chalFriend">${chalUsers.map((n) => `<option>${esc(n)}</option>`).join('')}</select>` +
      `<select id="chalStat">${CHAL_STATS.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}</select>` +
      `<div class="stake-field" style="flex:0 0 120px"><input id="chalStake" type="number" min="1" value="100" /><span class="suffix">coins</span></div>` +
      `<button class="btn-primary" data-act="chal-create">Send</button>` +
    `</div><div class="slip-msg" id="chalMsg"></div></div></div>`;
}

function ChallengesView() {
  $('chalNew').innerHTML = NewChallengeForm();
  const dispOf = (r) => chalView(r).disp;
  const groups = [
    ['Incoming', (r) => dispOf(r) === 'incoming'],
    ['Active', (r) => dispOf(r) === 'live'],
    ['Pending', (r) => dispOf(r) === 'pending'],
    ['Settled', (r) => ['won', 'lost', 'push'].includes(dispOf(r))],
  ];
  let html = '';
  for (const [label, pred] of groups) {
    const items = challenges.filter(pred);
    if (!items.length) continue;
    html += `<div class="chal-section"><div class="chal-section-h">${label} <span class="count">${items.length}</span></div>` +
      `<div class="chal-grid">${items.map(ChallengeCard).join('')}</div></div>`;
  }
  if (!html) html = `<div class="panel"><div class="panel-b"><div class="empty-mini" style="padding:36px">No challenges yet — send one above 👆</div></div></div>`;
  $('chalLists').innerHTML = html;
}

async function createChallenge() {
  const f = $('chalFriend'), s = $('chalStat'), st = $('chalStake'), msg = $('chalMsg');
  if (!f || !s || !st) return;
  const stake = Number(st.value);
  if (!stake || stake < 1) { if (msg) { msg.className = 'slip-msg err'; msg.textContent = 'Enter a stake of at least 1 coin.'; } return; }
  const r = await api('/challenges', { method: 'POST', body: JSON.stringify({ toUser: f.value, stat: s.value, stake }) });
  if (r.ok) { await refresh(); }
  else if (msg) { msg.className = 'slip-msg err'; msg.textContent = 'Failed: ' + (r.error || 'unknown'); }
}
async function challengeAction(id, action) {
  await api('/challenges/' + id + '/' + action, { method: 'POST' });
  await refresh();
}

/* =====================================================================
   SLIP LOGIC (preserves backend coupon contract: one match per slip)
   ===================================================================== */
function selOf(matchId, marketId, side) {
  const m = (boards[matchId] || []).find((x) => x.id === marketId);
  return m ? m[side] : null;
}
function pick(matchId, marketId, side) {
  if (slip.length && slip[0].matchId !== matchId) slip = []; // one match at a time
  const i = slip.findIndex((p) => p.marketId === marketId);
  if (i >= 0) {
    if (slip[i].side === side) slip.splice(i, 1); // re-click same side -> remove
    else slip[i].side = side;                     // other side -> switch
  } else {
    slip.push({ matchId, marketId, side });
  }
  BetSlip(); markSelected();
}
function clearSlip() { slip = []; BetSlip(); markSelected(); }
function markSelected() {
  document.querySelectorAll('.odd[data-act="pick"]').forEach((b) => {
    const on = slip.some((p) =>
      p.matchId === b.dataset.match && p.marketId === b.dataset.market && p.side === b.dataset.side);
    b.classList.toggle('sel', on);
  });
}
async function placeSlip() {
  if (!slip.length) return;
  const stake = Number($('stakeInput').value);
  const msg = $('slipMsg');
  if (!stake || stake < 1) { if (msg) { msg.className = 'slip-msg err'; msg.textContent = 'Enter a stake of at least 1 coin.'; } return; }
  const r = await api('/bet', {
    method: 'POST',
    body: JSON.stringify({ matchId: slip[0].matchId, stake, picks: slip.map((p) => ({ marketId: p.marketId, side: p.side })) }),
  });
  if (r.ok) { slip = []; await refresh(); }
  else if (msg) { msg.className = 'slip-msg err'; msg.textContent = 'Bet rejected: ' + (r.error || 'unknown'); }
}

/* =====================================================================
   RENDER ORCHESTRATION
   ===================================================================== */
function renderBoard() {
  if (!eventsCache.length) {
    $('hero').innerHTML = '';
    $('board').innerHTML =
      `<div class="panel" style="grid-column:1/-1"><div class="panel-b" style="text-align:center;padding:48px 20px">` +
      `<div style="font-size:34px;margin-bottom:10px">🛰️</div>` +
      `<div style="font-weight:800;font-size:16px">No live matches right now</div>` +
      `<div class="muted" style="margin-top:6px">When a linked friend starts a ranked game (poller active), it shows up here automatically.</div>` +
      `</div></div>`;
    return;
  }
  $('hero').innerHTML = Hero(eventsCache[0]);
  const cards = [];
  for (const ev of eventsCache) {
    for (const p of playersOf(ev)) cards.push(MatchCard(ev, p));
  }
  $('board').innerHTML = cards.join('');
}

const VIEWS = ['live', 'challenges', 'mybets', 'leaderboard'];

function setView(view) {
  if (!VIEWS.includes(view)) view = 'live';
  currentView = view;
  for (const v of VIEWS) {
    const el = $('view-' + v);
    if (el) el.classList.toggle('hide', v !== view);
  }
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === view));
  closeSidebar();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  Sidebar();
  BetSlip();
  if (currentView === 'live') {
    renderBoard();
    RecentBets(betsCache, 'recentBody', 12);
    Leaderboard(betsCache, 'leaderboardBody');
  } else if (currentView === 'challenges') {
    ChallengesView();
  } else if (currentView === 'mybets') {
    RecentBets(betsCache, 'myBetsBody', 100);
  } else if (currentView === 'leaderboard') {
    Leaderboard(betsCache, 'lbFullBody');
  }
  markSelected();
  updateTimers();
}

function updateTimers() {
  const now = Date.now();
  document.querySelectorAll('.js-timer').forEach((el) => {
    el.textContent = fmtElapsed(now - Number(el.dataset.since || now));
  });
}

/* =====================================================================
   DATA / AUTH
   ===================================================================== */
async function loadEvents() {
  eventsCache = await api('/events').catch(() => []);
  for (const ev of eventsCache) {
    boards[ev.match_id] = ev.board || [];
    if (!firstSeen[ev.match_id]) firstSeen[ev.match_id] = Date.now();
  }
}
async function loadBets() {
  betsCache = await api('/bets').catch(() => []);
}
async function loadChallenges() {
  challenges = await api('/challenges').catch(() => []);
}
async function loadUsers() {
  const u = await api('/users').catch(() => []);
  chalUsers = Array.isArray(u) ? u.map((x) => x.username) : [];
}
async function renderAccounts() {
  const a = await api('/accounts').catch(() => []);
  $('acctList').innerHTML = a.length
    ? a.map((x) => `<span class="acct-tag">${esc(x.riot_id)}</span>`).join('')
    : '<span class="muted" style="font-size:12px">No account linked yet.</span>';
}

async function refresh() {
  me = await api('/me').catch(() => null);
  if (!me || !me.username) {
    $('authWrap').classList.remove('hide');
    $('topbar').classList.add('hide');
    $('shell').classList.add('hide');
    if (poll) { clearInterval(poll); poll = null; }
    return;
  }
  $('authWrap').classList.add('hide');
  $('topbar').classList.remove('hide');
  $('shell').classList.remove('hide');
  TopBar(me);
  await Promise.all([loadEvents(), loadBets(), loadChallenges(), loadUsers()]);
  renderAccounts();
  render();
  if (!poll) poll = setInterval(tick, 12000);
}

async function tick() {
  const m = await api('/me').catch(() => null);
  if (!m || !m.username) { if (poll) { clearInterval(poll); poll = null; } return; }
  me = m; TopBar(me);
  await Promise.all([loadEvents(), loadBets(), loadChallenges(), loadUsers()]);
  render();
}

async function doRegister() {
  const r = await api('/register', { method: 'POST', body: JSON.stringify({ username: $('authUser').value, password: $('authPass').value }) });
  const msg = $('authMsg');
  msg.className = 'auth-msg ' + (r.ok ? 'ok' : 'err');
  msg.textContent = r.ok ? 'Account created — now log in.' : 'Failed: ' + (r.error || 'unknown');
}
async function doLogin() {
  const r = await api('/login', { method: 'POST', body: JSON.stringify({ username: $('authUser').value, password: $('authPass').value }) });
  if (r.ok) refresh();
  else { const msg = $('authMsg'); msg.className = 'auth-msg err'; msg.textContent = 'Failed: ' + (r.error || 'unknown'); }
}
async function doLogout() { await api('/logout', { method: 'POST' }); slip = []; refresh(); }
async function doLink() {
  const r = await api('/link', { method: 'POST', body: JSON.stringify({ riotId: $('riotInput').value }) });
  const msg = $('linkMsg');
  msg.className = 'mini-msg ' + (r.ok ? 'ok' : 'err');
  msg.style.color = r.ok ? 'var(--win)' : 'var(--lose)';
  msg.textContent = r.ok ? 'Linked ✅' : 'Failed: ' + (r.error || 'unknown');
  if (r.ok) { $('riotInput').value = ''; renderAccounts(); }
}

/* =====================================================================
   EVENT WIRING (delegation)
   ===================================================================== */
function focusCard(matchId, slot) {
  if (currentView !== 'live') setView('live');
  const el = $(domId(cardKeyOf(matchId, slot)));
  if (!el) return;
  closeSidebar();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.style.transition = 'box-shadow .3s';
  el.style.boxShadow = '0 0 0 2px var(--accent)';
  setTimeout(() => { el.style.boxShadow = ''; }, 1100);
}
function openSidebar() { $('sidebar').classList.add('open'); $('scrim').classList.add('open'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('scrim').classList.remove('open'); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'pick') pick(t.dataset.match, t.dataset.market, t.dataset.side);
  else if (act === 'tab') { cardTab[t.dataset.card] = t.dataset.cat; renderBoard(); markSelected(); updateTimers(); }
  else if (act === 'filter') { friendFilter = t.dataset.filter; Sidebar(); }
  else if (act === 'friend') focusCard(t.dataset.match, t.dataset.slot);
  else if (act === 'clear') clearSlip();
  else if (act === 'place') placeSlip();
  else if (act === 'quick') {
    const inp = $('stakeInput'); if (!inp) return;
    inp.value = t.dataset.stake === 'max' ? Math.max(1, Math.floor(me ? me.balance : 0)) : t.dataset.stake;
    BetSlip();
  }
  else if (act === 'toggle-slip') $('betslip').classList.toggle('open');
  else if (act === 'nav') { e.preventDefault(); setView(t.dataset.nav); }
  else if (act === 'chal-create') createChallenge();
  else if (act === 'chal-accept') challengeAction(t.dataset.id, 'accept');
  else if (act === 'chal-decline') challengeAction(t.dataset.id, 'decline');
  else if (act === 'chal-cancel') challengeAction(t.dataset.id, 'cancel');
  else if (act === 'menu') openSidebar();
  else if (act === 'scrim') closeSidebar();
  else if (act === 'logout') doLogout();
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'stakeInput') {
    // live payout recompute without rebuilding the whole slip (keeps input focus)
    const stake = Number(e.target.value) || 0;
    let combined = 1;
    for (const p of slip) { const s = selOf(p.matchId, p.marketId, p.side); if (s) combined *= s.odds; }
    const pv = document.querySelector('.payout .pv');
    if (pv) pv.textContent = fmt(Math.round(stake * combined)) + ' coins';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'authUser' || e.target.id === 'authPass') doLogin();
  else if (e.target.id === 'riotInput') doLink();
});

/* static button wiring */
function wireStatic() {
  $('btnLogin').addEventListener('click', doLogin);
  $('btnRegister').addEventListener('click', doRegister);
  $('btnLink').addEventListener('click', doLink);
}

setInterval(updateTimers, 1000);
wireStatic();
refresh();

})();
