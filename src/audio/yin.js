// YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
//
// Steps: difference function -> cumulative mean normalised difference (CMND)
// -> absolute threshold -> parabolic interpolation on the raw difference.
// Pure function, no Web Audio dependency, so it can be unit-tested.

/**
 * @param {Float32Array|number[]} buf   frame of samples; must be longer than the
 *                                      longest period searched (sampleRate/minFreq)
 * @param {number} sampleRate
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.15] CMND threshold for the first dip
 * @param {number} [opts.minFreq=60]
 * @param {number} [opts.maxFreq=4500]
 * @returns {{freq:number, aperiodicity:number, tau:number}|null}
 *   freq in Hz, aperiodicity = CMND at the chosen lag (0 = perfectly periodic,
 *   ~1 = noise). null if the frame is silent or too short.
 */
export function yin(buf, sampleRate, opts = {}) {
  const threshold = opts.threshold ?? 0.15;
  const minFreq = opts.minFreq ?? 60;
  const maxFreq = opts.maxFreq ?? 4500;

  const n = buf.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  // The integration window must be at least as long as the largest lag.
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(n / 2));
  if (tauMax <= tauMin + 2) return null;
  const W = n - tauMax;

  let energy = 0;
  for (let j = 0; j < W; j++) energy += buf[j] * buf[j];
  if (energy < 1e-10) return null;

  // Step 1-2: difference function d(tau) = sum (x[j] - x[j+tau])^2
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Step 3: cumulative mean normalised difference.
  const cmnd = new Float64Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // Step 4: absolute threshold — first dip below threshold, then walk to its
  // local minimum. Fall back to the global minimum if nothing dips below.
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    let best = Infinity;
    for (let t = tauMin; t < tauMax; t++) {
      if (cmnd[t] < best) { best = cmnd[t]; tau = t; }
    }
  }
  if (tau <= 0) return null;

  // Step 5: parabolic interpolation of the raw difference around tau.
  let betterTau = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const denom = a - 2 * b + c;
    if (denom > 0) {
      const shift = (0.5 * (a - c)) / denom;
      if (Math.abs(shift) <= 1) betterTau = tau + shift;
    }
  }

  return { freq: sampleRate / betterTau, aperiodicity: cmnd[tau], tau: betterTau };
}
