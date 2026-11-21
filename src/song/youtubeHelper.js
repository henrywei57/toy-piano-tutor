// The YouTube helper (tools/youtube-helper.mjs): a small program you run on
// your own computer. It downloads a video's sound with yt-dlp, so the app can
// turn it into notes without you sharing the tab or playing the video.

export const HELPER_URL = 'http://127.0.0.1:47621';
const REMEMBER_KEY = 'tpt.v1.youtubeHelper';

/** True once the helper has been found in this browser (so look for it again). */
export function helperRemembered() {
  try { return localStorage.getItem(REMEMBER_KEY) === '1'; } catch { return false; }
}

function remember() {
  try { localStorage.setItem(REMEMBER_KEY, '1'); } catch { /* private mode: ask again next time */ }
}

/**
 * Is the helper running on this computer?
 * The first time, the browser may ask to let the site reach apps on this
 * device, so give that time (`timeout`).
 * @returns {Promise<{ytdlp:string|null}|null>}
 */
export async function findHelper({ timeout = 2500, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(HELPER_URL + '/ping', { signal: controller.signal, cache: 'no-store' });
    const body = await res.json();
    if (!res.ok || !body || body.app !== 'toy-piano-tutor-youtube-helper') return null;
    remember();
    return { ytdlp: body.ytdlp || null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Has the browser been told not to let this site reach apps on this computer?
 * (Chrome and Edge ask once before a website may talk to 127.0.0.1.)
 */
export async function localAccessBlocked() {
  if (typeof navigator === 'undefined' || !navigator.permissions) return false;
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      if ((await navigator.permissions.query({ name })).state === 'denied') return true;
    } catch { /* this browser doesn't know the permission */ }
  }
  return false;
}

export class HelperError extends Error {
  constructor(message, { notRunning = false } = {}) {
    super(message);
    this.notRunning = notRunning;
  }
}

/**
 * Get a video's sound through the helper.
 * @returns {Promise<{data:ArrayBuffer, title:string, type:string}>}
 */
export async function downloadAudio(id, { signal, fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${HELPER_URL}/audio?id=${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new HelperError('The YouTube helper isn’t running. Start it again, or listen while the video plays instead.', { notRunning: true });
  }
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).error; } catch { /* not JSON */ }
    throw new HelperError(message || `The YouTube helper couldn’t get this video (error ${res.status}).`);
  }
  let title = '';
  try { title = decodeURIComponent(res.headers.get('X-Title') || ''); } catch { /* leave it out */ }
  return { data: await res.arrayBuffer(), title, type: res.headers.get('Content-Type') || '' };
}
