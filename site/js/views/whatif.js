import { h, pct, pts, clear, shortDate } from '../util.js';
import { cardSub, delta, teamLink, dot } from '../components.js';
import { barList } from '../charts.js';

// Kept across re-renders (live updates, navigation) so picks aren't lost.
const state = { forced: {}, forceTeams: {}, rule: 'top', showAll: false, result: null, running: false, timer: null, error: null };
const N = 6000;
const PAC12 = '9';

export function renderWhatIf(app) {
  const F = app.focus;
  const root = h('div', { class: 'view whatif', 'data-busy': '1' });
  const resultBox = h('div', { class: 'whatif-result' });

  const schedule = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(runNow, 250);
  };
  const runNow = async () => {
    const empty = !Object.keys(state.forced).length && !Object.keys(state.forceTeams).length && state.rule === 'top';
    if (empty) {
      state.result = null;
      drawResult();
      return;
    }
    state.running = true;
    drawResult();
    try {
      const forcedTitle = {};
      state.result = await app.sim({ n: N, seed: 20261103, forced: state.forced, forceTeams: state.forceTeams, forcedTitle, rule: state.rule });
      // compare against a baseline run at the same size and seed so the delta is clean
      if (!state.baseline || state.baselineKey !== app.inputKey) {
        state.baseline = await app.sim({ n: N, seed: 20261103 });
        state.baselineKey = app.inputKey;
      }
      state.error = null;
    } catch (err) {
      state.error = String(err.message || err);
    }
    state.running = false;
    drawResult();
  };

  function drawResult() {
    clear(resultBox);
    const base = state.baseline || app.sum;
    const r = state.result;
    if (!r && !state.running) {
      resultBox.append(
        h(
          'div',
          { class: 'card result-card empty' },
          h('h2', null, 'Your scenario'),
          h('p', { class: 'muted' }, 'Pick winners below or use a quick scenario. The odds update on their own (6,000 simulated seasons per change).'),
          h('div', { class: 'hero-num small-hero' }, pct(app.sum.focus.bid)),
          h('p', { class: 'muted small' }, 'Oregon State’s CFP odds with nothing changed')
        )
      );
      return;
    }
    const raw = r || state.lastResult;
    if (r) state.lastResult = r;
    // The scenario and its paired baseline share a sample, so their difference is clean. Show
    // that difference on top of the headline odds so the numbers match the rest of the site.
    const head = app.sum;
    const shift = (x, b, h0) => Math.max(0, Math.min(1, h0 + (x - b)));
    const cur = raw && {
      focus: {
        bid: shift(raw.focus.bid, base.focus.bid, head.focus.bid),
        champ: shift(raw.focus.champ, base.focus.champ, head.focus.champ),
        title: shift(raw.focus.title, base.focus.title, head.focus.title),
      },
      teams: Object.fromEntries(Object.entries(raw.teams).map(([id, v]) => [id, { bid: shift(v.bid, base.teams[id]?.bid ?? 0, head.teams[id]?.bid ?? 0) }])),
    };
    const card = h('div', { class: `card result-card${state.running ? ' stale' : ''}` });
    card.append(h('div', { class: 'card-head' }, h('h2', null, 'Your scenario'), state.running ? h('span', { class: 'pill' }, 'Simulating…') : null));
    if (state.error) card.append(h('p', { class: 'notice warn' }, state.error));
    if (cur) {
      const d = cur.focus.bid - head.focus.bid;
      card.append(
        h('div', { class: 'hero-row' }, h('div', { class: 'hero-num small-hero' }, pct(cur.focus.bid)), h('div', { class: 'hero-side' }, delta(d), h('div', { class: 'muted small' }, `from ${pct(head.focus.bid)}`))),
        h(
          'div',
          { class: 'stats' },
          h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Pac-12 title'), h('div', { class: 'stat-value' }, pct(cur.focus.champ)), h('div', { class: 'stat-note' }, pts(cur.focus.champ - head.focus.champ, { digits: 1 }))),
          h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Title game'), h('div', { class: 'stat-value' }, pct(cur.focus.title)))
        )
      );
      const ids = Object.keys(cur.teams)
        .sort((a, b) => cur.teams[b].bid - cur.teams[a].bid)
        .slice(0, 8);
      card.append(
        h('h3', null, 'Who gets the bid in this scenario'),
        barList(
          ids.map((id) => ({
            label: teamLink(app, id, { full: true, rank: false }),
            value: cur.teams[id].bid,
            text: `${pct(cur.teams[id].bid)} (${pts(cur.teams[id].bid - (head.teams[id]?.bid || 0), { digits: 1 })})`,
            emphasis: id === F,
            color: id === F ? 'var(--accent)' : 'var(--series-1)',
          }))
        )
      );
    }
    resultBox.append(card);
  }

  // ---- controls ----
  const controls = h('div', { class: 'whatif-controls' });
  const drawControls = () => {
    clear(controls);
    // rule + presets
    controls.append(
      cardSub(
        'Quick scenarios',
        null,
        h(
          'div',
          { class: 'chip-row' },
          h('button', { class: 'chip', onclick: () => setTeam(F, state.forceTeams[F] === 'win' ? null : 'win'), 'aria-pressed': state.forceTeams[F] === 'win' ? 'true' : 'false' }, 'Beavers win out (title game too)'),
          h(
            'button',
            {
              class: 'chip',
              onclick: () => {
                state.forced = {};
                state.forceTeams = {};
                state.rule = 'top';
                drawControls();
                schedule();
              },
            },
            'Reset everything'
          )
        ),
        h(
          'div',
          { class: 'rule-toggle' },
          h('span', { class: 'small' }, 'Bid rule'),
          seg(
            [
              ['top', 'Top-ranked G6 team (2026)'],
              ['champ', 'Top-ranked G6 champion (old rule)'],
            ],
            state.rule,
            (v) => {
              state.rule = v;
              drawControls();
              schedule();
            }
          )
        ),
        h('p', { class: 'small muted' }, 'Commissioners have talked about switching back to the old champions-only rule. Flip it to see how much it would matter for OSU.')
      )
    );
    // contenders win/lose out
    const contenders = Object.keys(app.sum.teams)
      .sort((a, b) => app.sum.teams[b].bid - app.sum.teams[a].bid)
      .filter((id) => id !== F)
      .slice(0, 7);
    controls.append(
      cardSub(
        'Whole seasons',
        'Make a team win or lose every game it has left',
        h(
          'div',
          { class: 'team-force' },
          [F, ...contenders].map((id) =>
            h(
              'div',
              { class: 'tf-row' },
              teamLink(app, id, { full: true, rank: false }),
              seg(
                [
                  ['lose', 'Loses out'],
                  [null, 'Sim'],
                  ['win', 'Wins out'],
                ],
                state.forceTeams[id] ?? null,
                (v) => setTeam(id, v)
              )
            )
          )
        )
      )
    );
    // single games
    const open = app.ctx.games.filter((g) => g.status !== 'post' && g.kind === 'reg' && g.home && g.away);
    const relevant = (g) => {
      if (state.showAll) return true;
      const b = (id) => app.sum.teams[id]?.bid ?? 0;
      return g.home === F || g.away === F || b(g.home) >= 0.004 || b(g.away) >= 0.004 || (g.conf && app.T(g.home).conf === PAC12);
    };
    const list = open.filter(relevant);
    const byWeek = new Map();
    for (const g of list) {
      if (!byWeek.has(g.week)) byWeek.set(g.week, []);
      byWeek.get(g.week).push(g);
    }
    const games = cardSub(
      'Pick games',
      state.showAll ? `All ${open.length} remaining games` : `${list.length} games involving contenders or the Pac-12 race`,
      h(
        'label',
        { class: 'check small' },
        h('input', {
          type: 'checkbox',
          checked: state.showAll ? true : null,
          onchange: (e) => {
            state.showAll = e.target.checked;
            drawControls();
          },
        }),
        ' Show every remaining FBS game'
      ),
      [...byWeek.entries()].map(([wk, gs]) =>
        h(
          'div',
          { class: 'week-group' },
          h('h3', null, `Week ${wk}`, h('span', { class: 'muted small' }, ` · ${shortDate(gs[0].date)}`)),
          gs.map((g) => gamePicker(app, g))
        )
      )
    );
    controls.append(games);
  };

  function gamePicker(app, g) {
    const away = app.side(g.id, 'away');
    const home = app.side(g.id, 'home');
    const pH = app.homeProb(g.id);
    const cur = state.forced[g.id] || null;
    const lock = state.forceTeams[g.home] || state.forceTeams[g.away];
    return h(
      'div',
      { class: `pick-row${cur ? ' set' : ''}` },
      h('div', { class: 'pick-teams small' }, dot(away.color), h('span', null, away.abbr), h('span', { class: 'muted' }, g.neutral ? ' vs ' : ' @ '), dot(home.color), h('span', null, home.abbr), pH != null ? h('span', { class: 'muted' }, ` · ${home.abbr} ${pct(pH)}`) : null),
      seg(
        [
          ['away', away.abbr],
          [null, 'Sim'],
          ['home', home.abbr],
        ],
        cur,
        (v) => {
          if (v) state.forced[g.id] = v;
          else delete state.forced[g.id];
          drawControls();
          schedule();
        },
        lock ? 'Set by a whole-season pick' : null
      )
    );
  }

  function setTeam(id, v) {
    if (v) state.forceTeams[id] = v;
    else delete state.forceTeams[id];
    drawControls();
    schedule();
  }

  drawControls();
  drawResult();
  root.append(
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'eyebrow' }, 'Scenario builder'),
      h('h1', null, 'What has to happen?'),
      h('p', { class: 'muted' }, 'Lock in results and re-run the season. Everything you don’t pick is still simulated, including title games and the committee’s vote.')
    ),
    h('div', { class: 'whatif-layout' }, h('div', { class: 'whatif-side' }, resultBox), controls)
  );
  return root;
}

function seg(options, value, onPick, note) {
  return h(
    'div',
    { class: 'seg-ctl', role: 'group', title: note || null },
    options.map(([v, label]) =>
      h(
        'button',
        {
          type: 'button',
          class: v === value ? 'on' : null,
          'aria-pressed': v === value ? 'true' : 'false',
          onclick: () => onPick(v),
        },
        label
      )
    )
  );
}
