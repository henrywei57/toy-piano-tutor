// Synthesia-style canvas: the player's real keys along the bottom, notes
// falling down their key's lane onto the hit line.

import { h } from './dom.js';
import { freqToNote } from '../audio/notes.js';

const MIN_KEY_PX = 26; // narrower than this and we zoom to the song's keys

/**
 * @param {HTMLElement} container  the canvas fills it
 * @param {object} profile
 * @param {{keysOnly?: boolean}} [opts]  keysOnly: just the keyboard (under the sheet music)
 */
export function createTutorCanvas(container, profile, opts = {}) {
  const keysOnly = Boolean(opts.keysOnly);
  const canvas = h('canvas', { class: 'tutor-canvas', 'aria-hidden': 'true' });
  container.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const names = profile.keys.map((k) => (k.freq ? freqToNote(k.freq).name : ''));
  let W = 0, H = 0, dpr = 1;
  let colors = readColors();

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    return {
      bg: v('--bg'), surface: v('--surface'), text: v('--text'), muted: v('--muted'), line: v('--line'),
      accent: v('--accent'), accentInk: v('--accent-ink'), ok: v('--ok'), warn: v('--warn'), error: v('--error'),
    };
  }

  function resize() {
    const r = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { colors = readColors(); };
  mq.addEventListener('change', onScheme);

  function rr(x, y, w, hgt, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, hgt, r);
    else ctx.rect(x, y, w, hgt);
    ctx.fill();
  }

  /**
   * @param {object} f
   * @param {number} f.time            song time (s)
   * @param {object[]} f.events        timeline
   * @param {(string|null)[]} [f.results]
   * @param {number} f.lookahead       song seconds from top to hit line
   * @param {Map<number,string>} f.lit key index -> 'play'|'expected'|'correct'|'wrong'
   * @param {number} [f.waitingIdx]    event index waiting at the line (wait mode)
   * @param {[number, number]} f.usedRange  lowest/highest key index the song uses
   * @returns {{lo:number, hi:number, zoomed:boolean}}
   */
  function draw(f) {
    const n = profile.keys.length;
    let lo = 0, hi = n - 1;
    const zoomed = W / n < MIN_KEY_PX;
    if (zoomed) {
      lo = Math.max(0, f.usedRange[0] - 1);
      hi = Math.min(n - 1, f.usedRange[1] + 1);
    }
    const count = hi - lo + 1;
    const kw = W / count;
    const kbH = keysOnly ? H - 2 : Math.max(56, Math.min(120, H * 0.22));
    const hitY = H - kbH;
    const pps = hitY / f.lookahead;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Lanes
    for (let k = lo; !keysOnly && k <= hi; k++) {
      const x = (k - lo) * kw;
      if ((k - lo) % 2) {
        ctx.fillStyle = colors.line;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, 0, kw, hitY);
        ctx.globalAlpha = 1;
      }
    }

    // Falling notes
    const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 160);
    if (!keysOnly) f.events.forEach((ev, idx) => {
      if (ev.key < lo || ev.key > hi) return;
      if (ev.end < f.time - 0.05 || ev.start > f.time + f.lookahead) return;
      let yBottom = hitY - (ev.start - f.time) * pps;
      let yTop = hitY - (ev.end - f.time) * pps;
      if (yBottom - yTop < 10) yTop = yBottom - 10;
      if (yTop >= hitY) return;
      const bottom = Math.min(yBottom, hitY);
      const top = Math.max(yTop, -4);
      const result = f.results && f.results[idx];
      ctx.fillStyle = result === 'correct' ? colors.ok
        : ev.status === 'folded' ? colors.warn
          : ev.status === 'nearest' ? colors.error
            : colors.accent;
      ctx.globalAlpha = idx === f.waitingIdx ? pulse : result === 'correct' ? 0.55 : 0.95;
      const x = (ev.key - lo) * kw;
      rr(x + Math.min(3, kw * 0.1), top, kw - 2 * Math.min(3, kw * 0.1), Math.max(2, bottom - top), Math.min(6, kw / 4));
      ctx.globalAlpha = 1;
      if (kw >= 18 && bottom - top >= 18) {
        ctx.fillStyle = colors.accentInk;
        ctx.font = `700 ${Math.min(14, kw * 0.42)}px system-ui, sans-serif`;
        ctx.fillText(String(ev.key + 1), x + kw / 2, bottom - 10);
      }
    });

    // Hit line
    if (!keysOnly) {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(0, hitY - 2, W, 2);
    }

    // Keys
    for (let k = lo; k <= hi; k++) {
      const key = profile.keys[k];
      const x = (k - lo) * kw;
      const state = f.lit.get(k);
      ctx.fillStyle = state === 'correct' ? colors.ok
        : state === 'wrong' ? colors.error
          : state ? colors.accent
            : colors.surface;
      ctx.globalAlpha = key.skip || !key.freq ? 0.4 : 1;
      rr(x + 1, hitY + 2, kw - 2, kbH - 4, [2, 2, Math.min(8, kw / 3), Math.min(8, kw / 3)]);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      const ink = state ? colors.accentInk : colors.text;
      ctx.fillStyle = ink;
      const numSize = Math.max(9, Math.min(17, kw * 0.45));
      ctx.font = `700 ${numSize}px system-ui, sans-serif`;
      const step = kw < 14 ? 2 : 1; // very narrow: label every other key
      if ((k - lo) % step === 0) ctx.fillText(String(k + 1), x + kw / 2, hitY + kbH * 0.38);
      if (kw >= 24) {
        ctx.font = `500 ${Math.min(12, kw * 0.3)}px system-ui, sans-serif`;
        ctx.fillStyle = state ? ink : colors.muted;
        ctx.fillText(key.skip ? 'skip' : names[k] || '—', x + kw / 2, hitY + kbH * 0.66);
      }
      ctx.globalAlpha = 1;
    }
    return { lo, hi, zoomed };
  }

  return {
    draw,
    destroy() {
      ro.disconnect();
      mq.removeEventListener('change', onScheme);
      canvas.remove();
    },
  };
}
