// Built-in songs: public-domain / traditional melodies, written in the app's
// own typed notation (see notation.js). Roughly easiest first.

import { parseNotation } from './notation.js';
import { normalizeNotes } from './melody.js';
import { meterFromText, parseMeter } from './sheet.js';

const SOURCES = [
  {
    id: 'lib-hot-cross-buns',
    name: 'Hot Cross Buns',
    bpm: 100,
    text: 'E4 D4 C4/2 | E4 D4 C4/2 | C4/8 C4/8 C4/8 C4/8 D4/8 D4/8 D4/8 D4/8 | E4 D4 C4/2',
  },
  {
    id: 'lib-mary-lamb',
    name: 'Mary Had a Little Lamb',
    bpm: 110,
    text: 'E4 D4 C4 D4 | E4 E4 E4/2 | D4 D4 D4/2 | E4 G4 G4/2 | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4/1',
  },
  {
    id: 'lib-twinkle',
    name: 'Twinkle Twinkle Little Star',
    bpm: 100,
    text: 'C4 C4 G4 G4 | A4 A4 G4/2 | F4 F4 E4 E4 | D4 D4 C4/2 | G4 G4 F4 F4 | E4 E4 D4/2 | '
      + 'G4 G4 F4 F4 | E4 E4 D4/2 | C4 C4 G4 G4 | A4 A4 G4/2 | F4 F4 E4 E4 | D4 D4 C4/2',
  },
  {
    id: 'lib-frere-jacques',
    name: 'Frère Jacques',
    bpm: 110,
    text: 'C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4/2 | E4 F4 G4/2 | '
      + 'G4/8 A4/8 G4/8 F4/8 E4 C4 | G4/8 A4/8 G4/8 F4/8 E4 C4 | C4 G3 C4/2 | C4 G3 C4/2',
  },
  {
    id: 'lib-ode-to-joy',
    name: 'Ode to Joy (Beethoven)',
    bpm: 100,
    text: 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4. D4/8 D4/2 | '
      + 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4. C4/8 C4/2 | '
      + 'D4 D4 E4 C4 | D4 E4/8 F4/8 E4 C4 | D4 E4/8 F4/8 E4 D4 | C4 D4 G3/2 | '
      + 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4. C4/8 C4/2',
  },
  {
    id: 'lib-au-clair',
    name: 'Au Clair de la Lune',
    bpm: 100,
    text: 'C4 C4 C4 D4 | E4/2 D4/2 | C4 E4 D4 D4 | C4/1 | C4 C4 C4 D4 | E4/2 D4/2 | C4 E4 D4 D4 | C4/1 | '
      + 'D4 D4 D4 D4 | A3/2 A3/2 | D4 C4 B3 A3 | G3/1 | C4 C4 C4 D4 | E4/2 D4/2 | C4 E4 D4 D4 | C4/1',
  },
  {
    id: 'lib-row-your-boat',
    meter: '6/8',
    name: 'Row, Row, Row Your Boat',
    bpm: 120,
    text: 'C4. C4. | C4 D4/8 E4. | E4 D4/8 E4 F4/8 | G4/2. | '
      + 'C5/8 C5/8 C5/8 G4/8 G4/8 G4/8 | E4/8 E4/8 E4/8 C4/8 C4/8 C4/8 | G4 F4/8 E4 D4/8 | C4/2.',
  },
  {
    id: 'lib-yankee-doodle',
    name: 'Yankee Doodle',
    bpm: 120,
    text: 'C4 C4 D4 E4 | C4 E4 D4 G3 | C4 C4 D4 E4 | C4/2 B3/2 | C4 C4 D4 E4 | F4 E4 D4 C4 | B3 G3 A3 B3 | C4/2 C4/2',
  },
  {
    id: 'lib-jingle-bells',
    name: 'Jingle Bells (chorus)',
    bpm: 120,
    text: 'E4 E4 E4/2 | E4 E4 E4/2 | E4 G4 C4. D4/8 | E4/1 | F4 F4 F4. F4/8 | F4 E4 E4 E4/8 E4/8 | E4 D4 D4 E4 | D4/2 G4/2 | '
      + 'E4 E4 E4/2 | E4 E4 E4/2 | E4 G4 C4. D4/8 | E4/1 | F4 F4 F4 F4 | F4 E4 E4 E4/8 E4/8 | G4 G4 F4 D4 | C4/1',
  },
  {
    id: 'lib-happy-birthday',
    meter: '3/4',
    name: 'Happy Birthday',
    bpm: 100,
    text: 'G4/8. G4/16 | A4 G4 C5 | B4/2 G4/8. G4/16 | A4 G4 D5 | C5/2 G4/8. G4/16 | '
      + 'G5 E5 C5 | B4 A4/2 | F5/8. F5/16 E5 C5 | D5 C5/2',
  },
  {
    id: 'lib-fur-elise',
    meter: '3/8',
    name: 'Für Elise, theme (Beethoven)',
    bpm: 70,
    text: 'E5/16 D#5/16 | E5/16 D#5/16 E5/16 B4/16 D5/16 C5/16 | A4/8 R/16 C4/16 E4/16 A4/16 | B4/8 R/16 E4/16 G#4/16 B4/16 | '
      + 'C5/8 R/16 E4/16 E5/16 D#5/16 | E5/16 D#5/16 E5/16 B4/16 D5/16 C5/16 | A4/8 R/16 C4/16 E4/16 A4/16 | '
      + 'B4/8 R/16 E4/16 C5/16 B4/16 | A4/4',
  },
];

export const LIBRARY = SOURCES.map((s) => {
  const { notes, errors } = parseNotation(s.text, { bpm: s.bpm });
  if (errors.length) throw new Error(`Built-in song “${s.name}” has a typo: ${errors[0].token}`);
  const meter = meterFromText(s.text, parseMeter(s.meter || '4/4'));
  return { ...s, meter, source: 'library', notes: normalizeNotes(notes), createdAt: 0 };
});

export function isLibraryId(id) {
  return typeof id === 'string' && id.startsWith('lib-');
}
