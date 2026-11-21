import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHelper, originAllowed, hostAllowed, ytDlpArgs, explainFailure } from '../tools/youtube-helper.mjs';
import { findHelper, downloadAudio, HELPER_URL } from '../src/song/youtubeHelper.js';

describe('who may use the helper', () => {
  it('lets in the app’s site and local copies only', () => {
    expect(originAllowed('https://henrywei57.github.io')).toBe(true);
    expect(originAllowed('http://localhost:5174')).toBe(true);
    expect(originAllowed('http://127.0.0.1:4174')).toBe(true);
    expect(originAllowed('https://evil.example')).toBe(false);
    expect(originAllowed('https://henrywei57.github.io.evil.example')).toBe(false);
    expect(originAllowed('https://someone.github.io')).toBe(false);
    expect(originAllowed('https://someone.github.io', ['https://someone.github.io'])).toBe(true);
    expect(originAllowed(undefined)).toBe(false);
    expect(originAllowed('null')).toBe(false);
  });

  it('answers only when called by this computer’s own address', () => {
    expect(hostAllowed('127.0.0.1:47621')).toBe(true);
    expect(hostAllowed('localhost:47621')).toBe(true);
    expect(hostAllowed('evil.example:47621')).toBe(false); // a domain pointed at 127.0.0.1
    expect(hostAllowed(undefined)).toBe(false);
  });
});

describe('ytDlpArgs', () => {
  it('builds the video’s address itself from a checked id', () => {
    const args = ytDlpArgs('dQw4w9WgXcQ', '/tmp/x');
    expect(args[args.length - 1]).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(args[args.length - 2]).toBe('--');
    expect(args).toContain('--no-playlist');
    expect(() => ytDlpArgs('--exec=calc', '/tmp/x')).toThrow();
    expect(() => ytDlpArgs('abc', '/tmp/x')).toThrow();
  });
});

describe('explainFailure', () => {
  it('turns yt-dlp errors into plain reasons', () => {
    expect(explainFailure('ERROR: [youtube] abcdefghijk: Video unavailable')).toMatch(/isn’t available/);
    expect(explainFailure('ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot.')).toMatch(/not a bot|isn’t a bot/);
    expect(explainFailure('ERROR: [youtube] abcdefghijk: Sign in to confirm your age')).toMatch(/age-restricted/);
    expect(explainFailure('something odd')).toMatch(/couldn’t download/);
  });
});

// ---- the helper's web server, with a fake yt-dlp ------------------------------
const fake = { cmd: process.execPath, pre: [fileURLToPath(new URL('./fixtures/fake-yt-dlp.mjs', import.meta.url))], version: 'test' };
let server;
let port;

function get(path, { origin = 'http://localhost:5174', host, method = 'GET', abortAfter } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (origin) headers.Origin = origin;
    if (host) headers.Host = host;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => (abortAfter ? resolve({ aborted: true }) : reject(e)));
    if (abortAfter) setTimeout(() => req.destroy(), abortAfter);
    req.end();
  });
}

const tempDirs = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('tpt-youtube-')).length;

describe('the helper', () => {
  beforeAll(async () => {
    server = createHelper({ ytdlp: fake, log: () => {} });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('says hello to the app, and no one else', async () => {
    const ok = await get('/ping');
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ app: 'toy-piano-tutor-youtube-helper', version: 1, ytdlp: 'test' });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect((await get('/ping', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await get('/ping', { host: 'evil.example' })).status).toBe(403);
  });

  it('allows a public site’s preflight to reach this computer', async () => {
    const r = await get('/audio?id=goodvideo01', { method: 'OPTIONS', origin: 'https://henrywei57.github.io' });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-private-network']).toBe('true');
  });

  it('sends the downloaded sound with its title, and keeps nothing', async () => {
    const before = tempDirs();
    const r = await get('/audio?id=goodvideo01');
    expect(r.status).toBe(200);
    expect(r.body).toBe('fake audio goodvideo01');
    expect(r.headers['content-type']).toBe('audio/mp4');
    expect(decodeURIComponent(r.headers['x-title'])).toBe('Für Elise – Piano (Official Video)');
    expect(r.headers['access-control-expose-headers']).toMatch(/X-Title/);
    await new Promise((res) => setTimeout(res, 300)); // deleted right after sending
    expect(tempDirs()).toBe(before);
  });

  it('explains what went wrong', async () => {
    const gone = await get('/audio?id=unavailabl1');
    expect(gone.status).toBe(502);
    expect(JSON.parse(gone.body).error).toMatch(/isn’t available/);
    const long = await get('/audio?id=toolongvid1');
    expect(long.status).toBe(422);
    expect(JSON.parse(long.body).error).toMatch(/longer than 20 minutes/);
    const bad = await get('/audio?id=' + encodeURIComponent('; rm -rf /'));
    expect(bad.status).toBe(400);
  });

  it('stops the download when the app cancels', async () => {
    const before = tempDirs();
    const r = await get('/audio?id=slowvideo01', { abortAfter: 300 });
    expect(r.aborted).toBe(true);
    await new Promise((res) => setTimeout(res, 800));
    expect(tempDirs()).toBe(before);
  });

  it('says so when yt-dlp is missing', async () => {
    const bare = createHelper({ ytdlp: null, log: () => {} });
    await new Promise((r) => bare.listen(0, '127.0.0.1', r));
    const saved = port;
    port = bare.address().port;
    const r = await get('/audio?id=goodvideo01');
    port = saved;
    await new Promise((res) => bare.close(res));
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toMatch(/yt-dlp/);
  });
});

// ---- the app's side ---------------------------------------------------------------
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => { calls.push(url); return handler(url, opts); };
  fn.calls = calls;
  return fn;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('findHelper and downloadAudio', () => {
  it('finds a running helper', async () => {
    const f = fakeFetch(() => json(200, { app: 'toy-piano-tutor-youtube-helper', version: 1, ytdlp: '2026.10.26' }));
    expect(await findHelper({ fetchImpl: f })).toEqual({ ytdlp: '2026.10.26' });
    expect(f.calls[0]).toBe(HELPER_URL + '/ping');
  });

  it('finds nothing when nothing answers, or something else does', async () => {
    expect(await findHelper({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } })).toBeNull();
    expect(await findHelper({ fetchImpl: async () => json(200, { hello: 1 }) })).toBeNull();
  });

  it('downloads the sound and its title', async () => {
    const f = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { 'Content-Type': 'audio/mp4', 'X-Title': encodeURIComponent('Für Elise') },
    }));
    const got = await downloadAudio('dQw4w9WgXcQ', { fetchImpl: f });
    expect(new Uint8Array(got.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(got.title).toBe('Für Elise');
    expect(f.calls[0]).toBe(HELPER_URL + '/audio?id=dQw4w9WgXcQ');
  });

  it('passes on the helper’s reason, or says it isn’t running', async () => {
    await expect(downloadAudio('dQw4w9WgXcQ', { fetchImpl: async () => json(502, { error: 'This video is private.' }) }))
      .rejects.toThrow('This video is private.');
    const err = await downloadAudio('dQw4w9WgXcQ', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }).catch((e) => e);
    expect(err.notRunning).toBe(true);
    expect(err.message).toMatch(/isn’t running/);
  });
});
