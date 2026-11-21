// Glue between the live mic stream and the offline strike analyser:
// waits for an onset, records the note as it rings, then analyses it.

import { OnsetDetector } from './onset.js';
import { analyzeStrike } from './analyze.js';

const PREROLL_MS = 60;

// Calibration wants an accurate pitch (long capture); the tutor only needs to
// know which key was hit, quickly (short capture).
export const CALIBRATION_TIMING = { minMs: 250, maxMs: 900, quietMs: 100, cooldownMs: 300 };
export const TUTOR_TIMING = { minMs: 120, maxMs: 200, quietMs: 60, cooldownMs: 60 };

/**
 * listenForStrikes() options for the tutor: short captures, and a pitch search
 * limited to the piano's own range (fewer octave errors, faster YIN).
 * @param {number[]} keyFreqs measured key frequencies (Hz)
 */
export function tutorListenOptions(keyFreqs) {
  return {
    ...TUTOR_TIMING,
    analyze: {
      maxMs: 140,
      minFrames: 2,
      minFreq: Math.max(60, Math.min(...keyFreqs) * 0.6),
      maxFreq: Math.min(5000, Math.max(...keyFreqs) * 1.7),
    },
  };
}

/**
 * @param {{sampleRate:number, subscribe:Function}} mic
 * @param {object} handlers
 * @param {(state:'waiting'|'hearing'|'analyzing'|'cooldown')=>void} [handlers.onState]
 * @param {(levelDb:number, floorDb:number)=>void} [handlers.onLevel]
 * @param {(result:object, samples:Float32Array)=>void} handlers.onResult
 *        analyzeStrike() result, and the recorded strike
 * @param {object} [opts]  timing ({minMs, maxMs, quietMs, cooldownMs}) and
 *                         opts.analyze, passed to analyzeStrike()
 * @returns {{stop:()=>void, pause:()=>void, resume:()=>void}}
 */
export function listenForStrikes(mic, handlers, opts = {}) {
  const { minMs: MIN_MS, maxMs: MAX_MS, quietMs: QUIET_MS, cooldownMs: COOLDOWN_MS } = { ...CALIBRATION_TIMING, ...opts };
  const analyzeOpts = opts.analyze || {};
  const sr = mic.sampleRate;
  const detector = new OnsetDetector(sr);
  const preroll = new Float32Array(Math.round((PREROLL_MS / 1000) * sr));
  let preFill = 0;

  let state = 'waiting';
  let paused = false;
  let rec = null;          // Float32Array being filled
  let recLen = 0;
  let quietSamples = 0;
  let cooldownUntil = 0;
  let clock = 0;           // absolute sample counter

  const minLen = Math.round((MIN_MS / 1000) * sr);
  const maxLen = Math.round((MAX_MS / 1000) * sr);
  const quietLen = Math.round((QUIET_MS / 1000) * sr);
  const cooldownLen = Math.round((COOLDOWN_MS / 1000) * sr);

  const setState = (s) => {
    if (s !== state) {
      state = s;
      handlers.onState && handlers.onState(s);
    }
  };

  function pushPreroll(block) {
    if (block.length >= preroll.length) {
      preroll.set(block.subarray(block.length - preroll.length));
      preFill = preroll.length;
      return;
    }
    const keep = Math.min(preFill, preroll.length - block.length);
    preroll.copyWithin(0, preFill - keep, preFill);
    preroll.set(block, keep);
    preFill = keep + block.length;
  }

  function finish() {
    const take = rec.subarray(0, recLen);
    rec = null;
    setState('analyzing');
    // Let the UI paint "analyzing" before the (synchronous) YIN work.
    setTimeout(() => {
      const result = analyzeStrike(take, sr, analyzeOpts);
      cooldownUntil = clock + cooldownLen;
      setState(paused ? 'waiting' : 'cooldown');
      handlers.onResult(result, take);
    }, 0);
  }

  const unsubscribe = mic.subscribe((block) => {
    const onsets = detector.process(block);
    handlers.onLevel && handlers.onLevel(detector.levelDb, detector.floorDb);
    clock += block.length;

    if (rec) {
      const n = Math.min(block.length, rec.length - recLen);
      rec.set(block.subarray(0, n), recLen);
      recLen += n;
      const quiet = detector.levelDb < detector.floorDb + 4;
      quietSamples = quiet ? quietSamples + block.length : 0;
      if (recLen >= rec.length || (recLen >= minLen && quietSamples >= quietLen)) finish();
      return;
    }

    if (state === 'cooldown' && clock >= cooldownUntil) setState('waiting');

    if (!paused && state === 'waiting' && onsets.length) {
      // Start recording with the pre-roll so the attack is fully captured.
      rec = new Float32Array(preFill + maxLen);
      rec.set(preroll.subarray(0, preFill), 0);
      recLen = preFill;
      const n = Math.min(block.length, rec.length - recLen);
      rec.set(block.subarray(0, n), recLen);
      recLen += n;
      quietSamples = 0;
      setState('hearing');
      return;
    }
    pushPreroll(block);
  });

  handlers.onState && handlers.onState(state);

  return {
    stop() { unsubscribe(); },
    pause() { paused = true; rec = null; setState('waiting'); },
    resume() { paused = false; cooldownUntil = clock + cooldownLen; setState('cooldown'); },
    get paused() { return paused; },
  };
}
