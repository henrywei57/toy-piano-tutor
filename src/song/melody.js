// Helpers for note lists: { midi, startTime, duration } with times in seconds.

import { midiToName } from '../audio/notes.js';

const CHORD_WINDOW = 0.03; // notes starting within 30 ms count as simultaneous

/** Sort, drop empty notes, round times, and shift so the first note starts at 0. */
export function normalizeNotes(notes) {
  const clean = notes
    .filter((n) => Number.isFinite(n.midi) && n.duration > 0.001 && Number.isFinite(n.startTime))
    .map((n) => ({ midi: Math.round(n.midi), startTime: n.startTime, duration: n.duration }))
    .sort((a, b) => a.startTime - b.startTime || b.midi - a.midi);
  const t0 = clean.length ? clean[0].startTime : 0;
  // Round start and end (not start and length) so back-to-back notes stay exactly adjacent.
  return clean.map((n) => {
    const startTime = round(n.startTime - t0);
    const end = round(n.startTime - t0 + n.duration);
    return { midi: n.midi, startTime, duration: round(end - startTime) };
  });
}

function round(t) {
  return Math.round(t * 10000) / 10000;
}

/**
 * True if more than one note sounds at once anywhere: two notes starting
 * together, or a note starting well before the previous one has ended.
 */
export function isPolyphonic(notes) {
  const s = [...notes].sort((a, b) => a.startTime - b.startTime);
  let prevEnd = -Infinity;
  let prevStart = -Infinity;
  let prevDur = 0;
  for (const n of s) {
    if (n.startTime - prevStart < CHORD_WINDOW) return true;
    // Allow small legato overlaps (up to 25% of the previous note, min 30 ms).
    const tolerance = Math.max(CHORD_WINDOW, 0.25 * prevDur);
    if (n.startTime < prevEnd - tolerance) return true;
    prevStart = n.startTime;
    prevEnd = n.startTime + n.duration;
    prevDur = n.duration;
  }
  return false;
}

/**
 * "Skyline" melody: the highest note at each moment.
 * - Of notes starting together, keep the highest.
 * - A lower note that starts under a still-sounding higher note is dropped.
 * - A note is cut short when the next kept note starts, so the result is monophonic.
 */
export function melodyOnly(notes) {
  const s = [...notes].sort((a, b) => a.startTime - b.startTime || b.midi - a.midi);
  const out = [];
  let i = 0;
  while (i < s.length) {
    // Group notes starting within the chord window; first is the highest.
    const group = [s[i]];
    let j = i + 1;
    while (j < s.length && s[j].startTime - s[i].startTime < CHORD_WINDOW) group.push(s[j++]);
    i = j;
    const top = group.reduce((a, b) => (b.midi > a.midi ? b : a));
    // A slightly rolled chord starts when its first note does.
    const start = group[0].startTime;
    const end = top.startTime + top.duration;
    const prev = out[out.length - 1];
    if (prev) {
      const prevEnd = prev.startTime + prev.duration;
      const stillSounding = prevEnd - start > CHORD_WINDOW;
      if (stillSounding && top.midi < prev.midi) continue;
      if (prevEnd > start) prev.duration = Math.max(0.001, start - prev.startTime);
    }
    out.push({ midi: top.midi, startTime: start, duration: end - start });
  }
  return out;
}

/** Count, pitch range and length of a note list. */
export function noteStats(notes) {
  if (!notes.length) return { count: 0, min: null, max: null, minName: '', maxName: '', semitones: 0, seconds: 0 };
  let min = Infinity, max = -Infinity, end = 0;
  for (const n of notes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
    end = Math.max(end, n.startTime + n.duration);
  }
  return {
    count: notes.length,
    min,
    max,
    minName: midiToName(min),
    maxName: midiToName(max),
    semitones: max - min,
    seconds: end,
  };
}

export function formatRange(stats) {
  if (!stats.count) return '—';
  if (stats.min === stats.max) return stats.minName;
  return `${stats.minName}–${stats.maxName} (${stats.semitones} semitones)`;
}

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
