import { describe, it, expect } from 'vitest';
import { buildSheet, chooseClef, meterFromText, parseMeter, splitValue, barBeats } from '../src/song/sheet.js';
import { LIBRARY } from '../src/song/library.js';

// A plain piano: key i plays MIDI note keyMidi[i]. C4 D4 E4 F4 F#4 G4 A4 B4 C5
const keyMidi = [60, 62, 64, 65, 66, 67, 69, 71, 72];
const K = { C4: 0, D4: 1, E4: 2, F4: 3, 'F#4': 4, G4: 5, A4: 6, B4: 7, C5: 8 };

/** events from [note, beats] pairs at 60 BPM (1 s per beat); 'R' = rest */
function ev(...pairs) {
  let t = 0;
  const out = [];
  for (const [n, beats] of pairs) {
    if (n !== 'R') out.push({ key: K[n], start: t, end: t + beats });
    t += beats;
  }
  return out;
}

const body = (abc) => abc.split('\n')[4];
const words = (abc) => (abc.split('\n').find((l) => l.startsWith('w: ')) || '').slice(3);

describe('note values', () => {
  it('splits lengths into notes that can be written', () => {
    expect(splitValue(4)).toEqual([4]);
    expect(splitValue(5)).toEqual([4, 1]);
    expect(splitValue(7)).toEqual([6, 1]);
    expect(splitValue(20)).toEqual([16, 4]);
  });

  it('parses time signatures', () => {
    expect(parseMeter('3/4')).toEqual({ num: 3, den: 4 });
    expect(parseMeter(' 6 / 8 ')).toEqual({ num: 6, den: 8 });
    expect(parseMeter('3/5')).toBeNull();
    expect(parseMeter('waltz')).toBeNull();
    expect(barBeats({ num: 6, den: 8 })).toBe(3);
  });
});

describe('meterFromText', () => {
  it('reads the time signature and pickup from bar lines', () => {
    expect(meterFromText('C4 D4 E4 F4 | G4/1')).toEqual({ num: 4, den: 4, offset: 0 });
    expect(meterFromText('G4 | C5 C5 C5 | D5/2.')).toEqual({ num: 3, den: 4, offset: 2 });
    expect(meterFromText('E5/16 D5/16 | E5/8 E5/8 E5/8 | A4/4.')).toEqual({ num: 3, den: 8, offset: 1 });
  });

  it('accounts for a leading rest, and has no meter without bar lines', () => {
    expect(meterFromText('R C4 D4 E4 | F4 G4 A4 B4 | C5/1')).toEqual({ num: 4, den: 4, offset: 1 });
    expect(meterFromText('C4 D4 E4')).toBeNull();
    expect(meterFromText('R/2 C4 D4', { num: 4, den: 4 })).toEqual({ num: 4, den: 4, offset: 2 });
  });

  it('gives the built-in songs their real meters and pickups', () => {
    const m = Object.fromEntries(LIBRARY.map((s) => [s.id, s.meter]));
    expect(m['lib-happy-birthday']).toEqual({ num: 3, den: 4, offset: 2 });
    expect(m['lib-fur-elise']).toEqual({ num: 3, den: 8, offset: 1 });
    expect(m['lib-row-your-boat']).toEqual({ num: 6, den: 8, offset: 0 });
    expect(m['lib-twinkle']).toEqual({ num: 4, den: 4, offset: 0 });
    expect(m['lib-we-wish-you']).toEqual({ num: 3, den: 4, offset: 2 });
    expect(m['lib-good-king-wenceslas']).toEqual({ num: 4, den: 4, offset: 0 });
    expect(m['lib-silent-night']).toEqual({ num: 6, den: 8, offset: 0 });
    expect(m['lib-away-in-a-manger']).toEqual({ num: 3, den: 4, offset: 2 });
    expect(m['lib-o-christmas-tree']).toEqual({ num: 3, den: 4, offset: 2 });
    expect(m['lib-first-noel']).toEqual({ num: 3, den: 4, offset: 2 });
    expect(m['lib-o-come-all-ye-faithful']).toEqual({ num: 4, den: 4, offset: 3 });
    expect(m['lib-joy-to-the-world']).toEqual({ num: 2, den: 4, offset: 0 });
  });
});

describe('chooseClef', () => {
  it('uses treble for the middle of the piano', () => {
    expect(chooseClef([60, 64, 67, 72, 76])).toEqual({ clef: 'treble', shift: 0 });
  });
  it('uses an octave treble clef for a high toy piano (C5–C7)', () => {
    expect(chooseClef([72, 76, 79, 84, 88, 91, 96])).toEqual({ clef: 'treble+8', shift: -12 });
  });
  it('uses bass for low notes', () => {
    expect(chooseClef([40, 43, 48, 52, 55]).clef).toBe('bass');
  });
});

describe('buildSheet', () => {
  const opts = { bpm: 60, keyMidi };

  it('writes notes, bars and key numbers under the notes', () => {
    const { abc, clef } = buildSheet(ev(['C4', 1], ['D4', 1], ['E4', 1], ['F4', 1], ['G4', 4]), opts);
    expect(clef).toBe('treble');
    expect(abc).toContain('M:4/4\nL:1/16\nK:C clef=treble\n');
    expect(body(abc)).toBe('C4 D4 E4 F4 | G16 |]');
    expect(words(abc)).toBe('1 2 3 4 6');
  });

  it('writes rests for gaps and note names when asked', () => {
    const { abc } = buildSheet(ev(['C4', 1], ['R', 1], ['E4', 2]), { ...opts, labels: 'notes' });
    expect(body(abc)).toBe('C4 z4 E8 |]');
    expect(words(abc)).toBe('C4 E4');
  });

  it('ties a note across the bar line', () => {
    const { abc, chars } = buildSheet(ev(['C4', 3], ['D4', 2], ['E4', 3]), opts);
    expect(body(abc)).toBe('C12 D4- | D4 E12 |]');
    expect(words(abc)).toBe('1 2 * 3');
    expect(chars[1]).toHaveLength(2); // two symbols for the tied note
    expect(abc.slice(chars[1][0], chars[1][0] + 2)).toBe('D4');
    expect(abc.slice(chars[1][1], chars[1][1] + 2)).toBe('D4');
  });

  it('shows sharps once per bar and naturals when needed', () => {
    const { abc } = buildSheet(ev(['F#4', 1], ['F#4', 1], ['F4', 1], ['F#4', 1], ['F#4', 4]), opts);
    expect(body(abc)).toBe('^F4 F4 =F4 ^F4 | ^F16 |]');
  });

  it('beams eighth notes by the beat', () => {
    const { abc } = buildSheet(ev(['C4', 0.5], ['D4', 0.5], ['E4', 0.5], ['F4', 0.5], ['G4', 2]), opts);
    expect(body(abc)).toBe('C2D2 E2F2 G8 |]');
    const six = buildSheet(ev(['C4', 0.5], ['D4', 0.5], ['E4', 0.5], ['F4', 0.5], ['G4', 0.5], ['A4', 0.5]), { ...opts, meter: { num: 6, den: 8, offset: 0 } });
    expect(body(six.abc)).toBe('C2D2E2 F2G2A2 |]');
  });

  it('starts with a pickup when the song begins mid-bar', () => {
    const { abc } = buildSheet(ev(['G4', 1], ['C5', 3]), { ...opts, meter: { num: 3, den: 4, offset: 2 } });
    expect(body(abc)).toBe('G4 | c12 |]');
  });

  it('writes a high toy piano an octave down under an octave clef', () => {
    const high = [84, 86, 88]; // C6 D6 E6
    const { abc } = buildSheet([{ key: 0, start: 0, end: 1 }, { key: 2, start: 1, end: 2 }], { bpm: 60, keyMidi: high });
    expect(abc).toContain('clef=treble+8');
    expect(body(abc)).toBe("c4 e4 |]"); // C5, E5 written
  });

  it('uses the key’s real note, not the song’s', () => {
    const detuned = [60.4, 61.6]; // sounds C4 and D4 (rounded)
    const events = [{ key: 0, start: 0, end: 1 }, { key: 1, start: 1, end: 2 }];
    expect(body(buildSheet(events, { bpm: 60, keyMidi: detuned }).abc)).toBe('C4 D4 |]');
  });

  it('builds every built-in song without leaving notes out', () => {
    for (const s of LIBRARY) {
      const events = s.notes.map((n) => ({ key: n.midi - 48, start: n.startTime, end: n.startTime + n.duration }));
      const km = Array.from({ length: 60 }, (_, i) => 48 + i);
      const { abc, chars } = buildSheet(events, { bpm: s.bpm, meter: s.meter, keyMidi: km });
      expect(chars.every((c) => c.length > 0), s.name).toBe(true);
      expect(abc, s.name).toContain(`M:${s.meter.num}/${s.meter.den}`);
    }
  });
});

describe('buildSheet chords', () => {
  const opts = { bpm: 60, keyMidi };
  // C major chord for 2 beats, then G4 for 2 beats.
  const chord = [
    { key: K.C4, start: 0, end: 2 }, { key: K.E4, start: 0.01, end: 2 }, { key: K.G4, start: 0, end: 2 },
    { key: K.G4, start: 2, end: 4 },
  ];

  it('writes notes that start together as one chord, low to high', () => {
    const { abc, chars } = buildSheet(chord, opts);
    expect(body(abc)).toBe('[CEG]8 G8 |]');
    // The three chord notes share the chord symbol.
    expect(chars[0]).toEqual(chars[1]);
    expect(chars[0]).toEqual(chars[2]);
    expect(abc.slice(chars[0][0], chars[0][0] + 6)).toBe('[CEG]8');
  });

  it('stacks the labels of a chord, top note first', () => {
    const abc = buildSheet(chord, opts).abc;
    const w = abc.split('\n').filter((l) => l.startsWith('w: '));
    expect(w).toEqual(['w: 6 6', 'w: 3 *', 'w: 1 *']);
  });

  it('ties a chord across the bar line, with accidentals in the chord', () => {
    const events = [{ key: K['F#4'], start: 3, end: 5 }, { key: K.A4, start: 3, end: 5 }];
    const { abc } = buildSheet([{ key: K.C4, start: 0, end: 3 }, ...events], opts);
    expect(body(abc)).toBe('C12 [^FA]4- | [FA]4 |]');
  });

  it('plays one note per key even if a chord repeats a pitch', () => {
    const same = [{ key: 0, start: 0, end: 1 }, { key: 1, start: 0, end: 1 }];
    expect(body(buildSheet(same, { bpm: 60, keyMidi: [60, 60.2] }).abc)).toBe('C4 |]');
  });
});

describe('buildSheet with MIDI timing', () => {
  it('keeps the beat when the first note is a 32nd late', () => {
    // First note 1/8 beat late; the next notes are on the beat.
    const events = [
      { key: 0, start: 0, end: 0.875 },      // C4, really beat 0..1
      { key: 1, start: 0.875, end: 1.875 },  // D4, beat 1
      { key: 2, start: 1.875, end: 2.875 },  // E4, beat 2
      { key: 3, start: 2.875, end: 3.875 },  // F4, beat 3
    ];
    const { abc } = buildSheet(events, { bpm: 60, keyMidi, meter: { num: 4, den: 4, offset: 0.125 } });
    expect(body(abc)).toBe('C4 D4 E4 F4 |]');
  });
});

describe('buildSheet legato (MIDI)', () => {
  // Quarter notes played as dotted eighths, then a real two-beat rest.
  const short = [
    { key: 0, start: 0, end: 0.75 },
    { key: 1, start: 1, end: 1.75 },
    { key: 2, start: 4, end: 4.75 },
  ];
  it('writes the rests as played by default', () => {
    expect(body(buildSheet(short, { bpm: 60, keyMidi }).abc)).toBe('C3 z D3 z z8 | E3 |]');
  });
  it('closes small gaps but keeps real rests when legato', () => {
    expect(body(buildSheet(short, { bpm: 60, keyMidi, legato: true }).abc)).toBe('C4 D4 z8 | E3 |]');
  });
});
