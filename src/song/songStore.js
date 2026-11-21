// Saved songs in localStorage. Only the chosen melody is stored (not the
// whole MIDI file), normalised to { midi, startTime, duration } in seconds.
//
// song = { id, name, source: 'midi'|'text', bpm, notes, createdAt, text?, origin? }

import { normalizeNotes } from './melody.js';

const SONGS_KEY = 'tpt.v1.songs';
const ACTIVE_KEY = 'tpt.v1.activeSong';

let storage = typeof localStorage !== 'undefined' ? localStorage : null;
const listeners = new Set();

/** For tests: swap in an in-memory Storage-like object. */
export function useSongStorage(s) {
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
  try {
    storage && storage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Not enough browser storage to save this song. Delete some songs and try again.');
  }
}

function notify() {
  for (const fn of listeners) fn();
}

export function onSongsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listSongs() {
  const list = read(SONGS_KEY, []);
  return Array.isArray(list) ? list.filter((s) => s && s.id && Array.isArray(s.notes)) : [];
}

export function getSong(id) {
  return listSongs().find((s) => s.id === id) || null;
}

/** Save a new song and make it the active one. */
export function addSong({ name, source, bpm, notes, text, origin }) {
  const song = {
    id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: String(name || '').trim().slice(0, 80) || 'Untitled song',
    source,
    bpm: bpm > 0 ? bpm : 120,
    notes: normalizeNotes(notes),
    createdAt: Date.now(),
  };
  if (text != null) song.text = text;
  if (origin) song.origin = origin;
  if (!song.notes.length) throw new Error('This song has no notes.');
  write(SONGS_KEY, [...listSongs(), song]);
  write(ACTIVE_KEY, song.id);
  notify();
  return song;
}

export function deleteSong(id) {
  write(SONGS_KEY, listSongs().filter((s) => s.id !== id));
  if (read(ACTIVE_KEY, null) === id) write(ACTIVE_KEY, null);
  notify();
}

export function getActiveSongId() {
  const id = read(ACTIVE_KEY, null);
  return id && getSong(id) ? id : null;
}

export function setActiveSongId(id) {
  write(ACTIVE_KEY, id);
  notify();
}

export function getActiveSong() {
  const id = getActiveSongId();
  return id ? getSong(id) : null;
}
