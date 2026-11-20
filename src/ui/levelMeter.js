// Horizontal mic level meter (dBFS) with a noise-floor marker.

import { h } from './dom.js';

const MIN_DB = -80;
const MAX_DB = 0;

const pct = (db) => Math.max(0, Math.min(100, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));

export function createLevelMeter() {
  const fill = h('div', { class: 'meter-fill' });
  const floor = h('div', { class: 'meter-floor', title: 'Room noise level' });
  const peak = h('div', { class: 'meter-peak' });
  const el = h('div', { class: 'meter', role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': MIN_DB, 'aria-valuemax': MAX_DB }, fill, peak, floor);

  let level = MIN_DB, floorDb = MIN_DB, peakDb = MIN_DB, peakAt = 0;
  let raf = 0;

  function frame() {
    raf = 0;
    const now = performance.now();
    if (level > peakDb || now - peakAt > 800) { peakDb = level; peakAt = now; }
    fill.style.width = pct(level) + '%';
    peak.style.left = pct(peakDb) + '%';
    floor.style.left = pct(floorDb) + '%';
    el.setAttribute('aria-valuenow', Math.round(level));
  }

  return {
    el,
    set(levelDb, noiseFloorDb) {
      level = levelDb;
      floorDb = noiseFloorDb ?? MIN_DB;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    reset() {
      level = floorDb = peakDb = MIN_DB;
      if (!raf) raf = requestAnimationFrame(frame);
    },
  };
}
