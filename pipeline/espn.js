// ESPN public JSON helpers with an on-disk cache and polite concurrency.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEvent, scoreboardUrl } from '../site/engine/espn.js';

export { parseEvent, scoreboardUrl };

const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(HERE, 'cache');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const SITE2 = 'https://site.api.espn.com/apis/v2/sports/football/college-football';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, { cacheKey, maxAgeMs = 0 } = {}) {
  const file = cacheKey ? join(CACHE_DIR, `${cacheKey}.json`) : null;
  if (file) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (!maxAgeMs || Date.now() - raw.fetchedAt < maxAgeMs) return raw.body;
    } catch {
      /* not cached */
    }
  }
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'dam-odds/1.0 (fan project)' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const body = await res.json();
      if (file) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), body }));
      }
      return body;
    } catch (err) {
      lastErr = err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const standingsUrl = (season) => `${SITE2}/standings?season=${season}&group=80`;
export const rankingsUrl = (season) => `${SITE}/rankings?season=${season}`;
export const cfpListUrl = (season) => `${CORE}/seasons/${season}/rankings/21`;

export async function seasonGames(season, { maxAgeMs = 0, weeks = 17, cacheTag = '' } = {}) {
  const ws = Array.from({ length: weeks }, (_, i) => i + 1);
  const pages = await mapLimit(ws, 4, (w) =>
    getJson(scoreboardUrl(season, w), { cacheKey: `sb-${season}-w${w}${cacheTag}`, maxAgeMs })
  );
  const games = [];
  const teams = new Map();
  for (const p of pages) {
    for (const e of p?.events || []) {
      const g = parseEvent(e);
      if (!g) continue;
      games.push(g);
      for (const t of [g.homeTeam, g.awayTeam]) if (t && !teams.has(t.id)) teams.set(t.id, t);
    }
  }
  const seen = new Set();
  const uniq = games.filter((g) => (seen.has(g.id) ? false : seen.add(g.id)));
  return { games: uniq, teams };
}

// Final (selection-day) CFP ranking for a season: [{rank, id}], plus its date.
export async function finalCfp(season, { maxAgeMs = 0 } = {}) {
  const list = await getJson(cfpListUrl(season), { cacheKey: `cfp-${season}`, maxAgeMs });
  const refs = list?.rankings || [];
  if (!refs.length) return null;
  const last = refs[refs.length - 1].$ref.replace('http://', 'https://');
  const r = await getJson(last, { cacheKey: `cfp-${season}-final`, maxAgeMs });
  return {
    date: r.date,
    ranks: r.ranks.map((x) => ({ rank: x.current, id: x.team.$ref.split('/teams/')[1].split('?')[0] })),
  };
}

// Every CFP ranking for a season (weekly), [{date, week, ranks}].
export async function allCfp(season, { maxAgeMs = 0 } = {}) {
  const list = await getJson(cfpListUrl(season), { cacheKey: `cfp-${season}`, maxAgeMs });
  const refs = list?.rankings || [];
  const out = [];
  for (const [i, ref] of refs.entries()) {
    const r = await getJson(ref.$ref.replace('http://', 'https://'), { cacheKey: `cfp-${season}-${i}`, maxAgeMs });
    if (!r) continue;
    out.push({
      date: r.date,
      week: r.occurrence?.number ?? null,
      ranks: r.ranks.map((x) => ({ rank: x.current, id: x.team.$ref.split('/teams/')[1].split('?')[0] })),
    });
  }
  return out;
}
