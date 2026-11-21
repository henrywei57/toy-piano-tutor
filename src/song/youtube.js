// YouTube links: find the video in a pasted link, tidy a video title into a
// song name, and decide which part of a recording is the song itself.

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

/**
 * Find the video in a YouTube link.
 * Accepts watch?v=, youtu.be/, shorts/, embed/, live/, music.youtube.com and
 * m.youtube.com links, with or without https://, and a start time (t=1m30s).
 * @returns {{id:string, start:number}|null}
 */
export function parseYouTubeLink(text) {
  const raw = String(text || '').trim();
  if (!raw || /\s/.test(raw)) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return null;
  }
  if (!HOSTS.test(url.hostname)) return null;
  let id = null;
  if (/youtu\.be$/i.test(url.hostname)) {
    id = url.pathname.split('/')[1];
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/);
    if (m) id = m[1];
  }
  if (!id || !ID.test(id)) return null;
  return { id, start: parseTime(url.searchParams.get('t') || url.searchParams.get('start')) };
}

/** "90", "90s", "1m30s", "1h2m3s" -> seconds (0 if missing or unreadable). */
export function parseTime(t) {
  if (!t) return 0;
  if (/^\d+(\.\d+)?s?$/.test(t)) return Math.floor(parseFloat(t));
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !m[0]) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

// Words in brackets that describe the video, not the song: (Official Video),
// [Lyrics], 【MV】, (Piano Version).
const BRACKET_WORDS = /official|video|audio|lyric|visuali[sz]er|music|\bmv\b|\bhd\b|\bhq\b|\b4k\b|remaster|tutorial|piano|karaoke|cover|version|easy|synthesia|sheet|\bfull\b|\bclip\b|explicit|live|instrumental|slowed|sped up|reverb/i;
// The same after a "|" or " - ", where a song's own name could hold words
// like "video" ("Video Games"), so only clear ones count.
const TAIL_WORDS = /official|lyrics?\b|tutorial|karaoke|synthesia|instrumental|visuali[sz]er|music video|\bmv\b|\bhd\b|\b4k\b|piano (?:version|cover)|easy piano|sheet music|\baudio\b/i;

/**
 * A song name from a video title:
 * "Artist - Song (Official Music Video) [4K]" -> "Artist - Song".
 */
export function songNameFromTitle(title) {
  const whole = String(title || '').replace(/\s+/g, ' ').trim();
  let s = whole.replace(/\s*[([【「]([^)\]】」]*)[)\]】」]/g, (all, inner) => (BRACKET_WORDS.test(inner) ? ' ' : all));
  const pipes = s.split(/\s+(?:\||\/\/|•|·)\s+/);
  s = pipes.filter((p, i) => i === 0 || !TAIL_WORDS.test(p)).join(' | ');
  const dashes = s.split(/\s+[-–—]\s+/);
  while (dashes.length > 1 && TAIL_WORDS.test(dashes[dashes.length - 1])) dashes.pop();
  s = dashes.join(' - ').replace(/\s+/g, ' ').replace(/^[\s\-|:]+|[\s\-|:]+$/g, '').trim();
  return (s || whole).slice(0, 80);
}

/**
 * Which part of a recording of the video is the song: only while the video
 * plays, and not an ad before it (the video's own clock stays put during an
 * ad). Fed the player's state and clock a few times a second.
 *
 * update(state, time) returns { open, back, changed }:
 * - open: keep the sound now;
 * - back: on opening, how many seconds of the sound just before to keep too
 *   (the clock is reported late, so the song began a little earlier);
 * - changed: open differs from the last call.
 * @param {number} start  the video's clock when listening began, in seconds
 */
export function createListenGate(start, { maxBack = 1.5 } = {}) {
  let started = false;
  let open = false;
  return {
    get started() { return started; },
    update(state, time) {
      const was = open;
      let back = 0;
      if (state !== 'playing') {
        open = false;
      } else if (!started) {
        if (time >= start + 0.1) {
          started = true;
          open = true;
          back = Math.min(Math.max(0, time - start), maxBack);
        }
      } else {
        open = true;
      }
      return { open, back, changed: open !== was };
    },
  };
}
