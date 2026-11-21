import { describe, it, expect } from 'vitest';
import { keysSounding } from '../src/audio/chordDetect.js';
import { ping } from './signals.js';

const SR = 48000;
// Measured keys of a toy piano, a little out of tune: C5 E5 G5 A5 C6 (+ D5)
const C5 = 527, D5 = 585, E5 = 669, G5 = 786, A5 = 865, C6 = 1047;
const ROD = [[1, 0.6, 0.5], [6.27, 0.3, 0.02], [17.55, 0.15, 0.008]]; // toy-piano rod partials

/** 60 ms of quiet, then the given keys struck together (seconds of capture: 0.2). */
function strike(freqs, o = {}) {
  const n = Math.round(0.26 * SR);
  const out = new Float32Array(n);
  freqs.forEach((f, k) => {
    const p = ping(f, SR, { seconds: 0.2, preSilenceMs: 60 + (o.rollMs || 0) * k, partials: o.partials, seed: 3 + k, clickAmp: 0.6 });
    for (let i = 0; i < Math.min(n, p.length); i++) out[i] += p[i] * (o.gain ? o.gain[k] : 1);
  });
  if (o.ringing) {
    // A key struck 300 ms earlier, still ringing.
    const p = ping(o.ringing, SR, { seconds: 0.6, partials: ROD, seed: 99, noiseAmp: 0 });
    const from = Math.round(0.3 * SR);
    for (let i = 0; i < n; i++) out[i] += p[from + i];
  }
  return out;
}

describe('keysSounding (chords)', () => {
  it('hears every key of a chord struck together', () => {
    expect(keysSounding(strike([C5, E5, G5]), SR, [C5, E5, G5])).toEqual([true, true, true]);
    expect(keysSounding(strike([C5, E5, G5], { partials: ROD }), SR, [C5, E5, G5])).toEqual([true, true, true]);
  });

  it('does not hear keys that were not played', () => {
    expect(keysSounding(strike([C5]), SR, [C5, E5, G5])).toEqual([true, false, false]);
    expect(keysSounding(strike([E5, C6], { partials: ROD }), SR, [C5, E5, G5, C6])).toEqual([false, true, false, true]);
    // A wrong key (A5) next to the wanted ones: none of the chord keys count.
    expect(keysSounding(strike([A5]), SR, [C5, E5, G5])).toEqual([false, false, false]);
  });

  it('tells neighbouring keys apart', () => {
    expect(keysSounding(strike([C5]), SR, [C5, D5])).toEqual([true, false]);
  });

  it('does not mistake a harmonic of a played key for another key', () => {
    const square = [[1, 1, 0.5], [3, 0.33, 0.5], [5, 0.2, 0.5], [7, 0.14, 0.5]]; // electronic keyboard
    const C4 = 262, G5x = 786; // G5x = 3 × C4
    expect(keysSounding(strike([C4], { partials: square }), SR, [C4, G5x])).toEqual([true, false]);
    expect(keysSounding(strike([C4, G5x], { partials: square }), SR, [C4, G5x])).toEqual([true, true]);
  });

  it('ignores a key still ringing from before', () => {
    expect(keysSounding(strike([G5], { ringing: C5 }), SR, [C5, G5])).toEqual([false, true]);
  });

  it('copes with one key played softer than the others', () => {
    expect(keysSounding(strike([C5, E5, G5], { gain: [1, 0.4, 1] }), SR, [C5, E5, G5])).toEqual([true, true, true]);
  });

  it('returns nothing for silence', () => {
    expect(keysSounding(new Float32Array(SR * 0.2), SR, [C5, E5])).toEqual([false, false]);
  });
});
