#!/usr/bin/env node
// Toy Piano Tutor's YouTube helper: gets a video's sound for the app, so you
// don't have to share the tab. It runs on your own computer, downloads the
// video's audio with yt-dlp, and hands it to the app, which turns it into
// notes. Each download is deleted as soon as it has been sent.
//
//   npm run youtube-helper        (or double-click tools\youtube-helper.cmd)
//
// Needs yt-dlp:  python -m pip install "yt-dlp[default]"
// Only this computer can reach it (127.0.0.1), and only the app's own pages
// may use it: https://henrywei57.github.io and http://localhost. To allow
// another copy of the app, set TPT_HELPER_ORIGINS=https://you.github.io

import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 47621;
export const MAX_MINUTES = 20;
const APP_ORIGINS = ['https://henrywei57.github.io'];
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const ID = /^[A-Za-z0-9_-]{11}$/;
const TYPES = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg' };

/** May a page from this origin use the helper? The app's site, or a local copy. */
export function originAllowed(origin, extra = []) {
  if (!origin) return false;
  const m = origin.match(/^https?:\/\/(.+)$/);
  if (m && LOCAL.test(m[1])) return true;
  return [...APP_ORIGINS, ...extra].includes(origin);
}

/** Was the request sent to this computer by name? (Not a look-alike domain pointed here.) */
export function hostAllowed(host) {
  return LOCAL.test(host || '');
}

/** yt-dlp's arguments: the best audio-only file into `dir`, then print its path and title. */
export function ytDlpArgs(id, dir) {
  if (!ID.test(id)) throw new Error('Not a YouTube video id');
  return [
    '--no-playlist', '--no-progress', '--no-warnings', '--encoding', 'utf-8', '--js-runtimes', 'node',
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '--match-filter', `duration <= ${MAX_MINUTES * 60}`,
    '--no-simulate', '--print', 'after_move:%(filepath)s', '--print', 'after_move:%(title)s',
    '-P', dir, '-o', '%(id)s.%(ext)s',
    '--', `https://www.youtube.com/watch?v=${id}`,
  ];
}

/** A short, plain reason from yt-dlp's error output. */
export function explainFailure(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).filter((l) => /ERROR/.test(l));
  const last = (lines[lines.length - 1] || '').replace(/^.*?ERROR:\s*(\[[^\]]*\]\s*)?([A-Za-z0-9_-]{11}:\s*)?/, '').trim();
  if (/confirm your age|age.restricted|inappropriate/i.test(last)) return 'This video is age-restricted, so it can’t be downloaded without signing in.';
  if (/not a bot|confirm you['’]re not/i.test(last)) return 'YouTube asked to confirm this isn’t a bot. Update yt-dlp (python -m pip install -U "yt-dlp[default]"), or listen while the video plays instead.';
  if (/private video/i.test(last)) return 'This video is private.';
  if (/unavailable|not available|removed|terminated/i.test(last)) return 'This video isn’t available. It may be removed, private, or blocked in your country.';
  if (/live event|is live|premieres/i.test(last)) return 'Live streams and premieres can’t be downloaded until they’ve finished.';
  return 'yt-dlp couldn’t download this video' + (last ? `: ${last}` : '.') + ' If downloads keep failing, update yt-dlp: python -m pip install -U "yt-dlp[default]"';
}

/** Run a program; resolves with its exit code and output (never rejects). */
function run(cmd, args, { signal, timeout } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', kill);
      resolve({ code, out, err });
    };
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    } catch (e) {
      err = String(e);
      return finish(-1);
    }
    const kill = () => { try { child.kill(); } catch { /* gone */ } };
    const timer = timeout ? setTimeout(kill, timeout) : null;
    if (signal) signal.addEventListener('abort', kill, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += String(e); finish(-1); });
    child.on('close', (code) => finish(code ?? -1));
  });
}

/** Find a working yt-dlp: the program itself, or the Python module. */
export async function findYtDlp() {
  const candidates = [['yt-dlp', []], ['python', ['-m', 'yt_dlp']], ['py', ['-m', 'yt_dlp']], ['python3', ['-m', 'yt_dlp']]];
  for (const [cmd, pre] of candidates) {
    const r = await run(cmd, [...pre, '--version'], { timeout: 30000 });
    if (r.code === 0 && /^\d{4}\.\d/.test(r.out.trim())) return { cmd, pre, version: r.out.trim() };
  }
  return null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * The helper's web server.
 * GET /ping          -> { app, version, ytdlp }
 * GET /audio?id=…    -> the video's audio file (X-Title: its title, URI-encoded)
 */
export function createHelper({ ytdlp, origins = [], log = console.log } = {}) {
  let running = null; // the download in progress; a new one replaces it
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!hostAllowed(req.headers.host)) return send(res, 403, { error: 'Wrong address.' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!origin && req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Toy Piano Tutor’s YouTube helper is running. Leave it open while you use the app.\n');
    }
    if (!originAllowed(origin, origins)) return send(res, 403, { error: 'Only Toy Piano Tutor may use this helper.' });
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'X-Title, Content-Length' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Private-Network': 'true', // a public site may call this computer
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Only GET.' }, cors);
    if (url.pathname === '/ping') {
      return send(res, 200, { app: 'toy-piano-tutor-youtube-helper', version: 1, ytdlp: ytdlp ? ytdlp.version : null }, cors);
    }
    if (url.pathname !== '/audio') return send(res, 404, { error: 'Not found.' }, cors);

    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return send(res, 400, { error: 'That isn’t a YouTube video id.' }, cors);
    if (!ytdlp) {
      return send(res, 503, { error: 'The helper can’t find yt-dlp. Install it with: python -m pip install "yt-dlp[default]", then start the helper again.' }, cors);
    }
    if (running) running.abort();
    const job = new AbortController();
    running = job;
    res.on('close', () => { if (!res.writableFinished) job.abort(); }); // the app cancelled
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tpt-youtube-'));
    try {
      log(`Getting the sound of ${id}…`);
      const r = await run(ytdlp.cmd, [...ytdlp.pre, ...ytDlpArgs(id, dir)], { signal: job.signal, timeout: 5 * 60 * 1000 });
      if (job.signal.aborted) { log('  cancelled'); return; }
      const [file, title = ''] = r.out.split(/\r?\n/).filter(Boolean);
      if (r.code !== 0 || !file) {
        const error = r.code === 0 ? `This video is longer than ${MAX_MINUTES} minutes. Pick a shorter one (only 5 minutes are used anyway).` : explainFailure(r.err);
        log(`  failed: ${error}`);
        return send(res, r.code === 0 ? 422 : 502, { error }, cors);
      }
      const { size } = await stat(file);
      const ext = path.extname(file).slice(1).toLowerCase();
      res.writeHead(200, {
        ...cors,
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Content-Length': size,
        'X-Title': encodeURIComponent(title),
        'Cache-Control': 'no-store',
      });
      await pipeline(createReadStream(file), res);
      log(`  sent ${(size / 1e6).toFixed(1)} MB: ${title}`);
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: String((err && err.message) || err) }, cors);
      else res.destroy();
    } finally {
      if (running === job) running = null;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  const origins = (process.env.TPT_HELPER_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ytdlp = await findYtDlp();
  if (!ytdlp) {
    console.log('yt-dlp wasn’t found. Install it with:\n  python -m pip install "yt-dlp[default]"\nthen start this helper again.');
  }
  const server = createHelper({ ytdlp, origins });
  server.on('error', (e) => {
    console.log(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use: the helper is probably running already.` : String(e));
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Toy Piano Tutor’s YouTube helper is running${ytdlp ? ` (yt-dlp ${ytdlp.version})` : ''}.`);
    console.log('Leave this window open while you use the app. Press Ctrl+C to stop it.');
  });
}
