// MIDI file import via @tonejs/midi. Lists the tracks so the user can pick
// the melody, with note count, range and whether the track is polyphonic.

import { Midi } from '@tonejs/midi';
import { isPolyphonic, noteStats } from './melody.js';

/**
 * @param {ArrayBuffer|Uint8Array} data  contents of a .mid file
 * @returns {{name:string, bpm:number, tracks:object[], suggested:number}}
 *   tracks: [{ index, name, instrument, channel, percussion, notes, stats, polyphonic }]
 *   suggested: index into tracks of the likely melody track (-1 if none)
 */
export function parseMidi(data) {
  let midi;
  try {
    midi = new Midi(data);
  } catch {
    throw new Error('That doesn’t look like a valid MIDI file.');
  }

  const tracks = midi.tracks
    .map((t, i) => {
      const notes = t.notes.map((n) => ({ midi: n.midi, startTime: n.time, duration: n.duration }));
      return {
        index: i,
        name: (t.name || '').trim() || `Track ${i + 1}`,
        instrument: t.instrument ? t.instrument.name : '',
        channel: t.channel,
        percussion: Boolean(t.instrument && t.instrument.percussion) || t.channel === 9,
        notes,
        stats: noteStats(notes),
        polyphonic: isPolyphonic(notes),
      };
    })
    .filter((t) => t.notes.length > 0);

  if (!tracks.length) throw new Error('No notes found in that MIDI file.');

  const bpm = midi.header.tempos.length ? Math.round(midi.header.tempos[0].bpm * 100) / 100 : 120;
  return { name: (midi.name || '').trim(), bpm, tracks, suggested: suggestMelodyTrack(tracks) };
}

/**
 * Guess the melody: among pitched tracks with a reasonable number of notes
 * (at least 20% of the busiest one), pick the one with the highest median pitch.
 */
export function suggestMelodyTrack(tracks) {
  const pitched = tracks.map((t, i) => ({ t, i })).filter(({ t }) => !t.percussion);
  if (!pitched.length) return -1;
  const most = Math.max(...pitched.map(({ t }) => t.notes.length));
  let best = -1, bestPitch = -Infinity;
  for (const { t, i } of pitched) {
    if (t.notes.length < 0.2 * most) continue;
    const sorted = t.notes.map((n) => n.midi).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (median > bestPitch) { bestPitch = median; best = i; }
  }
  return best;
}
