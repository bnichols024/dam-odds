import { h, pct, dayDate } from '../util.js';
import { cardSub, dot, teamLink } from '../components.js';
import { barList } from '../charts.js';
import { FEATURES, FEATURE_LABELS } from '../../engine/committee.js';

export function renderModel(app) {
  const M = app.snap.model;
  const committee = app.input.committee;
  const root = h('div', { class: 'view model' });
  root.append(
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'eyebrow' }, 'Under the hood'),
      h('h1', null, 'How Dam Odds works'),
      h(
        'ol',
        { class: 'steps' },
        h(
          'li',
          null,
          h('strong', null, 'Rate every team. '),
          'A power rating from this season’s scores (margins capped at 28), with last season’s rating as a small head start. It’s points better than an average FBS team on a neutral field.'
        ),
        h(
          'li',
          null,
          h('strong', null, 'Play out the season. '),
          `Every game left is simulated ${app.sum.n.toLocaleString()} times. When a betting line exists, the line sets the expected margin; otherwise the ratings do. Each simulated season also nudges every team’s true strength up or down a bit (±${app.input.params.sdTeam.toFixed(1)} pts), so hot and cold streaks carry through a whole season.`
        ),
        h(
          'li',
          null,
          h('strong', null, 'Crown champions. '),
          'Each league’s title-game teams are picked from the simulated standings with tiebreakers, then the title games are played. The Pac-12’s Week 13 flex games are paired after Week 12 to avoid a title-game rematch.'
        ),
        h(
          'li',
          null,
          h('strong', null, 'Hold the committee vote. '),
          'Every G6 resume gets a score from the committee model (below), plus a random draw for the committee’s own judgment. The highest-scoring eligible G6 team takes the CFP spot.'
        ),
        h(
          'li',
          null,
          h('strong', null, 'Count. '),
          'OSU’s odds are the share of simulated seasons where the Beavers are that team. The Game Day leverage numbers replay the season with each result forced both ways, using the same random draws.'
        )
      )
    )
  );

  // committee model
  const rows = FEATURES.map((f, k) => ({ f, w: committee.weights[k] })).filter((r) => r.w !== 0 && r.f !== 'p4');
  const maxW = Math.max(...rows.map((r) => Math.abs(r.w)));
  root.append(
    cardSub(
      'The committee model',
      `Fit on ${M.pairs.toLocaleString()} “who’s ranked higher” comparisons from the final CFP rankings of ${M.seasons[0]}–${M.seasons[M.seasons.length - 1]}`,
      barList(
        rows
          .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
          .map((r) => ({
            label: h('span', null, FEATURE_LABELS[r.f], h('span', { class: 'muted small' }, r.w < 0 ? ' (hurts)' : ' (helps)')),
            value: Math.abs(r.w),
            text: r.w.toFixed(2),
            color: r.w < 0 ? 'var(--critical)' : 'var(--series-1)',
          })),
        { max: maxW }
      ),
      h(
        'p',
        { class: 'small muted' },
        `Weights are per standard deviation of each item, so they compare directly. ${
          FEATURES.filter((f, k) => committee.weights[k] === 0 && f !== 'p4').length
            ? `${FEATURES.filter((f, k) => committee.weights[k] === 0 && f !== 'p4')
                .map((f, i) => (f === 'wins' ? 'Raw win totals' : FEATURE_LABELS[f]))
                .map((s, i) => (i ? s.toLowerCase() : s))
                .join(' and ')} dropped out: once losses and the rating are known, they added nothing reliable in the backtest. `
            : ''
        }The Power 4 bonus the committee gives doesn’t apply inside the G6, so it’s left off this chart. The model ordered `,
        h('strong', null, `${(M.pairAccuracy * 100).toFixed(0)}%`),
        ' of team pairs correctly in its training data.'
      )
    )
  );

  // backtest
  const seasons = app.seasons;
  root.append(
    cardSub(
      'Backtest: could it have picked the top Group of 5 team?',
      `Each season was predicted by a model trained only on the other seasons. It got ${M.validation.hits} of ${M.validation.seasons} right. Picking the team with the fewest losses gets ${M.validation.naiveHits}.`,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'data' },
          h(
            'thead',
            null,
            h('tr', null, h('th', null, 'Season'), h('th', null, 'Committee’s top G5'), h('th', null, 'Model’s pick'), h('th', { class: 'num' }, 'Model’s chance for the real one'))
          ),
          h(
            'tbody',
            null,
            seasons.map((s) =>
              h(
                'tr',
                null,
                h('td', null, String(s.season)),
                h('td', null, s.actual ? h('span', null, dot(s.actual.color), ` ${s.actual.name} `, h('span', { class: 'muted small' }, `#${s.actual.rank} · ${s.actual.record}`)) : '–'),
                h('td', null, h('span', { class: s.hit ? 'win' : 'loss' }, s.hit ? '✓ ' : '✗ '), s.hit ? 'Same' : h('span', null, `${s.pick.name} `, h('span', { class: 'muted small' }, s.pick.record))),
                h('td', { class: 'num' }, s.actual ? pct(s.actual.p) : '–')
              )
            )
          )
        )
      ),
      h(
        'p',
        { class: 'small muted' },
        'Misses: ',
        seasons
          .filter((s) => !s.hit && s.actual)
          .map((s, i) => `${i ? '; ' : ''}${s.season} (model liked ${s.pick.name} ${s.pick.record}, the committee took ${s.actual.name} ${s.actual.record})`)
          .join(''),
        (() => {
          const miss = seasons.filter((s) => !s.hit && s.actual);
          const L = (r) => Number(r.record.split('-')[1]);
          return miss.length && miss.every((s) => L(s.actual) > L(s.pick) && s.actual.sos > s.pick.sos)
            ? '. Each time the committee took the team with an extra loss but the tougher schedule.'
            : '.';
        })()
      )
    )
  );

  // what does it take
  const actual = seasons.filter((s) => s.actual).map((s) => s.actual);
  const byLosses = {};
  for (const a of actual) {
    const l = Number(a.record.split('-')[1]);
    byLosses[l] = (byLosses[l] || 0) + 1;
  }
  root.append(
    cardSub(
      'What it has taken',
      'Records of the top-ranked Group of 5 team on Selection Day, 2014–2025',
      barList(
        Object.entries(byLosses)
          .sort((a, b) => a[0] - b[0])
          .map(([l, n]) => ({ label: `${l} loss${l === '1' ? '' : 'es'}`, value: n / actual.length, text: `${n} of ${actual.length}` })),
        { color: 'var(--series-1)' }
      ),
      (() => {
        const maxL = Math.max(...Object.keys(byLosses).map(Number));
        return h(
          'p',
          { class: 'small muted' },
          maxL < 3
            ? `In ${actual.length} seasons, the top-ranked Group of 5 team never had more than ${maxL} losses. OSU already has three, so the path is: win out, win the Pac-12 (10-3), and need the other contenders to pile up losses too.`
            : `The worst record that still finished as the top-ranked Group of 5 team had ${maxL} losses.`
        );
      })()
    )
  );

  // Committee Tuesday
  const cfp = app.snap.cfpHistory || [];
  if (cfp.length) {
    const last = cfp[cfp.length - 1];
    const g6 = last.ranks.filter((r) => app.T(r.id).conf && app.snap.conferences[app.T(r.id).conf]?.g6);
    const ours = app.snap.now.filter((r) => r.eligible).slice(0, Math.max(5, g6.length));
    root.append(
      cardSub(
        'Committee Tuesday',
        `Latest CFP ranking (${dayDate(last.date)}) vs. the model’s order on current resumes`,
        h(
          'div',
          { class: 'grid two tight' },
          h('div', null, h('h3', null, 'Committee'), h('ol', null, g6.map((r) => h('li', null, teamLink(app, r.id, { full: true, rank: false }), h('span', { class: 'muted small' }, ` #${r.rank}`))))),
          h('div', null, h('h3', null, 'Model'), h('ol', null, ours.map((r) => h('li', null, teamLink(app, r.id, { full: true, rank: false }), h('span', { class: 'muted small' }, ` ${pct(r.pTop)}`)))))
        )
      )
    );
  } else {
    root.append(cardSub('Committee Tuesday', 'Comes alive when the committee releases its first 2026 ranking', h('p', { class: 'muted' }, 'Each Tuesday the committee’s G6 order will show next to the model’s, so you can see where they disagree.')));
  }

  root.append(
    cardSub(
      'Assumptions and limits',
      null,
      h(
        'ul',
        { class: 'small' },
        h('li', null, 'The 2026 rule as reported: the spot goes to the highest-ranked G6 team, champion or not. The What-If page can switch to the old champions-only rule.'),
        h('li', null, 'North Dakota State (MWC) and Sacramento State (MAC) are in their FBS transition: no conference title game and no CFP this year.'),
        h('li', null, 'Tiebreakers are simplified (record, head-to-head, then rating). Real leagues have more steps.'),
        h('li', null, 'The committee is people. The model knows how they have ranked resumes, not who they like this year. Once 2026 rankings come out, compare on Committee Tuesday.'),
        h('li', null, 'Power 4 teams count only as opponents: their results move ratings, schedule strength and quality wins for G6 teams.'),
        h('li', null, `Out of sample, rating-based margins miss by ${M.params.oosSd} points on average (standard deviation), and the sims use that much spread.`)
      ),
      h('p', { class: 'small muted' }, `Model trained ${dayDate(M.trainedAt)}. Data refreshed ${dayDate(app.snap.generatedAt)}. Live scores come straight from ESPN while the page is open.`)
    )
  );
  return root;
}
