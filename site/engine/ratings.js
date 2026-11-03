// Power ratings from game results: a ridge-regularized, margin-capped least squares fit
// (a capped "simple rating system"). rating[i] is points better than an average FBS team on a
// neutral field. All non-FBS opponents share one pooled "FCS" rating.

export const FCS = 'FCS';

/**
 * @param {Array<{home:string, away:string, neutral:boolean, hs:number, as:number}>} games finals only
 * @param {object} opts
 * @param {(id:string)=>boolean} opts.isFbs
 * @param {Record<string, number>} [opts.prior] prior mean per team (default 0)
 * @param {number} [opts.priorWeight] prior strength in games (default 1)
 * @param {number} [opts.marginCap] cap on margin of victory (default 28)
 */
export function fitRatings(games, { isFbs, prior = {}, priorWeight = 1, marginCap = 28, iters = 400 } = {}) {
  const key = (id) => (isFbs(id) ? id : FCS);
  const rows = [];
  const teams = new Set();
  for (const g of games) {
    const h = key(g.home);
    const a = key(g.away);
    if (h === a) continue; // FCS vs FCS never reaches us, but be safe
    const m = Math.max(-marginCap, Math.min(marginCap, g.hs - g.as));
    rows.push({ h, a, n: g.neutral ? 0 : 1, m });
    teams.add(h);
    teams.add(a);
  }
  const r = {};
  const games_ = {};
  for (const t of teams) {
    r[t] = t === FCS ? -20 : prior[t] ?? 0;
    games_[t] = 0;
  }
  const byTeam = {};
  for (const t of teams) byTeam[t] = [];
  rows.forEach((row, i) => {
    byTeam[row.h].push(i);
    byTeam[row.a].push(i);
    games_[row.h]++;
    games_[row.a]++;
  });

  let hfa = 2.5;
  for (let it = 0; it < iters; it++) {
    for (const t of teams) {
      let s = 0;
      for (const i of byTeam[t]) {
        const row = rows[i];
        if (row.h === t) s += row.m - row.n * hfa + r[row.a];
        else s += -row.m + row.n * hfa + r[row.h];
      }
      const pm = t === FCS ? -20 : prior[t] ?? 0;
      const w = t === FCS ? 1 : priorWeight;
      r[t] = (s + w * pm) / (byTeam[t].length + w);
    }
    // home field from the non-neutral residuals
    let hs = 0;
    let hn = 0;
    for (const row of rows) {
      if (!row.n) continue;
      hs += row.m - (r[row.h] - r[row.a]);
      hn++;
    }
    if (hn) hfa = hs / hn;
    // keep the FBS average at zero
    let fs = 0;
    let fn = 0;
    for (const t of teams) {
      if (t === FCS) continue;
      fs += r[t];
      fn++;
    }
    const shift = fn ? fs / fn : 0;
    for (const t of teams) r[t] -= shift;
  }

  let ss = 0;
  for (const row of rows) {
    const e = row.m - (r[row.h] - r[row.a] + row.n * hfa);
    ss += e * e;
  }
  const residualSd = rows.length ? Math.sqrt(ss / rows.length) : 15;
  return { rating: r, hfa, games: games_, residualSd };
}

// Rating cutoffs (rank 25, 50, 75 among FBS teams) used to label quality wins and bad losses.
export function ratingCutoffs(rating, isFbs) {
  const vals = Object.entries(rating)
    .filter(([id]) => id !== FCS && isFbs(id))
    .map(([, v]) => v)
    .sort((a, b) => b - a);
  const at = (k) => vals[Math.min(vals.length - 1, k - 1)] ?? 0;
  return { q25: at(25), q50: at(50), q75: at(75) };
}

// Rank of every FBS team by rating (1 = best).
export function ratingRanks(rating, isFbs) {
  const ids = Object.keys(rating).filter((id) => id !== FCS && isFbs(id));
  ids.sort((a, b) => rating[b] - rating[a]);
  const out = {};
  ids.forEach((id, i) => (out[id] = i + 1));
  return out;
}
