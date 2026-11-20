import { describe, it, expect, beforeEach } from 'vitest';
import { createProfile, addTake, averageTakes, keyFlags, normalizeProfile, clampKeys } from '../src/profile/profile.js';
import * as store from '../src/profile/store.js';
import { midiToFreq, centsBetween } from '../src/audio/notes.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function withFreqs(freqs) {
  const p = createProfile('t', freqs.length);
  p.keys = freqs.map((f) => (f == null ? { freq: null, takes: [], source: null, skip: false } : { freq: f, takes: [f], source: 'detected', skip: false }));
  return p;
}

describe('profile model', () => {
  it('clamps key count to 1..40', () => {
    expect(clampKeys(0)).toBe(1);
    expect(clampKeys(55)).toBe(40);
    expect(clampKeys('12')).toBe(12);
    expect(createProfile('x', 15).keys).toHaveLength(15);
  });

  it('averages takes in cents and keeps at most 3', () => {
    expect(averageTakes([440, 880])).toBeCloseTo(440 * Math.SQRT2, 6);
    let k = { freq: null, takes: [], source: null, skip: false };
    for (const f of [500, 510, 520, 530]) k = addTake(k, f);
    expect(k.takes).toEqual([510, 520, 530]);
    expect(Math.abs(centsBetween(k.freq, 520))).toBeLessThan(0.5);
  });

  it('flags keys that are not rising (octave errors)', () => {
    const f = (m) => midiToFreq(m);
    // C5 D5 E5 [F4 — detected an octave low] G5
    const flags = keyFlags(withFreqs([f(72), f(74), f(76), f(65), f(79)]));
    expect(flags[3].map((x) => x.code)).toContain('not-rising');
    expect(flags[4].map((x) => x.code)).toContain('big-jump');
    expect(flags[0]).toEqual([]);
    expect(flags[1]).toEqual([]);
  });

  it('compares against the previous measured, non-skipped key', () => {
    const f = (m) => midiToFreq(m);
    const p = withFreqs([f(72), null, f(76)]);
    expect(keyFlags(p)[2]).toEqual([]);
    p.keys[1] = { freq: f(90), takes: [], source: 'manual', skip: true };
    expect(keyFlags(p)[2]).toEqual([]);
  });

  it('flags takes that disagree', () => {
    const p = withFreqs([523]);
    p.keys[0] = addTake(addTake(p.keys[0], 523), 545);
    expect(keyFlags(p)[0].map((x) => x.code)).toContain('takes-disagree');
  });

  it('normalises bad data', () => {
    const p = normalizeProfile({ name: 'x', numKeys: 3, keys: [{ freq: -5 }, { freq: 440, takes: ['a', 440] }] });
    expect(p.keys).toHaveLength(3);
    expect(p.keys[0].freq).toBeNull();
    expect(p.keys[1]).toMatchObject({ freq: 440, takes: [440], source: 'detected' });
  });
});

describe('profile store', () => {
  beforeEach(() => store.useStorage(memoryStorage()));

  it('creates, renames, duplicates and deletes', () => {
    const a = store.addProfile('Red piano', 12);
    expect(store.getActiveId()).toBe(a.id);
    store.renameProfile(a.id, 'Blue piano');
    expect(store.getProfile(a.id).name).toBe('Blue piano');
    const b = store.duplicateProfile(a.id);
    expect(b.id).not.toBe(a.id);
    expect(store.listProfiles()).toHaveLength(2);
    store.deleteProfile(a.id);
    expect(store.listProfiles().map((p) => p.id)).toEqual([b.id]);
    expect(store.getActiveId()).toBeNull();
  });

  it('round-trips export / import without overwriting', () => {
    const a = store.addProfile('Red piano', 3);
    store.saveProfile({ ...a, keys: a.keys.map((k, i) => ({ ...k, freq: 500 + i, source: 'manual' })) });
    const json = store.exportProfiles();
    expect(store.importProfiles(json)).toBe(1);
    const all = store.listProfiles();
    expect(all).toHaveLength(2);
    expect(all[0].id).not.toBe(all[1].id);
    expect(all[1].keys.map((k) => k.freq)).toEqual([500, 501, 502]);
  });

  it('rejects files that are not JSON', () => {
    expect(() => store.importProfiles('not json')).toThrow(/valid JSON/);
  });
});
