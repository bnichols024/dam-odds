// Fit the committee model on 2014-2025 final CFP rankings and backtest it.
// Output: site/data/model.json and site/data/history-seasons.json
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seasonGames, finalCfp } from './espn.js';
import { seasonResumes, finals, teamConferences } from './season.js';
import { fitRatings } from '../site/engine/ratings.js';
import { FEATURES, fitPairwiseConstrained, scoreVector, softmax } from '../site/engine/committee.js';
import { TRAIN_SEASONS, FBS_CONFS, PARAMS } from './config.js';
import { mean, sd } from '../site/engine/math.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'site', 'data');

function pairsForSeason(S) {
  const ranked = [];
  const unranked = [];
  for (const t of S.teams.values()) (t.rank ? ranked : unranked).push(t);
  ranked.sort((a, b) => a.rank - b.rank);
  const pairs = [];
  const w = (a, b) => (a.g5 || b.g5 ? 2 : 1);
  for (let i = 0; i < ranked.length; i++)
    for (let j = i + 1; j < ranked.length; j++) pairs.push({ hi: ranked[i].vec, lo: ranked[j].vec, weight: w(ranked[i], ranked[j]) });
  // the ranked/unranked line: bubble teams and every decent G5 team
  const cands = unranked.filter((t) => t.acc.l <= 3 && (t.g5 || t.rating > 5));
  for (const r of ranked) {
    for (const u of cands) {
      if (r.rank >= 15 || (r.g5 && u.g5)) pairs.push({ hi: r.vec, lo: u.vec, weight: w(r, u) });
    }
  }
  return pairs;
}

function topG5Eval(S, model) {
  const g5 = [...S.teams.values()].filter((t) => t.g5);
  const scores = g5.map((t) => scoreVector(t.vec, model));
  const probs = softmax(scores);
  const actual = g5.filter((t) => t.rank).sort((a, b) => a.rank - b.rank)[0];
  const order = g5.map((t, i) => ({ t, p: probs[i], s: scores[i] })).sort((a, b) => b.s - a.s);
  const pick = order[0].t;
  const pActual = actual ? probs[g5.indexOf(actual)] : null;
  return { actual, pick, pActual, order };
}

function naivePick(S) {
  const g5 = [...S.teams.values()].filter((t) => t.g5);
  return g5.sort((a, b) => a.acc.l - b.acc.l || b.rating - a.rating)[0];
}

async function main() {
  const seasons = [];
  const names = new Map();
  const oosResiduals = [];
  for (const season of TRAIN_SEASONS) {
    const [{ games, teams }, cfp] = await Promise.all([seasonGames(season), finalCfp(season)]);
    for (const [id, t] of teams) names.set(`${season}:${id}`, t);
    if (!cfp) {
      console.warn('no CFP ranking for', season);
      continue;
    }
    const S = seasonResumes(season, games, { beforeDate: cfp.date });
    const rankOf = new Map(cfp.ranks.map((r) => [r.id, r.rank]));
    for (const t of S.teams.values()) t.rank = rankOf.get(t.id) || null;
    S.season = season;
    S.pairs = pairsForSeason(S);
    seasons.push(S);

    // out-of-sample margin error: ratings through week 8 predicting weeks 9-13
    const confOf = teamConferences(games);
    const isFbs = (id) => FBS_CONFS.has(confOf.get(id));
    const played = finals(games, cfp.date);
    const early = played.filter((g) => g.week <= 8);
    const late = played.filter((g) => g.week >= 9 && g.week <= 13 && !g.title && isFbs(g.home) && isFbs(g.away));
    const fit = fitRatings(early, { isFbs, priorWeight: 1, marginCap: PARAMS.marginCap });
    for (const g of late) {
      const rh = fit.rating[g.home];
      const ra = fit.rating[g.away];
      if (rh == null || ra == null) continue;
      oosResiduals.push(g.hs - g.as - (rh - ra + (g.neutral ? 0 : fit.hfa)));
    }
    console.log(season, 'games', played.length, 'ranked', cfp.ranks.length, 'pairs', S.pairs.length, 'hfa', fit.hfa.toFixed(2));
  }

  // standardization over all FBS team-seasons
  const all = seasons.flatMap((S) => [...S.teams.values()].map((t) => t.vec));
  const mu = FEATURES.map((_, k) => mean(all.map((v) => v[k])));
  const sg = FEATURES.map((_, k) => sd(all.map((v) => v[k])) || 1);

  // choose the L2 penalty by leave-one-season-out log score on the actual top G5 team
  const lambdas = [1, 3, 10, 30];
  const variants = {
    all: FEATURES.map(() => true),
    noWins: FEATURES.map((f) => f !== 'wins'),
    noWinsNoChamp: FEATURES.map((f) => f !== 'wins' && f !== 'confChamp'),
  };
  let best = null;
  for (const [vname, active] of Object.entries(variants)) {
    for (const lambda of lambdas) {
      let lp = 0;
      let hits = 0;
      let cnt = 0;
      for (const S of seasons) {
        const train = seasons.filter((x) => x !== S).flatMap((x) => x.pairs);
        const fit = fitPairwiseConstrained(train, mu, sg, lambda, active);
        const ev = topG5Eval(S, { weights: fit.weights, mean: mu, std: sg });
        if (!ev.actual) continue;
        cnt++;
        lp += Math.log(Math.max(ev.pActual, 1e-6));
        if (ev.pick === ev.actual) hits++;
      }
      console.log(`${vname} lambda ${lambda}: LOSO top-G5 hits ${hits}/${cnt}, mean log p ${(lp / cnt).toFixed(3)}`);
      // most correct picks first, then the better log score
      if (!best || hits > best.hits || (hits === best.hits && lp > best.lp)) best = { variant: vname, active, lambda, lp, hits, cnt };
    }
  }
  console.log('chosen', best.variant, best.lambda);

  // final fit + per-season LOSO report
  const fitAll = fitPairwiseConstrained(
    seasons.flatMap((S) => S.pairs),
    mu,
    sg,
    best.lambda,
    best.active
  );
  const model = { features: FEATURES, mean: mu, std: sg, weights: fitAll.weights, active: fitAll.active };
  const report = [];
  let naiveHits = 0;
  for (const S of seasons) {
    const train = seasons.filter((x) => x !== S).flatMap((x) => x.pairs);
    const f = fitPairwiseConstrained(train, mu, sg, best.lambda, best.active);
    const ev = topG5Eval(S, { weights: f.weights, mean: mu, std: sg });
    const nv = naivePick(S);
    if (nv === ev.actual) naiveHits++;
    const nm = (t) => (t ? names.get(`${S.season}:${t.id}`) : null);
    const row = (t, p) => ({
      id: t.id,
      name: nm(t)?.location || nm(t)?.name,
      abbr: nm(t)?.abbr,
      color: nm(t)?.color,
      conf: t.conf,
      rank: t.rank,
      record: `${t.acc.w}-${t.acc.l}`,
      champ: t.champ,
      rating: +t.rating.toFixed(1),
      sos: +(t.acc.sosSum / t.acc.n).toFixed(1),
      qualWins: t.acc.qw,
      badLosses: t.acc.bl,
      p: p == null ? null : +p.toFixed(3),
    });
    report.push({
      season: S.season,
      actual: ev.actual ? row(ev.actual, ev.pActual) : null,
      pick: row(ev.pick, ev.order[0].p),
      hit: ev.pick === ev.actual,
      naive: row(nv, null),
      contenders: ev.order.slice(0, 6).map((o) => row(o.t, o.p)),
      rankedG5: [...S.teams.values()].filter((t) => t.g5 && t.rank).sort((a, b) => a.rank - b.rank).map((t) => row(t, null)),
    });
    console.log(
      S.season,
      'actual',
      nm(ev.actual)?.abbr,
      `#${ev.actual?.rank}`,
      'model',
      nm(ev.pick)?.abbr,
      ev.pick === ev.actual ? 'HIT' : 'miss',
      `p(actual)=${ev.pActual?.toFixed(2)}`,
      'naive',
      nm(nv)?.abbr
    );
  }

  const oosSd = sd(oosResiduals);
  const sdGame = 14.5;
  const sdTeam = Math.sqrt(Math.max(4, (oosSd * oosSd - sdGame * sdGame) / 2));
  console.log('out-of-sample margin sd', oosSd.toFixed(2), '-> sdTeam', sdTeam.toFixed(2));
  console.log(
    'weights',
    Object.fromEntries(FEATURES.map((f, k) => [f, +fitAll.weights[k].toFixed(3)])),
    'pair acc',
    fitAll.pairAccuracy.toFixed(3)
  );

  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, 'model.json'),
    JSON.stringify(
      {
        trainedAt: new Date().toISOString(),
        seasons: TRAIN_SEASONS,
        committee: model,
        lambda: best.lambda,
        variant: best.variant,
        pairAccuracy: fitAll.pairAccuracy,
        pairs: seasons.reduce((a, S) => a + S.pairs.length, 0),
        validation: { hits: best.hits, seasons: best.cnt, naiveHits, meanLogP: best.lp / best.cnt },
        params: { sdGame, sdTeam: +sdTeam.toFixed(2), oosSd: +oosSd.toFixed(2), oosGames: oosResiduals.length },
      },
      null,
      1
    )
  );
  await writeFile(join(OUT, 'history-seasons.json'), JSON.stringify(report));
  // last season's ratings seed this season's (regressed toward average in build.js)
  const last = seasons[seasons.length - 1];
  const prior = Object.fromEntries(Object.entries(last.fit.rating).map(([id, r]) => [id, +r.toFixed(2)]));
  await writeFile(join(OUT, 'prior.json'), JSON.stringify({ season: last.season, rating: prior }));
  console.log('wrote model.json and history-seasons.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
