// Turn one season of ESPN games into ratings, champions and committee features.
import { fitRatings, ratingCutoffs, FCS } from '../site/engine/ratings.js';
import { newResume, addResult, featureVector } from '../site/engine/committee.js';
import { FBS_CONFS, powerConfs, groupConfs, NOTRE_DAME, PARAMS } from './config.js';

// Most common conference id per team across a season's games.
export function teamConferences(games) {
  const counts = new Map();
  for (const g of games) {
    for (const t of [g.homeTeam, g.awayTeam]) {
      if (!t?.id) continue;
      const m = counts.get(t.id) || new Map();
      m.set(t.conf, (m.get(t.conf) || 0) + 1);
      counts.set(t.id, m);
    }
  }
  const out = new Map();
  for (const [id, m] of counts) out.set(id, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

export function finals(games, beforeDate) {
  return games.filter(
    (g) =>
      g.seasonType === 2 &&
      g.status === 'post' &&
      g.home &&
      g.away &&
      g.hs != null &&
      g.as != null &&
      (!beforeDate || g.date < beforeDate)
  );
}

// Conference champions: title-game winners; leagues without one -> best conference record.
export function conferenceChampions(games, confOf, isFbs) {
  const champs = new Set();
  const withTitle = new Set();
  for (const g of games) {
    if (!g.title || g.status !== 'post') continue;
    const c = confOf.get(g.home);
    if (!c || c !== confOf.get(g.away)) continue;
    withTitle.add(c);
    champs.add(g.hs > g.as ? g.home : g.away);
  }
  const rec = new Map();
  for (const g of games) {
    if (!g.conf || g.title || g.status !== 'post') continue;
    const c = confOf.get(g.home);
    if (!c || c !== confOf.get(g.away) || withTitle.has(c) || c === '18') continue;
    for (const [t, won] of [
      [g.home, g.hs > g.as],
      [g.away, g.as > g.hs],
    ]) {
      const r = rec.get(t) || { w: 0, l: 0, c };
      if (won) r.w++;
      else r.l++;
      rec.set(t, r);
    }
  }
  const best = new Map();
  for (const [t, r] of rec) {
    const p = r.w / (r.w + r.l);
    const b = best.get(r.c);
    if (!b || p > b.p + 1e-9) best.set(r.c, { p, teams: [t] });
    else if (Math.abs(p - b.p) < 1e-9) b.teams.push(t);
  }
  for (const [, b] of best) for (const t of b.teams) if (isFbs(t)) champs.add(t);
  return champs;
}

/**
 * Build everything the committee model needs for one season at selection time.
 * @returns {{ratings, cutoffs, teams: Map<id,{id,conf,p4,g5,champ,acc,vec}>, isFbs}}
 */
export function seasonResumes(season, games, { beforeDate, prior, priorWeight = 1 } = {}) {
  const confOf = teamConferences(games);
  const isFbs = (id) => FBS_CONFS.has(confOf.get(id));
  const played = finals(games, beforeDate);
  const fit = fitRatings(played, { isFbs, prior, priorWeight, marginCap: PARAMS.marginCap });
  const cutoffs = ratingCutoffs(fit.rating, isFbs);
  const champs = conferenceChampions(played, confOf, isFbs);
  const P4 = powerConfs(season);
  const G5 = groupConfs(season);
  const ratingOf = (id) => (isFbs(id) ? fit.rating[id] : fit.rating[FCS]);
  const accs = new Map();
  for (const g of played) {
    for (const [t, o, won] of [
      [g.home, g.away, g.hs > g.as],
      [g.away, g.home, g.as > g.hs],
    ]) {
      if (!isFbs(t)) continue;
      const acc = accs.get(t) || newResume();
      addResult(acc, won, ratingOf(o), !isFbs(o), cutoffs);
      acc.games.push({ opp: o, won, pf: t === g.home ? g.hs : g.as, pa: t === g.home ? g.as : g.hs, date: g.date });
      accs.set(t, acc);
    }
  }
  const teams = new Map();
  for (const [id, acc] of accs) {
    const conf = confOf.get(id);
    const p4 = P4.has(conf) || id === NOTRE_DAME;
    teams.set(id, {
      id,
      conf,
      p4,
      g5: G5.has(conf),
      champ: champs.has(id),
      acc,
      rating: fit.rating[id],
      vec: featureVector(acc, fit.rating[id], champs.has(id), p4),
    });
  }
  return { fit, cutoffs, teams, isFbs, confOf, champs };
}
