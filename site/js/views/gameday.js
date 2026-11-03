// Game Day: pick a day, see every game ranked by how much it matters to OSU.
import { h, pts, dayName, dayLong, dayShort, todayKey, dayKey } from '../util.js';
import { cardSub, gameLine, teamLink } from '../components.js';
import { impact } from '../rooting.js';
import { dayList, weekDays, gamesOn, nextGameDay } from './today.js';

export function renderGameDay(app, params = []) {
  const root = h('div', { class: 'view gameday' });
  const days = weekDays(app);
  const today = todayKey();
  let key = params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? params[0] : null;
  if (!key) key = gamesOn(app, today).length ? today : nextGameDay(app, today) || today;
  if (!days.includes(key)) days.push(key);
  days.sort();

  root.append(
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'eyebrow' }, `Week ${app.snap.currentWeek} game day guide`),
      h('h1', null, `${dayName(key) === 'Today' ? 'Today' : dayName(key)} · ${dayLong(key).replace(/^[A-Za-z]+, /, '')}`),
      h(
        'nav',
        { class: 'day-chips', 'aria-label': 'Pick a day' },
        days.map((d) => {
          const n = gamesOn(app, d).length;
          const label = dayName(d) === 'Today' || dayName(d) === 'Tomorrow' ? dayName(d) : dayShort(d).split(',')[0];
          return h(
            'a',
            { class: `chip day-chip${d === key ? ' on' : ''}${n ? '' : ' empty'}`, href: `#/gameday/${d}`, 'aria-current': d === key ? 'date' : null },
            h('span', null, label),
            h('span', { class: 'chip-count' }, n ? String(n) : '–')
          );
        })
      ),
      h(
        'p',
        { class: 'muted small' },
        'Each game is played out twice with the same luck, once with each team winning. Numbers assume the Beavers win out, since that is their only realistic path; the overall-odds change is in small print. Live scores update on their own while this page is open.'
      ),
      app.live.active ? h('p', { class: 'small' }, h('span', { class: 'pill live' }, h('span', { class: 'dot' }), 'Games in progress'), ' scores and odds refresh about every 45 seconds') : null
    )
  );

  const { el, count, matters } = dayList(app, key);
  root.append(cardSub(`${dayName(key)}’s games`, count ? `${count} game${count === 1 ? '' : 's'} · ${matters} that matter${matters === 1 ? 's' : ''} to OSU` : null, el));

  // the season's biggest remaining swings (after this week)
  const later = [...app.wo.map.keys(), ...app.levLater.keys()]
    .filter((id, i, a) => a.indexOf(id) === i)
    .map((id) => ({ g: app.game(id), im: impact(app, id) }))
    .filter((x) => x.g && x.im && x.g.status !== 'post' && x.g.week > app.snap.currentWeek && x.g.home !== app.focus && x.g.away !== app.focus)
    .sort((a, b) => (b.im.wo?.gain ?? 0) - (a.im.wo?.gain ?? 0))
    .slice(0, 8);
  if (later.length) {
    root.append(
      cardSub(
        'Biggest games still to come',
        'Later weeks, ranked by how much each result swings OSU’s odds if the Beavers win out',
        h(
          'ol',
          { class: 'root-items' },
          later.map(({ g, im }) =>
            h(
              'li',
              { class: 'root-item' },
              h(
                'div',
                { class: 'root-head' },
                h('div', { class: 'root-pick' }, h('span', { class: 'muted small' }, `Week ${g.week} · root for`), teamLink(app, im.team.id, { full: true })),
                h('div', { class: 'root-gain' }, h('strong', null, im.wo ? pts(im.wo.gain, { digits: 1 }) : pts(im.overall.gain)), h('span', { class: 'muted small' }, ` ${im.tier.label}`))
              ),
              gameLine(app, g.id),
              h('span', { class: 'small muted' }, dayShort(dayKey(g.date)))
            )
          )
        )
      )
    );
  }
  return root;
}
