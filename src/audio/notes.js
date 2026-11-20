// Note / frequency helpers. Equal temperament, A4 = 440 Hz, MIDI 69 = A4.

export const A4 = 440;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function midiToFreq(midi) {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

/** Fractional MIDI number for a frequency (69.5 = a quarter tone above A4). */
export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / A4);
}

/** Signed distance in cents from freq `b` to freq `a`. */
export function centsBetween(a, b) {
  return 1200 * Math.log2(a / b);
}

export function midiToName(midi) {
  const m = Math.round(midi);
  return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

/** Nearest equal-tempered note for a frequency: { midi, name, cents }. */
export function freqToNote(freq) {
  const exact = freqToMidi(freq);
  const midi = Math.round(exact);
  return { midi, name: midiToName(midi), cents: (exact - midi) * 100 };
}

/**
 * Parse a note name like "C4", "F#5", "Bb3", "c#4" into a MIDI number.
 * Returns null if it isn't a note name.
 */
export function noteNameToMidi(text) {
  const m = /^\s*([A-Ga-g])([#b♯♭]{0,2})(-?\d)\s*$/.exec(text);
  if (!m) return null;
  let pc = PITCH_CLASS[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

/**
 * Parse a manual frequency entry. Accepts a plain number of Hz ("523.4",
 * "523.4 Hz") or a note name with optional cents ("C5", "C5+15", "Bb4-20").
 * Returns a frequency in Hz, or null if the text can't be understood.
 */
export function parseFreqOrNote(text) {
  const t = String(text).trim();
  const hz = /^(\d+(?:\.\d+)?)\s*(?:hz)?$/i.exec(t);
  if (hz) {
    const f = parseFloat(hz[1]);
    return f >= 20 && f <= 20000 ? f : null;
  }
  const withCents = /^([A-Ga-g][#b♯♭]{0,2}-?\d)\s*(?:([+-]\s*\d+(?:\.\d+)?)\s*(?:c|¢|cents?)?)?$/i.exec(t);
  if (!withCents) return null;
  const midi = noteNameToMidi(withCents[1]);
  if (midi == null) return null;
  const cents = withCents[2] ? parseFloat(withCents[2].replace(/\s/g, '')) : 0;
  return midiToFreq(midi + cents / 100);
}

/** "C5 +12¢" style label. */
export function formatCents(cents) {
  const c = Math.round(cents);
  if (c === 0) return '±0¢';
  return (c > 0 ? '+' : '−') + Math.abs(c) + '¢';
}

export function formatHz(freq) {
  return freq >= 1000 ? freq.toFixed(0) : freq.toFixed(1);
}
