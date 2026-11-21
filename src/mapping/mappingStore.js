// Remembered fit settings per (piano profile, song) pair, so the tutor plays
// the song the way it was set up on the Map screen.

import { DEFAULT_TOLERANCE, STRATEGIES, keysFromProfile, searchTranspositions } from './transpose.js';

const KEY = 'tpt.v1.mappings';

let storage = typeof localStorage !== 'undefined' ? localStorage : null;

/** For tests: swap in an in-memory Storage-like object. */
export function useMappingStorage(s) {
  storage = s;
}

function readAll() {
  try {
    const v = JSON.parse((storage && storage.getItem(KEY)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

const pairKey = (profileId, songId) => `${profileId}|${songId}`;

export function getSavedMapping(profileId, songId) {
  return readAll()[pairKey(profileId, songId)] || null;
}

export function saveMapping(profileId, songId, { shift, tolerance, strategy }) {
  const all = readAll();
  all[pairKey(profileId, songId)] = { shift, tolerance, strategy };
  storage && storage.setItem(KEY, JSON.stringify(all));
}

/**
 * Settings to use for this piano + song: the saved ones, or defaults with the
 * best transposition found by the search.
 */
export function resolveMapping(profile, song) {
  const saved = getSavedMapping(profile.id, song.id);
  const tolerance = saved && saved.tolerance > 0 ? saved.tolerance : DEFAULT_TOLERANCE;
  const strategy = saved && STRATEGIES.includes(saved.strategy) ? saved.strategy : 'fold';
  let shift = saved && Number.isFinite(saved.shift) ? saved.shift : null;
  if (shift == null) {
    const keys = keysFromProfile(profile);
    shift = keys.length ? searchTranspositions(song.notes, keys, { tolerance }).best.shift : 0;
  }
  return { shift, tolerance, strategy, saved: Boolean(saved) };
}
