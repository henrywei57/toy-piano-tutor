// Offline analysis of one recorded key strike: locate the attack, skip the
// click, run YIN across the ringing part, and take the median.

import { yin } from './yin.js';
import { centsBetween } from './notes.js';

export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Frame size: a power of two that holds two periods of the lowest note. */
export function frameSizeFor(sampleRate, minFreq) {
  const need = 2 * Math.ceil(sampleRate / minFreq);
  let size = 512;
  while (size < need) size *= 2;
  return size;
}

/**
 * Find the attack: the loudest short block, then walk back (at most 20 ms)
 * while the level stays above 10% of that peak.
 * @returns {{index:number, peak:number}} sample index of the onset, peak RMS
 */
export function findAttack(samples, sampleRate, blockSize = 64) {
  const blocks = Math.floor(samples.length / blockSize);
  const env = new Float64Array(blocks);
  let peak = 0, peakBlock = 0;
  for (let b = 0; b < blocks; b++) {
    let sum = 0;
    for (let i = b * blockSize; i < (b + 1) * blockSize; i++) sum += samples[i] * samples[i];
    env[b] = Math.sqrt(sum / blockSize);
    if (env[b] > peak) { peak = env[b]; peakBlock = b; }
  }
  const maxBack = Math.ceil((0.02 * sampleRate) / blockSize);
  let b = peakBlock;
  while (b > 0 && peakBlock - b < maxBack && env[b - 1] >= 0.1 * peak) b--;
  return { index: b * blockSize, peak };
}

/**
 * @param {Float32Array} samples  mono recording containing one strike
 * @param {number} sampleRate
 * @param {object} [opts]
 * @param {number} [opts.skipMs=30]        ignore this much after the onset (attack click)
 * @param {number} [opts.maxMs=600]        analyse at most this much of the ring
 * @param {number} [opts.decayDb=35]       stop once the ring is this far below its loudest frame
 * @param {number} [opts.minFreq=60]
 * @param {number} [opts.maxFreq=4500]
 * @param {number} [opts.maxAperiodicity=0.3] frames noisier than this are ignored
 * @param {number} [opts.minFrames=3]
 * @returns {{ok:true, freq:number, confidence:number, voiced:number, frames:number, onset:number}
 *          |{ok:false, reason:'too-quiet'|'too-short'|'no-pitch', frames:number}}
 */
export function analyzeStrike(samples, sampleRate, opts = {}) {
  const skipMs = opts.skipMs ?? 30;
  const maxMs = opts.maxMs ?? 600;
  const decayDb = opts.decayDb ?? 35;
  const minFreq = opts.minFreq ?? 60;
  const maxFreq = opts.maxFreq ?? 4500;
  const maxAperiodicity = opts.maxAperiodicity ?? 0.3;
  const minFrames = opts.minFrames ?? 3;

  const { index: onset, peak } = findAttack(samples, sampleRate);
  if (peak < 1e-4) return { ok: false, reason: 'too-quiet', frames: 0 };

  const frameSize = frameSizeFor(sampleRate, minFreq);
  const hop = frameSize >> 2;
  const start = onset + Math.round((skipMs / 1000) * sampleRate);
  const end = Math.min(samples.length, start + Math.round((maxMs / 1000) * sampleRate) + frameSize);
  if (end - start < frameSize) return { ok: false, reason: 'too-short', frames: 0 };

  const freqs = [];
  let frames = 0;
  let loudest = 0;
  for (let s = start; s + frameSize <= end; s += hop) {
    const frame = samples.subarray(s, s + frameSize);
    let sum = 0;
    for (let i = 0; i < frameSize; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frameSize);
    loudest = Math.max(loudest, rms);
    if (rms < loudest * Math.pow(10, -decayDb / 20)) break;
    frames++;
    const r = yin(frame, sampleRate, { minFreq, maxFreq });
    if (r && r.aperiodicity <= maxAperiodicity) freqs.push(r.freq);
  }

  if (freqs.length < minFrames) return { ok: false, reason: 'no-pitch', frames };
  const freq = median(freqs);
  const agree = freqs.filter((f) => Math.abs(centsBetween(f, freq)) <= 35).length;
  return {
    ok: true,
    freq,
    confidence: agree / freqs.length,
    voiced: freqs.length,
    frames,
    onset,
  };
}
