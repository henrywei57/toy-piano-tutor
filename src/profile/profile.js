// Profile model: one physical toy piano and its measured keys.
//
// profile = {
//   id, name, numKeys, createdAt, updatedAt,
//   keys: [{ freq: number|null, takes: number[], source: 'detected'|'manual'|null, skip: boolean }]
// }
// Keys are numbered left (lowest) to right (highest), 1-based in the UI.

import { centsBetween, freqToMidi } from '../audio/notes.js';

export const MAX_KEYS = 40;
export const MAX_TAKES = 3;

export function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function emptyKey() {
  return { freq: null, takes: [], source: null, skip: false };
}

export function createProfile(name, numKeys) {
  const n = clampKeys(numKeys);
  const now = Date.now();
  return {
    id: newId(),
    name: String(name || '').trim() || 'My toy piano',
    numKeys: n,
    createdAt: now,
    updatedAt: now,
    keys: Array.from({ length: n }, emptyKey),
  };
}

export function clampKeys(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_KEYS, Math.max(1, v));
}

/** Average of takes in the log-frequency domain (i.e. average in cents). */
export function averageTakes(takes) {
  if (!takes.length) return null;
  const meanLog = takes.reduce((s, f) => s + Math.log2(f), 0) / takes.length;
  return Math.pow(2, meanLog);
}

/** Spread of takes in cents (max − min). */
export function takeSpreadCents(takes) {
  if (takes.length < 2) return 0;
  return centsBetween(Math.max(...takes), Math.min(...takes));
}

/** Add one detected take to a key (keeps the last MAX_TAKES) and recompute its frequency. */
export function addTake(key, freq) {
  const takes = [...key.takes, freq].slice(-MAX_TAKES);
  return { ...key, takes, freq: averageTakes(takes), source: 'detected' };
}

export function setManual(key, freq) {
  return { ...key, freq, source: 'manual' };
}

export function clearKey(key) {
  return { ...emptyKey(), skip: key.skip };
}

/** Keys that are usable for playing: measured and not skipped. */
export function playableKeys(profile) {
  return profile.keys
    .map((k, index) => ({ ...k, index }))
    .filter((k) => !k.skip && k.freq != null);
}

const BIG_JUMP_SEMITONES = 9;
const TAKES_DISAGREE_CENTS = 30;

/**
 * Sanity flags per key (array aligned with profile.keys).
 * - 'not-rising': lower than or equal to the previous measured key — likely an octave error
 * - 'big-jump': more than 9 semitones above the previous measured key — likely an octave error
 * - 'takes-disagree': repeated takes differ by more than 30 cents
 */
export function keyFlags(profile) {
  const flags = profile.keys.map(() => []);
  let prev = null; // { index, freq }
  profile.keys.forEach((k, i) => {
    if (k.skip || k.freq == null) return;
    if (prev) {
      const semis = freqToMidi(k.freq) - freqToMidi(prev.freq);
      if (semis <= 0) flags[i].push({ code: 'not-rising', prev: prev.index });
      else if (semis > BIG_JUMP_SEMITONES) flags[i].push({ code: 'big-jump', prev: prev.index, semis });
    }
    if (k.source === 'detected' && takeSpreadCents(k.takes) > TAKES_DISAGREE_CENTS) {
      flags[i].push({ code: 'takes-disagree' });
    }
    prev = { index: i, freq: k.freq };
  });
  return flags;
}

/** Validate and normalise a profile read from storage or an import file. */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a profile object');
  const keysIn = Array.isArray(raw.keys) ? raw.keys : [];
  const numKeys = clampKeys(raw.numKeys ?? keysIn.length);
  const keys = Array.from({ length: numKeys }, (_, i) => {
    const k = keysIn[i] || {};
    const freq = Number.isFinite(k.freq) && k.freq > 0 ? k.freq : null;
    const takes = Array.isArray(k.takes) ? k.takes.filter((f) => Number.isFinite(f) && f > 0).slice(-MAX_TAKES) : [];
    const source = freq == null ? null : k.source === 'manual' ? 'manual' : 'detected';
    return { freq, takes, source, skip: Boolean(k.skip) };
  });
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: String(raw.name || 'Imported piano').slice(0, 80),
    numKeys,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    keys,
  };
}
