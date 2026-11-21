// Calibration: guided "Press key N now", one key at a time, with a live level
// meter, per-key results, manual overrides, re-record and skip.

import { h, toast } from './dom.js';
import { createLevelMeter } from './levelMeter.js';
import { openMic, closeMic } from '../audio/mic.js';
import { listenForStrikes } from '../audio/strikeListener.js';
import { freqToNote, formatCents, formatHz, parseFreqOrNote } from '../audio/notes.js';
import * as store from '../profile/store.js';
import { addTake, setManual, clearKey, keyFlags, takeSpreadCents, MAX_TAKES } from '../profile/profile.js';

const FAIL_TEXT = {
  'too-quiet': 'That was too quiet. Strike the key a bit harder, or move the phone closer.',
  'too-short': 'The note was too short to measure. Let it ring.',
  'no-pitch': 'Couldn’t hear a clear pitch. Strike once, firmly, and let it ring.',
};

const STATUS_TEXT = {
  off: 'Mic off',
  starting: 'Starting mic…',
  idle: 'Mic on · not recording',
  waiting: 'Waiting for sound…',
  hearing: 'Hearing a note…',
  analyzing: 'Analyzing…',
  cooldown: 'Got it',
};

export function calibrateView(root, { params, navigate }) {
  let profile = store.getProfile(params.id);
  if (!profile) {
    root.replaceChildren(h('section', { class: 'stack' },
      h('p', null, 'That profile no longer exists.'),
      h('a', { class: 'btn', href: '#/' }, 'Back to profiles')));
    return () => {};
  }
  store.setActiveId(profile.id);

  const settings = store.getSettings();
  const state = {
    current: firstUnmeasured(profile),
    mode: 'idle',          // 'idle' | 'guided' | 'single'
    roundTakes: 0,         // takes collected for the current key in this round
    appendOne: false,      // "Add a take": keep old takes, record just one more
    listen: 'off',         // see STATUS_TEXT
    message: null,         // { kind, text }
    editing: null,         // key index whose editor is open
    focusEditor: false,
    takesPerKey: settings.takesPerKey,
  };
  const roundTarget = () => (state.appendOne ? 1 : state.takesPerKey);

  let mic = null;
  let listener = null;
  const meter = createLevelMeter();

  // ---- persistence --------------------------------------------------------
  function updateKey(i, fn) {
    const keys = profile.keys.slice();
    keys[i] = fn(keys[i]);
    profile = store.saveProfile({ ...profile, keys });
  }

  // ---- mic / listening ----------------------------------------------------
  async function ensureMic() {
    if (mic) return true;
    setListen('starting');
    try {
      mic = await openMic();
    } catch (err) {
      setListen('off');
      state.message = { kind: 'error', text: err.message };
      render();
      return false;
    }
    listener = listenForStrikes(mic, {
      onLevel: (db, floor) => meter.set(db, floor),
      onState: (s) => setListen(state.mode === 'idle' ? 'idle' : s),
      onResult: handleResult,
    });
    listener.pause();
    setListen('idle');
    return true;
  }

  function setListen(s) {
    state.listen = s;
    const chip = root.querySelector('.status-chip');
    if (chip) {
      chip.textContent = STATUS_TEXT[s] || s;
      chip.dataset.state = s;
    }
  }

  async function start(mode, index, appendOne = false) {
    if (!(await ensureMic())) return;
    state.mode = mode;
    state.current = index;
    state.roundTakes = 0;
    state.appendOne = appendOne;
    state.editing = null;
    state.message = null;
    if (profile.keys[index].skip) updateKey(index, (k) => ({ ...k, skip: false }));
    listener.resume();
    render();
  }

  function stop() {
    state.mode = 'idle';
    state.roundTakes = 0;
    state.appendOne = false;
    if (listener) listener.pause();
    setListen(mic ? 'idle' : 'off');
    render();
  }

  function handleResult(r) {
    if (state.mode === 'idle') return;
    const i = state.current;
    if (!r.ok) {
      state.message = { kind: 'warn', text: FAIL_TEXT[r.reason] || 'Try again.' };
      render();
      return;
    }
    // The first take of a round replaces older measurements of this key
    // (unless we're adding one extra take to the average).
    const fresh = state.roundTakes === 0 && !state.appendOne;
    updateKey(i, (k) => addTake(fresh ? clearKey(k) : k, r.freq));
    state.roundTakes++;
    const n = freqToNote(r.freq);
    const shaky = r.confidence < 0.6 ? ' (unsteady — maybe re-record)' : '';
    state.message = { kind: 'ok', text: `Key ${i + 1}: ${formatHz(r.freq)} Hz · ${n.name} ${formatCents(n.cents)}${shaky}` };

    if (state.roundTakes >= roundTarget()) {
      state.roundTakes = 0;
      state.appendOne = false;
      if (state.mode === 'guided') {
        const next = nextUnskipped(profile, i + 1);
        if (next === -1) {
          state.mode = 'idle';
          listener.pause();
          setListen('idle');
          state.message = { kind: 'ok', text: 'All keys done! Check any flagged keys below.' };
        } else {
          state.current = next;
        }
      } else {
        state.mode = 'idle';
        listener.pause();
        setListen('idle');
      }
    }
    render();
  }

  function move(delta) {
    const i = delta > 0 ? nextUnskipped(profile, state.current + 1) : prevUnskipped(profile, state.current - 1);
    if (i === -1) return;
    state.current = i;
    state.roundTakes = 0;
    state.message = null;
    render();
  }

  function skipCurrent() {
    const i = state.current;
    updateKey(i, (k) => ({ ...k, skip: true }));
    state.roundTakes = 0;
    const next = nextUnskipped(profile, i + 1);
    if (next === -1) stop();
    else { state.current = next; render(); }
  }

  // ---- rendering ----------------------------------------------------------
  function promptCard() {
    const i = state.current;
    const recording = state.mode !== 'idle';
    const allDone = profile.keys.every((k) => k.skip || k.freq != null);

    const takesSel = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Takes per key' },
      h('span', { class: 'muted small' }, 'Takes per key'),
      [1, 2, 3].map((n) => h('button', {
        class: 'seg' + (state.takesPerKey === n ? ' on' : ''),
        'aria-pressed': String(state.takesPerKey === n),
        onClick: () => { state.takesPerKey = n; store.updateSettings({ takesPerKey: n }); render(); },
      }, String(n))),
    );

    return h('div', { class: 'card stack prompt-card' + (recording ? ' recording' : '') },
      h('div', { class: 'status-line' },
        h('span', { class: 'status-chip', 'data-state': state.listen }, STATUS_TEXT[state.listen]),
        takesSel,
      ),
      meter.el,
      recording
        ? h('div', { class: 'prompt' },
            h('div', { class: 'prompt-big' }, `Press key ${i + 1} now`),
            h('div', { class: 'muted' },
              state.appendOne
                ? `Extra take ${profile.keys[i].takes.length + 1} of ${MAX_TAKES}`
                : roundTarget() > 1 ? `Take ${state.roundTakes + 1} of ${roundTarget()}` : 'One firm strike, then let it ring',
              state.mode === 'single' ? ' · this key only' : ''),
          )
        : h('div', { class: 'prompt' },
            h('div', { class: 'prompt-big' }, allDone ? 'All keys measured' : `Ready for key ${i + 1}`),
            h('div', { class: 'muted' }, allDone
              ? 'Tap Record on any key to redo it, or start again from key 1.'
              : 'Put the phone near the piano in a quiet room, then press Start.'),
          ),
      state.message && h('div', { class: 'msg ' + state.message.kind }, state.message.text),
      recording
        ? h('div', { class: 'row-actions' },
            state.mode === 'guided' && h('button', { class: 'btn', onClick: () => move(-1) }, '◀ Prev'),
            state.mode === 'guided' && h('button', { class: 'btn', onClick: skipCurrent }, 'Skip key'),
            state.mode === 'guided' && h('button', { class: 'btn', onClick: () => move(1) }, 'Next ▶'),
            h('button', { class: 'btn danger', onClick: stop }, 'Stop'),
          )
        : h('div', { class: 'row-actions' },
            h('button', {
              class: 'btn primary big',
              onClick: () => start('guided', allDone ? nextUnskipped(profile, 0) : state.current),
            }, allDone ? 'Start again from key 1' : `Start at key ${i + 1}`),
          ),
    );
  }

  function flagText(f) {
    if (f.code === 'not-rising') return `Not higher than key ${f.prev + 1} — octave error?`;
    if (f.code === 'big-jump') return `Jumps ${Math.round(f.semis)} semitones above key ${f.prev + 1} — octave error?`;
    if (f.code === 'takes-disagree') return 'Takes disagree — re-record this key.';
    return f.code;
  }

  function keyRow(k, i, flags) {
    const isCurrent = i === state.current;
    const note = k.freq != null ? freqToNote(k.freq) : null;
    const detail = k.skip
      ? 'skipped'
      : k.source === 'manual'
        ? 'set manually'
        : k.takes.length > 1
          ? k.takes.map(formatHz).join(' · ') + ` (spread ${Math.round(takeSpreadCents(k.takes))}¢)`
          : k.takes.length === 1 ? '1 take' : '';

    const row = h('li', {
      class: 'key-row' + (isCurrent ? ' current' : '') + (k.skip ? ' skipped' : '') + (flags.length ? ' flagged' : ''),
    },
      h('button', {
        class: 'key-num',
        title: 'Make this the current key',
        onClick: () => { if (state.mode !== 'single') { state.current = i; state.roundTakes = 0; render(); } },
      }, String(i + 1)),
      h('div', { class: 'key-main' },
        h('div', { class: 'key-freq' },
          k.skip ? h('span', { class: 'muted' }, '—') : note
            ? [h('strong', null, formatHz(k.freq) + ' Hz'), ' ', h('span', { class: 'note' }, note.name), ' ', h('span', { class: 'cents' }, formatCents(note.cents))]
            : h('span', { class: 'muted' }, 'not measured'),
        ),
        detail && h('div', { class: 'muted small' }, detail),
        flags.map((f) => h('div', { class: 'flag' }, '⚠ ' + flagText(f))),
      ),
      h('div', { class: 'key-actions' },
        h('button', { class: 'btn small', onClick: () => start('single', i), 'aria-label': `Record key ${i + 1}` }, 'Record'),
        h('button', {
          class: 'btn small',
          onClick: () => {
            const open = state.editing !== i;
            stop();
            state.editing = open ? i : null;
            state.focusEditor = open;
            render();
          },
        }, 'Edit'),
        h('button', {
          class: 'btn small' + (k.skip ? ' on' : ''),
          'aria-pressed': String(k.skip),
          onClick: () => { updateKey(i, (x) => ({ ...x, skip: !x.skip })); render(); },
        }, k.skip ? 'Unskip' : 'Skip'),
      ),
      state.editing === i && editor(k, i, flags),
    );
    return row;
  }

  function editor(k, i, flags) {
    const input = h('input', {
      type: 'text',
      value: k.freq != null ? formatHz(k.freq) : '',
      placeholder: '523.4  or  C5  or  C5+15',
      'aria-label': `Frequency or note for key ${i + 1}`,
      autocomplete: 'off',
      spellcheck: 'false',
      autocapitalize: 'off',
    });
    function save(e) {
      e.preventDefault();
      const f = parseFreqOrNote(input.value);
      if (f == null) { toast('Type a frequency in Hz (e.g. 523.4) or a note (e.g. C5, F#4, Bb5-20).', 'error'); return; }
      updateKey(i, (x) => setManual(x, f));
      state.editing = null;
      render();
    }
    const scale = (factor) => { updateKey(i, (x) => setManual(x, x.freq * factor)); render(); };
    const octaveFlag = flags.some((f) => f.code === 'not-rising' || f.code === 'big-jump');
    return h('form', { class: 'editor', onSubmit: save },
      h('div', { class: 'editor-row' }, input, h('button', { class: 'btn primary small', type: 'submit' }, 'Save')),
      h('div', { class: 'row-actions' },
        k.freq != null && h('button', { class: 'btn small' + (octaveFlag ? ' hint' : ''), type: 'button', onClick: () => scale(2) }, '×2 (octave up)'),
        k.freq != null && h('button', { class: 'btn small' + (octaveFlag ? ' hint' : ''), type: 'button', onClick: () => scale(0.5) }, '÷2 (octave down)'),
        k.source === 'detected' && k.takes.length < MAX_TAKES && h('button', {
          class: 'btn small', type: 'button',
          onClick: () => start('single', i, true),
        }, 'Add a take'),
        k.freq != null && h('button', { class: 'btn small', type: 'button', onClick: () => { updateKey(i, clearKey); state.editing = null; render(); } }, 'Clear'),
        h('button', { class: 'btn small', type: 'button', onClick: () => { state.editing = null; render(); } }, 'Cancel'),
      ),
    );
  }

  function render() {
    const flags = keyFlags(profile);
    const measured = profile.keys.filter((k) => !k.skip && k.freq != null).length;
    const skipped = profile.keys.filter((k) => k.skip).length;
    const flagged = flags.filter((f) => f.length).length;

    root.replaceChildren(
      h('section', { class: 'calibrate' },
        h('div', { class: 'view-head' },
          h('div', null,
            h('h1', null, profile.name),
            h('div', { class: 'muted small' },
              `${profile.numKeys} keys · ${measured} measured` + (skipped ? ` · ${skipped} skipped` : '') + (flagged ? ` · ${flagged} flagged` : '')),
          ),
          h('button', { class: 'btn', onClick: () => navigate('#/') }, 'Done'),
        ),
        h('div', { class: 'calibrate-grid' },
          promptCard(),
          h('ol', { class: 'key-list', 'aria-label': 'Keys' }, profile.keys.map((k, i) => keyRow(k, i, flags[i]))),
        ),
      ),
    );
    if (state.focusEditor) {
      state.focusEditor = false;
      const inp = root.querySelector('.editor input');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  render();

  return () => {
    if (listener) listener.stop();
    closeMic();
  };
}

function firstUnmeasured(profile) {
  const i = profile.keys.findIndex((k) => !k.skip && k.freq == null);
  if (i !== -1) return i;
  const j = profile.keys.findIndex((k) => !k.skip);
  return j === -1 ? 0 : j;
}

function nextUnskipped(profile, from) {
  for (let i = Math.max(0, from); i < profile.keys.length; i++) if (!profile.keys[i].skip) return i;
  return -1;
}

function prevUnskipped(profile, from) {
  for (let i = Math.min(from, profile.keys.length - 1); i >= 0; i--) if (!profile.keys[i].skip) return i;
  return -1;
}
