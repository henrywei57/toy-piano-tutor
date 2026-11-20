// Streaming onset detector: tracks the room's noise floor and reports a new
// note when the level jumps sharply above both the recent level and the floor.
// Pure (no Web Audio), so it can be fed synthetic signals in tests.

export function rmsDb(samples, start = 0, end = samples.length) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, end - start));
  return 20 * Math.log10(rms + 1e-12);
}

export class OnsetDetector {
  /**
   * @param {number} sampleRate
   * @param {object} [opts]
   * @param {number} [opts.hopSize=256]      samples per level measurement
   * @param {number} [opts.riseDb=9]         jump above the recent level that counts as a strike
   * @param {number} [opts.marginDb=12]      level must also be this far above the noise floor
   * @param {number} [opts.minDb=-65]        absolute minimum level (dBFS)
   * @param {number} [opts.refractoryMs=150] ignore new onsets this soon after one
   * @param {number} [opts.warmupMs=200]     learn the noise floor before reporting onsets
   */
  constructor(sampleRate, opts = {}) {
    this.sampleRate = sampleRate;
    this.hop = opts.hopSize ?? 256;
    this.riseDb = opts.riseDb ?? 9;
    this.marginDb = opts.marginDb ?? 12;
    this.minDb = opts.minDb ?? -65;
    this.refractory = Math.round(((opts.refractoryMs ?? 150) / 1000) * sampleRate);
    this.warmupHops = Math.ceil((((opts.warmupMs ?? 200) / 1000) * sampleRate) / this.hop);
    this.reset();
  }

  reset() {
    this.buf = new Float32Array(this.hop);
    this.fill = 0;
    this.pos = 0;            // absolute sample index of the next sample
    this.hops = 0;
    this.levelDb = -120;
    this.floorDb = null;
    this.recent = [];        // last few hop levels, for the rise test
    this.lastOnset = -Infinity;
  }

  /**
   * Feed samples. Returns an array of onset positions (absolute sample index
   * of the start of the hop where the jump was detected).
   */
  process(samples) {
    const onsets = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(this.hop - this.fill, samples.length - i);
      for (let k = 0; k < take; k++) this.buf[this.fill + k] = samples[i + k];
      this.fill += take;
      i += take;
      if (this.fill === this.hop) {
        // The hop just completed ends at absolute index pos + i - 1.
        const hopStart = this.pos + i - this.hop;
        if (this._hop(hopStart)) onsets.push(hopStart);
        this.fill = 0;
      }
    }
    this.pos += samples.length;
    return onsets;
  }

  _hop(hopStart) {
    const level = rmsDb(this.buf);
    this.levelDb = level;
    this.hops++;

    if (this.floorDb === null) this.floorDb = level;
    // Minimum-tracker style: fall fast, rise slowly (~2 s time constant).
    if (level < this.floorDb) this.floorDb += (level - this.floorDb) * 0.3;
    else this.floorDb += (level - this.floorDb) * 0.003;

    const ref = this.recent.length ? Math.min(...this.recent) : level;
    this.recent.push(level);
    if (this.recent.length > 4) this.recent.shift();

    if (this.hops <= this.warmupHops) return false;
    if (hopStart - this.lastOnset < this.refractory) return false;
    const isOnset =
      level >= this.minDb &&
      level >= this.floorDb + this.marginDb &&
      level - ref >= this.riseDb;
    if (isOnset) this.lastOnset = hopStart;
    return isOnset;
  }
}
