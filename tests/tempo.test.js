import { describe, it, expect } from 'vitest';
import { estimateTempo } from '../src/song/tempo.js';
import { parseNotation } from '../src/song/notation.js';
import { makeRng } from './signals.js';

/** Notes of a typed melody at `bpm`, with timing wobble (seconds) and a start offset. */
function played(text, bpm, { jitter = 0.015, start = 0.4, drift = 0, seed = 1 } = {}) {
  const rng = makeRng(seed);
  return parseNotation(text, { bpm }).notes.map((n) => {
    const t = n.startTime * (1 + drift * n.startTime);
    return { ...n, startTime: start + t + jitter * rng(), amplitude: 0.5 };
  });
}

const TWINKLE = 'C4 C4 G4 G4 A4 A4 G4/2 F4 F4 E4 E4 D4 D4 C4/2 G4 G4 F4 F4 E4 E4 D4/2 G4 G4 F4 F4 E4 E4 D4/2';
const BUSY = 'E4/8 D4/8 C4 D4 E4/8 E4/8 E4/2 D4/8 D4/8 D4 E4/8 G4/8 G4/2 E4/8 D4/8 C4 D4 E4 E4 E4 E4/8 D4/8 D4 E4 D4 C4/1';

describe('estimateTempo', () => {
  it('finds the tempo of a played melody', () => {
    for (const bpm of [72, 96, 120]) {
      const t = estimateTempo(played(TWINKLE, bpm));
      expect(Math.abs(t.bpm - bpm), `${bpm} BPM`).toBeLessThanOrEqual(2);
    }
  });

  it('copes with eighth notes and a player who slows down a little', () => {
    // 100 BPM at the start, about 93 BPM by the end.
    const t = estimateTempo(played(BUSY, 100, { drift: 0.004 }));
    expect(t.bpm).toBeGreaterThanOrEqual(92);
    expect(t.bpm).toBeLessThanOrEqual(102);
  });

  it('says where the first note sits in its beat', () => {
    // An eighth-note pickup: the first note is half a beat before the first beat.
    const t = estimateTempo(played('G3/8 ' + TWINKLE, 90, { jitter: 0.01 }));
    expect(Math.abs(t.bpm - 90)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.offset - 0.5)).toBeLessThan(0.1);
    const onBeat = estimateTempo(played(TWINKLE, 90, { jitter: 0.01 })).offset;
    expect(Math.min(onBeat, 1 - onBeat)).toBeLessThan(0.1);
  });

  it('falls back to 100 BPM with too few notes', () => {
    expect(estimateTempo([{ startTime: 0 }, { startTime: 1 }]).bpm).toBe(100);
  });
});
