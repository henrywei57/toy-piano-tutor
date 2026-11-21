// Profile persistence in localStorage, plus JSON export / import.

import { createProfile, normalizeProfile, newId } from './profile.js';

const PROFILES_KEY = 'tpt.v1.profiles';
const ACTIVE_KEY = 'tpt.v1.activeProfile';
const SETTINGS_KEY = 'tpt.v1.settings';
const FILE_TAG = 'toy-piano-tutor/profiles';

let storage = typeof localStorage !== 'undefined' ? localStorage : null;
const listeners = new Set();

/** For tests: swap in an in-memory Storage-like object. */
export function useStorage(s) {
  storage = s;
}

function read(key, fallback) {
  try {
    const raw = storage && storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  storage && storage.setItem(key, JSON.stringify(value));
}

function notify() {
  for (const fn of listeners) fn();
}

export function onProfilesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listProfiles() {
  const list = read(PROFILES_KEY, []);
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    try { out.push(normalizeProfile(raw)); } catch { /* drop corrupt entry */ }
  }
  return out;
}

function saveAll(list) {
  write(PROFILES_KEY, list);
  notify();
}

export function getProfile(id) {
  return listProfiles().find((p) => p.id === id) || null;
}

export function saveProfile(profile) {
  const list = listProfiles();
  const updated = { ...profile, updatedAt: Date.now() };
  const i = list.findIndex((p) => p.id === profile.id);
  if (i >= 0) list[i] = updated;
  else list.push(updated);
  saveAll(list);
  return updated;
}

export function addProfile(name, numKeys) {
  const p = createProfile(name, numKeys);
  saveProfile(p);
  setActiveId(p.id);
  return p;
}

export function renameProfile(id, name) {
  const p = getProfile(id);
  if (!p) return null;
  return saveProfile({ ...p, name: String(name).trim() || p.name });
}

/** One key at a time (false) or several keys at once (true). */
export function setChords(id, on) {
  const p = getProfile(id);
  if (!p) return null;
  return saveProfile({ ...p, chords: Boolean(on) });
}

export function duplicateProfile(id) {
  const p = getProfile(id);
  if (!p) return null;
  const now = Date.now();
  const copy = {
    ...structuredClone(p),
    id: newId(),
    name: p.name + ' (copy)',
    createdAt: now,
    updatedAt: now,
  };
  return saveProfile(copy);
}

export function deleteProfile(id) {
  saveAll(listProfiles().filter((p) => p.id !== id));
  if (getActiveId() === id) setActiveId(null);
}

export function getActiveId() {
  const id = read(ACTIVE_KEY, null);
  return id && getProfile(id) ? id : null;
}

export function setActiveId(id) {
  write(ACTIVE_KEY, id);
  notify();
}

export function getActiveProfile() {
  const id = getActiveId();
  return id ? getProfile(id) : null;
}

export function getSettings() {
  return { takesPerKey: 2, ...read(SETTINGS_KEY, {}) };
}

export function updateSettings(patch) {
  const s = { ...getSettings(), ...patch };
  write(SETTINGS_KEY, s);
  return s;
}

/** JSON text for the given profiles (all of them by default). */
export function exportProfiles(profiles = listProfiles()) {
  return JSON.stringify({ app: FILE_TAG, version: 1, exportedAt: new Date().toISOString(), profiles }, null, 2);
}

/**
 * Parse an export file (or a bare profile / array of profiles) and add the
 * profiles. Profiles whose id already exists are added as new copies, so an
 * import never overwrites existing data.
 * @returns {number} how many profiles were imported
 */
export function importProfiles(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const rawList = Array.isArray(data) ? data : Array.isArray(data?.profiles) ? data.profiles : [data];
  const incoming = rawList.map(normalizeProfile);
  if (!incoming.length) throw new Error('No profiles found in that file.');
  const list = listProfiles();
  const ids = new Set(list.map((p) => p.id));
  for (const p of incoming) {
    if (ids.has(p.id)) p.id = newId();
    ids.add(p.id);
    list.push(p);
  }
  saveAll(list);
  return incoming.length;
}
