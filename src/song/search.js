// Song search: the built-in and saved songs, plus MIDI files from bitmidi.com
// (a public archive of user-uploaded MIDI files; it allows browser requests).

const ONLINE = 'https://bitmidi.com';

/** Lowercase, without accents or punctuation ("Für Élise!" -> "fur elise"). */
export function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Songs whose name contains every word of the query. */
export function searchLocal(query, songs) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  return songs.filter((s) => {
    const name = normalizeText(s.name);
    return words.every((w) => name.includes(w));
  });
}

/** A readable title from a MIDI file name ("Let-It-Snow_2.mid" -> "Let It Snow 2"). */
export function cleanTitle(fileName) {
  return String(fileName || '')
    .replace(/\.(mid|midi|kar)$/i, '')
    .replace(/_/g, ' ')
    .replace(/(\S)-(?=\S)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

/**
 * Search bitmidi.com.
 * @returns {Promise<{results:{id:number, title:string, file:string, url:string}[], page:number, pages:number, total:number}>}
 */
export async function searchOnline(query, page = 0, { signal, fetchImpl = globalThis.fetch } = {}) {
  const url = `${ONLINE}/api/midi/search?q=${encodeURIComponent(query)}&page=${page}`;
  const data = await getJson(url, signal, fetchImpl);
  const r = data && data.result;
  if (!r || !Array.isArray(r.results)) throw new Error('bitmidi.com sent an answer the app doesn’t understand.');
  const results = [];
  for (const x of r.results) {
    const file = safeUrl(x.downloadUrl);
    if (!file) continue;
    results.push({ id: x.id, title: cleanTitle(x.name), file: String(x.name || ''), url: file });
  }
  return { results, page, pages: Number(r.pageTotal) || 1, total: Number(r.total) || results.length };
}

/** Download one search result's MIDI file. */
export async function downloadMidi(result, { signal, fetchImpl = globalThis.fetch } = {}) {
  const url = safeUrl(result.url);
  if (!url) throw new Error('That file isn’t on bitmidi.com.');
  let res;
  try {
    res = await fetchImpl(url, { signal });
  } catch (err) {
    throw offline(err);
  }
  if (!res.ok) throw new Error(`Couldn’t download that file (error ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function getJson(url, signal, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { signal });
  } catch (err) {
    throw offline(err);
  }
  if (!res.ok) throw new Error(`bitmidi.com search failed (error ${res.status}). Try again later.`);
  try {
    return await res.json();
  } catch {
    throw new Error('bitmidi.com sent an answer the app doesn’t understand.');
  }
}

function offline(err) {
  if (err && err.name === 'AbortError') return err;
  return new Error('Couldn’t reach bitmidi.com. Online search needs an internet connection.');
}

/** Only ever fetch files from bitmidi.com itself, whatever the API returns. */
function safeUrl(path) {
  if (!path || typeof path !== 'string') return null;
  try {
    const u = new URL(path, ONLINE);
    return u.origin === ONLINE && u.pathname.length > 1 ? u.href : null;
  } catch {
    return null;
  }
}
