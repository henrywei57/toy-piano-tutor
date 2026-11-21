import { describe, it, expect } from 'vitest';
import { normalizeText, searchLocal, cleanTitle, searchOnline, downloadMidi } from '../src/song/search.js';
import { LIBRARY } from '../src/song/library.js';

describe('local search', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeText('Für Élise!  (Beethoven)')).toBe('fur elise beethoven');
  });

  it('finds built-in songs by any words of their name', () => {
    expect(searchLocal('fur elise', LIBRARY).map((s) => s.id)).toEqual(['lib-fur-elise']);
    expect(searchLocal('FRERE', LIBRARY).map((s) => s.id)).toEqual(['lib-frere-jacques']);
    expect(searchLocal('row boat', LIBRARY).map((s) => s.id)).toEqual(['lib-row-your-boat']);
    expect(searchLocal('beethoven', LIBRARY)).toHaveLength(2);
    expect(searchLocal('   ', LIBRARY)).toEqual([]);
    expect(searchLocal('zzz', LIBRARY)).toEqual([]);
  });
});

describe('cleanTitle', () => {
  it('turns MIDI file names into readable titles', () => {
    expect(cleanTitle('Let-It-Snow-Let-It-Snow-2.mid')).toBe('Let It Snow Let It Snow 2');
    expect(cleanTitle('twinkle_twinkle_little_star.MIDI')).toBe('twinkle twinkle little star');
    expect(cleanTitle('3 Amigos - Think I Better Let You Know.mid')).toBe('3 Amigos - Think I Better Let You Know');
    expect(cleanTitle('')).toBe('Untitled');
  });
});

describe('online search (bitmidi.com)', () => {
  const answer = {
    result: {
      total: 31, pageTotal: 3,
      results: [
        { id: 1, name: 'jingle-bells.mid', downloadUrl: '/uploads/1.mid' },
        { id: 2, name: 'evil.mid', downloadUrl: 'https://example.com/evil.mid' },
        { id: 3, name: 'no-file.mid' },
      ],
    },
  };
  const fakeFetch = (body, status = 200) => async (url) => ({
    ok: status === 200, status, url,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([77, 84, 104, 100]).buffer,
  });

  it('asks bitmidi with the query and page, and keeps only files hosted there', async () => {
    let asked = '';
    const r = await searchOnline('jingle bells', 1, { fetchImpl: async (url, o) => { asked = url; return fakeFetch(answer)(url, o); } });
    expect(asked).toBe('https://bitmidi.com/api/midi/search?q=jingle%20bells&page=1');
    expect(r.results).toEqual([{ id: 1, title: 'jingle bells', file: 'jingle-bells.mid', url: 'https://bitmidi.com/uploads/1.mid' }]);
    expect(r).toMatchObject({ page: 1, pages: 3, total: 31 });
  });

  it('explains when it cannot connect or the server fails', async () => {
    await expect(searchOnline('x', 0, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }))
      .rejects.toThrow(/internet connection/);
    await expect(searchOnline('x', 0, { fetchImpl: fakeFetch({}, 503) })).rejects.toThrow(/503/);
    await expect(searchOnline('x', 0, { fetchImpl: fakeFetch({ nope: 1 }) })).rejects.toThrow(/doesn’t understand/);
  });

  it('downloads a result, and refuses files from other sites', async () => {
    const data = await downloadMidi({ url: 'https://bitmidi.com/uploads/1.mid' }, { fetchImpl: fakeFetch(null) });
    expect(String.fromCharCode(...data)).toBe('MThd');
    await expect(downloadMidi({ url: 'https://example.com/x.mid' }, { fetchImpl: fakeFetch(null) })).rejects.toThrow(/isn’t on bitmidi/);
  });
});
