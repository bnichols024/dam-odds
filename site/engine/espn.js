// Pure ESPN scoreboard parsing, shared by the Node pipeline and the browser's live mode.

export const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';

export function scoreboardUrl(season, week, seasontype = 2) {
  return `${SCOREBOARD}?dates=${season}&seasontype=${seasontype}&week=${week}&groups=80&limit=500`;
}

// Share of regulation left in a live game (overtime counts as a sliver).
export function liveFraction(g) {
  if (g.status !== 'in') return 1;
  const p = g.period || 1;
  const clock = typeof g.clock === 'number' ? g.clock : 900;
  if (p > 4) return 0.02;
  return Math.max(0.005, ((4 - p) * 900 + clock) / 3600);
}

// Normalize one scoreboard event into our game shape.
export function parseEvent(e) {
  const c = e.competitions?.[0];
  if (!c) return null;
  const home = c.competitors.find((t) => t.homeAway === 'home');
  const away = c.competitors.find((t) => t.homeAway === 'away');
  if (!home || !away) return null;
  const st = c.status?.type || {};
  // canceled/postponed games come back as state "post" but never completed (and 0-0)
  const canceled = /CANCEL|POSTPONE|FORFEIT/i.test(st.name || '') || (st.state === 'post' && st.completed === false);
  const state = canceled ? 'canceled' : st.state === 'post' ? 'post' : st.state === 'in' ? 'in' : 'pre';
  const odds = c.odds?.[0];
  const isTitle = c.type?.abbreviation === 'Conference Championship' || /championship/i.test(c.notes?.[0]?.headline || '');
  const team = (t) => ({
    id: t.team?.id,
    abbr: t.team?.abbreviation,
    name: t.team?.displayName,
    short: t.team?.shortDisplayName,
    location: t.team?.location,
    color: t.team?.color,
    alt: t.team?.alternateColor,
    conf: t.team?.conferenceId ?? null,
  });
  const h = team(home);
  const a = team(away);
  const tbd = (x) => !x.id || Number(x.id) < 0 || x.abbr === 'TBD';
  const g = {
    id: e.id,
    date: c.date || e.date,
    week: e.week?.number ?? null,
    seasonType: e.season?.type ?? 2,
    home: tbd(h) ? null : h.id,
    away: tbd(a) ? null : a.id,
    homeTeam: tbd(h) ? null : h,
    awayTeam: tbd(a) ? null : a,
    neutral: !!c.neutralSite,
    conf: !!c.conferenceCompetition,
    title: isTitle,
    note: c.notes?.[0]?.headline || null,
    status: state,
    completed: !!st.completed,
    hs: home.score != null && home.score !== '' ? Number(home.score) : null,
    as: away.score != null && away.score !== '' ? Number(away.score) : null,
    period: c.status?.period ?? null,
    clock: c.status?.clock ?? null,
    statusText: st.shortDetail || st.description || null,
    spread: odds && typeof odds.spread === 'number' ? odds.spread : null,
    oddsText: odds?.details || null,
    overUnder: odds?.overUnder ?? null,
    venue: c.venue?.fullName || null,
    broadcast: c.broadcasts?.[0]?.names?.[0] || c.broadcast || null,
    possession: c.situation?.possession || null,
    downDistance: c.situation?.shortDownDistanceText || null,
  };
  g.frac = liveFraction(g);
  return g;
}
