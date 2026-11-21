import { describe, it, expect } from 'vitest';
import { Midi } from '@tonejs/midi';
import { isPolyphonic, melodyOnly, normalizeNotes, noteStats, formatRange } from '../src/song/melody.js';
import { parseMidi } from '../src/song/midi.js';
import * as songs from '../src/song/songStore.js';

const n = (midi, startTime, duration) => ({ midi, startTime, duration });

describe('melody helpers', () => {
  it('detects polyphony but tolerates small legato overlaps', () => {
    expect(isPolyphonic([n(60, 0, 1), n(62, 1, 1), n(64, 2, 1)])).toBe(false);
    expect(isPolyphonic([n(60, 0, 1.1), n(62, 1, 1)])).toBe(false); // 0.1 s overlap = legato
    expect(isPolyphonic([n(60, 0, 1), n(64, 0, 1)])).toBe(true);    // chord
    expect(isPolyphonic([n(48, 0, 4), n(72, 1, 1)])).toBe(true);    // held bass under a melody
  });

  it('keeps the highest note of each chord', () => {
    const out = melodyOnly([n(60, 0, 1), n(64, 0, 1), n(67, 0.01, 1), n(62, 1, 1), n(65, 1, 1)]);
    expect(out.map((x) => x.midi)).toEqual([67, 65]);
    expect(out[0].startTime).toBe(0);
  });

  it('drops lower notes that start under a held higher note and stays monophonic', () => {
    // melody 72 held for 2 s, accompaniment 60 and 64 underneath, then melody 74
    const out = melodyOnly([n(72, 0, 2), n(60, 0.5, 0.5), n(64, 1, 0.5), n(74, 2, 1)]);
    expect(out.map((x) => [x.midi, x.startTime, x.duration])).toEqual([[72, 0, 2], [74, 2, 1]]);
    expect(isPolyphonic(out)).toBe(false);
  });

  it('cuts a note short when a higher one starts before it ends', () => {
    const out = melodyOnly([n(60, 0, 2), n(67, 1, 1)]);
    expect(out.map((x) => [x.midi, x.startTime, x.duration])).toEqual([[60, 0, 1], [67, 1, 1]]);
  });

  it('keeps a melody that steps down with a small legato overlap', () => {
    const out = melodyOnly([n(62, 0, 0.64), n(60, 0.6, 1), n(52, 0.9, 0.5)]);
    expect(out.map((x) => [x.midi, x.startTime])).toEqual([[62, 0], [60, 0.6]]);
  });

  it('normalises: sorts, drops empty notes, shifts to start at 0', () => {
    const out = normalizeNotes([n(64, 3, 1), n(62, 2.5, 0), n(60, 2, 0.5)]);
    expect(out).toEqual([n(60, 0, 0.5), n(64, 1, 1)]);
  });

  it('keeps back-to-back notes exactly adjacent after rounding', () => {
    const beat = 60 / 110;
    const out = normalizeNotes([0, 1, 2, 3].map((i) => n(60 + i, i * beat, beat)));
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].startTime + out[i - 1].duration).toBeCloseTo(out[i].startTime, 9);
    }
  });

  it('reports count, range and length', () => {
    const st = noteStats([n(60, 0, 1), n(79, 1, 2), n(67, 0.5, 0.5)]);
    expect(st).toMatchObject({ count: 3, min: 60, max: 79, minName: 'C4', maxName: 'G5', semitones: 19, seconds: 3 });
    expect(formatRange(st)).toBe('C4–G5 (19 semitones)');
  });
});

function buildMidi() {
  const midi = new Midi();
  midi.name = 'Test Song';
  midi.header.setTempo(90);
  const melody = midi.addTrack();
  melody.name = 'Melody';
  melody.channel = 0;
  [72, 74, 76, 77, 79].forEach((m, i) => melody.addNote({ midi: m, time: i * 0.5, duration: 0.5 }));
  const chords = midi.addTrack();
  chords.name = 'Chords';
  chords.channel = 1;
  for (let i = 0; i < 6; i++) {
    for (const m of [48, 52, 55]) chords.addNote({ midi: m, time: i * 0.5, duration: 0.5 });
  }
  const drums = midi.addTrack();
  drums.name = 'Drums';
  drums.channel = 9;
  for (let i = 0; i < 8; i++) drums.addNote({ midi: 36, time: i * 0.25, duration: 0.1 });
  midi.addTrack(); // empty track
  return midi.toArray();
}

describe('parseMidi', () => {
  const parsed = parseMidi(buildMidi());

  it('lists tracks with notes, range and polyphony', () => {
    expect(parsed.name).toBe('Test Song');
    expect(parsed.bpm).toBeCloseTo(90, 1);
    expect(parsed.tracks.map((t) => t.name)).toEqual(['Melody', 'Chords', 'Drums']);
    const [mel, ch, dr] = parsed.tracks;
    expect(mel).toMatchObject({ polyphonic: false, percussion: false });
    expect(mel.stats).toMatchObject({ count: 5, minName: 'C5', maxName: 'G5' });
    expect(ch).toMatchObject({ polyphonic: true, percussion: false });
    expect(ch.stats.count).toBe(18);
    expect(dr.percussion).toBe(true);
  });

  it('suggests the melody track, not the busier accompaniment or drums', () => {
    expect(parsed.tracks[parsed.suggested].name).toBe('Melody');
  });

  it('reduces a chord track to one note per chord', () => {
    const out = melodyOnly(parsed.tracks[1].notes);
    expect(out).toHaveLength(6);
    expect(out.every((x) => x.midi === 55)).toBe(true);
  });

  it('rejects files that are not MIDI', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow(/MIDI/);
  });
});

describe('song store', () => {
  it('saves, activates and deletes songs', () => {
    const m = new Map();
    songs.useSongStorage({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) });
    const a = songs.addSong({ name: 'A', source: 'text', bpm: 100, notes: [n(60, 1, 0.5), n(62, 1.5, 0.5)] });
    expect(songs.getActiveSongId()).toBe(a.id);
    expect(songs.getSong(a.id).notes[0]).toEqual(n(60, 0, 0.5));
    const b = songs.addSong({ name: 'B', source: 'midi', bpm: 90, notes: [n(70, 0, 1)] });
    expect(songs.getActiveSongId()).toBe(b.id);
    songs.deleteSong(b.id);
    expect(songs.getActiveSongId()).toBeNull();
    expect(songs.listSongs().map((s) => s.name)).toEqual(['A']);
    expect(() => songs.addSong({ name: 'empty', source: 'text', notes: [] })).toThrow(/no notes/);
  });
});
