// The committee model: a resume score per team, fit so that the score difference between two
// teams predicts (logistically) which one the CFP committee ranks higher. Adding Gumbel noise to
// each score and taking the max reproduces those pairwise odds, so the same weights drive both
// "who ranks higher" and "who is the top Group of 6 team".

export const FEATURES = ['wins', 'losses', 'sos', 'qualWins', 'badLosses', 'rating', 'confChamp', 'p4'];

export const FEATURE_LABELS = {
  wins: 'Wins',
  losses: 'Losses',
  sos: 'Strength of schedule',
  qualWins: 'Quality wins',
  badLosses: 'Bad losses',
  rating: 'Power rating (game control)',
  confChamp: 'Conference champion',
  p4: 'Power 4 member',
};

// Quality win: beat a top-25-rated team (1) or a 26-50 team (0.5).
// Bad loss: lost to a team rated outside the top 75 (1) or to an FCS team (2).
export const QW_TOP25 = 1;
export const QW_TOP50 = 0.5;
export const BL_OUTSIDE75 = 1;
export const BL_FCS = 2;

export function newResume() {
  return { w: 0, l: 0, n: 0, sosSum: 0, qw: 0, bl: 0, games: [] };
}

export function addResult(acc, won, oppRating, oppIsFcs, cut) {
  acc.n++;
  acc.sosSum += oppRating;
  if (won) {
    acc.w++;
    if (!oppIsFcs) {
      if (oppRating >= cut.q25) acc.qw += QW_TOP25;
      else if (oppRating >= cut.q50) acc.qw += QW_TOP50;
    }
  } else {
    acc.l++;
    if (oppIsFcs) acc.bl += BL_FCS;
    else if (oppRating < cut.q75) acc.bl += BL_OUTSIDE75;
  }
}

export function featureVector(acc, rating, confChamp, p4) {
  return [acc.w, acc.l, acc.n ? acc.sosSum / acc.n : 0, acc.qw, acc.bl, rating, confChamp ? 1 : 0, p4 ? 1 : 0];
}

export function scoreVector(vec, model) {
  let s = 0;
  for (let k = 0; k < vec.length; k++) s += (model.weights[k] * (vec[k] - model.mean[k])) / model.std[k];
  return s;
}

// Contribution of each feature to a team's score relative to another team (for "why" tables).
export function contributions(vecA, vecB, model) {
  return FEATURES.map((f, k) => ({
    feature: f,
    a: vecA[k],
    b: vecB[k],
    delta: (model.weights[k] * (vecA[k] - vecB[k])) / model.std[k],
  }));
}

export function softmax(scores) {
  const m = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - m));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

// ---- fitting (used by the pipeline) ----

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * Pairwise logistic regression with an L2 penalty. Each pair is (higher-ranked vector,
 * lower-ranked vector, weight). Returns weights on standardized features.
 */
// Expected direction of each feature. A fitted weight that points the other way (usually from
// collinearity, e.g. bad losses vs. losses) is dropped and the model refit.
export const SIGNS = [1, -1, 1, 1, -1, 1, 1, 1];

export function fitPairwiseConstrained(pairs, mean, std, lambda = 1, active = FEATURES.map(() => true)) {
  let act = [...active];
  for (;;) {
    const fit = fitPairwise(pairs, mean, std, lambda, act);
    let worst = -1;
    let worstMag = 0;
    fit.weights.forEach((w, k) => {
      if (act[k] && w * SIGNS[k] < 0 && Math.abs(w) > worstMag) {
        worst = k;
        worstMag = Math.abs(w);
      }
    });
    if (worst < 0) return { ...fit, active: act };
    act = act.map((a, k) => (k === worst ? false : a));
  }
}

export function fitPairwise(pairs, mean, std, lambda = 1, active = null) {
  const K = mean.length;
  const ds = pairs.map(({ hi, lo, weight }) => ({
    d: hi.map((x, k) => (active && !active[k] ? 0 : (x - lo[k]) / std[k])),
    weight: weight ?? 1,
  }));
  let w = new Array(K).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = new Array(K).fill(0);
    const H = Array.from({ length: K }, () => new Array(K).fill(0));
    for (const { d, weight } of ds) {
      let z = 0;
      for (let k = 0; k < K; k++) z += w[k] * d[k];
      const p = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < K; a++) {
        g[a] += weight * (1 - p) * d[a];
        for (let b = 0; b < K; b++) H[a][b] += weight * p * (1 - p) * d[a] * d[b];
      }
    }
    for (let a = 0; a < K; a++) {
      g[a] -= lambda * w[a];
      H[a][a] += lambda;
    }
    const step = solve(H, g);
    let maxStep = 0;
    w = w.map((x, k) => {
      maxStep = Math.max(maxStep, Math.abs(step[k]));
      return x + step[k];
    });
    if (maxStep < 1e-8) break;
  }
  let ll = 0;
  let wsum = 0;
  let correct = 0;
  for (const { d, weight } of ds) {
    let z = 0;
    for (let k = 0; k < K; k++) z += w[k] * d[k];
    ll += weight * Math.log(1 / (1 + Math.exp(-z)));
    wsum += weight;
    if (z > 0) correct += weight;
  }
  return { weights: w, logLoss: -ll / wsum, pairAccuracy: correct / wsum };
}
