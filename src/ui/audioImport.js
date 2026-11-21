// "Add a song → YouTube link" and "→ From audio": play a YouTube video inside
// the app and listen to it, record a browser tab or the microphone, or open an
// audio file; then turn the sound into notes (Basic Pitch) and save them.
// The audio itself stays in memory and is never saved; only the notes are.

import { h, setChildren } from './dom.js';
import { createLevelMeter } from './levelMeter.js';
import { openMic, closeMic, openTabAudio, canCaptureTab } from '../audio/mic.js';
import { decodeAudio, resample, recordCapture, createEndDetector } from '../audio/audioInput.js';
import { transcribe, SAMPLE_RATE, MAX_SECONDS } from '../song/transcribe.js';
import { melodyOnly, isPolyphonic, noteStats, formatRange, formatDuration } from '../song/melody.js';
import { estimateTempo } from '../song/tempo.js';
import { parseYouTubeLink, songNameFromTitle, createListenGate } from '../song/youtube.js';
import { loadYouTubeApi, createYouTubePlayer } from './youtubePlayer.js';

const DETAILS = [['fewer', 'Fewer'], ['normal', 'Normal'], ['more', 'More']];
const TIP = 'Works best when one melody stands out: a piano version, a solo instrument, or singing. Full band recordings give rough results.';

/**
 * @param {object} o
 * @param {(data:object)=>boolean} o.save   songView's save(); true if saved
 * @param {(hash:string)=>void} [o.navigate]
 * @param {boolean} [o.youtube]             the YouTube link panel instead of From audio
 * @param {(query:string)=>void} [o.onSearch]  look for MIDI files of a song
 */
export function createAudioImport({ save, navigate, youtube = false, onSearch }) {
  const el = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });
  const st = {
    phase: 'idle',        // idle | starting | recording | decoding | converting | done | error
    source: null,         // youtube | tab | mic | file
    error: '',
    name: '',
    autoName: '',         // the name taken from the video's title
    from: '',             // where the audio came from, for the song's origin
    result: null,         // transcribe() result
    detail: 'normal',
    melodyOnly: true,
    raw: [],              // notes found, at this detail
    bpm: 100,
    offset: 0,            // first note's position in its beat
    trimmed: false,
    // YouTube
    video: null,          // { id, start, title }
    videoState: 'none',   // none | loading | ready | error
    videoError: '',
    linkError: '',
    waiting: false,       // listening, but the video hasn't started yet
    paused: false,        // listening, but the video is paused
    useMic: false,        // listen to the video with the microphone
  };
  let capture = null;
  let captureIsMic = false;
  let recorder = null;
  let timer = 0;
  let controller = null;
  let player = null;
  let gate = null;
  let poll = 0;
  let loadSeq = 0;
  const meter = createLevelMeter();
  const timeEl = h('span', { class: 'rec-time' }, '0:00');
  const progressFill = h('div', { class: 'progress-fill' });
  const progressText = h('div', { class: 'muted small', role: 'status' });

  // The YouTube panel's link field and video stay in the page between renders:
  // moving the video's iframe would reload it.
  let head = null, linkForm = null, linkInput = null, playerBox = null;
  if (youtube) {
    head = h('div', { class: 'stack' });
    linkInput = h('input', {
      type: 'url', id: 'yt-link', autocomplete: 'off', inputMode: 'url', enterKeyHint: 'go',
      placeholder: 'https://www.youtube.com/watch?v=…',
      onPaste: () => setTimeout(() => { if (parseYouTubeLink(linkInput.value)) loadLink(linkInput.value); }, 0),
    });
    linkForm = h('form', {
      class: 'search-row',
      onSubmit: (e) => { e.preventDefault(); loadLink(linkInput.value); },
    }, linkInput, h('button', { class: 'btn', type: 'submit' }, 'Load'));
    playerBox = h('div', { class: 'yt-box', hidden: true });
    el.append(head, linkForm, playerBox, body);
  } else {
    el.append(body);
  }

  // ---- YouTube ----------------------------------------------------------------
  async function loadLink(text) {
    if (st.phase !== 'idle' && st.phase !== 'error') return;
    const link = parseYouTubeLink(text);
    st.linkError = '';
    if (!link) {
      st.linkError = String(text || '').trim()
        ? 'That isn’t a link to a YouTube video. On YouTube, use Share → Copy link, or copy the address while the video is open.'
        : 'Paste a YouTube link first.';
      return render();
    }
    if (st.video && st.video.id === link.id && st.videoState !== 'error') {
      st.video.start = link.start;
      return render();
    }
    const seq = ++loadSeq;
    if (player) { player.destroy(); player = null; }
    Object.assign(st, { phase: 'idle', error: '', videoState: 'loading', videoError: '', useMic: false });
    st.video = { id: link.id, start: link.start, title: '' };
    if (st.name === st.autoName) st.name = '';
    const video = st.video;
    render();
    try {
      await loadYouTubeApi();
      if (seq !== loadSeq) return;
      player = await createYouTubePlayer(playerBox, link.id, {
        start: link.start,
        onReady: (p) => {
          if (seq !== loadSeq) return;
          video.title = p.title();
          setAutoName(video.title);
          st.videoState = 'ready';
          render();
        },
        onError: (message) => {
          if (seq !== loadSeq) return;
          if (st.phase === 'starting' || st.phase === 'recording') stopListening();
          st.phase = 'idle';
          st.videoState = 'error';
          st.videoError = message;
          render();
        },
        onState: () => { if (seq === loadSeq) followVideo(); },
      });
    } catch (err) {
      if (seq !== loadSeq) return;
      st.videoState = 'error';
      st.videoError = err.message;
      render();
    }
  }

  function setAutoName(title) {
    const name = songNameFromTitle(title);
    if (!name) return;
    if (!st.name || st.name === st.autoName) st.name = name;
    st.autoName = name;
  }

  /** Play the video here and listen to it (this tab's sound, or the mic). */
  async function listenToVideo() {
    if (!player || !player.ready) return;
    const viaMic = st.useMic || !canCaptureTab();
    st.source = 'youtube';
    st.phase = 'starting';
    st.error = '';
    render();
    try {
      capture = viaMic ? await openMic() : await openTabAudio({ thisTab: true });
      captureIsMic = viaMic;
    } catch (err) {
      capture = null;
      return fail(err.message);
    }
    if (st.phase !== 'starting' || !player) { closeCapture(); return; } // cancelled meanwhile
    if (!st.video.title) st.video.title = player.title();
    if (!st.name) setAutoName(st.video.title);
    st.from = 'YouTube';
    beginRecording(false); // opened when the video plays
    // From where the video is (if moved there), else from the link's start time.
    const dur = player.duration();
    const now = player.time();
    const okAt = (t) => t > 1 && (!dur || t < dur - 3);
    const from = okAt(now) ? now : okAt(st.video.start) ? st.video.start : 0;
    player.seek(from);
    gate = createListenGate(from);
    st.waiting = true;
    st.paused = false;
    player.play();
    poll = setInterval(followVideo, 100);
    render();
  }

  /** Keep the sound only while the video itself plays; stop at its end. */
  function followVideo() {
    if (st.phase !== 'recording' || !gate || !player || !recorder) return;
    const state = player.state();
    if (state === 'ended' && gate.started) { stopRecording(); return; }
    const r = gate.update(state, player.time());
    if (r.changed) recorder.setOpen(r.open, r.back);
    const waiting = !gate.started;
    const paused = gate.started && !r.open;
    if (waiting !== st.waiting || paused !== st.paused) {
      st.waiting = waiting;
      st.paused = paused;
      render();
    }
  }

  function stopListening() {
    clearInterval(poll);
    poll = 0;
    gate = null;
    if (player && st.source === 'youtube') player.pause();
    if (recorder) { clearInterval(timer); recorder.stop(); recorder = null; }
    closeCapture();
  }

  // ---- getting the sound ------------------------------------------------------
  async function startRecording(source) {
    st.source = source;
    st.phase = 'starting';
    st.error = '';
    render();
    try {
      capture = source === 'tab' ? await openTabAudio() : await openMic();
      captureIsMic = source === 'mic';
    } catch (err) {
      capture = null;
      return fail(err.message);
    }
    if (st.phase !== 'starting') { closeCapture(); return; } // cancelled meanwhile
    st.from = youtube && st.video ? 'YouTube' : source === 'tab' ? 'browser tab' : 'microphone';
    beginRecording(true);
    render();
  }

  function beginRecording(open) {
    meter.reset();
    st.trimmed = false;
    timeEl.textContent = '0:00';
    // Another tab's sound goes silent when its video ends: stop then.
    let end = st.source === 'tab' ? createEndDetector() : null;
    recorder = recordCapture(capture, {
      maxSeconds: MAX_SECONDS,
      open,
      onLevel: (db, seconds) => {
        meter.set(db);
        if (end && recorder && recorder.seconds > 0 && end.update(db, seconds)) {
          end = null;
          setTimeout(stopRecording, 0);
        }
      },
      onLimit: () => { st.trimmed = true; setTimeout(stopRecording, 0); },
    });
    if (capture.onEnded) capture.onEnded(() => { if (st.phase === 'recording') stopRecording(); });
    st.phase = 'recording';
    timer = setInterval(() => { timeEl.textContent = formatDuration(recorder ? recorder.seconds : 0); }, 250);
  }

  async function stopRecording() {
    if (st.phase !== 'recording' || !recorder) return;
    clearInterval(timer);
    const started = !gate || gate.started;
    clearInterval(poll);
    poll = 0;
    gate = null;
    if (player && st.source === 'youtube') player.pause();
    const { samples, sampleRate } = recorder.stop();
    recorder = null;
    closeCapture();
    if (samples.length < sampleRate * 1.5) {
      return fail(st.source === 'youtube' && !started
        ? 'The video didn’t start, so there was nothing to listen to. Try again, and press play on the video if it doesn’t start by itself.'
        : 'That recording is too short. Record at least a few notes.');
    }
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
    st.trimmed = false;
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
    if (samples.length > MAX_SECONDS * SAMPLE_RATE) {
      st.trimmed = true;
      samples = samples.subarray(0, MAX_SECONDS * SAMPLE_RATE);
    }
    if (rms(samples) < 1e-3) return fail(silentText());
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

  function silentText() {
    if (st.source === 'youtube' && !captureIsMic) {
      return 'The recording is silent. When you allow sharing, keep “Also share tab audio” on, and check that the video isn’t muted.';
    }
    if (st.source === 'tab') {
      return 'The recording is silent. When you choose the tab, turn on “Also share tab audio”, and make sure the video is playing.';
    }
    return 'The recording is silent. Check that the sound is on and the microphone can hear it.';
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
    stopListening();
    if (controller) controller.abort();
    reset();
  }

  function closeCapture() {
    if (!capture) return;
    if (captureIsMic) closeMic();
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
    Object.assign(st, { phase: 'idle', source: null, error: '', result: null, raw: [], trimmed: false, waiting: false, paused: false });
    render();
  }

  // ---- views ------------------------------------------------------------------
  function render() {
    if (youtube) renderVideoParts();
    if (st.phase === 'idle' || st.phase === 'error') return setChildren(body, youtube ? videoChooser() : chooser());
    if (st.phase === 'done') return setChildren(body, resultPanel());
    const parts = [];
    if (st.phase === 'starting') {
      parts.push(h('p', null, st.source === 'tab'
        ? 'Choose the tab that plays the song, and turn on “Also share tab audio”.'
        : st.source === 'youtube' && !st.useMic && canCaptureTab()
          ? 'Your browser asks to share this tab, so the app can hear the video. Keep “Also share tab audio” on and choose Allow (or Share).'
          : 'Starting the microphone…'));
    } else if (st.phase === 'recording') {
      parts.push(
        h('div', { class: 'rec-row' },
          h('span', { class: 'rec-dot', 'aria-hidden': 'true' }),
          h('strong', null, st.source === 'youtube' ? 'Listening' : 'Recording'), timeEl, meter.el),
        h('p', { class: 'muted small', role: 'status' }, recordingText()),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', onClick: stopRecording }, 'Stop and find the notes'),
          h('button', { class: 'btn', onClick: cancel }, 'Cancel'),
        ),
      );
      return setChildren(body, parts);
    } else if (st.phase === 'decoding') {
      parts.push(h('p', null, 'Reading the audio file…'));
    } else if (st.phase === 'converting') {
      parts.push(h('div', { class: 'progress', 'aria-hidden': 'true' }, progressFill), progressText);
    }
    parts.push(h('div', { class: 'row-actions' }, h('button', { class: 'btn', onClick: cancel }, 'Cancel')));
    setChildren(body, parts);
  }

  function recordingText() {
    if (st.source === 'youtube') {
      if (st.waiting) return 'Waiting for the video to start. If it doesn’t, press play on the video. (If an ad plays first, the app waits for it to end.)';
      if (st.paused) return 'The video is paused. Listening goes on when it plays again.';
      return (captureIsMic ? 'Listening with the microphone, so keep the room quiet. ' : '')
        + 'It stops by itself when the video ends, or after 5 minutes. To use only part of the song, press Stop when that part ends.';
    }
    if (st.source === 'tab') return 'Play the song in the other tab now, from the start. It stops by itself a few seconds after the sound ends (at most 5 minutes), or press Stop.';
    return 'Play the song out loud near this device now, or sing or hum it. Stop when it ends (at most 5 minutes).';
  }

  function renderVideoParts() {
    const busy = st.phase !== 'idle' && st.phase !== 'error';
    setChildren(head,
      h('label', { for: 'yt-link' }, 'YouTube link'),
      st.linkError && h('div', { class: 'msg error' }, st.linkError),
    );
    head.hidden = busy;
    linkForm.hidden = busy;
    playerBox.hidden = !st.video || st.videoState === 'error' || !['idle', 'error', 'starting', 'recording'].includes(st.phase);
  }

  function videoChooser() {
    const parts = [st.phase === 'error' && h('div', { class: 'msg error' }, st.error)];
    if (!st.video) {
      parts.push(
        h('p', { class: 'muted small' }, 'Paste the link of a YouTube video of the song. The app plays the video here, listens to it, and writes down its notes.'),
        h('p', { class: 'muted small' }, TIP),
      );
      return parts;
    }
    if (st.videoState === 'loading') {
      parts.push(h('p', { class: 'muted small' }, 'Loading the video…'));
      return parts;
    }
    if (st.videoState === 'error') {
      parts.push(h('div', { class: 'msg error' }, st.videoError), ...videoFallback(), searchButton());
      return parts;
    }
    const tab = canCaptureTab() && !st.useMic;
    parts.push(
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary', onClick: listenToVideo }, 'Find the notes'),
        searchButton(),
      ),
      h('p', { class: 'muted small' }, (tab
        ? 'The video plays here while the app listens, and stops by itself at the end (at most 5 minutes). Your browser first asks to share this tab: keep “Also share tab audio” on and allow it.'
        : 'The video plays out loud while the app listens with the microphone, and stops by itself at the end (at most 5 minutes). Turn the volume up and keep the room quiet.')
        + ' It starts from the beginning; to start later in the song, move the video there first.'),
      st.phase === 'error' && canCaptureTab() && !st.useMic && h('button', {
        class: 'link', type: 'button', onClick: () => { st.useMic = true; render(); },
      }, 'Listen with the microphone instead'),
      h('p', { class: 'muted small' }, TIP + ' Only the notes are kept, never the sound.'),
    );
    return parts;
  }

  function searchButton() {
    const query = st.name || songNameFromTitle(st.video && st.video.title);
    return onSearch && query && h('button', { class: 'btn', onClick: () => onSearch(query) }, 'Look for a MIDI file instead');
  }

  /** For a video that can't play inside the app: play it on YouTube instead. */
  function videoFallback() {
    const url = 'https://www.youtube.com/watch?v=' + st.video.id + (st.video.start ? '&t=' + st.video.start : '');
    const open = h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on YouTube ↗');
    if (!canCaptureTab()) {
      return [
        h('p', { class: 'muted small' }, 'You can still use it: play it out loud on another device, such as a computer or TV, and record it here with the microphone. Or try another video of the song, such as a piano version.'),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', onClick: () => startRecording('mic') }, 'Record with the microphone'),
          open),
      ];
    }
    return [
      h('p', { class: 'muted small' }, 'You can still use it from YouTube’s own page:'),
      h('ol', { class: 'steps small' },
        h('li', null, 'Open it on YouTube, and pause it.'),
        h('li', null, 'Come back here, press Record that tab, choose the YouTube tab, and turn on “Also share tab audio”.'),
        h('li', null, 'Play the video from the start. The app stops by itself when it ends.'),
      ),
      h('div', { class: 'row-actions' }, open,
        h('button', { class: 'btn primary', onClick: () => startRecording('tab') }, 'Record that tab')),
    ];
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
      h('p', { class: 'muted small' }, 'Turn a recording into notes. ' + TIP),
      h('div', { class: 'source-list' },
        tab && h('div', { class: 'source' },
          h('button', { class: 'btn primary', onClick: () => startRecording('tab') }, 'Record a browser tab'),
          h('span', { class: 'muted small' }, 'For a song playing in another tab: choose that tab here, and turn on “Also share tab audio”. For a YouTube video, the YouTube link tab is easier.'),
        ),
        h('div', { class: 'source' },
          h('button', { class: 'btn' + (tab ? '' : ' primary'), onClick: () => startRecording('mic') }, 'Record with the microphone'),
          h('span', { class: 'muted small' }, tab
            ? 'Play the song out loud near this device, or sing or hum it.'
            : 'Play the song out loud from another device or speaker, or sing or hum it.'),
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
      type: 'text', id: youtube ? 'yt-name' : 'audio-name', maxLength: 80, value: st.name, placeholder: 'e.g. My favourite song',
      onInput: (e) => { st.name = e.target.value; },
    });
    const bpmId = youtube ? 'yt-bpm' : 'audio-bpm';
    const bpmInput = h('input', {
      type: 'number', id: bpmId, min: 20, max: 300, value: String(st.bpm), inputMode: 'numeric',
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
        origin: {
          from: st.from,
          ...(youtube && st.video ? { youtube: st.video.id } : {}),
          melodyOnly: poly && st.melodyOnly,
          detail: st.detail,
        },
      });
      if (!ok) return;
      st.name = '';
      reset();
      if (thenPlay && navigate) navigate('#/play');
    };
    const detailId = youtube ? 'yt-detail-label' : 'audio-detail-label';
    return [
      h('div', { class: 'summary' },
        h('strong', null, `${stats.count} notes`), ` · ${formatRange(stats)} · ${formatDuration(stats.seconds)}`,
        poly && st.melodyOnly ? h('span', { class: 'muted' }, ` (from ${st.raw.length} found)`) : null),
      st.trimmed && h('div', { class: 'msg warn' }, 'Only the first 5 minutes were used.'),
      h('div', { class: 'label-like', id: detailId }, 'Notes to find'),
      h('div', { class: 'segmented', role: 'group', 'aria-labelledby': detailId }, DETAILS.map(([id, label]) => h('button', {
        class: 'seg wide' + (st.detail === id ? ' on' : ''), 'aria-pressed': String(st.detail === id),
        onClick: () => { st.detail = id; findNotes(false); render(); },
      }, label))),
      h('div', { class: 'muted small' }, 'Notes missing? Try More. Extra notes that aren’t in the song? Try Fewer.'),
      poly && h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: st.melodyOnly, onChange: (e) => { st.melodyOnly = e.target.checked; render(); } }),
        h('span', null, 'Melody only (keep the highest note at each moment)'),
      ),
      poly && !st.melodyOnly && h('div', { class: 'msg warn' }, 'Keeps every note found, including the accompaniment. Pianos set to one key at a time still play only the top note.'),
      h('label', { for: bpmId }, 'Tempo (estimated, beats per minute)'),
      h('div', { class: 'select-row' }, bpmInput,
        h('button', { class: 'btn small', onClick: () => setTempo(st.bpm / 2) }, '÷ 2'),
        h('button', { class: 'btn small', onClick: () => setTempo(st.bpm * 2) }, '× 2'),
      ),
      h('div', { class: 'muted small' }, 'Used for the metronome and the sheet music. The notes keep their timing either way. If the metronome clicks twice as fast as the beat, use ÷ 2.'),
      h('label', { for: youtube ? 'yt-name' : 'audio-name' }, 'Song name'),
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
    /** YouTube panel: load a pasted link. */
    loadLink(text) { if (youtube) { linkInput.value = text; loadLink(text); } },
    focus() { if (youtube && !linkForm.hidden) linkInput.focus(); },
    destroy() {
      if (st.phase === 'recording' || st.phase === 'starting' || st.phase === 'converting' || st.phase === 'decoding') cancel();
      loadSeq++;
      if (player) { player.destroy(); player = null; }
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
