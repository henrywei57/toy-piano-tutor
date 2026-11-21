// Sheet music for the Play screen: the notes to play on a staff, engraved by
// abcjs (loaded on first use), with the current note highlighted.

import { h } from './dom.js';
import { buildSheet } from '../song/sheet.js';
import { freqToMidi } from '../audio/notes.js';

let rendererPromise = null;
function loadRenderer() {
  // Only the engraver, not abcjs's synth and editor.
  rendererPromise ||= import('abcjs/src/api/abc_tunebook_svg.js').then((m) => m.default || m);
  return rendererPromise;
}

/**
 * @param {HTMLElement} container
 * @param {object} o
 * @param {object[]} o.events  timeline (buildTimeline)
 * @param {object} o.profile
 * @param {object} o.song
 * @param {'keys'|'notes'|'none'} o.labels
 */
export function createSheetView(container, { events, profile, song, labels }) {
  // abcjs styles the element it draws into (aspect-ratio padding), so it gets
  // its own inner element and `el` stays a normal scrolling box.
  const paper = h('div');
  const el = h('div', { class: 'sheet', role: 'img', 'aria-label': `Sheet music for ${song.name}` }, paper);
  const status = h('div', { class: 'sheet-status muted small' }, 'Loading sheet music…');
  container.append(status, el);

  const keyMidi = profile.keys.map((k) => (k.freq ? freqToMidi(k.freq) : 60));
  let current = { labels, now: -1, next: -1, done: 0 };
  let byEvent = [];        // event index -> SVG elements
  let renderedWidth = 0;
  let destroyed = false;
  let timer = 0;

  async function render() {
    let renderAbc;
    try {
      renderAbc = await loadRenderer();
    } catch {
      status.textContent = 'Sheet music couldn’t load. Open the app once while online so it can be saved for offline use.';
      status.hidden = false;
      return;
    }
    if (destroyed) return;
    const width = el.clientWidth;
    if (!width) return; // hidden; rendered when shown (ResizeObserver)
    renderedWidth = width;
    // abcjs draws at `staffwidth` and "resize" scales the drawing to the
    // container's width, so a smaller staffwidth means bigger notes.
    const scale = width < 520 ? 0.95 : 1.2;
    const { abc, chars, approximate } = buildSheet(events, {
      bpm: song.bpm, meter: song.meter, keyMidi, labels: current.labels, legato: song.source === 'midi',
    });
    const tunes = renderAbc(paper, abc, {
      add_classes: true,
      responsive: 'resize',
      staffwidth: Math.max(160, Math.floor(width / scale) - 24),
      paddingtop: 8, paddingbottom: 8, paddingleft: 6, paddingright: 6,
      wrap: { minSpacing: 1.8, maxSpacing: 2.8, preferredMeasuresPerLine: 4 },
    });
    byEvent = mapElements(tunes[0], chars);
    status.textContent = approximate
      ? 'This MIDI file was recorded by playing, not written note by note, so the rhythms here are only approximate. The notes and keys are right.'
      : '';
    status.hidden = !approximate;
    const keep = current;
    current = { ...keep, now: -1, next: -1, done: 0 };
    update(keep, true);
  }

  /**
   * Highlight the note being played (watch mode) or the one to play next and
   * the ones already played (listen & wait).
   * @param {{now?:number, next?:number, results?:(string|null)[], done?:number}} s
   */
  function update(s, force = false) {
    const now = s.now ?? -1, next = s.next ?? -1, done = s.done ?? 0;
    if (!force && now === current.now && next === current.next && done === current.done) return;
    if (current.now !== now) {
      mark(current.now, 'is-now', false);
      mark(now, 'is-now', true);
    }
    if (current.next !== next) {
      mark(current.next, 'is-next', false);
      mark(next, 'is-next', true);
    }
    if (force || done !== current.done) {
      byEvent.forEach((_, i) => mark(i, 'is-done', Boolean(s.results && s.results[i] === 'correct')));
    }
    if (force) { mark(now, 'is-now', true); mark(next, 'is-next', true); }
    current = { ...current, now, next, done, results: s.results };
    const focus = next >= 0 ? next : now;
    if (focus >= 0 && byEvent[focus] && byEvent[focus][0]) keepInView(byEvent[focus][0]);
  }

  function mark(i, cls, on) {
    if (i < 0 || !byEvent[i]) return;
    for (const node of byEvent[i]) node.classList.toggle(cls, on);
  }

  // Scroll so the current line of music stays visible.
  function keepInView(node) {
    const box = el.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    if (!box.height) return;
    const top = r.top - box.top + el.scrollTop;
    if (r.top < box.top + 8 || r.bottom > box.bottom - 24) {
      el.scrollTo({ top: Math.max(0, top - box.height * 0.3), behavior: 'smooth' });
    }
  }

  const ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - renderedWidth) < 16) return;
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  ro.observe(el);
  render();

  return {
    update,
    setLabels(l) {
      if (l === current.labels) return;
      current.labels = l;
      render();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      ro.disconnect();
      el.remove();
      status.remove();
    },
  };
}

/** Event index -> the SVG elements abcjs drew for it, via source positions. */
function mapElements(tune, chars) {
  const notes = [];
  for (const line of (tune && tune.lines) || []) {
    for (const staff of line.staff || []) {
      for (const voice of staff.voices || []) {
        for (const item of voice) {
          if (item.el_type === 'note' && item.abselem && item.abselem.elemset) {
            notes.push({ start: item.startChar, end: item.endChar, els: item.abselem.elemset });
          }
        }
      }
    }
  }
  notes.sort((a, b) => a.start - b.start);
  return chars.map((list) => {
    const out = [];
    for (const pos of list) {
      const n = notes.find((x) => pos >= x.start && pos < x.end);
      if (n) out.push(...n.els);
    }
    return out;
  });
}
