import { describe, it, expect } from 'vitest';
import { OnsetDetector } from '../src/audio/onset.js';
import { ping, makeRng } from './signals.js';

const sr = 48000;

function feed(det, signal, chunk = 512) {
  const found = [];
  for (let i = 0; i < signal.length; i += chunk) {
    found.push(...det.process(signal.subarray(i, Math.min(signal.length, i + chunk))));
  }
  return found;
}

function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function roomNoise(seconds, amp = 0.003, seed = 5) {
  const rng = makeRng(seed);
  return Float32Array.from({ length: Math.round(seconds * sr) }, () => amp * rng());
}

describe('OnsetDetector', () => {
  it('finds one onset per strike, at the right time', () => {
    const sig = concat(
      roomNoise(0.5),
      ping(523.25, sr, { seconds: 0.8, seed: 1 }),
      ping(659.25, sr, { seconds: 0.8, seed: 2 }),
    );
    const onsets = feed(new OnsetDetector(sr), sig);
    expect(onsets).toHaveLength(2);
    expect(Math.abs(onsets[0] - 0.5 * sr)).toBeLessThan(0.01 * sr);
    expect(Math.abs(onsets[1] - 1.3 * sr)).toBeLessThan(0.01 * sr);
  });

  it('stays quiet on steady room noise', () => {
    const onsets = feed(new OnsetDetector(sr), roomNoise(3, 0.01));
    expect(onsets).toHaveLength(0);
  });

  it('ignores a strike that is too quiet to be above the floor', () => {
    const sig = concat(roomNoise(0.5, 0.02), ping(800, sr, { seconds: 0.5, clickAmp: 0.01, partials: [[1, 0.01, 0.3]], noiseAmp: 0.02 }));
    expect(feed(new OnsetDetector(sr), sig)).toHaveLength(0);
  });

  it('reports positions independent of chunk size', () => {
    const sig = concat(roomNoise(0.4), ping(880, sr, { seconds: 0.5 }));
    const a = feed(new OnsetDetector(sr), sig, 128);
    const b = feed(new OnsetDetector(sr), sig, 1000);
    expect(a).toHaveLength(1);
    expect(Math.abs(a[0] - b[0])).toBeLessThanOrEqual(256);
  });
});
