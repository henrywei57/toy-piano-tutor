// Play screen: falling notes onto the player's real keys, with optional
// synth playback, metronome, and "listen and wait" using the microphone.

import { h, setChildren } from './dom.js';
import { createTutorCanvas } from './tutorCanvas.js';
import { createLevelMeter } from './levelMeter.js';
import { getActiveProfile, getSettings, updateSettings } from '../profile/store.js';
import { getActiveSong } from '../song/songStore.js';
import { keysFromProfile, mapNotes, formatShift } from '../mapping/transpose.js';
import { resolveMapping } from '../mapping/mappingStore.js';
import { buildTimeline, matchKey, TutorEngine } from './tutorEngine.js';
import { freqToNote, midiToFreq } from '../audio/notes.js';
import { unlockAudio, playTone, click, closeAudio } from '../audio/synth.js';
import { openMic, closeMic } from '../audio/mic.js';
import { listenForStrikes, tutorListenOptions } from '../audio/strikeListener.js';

const LOOKAHEAD = 3;      // song seconds visible above the hit line
const LEAD_IN = 1.5;      // song seconds before the first note
const FLASH_MS = 350;     // how long a struck key stays green/red

export function tutorView(root) {
  const profile = getActiveProfile();
  const song = getActiveSong();
  const keys = profile ? keysFromProfile(profile) : [];

  if (!profile || !keys.length || !song) {
    root.replaceChildren(h('section', { class: 'stack' },
      h('h1', null, 'Play'),
      h('div', { class: 'card stack' },
        !profile && [h('p', null, 'First create a profile for your toy piano.'), h('a', { class: 'btn primary', href: '#/' }, 'Go to Pianos')],
        profile && !keys.length && [h('p', null, `“${profile.name}” has no measured keys yet. Calibrate it first.`), h('a', { class: 'btn primary', href: '#/calibrate' }, 'Calibrate')],
        profile && keys.length > 0 && !song && [h('p', null, 'Pick a song to play.'), h('a', { class: 'btn primary', href: '#/song' }, 'Choose a song')],
      ),
    ));
    return () => {};
  }

  const mapping = resolveMapping(profile, song);
  const events = buildTimeline(mapNotes(song.notes, keys, mapping));
  const keyNames = profile.keys.map((k) => (k.freq ? freqToNote(k.freq).name : ''));
  const keyLabel = (i) => `key ${i + 1}` + (keyNames[i] ? ` (${keyNames[i]})` : '');

  if (!events.length) {
    root.replaceChildren(h('section', { class: 'stack' },
      h('h1', null, 'Play'),
      h('div', { class: 'card stack' },
        h('p', null, `None of the notes in “${song.name}” land on a key with the current settings.`),
        h('a', { class: 'btn primary', href: '#/map' }, 'Change the fit'),
      ),
    ));
    return () => {};
  }

  const saved = { tempo: 100, metronome: false, sound: true, ...(getSettings().tutor || {}) };
  const state = {
    tempo: saved.tempo,       // percent
    metronome: saved.metronome,
    sound: saved.sound,
    wait: false,
    playing: false,
    listen: 'off',            // 'off' | 'starting' | 'on'
    message: null,            // {kind, text}
    feedback: null,           // {kind, text}
  };
  const persist = () => updateSettings({ tutor: { tempo: state.tempo, metronome: state.metronome, sound: state.sound } });

  const usedRange = [Math.min(...events.map((e) => e.key)), Math.max(...events.map((e) => e.key))];
  const bpm = song.bpm > 0 ? song.bpm : 100;
  let engine = new TutorEngine(events, { waitMode: false, leadIn: LEAD_IN });
  let flash = null;           // {key, kind, until}
  let nextBeat = 0;           // metronome: index of the next beat to click
  let mic = null;
  let listener = null;
  const meter = createLevelMeter();

  // ---- DOM --------------------------------------------------------------
  const stage = h('div', { class: 'tutor-stage' });
  const overlay = h('div', { class: 'tutor-overlay', hidden: true });
  stage.append(overlay);
  const zoomEl = h('div', { class: 'muted small', hidden: true });
  let zoomKey = '';
  const progressEl = h('span', { class: 'tutor-progress' });
  const feedbackEl = h('span', { class: 'tutor-feedback', role: 'status', 'aria-live': 'polite' });
  const playBtn = h('button', { class: 'btn primary tutor-play', onClick: togglePlay });
  const restartBtn = h('button', { class: 'btn', onClick: restart }, 'Restart');
  const tempoValue = h('span', { class: 'tol-value' });
  const tempoInput = h('input', {
    type: 'range', id: 'tempo', min: 25, max: 150, step: 5, value: String(state.tempo),
    onInput: (e) => { state.tempo = Number(e.target.value); persist(); renderControls(); },
  });
  const toggles = {
    metronome: h('button', { class: 'btn small toggle', onClick: () => { state.metronome = !state.metronome; persist(); renderControls(); } }, 'Metronome'),
    sound: h('button', { class: 'btn small toggle', onClick: () => { state.sound = !state.sound; persist(); renderControls(); } }, 'Hear song'),
    wait: h('button', { class: 'btn small toggle', onClick: toggleWait }, 'Listen & wait'),
  };
  const noteEl = h('div', { class: 'muted small' });
  const messageEl = h('div');
  const meterRow = h('div', { class: 'tutor-meter', hidden: true }, h('span', { class: 'muted small' }, 'Mic'), meter.el);

  root.replaceChildren(
    h('section', { class: 'stack tutor' },
      h('div', { class: 'tutor-head' },
        h('div', { class: 'tutor-title' },
          h('h1', null, song.name),
          h('div', { class: 'muted small' },
            `${profile.name} · ${formatShift(mapping.shift)}`,
            ' · ', h('a', { href: '#/map' }, 'Change fit')),
        ),
      ),
      stage,
      h('div', { class: 'tutor-status' }, progressEl, feedbackEl),
      zoomEl,
      h('div', { class: 'card stack tutor-controls' },
        h('div', { class: 'row-actions' }, playBtn, restartBtn),
        h('label', { for: 'tempo' }, 'Tempo ', tempoValue),
        tempoInput,
        h('div', { class: 'row-actions' }, toggles.metronome, toggles.sound, toggles.wait),
        noteEl,
        meterRow,
        messageEl,
      ),
    ),
  );
  const canvas = createTutorCanvas(stage, profile);

  // ---- playback ---------------------------------------------------------
  function togglePlay() {
    if (engine.finished) restart();
    state.playing = !state.playing;
    if (state.playing) {
      unlockAudio();
      if (state.wait && !mic) { state.playing = false; startListening(true); return; }
      if (listener) listener.resume();
    } else if (listener) {
      listener.pause();
    }
    last = performance.now();
    renderControls();
  }

  function restart() {
    engine.reset();
    nextBeat = Math.ceil(-LEAD_IN * bpm / 60);
    flash = null;
    state.feedback = null;
    overlay.hidden = true;
    renderControls();
  }

  async function toggleWait() {
    if (state.wait) {
      state.wait = false;
      stopListening();
      rebuildEngine();
      return;
    }
    await startListening(false);
  }

  async function startListening(thenPlay) {
    state.listen = 'starting';
    state.message = null;
    renderControls();
    try {
      mic = await openMic();
    } catch (err) {
      state.listen = 'off';
      state.wait = false;
      state.message = { kind: 'error', text: err.message };
      renderControls();
      return;
    }
    listener = listenForStrikes(mic, {
      onLevel: (db, floor) => meter.set(db, floor),
      onResult: handleStrike,
    }, tutorListenOptions(keys.map((k) => midiToFreq(k.midi))));
    state.listen = 'on';
    state.wait = true;
    rebuildEngine();
    if (thenPlay) {
      state.playing = true;
      last = performance.now();
    } else {
      listener.pause();
    }
    renderControls();
  }

  function stopListening() {
    if (listener) listener.stop();
    listener = null;
    if (mic) closeMic();
    mic = null;
    state.listen = 'off';
    meter.reset();
  }

  function rebuildEngine() {
    engine = new TutorEngine(events, { waitMode: state.wait, leadIn: LEAD_IN });
    state.playing = false;
    if (listener) listener.pause();
    restart();
  }

  function handleStrike(result) {
    if (!state.playing || !state.wait || !result.ok) return;
    const m = matchKey(result.freq, keys);
    if (!m) return; // not near any key: a knock, a voice, …
    const expected = engine.expected;
    const outcome = engine.strike(m.index);
    if (outcome === 'ignored') return;
    flash = { key: m.index, kind: outcome, until: performance.now() + FLASH_MS };
    if (outcome === 'correct') {
      state.feedback = { kind: 'ok', text: `✓ ${keyLabel(m.index)}` };
    } else {
      state.feedback = { kind: 'error', text: `✗ That was ${keyLabel(m.index)} — play ${keyLabel(expected.key)}` };
    }
    renderStatus();
  }

  // ---- render loop ------------------------------------------------------
  let last = performance.now();
  let raf = requestAnimationFrame(frame);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dtReal = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (state.playing) {
      const before = engine.time;
      const crossed = engine.advance(dtReal * (state.tempo / 100));
      if (!state.wait) {
        if (state.sound) {
          for (const ev of crossed) {
            playTone(profile.keys[ev.key].freq, { duration: (ev.end - ev.start) / (state.tempo / 100) });
          }
        }
        // Metronome: click on every beat crossed (including the lead-in).
        const spb = 60 / bpm;
        while (nextBeat * spb <= engine.time) {
          if (state.metronome && nextBeat * spb > before - 1e-9 && engine.time <= engine.lastEnd) click(false);
          nextBeat++;
        }
      }
      if (engine.finished) finish();
      if (crossed.length || engine.waiting) renderStatus();
    }
    const view = canvas.draw({
      time: engine.time,
      events,
      results: engine.results,
      lookahead: LOOKAHEAD,
      lit: litKeys(now),
      waitingIdx: engine.waiting ? engine.next : -1,
      usedRange,
    });
    const portrait = window.innerHeight > window.innerWidth;
    const z = view.zoomed ? `${view.lo}-${view.hi}-${portrait}` : '';
    if (z !== zoomKey) {
      zoomKey = z;
      zoomEl.hidden = !view.zoomed;
      zoomEl.textContent = view.zoomed
        ? `Showing keys ${view.lo + 1}–${view.hi + 1} of ${profile.keys.length}, the ones this song uses.` + (portrait ? ' Turn the screen sideways to see more.' : '')
        : '';
    }
  }

  function litKeys(now) {
    const lit = new Map();
    const t = engine.time;
    if (state.wait) {
      const ev = engine.expected;
      if (ev && ev.start - t <= 0.6) lit.set(ev.key, 'expected');
    } else {
      for (let i = Math.max(0, engine.cursor - 8); i < engine.cursor; i++) {
        const ev = events[i];
        if (t >= ev.start && t < Math.min(ev.end, ev.start + 0.5)) lit.set(ev.key, 'play');
      }
    }
    if (flash && now < flash.until) lit.set(flash.key, flash.kind);
    return lit;
  }

  function finish() {
    state.playing = false;
    if (listener) listener.pause();
    const acc = engine.accuracy;
    setChildren(overlay,
      h('div', { class: 'card stack tutor-result' },
        h('h2', null, 'Finished!'),
        state.wait && acc != null && h('div', { class: 'fit-pct level-' + (acc >= 0.9 ? 'good' : acc >= 0.7 ? 'ok' : 'poor') }, Math.round(acc * 100) + '%'),
        state.wait && h('div', null, `Accuracy · ${engine.correct} correct, ${engine.wrong} wrong`),
        !state.wait && h('div', { class: 'muted' }, 'Turn on “Listen & wait” to play along and get a score.'),
        h('button', { class: 'btn primary', onClick: () => { restart(); togglePlay(); } }, 'Play again'),
      ),
    );
    overlay.hidden = false;
    renderControls();
  }

  // ---- controls ---------------------------------------------------------
  function renderStatus() {
    const progress = `${engine.progress} / ${events.length} notes`;
    if (progressEl.textContent !== progress) progressEl.textContent = progress;
    let fb = state.feedback;
    if (state.wait && engine.waiting && (!fb || fb.kind !== 'error')) {
      fb = { kind: 'info', text: `Play ${keyLabel(engine.expected.key)}` };
    }
    const text = fb ? fb.text : '';
    if (feedbackEl.textContent !== text) feedbackEl.textContent = text;
    feedbackEl.dataset.kind = fb ? fb.kind : '';
  }

  function renderControls() {
    playBtn.textContent = state.playing ? 'Pause' : engine.time > -LEAD_IN && !engine.finished ? 'Resume' : 'Play';
    playBtn.disabled = state.listen === 'starting';
    tempoInput.value = String(state.tempo);
    tempoValue.textContent = `${state.tempo}% · ${Math.round(bpm * state.tempo / 100)} BPM`;
    const set = (btn, on, disabled) => {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.disabled = Boolean(disabled);
    };
    set(toggles.metronome, state.metronome && !state.wait, state.wait);
    set(toggles.sound, state.sound && !state.wait, state.wait);
    set(toggles.wait, state.wait, state.listen === 'starting');
    toggles.wait.textContent = state.listen === 'starting' ? 'Starting mic…' : 'Listen & wait';
    noteEl.textContent = state.wait
      ? 'The song waits for you: play each note on your piano and it moves on when it hears the right key. Sound and metronome are off so the mic only hears your piano.'
      : 'Watch the notes fall onto your keys. Turn on “Listen & wait” to play along with the microphone.';
    meterRow.hidden = state.listen !== 'on';
    setChildren(messageEl, state.message && h('div', { class: 'msg ' + state.message.kind }, state.message.text));
    renderStatus();
  }

  function onKey(e) {
    if (e.code !== 'Space' || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A') return;
    e.preventDefault();
    togglePlay();
  }
  document.addEventListener('keydown', onKey);

  restart();

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    stopListening();
    canvas.destroy();
    closeAudio();
  };
}
