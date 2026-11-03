import { h, pct } from '../util.js';
import { lineChart, barList, sparkline } from '../charts.js';
import { cardSub, teamLink, notice } from '../components.js';
import { tableToggle } from './home.js';

export function renderRace(app) {
  const F = app.focus;
  const sum = app.sum;
  const root = h('div', { class: 'view race' });
  const ids = Object.keys(sum.teams).sort((a, b) => sum.teams[b].bid - sum.teams[a].bid);
  const shown = ids.filter((id) => sum.teams[id].bid >= 0.001 || id === F);
  const pocket = ids.filter((id) => !shown.includes(id) && sum.teams[id].champ >= 0.02);

  root.append(
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'eyebrow' }, 'Group of 6'),
      h('h1', null, 'The race for the one spot'),
      h(
        'p',
        { class: 'muted' },
        'Every G6 team with a real chance at the CFP bid. Conference title odds matter because the committee likes champions, but under the 2026 rule a team doesn’t need the title to be the top-ranked G6 team.'
      )
    )
  );

  // contender table
  const table = h(
    'table',
    { class: 'data race-table' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { class: 'num' }, '#'),
        h('th', null, 'Team'),
        h('th', { class: 'hide-sm' }, 'Conf'),
        h('th', { class: 'num hide-sm' }, 'Rating'),
        h('th', { class: 'num' }, 'Title game'),
        h('th', { class: 'num' }, 'Win conf'),
        h('th', { class: 'num' }, 'CFP bid'),
        h('th', { class: 'hide-sm' }, 'Trend')
      )
    ),
    h(
      'tbody',
      null,
      shown.map((id, i) => {
        const t = app.T(id);
        const v = sum.teams[id];
        const poll = t.cfp ? `CFP #${t.cfp}` : t.ap ? `AP #${t.ap}` : '';
        return h(
          'tr',
          { class: id === F ? 'focus-row' : null },
          h('td', { class: 'num muted' }, String(i + 1)),
          h(
            'td',
            null,
            teamLink(app, id, { full: true, rank: false }),
            h('div', { class: 'small muted' }, `${t.record}${poll ? ` · ${poll}` : ''}${t.ineligible ? ' · ineligible' : ''}`)
          ),
          h('td', { class: 'hide-sm' }, `${app.confName(t.conf)} ${t.confRecord}`),
          h('td', { class: 'num hide-sm' }, `#${t.ratingRank}`),
          h('td', { class: 'num' }, pct(v.title)),
          h('td', { class: 'num' }, pct(v.champ)),
          h('td', { class: 'num strong' }, pct(v.bid)),
          h('td', { class: 'hide-sm' }, sparkline(app.historyFor(id)))
        );
      })
    )
  );
  root.append(
    cardSub(
      'Contenders',
      `${shown.length} teams with at least a 0.1% chance. Rating rank is among all 138 FBS teams.`,
      h('div', { class: 'table-wrap' }, table),
      pocket.length
        ? h('p', { class: 'small muted' }, 'Could win their league but almost never the bid: ', pocket.map((id, i) => [i ? ', ' : '', teamLink(app, id, { rank: false })]))
        : null
    )
  );

  const grid = h('div', { class: 'grid two' });
  root.append(grid);

  // if the season ended today
  const now = app.snap.now.filter((r) => r.eligible).slice(0, 8);
  grid.append(
    cardSub(
      'If the season ended today',
      'The committee model on current resumes: chance each team is ranked first among G6 teams',
      barList(
        now.map((r) => ({ label: teamLink(app, r.id, { full: true }), value: r.pTop, emphasis: r.id === F, color: r.id === F ? 'var(--accent)' : 'var(--series-1)' })),
        { color: 'var(--series-1)' }
      ),
      h('p', { class: 'small muted' }, 'This ignores the games left. It shows how the committee would likely see these resumes right now.')
    )
  );

  // where OSU lands
  const rk = app.sum.focus.g6Rank;
  const order = ['1', '2', '3', '4', '5', '6', '7', '8', '9+'];
  grid.append(
    cardSub(
      'Where OSU finishes among G6 teams',
      'Committee order on Selection Day, across all simulations',
      barList(
        order.filter((k) => rk[k]).map((k) => ({ label: k === '1' ? '1st (gets the bid)' : k === '9+' ? '9th or lower' : `${k}${['', 'st', 'nd', 'rd'][k] || 'th'}`, value: rk[k], emphasis: k === '1' })),
        { color: 'var(--accent)' }
      )
    )
  );

  // odds over time, OSU + two biggest rivals
  const hist = app.history;
  if (hist.length > 1) {
    const rivals = ids.filter((id) => id !== F).slice(0, 2);
    const palette = ['var(--series-1)', 'var(--series-3)'];
    const series = [
      ...rivals.map((id, k) => ({ id, label: app.T(id).location, color: palette[k], values: app.historyFor(id) })),
      { id: F, label: 'Oregon State', color: 'var(--accent)', values: app.historyFor(F) },
    ];
    const labels = hist.map((x) => (x.replay ? `Wk ${x.week}` : 'Now'));
    root.append(
      cardSub(
        'CFP odds over the season',
        'Oregon State and the two current favorites',
        h(
          'div',
          { class: 'legend small' },
          series.map((s) => h('span', null, h('span', { class: 'key-line', style: { background: s.color } }), s.label))
        ),
        lineChart({ labels, series, title: 'Playoff odds by week' }),
        tableToggle(
          ['Point', ...series.map((s) => s.label)],
          hist.map((x, i) => [labels[i], ...series.map((s) => (s.values[i] == null ? '–' : pct(s.values[i])))])
        )
      )
    );
  }

  if (!app.snap.cfpHistory?.length)
    root.append(notice('Poll ranks shown are AP until the committee publishes its 2026 rankings. The model never uses polls; it judges resumes the way the committee has since 2014.'));
  return root;
}
