import { describe, it, expect } from 'vitest';
import { parseNotation } from '../src/song/notation.js';

const simple = (notes) => notes.map((n) => [n.midi, +n.startTime.toFixed(4), +n.duration.toFixed(4)]);

describe('parseNotation', () => {
  it('parses the example from the spec at 60 BPM (1 beat = 1 s)', () => {
    const { notes, errors, beats } = parseNotation('C4 D4 E4 C4/2 G4', { bpm: 60 });
    expect(errors).toEqual([]);
    expect(simple(notes)).toEqual([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 1],
      [60, 3, 2],
      [67, 5, 1],
    ]);
    expect(beats).toBe(6);
  });

  it('converts beats to seconds with the tempo', () => {
    const { notes } = parseNotation('A4 A4/2', { bpm: 120 });
    expect(simple(notes)).toEqual([[69, 0, 0.5], [69, 0.5, 1]]);
  });

  it('defaults to 100 BPM', () => {
    expect(parseNotation('C4').notes[0].duration).toBeCloseTo(0.6, 6);
  });

  it('handles whole, eighth, sixteenth and dotted values', () => {
    const { notes, errors } = parseNotation('C4/1 D4/8 E4/16 F4/4. G4/2.', { bpm: 60 });
    expect(errors).toEqual([]);
    expect(notes.map((n) => n.duration)).toEqual([4, 0.5, 0.25, 1.5, 3]);
    expect(notes.map((n) => n.startTime)).toEqual([0, 4, 4.5, 4.75, 6.25]);
  });

  it('supports rests that take time but make no note', () => {
    const { notes } = parseNotation('C4 R D4 r/2 E4 -/8 F4', { bpm: 60 });
    expect(simple(notes)).toEqual([[60, 0, 1], [62, 2, 1], [64, 5, 1], [65, 6.5, 1]]);
  });

  it('accepts sharps, flats, lowercase and capitalised flats', () => {
    const { notes, errors } = parseNotation('C#4 Db4 bb3 EB4 f#5 B♭4');
    expect(errors).toEqual([]);
    expect(notes.map((n) => n.midi)).toEqual([61, 61, 58, 63, 78, 70]);
  });

  it('ignores bar lines, commas and extra whitespace', () => {
    const { notes, errors } = parseNotation('  C4, D4 |\n E4\t| F4 ||');
    expect(errors).toEqual([]);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64, 65]);
  });

  it('reports bad tokens with their position and keeps the rest', () => {
    const { notes, errors } = parseNotation('C4 H4 D E4/ F4/0');
    expect(notes.map((n) => n.midi)).toEqual([60]);
    expect(errors.map((e) => [e.index, e.token])).toEqual([[1, 'H4'], [2, 'D'], [3, 'E4/'], [4, 'F4/0']]);
    expect(errors[0].message).toMatch(/not a note/i);
    expect(errors[1].message).toMatch(/octave/i);
    expect(errors[2].message).toMatch(/note value/i);
  });

  it('returns nothing for empty input', () => {
    expect(parseNotation('   ')).toEqual({ notes: [], errors: [], beats: 0 });
  });
});
