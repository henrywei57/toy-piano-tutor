// Tempo of a recorded song, guessed from when its notes start.
//
// For each candidate tempo, the note starts are placed on a circle (one turn
// per beat). If they bunch up, the notes fall on that beat. This is measured
// over short windows (people speed up and slow down) and averaged. Double and
// half tempos fit as well, so moderate tempos are preferred; the user can
// halve or double the guess.

/**
 * @param {{startTime:number, amplitude?:number}[]} notes  times in seconds
 * @param {object} [o]
 * @param {number} [o.min=50]
 * @param {number} [o.max=200]
 * @returns {{bpm:number, offset:number, confidence:number}}
 *   offset: how far into a beat the first note starts (0–1), for the bar lines
 */
export function estimateTempo(notes, { min = 50, max = 200 } = {}) {
  const onsets = mergeOnsets(notes);
  if (onsets.length < 4) return { bpm: 100, offset: 0, confidence: 0 };
  const end = onsets[onsets.length - 1].t;
  const WINDOW = 8, HOP = 4;
  const windows = [];
  for (let from = 0; from === 0 || from + WINDOW / 2 < end; from += HOP) {
    const w = onsets.filter((o) => o.t >= from && o.t < from + WINDOW);
    if (w.length >= 3) windows.push(w);
  }
  if (!windows.length) windows.push(onsets);

  let best = { bpm: 100, score: -1, fit: 0 };
  for (let bpm = min; bpm <= max + 1e-9; bpm += 0.5) {
    const spb = 60 / bpm;
    let fit = 0;
    for (const w of windows) fit += coherence(w, spb).r;
    fit /= windows.length;
    const score = fit * prior(bpm);
    if (score > best.score) best = { bpm, score, fit };
  }
  // Where the beats fall, from the start of the song.
  const { phase } = coherence(windows[0], 60 / best.bpm);
  const first = onsets[0].t;
  let offset = mod(first / (60 / best.bpm) - phase, 1);
  if (offset > 1 - 1 / 16) offset = 0; // a hair before the beat: on it
  return { bpm: best.bpm, offset: Math.round(offset * 1000) / 1000, confidence: Math.round(best.fit * 100) / 100 };
}

/** How tightly the onsets bunch on a beat of `spb` seconds: r 0–1, phase in beats. */
function coherence(onsets, spb) {
  let re = 0, im = 0, total = 0;
  for (const o of onsets) {
    const a = (2 * Math.PI * o.t) / spb;
    re += o.w * Math.cos(a);
    im += o.w * Math.sin(a);
    total += o.w;
  }
  return { r: total ? Math.hypot(re, im) / total : 0, phase: mod(Math.atan2(im, re) / (2 * Math.PI), 1) };
}

// Prefer tempos around 100 BPM (a log-normal bump, about an octave wide).
function prior(bpm) {
  const x = Math.log2(bpm / 100) / 0.8;
  return Math.exp(-0.5 * x * x);
}

/** Note starts, with chords (starts within 50 ms) merged into one onset. */
function mergeOnsets(notes) {
  const s = [...notes].sort((a, b) => a.startTime - b.startTime);
  const out = [];
  for (const n of s) {
    const w = n.amplitude > 0 ? n.amplitude : 1;
    const last = out[out.length - 1];
    if (last && n.startTime - last.t < 0.05) last.w = Math.max(last.w, w);
    else out.push({ t: n.startTime, w });
  }
  return out;
}

function mod(a, n) {
  return ((a % n) + n) % n;
}
