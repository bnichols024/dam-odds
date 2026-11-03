import { h, pct, shortDate, hexColor } from '../util.js';
import { sparkline } from '../charts.js';
import { cardSub, stat, teamLink, sideLabel, notice, logo } from '../components.js';
import { FEATURES, FEATURE_LABELS, contributions } from '../../engine/committee.js';

const fmtFeature = (f, v) => {
  if (v == null) return '–';
  if (f === 'confChamp' || f === 'p4') return v ? 'Yes' : 'No';
  if (f === 'sos' || f === 'rating') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  if (f === 'qualWins' || f === 'badLosses') return v % 1 ? v.toFixed(1) : String(v);
  return String(Math.round(v));
};

export function renderTeam(app, params) {
  const id = params[0];
  const t = app.T(id);
  const F = app.focus;
  const root = h('div', { class: 'view team' });
  if (!app.snap.teams[id]) {
    root.append(notice('Team not found.'));
    return root;
  }
  const v = app.sum.teams[id];
  const isG6 = !!v;
  root.append(
    h(
      'section',
      { class: 'card team-head', style: { '--team': hexColor(t.color) } },
      h('div', { class: 'team-band', 'aria-hidden': 'true' }),
      h('p', { class: 'eyebrow' }, `${app.confLong(t.conf)}${t.div ? ` · ${t.div}` : ''}`),
      h('div', { class: 'team-title' }, logo(id, 56, t.color), h('h1', null, t.name)),
      h('p', { class: 'muted' }, `${t.record} overall · ${t.confRecord} in conference · rating ${t.rating > 0 ? '+' : ''}${t.rating} (#${t.ratingRank} of 138)${t.ap ? ` · AP #${t.ap}` : ''}${t.cfp ? ` · CFP #${t.cfp}` : ''}`),
      t.ineligible ? notice(t.ineligible, 'warn') : null,
      isG6
        ? h(
            'div',
            { class: 'stats' },
            stat('CFP bid', pct(v.bid)),
            stat('Win conference', pct(v.champ)),
            stat('Title game', pct(v.title)),
            stat('Projected record', `${v.wins.toFixed(1)}–${v.losses.toFixed(1)}`),
            h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Odds by week'), sparkline(app.historyFor(id), { width: 120, height: 32 }))
          )
        : h('p', { class: 'muted small' }, 'Not a Group of 6 team. It matters here only through the G6 teams on its schedule.')
    )
  );

  // resume vs OSU
  const now = app.snap.now;
  const me = now.find((r) => r.id === id);
  const osu = now.find((r) => r.id === F);
  if (me && osu && id !== F) {
    const model = app.input.committee;
    const rows = contributions(me.vec, osu.vec, model).filter((r, k) => model.weights[k] !== 0 && r.feature !== 'p4');
    const total = me.score - osu.score;
    const pAhead = 1 / (1 + Math.exp(-total));
    root.append(
      cardSub(
        `${t.location} vs. Oregon State, as the committee sees it today`,
        `Head-to-head, the model ranks ${t.location} ahead in ${pct(pAhead)} of looks`,
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data' },
            h('thead', null, h('tr', null, h('th', null, 'Resume item'), h('th', { class: 'num' }, t.abbr), h('th', { class: 'num' }, 'ORST'), h('th', null, 'Edge'))),
            h(
              'tbody',
              null,
              rows.map((r) => {
                const edge = Math.abs(r.delta) < 0.03 ? 'even' : r.delta > 0 ? t.abbr : 'ORST';
                return h(
                  'tr',
                  null,
                  h('td', null, FEATURE_LABELS[r.feature]),
                  h('td', { class: 'num' }, fmtFeature(r.feature, r.a)),
                  h('td', { class: 'num' }, fmtFeature(r.feature, r.b)),
                  h('td', null, edge === 'even' ? h('span', { class: 'muted' }, 'even') : h('span', null, `${edge} `, h('span', { class: 'muted small' }, `(${Math.abs(r.delta).toFixed(2)})`)))
                );
              })
            )
          )
        ),
        h(
          'p',
          { class: 'small muted' },
          'Strength of schedule is the average opponent rating. Quality wins: 1 for beating a top-25-rated team, ½ for 26–50. Conference champion means leading the league right now. Edge numbers are the model’s weight on the difference.'
        )
      )
    );
  }

  // schedule (plus the not-yet-paired flex game and a possible title game)
  const games = app.teamGames(id);
  const extra = [];
  const flex = app.input.flex;
  if (flex) {
    const hk = flex.hosts.indexOf(id);
    const vk = flex.visitors.indexOf(id);
    const slot = app.ctx.games.find((g) => g.kind === 'flex' && g.home === (hk >= 0 ? id : flex.hosts[vk]));
    if (slot && slot.away == null && (hk >= 0 || vk >= 0)) {
      const opp = hk >= 0 ? flex.visitors[hk] : flex.hosts[vk];
      extra.push(
        h(
          'li',
          { class: opp === F ? 'vs-focus' : null },
          h('span', { class: 'muted small date' }, shortDate(slot.date)),
          h('span', { class: 'at small muted' }, hk >= 0 ? 'vs' : '@'),
          teamLink(app, opp, { full: true }),
          h('span', { class: 'tag' }, 'Flex · tentative'),
          h('span', { class: 'sched-right small muted' }, 'opponent can change')
        )
      );
    }
  }
  const tg = app.ctx.games.find((g) => g.kind === 'title' && g.titleConf === t.conf);
  if (tg && tg.home !== id && tg.away !== id && isG6) {
    extra.push(
      h(
        'li',
        null,
        h('span', { class: 'muted small date' }, shortDate(tg.date)),
        h('span', { class: 'at small muted' }, ''),
        h('span', null, `${app.confName(t.conf)} title game`),
        h('span', { class: 'sched-right small' }, `${pct(v.title)} to get there`)
      )
    );
  }
  root.append(
    cardSub(
      'Schedule',
      null,
      h(
        'ol',
        { class: 'schedule' },
        games.map((g) => {
          const home = g.home === id;
          const oppSide = home ? 'away' : 'home';
          const pH = app.homeProb(g.id);
          let right;
          if (g.status === 'post') {
            const us = home ? g.hs : g.as;
            const them = home ? g.as : g.hs;
            right = h('span', { class: us > them ? 'win' : 'loss' }, `${us > them ? 'W' : 'L'} ${us}–${them}`);
          } else if (g.status === 'in') right = h('span', { class: 'live-score' }, h('span', { class: 'dot' }), `${home ? g.hs : g.as}–${home ? g.as : g.hs}`);
          else if (pH != null) right = h('span', null, `${pct(home ? pH : 1 - pH)} to win`);
          else right = h('span', { class: 'muted' }, g.kind === 'title' ? 'if they get there' : 'opponent TBD');
          const opp = (g.kind === 'title' || g.kind === 'flex') && (home ? g.away : g.home) == null ? h('span', { class: 'muted' }, g.kind === 'title' ? 'Title game' : 'Flex game (TBD)') : sideLabel(app, g.id, oppSide, { full: true });
          return h(
            'li',
            { class: (home ? g.away : g.home) === F ? 'vs-focus' : null },
            h('span', { class: 'muted small date' }, shortDate(g.date)),
            h('span', { class: 'at small muted' }, g.neutral ? 'vs' : home ? 'vs' : '@'),
            opp,
            g.kind === 'flex' ? h('span', { class: 'tag' }, 'Flex') : null,
            g.conf ? h('span', { class: 'tag subtle' }, 'Conf') : null,
            h('span', { class: 'sched-right small' }, right)
          );
        }),
        extra
      )
    )
  );
  if (id !== F) root.append(h('p', null, h('a', { class: 'more', href: `#/team/${F}` }, 'See Oregon State →'), ' ', h('a', { class: 'more', href: '#/race' }, 'Back to the race →')));
  else root.append(h('p', null, teamLink(app, F), ' ', h('a', { class: 'more', href: '#/race' }, 'Back to the race →')));
  return root;
}
