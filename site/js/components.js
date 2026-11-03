// Shared bits of UI used across views.
import { h, pct, hexColor, dayTime, spreadText } from './util.js';
import { winMeter } from './charts.js';

export function dot(color) {
  return h('span', { class: 'team-dot', style: { background: hexColor(color) }, 'aria-hidden': 'true' });
}

// Team logo from ESPN's CDN (light and dark versions; CSS shows the one for the theme).
// Falls back to the team-color dot if ESPN has no logo for that id.
const logoUrl = (id, px, dark) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/${dark ? '500-dark' : '500'}/${id}.png&w=${px}&h=${px}`;
export function logo(id, size = 18, color = null) {
  if (!id || id === 'FCS' || Number(id) < 0) return dot(color);
  const px = Math.min(200, Math.round(size * 2));
  const wrap = h('span', { class: 'logo', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' });
  const mk = (dark) => {
    const img = h('img', { src: logoUrl(id, px, dark), alt: '', width: size, height: size, loading: 'lazy', decoding: 'async', class: dark ? 'logo-dark' : 'logo-light' });
    img.addEventListener('error', () => {
      if (dark) {
        img.remove();
        wrap.classList.add('no-dark');
      } else if (wrap.isConnected) wrap.replaceWith(dot(color));
    });
    return img;
  };
  wrap.append(mk(false), mk(true));
  return wrap;
}

export function teamLink(app, id, { full = false, rank = true, size = 18 } = {}) {
  const t = app.T(id);
  const r = rank && (t.cfp || t.ap);
  const label = full ? t.location || t.name : t.abbr;
  const inner = [logo(id, size, t.color), r ? h('span', { class: 'rank' }, String(r)) : null, h('span', { class: 'tname' }, label)];
  if (!id || id === 'FCS' || !app.snap.teams[id]) return h('span', { class: 'team' }, inner);
  return h('a', { class: `team${id === app.focus ? ' focus' : ''}`, href: `#/team/${id}` }, inner);
}

export function sideLabel(app, gameId, which, opts = {}) {
  const t = app.side(gameId, which);
  if (t.fcs || t.id === null || t.id === 'FCS')
    return h('span', { class: 'team' }, logo(t.espnId, opts.size || 18, t.color), h('span', { class: 'tname' }, opts.full ? t.location : t.abbr));
  return teamLink(app, t.id, opts);
}

export function card(title, ...body) {
  return h('section', { class: 'card' }, title ? h('h2', null, title) : null, ...body);
}

export function cardSub(title, sub, ...body) {
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, title), sub ? h('p', { class: 'muted small' }, sub) : null), ...body);
}

export function stat(label, value, note) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), note ? h('div', { class: 'stat-note' }, note) : null);
}

export function delta(d, { digits = 1, unit = 'pts' } = {}) {
  if (d == null || Math.abs(d) < 0.0005) return h('span', { class: 'delta flat' }, '±0');
  const up = d > 0;
  return h('span', { class: `delta ${up ? 'up' : 'down'}` }, h('span', { 'aria-hidden': 'true' }, up ? '▲ ' : '▼ '), `${(Math.abs(d) * 100).toFixed(digits)} ${unit}`);
}

// One game line: away @ home, status/score or line + win chances.
export function gameLine(app, gameId, { showMeter = true, extra = null } = {}) {
  const g = app.game(gameId);
  const meta = app.gameMeta[gameId] || {};
  const pH = app.homeProb(gameId);
  const home = app.side(gameId, 'home');
  const away = app.side(gameId, 'away');
  let status;
  if (g.status === 'post') {
    status = h('span', { class: 'final' }, `Final ${g.as}–${g.hs}`);
  } else if (g.status === 'in') {
    status = h('span', { class: 'live-score' }, h('span', { class: 'dot' }), `${g.as}–${g.hs} · ${meta.status || 'Live'}`);
  } else {
    const m = app.margin(gameId);
    const fav = m == null ? null : m >= 0 ? home : away;
    const lineTxt = meta.odds || (m != null && fav ? `${fav.abbr} by ${spreadText(Math.abs(m))} (model)` : '');
    status = h('span', { class: 'muted' }, `${dayTime(g.date)}${meta.tv ? ` · ${meta.tv}` : ''}${lineTxt ? ` · ${lineTxt}` : ''}`);
  }
  const at = g.neutral ? 'vs' : '@';
  return h(
    'div',
    { class: 'game-line' },
    h(
      'div',
      { class: 'gl-teams' },
      sideLabel(app, gameId, 'away'),
      h('span', { class: 'at' }, at),
      sideLabel(app, gameId, 'home'),
      g.kind === 'title' ? h('span', { class: 'tag' }, 'Title game') : null,
      g.kind === 'flex' ? h('span', { class: 'tag' }, 'Flex') : null
    ),
    h('div', { class: 'gl-status small' }, status),
    showMeter && pH != null && g.status !== 'post'
      ? h(
          'div',
          { class: 'gl-probs small' },
          h('span', null, `${away.abbr} ${pct(1 - pH)}`),
          winMeter(pH, hexColor(home.color), hexColor(away.color)),
          h('span', null, `${home.abbr} ${pct(pH)}`)
        )
      : null,
    extra
  );
}

export function notice(text, kind = 'info') {
  return h('div', { class: `notice ${kind}` }, text);
}

// Leverage runs use their own (smaller) sample. Shift their numbers onto the headline odds so
// every figure on screen agrees; the swing between outcomes is unchanged.
export function anchored(app, x) {
  const levBase = app.lev.base ?? app.snap.leverage.base;
  return Math.max(0, Math.min(1, app.sum.focus.bid + (x - levBase)));
}

export function rootFor(app, gameId, lev) {
  // which side helps OSU, and by how much
  if (!lev) return null;
  const swing = lev.ifHome - lev.ifAway;
  const side = swing >= 0 ? 'home' : 'away';
  const t = app.side(gameId, side);
  return {
    side,
    team: t,
    gain: Math.abs(swing),
    ifWin: anchored(app, side === 'home' ? lev.ifHome : lev.ifAway),
    ifLose: anchored(app, side === 'home' ? lev.ifAway : lev.ifHome),
  };
}
