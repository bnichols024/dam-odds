import { h, pct, pts, dayDate, shortDate } from '../util.js';
import { cardSub, gameLine, teamLink, rootFor, stat, anchored } from '../components.js';

const PAC12 = '9';

function reasons(app, gameId, r) {
  const F = app.focus;
  const g = app.game(gameId);
  const forId = r.team.id;
  const againstId = r.side === 'home' ? g.away : g.home;
  const out = [];
  const bid = (id) => app.sum.teams[id]?.bid ?? 0;
  const osuGames = app.teamGames(F);
  const vsOsu = (id) => osuGames.find((x) => (x.home === id || x.away === id) && x.home !== x.away);
  if (againstId && bid(againstId) >= 0.01) out.push(`${app.T(againstId).location} is a rival for the spot (${pct(bid(againstId))})`);
  if (forId && forId !== 'FCS') {
    const og = vsOsu(forId);
    if (og) {
      if (og.status === 'post') {
        const osuWon = (og.home === F && og.hs > og.as) || (og.away === F && og.as > og.hs);
        out.push(osuWon ? `OSU beat ${app.T(forId).location}: their wins make that win count for more` : `${app.T(forId).location} beat OSU: their wins make that loss look better`);
      } else out.push(`OSU still plays ${app.T(forId).location} (${shortDate(og.date)}): a stronger opponent is a better win later`);
    }
  }
  const pac = (id) => app.T(id)?.conf === PAC12;
  if (g.conf && pac(g.home) && pac(g.away)) out.push('Pac-12 title-game race');
  if (!out.length && againstId) {
    const og = vsOsu(againstId);
    if (og && og.status === 'post') out.push(`Keeps a past OSU opponent's rating in line`);
  }
  if (!out.length) out.push('Ripple effects on schedules and ratings');
  return out;
}

export function renderGameDay(app) {
  const F = app.focus;
  const week = app.snap.currentWeek;
  const root = h('div', { class: 'view gameday' });
  const weekGames = app.ctx.games.filter((g) => g.week === week && g.kind === 'reg');
  if (!weekGames.length) {
    root.append(cardSub('Game day', null, h('p', null, 'No regular-season games left. Check The Race for title-game odds.')));
    return root;
  }
  const first = weekGames.reduce((m, g) => (g.date < m ? g.date : m), weekGames[0].date);
  const last = weekGames.reduce((m, g) => (g.date > m ? g.date : m), weekGames[0].date);
  const base = app.lev.base ?? app.snap.leverage.base;

  root.append(
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'eyebrow' }, `Week ${week} · ${dayDate(first)} – ${dayDate(last)}`),
      h('h1', null, 'Game day rooting guide'),
      h(
        'p',
        { class: 'muted' },
        'For every game this week we play the rest of the season twice with the same luck: once with each team winning. The gap is how much that result moves OSU’s CFP odds. Live games update on their own while this page is open.'
      ),
      app.live.active ? h('p', { class: 'small' }, h('span', { class: 'pill live' }, h('span', { class: 'dot' }), 'Games in progress'), ' scores and odds refresh about every 45 seconds') : null
    )
  );

  // OSU's own game first
  const osu = weekGames.find((g) => g.home === F || g.away === F);
  if (osu) {
    const lv = app.lev.get(osu.id);
    const isHome = osu.home === F;
    root.append(
      cardSub(
        'The one that matters most',
        null,
        gameLine(app, osu.id),
        lv
          ? h(
              'div',
              { class: 'stats' },
              stat('CFP odds with a win', pct(anchored(app, isHome ? lv.ifHome : lv.ifAway))),
              stat('With a loss', pct(anchored(app, isHome ? lv.ifAway : lv.ifHome))),
              stat('Swing', pts(Math.abs(lv.swing), { digits: 1 }))
            )
          : null
      )
    );
  }

  const rows = weekGames
    .filter((g) => g !== osu)
    .map((g) => {
      const l = app.lev.get(g.id);
      return { g, l, r: l ? rootFor(app, g.id, l) : null };
    })
    .filter((x) => x.r)
    .sort((a, b) => b.r.gain - a.r.gain);
  const bigCut = Math.max(0.0005, base * 0.04);
  const smallCut = Math.max(0.0001, base * 0.008);
  const big = rows.filter((x) => x.r.gain >= bigCut);
  const small = rows.filter((x) => x.r.gain < bigCut && x.r.gain >= smallCut);
  const none = rows.filter((x) => x.r.gain < smallCut);

  const item = ({ g, r }) =>
    h(
      'li',
      { class: 'root-item' },
      h(
        'div',
        { class: 'root-head' },
        h('div', null, h('span', { class: 'muted small' }, 'Root for '), teamLink(app, r.team.id, { full: true })),
        h('div', { class: 'root-gain' }, h('strong', null, pts(r.gain)), h('span', { class: 'muted small' }, ` ${pct(r.ifLose)} → ${pct(r.ifWin)}`))
      ),
      gameLine(app, g.id),
      h('ul', { class: 'why small muted' }, reasons(app, g.id, r).map((x) => h('li', null, x)))
    );

  root.append(
    cardSub(
      'Big ones',
      `Each moves OSU’s odds by at least ${pts(bigCut)}`,
      big.length ? h('ol', { class: 'root-items' }, big.map(item)) : h('p', { class: 'muted' }, 'Nothing outside OSU’s game moves the needle much this week.')
    )
  );
  if (small.length) root.append(cardSub('Small help', 'Worth a glance at the scoreboard', h('ol', { class: 'root-items' }, small.map(item))));
  if (none.length) {
    const d = h('details', { class: 'card fold' }, h('summary', null, h('h2', null, `No real effect (${none.length} games)`)));
    d.append(h('div', { class: 'game-list' }, none.map(({ g }) => gameLine(app, g.id, { showMeter: false }))));
    root.append(d);
  }

  // season view
  const later = [...app.levLater.values()]
    .map((l) => ({ g: app.game(l.id), l, r: rootFor(app, l.id, l) }))
    .filter((x) => x.g && x.g.status !== 'post')
    .sort((a, b) => b.r.gain - a.r.gain)
    .slice(0, 10);
  if (later.length) {
    root.append(
      cardSub(
        'Biggest games still to come',
        'After this week, ranked by how much each result swings OSU’s odds',
        h(
          'ol',
          { class: 'root-items' },
          later.map(({ g, r }) =>
            h(
              'li',
              { class: 'root-item' },
              h(
                'div',
                { class: 'root-head' },
                h('div', null, h('span', { class: 'muted small' }, `Week ${g.week} · root for `), r.team.id ? teamLink(app, r.team.id, { full: true }) : h('span', null, 'OSU’s opponent')),
                h('div', { class: 'root-gain' }, h('strong', null, pts(r.gain)))
              ),
              gameLine(app, g.id, { showMeter: true })
            )
          )
        )
      )
    );
  }
  return root;
}
