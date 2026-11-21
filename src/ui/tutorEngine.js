// Tutor timing and scoring, independent of the DOM and Web Audio.
//
// Time is "song time" in seconds (0 = first note). The view advances it by
// real elapsed time × tempo. In wait mode ("listen and wait") time stops at
// the next note until the right key is played.

import { freqToMidi } from '../audio/notes.js';
import { nearestKey } from '../mapping/transpose.js';

/** Notes the player has to play (skipped notes are left out), in order. */
export function buildTimeline(mapped) {
  return mapped
    .filter((m) => m.key != null)
    .map((m, i) => ({
      i,
      key: m.key,
      start: m.startTime,
      end: m.startTime + m.duration,
      status: m.status,
      target: m.target,
    }));
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
    this.reset();
  }

  reset() {
    this.time = -this.leadIn;
    this.cursor = 0;               // notes whose start time has been reached
    this.next = 0;                 // index of the next note to play (wait mode)
    this.correct = 0;
    this.wrong = 0;
    this.results = this.events.map(() => null); // 'correct' per note in wait mode
    this.finished = false;
  }

  /** True when time is stopped at a note, waiting for the player. */
  get waiting() {
    return this.waitMode && !this.finished && this.next < this.events.length
      && this.time >= this.events[this.next].start - 1e-9;
  }

  /** The note the player should play next (wait mode), or null. */
  get expected() {
    return this.waitMode && this.next < this.events.length ? this.events[this.next] : null;
  }

  /**
   * Move song time forward.
   * @param {number} dt song seconds
   * @returns {object[]} notes whose start was crossed (for sound / key lights)
   */
  advance(dt) {
    if (this.finished || !(dt >= 0)) return [];
    let to = this.time + dt;
    if (this.waitMode && this.next < this.events.length) to = Math.min(to, this.events[this.next].start);
    this.time = to;
    const crossed = [];
    while (this.cursor < this.events.length && this.events[this.cursor].start <= to) {
      crossed.push(this.events[this.cursor++]);
    }
    const allPlayed = !this.waitMode || this.next >= this.events.length;
    if (allPlayed && this.time >= this.lastEnd + 0.3) this.finished = true;
    return crossed;
  }

  /**
   * The player struck a key (wait mode only).
   * @returns {'correct'|'wrong'|'ignored'}
   */
  strike(keyIndex) {
    const ev = this.expected;
    if (!ev || this.finished) return 'ignored';
    if (keyIndex === ev.key) {
      if (ev.start - this.time > this.earlyWindow) return 'ignored'; // far too early: probably the previous note ringing
      this.results[this.next] = 'correct';
      this.correct++;
      this.next++;
      if (this.next >= this.events.length && this.time >= this.lastEnd + 0.3) this.finished = true;
      return 'correct';
    }
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
    if (this.waitMode) return this.next;
    return this.events.filter((e) => e.start <= this.time).length;
  }
}
