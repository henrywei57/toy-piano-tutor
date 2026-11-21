import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as tf from '../src/song/tf.js';
import { transcribe, dropOvertones, tidyNotes, SAMPLE_RATE } from '../src/song/transcribe.js';
import { parseNotation } from '../src/song/notation.js';
import { melodyOnly, normalizeNotes } from '../src/song/melody.js';
import { estimateTempo } from '../src/song/tempo.js';
import { midiToFreq } from '../src/audio/notes.js';

const n = (midi, startTime, duration, amplitude) => ({ midi, startTime, duration, amplitude });

describe('dropOvertones', () => {
  it('drops a quiet note on a harmonic of a louder one', () => {
    const out = dropOvertones([n(67, 1.2, 0.6, 0.8), n(86, 1.21, 1.1, 0.35), n(79, 1.2, 0.5, 0.3)]);
    expect(out.map((x) => x.midi)).toEqual([67]); // the twelfth (86) and the octave (79) were ghosts
  });

  it('keeps real notes: loud ones, other intervals, and notes at other times', () => {
    const out = dropOvertones([
      n(64, 0, 1, 0.6), n(76, 0, 1, 0.8),   // octave above, louder: a real note
      n(60, 2, 1, 0.8), n(64, 2, 1, 0.4),   // a third: not a harmonic
      n(60, 4, 0.5, 0.8), n(72, 5, 1, 0.3), // an octave, but later
    ]);
    expect(out).toHaveLength(6);
  });
});

describe('tidyNotes', () => {
  it('drops the blip as a note dies away, and ends notes before their release', () => {
    const out = tidyNotes([n(67, 0.3, 0.49, 0.81), n(67, 0.79, 0.13, 0.61), n(72, 0.8, 0.6, 0.77)]);
    expect(out.map((x) => x.midi)).toEqual([67, 72]);
    expect(out[0].duration).toBeCloseTo(0.43, 5);
  });

  it('keeps a repeated note', () => {
    expect(tidyNotes([n(60, 0, 0.5, 0.8), n(60, 0.5, 0.5, 0.8)])).toHaveLength(2);
  });
});

// A recording of a melody: tones with harmonics, a soft attack and release.
function render(notes) {
  const end = Math.max(...notes.map((x) => x.startTime + x.duration)) + 0.8;
  const out = new Float32Array(Math.ceil(end * SAMPLE_RATE));
  for (const x of notes) {
    const f = midiToFreq(x.midi);
    const i0 = Math.round((x.startTime + 0.3) * SAMPLE_RATE);
    const len = Math.round((x.duration + 0.15) * SAMPLE_RATE);
    for (let i = 0; i < len && i0 + i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, t / 0.01) * Math.exp(-t / 0.6) * (t < x.duration ? 1 : Math.exp(-(t - x.duration) / 0.04));
      out[i0 + i] += 0.3 * env * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.15 * Math.sin(6 * Math.PI * f * t));
    }
  }
  return out;
}

function bundledModel() {
  const json = JSON.parse(fs.readFileSync('public/models/basic-pitch/model.json', 'utf8'));
  const bin = fs.readFileSync('public/models/basic-pitch/group1-shard1of1.bin');
  return tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest[0].weights,
    weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    format: json.format,
    generatedBy: json.generatedBy,
    convertedBy: json.convertedBy,
    signature: json.signature,
    userDefinedMetadata: json.userDefinedMetadata,
  });
}

describe('transcribe (the real model, on the CPU)', () => {
  it('writes down the notes of a recorded melody', async () => {
    await tf.setBackend('cpu');
    const truth = parseNotation('G4 C5 E5 G5 E5/8 D5/8 C5/2', { bpm: 120 }).notes;
    const progress = [];
    const result = await transcribe(render(truth), { modelSource: bundledModel(), onProgress: (p) => progress.push(p.stage) });
    expect(progress).toContain('converting');
    const notes = normalizeNotes(melodyOnly(result.notes('normal')));
    expect(notes.map((x) => x.midi)).toEqual(truth.map((x) => x.midi));
    notes.forEach((x, i) => expect(Math.abs(x.startTime - truth[i].startTime)).toBeLessThan(0.06));
    expect(Math.abs(estimateTempo(notes).bpm - 120)).toBeLessThanOrEqual(3);
  }, 90000);
});
