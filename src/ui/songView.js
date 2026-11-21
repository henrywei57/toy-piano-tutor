// Songs screen: saved songs, plus "Add a song" from a MIDI file or typed notes.

import { h, toast, setChildren } from './dom.js';
import { parseMidi } from '../song/midi.js';
import { parseNotation } from '../song/notation.js';
import { melodyOnly, noteStats, formatRange, formatDuration } from '../song/melody.js';
import * as songs from '../song/songStore.js';
import { getActiveProfile } from '../profile/store.js';
import { keysFromProfile, searchTranspositions } from '../mapping/transpose.js';

const EXAMPLE = 'C4 C4 G4 G4 A4 A4 G4/2 | F4 F4 E4 E4 D4 D4 C4/2';

export function songView(root) {
  const state = {
    mode: 'midi',          // 'midi' | 'text'
    // MIDI
    fileName: '',
    parsed: null,          // parseMidi() result
    trackIdx: -1,          // index into parsed.tracks
    melodyOnly: true,
    midiName: '',
    midiError: '',
    // typed
    text: '',
    bpm: 100,
    textName: '',
  };

  const listEl = h('div');
  const addEl = h('div', { class: 'card stack' });

  // ---- song lists ---------------------------------------------------------
  function renderList() {
    const mine = songs.listSongs();
    const activeId = songs.getActiveSongId();
    const profile = getActiveProfile();
    const keys = profile ? keysFromProfile(profile) : [];

    // "fits 93%" for the active piano, at its best transposition.
    const fitText = (s) => {
      if (!keys.length) return '';
      const pct = Math.round(searchTranspositions(s.notes, keys).best.fraction * 100);
      return ` · fits your piano ${pct}%`;
    };

    const row = (s, deletable) => {
      const st = noteStats(s.notes);
      const isActive = s.id === activeId;
      const kind = s.source === 'midi' ? ' · MIDI' : s.source === 'text' ? ' · typed' : '';
      return h('li', { class: 'song-row' + (isActive ? ' active' : '') },
        h('div', { class: 'song-info' },
          h('div', { class: 'song-name' }, s.name, isActive && h('span', { class: 'badge' }, 'Active')),
          h('div', { class: 'muted small' },
            `${st.count} notes · ${formatRange(st)} · ${formatDuration(st.seconds)}${kind}${fitText(s)}`),
        ),
        h('div', { class: 'row-actions' },
          !isActive && h('button', { class: 'btn small', onClick: () => songs.setActiveSongId(s.id) }, 'Use'),
          deletable && h('button', {
            class: 'btn small danger',
            onClick: () => { if (confirm(`Delete “${s.name}”?`)) songs.deleteSong(s.id); },
          }, 'Delete'),
        ),
      );
    };

    listEl.replaceChildren(
      h('div', { class: 'stack' },
        mine.length > 0 && h('div', { class: 'card stack' },
          h('h2', null, 'Your songs'),
          h('ul', { class: 'song-list' }, mine.map((s) => row(s, true))),
        ),
        h('div', { class: 'card stack' },
          h('h2', null, 'Built-in songs'),
          !keys.length && h('p', { class: 'muted small' }, 'Calibrate a piano to see how well each song fits it.'),
          h('ul', { class: 'song-list' }, songs.listLibrary().map((s) => row(s, false))),
        ),
      ),
    );
  }

  // ---- add a song ---------------------------------------------------------
  function renderAdd() {
    const tabs = h('div', { class: 'segmented', role: 'tablist' },
      [['midi', 'MIDI file'], ['text', 'Type notes']].map(([id, label]) => h('button', {
        class: 'seg wide' + (state.mode === id ? ' on' : ''),
        role: 'tab',
        'aria-selected': String(state.mode === id),
        onClick: () => { state.mode = id; renderAdd(); },
      }, label)),
    );
    addEl.replaceChildren(
      h('h2', null, 'Add a song'),
      tabs,
      state.mode === 'midi' ? midiPanel() : textPanel(),
    );
  }

  function midiPanel() {
    const fileInput = h('input', {
      type: 'file',
      accept: '.mid,.midi,audio/midi,audio/x-midi',
      class: 'visually-hidden',
      id: 'midi-file',
      onChange: async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        await loadMidiFile(file);
      },
    });

    const parts = [
      h('div', { class: 'file-row' },
        h('label', { class: 'btn', for: 'midi-file' }, state.parsed ? 'Choose another file' : 'Choose a .mid file'),
        fileInput,
        state.fileName && h('span', { class: 'muted small file-name' }, state.fileName),
      ),
    ];
    if (state.midiError) parts.push(h('div', { class: 'msg error' }, state.midiError));
    if (!state.parsed) {
      parts.push(h('p', { class: 'muted small' }, 'Pick a MIDI file, then choose which track holds the melody.'));
      return h('div', { class: 'stack' }, parts);
    }

    const { tracks, suggested } = state.parsed;
    parts.push(
      h('div', { class: 'muted small' }, 'Which track is the melody?'),
      h('div', { class: 'track-list', role: 'radiogroup' }, tracks.map((t, i) => {
        const id = 'track-' + i;
        return h('label', { class: 'track' + (t.percussion ? ' disabled' : '') + (i === state.trackIdx ? ' on' : ''), for: id },
          h('input', {
            type: 'radio', name: 'track', id, disabled: t.percussion, checked: i === state.trackIdx,
            onChange: () => { state.trackIdx = i; renderAdd(); },
          }),
          h('span', { class: 'track-text' },
            h('span', { class: 'track-name' }, t.name, i === suggested && h('span', { class: 'badge' }, 'Likely melody')),
            h('span', { class: 'muted small' },
              t.percussion
                ? 'Drums — can’t be played on a piano'
                : [t.instrument, `${t.stats.count} notes`, formatRange(t.stats), t.polyphonic ? 'has chords' : 'single notes']
                    .filter(Boolean).join(' · ')),
          ),
        );
      })),
    );

    const track = tracks[state.trackIdx];
    if (track) {
      const notes = track.polyphonic && state.melodyOnly ? melodyOnly(track.notes) : track.notes;
      const st = noteStats(notes);
      if (track.polyphonic) {
        parts.push(h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: state.melodyOnly, onChange: (e) => { state.melodyOnly = e.target.checked; renderAdd(); } }),
          h('span', null, 'Melody only (keep the highest note at each moment)'),
        ));
        if (!state.melodyOnly) {
          parts.push(h('div', { class: 'msg warn' }, 'This track plays several notes at once. A toy piano tutor works best with one note at a time.'));
        }
      }
      parts.push(
        h('div', { class: 'summary' },
          h('strong', null, `${st.count} notes`), ` · ${formatRange(st)} · ${formatDuration(st.seconds)}`,
          track.polyphonic && state.melodyOnly ? h('span', { class: 'muted' }, ` (from ${track.stats.count})`) : null,
        ),
        h('label', { for: 'midi-name' }, 'Song name'),
        h('input', {
          type: 'text', id: 'midi-name', value: state.midiName, maxLength: 80,
          onInput: (e) => { state.midiName = e.target.value; },
        }),
        h('button', {
          class: 'btn primary',
          onClick: () => save({
            name: state.midiName,
            source: 'midi',
            bpm: state.parsed.bpm,
            notes,
            origin: { file: state.fileName, track: track.name, melodyOnly: track.polyphonic && state.melodyOnly },
          }),
        }, 'Save song'),
      );
    }
    return h('div', { class: 'stack' }, parts);
  }

  async function loadMidiFile(file) {
    state.fileName = file.name;
    state.midiError = '';
    state.parsed = null;
    state.trackIdx = -1;
    try {
      const parsed = parseMidi(new Uint8Array(await file.arrayBuffer()));
      state.parsed = parsed;
      state.trackIdx = parsed.suggested >= 0 ? parsed.suggested : parsed.tracks.findIndex((t) => !t.percussion);
      state.melodyOnly = true;
      state.midiName = parsed.name || file.name.replace(/\.(mid|midi)$/i, '');
    } catch (err) {
      state.midiError = err.message;
    }
    renderAdd();
  }

  function textPanel() {
    const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
    const textarea = h('textarea', {
      id: 'notes-text',
      rows: 5,
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
      autocomplete: 'off',
      placeholder: 'C4 D4 E4 C4/2 G4',
      onInput: (e) => { state.text = e.target.value; updatePreview(); },
    });
    textarea.value = state.text;
    const bpmInput = h('input', {
      type: 'number', id: 'notes-bpm', min: 20, max: 300, value: String(state.bpm), inputMode: 'numeric',
      onInput: (e) => { state.bpm = Number(e.target.value); updatePreview(); },
    });
    const saveBtn = h('button', { class: 'btn primary', onClick: saveTyped }, 'Save song');

    function updatePreview() {
      const bpmOk = state.bpm >= 20 && state.bpm <= 300;
      const { notes, errors } = parseNotation(state.text, { bpm: bpmOk ? state.bpm : 100 });
      const st = noteStats(notes);
      saveBtn.disabled = !notes.length || errors.length > 0 || !bpmOk;
      if (!state.text.trim()) {
        preview.replaceChildren();
        return;
      }
      const parts = [
        errors.length
          ? h('div', { class: 'msg error' },
              errors.slice(0, 5).map((e) => h('div', null, `Note ${e.index + 1} “${e.token}”: ${e.message}`)),
              errors.length > 5 ? h('div', null, `…and ${errors.length - 5} more`) : null)
          : h('div', { class: 'summary' }, h('strong', null, `${st.count} notes`), ` · ${formatRange(st)} · ${formatDuration(st.seconds)}`),
      ];
      if (!bpmOk) parts.push(h('div', { class: 'msg error' }, 'Tempo must be between 20 and 300 BPM.'));
      setChildren(preview, parts);
    }

    function saveTyped() {
      const { notes, errors } = parseNotation(state.text, { bpm: state.bpm });
      if (errors.length || !notes.length) return;
      if (save({ name: state.textName, source: 'text', bpm: state.bpm, notes, text: state.text.trim() })) {
        state.text = '';
        state.textName = '';
        renderAdd();
      }
    }

    const panel = h('div', { class: 'stack' },
      h('label', { for: 'text-name' }, 'Song name'),
      h('input', {
        type: 'text', id: 'text-name', value: state.textName, maxLength: 80, placeholder: 'e.g. Twinkle Twinkle',
        onInput: (e) => { state.textName = e.target.value; },
      }),
      h('div', { class: 'label-row' },
        h('label', { for: 'notes-text' }, 'Notes'),
        h('button', {
          class: 'link', type: 'button',
          onClick: () => {
            state.text = EXAMPLE;
            textarea.value = EXAMPLE;
            if (!state.textName) { state.textName = 'Twinkle Twinkle Little Star'; panel.querySelector('#text-name').value = state.textName; }
            updatePreview();
          },
        }, 'Use an example'),
      ),
      textarea,
      h('div', { class: 'muted small' },
        'Quarter notes by default. Add ', h('code', null, '/2'), ' half, ', h('code', null, '/8'), ' eighth, ',
        h('code', null, '/1'), ' whole; ', h('code', null, '.'), ' for dotted (', h('code', null, 'D4/4.'), '); ',
        h('code', null, 'R'), ' for a rest (', h('code', null, 'R/2'), '). Bar lines ', h('code', null, '|'), ' are ignored.'),
      h('label', { for: 'notes-bpm' }, 'Tempo (beats per minute)'),
      bpmInput,
      preview,
      saveBtn,
    );
    updatePreview();
    return panel;
  }

  function save(data) {
    try {
      const song = songs.addSong(data);
      toast(`Saved “${song.name}”. It’s now the active song.`);
      if (data.source === 'midi') {
        state.parsed = null;
        state.fileName = '';
        state.trackIdx = -1;
        renderAdd();
      }
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  }

  root.replaceChildren(
    h('section', { class: 'stack' },
      h('h1', null, 'Songs'),
      listEl,
      addEl,
    ),
  );
  renderList();
  renderAdd();
  const off = songs.onSongsChange(renderList);
  return () => off();
}
