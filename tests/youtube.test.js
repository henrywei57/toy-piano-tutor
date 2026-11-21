import { describe, it, expect } from 'vitest';
import { parseYouTubeLink, parseTime, songNameFromTitle, createListenGate } from '../src/song/youtube.js';
import { recordCapture, createEndDetector } from '../src/audio/audioInput.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeLink', () => {
  it('reads the usual kinds of link', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&list=PL123&index=2`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&feature=share`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abcDEF123`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
      `https://www.youtube.com/live/${ID}`,
      `www.youtube.com/watch?v=${ID}`,
      `youtu.be/${ID}`,
      `  https://youtu.be/${ID}  `,
    ]) {
      expect(parseYouTubeLink(link), link).toEqual({ id: ID, start: 0 });
    }
  });

  it('reads a start time', () => {
    expect(parseYouTubeLink(`https://youtu.be/${ID}?t=90`).start).toBe(90);
    expect(parseYouTubeLink(`https://www.youtube.com/watch?v=${ID}&t=1m30s`).start).toBe(90);
    expect(parseYouTubeLink(`https://www.youtube.com/embed/${ID}?start=42`).start).toBe(42);
  });

  it('turns down anything else', () => {
    for (const text of [
      '', 'jingle bells', 'https://example.com/watch?v=' + ID, 'https://www.youtube.com/results?search_query=x',
      'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/@somechannel', `https://notyoutube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?v=${ID} and more`,
    ]) {
      expect(parseYouTubeLink(text), text).toBeNull();
    }
  });
});

describe('parseTime', () => {
  it('reads seconds and h/m/s times', () => {
    expect(parseTime('75')).toBe(75);
    expect(parseTime('75s')).toBe(75);
    expect(parseTime('2m')).toBe(120);
    expect(parseTime('1h2m3s')).toBe(3723);
    expect(parseTime('')).toBe(0);
    expect(parseTime('soon')).toBe(0);
  });
});

describe('songNameFromTitle', () => {
  it('drops what describes the video', () => {
    expect(songNameFromTitle('Rick Astley - Never Gonna Give You Up (Official Music Video)')).toBe('Rick Astley - Never Gonna Give You Up');
    expect(songNameFromTitle('Jingle Bells | Easy Piano Tutorial')).toBe('Jingle Bells');
    expect(songNameFromTitle('Für Elise - Beethoven - Piano Tutorial [Synthesia] (HD)')).toBe('Für Elise - Beethoven');
    expect(songNameFromTitle('Let It Go (From "Frozen") [Lyrics]')).toBe('Let It Go (From "Frozen")');
    expect(songNameFromTitle('【MV】 Some Song')).toBe('Some Song');
  });

  it('keeps song names that only look like video words', () => {
    expect(songNameFromTitle('Lana Del Rey - Video Games')).toBe('Lana Del Rey - Video Games');
    expect(songNameFromTitle('Official')).toBe('Official');
    expect(songNameFromTitle('')).toBe('');
  });
});

describe('createListenGate', () => {
  it('opens when the video plays, and adds back the moment before', () => {
    const g = createListenGate(0);
    expect(g.update('unstarted', 0)).toEqual({ open: false, back: 0, changed: false });
    expect(g.update('buffering', 0).open).toBe(false);
    expect(g.update('playing', 0.35)).toEqual({ open: true, back: 0.35, changed: true });
    expect(g.started).toBe(true);
    expect(g.update('playing', 0.5)).toEqual({ open: true, back: 0, changed: false });
  });

  it('waits while an ad plays (the video’s clock stays put)', () => {
    const g = createListenGate(30);
    for (let i = 0; i < 20; i++) expect(g.update('playing', 30).open).toBe(false);
    expect(g.started).toBe(false);
    const r = g.update('playing', 30.25);
    expect(r.open).toBe(true);
    expect(r.back).toBeCloseTo(0.25, 5);
  });

  it('closes while paused or buffering, and opens again after', () => {
    const g = createListenGate(0);
    g.update('playing', 1);
    expect(g.update('paused', 10)).toEqual({ open: false, back: 0, changed: true });
    expect(g.update('buffering', 10).open).toBe(false);
    expect(g.update('playing', 10)).toEqual({ open: true, back: 0, changed: true });
  });

  it('never adds back more than a moment', () => {
    const g = createListenGate(0);
    expect(g.update('playing', 200).back).toBe(1.5);
  });
});

function fakeCapture(sampleRate = 1000) {
  let fn = null;
  return {
    sampleRate,
    subscribe(f) { fn = f; return () => { fn = null; }; },
    send(value, length = 100) { if (fn) fn(new Float32Array(length).fill(value)); },
  };
}

describe('recordCapture', () => {
  it('keeps sound only while open, plus what it is asked to add back', () => {
    const cap = fakeCapture();
    const rec = recordCapture(cap, { open: false });
    for (let i = 0; i < 30; i++) cap.send(0.1);  // 3 s while closed: an ad
    cap.send(0.5);                                // the song starts…
    rec.setOpen(true, 0.1);                       // …and the player reports it 0.1 s late
    cap.send(0.5);
    rec.setOpen(false);
    cap.send(0.9);                                // paused
    rec.setOpen(true);
    cap.send(0.7);
    const { samples, sampleRate } = rec.stop();
    expect(sampleRate).toBe(1000);
    expect(samples.length).toBe(300);
    expect([...new Set(samples)].map((x) => Math.round(x * 10) / 10)).toEqual([0.5, 0.7]);
    cap.send(1);                                  // after stop: ignored
    expect(rec.seconds).toBeCloseTo(0.3, 5);
  });

  it('stops at the limit', () => {
    const cap = fakeCapture();
    let hit = 0;
    const rec = recordCapture(cap, { maxSeconds: 0.25, onLimit: () => hit++ });
    for (let i = 0; i < 5; i++) cap.send(0.2);
    expect(hit).toBe(1);
    expect(rec.stop().samples.length).toBe(250);
  });

  it('reports the level and length of each block', () => {
    const cap = fakeCapture();
    const levels = [];
    recordCapture(cap, { onLevel: (db, s) => levels.push([Math.round(db), s]) });
    cap.send(0.1);
    expect(levels).toEqual([[-20, 0.1]]);
  });
});

describe('createEndDetector', () => {
  it('stops after a few seconds of silence that follow the song', () => {
    const d = createEndDetector({ quietFor: 4, soundFor: 3 });
    for (let i = 0; i < 50; i++) expect(d.update(-120, 0.1)).toBe(false); // silence before the song: wait
    for (let i = 0; i < 40; i++) expect(d.update(-20, 0.1)).toBe(false);  // the song
    for (let i = 0; i < 20; i++) expect(d.update(-120, 0.1)).toBe(false); // a 2 s gap…
    expect(d.update(-25, 0.1)).toBe(false);                                // …then more song
    let stopped = false;
    for (let i = 0; i < 41 && !stopped; i++) stopped = d.update(-120, 0.1);
    expect(stopped).toBe(true);
  });
});
