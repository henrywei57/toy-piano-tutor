// Sheet music: turns the notes the player will play into ABC notation, which
// the Play screen engraves with abcjs. Pure functions, no DOM.
//
// Positions are counted in sixteenth notes ("units"). A song's meter says
// where the bar lines go: { num, den, offset } where offset is how far (in
// quarter notes) into its bar the song's first note starts (a pickup).

import { parseNotation } from './notation.js';

export const DEFAULT_METER = { num: 4, den: 4, offset: 0 };

const SHARP_NAMES = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
const LABEL_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
// Note values that can be written as one symbol, in sixteenths:
// whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth, sixteenth.
const VALUES = [16, 12, 8, 6, 4, 3, 2, 1];

/** Quarter notes per bar. */
export function barBeats(meter) {
  return (meter.num * 4) / meter.den;
}

/** "3/4" -> { num: 3, den: 4 }, or null if it isn't a sensible meter. */
export function parseMeter(text) {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(String(text || ''));
  if (!m) return null;
  const num = Number(m[1]), den = Number(m[2]);
  if (num < 1 || num > 12 || ![2, 4, 8, 16].includes(den)) return null;
  return { num, den };
}

/**
 * Meter of a typed song from its bar lines ("|"). The usual bar length gives
 * the time signature (unless `meter` is given); a short first bar is a pickup.
 * @param {string} text  typed notation
 * @param {{num:number, den:number}} [meter] known time signature
 * @returns {{num:number, den:number, offset:number}|null}  null without bar lines
 */
export function meterFromText(text, meter) {
  const segments = String(text || '').split('|').map((s) => s.trim());
  // Where the first note is, in beats from the start of the text (leading
  // rests are dropped when the song is saved).
  const all = parseNotation(segments.join(' '), { bpm: 60 });
  const firstNote = all.notes.length ? all.notes[0].startTime : 0; // at 60 BPM, seconds = beats
  if (segments.length < 2) return meter ? { ...meter, offset: round4(mod(firstNote, barBeats(meter))) } : null;
  const lengths = segments.map((s) => parseNotation(s).beats);
  const inner = lengths.length > 2 ? lengths.slice(1, -1) : lengths;
  const counts = new Map();
  for (const l of inner) if (l > 0) counts.set(l, (counts.get(l) || 0) + 1);
  let bar = 0, best = 0;
  for (const [l, c] of counts) if (c > best || (c === best && l > bar)) { bar = l; best = c; }
  if (!meter) {
    if (!(bar > 0)) return null;
    meter = Number.isInteger(bar) ? { num: bar, den: 4 } : Number.isInteger(bar * 2) ? { num: bar * 2, den: 8 } : null;
    if (!meter || meter.num > 12) return null;
  }
  const len = barBeats(meter);
  const pickup = lengths[0] > 0 && lengths[0] < len - 1e-9 ? len - lengths[0] : 0;
  const offset = mod(firstNote + pickup, len);
  return { num: meter.num, den: meter.den, offset: round4(offset) };
}

/**
 * Pick the clef that needs the fewest ledger lines. High toy pianos usually
 * get a treble clef with an "8" (sounds an octave higher than written).
 * @param {number[]} midis
 * @returns {{clef:string, shift:number}} shift: semitones added to write a note
 */
export function chooseClef(midis) {
  const options = [
    { clef: 'treble', shift: 0, bottom: 64, top: 77, extra: 0 },
    { clef: 'treble+8', shift: -12, bottom: 64, top: 77, extra: 0.3 },
    { clef: 'bass', shift: 0, bottom: 43, top: 57, extra: 0.05 },
    { clef: 'bass-8', shift: 12, bottom: 43, top: 57, extra: 0.35 },
  ];
  let best = null;
  for (const o of options) {
    const lo = diatonic(o.bottom), hi = diatonic(o.top);
    let cost = 0;
    for (const m of midis) {
      const d = diatonic(m + o.shift);
      if (d > hi) cost += Math.floor((d - hi) / 2);
      else if (d < lo) cost += Math.floor((lo - d) / 2);
      cost += o.extra;
    }
    if (!best || cost < best.cost - 1e-9) best = { ...o, cost };
  }
  return { clef: best.clef, shift: best.shift };
}

/**
 * Build ABC notation for the timeline the player will play.
 * @param {object[]} events   buildTimeline() output ({key, start, end} in seconds)
 * @param {object} opts
 * @param {number} opts.bpm
 * @param {{num:number, den:number, offset?:number}} [opts.meter]
 * @param {number[]} opts.keyMidi   nominal MIDI note of each piano key (index = key)
 * @param {'keys'|'notes'|'none'} [opts.labels='keys']  text under each note
 * @param {boolean} [opts.legato]   close small gaps after notes (MIDI files often
 *                                  play notes a bit short; typed songs are exact)
 * @returns {{abc:string, chars:number[][], clef:string, approximate:boolean}}
 *   chars[i]: positions in `abc` of the symbols drawn for events[i] (a long
 *   note can be several tied symbols; the notes of a chord share theirs);
 *   empty if it couldn't be placed.
 *   approximate: many notes are off the sixteenth grid (a live recording), so
 *   the written rhythm is only a rough guide.
 */
export function buildSheet(events, opts) {
  const meter = opts.meter && opts.meter.num ? opts.meter : DEFAULT_METER;
  const labels = opts.labels || 'keys';
  const per16 = (opts.bpm / 60) * 4;
  const bar = Math.max(1, Math.round((meter.num * 16) / meter.den));
  const compound = meter.den === 8 && meter.num % 3 === 0; // 3/8, 6/8, 9/8, 12/8
  const group = compound ? 6 : meter.den === 2 ? 8 : 4;     // beam groups
  const beat = compound ? 2 : 4;                             // rests line up with these
  // Snap to the sixteenth grid, counted from the first bar line. Exact halves
  // round down, so a first note played a 32nd late doesn't push the whole
  // song a sixteenth off the beat.
  const offset16 = (meter.offset || 0) * 4;
  const grid = (sec) => Math.round(sec * per16 + offset16 - 1e-6);
  const start0 = grid(0);
  const midiOf = (ev) => Math.round(opts.keyMidi[ev.key]);
  const { clef, shift } = chooseClef(events.map(midiOf));

  // How many notes start well off the grid (live-recorded MIDI files).
  let offGrid = 0;
  for (const ev of events) {
    const x = ev.start * per16 + offset16;
    if (Math.abs(x - Math.round(x)) > 0.2) offGrid++;
  }

  // 1. Notes and rests on the sixteenth grid.
  const items = [];
  let cursor = start0;
  events.forEach((ev, i) => {
    let s = grid(ev.start);
    let e = grid(ev.end);
    if (e <= s) e = s + 1;
    const prev = items[items.length - 1];
    if (s < cursor) {
      if (!prev || prev.type !== 'note' || s < prev.pos) return;
      if (s === prev.pos) {
        // Starts with the previous note: a chord.
        const midi = midiOf(ev);
        prev.events.push(i);
        if (!prev.notes.some((n) => n.midi === midi)) prev.notes.push({ midi, label: labelFor(ev, midi, labels) });
        if (e - s > prev.len) { prev.len = e - s; cursor = e; }
        return;
      }
      prev.len = s - prev.pos; // overlapping (legato): shorten the previous note
      cursor = s;
    }
    let gap = s - cursor;
    if (gap > 0 && opts.legato && prev && prev.type === 'note') {
      // A note played a little short (common in MIDI files): close a small
      // gap, or before a real rest, let the note reach the next beat.
      const toBeat = (beat - ((cursor % bar) % beat)) % beat;
      if (gap < 4 && gap <= prev.len) { prev.len += gap; cursor += gap; gap = 0; }
      else if (toBeat > 0 && toBeat < gap && toBeat <= prev.len) { prev.len += toBeat; cursor += toBeat; gap -= toBeat; }
    }
    if (gap > 0) items.push({ type: 'rest', pos: cursor, len: gap });
    items.push({ type: 'note', pos: s, len: e - s, notes: [{ midi: midiOf(ev), label: labelFor(ev, midiOf(ev), labels) }], events: [i] });
    cursor = e;
  });

  // 2. Write them, split at bar lines and into writable note values. The
  //    labels of a chord stack up in lyric lines, top note first.
  const chars = events.map(() => []);
  const lines = Math.min(4, Math.max(1, ...items.map((it) => (it.notes ? it.notes.length : 0))));
  const words = Array.from({ length: lines }, () => []);
  let body = '';
  let acc = new Map();     // accidentals in force in this bar: step -> '#'|'n'
  let lastBeamable = false;
  let pos = start0;
  const atBarStart = () => pos % bar === 0;

  for (const it of items) {
    let left = it.len;
    let first = true;
    while (left > 0) {
      const barEnd = (Math.floor(pos / bar) + 1) * bar;
      const room = Math.min(left, barEnd - pos);
      const parts = it.type === 'rest' ? splitRest(pos % bar, room, compound) : splitValue(room);
      for (let p = 0; p < parts.length; p++) {
        const len = parts[p];
        const beamable = it.type === 'note' && len < 4;
        const sep = body === '' || atBarStart() || !beamable || !lastBeamable || pos % group === 0 ? ' ' : '';
        body += sep;
        if (it.type === 'rest') {
          body += 'z' + lenText(len);
        } else {
          for (const i of it.events) chars[i].push(body.length);
          body += chordText(it.notes, shift, first, acc) + lenText(len);
          const tiedOn = left - len > 0;
          if (tiedOn) body += '-';
          const top = [...it.notes].sort((a, b) => b.midi - a.midi);
          words.forEach((line, l) => line.push(first && top[l] ? top[l].label : '*'));
        }
        lastBeamable = beamable;
        first = false;
        pos += len;
        left -= len;
      }
      if (pos % bar === 0) {
        body += ' |';
        acc = new Map(); // accidentals last until the bar line
        lastBeamable = false;
      }
    }
  }
  body = body.replace(/\s*\|?\s*$/, '') + ' |]';

  const header = `X:1\nM:${meter.num}/${meter.den}\nL:1/16\nK:C clef=${clef}\n`;
  const lyrics = labels !== 'none' && words[0].length ? words.map((line) => 'w: ' + line.join(' ') + '\n').join('') : '';
  const abc = header + body.trim() + '\n' + lyrics;
  // chars were measured within body (after a leading trim of one space); shift to absolute.
  const lead = body.length - body.trimStart().length;
  const offset = header.length - lead;
  return {
    abc,
    chars: chars.map((c) => c.map((x) => x + offset)),
    clef,
    approximate: events.length > 0 && offGrid / events.length > 0.25,
  };
}

/** Split a length (sixteenths) into writable note values, longest first. */
export function splitValue(n) {
  const out = [];
  let left = n;
  while (left > 0) {
    const v = VALUES.find((x) => x <= left);
    out.push(v);
    left -= v;
  }
  return out;
}

/**
 * Split a rest so each part starts on a multiple of its own length within the
 * bar (a half rest on beat 1 or 3, never across the middle of a beat).
 * @param {number} rel  position in the bar (sixteenths)
 */
export function splitRest(rel, n, compound = false) {
  const values = compound ? [12, 8, 6, 4, 2, 1] : [16, 8, 4, 2, 1];
  const out = [];
  let left = n;
  while (left > 0) {
    const v = values.find((x) => x <= left && rel % x === 0);
    out.push(v);
    rel += v;
    left -= v;
  }
  return out;
}

function lenText(len) {
  return len === 1 ? '' : String(len);
}

/** One note, or a chord of notes low to high: [CEG]. */
function chordText(notes, shift, first, acc) {
  if (notes.length === 1) return pitchText(notes[0].midi, shift, first, acc);
  const low = [...notes].sort((a, b) => a.midi - b.midi);
  return '[' + low.map((n) => pitchText(n.midi, shift, first, acc)).join('') + ']';
}

/** ABC pitch with an accidental only where the bar needs one. */
function pitchText(midi, shift, first, acc) {
  const m = midi + shift;
  const name = SHARP_NAMES[mod(m, 12)];
  const sharp = name.startsWith('^');
  const letter = sharp ? name[1] : name;
  const octave = Math.floor(m / 12) - 1;
  const step = letter + octave;
  let prefix = '';
  if (first) {
    const want = sharp ? '#' : 'n';
    if ((acc.get(step) || 'n') !== want) prefix = sharp ? '^' : '=';
    acc.set(step, want);
  }
  let text = octave >= 5 ? letter.toLowerCase() + "'".repeat(octave - 5) : letter + ','.repeat(Math.max(0, 4 - octave));
  return prefix + text;
}

function labelFor(ev, midi, labels) {
  if (labels === 'notes') return LABEL_NAMES[mod(midi, 12)] + (Math.floor(midi / 12) - 1);
  return String(ev.key + 1);
}

function diatonic(midi) {
  const name = SHARP_NAMES[mod(midi, 12)];
  const letter = name.startsWith('^') ? name[1] : name;
  return (Math.floor(midi / 12) - 1) * 7 + LETTER_STEP[letter];
}

function mod(a, n) {
  return ((a % n) + n) % n;
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}
