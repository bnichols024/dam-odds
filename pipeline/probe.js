// Dev probe: paired what-if for one or more games at a larger sample size.
//   node pipeline/probe.js <gameId> [n]
import { readFile } from 'node:fs/promises';
import { prepare, run, summarize } from '../site/engine/sim.js';

const snap = JSON.parse(await readFile(new URL('../site/data/snapshot.json', import.meta.url), 'utf8'));
const ctx = prepare(snap.input);
const n = Number(process.argv[3] || 8000);
const ids = process.argv[2] ? process.argv[2].split(',') : [];
const nm = (i) => (i < 0 ? 'TBD' : snap.teams[ctx.teams[i].id]?.abbr || ctx.teams[i].id);

let t = Date.now();
const base = summarize(ctx, run(ctx, { n, seed: 5 }));
console.log(`base n=${n} ${((Date.now() - t) / 1000).toFixed(1)}s  OSU bid ${(base.focus.bid * 100).toFixed(2)}% champ ${(base.focus.champ * 100).toFixed(1)}%`);
for (const id of ids) {
  const gi = ctx.gIndex.get(id);
  const h = summarize(ctx, run(ctx, { n, seed: 5, forced: { [id]: 'home' } }));
  const a = summarize(ctx, run(ctx, { n, seed: 5, forced: { [id]: 'away' } }));
  console.log(`${nm(ctx.away[gi])} @ ${nm(ctx.home[gi])}`);
  for (const [lab, r] of [
    ['home wins', h],
    ['away wins', a],
  ]) {
    const top = Object.entries(r.teams)
      .sort((x, y) => y[1].bid - x[1].bid)
      .slice(0, 5)
      .map(([tid, v]) => `${snap.teams[tid].abbr} ${(v.bid * 100).toFixed(1)}`)
      .join(', ');
    console.log(`  ${lab}: OSU bid ${(r.focus.bid * 100).toFixed(2)}% champ ${(r.focus.champ * 100).toFixed(1)}% | ${top}`);
  }
}
