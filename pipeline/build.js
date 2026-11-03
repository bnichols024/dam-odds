// Build the live 2026 snapshot: ESPN data -> ratings -> sims -> site/data/*.json
//   SIMS=20000 LEV_SIMS=3000 node pipeline/build.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seasonGames, getJson, standingsUrl, rankingsUrl, allCfp } from './espn.js';
import { seasonResumes } from './season.js';
import { ratingCutoffs, ratingRanks, FCS } from '../site/engine/ratings.js';
import { liveFraction } from '../site/engine/espn.js';
import { scoreVector, softmax } from '../site/engine/committee.js';
import { prepare, run, summarize, leverage, conditional } from '../site/engine/sim.js';
import {
  SEASON,
  FOCUS,
  CONF,
  FBS_CONFS,
  powerConfs,
  groupConfs,
  INELIGIBLE,
  TITLE_FORMAT,
  titleConfFromNote,
  PAC12_FLEX,
  PARAMS,
  CONF_SHORT,
} from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'site', 'data');
const N_BASE = Number(process.env.SIMS || 20000);
const N_LEV = Number(process.env.LEV_SIMS || 3000);
const N_REPLAY = Number(process.env.REPLAY_SIMS || 6000);
const MAX_AGE = Number(process.env.MAX_AGE_MS ?? 5 * 60 * 1000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function parseStandings(st) {
  const confs = [];
  const teams = new Map();
  for (const c of st?.children || []) {
    const conf = { id: c.id, name: c.name, short: c.abbreviation, divisions: null, teams: [] };
    const take = (g, div) => {
      for (const e of g.standings?.entries || []) {
        conf.teams.push(e.team.id);
        teams.set(e.team.id, { id: e.team.id, conf: c.id, div: div || null });
      }
    };
    if (c.children?.length) {
      conf.divisions = {};
      for (const d of c.children) {
        conf.divisions[d.name.replace(/^.*-\s*/, '')] = (d.standings?.entries || []).map((e) => e.team.id);
        take(d, d.name.replace(/^.*-\s*/, ''));
      }
    } else take(c, null);
    confs.push(conf);
  }
  return { confs, teams };
}

/** Engine input for the season "as of" a week (asOfWeek = Infinity for now). */
function buildInput({ raw, fbs, confs, model, prior, asOfWeek = Infinity }) {
  const isFbs = (id) => fbs.has(id);
  const titleGames = raw.filter((g) => g.seasonType === 2 && g.title);
  const lastTitle = titleGames.reduce((m, g) => (g.date > m ? g.date : m), '');
  const cutoffDate = lastTitle ? new Date(Date.parse(lastTitle) + 36 * 3600e3).toISOString() : '9999';
  const season = raw.filter((g) => g.seasonType === 2 && g.date <= cutoffDate);

  const asOf = (g) => {
    if (g.week != null && g.week > asOfWeek) return { ...g, status: 'pre', hs: null, as: null, spread: null };
    return g;
  };
  const view = season.map(asOf);

  const priorMap = {};
  for (const id of fbs.keys()) priorMap[id] = PARAMS.priorRegress * (prior.rating[id] ?? -6);
  const S = seasonResumes(SEASON, view, { prior: priorMap, priorWeight: PARAMS.priorGames });
  const fit = S.fit;
  const cutoffs = ratingCutoffs(fit.rating, isFbs);

  const confOf = (id) => fbs.get(id)?.conf;
  const flexHosts = new Set(PAC12_FLEX.hosts);
  const games = [];
  for (const g of view) {
    if (g.status === 'canceled') continue;
    const home = g.home == null ? null : isFbs(g.home) ? g.home : FCS;
    const away = g.away == null ? null : isFbs(g.away) ? g.away : FCS;
    if (home === FCS && away === FCS) continue;
    let kind = 'reg';
    let titleConf = null;
    if (g.title) {
      kind = 'title';
      titleConf = titleConfFromNote(g.note);
      if (!titleConf) continue;
    } else if (g.week === 13 && flexHosts.has(g.home) && (g.away == null || confOf(g.away) === CONF.PAC12)) {
      kind = 'flex';
    } else if (home == null || away == null) continue;
    const sameConf = home && away && confOf(home) && confOf(home) === confOf(away) && confOf(home) !== CONF.IND;
    games.push({
      id: g.id,
      week: g.week,
      date: g.date,
      home,
      away,
      neutral: g.neutral,
      conf: kind === 'reg' && !!sameConf && g.conf,
      status: g.status,
      hs: g.hs,
      as: g.as,
      frac: liveFraction(g),
      spread: g.status !== 'post' ? g.spread : null,
      kind,
      titleConf,
    });
  }
  const G6 = groupConfs(SEASON);
  const P4 = powerConfs(SEASON);
  const teams = [...fbs.values()].map((t) => ({
    id: t.id,
    conf: t.conf,
    g6: G6.has(t.conf),
    p4: P4.has(t.conf) || t.id === '87',
    eligible: !INELIGIBLE[t.id],
    rating: +(fit.rating[t.id] ?? 0).toFixed(3),
  }));
  teams.push({ id: FCS, conf: null, g6: false, p4: false, eligible: false, rating: +fit.rating[FCS].toFixed(3) });

  const conferences = confs
    .filter((c) => FBS_CONFS.has(c.id) && c.id !== CONF.IND)
    .map((c) => ({
      id: c.id,
      name: c.name,
      format: TITLE_FORMAT[c.id] || 'top2',
      divisions: TITLE_FORMAT[c.id] === 'divisions' ? c.divisions : null,
      teams: c.teams,
      g6: G6.has(c.id),
    }));

  return {
    S,
    fit,
    input: {
      season: SEASON,
      focus: FOCUS,
      rule: 'top',
      asOfWeek: Number.isFinite(asOfWeek) ? asOfWeek : null,
      params: {
        sdGame: model.params.sdGame,
        sdTeam: model.params.sdTeam,
        hfa: +fit.hfa.toFixed(3),
        marginCap: PARAMS.marginCap,
        updateLambda: 2,
      },
      teams,
      games,
      conferences,
      flex: PAC12_FLEX,
      committee: model.committee,
      cutoffs,
      ineligible: INELIGIBLE,
    },
  };
}

// "If the season ended today": committee order of G6 teams on current resumes.
function currentOrder(S, model, fbs) {
  const G6 = groupConfs(SEASON);
  const rows = [...S.teams.values()].filter((t) => G6.has(t.conf));
  const scores = rows.map((t) => scoreVector(t.vec, model.committee));
  const el = rows.map((t) => !INELIGIBLE[t.id]);
  const pr = softmax(scores.map((s, i) => (el[i] ? s : -1e9)));
  return rows
    .map((t, i) => ({
      id: t.id,
      score: +scores[i].toFixed(3),
      pTop: +pr[i].toFixed(4),
      vec: t.vec.map((x) => +x.toFixed(3)),
      eligible: el[i],
    }))
    .sort((a, b) => b.score - a.score);
}

async function main() {
  const t0 = Date.now();
  const model = JSON.parse(await readFile(join(OUT, 'model.json'), 'utf8'));
  const prior = JSON.parse(await readFile(join(OUT, 'prior.json'), 'utf8'));
  let history = [];
  try {
    history = JSON.parse(await readFile(join(OUT, 'history.json'), 'utf8'));
  } catch {
    /* first run */
  }

  log('fetching ESPN');
  const [{ games: raw, teams: meta }, standingsRaw, rankingsRaw, cfpAll] = await Promise.all([
    seasonGames(SEASON, { maxAgeMs: MAX_AGE, weeks: 16 }),
    getJson(standingsUrl(SEASON), { cacheKey: `standings-${SEASON}`, maxAgeMs: MAX_AGE }),
    getJson(rankingsUrl(SEASON), { cacheKey: `rankings-${SEASON}`, maxAgeMs: MAX_AGE }),
    allCfp(SEASON, { maxAgeMs: MAX_AGE }).catch(() => []),
  ]);
  const { confs, teams: fbs } = parseStandings(standingsRaw);
  log('games', raw.length, 'fbs teams', fbs.size);

  const regular = raw.filter((g) => g.seasonType === 2 && !g.title && g.week != null && g.week <= 14);
  const open = regular.filter((g) => g.status !== 'post');
  const currentWeek = open.length ? Math.min(...open.map((g) => g.week)) : 15;
  const lastDoneWeek = currentWeek - 1;

  // ---- now ----
  const { S, fit, input } = buildInput({ raw, fbs, confs, model, prior });
  const ctx = prepare(input);
  let t = Date.now();
  const res = run(ctx, { n: N_BASE, seed: 20261103, track: true });
  log(`baseline ${N_BASE} sims in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  const baseline = summarize(ctx, res);
  log('OSU bid', (baseline.focus.bid * 100).toFixed(2) + '%', 'Pac-12 title', (baseline.focus.champ * 100).toFixed(1) + '%');

  // conditional season leverage from the tracked run, then sharpen the biggest with paired runs
  const trackedIds = res.trace.tracked.map((g) => ctx.games[g].id);
  const condRows = trackedIds.map((id) => {
    const h = conditional(ctx, res, { [id]: 'home' });
    const a = conditional(ctx, res, { [id]: 'away' });
    return { id, swing: h.bid - a.bid, pHome: h.share };
  });
  const thisWeekIds = ctx.games.filter((g) => g.week === currentWeek && g.status !== 'post' && g.kind === 'reg').map((g) => g.id);
  t = Date.now();
  const levWeek = leverage(ctx, thisWeekIds, { n: N_LEV, seed: 4242 });
  log(`this-week leverage: ${thisWeekIds.length} games in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  // "if OSU wins out" view: OSU's only realistic path, and ~10x the resolution for small games
  const WO = { forceTeams: { [FOCUS]: 'win' } };
  const resWO = run(ctx, { n: N_BASE, seed: 20261103, track: true, ...WO });
  const condWO = res.trace.tracked.map((g) => ctx.games[g].id).map((id) => {
    const h = conditional(ctx, resWO, { [id]: 'home' });
    const a = conditional(ctx, resWO, { [id]: 'away' });
    return { id, swing: h.bid - a.bid };
  });
  // only games with both teams known (an unpaired flex slot isn't something to root for)
  const known = (id) => {
    const g = ctx.games[ctx.gIndex.get(id)];
    return !!(g && g.home && g.away);
  };
  const top = (rows, k) =>
    rows
      .filter((r) => !thisWeekIds.includes(r.id) && known(r.id))
      .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))
      .slice(0, k)
      .map((r) => r.id);
  const later = [...new Set([...top(condRows, 12), ...top(condWO, 12)])];
  t = Date.now();
  const levLater = leverage(ctx, later, { n: N_LEV, seed: 4242 });
  log(`later leverage: ${later.length} games in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  const notFocus = (id) => {
    const g = ctx.games[ctx.gIndex.get(id)];
    return g.home !== FOCUS && g.away !== FOCUS;
  };
  t = Date.now();
  const woWeek = leverage(ctx, thisWeekIds.filter(notFocus), { n: N_LEV, seed: 4242, extra: WO });
  const woLater = leverage(ctx, later.filter(notFocus), { n: N_LEV, seed: 4242, extra: WO });
  log(`win-out leverage: ${woWeek.games.length + woLater.games.length} games in ${((Date.now() - t) / 1000).toFixed(1)}s`);

  // ---- replay: what the model would have said after each finished week ----
  const replay = [];
  const haveReplay = new Set(history.filter((h) => h.replay).map((h) => h.week));
  for (let w = 1; w <= lastDoneWeek; w++) {
    if (haveReplay.has(w)) continue;
    const b = buildInput({ raw, fbs, confs, model, prior, asOfWeek: w });
    const c = prepare(b.input);
    const r = summarize(c, run(c, { n: N_REPLAY, seed: 99 + w }));
    const wkGames = regular.filter((g) => g.week === w);
    const date = wkGames.reduce((m, g) => (g.date > m ? g.date : m), '');
    replay.push(historyEntry(r, { t: date, week: w, replay: true, label: `After Week ${w}` }));
    log(`replay week ${w}: OSU ${(r.focus.bid * 100).toFixed(2)}%`);
  }
  history = [...history.filter((h) => h.replay), ...replay, ...history.filter((h) => !h.replay)].sort((a, b) =>
    a.t < b.t ? -1 : 1
  );
  const now = historyEntry(baseline, { t: new Date().toISOString(), week: currentWeek, replay: false, label: 'Now' });
  now.results = regular.filter((g) => g.status === 'post').length;
  const lastLive = [...history].reverse().find((h) => !h.replay);
  const changed =
    !lastLive ||
    Math.abs(lastLive.osu.bid - now.osu.bid) > 0.0015 ||
    lastLive.t.slice(0, 10) !== now.t.slice(0, 10) ||
    lastLive.results !== now.results;
  if (changed) history.push(now);

  // ---- metadata for the UI ----
  const ranks = { ap: {}, coaches: {}, cfp: {} };
  for (const r of rankingsRaw?.rankings || []) {
    const k = r.id === '1' ? 'ap' : r.id === '2' ? 'coaches' : null;
    if (!k) continue;
    for (const x of r.ranks) ranks[k][x.team.id] = x.current;
  }
  const cfpLatest = cfpAll.length ? cfpAll[cfpAll.length - 1] : null;
  if (cfpLatest) for (const x of cfpLatest.ranks) ranks.cfp[x.id] = x.rank;

  const isFbs = (id) => fbs.has(id);
  const rr = ratingRanks(fit.rating, isFbs);
  const records = new Map();
  for (const g of regular.concat(raw.filter((x) => x.title))) {
    if (g.status !== 'post' || !g.home || !g.away) continue;
    for (const [id, won, o] of [
      [g.home, g.hs > g.as, g.away],
      [g.away, g.as > g.hs, g.home],
    ]) {
      const r = records.get(id) || { w: 0, l: 0, cw: 0, cl: 0 };
      if (won) r.w++;
      else r.l++;
      const sameConf = fbs.get(id)?.conf && fbs.get(id)?.conf === fbs.get(o)?.conf && g.conf && !(g.week === 13 && fbs.get(id)?.conf === CONF.PAC12);
      if (sameConf) {
        if (won) r.cw++;
        else r.cl++;
      }
      records.set(id, r);
    }
  }
  const teamsOut = {};
  for (const [id, t] of fbs) {
    const m = meta.get(id) || {};
    const r = records.get(id) || { w: 0, l: 0, cw: 0, cl: 0 };
    teamsOut[id] = {
      id,
      abbr: m.abbr,
      name: m.name,
      short: m.short,
      location: m.location,
      color: m.color,
      alt: m.alt,
      conf: t.conf,
      div: t.div,
      rating: +(fit.rating[id] ?? 0).toFixed(2),
      ratingRank: rr[id],
      record: `${r.w}-${r.l}`,
      confRecord: `${r.cw}-${r.cl}`,
      ap: ranks.ap[id] || null,
      coaches: ranks.coaches[id] || null,
      cfp: ranks.cfp[id] || null,
      ineligible: INELIGIBLE[id] || null,
    };
  }
  const gamesMeta = {};
  for (const g of raw) {
    const side = (tm) => (tm && !fbs.has(tm.id) ? { id: tm.id, abbr: tm.abbr, name: tm.location || tm.name, color: tm.color, fcs: true } : null);
    gamesMeta[g.id] = {
      note: g.note,
      venue: g.venue,
      tv: g.broadcast,
      odds: g.oddsText,
      ou: g.overUnder,
      status: g.statusText,
      h: side(g.homeTeam),
      a: side(g.awayTeam),
    };
  }
  const conferencesOut = Object.fromEntries(
    confs.map((c) => [c.id, { id: c.id, name: c.name, short: CONF_SHORT[c.id] || c.short, g6: groupConfs(SEASON).has(c.id), p4: powerConfs(SEASON).has(c.id) }])
  );

  const snapshot = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    currentWeek,
    focus: FOCUS,
    sims: N_BASE,
    input,
    teams: teamsOut,
    conferences: conferencesOut,
    gamesMeta,
    rankings: { cfpDate: cfpLatest?.date || null, cfpWeek: cfpLatest?.week || null, apWeek: rankingsRaw?.latestWeek?.number || null },
    cfpHistory: cfpAll.map((c) => ({ date: c.date, week: c.week, ranks: c.ranks })),
    baseline,
    now: currentOrder(S, model, fbs),
    leverage: {
      week: currentWeek,
      n: N_LEV,
      base: levWeek.base,
      games: levWeek.games,
      later: levLater.games,
      winOut: { base: woWeek.base, games: woWeek.games, later: woLater.games },
      conditional: condRows.map((r) => ({ id: r.id, swing: +r.swing.toFixed(4) })),
    },
    model: {
      trainedAt: model.trainedAt,
      seasons: model.seasons,
      validation: model.validation,
      lambda: model.lambda,
      pairAccuracy: model.pairAccuracy,
      pairs: model.pairs,
      params: model.params,
    },
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'snapshot.json'), JSON.stringify(snapshot));
  await writeFile(join(OUT, 'history.json'), JSON.stringify(history));
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function historyEntry(sum, extra) {
  const top = Object.entries(sum.teams)
    .sort((a, b) => b[1].bid - a[1].bid)
    .slice(0, 12)
    .map(([id, v]) => [id, +v.bid.toFixed(4)]);
  const bids = Object.fromEntries(top);
  bids[FOCUS] = +sum.focus.bid.toFixed(4);
  return {
    ...extra,
    osu: { bid: +sum.focus.bid.toFixed(4), champ: +sum.focus.champ.toFixed(4), title: +sum.focus.title.toFixed(4) },
    bids,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
