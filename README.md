# Toy Piano Tutor

Learn songs on a cheap toy piano: one with any number of keys (1–40), maybe out of tune, maybe white keys only. The app listens to your actual piano through the microphone and measures what each key really sounds like. It can then teach songs on the keys you actually have.

**Live app:** https://henrywei57.github.io/toy-piano-tutor/ (install it from the browser menu: *Add to Home screen* / *Install app*)

Runs entirely in the browser: no backend, no account. Profiles and songs are kept in your browser's localStorage, and you can export or import profiles as JSON.

## Status

| Feature | State |
| --- | --- |
| 1. Profiles + calibration | ✅ done |
| 2. Song import (MIDI, typed notes) | ✅ done |
| 3. Song-to-piano mapping (transposition search) | ✅ done |
| 4. Tutor mode (falling notes, listen-and-wait) | ✅ done |
| Song search (built-in, saved, and online MIDI files) | ✅ done |
| Sheet music view (read the notes on a staff) | ✅ done |

## Using it

1. **Create a profile:** give it a name and the number of keys (count every key you can press, left to right).
2. **Calibrate:** put the phone near the piano in a quiet room, press **Start**, and play each key when asked ("Press key 3 now"). Choose 1, 2 or 3 *takes per key*; the takes are averaged.
3. **Check the list:** each key shows the measured frequency, the nearest note, and how many cents off it is.
   - ⚠ **Not higher than key N** or **Jumps … semitones**: probably an octave error. Open **Edit** and use **×2 / ÷2**, or **Record** the key again.
   - **Edit** lets you type a frequency (`523.4`) or a note (`C5`, `F#4`, `Bb5-20`) yourself.
   - **Skip** marks a broken or missing key so it's never used.
4. **Export** a profile to back it up or move it to another device, and **Import** it there.

### Finding songs

Type a song name in **Songs → Find a song** and press **Search**:

- **Built-in and your songs** that match are listed first. Accents and capitals don't matter, so `fur elise` finds *Für Elise*. **Play** opens the song straight in the tutor.
- **Online MIDI files** come from [bitmidi.com](https://bitmidi.com), a public archive of MIDI files shared by its users. **Open** downloads one into the MIDI importer below. Pick the track with the melody, then **Save and play**. Quality varies: some files have the melody on its own track, some are full arrangements. **More results** loads the next page.

Only your search words are sent to bitmidi.com, and online search needs an internet connection. Everything else works offline.

### Adding songs

**Built-in songs:** the Songs screen comes with public-domain melodies, from very easy (Hot Cross Buns uses 3 notes) to harder ones (Für Elise needs sharps). Tap **Use** to make one the active song. Once a piano is calibrated, each song shows how well it fits that piano.

To add your own, open **Songs → Add a song**. The song you save becomes the *active* song.

- **MIDI file:** choose a `.mid` file and pick the track that holds the melody. The app suggests one (the highest-pitched track with a fair number of notes), and drum tracks can't be picked. Each track shows its note count and range. If a track has chords, **Melody only** keeps just the highest note at each moment. Only the chosen melody is saved, not the whole file.
- **Type notes:** one note per word, e.g. `C4 D4 E4 C4/2 G4`.

  | Write | Means |
  | --- | --- |
  | `C4` | quarter note (the default) |
  | `C4/2`, `C4/1`, `C4/8`, `C4/16` | half, whole, eighth, sixteenth |
  | `C4/4.` | dotted (1.5× as long) |
  | `C#4`, `Db4`, `bb3` | sharps and flats; lowercase is fine |
  | `R`, `R/2` | rest |
  | `\|` | bar line: sets where bars go in the sheet music (a short first bar is a pickup) |
  | `,` | ignored |

  Set the tempo in BPM. Mistakes are listed with their position (e.g. *Note 16 "H4": Not a note name*).

Every song is stored as a list of `{ midi, startTime, duration }` with times in seconds, starting at 0.

### Fitting a song to your piano

The **Map** screen fits the active song onto the active piano's *measured* keys (`src/mapping/transpose.js`):

- It tries every transposition from −12 to +12 semitones in **half-semitone** steps. Half steps let a piano tuned between standard notes still fit.
- Each transposition is scored by how many song notes land within the **tolerance** (default ±50 cents, adjustable) of a real key. Ties go to the smaller pitch error, then the smaller shift.
- It shows **"X% of notes playable at transposition Y"**. Pick any other transposition from the list (each shows its %), or go back to the best.
- **Notes without a matching key** can be:
  - **Octave-fold:** moved by whole octaves onto a key, or the nearest key if that note isn't on the piano in any octave.
  - **Nearest key**
  - **Skip**

  Substituted notes are highlighted in the note list.
- The verdict is plain about bad fits. It says when the melody spans more than your keyboard, which notes are above or below it, and which notes have no key at all (e.g. black keys a white-key piano lacks). It also flags keys still marked as possible octave errors.

Settings are remembered per piano and song, and the tutor uses them.

### Playing (tutor)

The **Play** screen has two views. Switch between them at the top right.

**Falling notes** draws *your* keys along the bottom, each labelled with its number and the note it really plays. The song's notes fall down onto them. The number on each falling note is the key to press. Colours match the Map screen: pink is on a key, amber is moved an octave, red is the nearest key.

- **Play / Pause** (or the space bar) and **Restart**.
- **Tempo** from 25% to 150%. The label shows the resulting BPM.
- **Metronome:** a click on every beat, including the count-in.
- **Hear song:** plays each note through the speaker *at the frequency your key actually has*, so it sounds like your piano, detuning included.
- **Listen & wait:** uses the microphone.
  - The song stops at each note until you play it, and moves on only when it hears the **right key**. The key is matched to the nearest measured key, and an octave error in detection is tolerated.
  - A wrong key flashes red ("That was key 7, play key 5"). A right one flashes green.
  - At the end you get an **accuracy score**: right keys ÷ all keys played.
  - Sound and metronome are switched off in this mode so the microphone only hears your piano.

On a narrow phone screen with many keys, the keyboard zooms to the keys the song uses and says so. Turn the phone sideways to see them all.

**Sheet music** shows the same notes on a staff, for learning to read music. Your keyboard stays underneath.

- **Under each note:** your **key numbers**, the **note names** (`E5`), or **nothing** for reading practice.
- The note being played turns pink and the sheet scrolls along. In Listen & wait, the note to play next pulses and the ones you've played turn green.
- The staff shows the notes **your keys really play**, after the Map screen's transposition and octave folding. A high toy piano gets a treble clef with a small **8** above it (it sounds an octave higher than written), so the notes sit on the staff instead of on stacks of ledger lines.
- Bar lines come from the song's time signature and pickup. Built-in songs have theirs, MIDI files bring theirs, and for typed songs the app reads your `|` bar lines.
- Some MIDI files were recorded by someone playing rather than written note by note. Their rhythms can't be written exactly, so the sheet says the rhythms are approximate. The notes and keys are still right.

The engraving is done by [abcjs](https://www.abcjs.net/) (MIT licence). It loads the first time you open sheet music, about 130 KB, and is then cached for offline use.

### How pitch detection works

`src/audio`: the mic is opened with echo cancellation, noise suppression and auto-gain **off**, because they smear the attack and pump the level of short metallic notes.

1. **Onset detection** (`onset.js`) tracks the room's noise floor and fires when the level jumps sharply above both the recent level and that floor.
2. The note is recorded with a short pre-roll until it dies away (at most 0.9 s).
3. **Analysis** (`analyze.js`) finds the loudest point (the hammer click) and steps back to where the attack starts. It **skips the first 30 ms** to avoid the broadband click, then runs **YIN** (`yin.js`) on overlapping frames for as long as the note rings. Noisy frames are dropped, and the result is the **median** of the rest.

On synthetic test signals (glockenspiel-style bars with 2.76×/5.4× partials, toy-piano rods with 6.27×/17.55× partials, and a click up to 3× louder than the note), the estimate lands within 1 cent.

In the tutor, only the key matters, not an exact pitch. So each note is recorded for at most 0.2 s, and YIN only searches the piano's own range. That keeps the response quick.

## Development

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # production build in dist/
npm run preview    # serve the production build locally
npm run icons      # regenerate the PNG icons in public/icons
```

The service worker (offline support and install) is only registered in production builds, so `npm run dev` never serves stale cached files.

### Testing on a phone

Browsers only allow the microphone on **HTTPS** pages or on **localhost**. A plain `http://192.168.x.x:5173` address will **not** get mic access. Options:

1. **GitHub Pages (easiest):** push to `main` and open the Pages URL on the phone. It's HTTPS.
2. **HTTPS dev server on your Wi-Fi:**
   ```bash
   npm run dev:https
   ```
   Vite prints a `https://192.168.x.x:5173` address. Open it on the phone (same Wi-Fi) and accept the self-signed certificate warning ("Advanced → Proceed"). On Windows, allow Node through the firewall if the phone can't connect.
3. **Android + USB:** run `npm run dev`, connect the phone, open `chrome://inspect/#devices` on the computer, and set up port forwarding `5173 → localhost:5173`. On the phone, `http://localhost:5173` counts as secure.

On iOS, the mic only starts after a tap. That's why calibration begins with a **Start** button.

### Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the tests, builds, and publishes `dist/` on every push to `main`.

One-time setup for a fork: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Vite uses a relative `base` (`./`), so the build works at any subpath such as `https://<user>.github.io/<repo>/`.

## Project layout

```
src/
  audio/    mic.js (capture), yin.js, onset.js, analyze.js, strikeListener.js, notes.js,
            synth.js (playback tones + metronome click)
  profile/  profile.js (model, octave-error flags), store.js (localStorage, export/import)
  song/     notation.js (typed notes), midi.js (@tonejs/midi import), melody.js (melody only,
            polyphony check, stats), library.js (built-in songs), songStore.js (saved songs),
            search.js (song search + bitmidi.com), sheet.js (notes -> ABC sheet music: bars,
            ties, beams, accidentals, clef choice)
  mapping/  transpose.js (transposition search, note mapping, fit explanation),
            mappingStore.js (settings per piano + song)
  ui/       dom.js, levelMeter.js, profilesView.js, calibrateView.js, songView.js, mapView.js,
            tutorView.js (Play screen), tutorCanvas.js (falling notes + keys),
            sheetView.js (sheet music with abcjs, current-note highlight),
            tutorEngine.js (song clock, listen-and-wait, scoring; no DOM)
  main.js   hash router + service worker registration
public/     manifest.webmanifest, sw.js, icons/
tests/      vitest unit tests + synthetic signal generators
tools/      make-icons.mjs
```
