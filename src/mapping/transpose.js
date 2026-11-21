// Fit a song onto the keys a toy piano actually has.
//
// Keys are described by their measured pitch as a fractional MIDI number
// (69 = A4 exactly, 68.6 = 40 cents flat of A4), so out-of-tune keys work.
// A transposition shifts every song note by `shift` semitones (steps of 0.5,
// so a piano tuned "between" standard notes can still fit).

import { freqToMidi, midiToName } from '../audio/notes.js';

export const DEFAULT_TOLERANCE = 50;
export const STRATEGIES = ['fold', 'nearest', 'skip'];

/**
 * Playable keys of a profile as { index, midi } (fractional MIDI), lowest first.
 * Skipped and unmeasured keys are left out.
 */
export function keysFromProfile(profile) {
  return profile.keys
    .map((k, index) => ({ index, freq: k.freq, skip: k.skip }))
    .filter((k) => !k.skip && k.freq > 0)
    .map((k) => ({ index: k.index, midi: freqToMidi(k.freq) }))
    .sort((a, b) => a.midi - b.midi);
}

/** Nearest key to a (fractional) MIDI pitch: { key, dist } with dist in semitones. */
export function nearestKey(keys, pitch) {
  let best = null;
  let dist = Infinity;
  for (const k of keys) {
    const d = Math.abs(k.midi - pitch);
    if (d < dist) { dist = d; best = k; }
  }
  return best ? { key: best, dist } : null;
}

function pitchCounts(notes) {
  const m = new Map();
  for (const n of notes) m.set(n.midi, (m.get(n.midi) || 0) + 1);
  return m;
}

const within = (distSemis, toleranceCents) => distSemis * 100 <= toleranceCents + 1e-9;

/**
 * Score one transposition: how many song notes land within `tolerance` cents
 * of a real key.
 * @returns {{shift:number, matched:number, total:number, fraction:number, meanCents:number}}
 */
export function scoreShift(notes, keys, shift, tolerance = DEFAULT_TOLERANCE) {
  const counts = notes instanceof Map ? notes : pitchCounts(notes);
  let matched = 0, total = 0, err = 0;
  for (const [midi, count] of counts) {
    total += count;
    const near = nearestKey(keys, midi + shift);
    if (near && within(near.dist, tolerance)) {
      matched += count;
      err += near.dist * 100 * count;
    }
  }
  return { shift, matched, total, fraction: total ? matched / total : 0, meanCents: matched ? err / matched : 0 };
}

/** Best first: most notes matched, then smallest pitch error, then smallest shift. */
export function compareScores(a, b) {
  return (b.matched - a.matched)
    || (a.meanCents - b.meanCents)
    || (Math.abs(a.shift) - Math.abs(b.shift))
    || (b.shift - a.shift);
}

/**
 * Try every transposition from min to max in `step` semitones.
 * @returns {{results: object[], best: object}} results in shift order; best per compareScores
 */
export function searchTranspositions(notes, keys, opts = {}) {
  const min = opts.min ?? -12;
  const max = opts.max ?? 12;
  const step = opts.step ?? 0.5;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const counts = pitchCounts(notes);
  const results = [];
  const n = Math.round((max - min) / step);
  for (let i = 0; i <= n; i++) {
    const shift = Math.round((min + i * step) * 1000) / 1000;
    results.push(scoreShift(counts, keys, shift, tolerance));
  }
  const best = [...results].sort(compareScores)[0];
  return { results, best };
}

/**
 * Assign every song note to a key.
 * status: 'exact'   — a key within tolerance
 *         'folded'  — moved by whole octaves onto a key (octaves = +1 / −1 / …)
 *         'nearest' — no good key, so the closest key is used
 *         'skipped' — not played
 * Strategy for notes without an exact key:
 *   'fold'    octave-fold; if no octave of the note exists on the piano, use the nearest key
 *   'nearest' closest key, however far
 *   'skip'    leave the note out
 * @returns {Array<object>} note copies with { target, key, status, cents, octaves }
 *   target = transposed pitch, key = profile key index (or null), cents = key pitch − wanted pitch
 */
export function mapNotes(notes, keys, opts = {}) {
  const shift = opts.shift ?? 0;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const strategy = opts.strategy ?? 'fold';
  const lo = keys.length ? keys[0].midi : 0;
  const hi = keys.length ? keys[keys.length - 1].midi : 0;
  const centre = (lo + hi) / 2;

  return notes.map((n) => {
    const target = n.midi + shift;
    const base = { ...n, target, key: null, status: 'skipped', cents: 0, octaves: 0 };
    const near = nearestKey(keys, target);
    if (!near) return base;
    if (within(near.dist, tolerance)) {
      return { ...base, key: near.key.index, status: 'exact', cents: (near.key.midi - target) * 100 };
    }
    if (strategy === 'skip') return base;
    if (strategy === 'fold') {
      // Try whole octaves, nearest first, moving toward the middle of the keyboard first.
      const towardCentre = target > centre ? -1 : 1;
      for (let k = 1; k <= 4; k++) {
        for (const dir of [towardCentre, -towardCentre]) {
          const t2 = target + 12 * k * dir;
          const nn = nearestKey(keys, t2);
          if (nn && within(nn.dist, tolerance)) {
            return { ...base, key: nn.key.index, status: 'folded', cents: (nn.key.midi - t2) * 100, octaves: k * dir };
          }
        }
      }
    }
    return { ...base, key: near.key.index, status: 'nearest', cents: (near.key.midi - target) * 100 };
  });
}

/** Counts per status for a mapped song. */
export function mappingSummary(mapped) {
  const s = { total: mapped.length, exact: 0, folded: 0, nearest: 0, skipped: 0 };
  for (const m of mapped) s[m.status]++;
  return s;
}

/**
 * Plain-language verdict on how well the song fits at this transposition.
 * @returns {{level:'good'|'ok'|'poor'|'bad', headline:string, reasons:string[]}}
 */
export function explainFit(notes, keys, { shift = 0, tolerance = DEFAULT_TOLERANCE } = {}) {
  if (!keys.length) {
    return { level: 'bad', headline: 'This piano has no measured keys yet.', reasons: ['Calibrate the piano first.'] };
  }
  const score = scoreShift(notes, keys, shift, tolerance);
  const pct = Math.round(score.fraction * 100);
  const reasons = [];

  const songLo = Math.min(...notes.map((n) => n.midi));
  const songHi = Math.max(...notes.map((n) => n.midi));
  const keyLo = keys[0].midi;
  const keyHi = keys[keys.length - 1].midi;
  const songSpan = songHi - songLo;
  const keySpan = keyHi - keyLo;
  if (songSpan > keySpan + tolerance / 100) {
    reasons.push(
      `The melody spans ${songSpan} semitones (${midiToName(songLo)}–${midiToName(songHi)}) but your keys only cover about ${Math.round(keySpan)} ` +
      `(${midiToName(keyLo)}–${midiToName(keyHi)}), so it can’t all fit at once. Octave-fold moves the out-of-range notes back onto the keyboard.`,
    );
  }

  // Why the misses miss, at this shift.
  const tol = tolerance / 100;
  let below = 0, above = 0;
  const gaps = new Map(); // pitch-class name -> count
  for (const n of notes) {
    const t = n.midi + shift;
    const near = nearestKey(keys, t);
    if (within(near.dist, tolerance)) continue;
    if (t < keyLo - tol) below++;
    else if (t > keyHi + tol) above++;
    else {
      const name = midiToName(Math.round(t)).replace(/-?\d+$/, '');
      gaps.set(name, (gaps.get(name) || 0) + 1);
    }
  }
  if (below) reasons.push(`${below} note${below === 1 ? ' is' : 's are'} lower than your lowest key.`);
  if (above) reasons.push(`${above} note${above === 1 ? ' is' : 's are'} higher than your highest key.`);
  if (gaps.size) {
    const list = [...gaps.entries()].sort((a, b) => b[1] - a[1]);
    const fmt = (items) => items.map(([name, c]) => `${name} (${c})`).join(', ');
    const black = list.filter(([name]) => name.includes('#'));
    const white = list.filter(([name]) => !name.includes('#'));
    if (black.length) reasons.push(`No key is close to ${fmt(black)} — your piano may not have those (black) keys.`);
    if (white.length) reasons.push(`No key is close to ${fmt(white)} — that key may be skipped, missing or badly out of tune.`);
  }
  if (!Number.isInteger(shift)) {
    reasons.push('This uses a quarter-tone shift because your piano is tuned between standard notes. It will sound right on your piano, but not with other instruments.');
  }

  const total = notes.length;
  const missed = total - score.matched;
  let level, headline;
  if (score.fraction >= 0.95) {
    level = 'good';
    headline = missed ? `Fits well — only ${missed} of ${total} notes need a substitute.` : 'Fits perfectly — every note has a key.';
  } else if (score.fraction >= 0.8) {
    level = 'ok';
    headline = `Mostly fits — ${missed} of ${total} notes need a substitute.`;
  } else if (score.fraction >= 0.5) {
    level = 'poor';
    headline = `Fits poorly — only ${pct}% of the notes have a matching key. Expect it to sound noticeably different.`;
  } else {
    level = 'bad';
    headline = `This song doesn’t fit your keyboard well — only ${pct}% of the notes have a matching key at any transposition this close.`;
  }
  return { level, headline, reasons };
}

export function formatShift(shift) {
  if (shift === 0) return 'original key';
  const abs = Math.abs(shift);
  const sign = shift > 0 ? '+' : '−';
  const unit = abs === 1 ? 'semitone' : 'semitones';
  const octave = abs === 12 ? ` (an octave ${shift > 0 ? 'up' : 'down'})` : '';
  return `${sign}${abs} ${unit}${octave}`;
}
