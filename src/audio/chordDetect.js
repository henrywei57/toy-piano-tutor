// Which of a few known keys are sounding in one recorded strike? Used for
// chords in "listen and wait": a pitch detector hears one note, but here we
// only have to check the keys the chord needs, at their measured pitches.
//
// A key counts as played when, just after the attack, its fundamental is
//   - strong compared with the whole sound,
//   - not much weaker than the strongest key being checked, and
//   - clearly louder than just before the attack (so a key still ringing from
//     the previous note doesn't count again), and
//   - if it sits on a harmonic of a lower key that is sounding (electronic
//     keyboards have strong harmonics), much louder than that harmonic would be.

import { findAttack } from './analyze.js';

const SCAN_CENTS = [-40, -20, 0, 20, 40]; // measured keys drift a little

/** Amplitude of a sinusoid at `freq` in samples[start, start+len), Hann window. */
function amplitudeAt(samples, start, len, freq, sampleRate) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cw = Math.cos(w), sw = Math.sin(w);
  let c = 1, s = 0, re = 0, im = 0, winSum = 0;
  for (let i = 0; i < len; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    const x = samples[start + i] * win;
    re += x * c;
    im -= x * s;
    winSum += win;
    const nc = c * cw - s * sw;
    s = s * cw + c * sw;
    c = nc;
  }
  return winSum > 0 ? (2 * Math.hypot(re, im)) / winSum : 0;
}

function bestAmplitude(samples, start, len, freq, sampleRate) {
  let best = 0;
  for (const c of SCAN_CENTS) best = Math.max(best, amplitudeAt(samples, start, len, freq * Math.pow(2, c / 1200), sampleRate));
  return best;
}

function rms(samples, start, len) {
  let sum = 0;
  for (let i = start; i < start + len; i++) sum += samples[i] * samples[i];
  return len > 0 ? Math.sqrt(sum / len) : 0;
}

/**
 * @param {Float32Array} samples  one strike, with a little sound before the attack
 * @param {number} sampleRate
 * @param {number[]} freqs        measured frequencies of the keys to check
 * @param {object} [opts]
 * @param {number} [opts.skipMs=30]     skip the attack click
 * @param {number} [opts.windowMs=85]   analysis window after the click
 * @param {number} [opts.minShare=0.2]  fundamental vs. the whole sound (as a sine's amplitude)
 * @param {number} [opts.minRatio=0.15] vs. the strongest key checked
 * @param {number} [opts.minRise=2]     vs. the same key just before the attack
 * @param {number} [opts.overtone=0.6]  vs. a lower sounding key it is a harmonic of
 * @returns {boolean[]} one per freq
 */
export function keysSounding(samples, sampleRate, freqs, opts = {}) {
  const none = freqs.map(() => false);
  const { index: onset, peak } = findAttack(samples, sampleRate);
  if (peak < 1e-4) return none;
  const start = onset + Math.round(((opts.skipMs ?? 30) / 1000) * sampleRate);
  const len = Math.min(Math.round(((opts.windowMs ?? 85) / 1000) * sampleRate), samples.length - start);
  if (len < 0.03 * sampleRate) return none;

  const post = freqs.map((f) => bestAmplitude(samples, start, len, f, sampleRate));
  const preLen = Math.min(len, onset);
  const pre = preLen >= 0.02 * sampleRate
    ? freqs.map((f) => bestAmplitude(samples, onset - preLen, preLen, f, sampleRate))
    : freqs.map(() => 0);
  const whole = rms(samples, start, len) * Math.SQRT2; // amplitude of a sine with this RMS
  const strongest = Math.max(...post);
  const minShare = opts.minShare ?? 0.2;
  const minRatio = opts.minRatio ?? 0.15;
  const minRise = opts.minRise ?? 2;
  const on = post.map((a, i) => a > 1e-4 && a >= minShare * whole && a >= minRatio * strongest && a >= minRise * pre[i]);
  const overtone = opts.overtone ?? 0.6;
  return on.map((yes, k) => yes && !freqs.some((fj, j) => j !== k && on[j] && isHarmonic(freqs[k], fj) && post[k] < overtone * post[j]));
}

/** True if `f` is within 30 cents of the 2nd–8th harmonic of `base`. */
function isHarmonic(f, base) {
  const r = f / base;
  const n = Math.round(r);
  return n >= 2 && n <= 8 && Math.abs(1200 * Math.log2(r / n)) <= 30;
}
