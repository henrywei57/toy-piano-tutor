// Map screen: fit the active song onto the active piano's real keys.

import { h, setChildren } from './dom.js';
import { getActiveProfile } from '../profile/store.js';
import { keyFlags } from '../profile/profile.js';
import { getActiveSong } from '../song/songStore.js';
import { noteStats, formatRange, notesForPiano, isPolyphonic } from '../song/melody.js';
import { freqToNote, midiToName } from '../audio/notes.js';
import {
  keysFromProfile, searchTranspositions, mapNotes, mappingSummary, explainFit, formatShift,
} from '../mapping/transpose.js';
import { resolveMapping, saveMapping } from '../mapping/mappingStore.js';

const STRATEGY_TEXT = {
  fold: ['Octave-fold', 'Move the note up or down by whole octaves until it lands on a key. If that note isn’t on your piano in any octave, use the nearest key.'],
  nearest: ['Nearest key', 'Play the closest key, even if it’s a different note.'],
  skip: ['Skip', 'Leave those notes out.'],
};

const STATUS_LABEL = { exact: 'on a key', folded: 'moved an octave', nearest: 'nearest key', skipped: 'skipped' };

export function mapView(root) {
  const profile = getActiveProfile();
  const song = getActiveSong();
  const keys = profile ? keysFromProfile(profile) : [];

  if (!profile || !keys.length || !song) {
    root.replaceChildren(h('section', { class: 'stack' },
      h('h1', null, 'Fit the song to your piano'),
      h('div', { class: 'card stack' },
        !profile && [h('p', null, 'First create a profile for your toy piano.'), h('a', { class: 'btn primary', href: '#/' }, 'Go to Pianos')],
        profile && !keys.length && [h('p', null, `“${profile.name}” has no measured keys yet. Calibrate it first.`), h('a', { class: 'btn primary', href: '#/calibrate' }, 'Calibrate')],
        profile && keys.length > 0 && !song && [h('p', null, 'Pick a song to fit onto your piano — there are built-in ones to start with.'), h('a', { class: 'btn primary', href: '#/song' }, 'Choose a song')],
      ),
    ));
    return () => {};
  }

  const settings = resolveMapping(profile, song);
  const state = { shift: settings.shift, tolerance: settings.tolerance, strategy: settings.strategy };
  const persist = () => saveMapping(profile.id, song.id, state);
  if (!settings.saved) persist();

  // A piano that plays one key at a time gets the song's melody.
  const notes = notesForPiano(song.notes, profile);
  const reduced = notes !== song.notes;
  const songStats = noteStats(notes);
  const keyNames = profile.keys.map((k) => (k.freq ? freqToNote(k.freq).name : ''));
  const flaggedKeys = keyFlags(profile).filter((f) => f.some((x) => x.code === 'not-rising' || x.code === 'big-jump')).length;

  // ---- static controls (built once so the slider keeps working while dragged)
  const resultEl = h('div', { class: 'card stack fit-result' });
  const select = h('select', {
    id: 'shift-select',
    onChange: (e) => { state.shift = Number(e.target.value); persist(); refresh(); },
  });
  const bestBtn = h('button', { class: 'btn small', onClick: () => { state.shift = search.best.shift; persist(); refresh(); } });
  const tolValue = h('span', { class: 'tol-value' });
  const tolInput = h('input', {
    type: 'range', id: 'tolerance', min: 10, max: 100, step: 5, value: String(state.tolerance),
    onInput: (e) => { state.tolerance = Number(e.target.value); persist(); refresh(); },
  });
  const stratButtons = Object.keys(STRATEGY_TEXT).map((id) => h('button', {
    class: 'seg wide',
    onClick: () => { state.strategy = id; persist(); refresh(); },
  }, STRATEGY_TEXT[id][0]));
  const stratHelp = h('p', { class: 'muted small' });
  const keysEl = h('div', { class: 'card stack' });
  const notesEl = h('div', { class: 'card stack' });

  const controls = h('div', { class: 'card stack' },
    h('label', { for: 'shift-select' }, 'Transposition'),
    h('div', { class: 'select-row' }, select, bestBtn),
    h('label', { for: 'tolerance' }, 'Tolerance ', tolValue),
    tolInput,
    h('div', { class: 'muted small' }, 'How far (in cents) a key may be from the wanted note and still count as that note. 100 cents = 1 semitone.'),
    h('div', { class: 'label-like' }, 'Notes without a matching key'),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Notes without a matching key' }, stratButtons),
    stratHelp,
  );

  let search = null;

  function refresh() {
    search = searchTranspositions(notes, keys, { tolerance: state.tolerance });
    const current = search.results.find((r) => r.shift === state.shift) || search.results[0];
    const mapped = mapNotes(notes, keys, state);
    const summary = mappingSummary(mapped);
    const fit = explainFit(notes, keys, state);
    if (flaggedKeys) {
      fit.reasons.push(`${flaggedKeys} key${flaggedKeys === 1 ? ' is' : 's are'} flagged as a possible octave error in Calibrate. Fixing ${flaggedKeys === 1 ? 'it' : 'them'} may change the fit.`);
    }

    // Result
    const pct = Math.round(current.fraction * 100);
    const substituteLine = state.strategy === 'skip'
      ? (summary.skipped ? `${summary.skipped} note${summary.skipped === 1 ? '' : 's'} will be skipped.` : '')
      : [summary.folded && `${summary.folded} moved by an octave`, summary.nearest && `${summary.nearest} played on the nearest key`]
          .filter(Boolean).join(', ');
    const isBest = current.matched >= search.best.matched;
    setChildren(resultEl,
      h('div', { class: 'fit-headline' },
        h('span', { class: 'fit-pct level-' + fit.level }, pct + '%'),
        h('span', null, ' of notes playable at ', h('strong', null, formatShift(state.shift))),
      ),
      substituteLine && h('div', { class: 'muted' }, substituteLine.charAt(0).toUpperCase() + substituteLine.slice(1) + (state.strategy === 'skip' ? '' : '.')),
      !isBest && h('div', { class: 'msg warn' },
        `The best fit is ${formatShift(search.best.shift)} (${Math.round(search.best.fraction * 100)}%).`),
      h('div', { class: 'msg ' + ({ good: 'ok', ok: 'warn', poor: 'error', bad: 'error' })[fit.level] },
        h('div', null, fit.headline),
        fit.reasons.length > 0 && h('ul', { class: 'reasons' }, fit.reasons.map((r) => h('li', null, r))),
      ),
    );

    // Controls
    select.replaceChildren(...search.results.map((r) => {
      const label = (r.shift > 0 ? '+' : r.shift < 0 ? '−' : '') + Math.abs(r.shift)
        + `  —  ${Math.round(r.fraction * 100)}%` + (r.shift === search.best.shift ? '  ★ best' : '');
      return h('option', { value: String(r.shift), selected: r.shift === state.shift }, label);
    }));
    select.value = String(state.shift);
    bestBtn.textContent = `Use best (${formatShift(search.best.shift)})`;
    bestBtn.disabled = state.shift === search.best.shift;
    tolValue.textContent = `±${state.tolerance}¢`;
    stratButtons.forEach((b, i) => {
      const on = Object.keys(STRATEGY_TEXT)[i] === state.strategy;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    stratHelp.textContent = STRATEGY_TEXT[state.strategy][1];

    renderKeys(mapped);
    renderNotes(mapped, summary);
  }

  function renderKeys(mapped) {
    const use = new Map();
    for (const m of mapped) if (m.key != null) use.set(m.key, (use.get(m.key) || 0) + 1);
    const max = Math.max(1, ...use.values());
    keysEl.replaceChildren(
      h('h2', null, 'Your keys'),
      h('div', { class: 'muted small' }, 'How often the song uses each key.'),
      h('div', { class: 'key-strip' }, profile.keys.map((k, i) => {
        const count = use.get(i) || 0;
        const note = k.freq ? freqToNote(k.freq).name : '';
        return h('div', {
          class: 'kbox' + (k.skip ? ' skip' : '') + (!k.freq ? ' unmeasured' : '') + (count ? ' used' : ''),
          style: count ? { '--use': String(0.25 + 0.75 * (count / max)) } : null,
          title: k.skip ? `Key ${i + 1}: skipped` : k.freq ? `Key ${i + 1}: ${note}, used ${count}×` : `Key ${i + 1}: not measured`,
        },
          h('span', { class: 'kbox-num' }, String(i + 1)),
          h('span', { class: 'kbox-note' }, k.skip ? 'skip' : note || '—'),
          h('span', { class: 'kbox-count' }, count ? `${count}×` : ''),
        );
      })),
    );
  }

  function renderNotes(mapped, summary) {
    notesEl.replaceChildren(
      h('h2', null, 'Song notes'),
      h('div', { class: 'legend' },
        ['exact', 'folded', 'nearest', 'skipped'].map((s) => h('span', { class: 'legend-item' },
          h('span', { class: 'dot ' + s }), `${summary[s]} ${STATUS_LABEL[s]}`)),
      ),
      h('div', { class: 'muted small' }, 'Each chip is one note in order: the key to press, and the note it should sound.'),
      h('ol', { class: 'note-chips' }, mapped.map((m) => {
        const want = midiToName(Math.round(m.target));
        const detail = m.status === 'skipped'
          ? `${want}: no key — skipped`
          : `${want} → key ${m.key + 1} (${keyNames[m.key]})` +
            (m.status === 'folded' ? `, moved ${m.octaves > 0 ? 'up' : 'down'} ${Math.abs(m.octaves)} octave${Math.abs(m.octaves) > 1 ? 's' : ''}` : '') +
            (m.status === 'nearest' ? `, ${Math.round(Math.abs(m.cents))}¢ off` : '');
        return h('li', { class: 'chip ' + m.status, title: detail, 'aria-label': detail },
          h('span', { class: 'chip-key' }, m.key == null ? '–' : String(m.key + 1)),
          h('span', { class: 'chip-note' },
            want,
            m.status === 'folded' ? (m.octaves > 0 ? ' ↑' : ' ↓') : '',
            m.status === 'nearest' ? ' ≈' : ''),
        );
      })),
    );
  }

  root.replaceChildren(
    h('section', { class: 'stack' },
      h('h1', null, 'Fit the song to your piano'),
      h('div', { class: 'card context' },
        h('div', null,
          h('div', { class: 'muted small' }, 'Song'),
          h('div', { class: 'song-name' }, song.name),
          h('div', { class: 'muted small' }, `${songStats.count} notes · ${formatRange(songStats)}`),
          reduced && h('div', { class: 'muted small' }, 'Melody only: this piano plays one key at a time.'),
          !reduced && profile.chords && isPolyphonic(notes) && h('div', { class: 'muted small' }, 'With chords: this piano plays several keys at once.'),
          h('a', { class: 'small', href: '#/song' }, 'Change song'),
        ),
        h('div', null,
          h('div', { class: 'muted small' }, 'Piano'),
          h('div', { class: 'song-name' }, profile.name),
          h('div', { class: 'muted small' },
            `${keys.length} usable key${keys.length === 1 ? '' : 's'} · ${midiToName(Math.round(keys[0].midi))}–${midiToName(Math.round(keys[keys.length - 1].midi))}`),
          h('a', { class: 'small', href: '#/' }, 'Change piano'),
        ),
      ),
      h('div', { class: 'map-grid' },
        h('div', { class: 'stack' }, resultEl, controls),
        h('div', { class: 'stack' }, keysEl, notesEl),
      ),
      h('p', { class: 'muted small' }, 'These settings are saved for this song on this piano and will be used in the tutor.'),
    ),
  );
  refresh();
  return () => {};
}
