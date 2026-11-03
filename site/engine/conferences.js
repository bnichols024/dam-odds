// Conference standings and championship-game selection with a generic tiebreaker:
//   1. conference winning percentage
//   2. head-to-head (mini-league among the tied teams, used only when every tied team played
//      every other one)
//   3. power rating (stand-in for the composite computer rankings most G6 leagues use late in
//      their tiebreakers)
// After each pick the remaining tied teams start over, the way most leagues "revert" to the
// two-team rule.

/**
 * @param {string[]} teamIds eligible teams in the group being ordered
 * @param {(id:string)=>number} pct conference win percentage
 * @param {(a:string,b:string)=>{wins:number,games:number}} h2h results of a vs b
 * @param {(id:string)=>number} rating
 */
export function orderTeams(teamIds, pct, h2h, rating) {
  const sorted = [...teamIds].sort((a, b) => pct(b) - pct(a) || rating(b) - rating(a));
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && Math.abs(pct(sorted[j]) - pct(sorted[i])) < 1e-9) j++;
    const group = sorted.slice(i, j);
    out.push(...orderTied(group, h2h, rating));
    i = j;
  }
  return out;
}

function orderTied(group, h2h, rating) {
  const out = [];
  let rest = [...group];
  while (rest.length) {
    const top = pickTop(rest, h2h, rating);
    out.push(top);
    rest = rest.filter((t) => t !== top);
  }
  return out;
}

function pickTop(group, h2h, rating) {
  if (group.length === 1) return group[0];
  let allPlayed = true;
  const mini = new Map();
  for (const a of group) {
    let w = 0;
    let n = 0;
    for (const b of group) {
      if (a === b) continue;
      const r = h2h(a, b);
      if (!r.games) allPlayed = false;
      w += r.wins;
      n += r.games;
    }
    mini.set(a, n ? w / n : 0);
  }
  if (allPlayed) {
    const best = Math.max(...group.map((t) => mini.get(t)));
    const top = group.filter((t) => Math.abs(mini.get(t) - best) < 1e-9);
    if (top.length < group.length) return pickTop(top, h2h, rating);
  }
  return group.reduce((a, b) => (rating(b) > rating(a) ? b : a));
}

/**
 * Pick the two title-game teams. Returns [higherSeed, lowerSeed].
 * @param {{format:'top2'|'divisions', divisions?: Record<string,string[]>}} conf
 */
export function titleGameTeams(conf, eligibleIds, pct, h2h, rating) {
  if (conf.format === 'divisions' && conf.divisions) {
    const winners = [];
    for (const ids of Object.values(conf.divisions)) {
      const el = ids.filter((t) => eligibleIds.includes(t));
      if (el.length) winners.push(topK(el, 1, pct, h2h, rating)[0]);
    }
    if (winners.length === 2) return orderTeams(winners, pct, h2h, rating);
  }
  return topK(eligibleIds, 2, pct, h2h, rating);
}

// Only teams that can still finish in the top k need the tiebreaker.
export function topK(ids, k, pct, h2h, rating) {
  if (ids.length <= k) return orderTeams(ids, pct, h2h, rating);
  const ps = ids.map(pct).sort((a, b) => b - a);
  const cut = ps[k - 1] - 1e-9;
  const contenders = ids.filter((t) => pct(t) >= cut);
  return orderTeams(contenders, pct, h2h, rating).slice(0, k);
}
