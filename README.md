# Toy Piano Tutor

Learn songs on a cheap toy piano: one with any number of keys (1–40), maybe out of tune, maybe white keys only. The app listens to your actual piano through the microphone and measures what each key really sounds like. It can then teach songs on the keys you actually have.

**Live app:** https://henrywei57.github.io/toy-piano-tutor/ (install it from the browser menu: *Add to Home screen* / *Install app*)

Runs entirely in the browser: no backend, no account. Data is kept in your browser's localStorage, and you can export or import profiles as JSON.

## Status

| Feature | State |
| --- | --- |
| 1. Profiles + calibration | ✅ done |
| 2. Song import (MIDI, typed notes) | planned |
| 3. Song-to-piano mapping (transposition search) | planned |
| 4. Tutor mode (falling notes, listen-and-wait) | planned |

## Using it

1. **Create a profile:** give it a name and the number of keys (count every key you can press, left to right).
2. **Calibrate:** put the phone near the piano in a quiet room, press **Start**, and play each key when asked ("Press key 3 now"). Choose 1, 2 or 3 *takes per key*; the takes are averaged.
3. **Check the list:** each key shows the measured frequency, the nearest note, and how many cents off it is.
   - ⚠ **Not higher than key N** or **Jumps … semitones**: probably an octave error. Open **Edit** and use **×2 / ÷2**, or **Record** the key again.
   - **Edit** lets you type a frequency (`523.4`) or a note (`C5`, `F#4`, `Bb5-20`) yourself.
   - **Skip** marks a broken or missing key so it's never used.
4. **Export** a profile to back it up or move it to another device, and **Import** it there.

### How pitch detection works

`src/audio`: the mic is opened with echo cancellation, noise suppression and auto-gain **off**, because they smear the attack and pump the level of short metallic notes.

1. **Onset detection** (`onset.js`) tracks the room's noise floor and fires when the level jumps sharply above both the recent level and that floor.
2. The note is recorded with a short pre-roll until it dies away (at most 0.9 s).
3. **Analysis** (`analyze.js`) finds the loudest point (the hammer click) and steps back to where the attack starts. It **skips the first 30 ms** to avoid the broadband click, then runs **YIN** (`yin.js`) on overlapping frames for as long as the note rings. Noisy frames are dropped, and the result is the **median** of the rest.

On synthetic test signals (glockenspiel-style bars with 2.76×/5.4× partials, toy-piano rods with 6.27×/17.55× partials, and a click up to 3× louder than the note), the estimate lands within 1 cent.

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
  audio/    mic.js (capture), yin.js, onset.js, analyze.js, strikeListener.js, notes.js
  profile/  profile.js (model, octave-error flags), store.js (localStorage, export/import)
  ui/       dom.js, levelMeter.js, profilesView.js, calibrateView.js
  main.js   hash router + service worker registration
public/     manifest.webmanifest, sw.js, icons/
tests/      vitest unit tests + synthetic signal generators
tools/      make-icons.mjs
```
