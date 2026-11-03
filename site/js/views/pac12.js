import { h, pct, shortDate } from '../util.js';
import { cardSub, teamLink, gameLine } from '../components.js';

const PAC12 = '9';

export function renderPac12(app) {
  const F = app.focus;
  const root = h('div', { class: 'view pac12' });
  const teams = Object.values(app.snap.teams).filter((t) => t.conf === PAC12);
  const sum = app.sum.teams;
  const cw = (t) => Number(t.confRecord.split('-')[0]);
  const cl = (t) => Number(t.confRecord.split('-')[1]);
  teams.sort((a, b) => cw(b) / Math.max(1, cw(b) + cl(b)) - cw(a) / Math.max(1, cw(a) + cl(a)) || (sum[b.id]?.title ?? 0) - (sum[a.id]?.title ?? 0));

  root.append(
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'eyebrow' }, 'The new Pac-12 · 8 teams'),
      h('h1', null, 'Pac-12 title race'),
      h(
        'p',
        { class: 'muted' },
        'Seven conference games each (Weeks 5–12). The top two by conference record meet Dec 4 at the higher seed’s stadium. The matchup is set after Week 12, so the Week 13 flex game doesn’t count in the standings.'
      )
    )
  );

  root.append(
    cardSub(
      'Standings and odds',
      null,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'data' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, 'Team'),
              h('th', { class: 'num' }, 'Pac-12'),
              h('th', { class: 'num hide-sm' }, 'Overall'),
              h('th', { class: 'num hide-sm' }, 'Rating'),
              h('th', { class: 'num' }, 'Title game'),
              h('th', { class: 'num' }, 'Champ'),
              h('th', { class: 'num' }, 'CFP bid')
            )
          ),
          h(
            'tbody',
            null,
            teams.map((t) =>
              h(
                'tr',
                { class: t.id === F ? 'focus-row' : null },
                h('td', null, teamLink(app, t.id, { full: true })),
                h('td', { class: 'num' }, t.confRecord),
                h('td', { class: 'num hide-sm' }, t.record),
                h('td', { class: 'num hide-sm' }, `#${t.ratingRank}`),
                h('td', { class: 'num' }, pct(sum[t.id]?.title)),
                h('td', { class: 'num' }, pct(sum[t.id]?.champ)),
                h('td', { class: 'num strong' }, pct(sum[t.id]?.bid))
              )
            )
          )
        )
      )
    )
  );

  const grid = h('div', { class: 'grid two' });
  root.append(grid);

  // most likely title games
  const pairs = (app.sum.titlePairs || []).slice(0, 6);
  grid.append(
    cardSub(
      'Most likely title games',
      'Higher seed hosts on Dec 4',
      pairs.length
        ? h(
            'ol',
            { class: 'pair-list' },
            pairs.map((p) =>
              h(
                'li',
                null,
                h('div', null, teamLink(app, p.away), h('span', { class: 'at muted' }, ' at '), teamLink(app, p.home)),
                h('div', { class: 'small muted' }, `${pct(p.share)} of seasons · ${app.T(p.home).abbr} wins ${pct(p.homeWin)}`)
              )
            )
          )
        : h('p', { class: 'muted' }, 'Not available for this run.')
    )
  );

  // flex week
  const flex = app.input.flex;
  grid.append(
    cardSub(
      'Week 13 flex games (Nov 28)',
      'Tentative pairings from the league schedule',
      h(
        'ul',
        { class: 'pair-list' },
        flex.hosts.map((hid, k) => h('li', null, teamLink(app, flex.visitors[k]), h('span', { class: 'at muted' }, ' at '), teamLink(app, hid)))
      ),
      h(
        'p',
        { class: 'small muted' },
        'The league can swap opponents so the two title-game teams don’t play each other the week before, or to help a CFP contender. The model swaps when the title pair would meet. Flex games count in the overall record (and the committee’s eyes) but not in the standings.'
      )
    )
  );

  // remaining conference games
  const left = app.ctx.games.filter((g) => g.conf && g.status !== 'post' && app.T(g.home).conf === PAC12).sort((a, b) => (a.date < b.date ? -1 : 1));
  root.append(
    cardSub(
      'Conference games left',
      left.length ? `${left.length} games until the matchup is set` : null,
      left.length ? h('div', { class: 'game-list' }, left.map((g) => gameLine(app, g.id))) : h('p', { class: 'muted' }, 'All conference games are done.')
    )
  );

  root.append(
    cardSub(
      'How ties are broken (in the model)',
      null,
      h(
        'ol',
        { class: 'small' },
        h('li', null, 'Conference winning percentage.'),
        h('li', null, 'Head-to-head among the tied teams (every Pac-12 team plays every other, so this always applies).'),
        h('li', null, 'Then the model’s power rating, standing in for the computer rankings leagues use late in their tiebreakers.')
      ),
      h('p', { class: 'small muted' }, `After each team is placed, the rest start the tiebreaker over. The real Pac-12 rules have more steps (record against common opponents, against the next-best teams), so close three-way ties can differ.`)
    )
  );
  return root;
}
