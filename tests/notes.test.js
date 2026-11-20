import { describe, it, expect } from 'vitest';
import {
  midiToFreq, freqToMidi, freqToNote, midiToName, noteNameToMidi, parseFreqOrNote, centsBetween,
} from '../src/audio/notes.js';

describe('notes', () => {
  it('converts between MIDI and frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
    expect(freqToMidi(880)).toBeCloseTo(81, 6);
  });

  it('names notes', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(61)).toBe('C#4');
    expect(midiToName(71)).toBe('B4');
    expect(midiToName(72)).toBe('C5');
  });

  it('finds the nearest note and cents offset', () => {
    const n = freqToNote(440 * Math.pow(2, 30 / 1200));
    expect(n.name).toBe('A4');
    expect(n.cents).toBeCloseTo(30, 6);
    const m = freqToNote(440 * Math.pow(2, -70 / 1200));
    expect(m.name).toBe('G#4');
    expect(m.cents).toBeCloseTo(30, 6);
  });

  it('parses note names', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('c#4')).toBe(61);
    expect(noteNameToMidi('Bb3')).toBe(58);
    expect(noteNameToMidi('B#3')).toBe(60);
    expect(noteNameToMidi('H4')).toBeNull();
  });

  it('parses manual frequency / note entries', () => {
    expect(parseFreqOrNote('523.4')).toBeCloseTo(523.4, 6);
    expect(parseFreqOrNote('523.4 Hz')).toBeCloseTo(523.4, 6);
    expect(parseFreqOrNote('A4')).toBeCloseTo(440, 6);
    expect(centsBetween(parseFreqOrNote('A4+20'), 440)).toBeCloseTo(20, 6);
    expect(centsBetween(parseFreqOrNote('A4 -15¢'), 440)).toBeCloseTo(-15, 6);
    expect(parseFreqOrNote('nonsense')).toBeNull();
    expect(parseFreqOrNote('5')).toBeNull();
  });
});
