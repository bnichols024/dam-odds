import { h, pct, oneIn, pts, shortDate, dayKey, dayName } from '../util.js';
import { lineChart, barList, segBar } from '../charts.js';
import { cardSub, stat, delta, gameLine, teamLink, notice, logo } from '../components.js';
import { impact, osuGameImpact } from '../rooting.js';
import { todayCard } from './today.js';

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
    h(
      'div',
      { class: 'hero-top' },
      h(
        'div',
        { class: 'hero-id' },
        h('a', { href: `#/team/${F}`, 'aria-label': `${t.location} team page` }, logo(F, 64, t.color)),
        h('div', null, h('p', { class: 'eyebrow' }, `${t.location} · ${t.record} (${t.confRecord} Pac-12)`), h('h1', { class: 'hero-label' }, 'Chance the Beavers make the College Football Playoff'))
      ),
      app.live.changed ? h('span', { class: 'pill' }, 'Live-adjusted') : null
    ),
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
      f.winOutAll != null
        ? stat('Win out', pct(f.winOutAll), `then ${pct(f.bidIfWinOut)} CFP odds`)
        : best
          ? stat(`If ${best[0]}`, pct(best[1].bid), 'win out + win the title')
          : null,
      stat('Top 3 among G6', pct(['1', '2', '3'].reduce((a, k) => a + (f.g6Rank[k] || 0), 0)), 'on Selection Day')
    ),
    h(
      'p',
      { class: 'muted small' },
      'One CFP spot goes to the highest-ranked Group of 6 team in the committee’s final ranking (Dec 6). The G6 is the American, C-USA, MAC, Mountain West, Sun Belt and the new Pac-12. The model plays out the rest of the season thousands of times and asks who the committee would rank first.'
    )
  );
  root.append(hero, todayCard(app));

  const grid = h('div', { class: 'grid two' });
  root.append(grid);

  // ---- next game ----
  const next = app
    .teamGames(F)
    .filter((g) => g.status !== 'post')
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (next) {
    const im = osuGameImpact(app, next.id);
    grid.append(
      cardSub(
        'Next up',
        null,
        gameLine(app, next.id),
        h(
          'div',
          { class: 'stats' },
          im.ifWin != null ? stat('With a win', pct(im.ifWin), pts(im.ifWin - f.bid, { digits: 1 })) : null,
          im.ifLose != null ? stat('With a loss', pct(im.ifLose), pts(im.ifLose - f.bid, { digits: 1 })) : null,
          im.winOutAfterWin != null ? stat('Win-out chance', `${pct(im.winOutNow)} → ${pct(im.winOutAfterWin)}`, 'now → with a win') : null
        )
      )
    );
  }

  // ---- this week's rooting interests (rest of the week, any day) ----
  const weekRows = app.ctx.games
    .filter((g) => g.week === cw && g.kind === 'reg' && g.status !== 'post' && g.home !== F && g.away !== F)
    .map((g) => ({ g, im: impact(app, g.id) }))
    .filter((x) => x.im && x.im.tier.key !== 'none')
    .sort((a, b) => (b.im.wo?.gain ?? 0) - (a.im.wo?.gain ?? 0))
    .slice(0, 5);
  grid.append(
    cardSub(
      'Root for these this week',
      'Biggest results for OSU outside its own game, assuming the Beavers win out',
      weekRows.length
        ? h(
            'ol',
            { class: 'root-list' },
            weekRows.map(({ g, im }) =>
              h(
                'li',
                null,
                h(
                  'div',
                  { class: 'root-head' },
                  h('div', { class: 'root-pick' }, h('span', { class: 'muted small' }, 'Root for'), teamLink(app, im.team.id, { full: true })),
                  h('a', { class: 'small day-link', href: `#/gameday/${dayKey(g.date)}` }, dayName(dayKey(g.date)))
                ),
                h('div', { class: 'small' }, h('strong', null, im.wo ? pts(im.wo.gain, { digits: 1 }) : pts(im.overall.gain)), h('span', { class: 'muted' }, ` · ${im.tier.label}`)),
                gameLine(app, g.id, { showMeter: false })
              )
            )
          )
        : h('p', { class: 'muted' }, 'No games left this week that move the needle.'),
      h('a', { class: 'more', href: '#/gameday' }, 'Full game day guide →')
    )
  );

  // ---- win-out ladder ----
  if (f.ladder?.length) {
    const flex = app.input.flex;
    const stepRow = (st) => {
      let who;
      if (st.type === 'title') who = h('span', null, h('strong', null, 'Pac-12 title game'));
      else if (st.type === 'flex') {
        const k = flex.visitors.indexOf(F);
        const host = k >= 0 ? flex.hosts[k] : null;
        who = h('span', { class: 'ladder-who' }, h('span', { class: 'muted' }, '@ '), host ? teamLink(app, host, { full: true }) : 'TBD', h('span', { class: 'tag' }, 'Flex · tentative'));
      } else {
        const g = app.game(st.id);
        const opp = g.home === F ? 'away' : 'home';
        who = h('span', { class: 'ladder-who' }, h('span', { class: 'muted' }, g.home === F ? 'vs ' : '@ '), teamLink(app, g[opp], { full: true }));
      }
      return {
        label: h('span', { class: 'ladder-label' }, h('span', { class: 'muted small ladder-date' }, shortDate(st.date)), who, h('span', { class: 'small muted' }, ` · win ${pct(st.pWin)}`)),
        value: st.perfectAfter,
        text: `${pct(st.perfectAfter)} still perfect`,
        title: `Chance OSU is still unbeaten from here after this game: ${pct(st.perfectAfter)}`,
      };
    };
    grid.append(
      cardSub(
        'Win-out ladder',
        'Chance the Beavers are still perfect after each remaining game (win % assumes they won the games before it)',
        barList(f.ladder.map(stepRow), { max: 1, color: 'var(--accent)' }),
        h(
          'p',
          { class: 'ladder-payoff' },
          'Win out (10-3): ',
          h('strong', null, pct(f.winOutAll)),
          h('span', { class: 'muted' }, ' · CFP odds if they do: '),
          h('strong', null, pct(f.bidIfWinOut))
        )
      )
    );
  }

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
  // (object keys that look like numbers come back in numeric order, so sort here)
  const blockers = Object.entries(f.blockers)
    .sort((a, b) => b[1] - a[1])
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
  const chart = app.chartHistory;
  if (chart.length) {
    const labels = chart.map((x) => (x.replay ? `Wk ${x.week}` : 'Now'));
    const values = chart.map((x) => x.osu.bid);
    root.append(
      cardSub(
        'Oregon State’s CFP odds this season',
        'What the model would have said after each week (same model, results up to that week)',
        lineChart({ labels, series: [{ id: F, label: 'Oregon State', color: 'var(--accent)', values, main: true }], title: 'Oregon State playoff odds by week' }),
        tableToggle(
          ['Point', 'CFP odds', 'Pac-12 title'],
          chart.map((x, i) => [labels[i], pct(x.osu.bid), pct(x.osu.champ)])
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
