// Runs simulations off the main thread so the page stays responsive on phones.
import { prepare, run, summarize, leverage } from '../engine/sim.js';

let cached = { key: null, ctx: null };

function ctxFor(input, key) {
  if (cached.key !== key || !cached.ctx) cached = { key, ctx: prepare(input) };
  return cached.ctx;
}

self.onmessage = (e) => {
  const { id, type, input, key, opts = {}, gameIds } = e.data;
  try {
    const ctx = ctxFor(input, key);
    if (type === 'run') {
      const res = run(ctx, opts);
      self.postMessage({ id, ok: true, summary: summarize(ctx, res) });
    } else if (type === 'leverage') {
      const out = leverage(ctx, gameIds, {
        n: opts.n || 2000,
        seed: opts.seed || 777,
        onProgress: (p) => self.postMessage({ id, progress: p }),
      });
      self.postMessage({ id, ok: true, leverage: out });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack ? err.stack : err) });
  }
};
