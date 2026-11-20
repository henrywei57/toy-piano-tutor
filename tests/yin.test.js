import { describe, it, expect } from 'vitest';
import { yin } from '../src/audio/yin.js';
import { analyzeStrike, frameSizeFor } from '../src/audio/analyze.js';
import { centsBetween } from '../src/audio/notes.js';
import { sine, ping, makeRng } from './signals.js';

const cents = (a, b) => Math.abs(centsBetween(a, b));

describe('YIN on pure sine waves', () => {
  for (const sr of [44100, 48000]) {
    const size = frameSizeFor(sr, 60);
    for (const f of [82.41, 220, 440, 523.25, 1046.5, 2093, 3520]) {
      it(`${f} Hz @ ${sr}`, () => {
        const frame = sine(f, sr, size / sr + 0.01).subarray(0, size);
        const r = yin(frame, sr);
        expect(r).not.toBeNull();
        expect(cents(r.freq, f)).toBeLessThan(3);
        expect(r.aperiodicity).toBeLessThan(0.05);
      });
    }
  }

  it('returns null on silence', () => {
    expect(yin(new Float32Array(2048), 48000)).toBeNull();
  });

  it('reports high aperiodicity for white noise', () => {
    const rng = makeRng(3);
    const noise = Float32Array.from({ length: 2048 }, () => 0.3 * rng());
    const r = yin(noise, 48000);
    expect(r.aperiodicity).toBeGreaterThan(0.3);
  });

  it('is not fooled into an octave error by a strong 2nd harmonic', () => {
    const sr = 48000, f = 440, size = 2048;
    const frame = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const t = i / sr;
      frame[i] = 0.3 * Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * 2 * f * t + 1);
    }
    expect(cents(yin(frame, sr).freq, f)).toBeLessThan(3);
  });
});

describe('analyzeStrike on decaying metal "pings"', () => {
  const sr = 48000;

  for (const f of [261.63, 523.25, 698.46, 1046.5, 1567.98, 2349.32]) {
    it(`glockenspiel-like bar at ${f} Hz with attack click`, () => {
      const sig = ping(f, sr, { preSilenceMs: 80 });
      const r = analyzeStrike(sig, sr);
      expect(r.ok).toBe(true);
      expect(cents(r.freq, f)).toBeLessThan(5);
      expect(r.confidence).toBeGreaterThan(0.8);
    });
  }

  it('toy-piano rod (clamped-free partials 6.27x, 17.55x)', () => {
    const f = 880;
    const sig = ping(f, sr, {
      partials: [[1, 0.5, 0.8], [6.27, 0.4, 0.04], [17.55, 0.2, 0.01]],
      preSilenceMs: 50,
    });
    const r = analyzeStrike(sig, sr);
    expect(r.ok).toBe(true);
    expect(cents(r.freq, f)).toBeLessThan(5);
  });

  it('survives a very loud click and a short ring', () => {
    const f = 1318.51;
    const sig = ping(f, sr, { clickAmp: 3, clickMs: 10, seconds: 0.35, partials: [[1, 0.4, 0.12], [2.76, 0.4, 0.03]] });
    const r = analyzeStrike(sig, sr);
    expect(r.ok).toBe(true);
    expect(cents(r.freq, f)).toBeLessThan(8);
  });

  it('finds the attack after leading silence', () => {
    const sig = ping(660, sr, { preSilenceMs: 120 });
    const r = analyzeStrike(sig, sr);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.onset - 0.12 * sr)).toBeLessThan(0.005 * sr);
  });

  it('works at 44.1 kHz', () => {
    const f = 987.77;
    const r = analyzeStrike(ping(f, 44100, { preSilenceMs: 40 }), 44100);
    expect(r.ok).toBe(true);
    expect(cents(r.freq, f)).toBeLessThan(5);
  });

  it('rejects pure noise as "no pitch"', () => {
    const rng = makeRng(11);
    const noise = Float32Array.from({ length: sr }, () => 0.2 * rng());
    const r = analyzeStrike(noise, sr);
    expect(r.ok).toBe(false);
  });

  it('rejects near-silence as "too quiet"', () => {
    const r = analyzeStrike(new Float32Array(sr), sr);
    expect(r).toMatchObject({ ok: false, reason: 'too-quiet' });
  });
});
