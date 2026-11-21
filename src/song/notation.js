// Typed melody notation, e.g. "C4 D4 E4 C4/2 G4".
//
//   NOTE[/d][.]   note name + octave, optional note value, optional dot
//                 /1 whole, /2 half, /4 quarter (default), /8 eighth, /16 ...
//                 "." makes it 1.5x as long (dotted)
//   R[/d][.]      rest (also "r" or "-")
//   |  ,          ignored (bar lines / separators)
//
// Durations are in beats where a quarter note = 1 beat, converted to seconds
// with the given tempo.

import { noteNameToMidi } from '../audio/notes.js';

// An uppercase B after the letter is read as a flat too ("EB4" = Eb4), since
// phone keyboards often capitalise.
const TOKEN = /^(?:([A-Ga-g][#bB♯♭]{0,2}-?\d)|([Rr-]))(?:\/(\d+))?(\.)?$/;

/**
 * @param {string} text
 * @param {{bpm?: number}} [opts]
 * @returns {{notes: {midi:number, startTime:number, duration:number}[],
 *            errors: {index:number, token:string, message:string}[],
 *            beats: number}}
 */
export function parseNotation(text, opts = {}) {
  const bpm = opts.bpm > 0 ? opts.bpm : 100;
  const secPerBeat = 60 / bpm;
  const tokens = String(text).split(/[\s,|]+/).filter(Boolean);
  const notes = [];
  const errors = [];
  let beat = 0;

  tokens.forEach((token, index) => {
    const m = TOKEN.exec(token);
    if (!m) {
      errors.push({ index, token, message: explain(token) });
      return;
    }
    const denom = m[3] ? parseInt(m[3], 10) : 4;
    if (!(denom >= 1 && denom <= 64)) {
      errors.push({ index, token, message: 'Note value must be between /1 and /64' });
      return;
    }
    const beats = (4 / denom) * (m[4] ? 1.5 : 1);
    if (m[1]) {
      const midi = noteNameToMidi(m[1][0] + m[1].slice(1).replace(/B/g, 'b'));
      if (midi == null || midi < 0 || midi > 127) {
        errors.push({ index, token, message: 'Note out of range' });
        return;
      }
      notes.push({ midi, startTime: beat * secPerBeat, duration: beats * secPerBeat });
    }
    beat += beats;
  });

  return { notes, errors, beats: beat };
}

function explain(token) {
  if (/^[A-Ga-g][#bB♯♭]{0,2}(\/\d+)?\.?$/.test(token)) return 'Missing octave number (e.g. C4)';
  if (/^[H-Zh-z]/.test(token) && !/^[Rr]/.test(token)) return 'Not a note name (A–G, or R for a rest)';
  if (/\/$/.test(token)) return 'Missing note value after "/" (e.g. /2)';
  return 'Not understood';
}
