// App shell: loads the data, owns state, routes between views, and runs live mode.
import { prepare, homeWinProb, expectedMargin } from '../engine/sim.js';
import { parseEvent, scoreboardUrl } from '../engine/espn.js';
import { h, clear, ago, clockTime } from './util.js';
import { renderHome } from './views/home.js';
import { renderGameDay } from './views/gameday.js';
import { renderRace } from './views/race.js';
import { renderTeam } from './views/team.js';
import { renderWhatIf } from './views/whatif.js';
import { renderPac12 } from './views/pac12.js';
import { renderModel } from './views/model.js';

const ROUTES = [
  { path: 'odds', label: 'Odds', icon: 'M4 18h3v-6H4v6Zm6.5 0h3V6h-3v12ZM17 18h3v-9h-3v9Z', render: renderHome },
  { path: 'gameday', label: 'Game Day', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3 2.5 2-1 3h-3l-1-3L12 6Z', render: renderGameDay },
  { path: 'race', label: 'The Race', icon: 'M5 4v16M5 5h11l-2 3.5L16 12H5', render: renderRace },
  { path: 'whatif', label: 'What-If', icon: 'M9 9a3 3 0 1 1 4.2 2.75c-.8.37-1.2.9-1.2 1.75V14M12 18h.01', render: renderWhatIf },
  { path: 'pac12', label: 'Pac-12', icon: 'M4 20h16M6 20V10m4 10V6m4 14v-8m4 8V8', render: renderPac12 },
  { path: 'model', label: 'How it works', icon: 'M12 3v3m0 12v3M3 12h3m12 0h3M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1m-7.2 7.2-2.1 2.1', render: renderModel, secondary: true },
];

class App {
  constructor() {
    this.listeners = new Set();
    this.worker = null;
    this.reqId = 0;
    this.pending = new Map();
    this.live = { active: false, checkedAt: null, changed: false, running: false, error: null };
  }

  async load() {
    const get = (f) => fetch(`data/${f}?v=${Date.now() >> 16}`).then((r) => (r.ok ? r.json() : null));
    const [snap, history, seasons] = await Promise.all([get('snapshot.json'), get('history.json'), get('history-seasons.json')]);
    if (!snap) throw new Error('No data yet');
    this.snap = snap;
    this.history = history || [];
    this.seasons = seasons || [];
    this.input = snap.input;
    this.inputKey = 'base';
    this.ctx = prepare(this.input);
    this.sum = snap.baseline;
    this.baseSum = snap.baseline;
    this.lev = new Map(snap.leverage.games.map((g) => [g.id, g]));
    this.levLater = new Map(snap.leverage.later.map((g) => [g.id, g]));
    this.levCond = new Map(snap.leverage.conditional.map((g) => [g.id, g]));
    const wo = snap.leverage.winOut || { base: null, games: [], later: [] };
    this.wo = { base: wo.base, map: new Map([...wo.later, ...wo.games].map((g) => [g.id, g])) };
    this.gameMeta = snap.gamesMeta;
  }

  // ---- lookups ----
  T(id) {
    if (id === 'FCS') return { id: 'FCS', abbr: 'FCS', name: 'FCS opponent', location: 'FCS opponent', color: '777777' };
    return this.snap.teams[id] || { id, abbr: '?', name: 'Unknown', location: 'Unknown', color: '777777' };
  }
  confName(id) {
    return this.snap.conferences[id]?.short || this.snap.conferences[id]?.name || '';
  }
  confLong(id) {
    return this.snap.conferences[id]?.name || '';
  }
  get focus() {
    return this.snap.focus;
  }
  gi(id) {
    return this.ctx.gIndex.get(id);
  }
  game(id) {
    const gi = this.gi(id);
    return gi == null ? null : this.ctx.games[gi];
  }
  // display info for a game side (handles FCS opponents)
  side(gameId, which) {
    const g = this.game(gameId);
    const meta = this.gameMeta[gameId];
    const id = which === 'home' ? g.home : g.away;
    if (id === 'FCS') {
      const m = which === 'home' ? meta?.h : meta?.a;
      return { id: 'FCS', espnId: m?.id || null, abbr: m?.abbr || 'FCS', name: m?.name || 'FCS opponent', location: m?.name || 'FCS opponent', color: m?.color || '777777', fcs: true };
    }
    if (id == null) return { id: null, abbr: 'TBD', name: 'TBD', location: 'TBD', color: '777777' };
    return this.T(id);
  }
  homeProb(gameId) {
    const gi = this.gi(gameId);
    return gi == null ? null : homeWinProb(this.ctx, gi);
  }
  margin(gameId) {
    const gi = this.gi(gameId);
    return gi == null ? null : expectedMargin(this.ctx, gi);
  }
  teamGames(teamId) {
    return this.ctx.games.filter((g) => g.home === teamId || g.away === teamId).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // Weekly points for charts: one per finished week, plus the latest live run as "Now".
  get chartHistory() {
    const weekly = this.history.filter((x) => x.replay);
    const live = this.history.filter((x) => !x.replay);
    const now = live[live.length - 1];
    return now ? [...weekly, now] : weekly;
  }
  // history series for one team (bid odds per chart point)
  historyFor(teamId) {
    return this.chartHistory.map((hh) => hh.bids?.[teamId] ?? null);
  }

  // ---- worker ----
  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const { id, progress } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      if (progress != null) {
        p.onProgress?.(progress);
        return;
      }
      this.pending.delete(id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    return this.worker;
  }
  call(type, payload, onProgress) {
    const id = ++this.reqId;
    const w = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, type, input: this.input, key: this.inputKey, ...payload });
    });
  }
  async sim(opts) {
    const r = await this.call('run', { opts });
    return r.summary;
  }
  async leverage(gameIds, opts, onProgress) {
    const r = await this.call('leverage', { gameIds, opts }, onProgress);
    return r.leverage;
  }

  // ---- events ----
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(what) {
    for (const fn of this.listeners) fn(what);
  }

  // ---- live mode: pull this week's scoreboard straight from ESPN ----
  async checkLive({ force = false } = {}) {
    if (this.live.running) return;
    const week = this.snap.currentWeek;
    if (week > 14) return;
    this.live.running = true;
    try {
      const res = await fetch(scoreboardUrl(this.snap.season, week), { cache: 'no-store' });
      const data = await res.json();
      let changed = false;
      let scores = false;
      let anyLive = false;
      const games = this.input.games.map((g) => ({ ...g }));
      const byId = new Map(games.map((g) => [g.id, g]));
      for (const e of data.events || []) {
        const p = parseEvent(e);
        if (!p) continue;
        const g = byId.get(p.id);
        if (!g) continue;
        if (p.status === 'in') anyLive = true;
        const meta = this.gameMeta[p.id] || (this.gameMeta[p.id] = {});
        meta.status = p.statusText;
        meta.possession = p.possession;
        meta.down = p.downDistance;
        if (p.oddsText && p.status === 'pre') meta.odds = p.oddsText;
        if (p.status === 'canceled') continue;
        if (g.status !== p.status || g.hs !== p.hs || g.as !== p.as || (p.status === 'in' && g.frac !== p.frac)) {
          if (g.status !== p.status || p.status === 'in' || p.status === 'post') {
            changed = true;
            scores = true;
          }
          g.status = p.status;
          g.hs = p.hs;
          g.as = p.as;
          g.frac = p.frac;
          if (p.status === 'post') g.spread = null;
        }
        // only re-run for a real line move, not a half-point wiggle
        if (p.status === 'pre' && p.spread != null && g.spread !== p.spread) {
          if (g.spread == null || Math.abs(g.spread - p.spread) >= 1.5) changed = true;
          g.spread = p.spread;
        }
      }
      this.live.checkedAt = new Date().toISOString();
      this.live.active = anyLive;
      if (changed || force) {
        this.input = { ...this.input, games };
        this.inputKey = `live-${Date.now()}`;
        this.ctx = prepare(this.input);
        this.live.changed = scores ? 'scores' : 'lines';
        this.emit('live-games');
        // same size and seed as the published baseline: only the changed games move the odds
        const sum = await this.sim({ n: this.snap.sims || 20000, seed: 20261103 });
        this.sum = sum;
        this.emit('live-odds');
        // fresh leverage for games still to finish this week that matter most
        const open = this.input.games
          .filter((g) => g.week === week && g.status !== 'post' && g.kind === 'reg')
          .map((g) => g.id)
          .sort((a, b) => Math.abs(this.lev.get(b)?.swing || 0) - Math.abs(this.lev.get(a)?.swing || 0))
          .slice(0, 8);
        if (open.length) {
          const lv = await this.leverage(open, { n: Math.min(4000, this.snap.leverage.n || 4000), seed: 4242 });
          for (const g of lv.games) this.lev.set(g.id, g);
          this.lev.base = lv.base;
          this.emit('live-leverage');
        }
      } else this.emit('live-checked');
      this.live.error = null;
    } catch (err) {
      this.live.error = String(err.message || err);
      this.emit('live-checked');
    } finally {
      this.live.running = false;
    }
  }

  startLivePolling() {
    const tick = async () => {
      await this.checkLive();
      const soon = this.input.games.some((g) => g.week === this.snap.currentWeek && g.status === 'pre' && Date.parse(g.date) - Date.now() < 20 * 60e3 && Date.parse(g.date) > Date.now() - 6 * 3600e3);
      const delay = this.live.active ? 45e3 : soon ? 120e3 : 15 * 60e3;
      this.liveTimer = setTimeout(tick, delay);
    };
    tick();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(this.liveTimer);
        tick();
      }
    });
  }
}

export const app = new App();

// ---- shell ----
function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, ...params] = hash.split('/');
  if (path === 'team') return { route: { path: 'team', render: renderTeam }, params };
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  return { route, params };
}

function buildShell() {
  const root = document.getElementById('app');
  clear(root);
  const status = h('div', { class: 'live-status', id: 'live-status' });
  const themeBtn = h(
    'button',
    {
      class: 'icon-btn',
      'aria-label': 'Switch light or dark',
      onclick: () => {
        const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try {
          localStorage.setItem('dam-odds-theme', next);
        } catch {
          /* private mode */
        }
      },
    },
    icon('M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z')
  );
  const header = h(
    'header',
    { class: 'top' },
    h(
      'a',
      { class: 'brand', href: '#/odds' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'D'),
      h('span', { class: 'brand-text' }, h('strong', null, 'Dam Odds'), h('span', { class: 'brand-sub' }, 'Oregon State’s road to the CFP'))
    ),
    h('div', { class: 'top-right' }, status, h('a', { class: 'top-link', href: '#/model' }, 'How it works'), themeBtn)
  );
  const nav = h(
    'nav',
    { class: 'nav', 'aria-label': 'Sections' },
    ROUTES.map((r) => h('a', { href: `#/${r.path}`, 'data-path': r.path, class: r.secondary ? 'secondary' : null }, icon(r.icon), h('span', null, r.label)))
  );
  const main = h('main', { id: 'view', tabindex: -1 });
  const foot = h(
    'footer',
    { class: 'foot' },
    h('p', null, 'Unofficial fan project, not affiliated with Oregon State University, the Pac-12 or the CFP. Data: ESPN public scoreboards and rankings. Odds come from a simulation model and can be wrong.'),
    h('p', null, 'Team logos are trademarks of their schools, shown for identification.')
  );
  root.append(header, h('div', { class: 'body' }, nav, h('div', { class: 'content' }, main, foot)));
}

function renderStatus() {
  const el = document.getElementById('live-status');
  if (!el) return;
  clear(el);
  const L = app.live;
  if (L.active) el.append(h('span', { class: 'pill live' }, h('span', { class: 'dot' }), 'Live'), h('span', { class: 'muted small' }, ` updated ${clockTime(L.checkedAt)}`));
  else if (L.changed) el.append(h('span', { class: 'pill' }, L.changed === 'scores' ? 'Updated with new scores' : 'Updated with new lines'), h('span', { class: 'muted small' }, ` ${clockTime(L.checkedAt)}`));
  else el.append(h('span', { class: 'muted small' }, `Model run ${ago(app.snap.generatedAt)}`));
}

let lastPath = null;
function render() {
  const { route, params } = currentRoute();
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === route.path));
  const view = document.getElementById('view');
  const y = route.path === lastPath ? window.scrollY : 0;
  clear(view);
  try {
    view.append(route.render(app, params));
  } catch (err) {
    console.error(err);
    view.append(h('div', { class: 'card' }, h('h2', null, 'Something broke on this page'), h('pre', { class: 'small' }, String(err.stack || err))));
  }
  if (route.path !== lastPath) {
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  } else window.scrollTo(0, y);
  lastPath = route.path;
  renderStatus();
  document.title = `${route.label ? `${route.label} · ` : ''}Dam Odds`;
}

async function boot() {
  try {
    const t = localStorage.getItem('dam-odds-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch {
    /* ignore */
  }
  buildShell();
  try {
    await app.load();
  } catch (err) {
    document.getElementById('view').append(h('div', { class: 'card' }, h('h2', null, 'Couldn’t load the odds'), h('p', null, String(err.message || err))));
    return;
  }
  window.addEventListener('hashchange', render);
  app.on((what) => {
    if (what === 'live-checked') renderStatus();
    else if (!document.querySelector('[data-busy="1"]')) render();
    else renderStatus();
  });
  render();
  app.startLivePolling();
}

boot();
