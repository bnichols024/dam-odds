// Monte Carlo season simulator for the Group of 6 playoff race.
//
// Each simulated season:
//   1. draws a "true strength" offset for every team (our ratings are estimates),
//   2. plays every unfinished game (betting line if we have one, else ratings),
//   3. sets the Pac-12 title pair after Week 12, then fixes the Week 13 flex games so the title
//      teams don't meet twice,
//   4. picks every league's title-game teams with real-ish tiebreakers and plays those games,
//   5. nudges ratings by the simulated results (like a real rating would move),
//   6. scores every G6 resume with the committee model plus committee noise; the best eligible
//      G6 team gets the CFP bid.
//
// The random draws happen in a fixed order, so two runs with the same seed see the same "luck"
// everywhere except where we force a result. That keeps what-if comparisons and leverage numbers
// from being drowned by simulation noise.

import { mulberry32, normInv, normCdf, gumbel } from './math.js';
import { titleGameTeams } from './conferences.js';
import { QW_TOP25, QW_TOP50, BL_OUTSIDE75, BL_FCS } from './committee.js';

const KIND = { reg: 0, flex: 1, title: 2 };
const STATUS = { pre: 0, in: 1, post: 2 };

export function prepare(input) {
  const P = {
    sdGame: 14.5,
    sdTeam: 4,
    hfa: 2.5,
    marginCap: 28,
    updateLambda: 2,
    ...input.params,
  };
  const teams = input.teams;
  const T = teams.length;
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const rating = Float64Array.from(teams, (t) => t.rating);
  const isFcs = Uint8Array.from(teams, (t) => (t.id === 'FCS' ? 1 : 0));
  const g6 = Uint8Array.from(teams, (t) => (t.g6 ? 1 : 0));
  const p4 = Uint8Array.from(teams, (t) => (t.p4 ? 1 : 0));
  const eligible = Uint8Array.from(teams, (t) => (t.eligible === false ? 0 : 1));

  const order = (g) => (g.kind === 'title' ? 2 : g.kind === 'flex' ? 1 : 0);
  const games = [...input.games].sort((a, b) => order(a) - order(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const G = games.length;
  const gIndex = new Map(games.map((g, i) => [g.id, i]));
  const home = new Int16Array(G).fill(-1);
  const away = new Int16Array(G).fill(-1);
  const neutral = new Uint8Array(G);
  const conf = new Uint8Array(G);
  const status = new Uint8Array(G);
  const kind = new Uint8Array(G);
  const hs = new Float64Array(G);
  const as = new Float64Array(G);
  const frac = new Float64Array(G);
  const muBase = new Float64Array(G).fill(NaN);
  const remaining = new Float64Array(T);
  const played = new Float64Array(T);

  games.forEach((g, i) => {
    const h = g.home != null && idx.has(g.home) ? idx.get(g.home) : -1;
    const a = g.away != null && idx.has(g.away) ? idx.get(g.away) : -1;
    home[i] = h;
    away[i] = a;
    neutral[i] = g.neutral ? 1 : 0;
    conf[i] = g.conf ? 1 : 0;
    status[i] = STATUS[g.status] ?? 0;
    kind[i] = KIND[g.kind] ?? 0;
    hs[i] = g.hs ?? 0;
    as[i] = g.as ?? 0;
    frac[i] = g.frac ?? 1;
    if (h >= 0 && a >= 0 && g.spread != null && Number.isFinite(g.spread)) muBase[i] = -g.spread;
    for (const t of [h, a]) {
      if (t < 0) continue;
      if (status[i] === STATUS.post) played[t]++;
      else remaining[t]++;
    }
  });
  const kUpd = new Float64Array(T);
  for (let t = 0; t < T; t++) kUpd[t] = isFcs[t] ? 0.01 : 1 / (played[t] + remaining[t] + P.updateLambda);

  const confs = (input.conferences || [])
    .filter((c) => c.format && c.format !== 'none')
    .map((c) => {
      const teamIdx = c.teams.filter((id) => idx.has(id)).map((id) => idx.get(id));
      const inConf = new Set(teamIdx);
      const confGames = [];
      games.forEach((g, i) => {
        if (conf[i] && kind[i] === KIND.reg && inConf.has(home[i]) && inConf.has(away[i])) confGames.push(i);
      });
      const titleGame = games.findIndex((g) => g.kind === 'title' && g.titleConf === c.id);
      const divisions = c.divisions
        ? Object.fromEntries(Object.entries(c.divisions).map(([k, ids]) => [k, ids.filter((id) => idx.has(id)).map((id) => idx.get(id))]))
        : null;
      const local = new Map(teamIdx.map((t, j) => [t, j]));
      return { id: c.id, name: c.name, g6: !!c.g6, format: c.format, teamIdx, local, confGames, titleGame, divisions };
    });

  let flex = null;
  if (input.flex) {
    const fc = confs.find((c) => c.id === input.flex.conf);
    const slots = [];
    input.flex.hosts.forEach((hid, k) => {
      const gi = games.findIndex((g) => g.kind === 'flex' && g.home === hid);
      if (gi >= 0) slots.push({ gi, host: idx.get(hid), visitor: idx.get(input.flex.visitors[k]) });
    });
    if (fc && slots.length) flex = { confIdx: confs.indexOf(fc), slots };
  }

  const g6List = [];
  for (let t = 0; t < T; t++) if (g6[t]) g6List.push(t);

  return {
    P,
    input,
    teams,
    T,
    idx,
    rating,
    isFcs,
    g6,
    p4,
    eligible,
    games,
    G,
    gIndex,
    home,
    away,
    neutral,
    conf,
    status,
    kind,
    hs,
    as,
    frac,
    muBase,
    kUpd,
    confs,
    flex,
    g6List,
    committee: input.committee,
    cutoffs: input.cutoffs,
    focus: idx.get(input.focus),
    rule: input.rule || 'top',
  };
}

// Pre-game home win probability for display (same distribution the sim draws from).
export function homeWinProb(ctx, gameIndex) {
  const i = gameIndex;
  const { P } = ctx;
  if (ctx.status[i] === STATUS.post) return ctx.hs[i] > ctx.as[i] ? 1 : 0;
  const h = ctx.home[i];
  const a = ctx.away[i];
  if (h < 0 || a < 0) return null;
  const mu = Number.isNaN(ctx.muBase[i]) ? ctx.rating[h] - ctx.rating[a] + (ctx.neutral[i] ? 0 : P.hfa) : ctx.muBase[i];
  if (ctx.status[i] === STATUS.in) {
    const f = Math.max(ctx.frac[i], 1e-4);
    const v = f * P.sdGame * P.sdGame + f * f * 2 * P.sdTeam * P.sdTeam;
    return normCdf((ctx.hs[i] - ctx.as[i] + f * mu) / Math.sqrt(v));
  }
  return normCdf(mu / Math.sqrt(P.sdGame * P.sdGame + 2 * P.sdTeam * P.sdTeam));
}

export function expectedMargin(ctx, gameIndex) {
  const i = gameIndex;
  const h = ctx.home[i];
  const a = ctx.away[i];
  if (h < 0 || a < 0) return null;
  if (!Number.isNaN(ctx.muBase[i])) return ctx.muBase[i];
  return ctx.rating[h] - ctx.rating[a] + (ctx.neutral[i] ? 0 : ctx.P.hfa);
}

/**
 * @param {object} ctx from prepare()
 * @param {object} opts
 * @param {number} opts.n simulations
 * @param {number} [opts.seed]
 * @param {Record<string,'home'|'away'>} [opts.forced] game id -> forced winner side
 * @param {Record<string,string>} [opts.forcedTitle] conference id -> team id that wins the title game if it plays in it
 * @param {boolean} [opts.track] keep per-sim outcome bits for conditional queries
 * @param {'top'|'champ'} [opts.rule]
 */
export function run(ctx, opts = {}) {
  const n = opts.n ?? 10000;
  const seed = opts.seed ?? 20261103;
  const rule = opts.rule || ctx.rule;
  const { P, T, G, rating, isFcs, g6, eligible, home, away, neutral, status, kind, hs, as, frac, muBase, kUpd, confs, flex, g6List, cutoffs } = ctx;
  const W = ctx.committee.weights;
  const MU = ctx.committee.mean;
  const SD = ctx.committee.std;
  const focus = ctx.focus;

  const forced = new Uint8Array(G);
  for (const [id, side] of Object.entries(opts.forced || {})) {
    const gi = ctx.gIndex.get(id);
    if (gi != null && status[gi] !== STATUS.post) forced[gi] = side === 'home' ? 1 : side === 'away' ? 2 : 0;
  }
  const forcedTitle = new Map();
  for (const [cid, tid] of Object.entries(opts.forcedTitle || {})) if (ctx.idx.has(tid)) forcedTitle.set(cid, ctx.idx.get(tid));
  // team-level overrides: 1 = wins every remaining game it plays, 2 = loses every one
  const teamForce = new Uint8Array(T);
  for (const [tid, how] of Object.entries(opts.forceTeams || {})) if (ctx.idx.has(tid)) teamForce[ctx.idx.get(tid)] = how === 'win' ? 1 : how === 'lose' ? 2 : 0;
  const anyTeamForce = teamForce.some((x) => x);

  // tracked games: everything not final, in game order
  const tracked = [];
  for (let i = 0; i < G; i++) if (status[i] !== STATUS.post && kind[i] !== KIND.title) tracked.push(i);
  const bits = opts.track ? new Uint8Array(n * tracked.length) : null;
  const simFocusBid = opts.track ? new Uint8Array(n) : null;
  const simTop = opts.track ? new Int16Array(n) : null;
  const simFocusW = opts.track ? new Uint8Array(n) : null;
  const simFocusChamp = opts.track ? new Uint8Array(n) : null;

  const H = new Int16Array(G);
  const A = new Int16Array(G);
  const M = new Float64Array(G);
  const e = new Float64Array(T);
  const rf = new Float64Array(T);
  const cw = new Float64Array(T);
  const cl = new Float64Array(T);
  const fw = new Float64Array(T);
  const fl = new Float64Array(T);
  const fn = new Float64Array(T);
  const fsos = new Float64Array(T);
  const fqw = new Float64Array(T);
  const fbl = new Float64Array(T);
  const champ = new Uint8Array(T);
  const inTitle = new Uint8Array(T);
  const score = new Float64Array(T);

  const out = {
    n,
    bid: new Float64Array(T),
    champ: new Float64Array(T),
    title: new Float64Array(T),
    wins: new Float64Array(T),
    losses: new Float64Array(T),
    confWins: new Float64Array(T),
    g6Top3: new Float64Array(T),
    focus: { bid: 0, bidChamp: 0, bidNoChamp: 0, champ: 0, title: 0, record: {}, g6Rank: {}, blockers: {} },
    titlePairs: {},
  };
  const focusConf = focus != null ? confs.find((c) => c.teamIdx.includes(focus)) : null;

  const addSide = (t, o, won) => {
    fn[t]++;
    fsos[t] += rf[o];
    if (won) {
      fw[t]++;
      if (!isFcs[o]) {
        if (rf[o] >= cutoffs.q25) fqw[t] += QW_TOP25;
        else if (rf[o] >= cutoffs.q50) fqw[t] += QW_TOP50;
      }
    } else {
      fl[t]++;
      if (isFcs[o]) fbl[t] += BL_FCS;
      else if (rf[o] < cutoffs.q75) fbl[t] += BL_OUTSIDE75;
    }
  };

  const play = (i, u) => {
    if (status[i] === STATUS.post) {
      M[i] = hs[i] - as[i];
      return;
    }
    const h = H[i];
    const a = A[i];
    let mu = Number.isNaN(muBase[i]) || kind[i] !== KIND.reg ? rating[h] - rating[a] + (neutral[i] ? 0 : P.hfa) : muBase[i];
    mu += e[h] - e[a];
    let base;
    let scale;
    if (status[i] === STATUS.in) {
      const f = Math.max(frac[i], 1e-4);
      base = hs[i] - as[i] + f * mu;
      scale = P.sdGame * Math.sqrt(f);
    } else {
      base = mu;
      scale = P.sdGame;
    }
    let fc = forced[i];
    if (!fc && anyTeamForce) {
      const th = teamForce[h];
      const ta = teamForce[a];
      if (th === 1 && ta !== 1) fc = 1;
      else if (ta === 1 && th !== 1) fc = 2;
      else if (th === 2 && ta !== 2) fc = 2;
      else if (ta === 2 && th !== 2) fc = 1;
    }
    if (fc === 1) {
      const lo = normCdf(-base / scale);
      u = lo + u * (1 - lo);
    } else if (fc === 2) {
      u *= normCdf(-base / scale);
    }
    let m = base + scale * normInv(u);
    if (fc === 1 && m <= 0) m = 0.5;
    if (fc === 2 && m >= 0) m = -0.5;
    if (m === 0) m = u < 0.5 ? -0.5 : 0.5;
    M[i] = m;
  };

  const standings = (c) => {
    for (const t of c.teamIdx) {
      cw[t] = 0;
      cl[t] = 0;
    }
    for (const i of c.confGames) {
      const h = H[i];
      const a = A[i];
      if (h < 0 || a < 0) continue;
      if (M[i] > 0) {
        cw[h]++;
        cl[a]++;
      } else {
        cw[a]++;
        cl[h]++;
      }
    }
    const pct = (t) => (cw[t] + cl[t] ? cw[t] / (cw[t] + cl[t]) : 0);
    // head-to-head matrix, built lazily on the first tiebreak
    let hw = null;
    let hg = null;
    const k = c.teamIdx.length;
    const h2h = (x, y) => {
      if (!hw) {
        hw = new Uint8Array(k * k);
        hg = new Uint8Array(k * k);
        for (const i of c.confGames) {
          const lh = c.local.get(H[i]);
          const la = c.local.get(A[i]);
          if (lh == null || la == null) continue;
          hg[lh * k + la]++;
          hg[la * k + lh]++;
          if (M[i] > 0) hw[lh * k + la]++;
          else hw[la * k + lh]++;
        }
      }
      const lx = c.local.get(x);
      const ly = c.local.get(y);
      return { wins: hw[lx * k + ly], games: hg[lx * k + ly] };
    };
    const el = c.teamIdx.filter((t) => eligible[t]);
    return titleGameTeams(c, el, pct, h2h, (t) => rating[t] + e[t]);
  };

  for (let s = 0; s < n; s++) {
    const rng = mulberry32((seed + s * 7919) >>> 0);
    for (let t = 0; t < T; t++) e[t] = isFcs[t] ? 0 * rng() : P.sdTeam * normInv(rng());
    H.set(home);
    A.set(away);

    // 1. regular-season games
    let i = 0;
    for (; i < G && kind[i] === KIND.reg; i++) play(i, rng());

    // 2. Pac-12 title pair is set after Week 12, then the flex games are fixed and played
    let flexPair = null;
    const flexStart = i;
    if (flex) {
      const c = confs[flex.confIdx];
      const tg = c.titleGame;
      flexPair = tg >= 0 && H[tg] >= 0 && A[tg] >= 0 ? [H[tg], A[tg]] : standings(c);
      const vis = flex.slots.map((sl) => sl.visitor);
      flex.slots.forEach((sl, k) => {
        const [p1, p2] = flexPair;
        if ((sl.host === p1 && vis[k] === p2) || (sl.host === p2 && vis[k] === p1)) {
          const j = (k + 1) % vis.length;
          [vis[k], vis[j]] = [vis[j], vis[k]];
        }
      });
      flex.slots.forEach((sl, k) => {
        if (A[sl.gi] < 0) A[sl.gi] = vis[k];
      });
    }
    for (i = flexStart; i < G && kind[i] === KIND.flex; i++) {
      const u = rng();
      if (H[i] >= 0 && A[i] >= 0) play(i, u);
    }

    // 3. title games
    champ.fill(0);
    inTitle.fill(0);
    for (const c of confs) {
      const tg = c.titleGame;
      const u = rng();
      if (tg < 0) continue;
      if (H[tg] < 0 || A[tg] < 0) {
        const pair = flex && confs[flex.confIdx] === c && flexPair ? flexPair : standings(c);
        if (pair.length < 2) continue;
        H[tg] = pair[0];
        A[tg] = pair[1];
      }
      const ft = forcedTitle.get(c.id);
      if (ft != null && status[tg] !== STATUS.post) forced[tg] = ft === H[tg] ? 1 : ft === A[tg] ? 2 : 0;
      play(tg, u);
      if (ft != null && status[tg] !== STATUS.post) forced[tg] = 0;
      inTitle[H[tg]] = 1;
      inTitle[A[tg]] = 1;
      champ[M[tg] > 0 ? H[tg] : A[tg]] = 1;
      if (c === focusConf) {
        const key = `${ctx.teams[H[tg]].id}|${ctx.teams[A[tg]].id}`;
        const rec = out.titlePairs[key] || (out.titlePairs[key] = { n: 0, homeWins: 0 });
        rec.n++;
        if (M[tg] > 0) rec.homeWins++;
      }
    }
    // leagues that crown a champion without a title game (none among G6 in 2026): best record
    for (const c of confs) {
      if (c.titleGame >= 0) continue;
      const order = standings(c);
      if (order.length) champ[order[0]] = 1;
    }

    // 4. ratings move with the simulated results
    rf.set(rating);
    for (let g = 0; g < G; g++) {
      if (status[g] === STATUS.post) continue;
      const h = H[g];
      const a = A[g];
      if (h < 0 || a < 0) continue;
      const m = M[g] > P.marginCap ? P.marginCap : M[g] < -P.marginCap ? -P.marginCap : M[g];
      const resid = m - (rating[h] - rating[a] + (neutral[g] ? 0 : P.hfa));
      rf[h] += resid * kUpd[h];
      rf[a] -= resid * kUpd[a];
    }

    // 5. resumes for G6 teams
    fw.fill(0);
    fl.fill(0);
    fn.fill(0);
    fsos.fill(0);
    fqw.fill(0);
    fbl.fill(0);
    for (let g = 0; g < G; g++) {
      const h = H[g];
      const a = A[g];
      if (h < 0 || a < 0) continue;
      const homeWon = M[g] > 0;
      if (g6[h]) addSide(h, a, homeWon);
      if (g6[a]) addSide(a, h, !homeWon);
    }

    // 6. committee: score + noise, best eligible G6 team takes the bid
    let best = -1;
    let bestScore = -Infinity;
    for (const t of g6List) {
      const x0 = fw[t];
      const x1 = fl[t];
      const x2 = fn[t] ? fsos[t] / fn[t] : 0;
      const x3 = fqw[t];
      const x4 = fbl[t];
      const x5 = rf[t];
      const x6 = champ[t];
      const sc =
        (W[0] * (x0 - MU[0])) / SD[0] +
        (W[1] * (x1 - MU[1])) / SD[1] +
        (W[2] * (x2 - MU[2])) / SD[2] +
        (W[3] * (x3 - MU[3])) / SD[3] +
        (W[4] * (x4 - MU[4])) / SD[4] +
        (W[5] * (x5 - MU[5])) / SD[5] +
        (W[6] * (x6 - MU[6])) / SD[6] +
        (W[7] * (0 - MU[7])) / SD[7] +
        gumbel(rng());
      score[t] = sc;
      if (!eligible[t]) continue;
      if (rule === 'champ' && !champ[t]) continue;
      if (sc > bestScore) {
        bestScore = sc;
        best = t;
      }
    }

    // tallies
    for (const t of g6List) {
      out.wins[t] += fw[t];
      out.losses[t] += fl[t];
      if (champ[t]) out.champ[t]++;
      if (inTitle[t]) out.title[t]++;
    }
    for (const c of confs) if (c.g6) for (const t of c.teamIdx) out.confWins[t] += cw[t];
    if (best >= 0) out.bid[best]++;
    // top-3 G6 finish (by committee score, eligible teams)
    {
      let a1 = -1;
      let a2 = -1;
      let a3 = -1;
      for (const t of g6List) {
        if (!eligible[t]) continue;
        const sc = score[t];
        if (a1 < 0 || sc > score[a1]) {
          a3 = a2;
          a2 = a1;
          a1 = t;
        } else if (a2 < 0 || sc > score[a2]) {
          a3 = a2;
          a2 = t;
        } else if (a3 < 0 || sc > score[a3]) a3 = t;
      }
      if (a1 >= 0) out.g6Top3[a1]++;
      if (a2 >= 0) out.g6Top3[a2]++;
      if (a3 >= 0) out.g6Top3[a3]++;
    }
    if (focus != null) {
      const f = out.focus;
      const got = best === focus;
      const rec = `${fw[focus]}-${fl[focus]}`;
      f.record[rec] = f.record[rec] || { n: 0, bid: 0, champ: 0 };
      f.record[rec].n++;
      if (champ[focus]) f.record[rec].champ++;
      if (got) {
        f.bid++;
        f.record[rec].bid++;
        if (champ[focus]) f.bidChamp++;
        else f.bidNoChamp++;
      } else if (best >= 0) {
        const id = ctx.teams[best].id;
        f.blockers[id] = (f.blockers[id] || 0) + 1;
      }
      if (champ[focus]) f.champ++;
      if (inTitle[focus]) f.title++;
      let rank = 1;
      for (const t of g6List) if (t !== focus && eligible[t] && score[t] > score[focus]) rank++;
      const rk = rank > 8 ? '9+' : String(rank);
      f.g6Rank[rk] = (f.g6Rank[rk] || 0) + 1;
      if (bits) {
        simFocusBid[s] = got ? 1 : 0;
        simTop[s] = best;
        simFocusW[s] = fw[focus];
        simFocusChamp[s] = champ[focus];
        const base = s * tracked.length;
        for (let k = 0; k < tracked.length; k++) bits[base + k] = M[tracked[k]] > 0 ? 1 : 0;
      }
    }
  }

  if (bits) out.trace = { tracked, bits, focusBid: simFocusBid, top: simTop, focusW: simFocusW, focusChamp: simFocusChamp };
  return out;
}

// Per-team summary in plain objects (for JSON/UI).
export function summarize(ctx, res) {
  const n = res.n;
  const teams = {};
  for (const t of ctx.g6List) {
    const id = ctx.teams[t].id;
    teams[id] = {
      bid: res.bid[t] / n,
      champ: res.champ[t] / n,
      title: res.title[t] / n,
      wins: res.wins[t] / n,
      losses: res.losses[t] / n,
      top3: res.g6Top3[t] / n,
    };
  }
  const f = res.focus;
  const record = Object.fromEntries(
    Object.entries(f.record)
      .sort((a, b) => Number(b[0].split('-')[0]) - Number(a[0].split('-')[0]))
      .map(([k, v]) => [k, { share: v.n / n, bid: v.n ? v.bid / v.n : 0, champ: v.n ? v.champ / v.n : 0 }])
  );
  const titlePairs = Object.entries(res.titlePairs || {})
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 12)
    .map(([k, v]) => {
      const [home, away] = k.split('|');
      return { home, away, share: v.n / n, homeWin: v.homeWins / v.n };
    });
  return {
    n,
    teams,
    titlePairs,
    focus: {
      bid: f.bid / n,
      bidChamp: f.bidChamp / n,
      bidNoChamp: f.bidNoChamp / n,
      champ: f.champ / n,
      title: f.title / n,
      record,
      g6Rank: Object.fromEntries(Object.entries(f.g6Rank).map(([k, v]) => [k, v / n])),
      blockers: Object.fromEntries(
        Object.entries(f.blockers)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k, v / n])
      ),
    },
  };
}

/**
 * Leverage of single games on the focus team's bid odds. Same seed for both forced runs, so the
 * difference is the game's effect, not noise.
 */
export function leverage(ctx, gameIds, { n = 4000, seed = 777, onProgress } = {}) {
  const base = run(ctx, { n, seed }).focus.bid / n;
  const out = [];
  gameIds.forEach((id, k) => {
    const ifHome = run(ctx, { n, seed, forced: { [id]: 'home' } }).focus.bid / n;
    const ifAway = run(ctx, { n, seed, forced: { [id]: 'away' } }).focus.bid / n;
    out.push({ id, ifHome, ifAway, swing: ifHome - ifAway });
    if (onProgress) onProgress((k + 1) / gameIds.length);
  });
  return { base, games: out };
}

// Conditional odds from a tracked run: P(focus bid | these game results).
export function conditional(ctx, res, conditions) {
  const tr = res.trace;
  if (!tr) throw new Error('run with track:true');
  const pos = new Map(tr.tracked.map((g, k) => [ctx.games[g].id, k]));
  const conds = Object.entries(conditions)
    .filter(([id]) => pos.has(id))
    .map(([id, side]) => [pos.get(id), side === 'home' ? 1 : 0]);
  const L = tr.tracked.length;
  let n = 0;
  let b = 0;
  for (let s = 0; s < res.n; s++) {
    let ok = true;
    for (const [k, v] of conds) if (tr.bits[s * L + k] !== v) ok = false;
    if (!ok) continue;
    n++;
    b += tr.focusBid[s];
  }
  return { n, share: n / res.n, bid: n ? b / n : 0 };
}
