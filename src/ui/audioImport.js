// "Add a song → From audio": record a browser tab or the microphone, or open
// an audio file, then turn the sound into notes (Basic Pitch) and save them.
// The audio itself stays in memory and is never saved; only the notes are.

import { h, setChildren } from './dom.js';
import { createLevelMeter } from './levelMeter.js';
import { openMic, closeMic, openTabAudio, canCaptureTab } from '../audio/mic.js';
import { decodeAudio, resample, recordCapture } from '../audio/audioInput.js';
import { transcribe, SAMPLE_RATE, MAX_SECONDS } from '../song/transcribe.js';
import { melodyOnly, isPolyphonic, noteStats, formatRange, formatDuration } from '../song/melody.js';
import { estimateTempo } from '../song/tempo.js';

const SOURCE_TEXT = { tab: 'a browser tab', mic: 'the microphone', file: 'an audio file' };
const DETAILS = [['fewer', 'Fewer'], ['normal', 'Normal'], ['more', 'More']];

/**
 * @param {object} o
 * @param {(data:object)=>boolean} o.save   songView's save(); true if saved
 * @param {(hash:string)=>void} [o.navigate]
 */
export function createAudioImport({ save, navigate }) {
  const el = h('div', { class: 'stack' });
  const st = {
    phase: 'idle',        // idle | starting | recording | decoding | converting | done | error
    source: null,         // tab | mic | file
    error: '',
    name: '',
    from: '',             // where the audio came from, for the song's origin
    result: null,         // transcribe() result
    detail: 'normal',
    melodyOnly: true,
    raw: [],              // notes found, at this detail
    bpm: 100,
    offset: 0,            // first note's position in its beat
    trimmed: false,
  };
  let capture = null;
  let recorder = null;
  let timer = 0;
  let controller = null;
  const meter = createLevelMeter();
  const timeEl = h('span', { class: 'rec-time' }, '0:00');
  const progressFill = h('div', { class: 'progress-fill' });
  const progressText = h('div', { class: 'muted small', role: 'status' });

  // ---- getting the sound ------------------------------------------------------
  async function startRecording(source) {
    st.source = source;
    st.phase = 'starting';
    st.error = '';
    render();
    try {
      capture = source === 'tab' ? await openTabAudio() : await openMic();
    } catch (err) {
      capture = null;
      return fail(err.message);
    }
    if (st.phase !== 'starting') { closeCapture(); return; } // cancelled meanwhile
    meter.reset();
    recorder = recordCapture(capture, {
      maxSeconds: MAX_SECONDS,
      onLevel: (db) => meter.set(db),
      onLimit: () => setTimeout(stopRecording, 0),
    });
    if (capture.onEnded) capture.onEnded(() => { if (st.phase === 'recording') stopRecording(); });
    st.from = source === 'tab' ? 'browser tab' : 'microphone';
    st.phase = 'recording';
    timer = setInterval(() => { timeEl.textContent = formatDuration(recorder.seconds); }, 250);
    render();
  }

  async function stopRecording() {
    if (st.phase !== 'recording') return;
    clearInterval(timer);
    const { samples, sampleRate } = recorder.stop();
    recorder = null;
    closeCapture();
    if (samples.length < sampleRate * 1.5) return fail('That recording is too short. Record at least a few notes.');
    st.phase = 'converting';
    showProgress({ stage: 'preparing' });
    render();
    const ready = await resample(samples, sampleRate, SAMPLE_RATE);
    if (st.phase === 'converting') convert(ready); // unless cancelled meanwhile
  }

  async function openFile(file) {
    st.source = 'file';
    st.from = file.name;
    st.name = st.name || file.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim();
    st.phase = 'decoding';
    st.error = '';
    render();
    let samples;
    try {
      samples = await decodeAudio(await file.arrayBuffer(), SAMPLE_RATE);
    } catch (err) {
      return fail(err.message);
    }
    if (st.phase !== 'decoding') return;
    st.phase = 'converting';
    showProgress({ stage: 'preparing' });
    render();
    convert(samples);
  }

  async function convert(samples) {
    st.trimmed = samples.length > MAX_SECONDS * SAMPLE_RATE;
    if (st.trimmed) samples = samples.subarray(0, MAX_SECONDS * SAMPLE_RATE);
    if (rms(samples) < 1e-3) {
      return fail(st.source === 'tab'
        ? 'The recording is silent. When you choose the tab, turn on “Also share tab audio”, and make sure the video is playing.'
        : 'The recording is silent. Check that the sound is on and the microphone can hear it.');
    }
    controller = new AbortController();
    try {
      st.result = await transcribe(samples, { onProgress: showProgress, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') return;
      return fail(err.message);
    } finally {
      controller = null;
    }
    // A recording's other notes are mostly accompaniment and stray notes, so
    // start with the melody even for pianos that can play chords.
    st.melodyOnly = true;
    st.detail = 'normal';
    findNotes(true);
    if (!st.raw.length) return fail('No notes were found in this recording. Try a recording where the melody is clearer.');
    st.phase = 'done';
    render();
  }

  function findNotes(newTempo) {
    st.raw = st.result.notes(st.detail);
    if (newTempo && st.raw.length) {
      const t = estimateTempo(st.raw);
      st.bpm = t.bpm;
      st.offset = t.offset;
    }
  }

  function showProgress(p) {
    const text = p.stage === 'preparing' ? 'Getting the recording ready…'
      : p.stage === 'loading' ? 'Loading the note finder (about 1 MB, only the first time)…'
        : `Finding the notes… ${Math.round((p.fraction || 0) * 100)}%` + (p.backend === 'cpu' ? ' (this browser can’t use the graphics card, so it’s slow)' : '');
    progressText.textContent = text;
    progressFill.style.width = p.stage === 'converting' ? `${Math.round((p.fraction || 0) * 100)}%` : '0%';
  }

  function cancel() {
    if (st.phase === 'recording' && recorder) { clearInterval(timer); recorder.stop(); recorder = null; }
    closeCapture();
    if (controller) controller.abort();
    reset();
  }

  function closeCapture() {
    if (!capture) return;
    if (st.source === 'mic') closeMic();
    else capture.close();
    capture = null;
  }

  function fail(message) {
    clearInterval(timer);
    st.phase = 'error';
    st.error = message;
    render();
  }

  function reset() {
    Object.assign(st, { phase: 'idle', source: null, error: '', result: null, raw: [], trimmed: false });
    render();
  }

  // ---- views ------------------------------------------------------------------
  function render() {
    if (st.phase === 'idle' || st.phase === 'error') return setChildren(el, chooser());
    if (st.phase === 'done') return setChildren(el, resultPanel());
    const parts = [];
    if (st.phase === 'starting') {
      parts.push(h('p', null, st.source === 'tab'
        ? 'Choose the tab that plays the song, and turn on “Also share tab audio”.'
        : 'Starting the microphone…'));
    } else if (st.phase === 'recording') {
      parts.push(
        h('div', { class: 'rec-row' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), h('strong', null, 'Recording'), timeEl, meter.el),
        h('p', { class: 'muted small' }, st.source === 'tab'
          ? 'Play the song in the other tab now, from the start. Stop when it ends (at most 5 minutes).'
          : 'Play the song out loud near this device now, or sing or hum it. Stop when it ends (at most 5 minutes).'),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', onClick: stopRecording }, 'Stop and find the notes'),
          h('button', { class: 'btn', onClick: cancel }, 'Cancel'),
        ),
      );
      return setChildren(el, parts);
    } else if (st.phase === 'decoding') {
      parts.push(h('p', null, 'Reading the audio file…'));
    } else if (st.phase === 'converting') {
      parts.push(h('div', { class: 'progress', 'aria-hidden': 'true' }, progressFill), progressText);
    }
    parts.push(h('div', { class: 'row-actions' }, h('button', { class: 'btn', onClick: cancel }, 'Cancel')));
    setChildren(el, parts);
  }

  function chooser() {
    const fileInput = h('input', {
      type: 'file', id: 'audio-file', class: 'visually-hidden',
      accept: 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac,.webm',
      onChange: () => { const f = fileInput.files && fileInput.files[0]; if (f) openFile(f); },
    });
    const tab = canCaptureTab();
    return [
      st.phase === 'error' && h('div', { class: 'msg error' }, st.error),
      h('p', { class: 'muted small' },
        'Turn a recording into notes. This works best when one melody stands out: a solo instrument, singing or humming, or a simple piano version. Full band recordings give rough results.'),
      h('div', { class: 'source-list' },
        tab && h('div', { class: 'source' },
          h('button', { class: 'btn primary', onClick: () => startRecording('tab') }, 'Record a browser tab'),
          h('span', { class: 'muted small' }, 'For a video, e.g. on YouTube: open it in another tab, choose that tab here, and turn on “Also share tab audio”.'),
        ),
        h('div', { class: 'source' },
          h('button', { class: 'btn' + (tab ? '' : ' primary'), onClick: () => startRecording('mic') }, 'Record with the microphone'),
          h('span', { class: 'muted small' }, tab
            ? 'Play the song out loud near this device, or sing or hum it.'
            : 'Play the song out loud from another device or speaker (e.g. a YouTube video), or sing or hum it.'),
        ),
        h('div', { class: 'source' },
          h('label', { class: 'btn', for: 'audio-file' }, 'Choose an audio file'),
          fileInput,
          h('span', { class: 'muted small' }, 'MP3, M4A, WAV or OGG, up to 5 minutes.'),
        ),
      ),
      h('p', { class: 'muted small' }, 'The recording stays on this device and is never saved. Only the notes are kept.'),
    ];
  }

  function resultPanel() {
    const poly = isPolyphonic(st.raw);
    const notes = poly && st.melodyOnly ? melodyOnly(st.raw) : st.raw;
    const stats = noteStats(notes);
    const nameInput = h('input', {
      type: 'text', id: 'audio-name', maxLength: 80, value: st.name, placeholder: 'e.g. My favourite song',
      onInput: (e) => { st.name = e.target.value; },
    });
    const bpmInput = h('input', {
      type: 'number', id: 'audio-bpm', min: 20, max: 300, value: String(st.bpm), inputMode: 'numeric',
      onInput: (e) => setTempo(Number(e.target.value), false),
    });
    function setTempo(bpm, rerender = true) {
      if (!(bpm >= 20 && bpm <= 300)) return;
      st.offset = mod(st.offset * (bpm / st.bpm), 1); // same first-note time, new beat length
      st.bpm = Math.round(bpm * 2) / 2;
      if (rerender) render();
    }
    const doSave = (thenPlay) => {
      const ok = save({
        name: st.name,
        source: 'audio',
        bpm: st.bpm,
        notes,
        meter: { num: 4, den: 4, offset: st.offset },
        origin: { from: st.from, melodyOnly: poly && st.melodyOnly, detail: st.detail },
      });
      if (!ok) return;
      st.name = '';
      reset();
      if (thenPlay && navigate) navigate('#/play');
    };
    return [
      h('div', { class: 'summary' },
        h('strong', null, `${stats.count} notes`), ` · ${formatRange(stats)} · ${formatDuration(stats.seconds)}`,
        poly && st.melodyOnly ? h('span', { class: 'muted' }, ` (from ${st.raw.length} found)`) : null),
      st.trimmed && h('div', { class: 'msg warn' }, 'Only the first 5 minutes were used.'),
      h('div', { class: 'label-like', id: 'audio-detail-label' }, 'Notes to find'),
      h('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'audio-detail-label' }, DETAILS.map(([id, label]) => h('button', {
        class: 'seg wide' + (st.detail === id ? ' on' : ''), 'aria-pressed': String(st.detail === id),
        onClick: () => { st.detail = id; findNotes(false); render(); },
      }, label))),
      h('div', { class: 'muted small' }, 'Notes missing? Try More. Extra notes that aren’t in the song? Try Fewer.'),
      poly && h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: st.melodyOnly, onChange: (e) => { st.melodyOnly = e.target.checked; render(); } }),
        h('span', null, 'Melody only (keep the highest note at each moment)'),
      ),
      poly && !st.melodyOnly && h('div', { class: 'msg warn' }, 'Keeps every note found, including the accompaniment. Pianos set to one key at a time still play only the top note.'),
      h('label', { for: 'audio-bpm' }, 'Tempo (estimated, beats per minute)'),
      h('div', { class: 'select-row' }, bpmInput,
        h('button', { class: 'btn small', onClick: () => setTempo(st.bpm / 2) }, '÷ 2'),
        h('button', { class: 'btn small', onClick: () => setTempo(st.bpm * 2) }, '× 2'),
      ),
      h('div', { class: 'muted small' }, 'Used for the metronome and the sheet music. The notes keep their timing either way. If the metronome clicks twice as fast as the beat, use ÷ 2.'),
      h('label', { for: 'audio-name' }, 'Song name'),
      nameInput,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary', onClick: () => doSave(true), disabled: !notes.length }, 'Save and play'),
        h('button', { class: 'btn', onClick: () => doSave(false), disabled: !notes.length }, 'Save song'),
        h('button', { class: 'btn', onClick: reset }, 'Start over'),
      ),
    ];
  }

  render();
  return {
    el,
    /** Suggest a song name (from a search). */
    suggestName(name) { if (!st.name && name) st.name = name; },
    destroy() {
      if (st.phase === 'recording' || st.phase === 'starting' || st.phase === 'converting' || st.phase === 'decoding') cancel();
    },
  };
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function mod(a, n) {
  return ((a % n) + n) % n;
}
