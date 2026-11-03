// "Games today": what to watch on a given day, ranked by how much each result matters to OSU.
import { h, pct, pts, dayKey, todayKey, dayName, dayLong } from '../util.js';
import { gameLine, teamLink, stat } from '../components.js';
import { impact, reasons, osuGameImpact } from '../rooting.js';

// Games that can be watched (both teams known, not canceled), regular or title games.
function watchable(app) {
  return app.ctx.games.filter((g) => g.home && g.away && (g.kind === 'reg' || g.kind === 'flex' || g.kind === 'title'));
}

export function gamesOn(app, key) {
  return watchable(app).filter((g) => dayKey(g.date) === key);
}

// Day keys from today through the end of the current week (plus today even if empty).
export function weekDays(app) {
  const now = todayKey();
  const keys = new Set(
    watchable(app)
      .filter((g) => g.week === app.snap.currentWeek)
      .map((g) => dayKey(g.date))
  );
  keys.add(now);
  return [...keys].sort();
}

export function nextGameDay(app, fromKey = todayKey()) {
  const keys = watchable(app)
    .filter((g) => g.status !== 'post')
    .map((g) => dayKey(g.date))
    .filter((k) => k >= fromKey)
    .sort();
  return keys[0] || null;
}

function tierChip(tier) {
  return h(
    'span',
    { class: `tier tier-${tier.key}`, title: `Impact: ${tier.label}` },
    h('span', { class: 'tier-dots', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { class: i < tier.dots ? 'on' : null }))),
    tier.label
  );
}

function wentOurWay(g, side) {
  if (g.status !== 'post') return null;
  const homeWon = g.hs > g.as;
  return (side === 'home') === homeWon;
}

function osuRow(app, g) {
  const im = osuGameImpact(app, g.id);
  const t = app.T(app.focus);
  const isHome = g.home === app.focus;
  let banner = 'Beavers play';
  if (g.status === 'in') banner = 'Beavers are playing';
  if (g.status === 'post') banner = ((isHome && g.hs > g.as) || (!isHome && g.as > g.hs) ? 'Beavers won' : 'Beavers lost');
  return h(
    'li',
    { class: 'watch-row osu' },
    h('div', { class: 'watch-head' }, h('span', { class: 'osu-banner' }, teamLink(app, t.id, { rank: false }), h('strong', null, ` ${banner}`))),
    gameLine(app, g.id),
    g.status !== 'post'
      ? h(
          'div',
          { class: 'stats tight' },
          im.ifWin != null ? stat('CFP odds with a win', pct(im.ifWin)) : null,
          im.ifLose != null ? stat('With a loss', pct(im.ifLose)) : null,
          im.winOutAfterWin != null ? stat('Win-out chance', `${pct(im.winOutNow)} → ${pct(im.winOutAfterWin)}`, 'now → with a win') : null
        )
      : null
  );
}

function watchRow(app, g) {
  const im = impact(app, g.id);
  if (!im) return null;
  const meta = app.gameMeta[g.id] || {};
  const went = wentOurWay(g, im.side);
  const head = h(
    'div',
    { class: 'watch-head' },
    h('div', { class: 'root-pick' }, h('span', { class: 'muted small' }, went == null ? 'Root for' : 'Rooted for'), im.team.id ? teamLink(app, im.team.id, { full: true }) : h('span', null, im.team.location)),
    went == null ? tierChip(im.tier) : h('span', { class: `went ${went ? 'yes' : 'no'}` }, went ? '✓ Went OSU’s way' : '✗ Didn’t go OSU’s way')
  );
  const nums = im.wo
    ? h(
        'div',
        { class: 'watch-nums small' },
        h('span', null, 'If OSU wins out: '),
        h('strong', null, `${pct(im.wo.ifLose, { digits: im.wo.gain < 0.003 ? 2 : 1 })} → ${pct(im.wo.ifWin, { digits: im.wo.gain < 0.003 ? 2 : 1 })}`),
        h('span', { class: 'muted' }, ` with a${/^[AEIOU]/i.test(im.team.location || '') ? 'n' : ''} ${im.team.location || im.team.abbr} win`),
        im.overall
          ? h('span', { class: 'muted' }, Math.abs(im.overall.gain) < 0.0002 ? ' · overall odds: no visible change' : ` · overall ${pts(im.overall.gain)}`)
          : null
      )
    : null;
  const live = g.status === 'in' && (meta.down || meta.possession) ? h('div', { class: 'small muted' }, [meta.possession ? `${app.T(meta.possession)?.abbr || ''} ball` : null, meta.down].filter(Boolean).join(' · ')) : null;
  return h(
    'li',
    { class: `watch-row tier-${im.tier.key}${g.status === 'in' ? ' is-live' : ''}${g.status === 'post' ? ' is-final' : ''}` },
    head,
    gameLine(app, g.id),
    live,
    nums,
    im.tier.key !== 'none' ? h('ul', { class: 'why small muted' }, reasons(app, g.id, im.side).map((x) => h('li', null, x))) : null
  );
}

/** Rows for one day. limit = max mattering rows (others fold away). */
export function dayList(app, key, { limit = Infinity } = {}) {
  const F = app.focus;
  const games = gamesOn(app, key);
  const osu = games.filter((g) => g.home === F || g.away === F);
  const rest = games
    .filter((g) => !osu.includes(g))
    .map((g) => ({ g, im: impact(app, g.id) }))
    .filter((x) => x.im);
  const order = (x) => (x.g.status === 'in' ? 0 : x.g.status === 'pre' ? 1 : 2);
  rest.sort((a, b) => order(a) - order(b) || (b.im.wo?.gain ?? 0) - (a.im.wo?.gain ?? 0) || (a.g.date < b.g.date ? -1 : 1));
  const matters = rest.filter((x) => x.im.tier.key !== 'none');
  const noEffect = rest.filter((x) => x.im.tier.key === 'none');
  const shown = matters.slice(0, limit);
  const hidden = matters.length - shown.length;

  const finals = matters.filter((x) => x.g.status === 'post');
  const good = finals.filter((x) => wentOurWay(x.g, x.im.side)).length;

  const list = h('ol', { class: 'watch-list' }, osu.map((g) => osuRow(app, g)), shown.map((x) => watchRow(app, x.g)));
  const parts = [list];
  if (!osu.length && !matters.length)
    parts.unshift(h('p', { class: 'muted' }, games.length ? 'Nothing on this day moves OSU’s odds in a way the model can see.' : 'No FBS games.'));
  if (finals.length)
    parts.push(h('p', { class: 'tally small' }, `${dayName(key) === 'Today' ? 'So far today' : 'Results'}: ${good} of ${finals.length} game${finals.length === 1 ? '' : 's'} that mattered went OSU’s way.`));
  if (hidden > 0) parts.push(h('p', { class: 'small' }, h('a', { class: 'more', href: `#/gameday/${key}` }, `${hidden} more that matter →`)));
  if (noEffect.length) {
    const d = h('details', { class: 'no-effect small' }, h('summary', null, `${noEffect.length} more game${noEffect.length === 1 ? '' : 's'} with no real effect`));
    d.append(h('div', { class: 'game-list' }, noEffect.map((x) => gameLine(app, x.g.id, { showMeter: false }))));
    parts.push(d);
  }
  return { el: h('div', { class: 'day-list' }, parts), count: games.length, matters: matters.length + osu.length };
}

// The card at the top of the Odds page.
export function todayCard(app) {
  const key = todayKey();
  const games = gamesOn(app, key);
  const card = h('section', { class: 'card today-card' });
  if (!games.length) {
    const next = nextGameDay(app, key);
    card.append(h('div', { class: 'card-head' }, h('h2', null, 'Games today'), h('p', { class: 'muted small' }, dayLong(key))));
    if (!next) {
      card.append(h('p', { class: 'muted' }, 'No more FBS games before Selection Day.'));
      return card;
    }
    const top = gamesOn(app, next)
      .map((g) => ({ g, im: impact(app, g.id) }))
      .filter((x) => x.im)
      .sort((a, b) => (b.im.wo?.gain ?? 0) - (a.im.wo?.gain ?? 0))[0];
    const osuNext = gamesOn(app, next).find((g) => g.home === app.focus || g.away === app.focus);
    card.append(
      h(
        'p',
        null,
        `No FBS games today. Next up ${dayName(next)}`,
        osuNext
          ? ': the Beavers play.'
          : top && top.im.tier.key !== 'none'
            ? h('span', null, ': ', h('strong', null, `${app.side(top.g.id, 'away').abbr} ${top.g.neutral ? 'vs' : '@'} ${app.side(top.g.id, 'home').abbr}`), ' is the one to watch.')
            : '.'
      ),
      h('a', { class: 'more', href: `#/gameday/${next}` }, `See ${dayName(next)}’s games →`)
    );
    return card;
  }
  const { el, count, matters } = dayList(app, key, { limit: 4 });
  card.append(
    h(
      'div',
      { class: 'card-head' },
      h('h2', null, 'Games today'),
      h('p', { class: 'muted small' }, `${dayLong(key)} · ${count} game${count === 1 ? '' : 's'}, ${matters} that matter${matters === 1 ? 's' : ''} to OSU`)
    ),
    el,
    h('p', { class: 'small muted' }, 'Odds assume the Beavers win out, their only realistic path, so small effects show up. Live games update while this page is open.')
  );
  return card;
}
