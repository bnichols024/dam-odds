// Who to root for in a game, how much it matters, and why. Shared by Today, Game Day and Odds.
import { pct, shortDate } from './util.js';

const PAC12 = '9';

// Tiers on the "if OSU wins out" swing (percentage points of CFP odds).
export const TIERS = [
  { key: 'big', label: 'Big', min: 0.01, dots: 3 },
  { key: 'medium', label: 'Medium', min: 0.003, dots: 2 },
  { key: 'small', label: 'Small', min: 0.0005, dots: 1 },
  { key: 'none', label: 'Doesn’t matter', min: -1, dots: 0 },
];
export const tierFor = (gain) => TIERS.find((t) => gain >= t.min);

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Win-out numbers come from their own paired sample; shift them onto the headline
// "CFP odds if OSU wins out" so every figure on the page agrees.
export function woAnchor(app, x) {
  const head = app.sum.focus.bidIfWinOut ?? app.wo.base;
  return clamp01(head + (x - (app.wo.base ?? head)));
}

function overallAnchor(app, x) {
  const levBase = app.lev.base ?? app.snap.leverage.base;
  return clamp01(app.sum.focus.bid + (x - levBase));
}

/**
 * @returns {null | {side, team, tier, wo: {ifWin, ifLose, gain}|null, overall: {ifWin, ifLose, gain}|null}}
 */
export function impact(app, gameId) {
  const g = app.game(gameId);
  if (!g || !g.home || !g.away) return null;
  const wo = app.wo.map.get(gameId);
  const ov = app.lev.get(gameId) || app.levLater.get(gameId);
  if (!wo && !ov) return null;
  const lead = wo || ov;
  const side = lead.ifHome - lead.ifAway >= 0 ? 'home' : 'away';
  const pick = (lv, anchor) =>
    lv
      ? {
          ifWin: anchor(app, side === 'home' ? lv.ifHome : lv.ifAway),
          ifLose: anchor(app, side === 'home' ? lv.ifAway : lv.ifHome),
          gain: (side === 'home' ? 1 : -1) * (lv.ifHome - lv.ifAway),
        }
      : null;
  const w = pick(wo, woAnchor);
  const o = pick(ov, overallAnchor);
  const tier = tierFor(w ? w.gain : (o?.gain ?? 0) * 8);
  return { side, team: app.side(gameId, side), against: app.side(gameId, side === 'home' ? 'away' : 'home'), tier, wo: w, overall: o };
}

// Plain-English reasons a result matters to OSU.
export function reasons(app, gameId, side) {
  const F = app.focus;
  const g = app.game(gameId);
  const forId = side === 'home' ? g.home : g.away;
  const againstId = side === 'home' ? g.away : g.home;
  const out = [];
  const odds = (id) => app.sum.teams[id] || {};
  const osuGames = app.teamGames(F);
  const vsOsu = (id) => osuGames.find((x) => x.home === id || x.away === id);
  const name = (id) => app.T(id).location;

  if (againstId && againstId !== 'FCS') {
    const b = odds(againstId).bid ?? 0;
    if (b >= 0.01) out.push(`${name(againstId)} is a rival for the CFP spot (${pct(b)})`);
    else if (b >= 0.002) out.push(`${name(againstId)} is a long-shot rival for the spot (${pct(b)})`);
    const c = odds(againstId).champ ?? 0;
    const conf = app.T(againstId).conf;
    if (c >= 0.15 && conf !== PAC12 && app.snap.conferences[conf]?.g6)
      out.push(`${name(againstId)} is chasing the ${app.confName(conf)} title (${pct(c)}); a loss opens it up`);
  }
  if (forId && forId !== 'FCS') {
    const og = vsOsu(forId);
    if (og) {
      if (og.status === 'post') {
        const osuWon = (og.home === F && og.hs > og.as) || (og.away === F && og.as > og.hs);
        out.push(osuWon ? `OSU beat ${name(forId)}: their wins make that win count for more` : `${name(forId)} beat OSU: their wins make that loss look better`);
      } else out.push(`OSU plays ${name(forId)} on ${shortDate(og.date)}: a stronger opponent is a better win`);
    }
  }
  const pac = (id) => app.T(id)?.conf === PAC12;
  if (g.conf && pac(g.home) && pac(g.away)) out.push('Pac-12 title-game race');
  if (!out.length) out.push('Ripple effects on ratings and schedules');
  return out;
}

// For OSU's own game: CFP odds with a win or a loss, and the win-out chance after a win.
export function osuGameImpact(app, gameId) {
  const g = app.game(gameId);
  const F = app.focus;
  const lv = app.lev.get(gameId) || app.levLater.get(gameId);
  const isHome = g.home === F;
  const f = app.sum.focus;
  const step = (f.ladder || []).find((s) => s.id === gameId);
  const first = f.ladder?.[0]?.id === gameId;
  return {
    ifWin: lv ? overallAnchor(app, isHome ? lv.ifHome : lv.ifAway) : null,
    ifLose: lv ? overallAnchor(app, isHome ? lv.ifAway : lv.ifHome) : null,
    winOutNow: f.winOutAll ?? null,
    winOutAfterWin: first && step && step.pWin ? f.winOutAll / step.pWin : null,
    pWin: step?.pWin ?? null,
  };
}
