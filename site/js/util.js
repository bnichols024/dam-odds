// DOM + formatting helpers. All data strings go in as text nodes (never innerHTML).

export function h(tag, attrs, ...children) {
  const svg = tag.startsWith('svg:');
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function s(tag, attrs, ...children) {
  return h(`svg:${tag}`, attrs, ...children);
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---- numbers ----
export function pct(p, { digits } = {}) {
  if (p == null || Number.isNaN(p)) return '–';
  if (p <= 0) return '~0%';
  if (p >= 1) return '100%';
  if (p < 0.001) return '<0.1%';
  if (p > 0.999) return '>99.9%';
  const x = p * 100;
  const d = digits ?? (x < 10 ? 1 : x < 99.5 ? 0 : 1);
  return `${x.toFixed(d)}%`;
}

export function oneIn(p) {
  if (!p || p <= 0) return 'no realistic path';
  if (p >= 0.5) return `${Math.round(p * 100)} in 100`;
  const n = Math.round(1 / p);
  return `about 1 in ${n.toLocaleString()}`;
}

// percentage-point change, e.g. +0.42 pts
export function pts(d, { digits = 2 } = {}) {
  if (d == null || Number.isNaN(d)) return '–';
  const x = d * 100;
  if (Math.abs(x) < 0.005) return '±0';
  return `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)} pts`;
}

export function signed(x, d = 1) {
  return `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`;
}

export function spreadText(margin) {
  // margin = expected home margin
  if (margin == null) return '';
  const m = Math.round(margin * 2) / 2;
  if (Math.abs(m) < 0.5) return 'pick’em';
  return m.toFixed(1);
}

// ---- dates ----
const TZ = undefined; // viewer's local time
export function dayTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}
export function shortDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: TZ });
}
export function dayDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
}
export function clockTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function hexColor(c, fallback = '888888') {
  const x = (c || fallback).replace('#', '');
  return /^[0-9a-f]{6}$/i.test(x) ? `#${x}` : `#${fallback}`;
}
