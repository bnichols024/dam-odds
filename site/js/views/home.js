import { h, pct, oneIn, pts } from '../util.js';
import { lineChart, barList, segBar } from '../charts.js';
import { cardSub, stat, delta, gameLine, teamLink, rootFor, notice, anchored } from '../components.js';

export function renderHome(app) {
  const F = app.focus;
  const sum = app.sum;
  const f = sum.focus;
  const t = app.T(F);
  const root = h('div', { class: 'view home' });

  // ---- hero ----
  const hist = app.history;
  const cw = app.snap.currentWeek;
  const prev = [...hist].reverse().find((x) => x.replay && x.week <= cw - 2);
  const recs = Object.entries(f.record);
  const best = recs.length ? recs.reduce((a, b) => (Number(b[0].split('-')[0]) > Number(a[0].split('-')[0]) ? b : a)) : null;
  const hero = h(
    'section',
    { class: 'card hero' },
    h('div', { class: 'hero-top' }, h('p', { class: 'eyebrow' }, `${t.location} · ${t.record} (${t.confRecord} Pac-12)`), app.live.changed ? h('span', { class: 'pill' }, 'Live-adjusted') : null),
    h('h1', { class: 'hero-label' }, 'Chance the Beavers make the College Football Playoff'),
    h('div', { class: 'hero-row' }, h('div', { class: 'hero-num' }, pct(f.bid)), h('div', { class: 'hero-side' }, h('div', null, oneIn(f.bid)), prev ? h('div', null, delta(f.bid - prev.osu.bid), h('span', { class: 'muted' }, ' vs. a week ago')) : null)),
    segBar(
      [
        { label: 'Win the Pac-12, top G6 team', value: f.bidChamp, color: 'var(--accent)' },
        { label: 'Top G6 team without the title', value: f.bidNoChamp, color: 'var(--series-1)' },
      ],
      { total: Math.max(f.bid, 0.0001), height: 8 }
    ),
    h(
      'div',
      { class: 'legend small' },
      h('span', null, h('span', { class: 'key-rect', style: { background: 'var(--accent)' } }), `Win the Pac-12 and be the top G6 team: ${pct(f.bidChamp)}`),
      h('span', null, h('span', { class: 'key-rect', style: { background: 'var(--series-1)' } }), `Top G6 team without the title: ${pct(f.bidNoChamp)}`)
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Pac-12 title', pct(f.champ)),
      stat('Make the title game', pct(f.title)),
      best ? stat(`If ${best[0]}`, pct(best[1].bid), 'win out + win the title') : null,
      stat('Simulations', sum.n.toLocaleString())
    ),
    h(
      'p',
      { class: 'muted small' },
      'One CFP spot goes to the highest-ranked Group of 6 team in the committee’s final ranking (Dec 6). The G6 is the American, C-USA, MAC, Mountain West, Sun Belt and the new Pac-12. The model plays out the rest of the season thousands of times and asks who the committee would rank first.'
    )
  );
  root.append(hero);

  const grid = h('div', { class: 'grid two' });
  root.append(grid);

  // ---- next game ----
  const next = app
    .teamGames(F)
    .filter((g) => g.status !== 'post')
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (next) {
    const lv = app.lev.get(next.id) || app.levLater.get(next.id);
    const isHome = next.home === F;
    const ifWin = lv ? anchored(app, isHome ? lv.ifHome : lv.ifAway) : null;
    const ifLose = lv ? anchored(app, isHome ? lv.ifAway : lv.ifHome) : null;
    grid.append(
      cardSub(
        'Next up',
        null,
        gameLine(app, next.id),
        lv
          ? h(
              'div',
              { class: 'stats' },
              stat('With a win', pct(ifWin), pts(ifWin - f.bid, { digits: 1 })),
              stat('With a loss', pct(ifLose), pts(ifLose - f.bid, { digits: 1 }))
            )
          : null
      )
    );
  }

  // ---- this week's rooting interests ----
  const weekLev = [...app.lev.values()]
    .filter((l) => {
      const g = app.game(l.id);
      return g && g.home !== F && g.away !== F && g.status !== 'post';
    })
    .map((l) => ({ l, r: rootFor(app, l.id, l) }))
    .sort((a, b) => b.r.gain - a.r.gain)
    .slice(0, 4);
  grid.append(
    cardSub(
      'Root for these this week',
      'Outside OSU’s own game, these results help most',
      weekLev.length
        ? h(
            'ol',
            { class: 'root-list' },
            weekLev.map(({ l, r }) =>
              h(
                'li',
                null,
                h('div', { class: 'root-pick' }, h('span', { class: 'muted small' }, 'Root for '), teamLink(app, r.team.id, { full: true })),
                h('div', { class: 'small muted' }, `${pts(r.gain)} swing`),
                gameLine(app, l.id, { showMeter: false })
              )
            )
          )
        : h('p', { class: 'muted' }, 'No games left this week.'),
      h('a', { class: 'more', href: '#/gameday' }, 'Full game day guide →')
    )
  );

  // ---- record -> odds ----
  const rows = recs
    .sort((a, b) => Number(b[0].split('-')[0]) - Number(a[0].split('-')[0]) || Number(a[0].split('-')[1]) - Number(b[0].split('-')[1]))
    .filter(([, v]) => v.share >= 0.003)
    .map(([rec, v]) => ({
      label: h('span', null, h('strong', null, rec), h('span', { class: 'muted small' }, ` · happens ${pct(v.share)}${v.champ > 0.5 ? ' · usually Pac-12 champs' : v.champ > 0.05 ? ` · champs ${pct(v.champ)}` : ''}`)),
      value: v.bid,
      text: pct(v.bid),
      title: `${rec}: OSU gets the bid in ${pct(v.bid)} of these seasons`,
    }));
  grid.append(
    cardSub(
      'What OSU controls',
      'Chance of the bid by final record (title game included)',
      barList(rows, { max: Math.max(0.05, ...rows.map((r) => r.value)) }),
      h('p', { class: 'muted small' }, 'A 13th game means OSU played in the Pac-12 title game on Dec 4. Records the model never sees OSU get in with are still listed so you can see where the line is.')
    )
  );

  // ---- blockers ----
  const blockers = Object.entries(f.blockers)
    .slice(0, 7)
    .map(([id, v]) => ({ label: teamLink(app, id, { full: true }), value: v, color: 'var(--series-1)', title: `${app.T(id).location} takes the spot in ${pct(v)} of seasons` }));
  grid.append(
    cardSub(
      'Who takes the spot instead',
      'Share of simulated seasons where each team gets the G6 bid',
      barList(blockers, { color: 'var(--series-1)' })
    )
  );

  // ---- odds over time ----
  if (hist.length) {
    const labels = hist.map((x) => (x.replay ? `Wk ${x.week}` : x.label === 'Now' ? 'Now' : 'Now'));
    // collapse multiple live points to the latest per day for the label row
    const values = hist.map((x) => x.osu.bid);
    root.append(
      cardSub(
        'Oregon State’s CFP odds this season',
        'What the model would have said after each week (same model, results up to that week)',
        lineChart({ labels, series: [{ id: F, label: 'Oregon State', color: 'var(--accent)', values, main: true }], title: 'Oregon State playoff odds by week' }),
        tableToggle(
          ['Point', 'CFP odds', 'Pac-12 title'],
          hist.map((x, i) => [labels[i], pct(x.osu.bid), pct(x.osu.champ)])
        )
      )
    );
  }

  if (app.snap.currentWeek <= 14 && !app.snap.rankings.cfpDate) {
    root.append(notice('The committee hasn’t released a 2026 ranking yet. Until it does, the model’s view of the committee comes only from 12 past seasons of final rankings.'));
  }
  return root;
}

export function tableToggle(head, rows) {
  const d = h('details', { class: 'table-toggle' }, h('summary', null, 'Show as a table'));
  d.append(
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data' },
        h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))),
        h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))
      )
    )
  );
  return d;
}
