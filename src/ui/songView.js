// Songs screen: search (built-in, saved and online songs, plus a YouTube
// link), saved songs, and "Add a song" from a MIDI file, audio, or typed notes.

import { h, toast, setChildren } from './dom.js';
import { parseMidi } from '../song/midi.js';
import { parseNotation } from '../song/notation.js';
import { melodyOnly, noteStats, formatRange, formatDuration, notesForPiano } from '../song/melody.js';
import { meterFromText, barBeats } from '../song/sheet.js';
import { searchLocal, searchOnline, downloadMidi } from '../song/search.js';
import * as songs from '../song/songStore.js';
import { getActiveProfile } from '../profile/store.js';
import { keysFromProfile, searchTranspositions } from '../mapping/transpose.js';
import { createAudioImport } from './audioImport.js';
import { canCaptureTab } from '../audio/mic.js';

const EXAMPLE = 'C4 C4 G4 G4 A4 A4 G4/2 | F4 F4 E4 E4 D4 D4 C4/2';

export function songView(root, { navigate } = {}) {
  const search = {
    query: '',             // last searched text
    local: [],             // matching built-in / saved songs
    online: [],            // bitmidi results so far
    page: 0,
    pages: 0,
    loading: false,
    error: '',
    opening: null,         // id of the online result being downloaded
    controller: null,
  };
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

  const searchEl = h('div', { class: 'card stack' });
  const listEl = h('div');
  const addEl = h('div', { class: 'card stack' });
  const audioImport = createAudioImport({ save: (data) => save(data), navigate });

  // ---- song rows ----------------------------------------------------------
  function rowContext() {
    const profile = getActiveProfile();
    return { activeId: songs.getActiveSongId(), keys: profile ? keysFromProfile(profile) : [], profile };
  }

  function play(id) {
    songs.setActiveSongId(id);
    if (navigate) navigate('#/play');
  }

  function songRow(s, { activeId, keys, profile }) {
    const st = noteStats(s.notes);
    const isActive = s.id === activeId;
    const deletable = s.source !== 'library';
    const kind = s.source === 'midi' ? ' · MIDI' : s.source === 'text' ? ' · typed' : s.source === 'audio' ? ' · from audio' : '';
    // "fits 93%" for the active piano, at its best transposition.
    const fit = keys.length ? ` · fits your piano ${Math.round(searchTranspositions(notesForPiano(s.notes, profile), keys).best.fraction * 100)}%` : '';
    return h('li', { class: 'song-row' + (isActive ? ' active' : '') },
      h('div', { class: 'song-info' },
        h('div', { class: 'song-name' }, s.name, isActive && h('span', { class: 'badge' }, 'Active')),
        h('div', { class: 'muted small' },
          `${st.count} notes · ${formatRange(st)} · ${formatDuration(st.seconds)}${kind}${fit}`),
      ),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small primary', onClick: () => play(s.id) }, 'Play'),
        !isActive && h('button', { class: 'btn small', onClick: () => songs.setActiveSongId(s.id) }, 'Use'),
        deletable && h('button', {
          class: 'btn small danger',
          onClick: () => { if (confirm(`Delete “${s.name}”?`)) songs.deleteSong(s.id); },
        }, 'Delete'),
      ),
    );
  }

  // ---- search -------------------------------------------------------------
  const searchInput = h('input', {
    type: 'search', id: 'song-search', placeholder: 'Song name, e.g. Jingle Bells', autocomplete: 'off', enterKeyHint: 'search',
  });
  const searchForm = h('form', {
    class: 'search-row', role: 'search',
    onSubmit: (e) => { e.preventDefault(); runSearch(searchInput.value); },
  }, searchInput, h('button', { class: 'btn primary', type: 'submit' }, 'Search'));

  async function runSearch(text, page = 0) {
    const query = text.trim();
    if (search.controller) search.controller.abort();
    if (page === 0) {
      search.query = query;
      search.local = query ? searchLocal(query, [...songs.listSongs(), ...songs.listLibrary()]) : [];
      search.online = [];
      search.pages = 0;
    }
    search.error = '';
    if (!query) { search.loading = false; renderSearch(); return; }
    search.loading = true;
    renderSearch();
    const controller = new AbortController();
    search.controller = controller;
    try {
      const r = await searchOnline(query, page, { signal: controller.signal });
      if (controller.signal.aborted) return;
      search.online = [...search.online, ...r.results];
      search.page = page;
      search.pages = r.pages;
    } catch (err) {
      if (err.name === 'AbortError') return;
      search.error = err.message;
    }
    search.loading = false;
    renderSearch();
  }

  async function openOnline(result) {
    search.opening = result.id;
    renderSearch();
    try {
      const data = await downloadMidi(result);
      state.mode = 'midi';
      loadMidiData(data, result.file || result.title + '.mid', result.title, 'bitmidi.com');
      addEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message, 'error');
    }
    search.opening = null;
    renderSearch();
  }

  function renderSearch() {
    const parts = [h('h2', null, 'Find a song'), searchForm];
    if (search.query) {
      const ctx = rowContext();
      parts.push(
        h('h3', null, 'Built-in and your songs'),
        search.local.length
          ? h('ul', { class: 'song-list' }, search.local.map((s) => songRow(s, ctx)))
          : h('p', { class: 'muted small' }, `No saved or built-in song matches “${search.query}”.`),
        h('h3', null, 'Online MIDI files'),
      );
      if (search.online.length) {
        parts.push(h('ul', { class: 'song-list' }, search.online.map((r) => h('li', { class: 'song-row' },
          h('div', { class: 'song-info' },
            h('div', { class: 'song-name' }, r.title),
            h('div', { class: 'muted small' }, 'MIDI file · bitmidi.com'),
          ),
          h('div', { class: 'row-actions' },
            h('button', {
              class: 'btn small', disabled: search.opening != null,
              onClick: () => openOnline(r),
            }, search.opening === r.id ? 'Opening…' : 'Open'),
          ),
        ))));
      }
      if (search.loading) parts.push(h('p', { class: 'muted small' }, 'Searching bitmidi.com…'));
      else if (search.error) parts.push(h('div', { class: 'msg error' }, search.error));
      else if (!search.online.length) parts.push(h('p', { class: 'muted small' }, `No MIDI files found for “${search.query}”.`));
      else if (search.page + 1 < search.pages) {
        parts.push(h('button', { class: 'btn', onClick: () => runSearch(search.query, search.page + 1) }, 'More results'));
      }
      parts.push(h('p', { class: 'muted small' },
        'Online results are MIDI files shared by people on bitmidi.com, so quality varies. Open one, pick the track with the melody, and save it.'));
      parts.push(
        h('h3', null, 'On YouTube'),
        h('p', { class: 'muted small' }, canCaptureTab()
          ? 'No good MIDI file? Find the song on YouTube, play it in another tab, and the app writes down its notes.'
          : 'No good MIDI file? Find the song on YouTube, play it out loud from another device, and the app writes down its notes from the microphone.'),
        h('div', { class: 'row-actions' },
          h('a', {
            class: 'btn small', target: '_blank', rel: 'noopener noreferrer',
            href: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(search.query),
          }, 'Search YouTube ↗'),
          h('button', { class: 'btn small', onClick: () => openAudio(search.query) }, 'Get the notes from it'),
        ),
      );
    }
    setChildren(searchEl, parts);
  }

  /** Switch "Add a song" to From audio, e.g. after finding a song on YouTube. */
  function openAudio(nameHint) {
    audioImport.suggestName(nameHint);
    state.mode = 'audio';
    renderAdd();
    addEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- song lists ---------------------------------------------------------
  function renderList() {
    const mine = songs.listSongs();
    const ctx = rowContext();
    const keys = ctx.keys;
    const row = (s) => songRow(s, ctx);

    listEl.replaceChildren(
      h('div', { class: 'stack' },
        mine.length > 0 && h('div', { class: 'card stack' },
          h('h2', null, 'Your songs'),
          h('ul', { class: 'song-list' }, mine.map(row)),
        ),
        h('div', { class: 'card stack' },
          h('h2', null, 'Built-in songs'),
          !keys.length && h('p', { class: 'muted small' }, 'Calibrate a piano to see how well each song fits it.'),
          h('ul', { class: 'song-list' }, songs.listLibrary().map(row)),
        ),
      ),
    );
  }

  // ---- add a song ---------------------------------------------------------
  function renderAdd() {
    const tabs = h('div', { class: 'segmented wrap', role: 'tablist' },
      [['midi', 'MIDI file'], ['audio', 'From audio'], ['text', 'Type notes']].map(([id, label]) => h('button', {
        class: 'seg wide' + (state.mode === id ? ' on' : ''),
        role: 'tab',
        'aria-selected': String(state.mode === id),
        onClick: () => { state.mode = id; renderAdd(); },
      }, label)),
    );
    addEl.replaceChildren(
      h('h2', null, 'Add a song'),
      tabs,
      state.mode === 'midi' ? midiPanel() : state.mode === 'audio' ? audioImport.el : textPanel(),
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
          parts.push(h('div', { class: 'msg warn' }, 'Keeps the chords. Pianos set to one key at a time still play only the top note.'));
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
      );
      const saveMidi = (thenPlay) => {
        const ok = save({
          name: state.midiName,
          source: 'midi',
          bpm: state.parsed.bpm,
          notes,
          meter: midiMeter(state.parsed, notes),
          origin: { file: state.fileName, track: track.name, melodyOnly: track.polyphonic && state.melodyOnly, ...(state.from ? { from: state.from } : {}) },
        });
        if (ok && thenPlay && navigate) navigate('#/play');
      };
      parts.push(h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary', onClick: () => saveMidi(true) }, 'Save and play'),
        h('button', { class: 'btn', onClick: () => saveMidi(false) }, 'Save song'),
      ));
    }
    return h('div', { class: 'stack' }, parts);
  }

  async function loadMidiFile(file) {
    loadMidiData(new Uint8Array(await file.arrayBuffer()), file.name, '', '');
  }

  /** Show the track picker for MIDI data (from a file, or downloaded from a search). */
  function loadMidiData(data, fileName, nameHint, from) {
    state.fileName = fileName;
    state.from = from;
    state.midiError = '';
    state.parsed = null;
    state.trackIdx = -1;
    try {
      const parsed = parseMidi(data);
      state.parsed = parsed;
      state.trackIdx = parsed.suggested >= 0 ? parsed.suggested : parsed.tracks.findIndex((t) => !t.percussion);
      const profile = getActiveProfile();
      state.melodyOnly = !(profile && profile.chords);
      state.midiName = nameHint || parsed.name || fileName.replace(/\.(mid|midi|kar)$/i, '');
    } catch (err) {
      state.midiError = err.message;
    }
    renderAdd();
  }

  /** Time signature, and where in its bar the melody's first note falls. */
  function midiMeter(parsed, notes) {
    const first = Math.min(...notes.map((n) => n.startTime));
    const len = barBeats(parsed.meter);
    const beat = parsed.beatAt(first);
    return { ...parsed.meter, offset: Math.round((((beat % len) + len) % len) * 1000) / 1000 };
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
      const meter = meterFromText(state.text) || undefined;
      if (save({ name: state.textName, source: 'text', bpm: state.bpm, notes, text: state.text.trim(), meter })) {
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
        h('code', null, 'R'), ' for a rest (', h('code', null, 'R/2'), '). Bar lines ', h('code', null, '|'), ' set where the bars go in the sheet music.'),
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
      searchEl,
      listEl,
      addEl,
    ),
  );
  renderSearch();
  renderList();
  renderAdd();
  const off = songs.onSongsChange(() => { renderList(); if (search.query) renderSearch(); });
  return () => {
    off();
    if (search.controller) search.controller.abort();
    audioImport.destroy();
  };
}
