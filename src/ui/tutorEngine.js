// Tutor timing and scoring, independent of the DOM and Web Audio.
//
// Time is "song time" in seconds (0 = first note). The view advances it by
// real elapsed time × tempo. In wait mode ("listen and wait") time stops at
// the next note (or chord) until the right keys are played.

import { freqToMidi } from '../audio/notes.js';
import { nearestKey } from '../mapping/transpose.js';
import { CHORD_WINDOW } from '../song/melody.js';

/**
 * Notes the player has to play (skipped notes are left out), in order. Two
 * notes of a chord that land on the same key (e.g. after octave folding) are
 * played once.
 */
export function buildTimeline(mapped) {
  const out = [];
  for (const m of mapped) {
    if (m.key == null) continue;
    const ev = { key: m.key, start: m.startTime, end: m.startTime + m.duration, status: m.status, target: m.target };
    let dup = null;
    for (let j = out.length - 1; j >= 0 && ev.start - out[j].start < CHORD_WINDOW; j--) {
      if (out[j].key === ev.key) { dup = out[j]; break; }
    }
    if (dup) { dup.end = Math.max(dup.end, ev.end); continue; }
    out.push(ev);
  }
  return out.map((ev, i) => ({ i, ...ev }));
}

/** Group a timeline into steps: notes that start together (a chord) are one step. */
export function groupSteps(events) {
  const steps = [];
  events.forEach((ev, i) => {
    const last = steps[steps.length - 1];
    if (last && ev.start - last.start < CHORD_WINDOW) last.idx.push(i);
    else steps.push({ start: ev.start, idx: [i] });
  });
  return steps;
}

/**
 * Which key was played? Nearest measured key by pitch. If nothing is within a
 * semitone, an octave error in detection is tried (×2 / ÷2). Sounds more than
 * 1.5 semitones from every key are ignored (returns null).
 * @param {number} freq
 * @param {{index:number, midi:number}[]} keys  from keysFromProfile()
 * @returns {{index:number, cents:number}|null}
 */
export function matchKey(freq, keys) {
  if (!(freq > 0) || !keys.length) return null;
  const m = freqToMidi(freq);
  let best = nearestKey(keys, m);
  let used = m;
  if (best.dist > 1) {
    for (const alt of [m - 12, m + 12]) {
      const n = nearestKey(keys, alt);
      if (n.dist < 0.5 && n.dist < best.dist) { best = n; used = alt; }
    }
  }
  if (best.dist > 1.5) return null;
  return { index: best.key.index, cents: (used - best.key.midi) * 100 };
}

export class TutorEngine {
  /**
   * @param {object[]} events  buildTimeline() output
   * @param {object} [opts]
   * @param {boolean} [opts.waitMode=false]
   * @param {number} [opts.leadIn=1.5]       seconds of song time before the first note
   * @param {number} [opts.earlyWindow=0.6]  in wait mode, a correct key this early still counts
   */
  constructor(events, opts = {}) {
    this.events = events;
    this.waitMode = Boolean(opts.waitMode);
    this.leadIn = opts.leadIn ?? 1.5;
    this.earlyWindow = opts.earlyWindow ?? 0.6;
    this.lastEnd = events.reduce((t, e) => Math.max(t, e.end), 0);
    this.steps = groupSteps(events);
    this.reset();
  }

  reset() {
    this.time = -this.leadIn;
    this.cursor = 0;               // notes whose start time has been reached
    this.step = 0;                 // index of the step (note or chord) to play next (wait mode)
    this.correct = 0;              // notes played right (wait mode)
    this.wrong = 0;                // wrong keys struck
    this.results = this.events.map(() => null); // 'correct' per note in wait mode
    this.finished = false;
  }

  /** True when time is stopped at a note, waiting for the player. */
  get waiting() {
    return this.waitMode && !this.finished && this.step < this.steps.length
      && this.time >= this.steps[this.step].start - 1e-9;
  }

  /** Notes of the current step still to be played (wait mode); [] when done. */
  get expectedEvents() {
    if (!this.waitMode || this.step >= this.steps.length) return [];
    return this.steps[this.step].idx.filter((i) => this.results[i] == null).map((i) => this.events[i]);
  }

  /** The (first) note the player should play next (wait mode), or null. */
  get expected() {
    return this.expectedEvents[0] || null;
  }

  /** Number of notes in the current step (more than 1 for a chord). */
  get stepSize() {
    return this.step < this.steps.length ? this.steps[this.step].idx.length : 0;
  }

  /**
   * Move song time forward.
   * @param {number} dt song seconds
   * @returns {object[]} notes whose start was crossed (for sound / key lights)
   */
  advance(dt) {
    if (this.finished || !(dt >= 0)) return [];
    let to = this.time + dt;
    if (this.waitMode && this.step < this.steps.length) to = Math.min(to, this.steps[this.step].start);
    this.time = to;
    const crossed = [];
    while (this.cursor < this.events.length && this.events[this.cursor].start <= to) {
      crossed.push(this.events[this.cursor++]);
    }
    const allPlayed = !this.waitMode || this.step >= this.steps.length;
    if (allPlayed && this.time >= this.lastEnd + 0.3) this.finished = true;
    return crossed;
  }

  /**
   * The player struck a key (wait mode only). For a chord, `alsoHeard` lists
   * other keys heard in the same strike (several keys pressed together).
   * Keys of a chord can be played together or one after another.
   * @param {number|null} keyIndex  the key the pitch detector heard (null: none)
   * @param {number[]} [alsoHeard]
   * @returns {'correct'|'wrong'|'ignored'}
   */
  strike(keyIndex, alsoHeard = []) {
    const step = this.waitMode && !this.finished ? this.steps[this.step] : null;
    if (!step) return 'ignored';
    const heard = new Set([keyIndex, ...alsoHeard]);
    const remaining = step.idx.filter((i) => this.results[i] == null);
    const hits = remaining.filter((i) => heard.has(this.events[i].key));
    if (hits.length) {
      if (step.start - this.time > this.earlyWindow) return 'ignored'; // far too early: probably the previous note ringing
      for (const i of hits) this.results[i] = 'correct';
      this.correct += hits.length;
      if (hits.length === remaining.length) this.step++;
      if (this.step >= this.steps.length && this.time >= this.lastEnd + 0.3) this.finished = true;
      return 'correct';
    }
    if (keyIndex == null) return 'ignored';
    // A key of this chord that was already played, still ringing: not a mistake.
    if (step.idx.some((i) => this.results[i] && this.events[i].key === keyIndex)) return 'ignored';
    this.wrong++;
    return 'wrong';
  }

  /** Fraction of strikes that were the right key, or null before any strike. */
  get accuracy() {
    const n = this.correct + this.wrong;
    return n ? this.correct / n : null;
  }

  /** How many notes are done: played (wait mode) or passed (watch mode). */
  get progress() {
    if (this.waitMode) return this.correct;
    return this.events.filter((e) => e.start <= this.time).length;
  }
}
