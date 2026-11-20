// Glue between the live mic stream and the offline strike analyser:
// waits for an onset, records the note as it rings, then analyses it.

import { OnsetDetector } from './onset.js';
import { analyzeStrike } from './analyze.js';

const PREROLL_MS = 60;
const MIN_MS = 250;
const MAX_MS = 900;
const QUIET_MS = 100;
const COOLDOWN_MS = 300;

/**
 * @param {{sampleRate:number, subscribe:Function}} mic
 * @param {object} handlers
 * @param {(state:'waiting'|'hearing'|'analyzing'|'cooldown')=>void} [handlers.onState]
 * @param {(levelDb:number, floorDb:number)=>void} [handlers.onLevel]
 * @param {(result:object)=>void} handlers.onResult   analyzeStrike() result
 * @returns {{stop:()=>void, pause:()=>void, resume:()=>void}}
 */
export function listenForStrikes(mic, handlers) {
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
      const result = analyzeStrike(take, sr);
      cooldownUntil = clock + cooldownLen;
      setState(paused ? 'waiting' : 'cooldown');
      handlers.onResult(result);
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
