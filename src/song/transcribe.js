// Audio -> notes with Basic Pitch (Spotify, Apache-2.0): a small neural
// network that finds the notes in a recording, run in the browser with
// TensorFlow.js. The code (0.2 MB compressed) and the model (0.9 MB) load the
// first time a recording is converted, and are then cached for offline use.

export const SAMPLE_RATE = 22050; // what the model expects
export const MAX_SECONDS = 300;

// How strict note finding is: onset = how clearly a note must start,
// frame = how loud it must stay. Lower finds more (and more wrong) notes.
export const DETAIL = {
  fewer: { onset: 0.6, frame: 0.4 },
  normal: { onset: 0.5, frame: 0.3 },
  more: { onset: 0.35, frame: 0.25 },
};
const MIN_NOTE_FRAMES = 8; // about 90 ms (the model gives 86 frames a second)

let loading = null;

function loadModel(source) {
  loading ||= (async () => {
    const [bp, tf] = await Promise.all([import('@spotify/basic-pitch'), import('./tf.js')]);
    await tf.ready(); // the graphics card if WebGL works, else the CPU
    const model = await tf.loadGraphModel(source || new URL('models/basic-pitch/model.json', document.baseURI).href);
    return { bp, basicPitch: new bp.BasicPitch(Promise.resolve(model)), backend: tf.getBackend() };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/**
 * Run the model over a recording.
 * @param {Float32Array} samples  mono audio at SAMPLE_RATE
 * @param {object} [o]
 * @param {(p:{stage:'loading'|'converting', fraction?:number, backend?:string})=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @param {object} [o.modelSource]  a TensorFlow.js IOHandler instead of the bundled model URL (tests)
 * @returns {Promise<{notes:(detail:string)=>object[], backend:string}>}
 *   notes(detail): [{ midi, startTime, duration, amplitude }] in seconds
 */
export async function transcribe(samples, { onProgress, signal, modelSource } = {}) {
  onProgress && onProgress({ stage: 'loading' });
  let engine;
  try {
    engine = await loadModel(modelSource);
  } catch {
    throw new Error('The note finder couldn’t load. Converting audio needs an internet connection the first time.');
  }
  if (signal && signal.aborted) throw abortError();
  const { bp, basicPitch, backend } = engine;
  const frames = [], onsets = [];
  await basicPitch.evaluateModel(
    samples,
    (f, o) => { frames.push(...f); onsets.push(...o); },
    (fraction) => {
      if (signal && signal.aborted) throw abortError();
      onProgress && onProgress({ stage: 'converting', fraction, backend });
    },
  );
  return {
    backend,
    notes(detail = 'normal') {
      const d = DETAIL[detail] || DETAIL.normal;
      const found = bp.noteFramesToTime(bp.outputToNotesPoly(frames, onsets, d.onset, d.frame, MIN_NOTE_FRAMES));
      return tidyNotes(found.map((n) => ({
        midi: n.pitchMidi, startTime: n.startTimeSeconds, duration: n.durationSeconds, amplitude: n.amplitude,
      })));
    },
  };
}

/**
 * Clean up what the note finder reports:
 * - drop ghost notes on a harmonic of a louder note (dropOvertones),
 * - drop the short, quieter blip it sometimes reports as a note dies away
 *   (same pitch, starting right where the note ends),
 * - end notes a little earlier: the found ends include the note's release,
 *   which overlaps the next note.
 * @returns notes sorted by start time
 */
export function tidyNotes(notes) {
  const s = dropOvertones(notes);
  const kept = s.filter((n) => !(n.duration < 0.2 && s.some((m) => m !== n && m.midi === n.midi
    && Math.abs(m.startTime + m.duration - n.startTime) <= 0.03 && (m.amplitude ?? 1) > (n.amplitude ?? 1))));
  return kept.map((n) => ({ ...n, duration: Math.max(0.6 * n.duration, n.duration - 0.06) }));
}

// Semitones from a note up to its 2nd–8th harmonics.
const HARMONICS = [12, 19, 24, 28, 31, 34, 36];

/**
 * The note finder sometimes reports a strong harmonic of a note as a note of
 * its own (a ghost an octave or a twelfth up). Drop notes that sit on a
 * harmonic of a much louder note sounding when they start.
 * @returns notes sorted by start time
 */
export function dropOvertones(notes, { ratio = 0.7 } = {}) {
  const s = [...notes].sort((a, b) => a.startTime - b.startTime || b.midi - a.midi);
  return s.filter((n) => !s.some((m) => m !== n
    && HARMONICS.includes(n.midi - m.midi)
    && m.startTime <= n.startTime + 0.1
    && m.startTime + m.duration >= n.startTime + 0.05
    && (n.amplitude ?? 1) < ratio * (m.amplitude ?? 1)));
}

function abortError() {
  return new DOMException('Cancelled', 'AbortError');
}
