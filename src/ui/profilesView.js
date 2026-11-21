// Profiles screen: create, pick, rename, duplicate, delete, export/import.

import { h, downloadText, pickFile, toast } from './dom.js';
import * as store from '../profile/store.js';
import { MAX_KEYS } from '../profile/profile.js';

export function profilesView(root, { navigate }) {
  function render() {
    const profiles = store.listProfiles();
    const activeId = store.getActiveId();

    const nameInput = h('input', { type: 'text', placeholder: 'e.g. Red toy piano', maxLength: 80, id: 'new-name', autocomplete: 'off' });
    const keysInput = h('input', { type: 'number', min: 1, max: MAX_KEYS, value: '15', inputMode: 'numeric', id: 'new-keys' });

    function create(e) {
      e.preventDefault();
      const n = Number(keysInput.value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_KEYS) {
        toast(`Number of keys must be a whole number from 1 to ${MAX_KEYS}.`, 'error');
        keysInput.focus();
        return;
      }
      const p = store.addProfile(nameInput.value, n);
      navigate('#/calibrate/' + p.id);
    }

    const cards = profiles.map((p) => {
      const measured = p.keys.filter((k) => k.freq != null && !k.skip).length;
      const skipped = p.keys.filter((k) => k.skip).length;
      const isActive = p.id === activeId;
      return h('li', { class: 'card profile-card' + (isActive ? ' active' : '') },
        h('div', { class: 'profile-head' },
          h('div', null,
            h('div', { class: 'profile-name' }, p.name, isActive && h('span', { class: 'badge' }, 'Active')),
            h('div', { class: 'muted small' },
              `${p.numKeys} keys · ${measured} measured` + (skipped ? ` · ${skipped} skipped` : '')),
          ),
          h('button', {
            class: 'btn primary',
            onClick: () => { store.setActiveId(p.id); navigate('#/calibrate/' + p.id); },
          }, measured ? 'Open' : 'Calibrate'),
        ),
        h('div', { class: 'stack tight' },
          h('div', { class: 'label-like', id: 'keys-at-once-' + p.id }, 'Keys at once'),
          h('div', { class: 'segmented wrap', role: 'group', 'aria-labelledby': 'keys-at-once-' + p.id },
            [[false, 'One key at a time'], [true, 'Several keys (chords)']].map(([on, label]) => h('button', {
              class: 'seg wide' + (Boolean(p.chords) === on ? ' on' : ''),
              'aria-pressed': String(Boolean(p.chords) === on),
              onClick: () => { if (Boolean(p.chords) !== on) store.setChords(p.id, on); },
            }, label)),
          ),
          h('div', { class: 'muted small' }, p.chords
            ? 'Songs keep their chords, and Listen & wait listens for every key of a chord.'
            : 'Songs with chords are played as their melody: the top note at each moment.'),
        ),
        h('div', { class: 'row-actions' },
          !isActive && h('button', { class: 'btn small', onClick: () => { store.setActiveId(p.id); toast(`“${p.name}” is now active`); } }, 'Set active'),
          h('button', {
            class: 'btn small',
            onClick: () => {
              const name = prompt('Rename profile', p.name);
              if (name != null && name.trim()) store.renameProfile(p.id, name);
            },
          }, 'Rename'),
          h('button', { class: 'btn small', onClick: () => { store.duplicateProfile(p.id); toast('Profile duplicated'); } }, 'Duplicate'),
          h('button', { class: 'btn small', onClick: () => downloadText(fileName(p.name), store.exportProfiles([p])) }, 'Export'),
          h('button', {
            class: 'btn small danger',
            onClick: () => {
              if (confirm(`Delete “${p.name}”? This can't be undone.`)) store.deleteProfile(p.id);
            },
          }, 'Delete'),
        ),
      );
    });

    root.replaceChildren(
      h('section', { class: 'stack' },
        h('h1', null, 'Your toy pianos'),
        profiles.length
          ? h('ul', { class: 'profile-list' }, cards)
          : h('p', { class: 'muted' }, 'Create a profile for your toy piano to get started. You’ll then play each key once or twice so the app learns how your piano really sounds.'),

        h('form', { class: 'card stack', onSubmit: create },
          h('h2', null, 'New profile'),
          h('label', { for: 'new-name' }, 'Name'),
          nameInput,
          h('label', { for: 'new-keys' }, 'Number of keys (count every key you can press, left to right)'),
          keysInput,
          h('button', { class: 'btn primary', type: 'submit' }, 'Create and calibrate'),
        ),

        h('div', { class: 'row-actions' },
          profiles.length > 0 && h('button', {
            class: 'btn',
            onClick: () => downloadText('toy-piano-profiles.json', store.exportProfiles()),
          }, 'Export all'),
          h('button', {
            class: 'btn',
            onClick: async () => {
              const file = await pickFile('application/json,.json');
              if (!file) return;
              try {
                const n = store.importProfiles(await file.text());
                toast(`Imported ${n} profile${n === 1 ? '' : 's'}`);
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          }, 'Import…'),
        ),
      ),
    );
  }

  render();
  const off = store.onProfilesChange(render);
  return () => off();
}

function fileName(name) {
  return 'toy-piano-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile') + '.json';
}
