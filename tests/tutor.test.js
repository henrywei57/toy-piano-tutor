import { describe, it, expect } from 'vitest';
import { buildTimeline, matchKey, TutorEngine } from '../src/ui/tutorEngine.js';
import { mapNotes } from '../src/mapping/transpose.js';
import { midiToFreq } from '../src/audio/notes.js';
import { parseNotation } from '../src/song/notation.js';
import { analyzeStrike } from '../src/audio/analyze.js';
import { tutorListenOptions } from '../src/audio/strikeListener.js';
import { ping } from './signals.js';

// C major white keys C4..C5 (8 keys), key 3 (F4) detuned 30 cents sharp
const keys = [60, 62, 64, 65.3, 67, 69, 71, 72].map((midi, index) => ({ index, midi }));
const notes = parseNotation('C4 D4 E4 F#4 G4/2', { bpm: 60 }).notes; // 1 s per beat

describe('buildTimeline', () => {
  it('keeps mapped notes in order and drops skipped ones', () => {
    const tl = buildTimeline(mapNotes(notes, keys, { strategy: 'skip' }));
    expect(tl.map((e) => [e.key, e.start, e.end])).toEqual([[0, 0, 1], [1, 1, 2], [2, 2, 3], [4, 4, 6]]);
    const folded = buildTimeline(mapNotes(notes, keys, { strategy: 'nearest' }));
    expect(folded).toHaveLength(5);
    expect(folded[3].status).toBe('nearest');
  });
});

describe('matchKey', () => {
  it('finds the nearest real key, using its measured pitch', () => {
    expect(matchKey(midiToFreq(64), keys).index).toBe(2);
    expect(matchKey(midiToFreq(65.3), keys)).toMatchObject({ index: 3 });
    expect(Math.round(matchKey(midiToFreq(65), keys).cents)).toBe(-30);
  });

  it('recovers from an octave error in detection', () => {
    expect(matchKey(midiToFreq(64 + 12), keys.slice(0, 5)).index).toBe(2); // E5 heard, only C4..G4 exist
    expect(matchKey(midiToFreq(62 - 12), keys).index).toBe(1);
  });

  it('ignores sounds far from every key', () => {
    expect(matchKey(midiToFreq(90), keys)).toBeNull();
    expect(matchKey(0, keys)).toBeNull();
  });
});

describe('TutorEngine — watch mode', () => {
  const tl = buildTimeline(mapNotes(notes, keys, { strategy: 'nearest' }));

  it('starts with a lead-in and reports notes as time reaches them', () => {
    const e = new TutorEngine(tl, { leadIn: 1 });
    expect(e.time).toBe(-1);
    expect(e.advance(0.5)).toEqual([]);
    expect(e.advance(0.5).map((x) => x.key)).toEqual([0]);   // t = 0
    expect(e.advance(2.5).map((x) => x.key)).toEqual([1, 2]); // t = 2.5
    expect(e.progress).toBe(3);
  });

  it('finishes after the last note ends', () => {
    const e = new TutorEngine(tl, { leadIn: 0 });
    e.advance(6);
    expect(e.finished).toBe(false);
    e.advance(0.5);
    expect(e.finished).toBe(true);
    expect(e.advance(1)).toEqual([]);
  });

  it('plays the first note immediately with no lead-in', () => {
    const e = new TutorEngine(tl, { leadIn: 0 });
    expect(e.advance(0).map((x) => x.key)).toEqual([0]);
  });

  it('ignores strikes', () => {
    const e = new TutorEngine(tl);
    expect(e.strike(0)).toBe('ignored');
    expect(e.accuracy).toBeNull();
  });
});

describe('TutorEngine — listen and wait', () => {
  const tl = buildTimeline(mapNotes(notes, keys, { strategy: 'skip' })); // keys 0,1,2,4 at 0,1,2,4 s

  it('stops time at the next note until it is played', () => {
    const e = new TutorEngine(tl, { waitMode: true, leadIn: 1 });
    e.advance(5);
    expect(e.time).toBe(0);
    expect(e.waiting).toBe(true);
    expect(e.expected.key).toBe(0);
    expect(e.strike(0)).toBe('correct');
    expect(e.waiting).toBe(false);
    e.advance(5);
    expect(e.time).toBe(1);
    expect(e.expected.key).toBe(1);
  });

  it('counts wrong keys and computes accuracy', () => {
    const e = new TutorEngine(tl, { waitMode: true, leadIn: 0 });
    e.advance(1);
    expect(e.strike(3)).toBe('wrong');
    expect(e.strike(0)).toBe('correct');
    e.advance(1);
    expect(e.strike(1)).toBe('correct');
    expect(e.correct).toBe(2);
    expect(e.wrong).toBe(1);
    expect(e.accuracy).toBeCloseTo(2 / 3, 6);
  });

  it('accepts the right key a little early, not long before', () => {
    const e = new TutorEngine(tl, { waitMode: true, leadIn: 0, earlyWindow: 0.6 });
    e.advance(0); e.strike(0);  // note 0 at t=0
    e.advance(0.2);             // t = 0.2, next note at 1.0 (0.8 s away)
    expect(e.strike(1)).toBe('ignored');
    e.advance(0.3);             // t = 0.5, 0.5 s away
    expect(e.strike(1)).toBe('correct');
    expect(e.time).toBe(0.5);
  });

  it('finishes once every note is played and the last one has rung', () => {
    const e = new TutorEngine(tl, { waitMode: true, leadIn: 0 });
    for (const ev of tl) { e.advance(10); expect(e.strike(ev.key)).toBe('correct'); }
    expect(e.finished).toBe(false);
    e.advance(10);
    expect(e.finished).toBe(true);
    expect(e.accuracy).toBe(1);
    expect(e.results.every((r) => r === 'correct')).toBe(true);
  });
});

describe('tutor strike recognition', () => {
  const sr = 48000;
  // A detuned white-key toy piano, C5..C7 (as in calibration).
  const pianoMidi = [72, 74.2, 76, 77, 79.1, 81, 83, 84, 86, 87.8, 89, 91, 93, 95, 96];
  const pianoKeys = pianoMidi.map((midi, index) => ({ index, midi }));
  const opts = tutorListenOptions(pianoMidi.map(midiToFreq));

  it('identifies each key from a short capture of a ping with an attack click', () => {
    // What the listener hands over: ~60 ms pre-roll, then at most 200 ms in all.
    const total = Math.round((opts.maxMs / 1000) * sr);
    pianoMidi.forEach((midi, i) => {
      const take = ping(midiToFreq(midi), sr, { preSilenceMs: 60, seconds: 0.2, seed: 11 + i }).subarray(0, total);
      const r = analyzeStrike(take, sr, opts.analyze);
      expect(r.ok, `key ${i + 1}`).toBe(true);
      expect(matchKey(r.freq, pianoKeys).index, `key ${i + 1}`).toBe(i);
    });
  });

  it('still works for a low-pitched piano', () => {
    const low = [48, 50, 52, 53, 55].map((midi, index) => ({ index, midi }));
    const o = tutorListenOptions(low.map((k) => midiToFreq(k.midi)));
    const total = Math.round((o.maxMs / 1000) * sr);
    low.forEach((k) => {
      const take = ping(midiToFreq(k.midi), sr, { preSilenceMs: 60, seconds: 0.2, seed: 3 + k.index }).subarray(0, total);
      const r = analyzeStrike(take, sr, o.analyze);
      expect(r.ok).toBe(true);
      expect(matchKey(r.freq, low).index).toBe(k.index);
    });
  });
});
