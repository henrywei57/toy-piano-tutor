// Synthetic test signals.

/** Deterministic pseudo-random noise in [-1, 1]. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

export function sine(freq, sampleRate, seconds, amp = 0.5) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/**
 * A struck metal bar / rod: an exponentially decaying fundamental plus
 * inharmonic partials, a loud broadband click at the start, and some room noise.
 *
 * @param {number} freq fundamental in Hz
 * @param {object} o
 * @param {Array<[ratio:number, amp:number, decaySec:number]>} [o.partials]
 *        defaults to a free bar (glockenspiel-like): 1, 2.76, 5.40
 */
export function ping(freq, sampleRate, o = {}) {
  const seconds = o.seconds ?? 1.0;
  const pre = Math.round(((o.preSilenceMs ?? 0) / 1000) * sampleRate);
  const partials = o.partials ?? [
    [1, 0.6, 0.5],
    [2.76, 0.35, 0.06],
    [5.4, 0.25, 0.025],
  ];
  const clickMs = o.clickMs ?? 4;
  const clickAmp = o.clickAmp ?? 0.9;
  const noiseAmp = o.noiseAmp ?? 0.003;
  const rng = makeRng(o.seed ?? 7);

  const n = pre + Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const clickLen = Math.round((clickMs / 1000) * sampleRate);
  for (let i = 0; i < n; i++) {
    let v = noiseAmp * rng();
    const k = i - pre;
    if (k >= 0) {
      const t = k / sampleRate;
      for (const [ratio, amp, decay] of partials) {
        v += amp * Math.exp(-t / decay) * Math.sin(2 * Math.PI * freq * ratio * t + ratio);
      }
      if (k < clickLen) v += clickAmp * rng() * (1 - k / clickLen);
    }
    out[i] = v;
  }
  return out;
}
