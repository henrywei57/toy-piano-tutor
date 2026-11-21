import { describe, it, expect, beforeEach } from 'vitest';
import {
  keysFromProfile, nearestKey, scoreShift, searchTranspositions, mapNotes, mappingSummary, explainFit, formatShift,
} from '../src/mapping/transpose.js';
import { resolveMapping, saveMapping, useMappingStorage } from '../src/mapping/mappingStore.js';
import { createProfile } from '../src/profile/profile.js';
import { midiToFreq } from '../src/audio/notes.js';
import { parseNotation } from '../src/song/notation.js';

const WHITE = [0, 2, 4, 5, 7, 9, 11];

/** Keys as { index, midi }: white keys from `from` upwards, optionally detuned by `cents`. */
function whiteKeys(fromMidi, count, cents = 0) {
  const keys = [];
  for (let m = fromMidi; keys.length < count; m++) {
    if (WHITE.includes(((m % 12) + 12) % 12)) keys.push({ index: keys.length, midi: m + cents / 100 });
  }
  return keys;
}

function chromaticKeys(fromMidi, count, cents = 0) {
  return Array.from({ length: count }, (_, i) => ({ index: i, midi: fromMidi + i + cents / 100 }));
}

const song = (text) => parseNotation(text, { bpm: 60 }).notes;
const TWINKLE = song('C4 C4 G4 G4 A4 A4 G4/2 F4 F4 E4 E4 D4 D4 C4/2');

describe('scoring and search', () => {
  it('finds the octave shift onto a white-key piano that starts at C5', () => {
    const keys = whiteKeys(72, 15); // C5..C7
    const { best } = searchTranspositions(TWINKLE, keys);
    expect(best.shift).toBe(12);
    expect(best.fraction).toBe(1);
    expect(best.meanCents).toBeCloseTo(0, 6);
  });

  it('searches −12..+12 in half-semitone steps (49 options)', () => {
    const { results } = searchTranspositions(TWINKLE, whiteKeys(60, 8));
    expect(results).toHaveLength(49);
    expect(results[0].shift).toBe(-12);
    expect(results[1].shift).toBe(-11.5);
    expect(results[48].shift).toBe(12);
  });

  it('prefers the original key over a half-step that also lands within 50 cents', () => {
    const { results, best } = searchTranspositions(TWINKLE, chromaticKeys(55, 20));
    expect(best.shift).toBe(0);
    // +0.5 is exactly 50 cents off every note, so it also "matches" — but worse.
    expect(results.find((r) => r.shift === 0.5).fraction).toBe(1);
  });

  it('uses a quarter-tone shift for a piano tuned between standard notes', () => {
    // every key 45 cents flat: 0 matches at 45¢ error, −0.5 matches at 5¢
    const { best } = searchTranspositions(TWINKLE, whiteKeys(60, 8, -45));
    expect(best.shift).toBe(-0.5);
    expect(best.meanCents).toBeCloseTo(5, 6);
  });

  it('respects the tolerance', () => {
    const keys = whiteKeys(60, 8, -60); // 60 cents flat
    const notes = song('C4 D4 G4 A4'); // no note sits a semitone below another key
    expect(scoreShift(notes, keys, 0, 50).matched).toBe(0);
    expect(scoreShift(notes, keys, 0, 70).matched).toBe(4);
    expect(searchTranspositions(notes, keys, { tolerance: 50 }).best.shift).toBe(-0.5);
  });

  it('counts a detuned neighbour key that lands within tolerance', () => {
    // 60 cents flat: the F key is only 40 cents above E, so E notes match it
    const keys = whiteKeys(60, 8, -60);
    expect(scoreShift(song('E4'), keys, 0, 50).matched).toBe(1);
    expect(mapNotes(song('E4'), keys, { shift: 0 })[0].key).toBe(3); // key 4 = the F key
  });

  it('counts every note, not just distinct pitches', () => {
    // F#4 appears 3 times and has no key on a white-key piano
    const notes = song('C4 F#4 F#4 F#4 D4');
    const r = scoreShift(notes, whiteKeys(60, 8), 0, 50);
    expect(r).toMatchObject({ matched: 2, total: 5 });
    expect(r.fraction).toBeCloseTo(0.4, 6);
  });

  it('finds a shift that avoids missing black keys when one exists', () => {
    // G major melody (has F#) fits a white-key piano when moved down to C major (−7) or up (+5)
    const gMajor = song('G4 A4 B4 C5 D5 E5 F#5 G5');
    const { best } = searchTranspositions(gMajor, whiteKeys(60, 15));
    expect(best.fraction).toBe(1);
    expect([5, -7]).toContain(best.shift);
  });

  it('nearestKey returns null with no keys', () => {
    expect(nearestKey([], 60)).toBeNull();
  });
});

describe('mapNotes strategies', () => {
  const keys = whiteKeys(60, 8); // C4..C5 white keys
  const notes = song('C4 E5 F#4 G4'); // E5 above range, F#4 missing black key

  it('octave-fold moves out-of-range notes by octaves and falls back to the nearest key', () => {
    const m = mapNotes(notes, keys, { shift: 0, strategy: 'fold' });
    expect(m.map((x) => x.status)).toEqual(['exact', 'folded', 'nearest', 'exact']);
    expect(m[1]).toMatchObject({ key: 2, octaves: -1 }); // E5 -> E4 (key 3)
    expect(Math.abs(m[2].cents)).toBeCloseTo(100, 6);   // F#4 -> F4 or G4
  });

  it('nearest key uses the closest key however far', () => {
    const m = mapNotes(notes, keys, { shift: 0, strategy: 'nearest' });
    expect(m.map((x) => x.status)).toEqual(['exact', 'nearest', 'nearest', 'exact']);
    expect(m[1].key).toBe(7); // E5 -> C5, the top key
  });

  it('skip leaves unmatched notes out', () => {
    const m = mapNotes(notes, keys, { shift: 0, strategy: 'skip' });
    expect(m.map((x) => x.key)).toEqual([0, null, null, 4]);
    expect(mappingSummary(m)).toEqual({ total: 4, exact: 2, folded: 0, nearest: 0, skipped: 2 });
  });

  it('applies the transposition before matching', () => {
    const m = mapNotes(song('C3 D3 E3'), keys, { shift: 12 });
    expect(m.map((x) => [x.key, x.status])).toEqual([[0, 'exact'], [1, 'exact'], [2, 'exact']]);
  });
});

describe('explainFit', () => {
  it('says a fitting song fits', () => {
    const f = explainFit(TWINKLE, whiteKeys(60, 8), { shift: 0 });
    expect(f.level).toBe('good');
    expect(f.reasons).toEqual([]);
  });

  it('explains range problems and missing black keys honestly', () => {
    const notes = song('C4 D4 E4 F#4 G4 A4 B4 C5 D5 E5 F#5 G5 A5 B5 C6');
    const f = explainFit(notes, whiteKeys(60, 5), { shift: 0 }); // C4..G4 only
    expect(f.level).toBe('bad');
    expect(f.reasons.join(' ')).toMatch(/spans 24 semitones/);
    expect(f.reasons.join(' ')).toMatch(/higher than your highest key/);
    expect(f.reasons.join(' ')).toMatch(/F#/);
  });

  it('mentions the quarter-tone shift', () => {
    const f = explainFit(TWINKLE, whiteKeys(60, 8, -50), { shift: -0.5 });
    expect(f.reasons.join(' ')).toMatch(/quarter-tone/);
  });

  it('formats shifts', () => {
    expect(formatShift(0)).toBe('original key');
    expect(formatShift(1)).toBe('+1 semitone');
    expect(formatShift(-2.5)).toBe('−2.5 semitones');
    expect(formatShift(12)).toBe('+12 semitones (an octave up)');
  });
});

describe('profiles and saved settings', () => {
  beforeEach(() => {
    const m = new Map();
    useMappingStorage({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) });
  });

  it('uses only measured, non-skipped keys, sorted by pitch', () => {
    const p = createProfile('t', 4);
    p.keys = [
      { freq: midiToFreq(64), takes: [], source: 'manual', skip: false },
      { freq: null, takes: [], source: null, skip: false },
      { freq: midiToFreq(60), takes: [], source: 'manual', skip: false },
      { freq: midiToFreq(62), takes: [], source: 'manual', skip: true },
    ];
    const keys = keysFromProfile(p);
    expect(keys.map((k) => k.index)).toEqual([2, 0]);
    expect(keys[0].midi).toBeCloseTo(60, 6);
  });

  it('defaults to the best shift, then remembers what was chosen', () => {
    const p = createProfile('t', 8);
    p.keys = whiteKeys(72, 8).map((k) => ({ freq: midiToFreq(k.midi), takes: [], source: 'manual', skip: false }));
    const s = { id: 'lib-x', notes: TWINKLE };
    expect(resolveMapping(p, s)).toMatchObject({ shift: 12, tolerance: 50, strategy: 'fold', saved: false });
    saveMapping(p.id, s.id, { shift: 11, tolerance: 30, strategy: 'skip' });
    expect(resolveMapping(p, s)).toMatchObject({ shift: 11, tolerance: 30, strategy: 'skip', saved: true });
  });
});
