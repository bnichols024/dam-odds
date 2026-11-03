// Hand-rolled SVG/HTML charts that follow the dataviz rules: thin marks, hairline grid,
// crosshair tooltips, direct labels sparingly, values always also in text/table form.
import { h, s, clear, pct } from './util.js';

// Round axis: a clean step (1, 2, 2.5 or 5 x 10^k) and at most 5 ticks above zero.
function niceScale(v) {
  const top = Math.max(v * 1.08, 0.001);
  const steps = [0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25];
  const step = steps.find((s) => top / s <= 5) ?? 0.25;
  const ticks = Math.max(1, Math.ceil(top / step));
  return { max: Math.min(1, ticks * step), ticks };
}

/**
 * Line chart over ordinal x positions (weeks).
 * @param {{labels:string[], series:{id:string,label:string,color:string,values:(number|null)[], main?:boolean}[], yFormat?:(v:number)=>string, height?:number, title?:string}} cfg
 */
export function lineChart(cfg) {
  const wrap = h('div', { class: 'chart line-chart' });
  const tip = h('div', { class: 'tooltip', role: 'status', 'aria-live': 'polite' });
  const host = h('div', { class: 'chart-host' });
  wrap.append(host, tip);
  const yFmt = cfg.yFormat || ((v) => pct(v));
  const height = cfg.height || 220;

  const draw = () => {
    const W = Math.max(280, host.clientWidth || 600);
    const H = height;
    const m = { l: 44, r: 56, t: 12, b: 26 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = cfg.labels.length;
    const all = cfg.series.flatMap((x) => x.values.filter((v) => v != null));
    const scale = niceScale(Math.max(...all, 0.005));
    const yMax = cfg.yMax ?? scale.max;
    const x = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.title || 'line chart' });
    // grid + y ticks
    const ticks = cfg.yMax ? 4 : scale.ticks;
    for (let k = 0; k <= ticks; k++) {
      const v = (yMax * k) / ticks;
      svg.append(
        s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: k === 0 ? 'axis' : 'gridline' }),
        s('text', { x: m.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, cfg.tickFormat ? cfg.tickFormat(v) : `${+(v * 100).toFixed(1)}%`)
      );
    }
    // x labels (thin out on narrow screens)
    const every = Math.ceil(n / Math.max(2, Math.floor(iw / 46)));
    cfg.labels.forEach((lab, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      svg.append(s('text', { x: x(i), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, lab));
    });
    // series
    for (const ser of cfg.series) {
      let d = '';
      let area = '';
      let first = -1;
      let last = -1;
      ser.values.forEach((v, i) => {
        if (v == null) return;
        d += `${first < 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        if (first < 0) first = i;
        last = i;
      });
      if (first < 0) continue;
      if (ser.main) {
        area = `${d}L${x(last).toFixed(1)},${y(0)}L${x(first).toFixed(1)},${y(0)}Z`;
        svg.append(s('path', { d: area, fill: ser.color, 'fill-opacity': 0.1, stroke: 'none' }));
      }
      svg.append(s('path', { d, fill: 'none', stroke: ser.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      svg.append(s('circle', { cx: x(last), cy: y(ser.values[last]), r: 4, fill: ser.color, class: 'ring' }));
      if (ser.main || cfg.series.length <= 3) {
        svg.append(s('text', { x: x(last) + 8, y: y(ser.values[last]) + 4, class: 'end-label' }, yFmt(ser.values[last])));
      }
    }
    // crosshair
    const cross = s('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' });
    const dots = cfg.series.map((ser) => s('circle', { r: 4, fill: ser.color, class: 'ring', visibility: 'hidden' }));
    const hit = s('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent', tabindex: 0, 'aria-label': 'Move to read values' });
    svg.append(cross, ...dots, hit);
    const show = (i) => {
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      clear(tip);
      tip.append(h('div', { class: 'tip-title' }, cfg.labels[i]));
      cfg.series.forEach((ser, k) => {
        const v = ser.values[i];
        if (v == null) {
          dots[k].setAttribute('visibility', 'hidden');
          return;
        }
        dots[k].setAttribute('cx', x(i));
        dots[k].setAttribute('cy', y(v));
        dots[k].setAttribute('visibility', 'visible');
        tip.append(
          h('div', { class: 'tip-row' }, h('span', { class: 'key-line', style: { background: ser.color } }), h('strong', null, yFmt(v)), h('span', { class: 'muted' }, ser.label))
        );
      });
      tip.classList.add('on');
      const px = x(i);
      tip.style.left = `${Math.min(Math.max(px - 70, 0), W - 160)}px`;
      tip.style.top = `0px`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.classList.remove('on');
    };
    const nearest = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    };
    let kb = n - 1;
    hit.addEventListener('pointermove', (e) => show(nearest(e)));
    hit.addEventListener('pointerdown', (e) => show(nearest(e)));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(kb));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') kb = Math.max(0, kb - 1);
      else if (e.key === 'ArrowRight') kb = Math.min(n - 1, kb + 1);
      else return;
      e.preventDefault();
      show(kb);
    });
    clear(host).append(svg);
  };
  requestAnimationFrame(draw);
  const ro = new ResizeObserver(() => draw());
  ro.observe(host);
  return wrap;
}

/**
 * Horizontal bars with the value at the tip.
 * rows: {label: Node|string, value: number (0..1), text?: string, color?: string, emphasis?: boolean, title?: string}
 */
export function barList(rows, { max, color = 'var(--accent)', empty = 'Nothing to show' } = {}) {
  const m = max ?? Math.max(0.0001, ...rows.map((r) => r.value));
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  // leave room at the end of the track for the longest value label
  const room = Math.max(...rows.map((r) => String(r.text ?? pct(r.value)).length)) + 2;
  return h(
    'div',
    { class: 'bar-list', role: 'list' },
    rows.map((r) =>
      h(
        'div',
        { class: `bar-row${r.emphasis ? ' em' : ''}`, role: 'listitem', title: r.title || null, tabindex: r.title ? 0 : null },
        h('div', { class: 'bar-label' }, r.label),
        h(
          'div',
          { class: 'bar-track' },
          h('div', {
            class: 'bar-fill',
            style: { width: `max(${r.value > 0 ? 2 : 0}px, calc((100% - ${room}ch) * ${Math.min(1, r.value / m).toFixed(4)}))`, background: r.color || color },
          }),
          h('span', { class: 'bar-value' }, r.text ?? pct(r.value))
        )
      )
    )
  );
}

/**
 * Thin segmented bar: parts of one whole.
 * parts: {label, value, color}
 */
export function segBar(parts, { total = 1, height = 8 } = {}) {
  return h(
    'div',
    { class: 'seg-bar', style: { height: `${height}px` }, role: 'img', 'aria-label': parts.map((p) => `${p.label} ${pct(p.value)}`).join(', ') },
    parts
      .filter((p) => p.value > 0)
      .map((p) => h('div', { class: 'seg', style: { width: `${(p.value / total) * 100}%`, background: p.color }, title: `${p.label}: ${pct(p.value)}` })),
    h('div', { class: 'seg rest', style: { flex: 1 } })
  );
}

// Probability meter for a single game (home win prob), team colors on each side.
export function winMeter(pHome, homeColor, awayColor) {
  const p = Math.max(0, Math.min(1, pHome));
  return h(
    'div',
    { class: 'win-meter', role: 'img', 'aria-label': `Home win chance ${pct(p)}` },
    h('div', { class: 'wm-away', style: { width: `${(1 - p) * 100}%`, background: awayColor } }),
    h('div', { class: 'wm-home', style: { width: `${p * 100}%`, background: homeColor } })
  );
}

// Tiny sparkline (de-emphasized, current point in accent).
export function sparkline(values, { width = 96, height = 28, color = 'var(--accent)' } = {}) {
  const vs = values.filter((v) => v != null);
  if (vs.length < 2) return h('span');
  const mx = Math.max(...vs, 0.0001);
  const x = (i) => 2 + (i * (width - 6)) / (values.length - 1);
  const y = (v) => height - 3 - (v / mx) * (height - 6);
  let d = '';
  values.forEach((v, i) => {
    if (v == null) return;
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const li = values.length - 1;
  return s(
    'svg',
    { width, height, viewBox: `0 0 ${width} ${height}`, class: 'spark', 'aria-hidden': 'true' },
    s('path', { d, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
    s('circle', { cx: x(li), cy: y(values[li] ?? 0), r: 3, fill: color })
  );
}
