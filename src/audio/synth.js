// Playback sounds: a toy-piano-like tone and a metronome click.
// Uses its own AudioContext, created on first use (inside a tap/click so
// mobile browsers allow it).

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Call from a user gesture (e.g. the Play button) so later sounds are allowed. */
export function unlockAudio() {
  audio();
}

/**
 * A struck-metal tone: a decaying sine plus a quickly fading high partial and
 * a tiny click, at the given frequency (use the key's measured frequency so it
 * sounds like the user's piano).
 */
export function playTone(freq, { duration = 0.6, volume = 0.3 } = {}) {
  const c = audio();
  const t = c.currentTime + 0.005;
  const ring = Math.min(2.5, Math.max(0.5, duration + 0.4));

  const body = c.createGain();
  body.gain.setValueAtTime(0.0001, t);
  body.gain.exponentialRampToValueAtTime(volume, t + 0.004);
  body.gain.exponentialRampToValueAtTime(0.0001, t + ring);
  body.connect(master);

  const fundamental = c.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.value = freq;
  fundamental.connect(body);

  // Inharmonic partial (metal rod / bar), fades fast.
  const partialGain = c.createGain();
  partialGain.gain.setValueAtTime(volume * 0.35, t);
  partialGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  partialGain.connect(master);
  const partial = c.createOscillator();
  partial.type = 'sine';
  partial.frequency.value = Math.min(freq * 3.9, c.sampleRate / 2 - 100);
  partial.connect(partialGain);

  fundamental.start(t);
  partial.start(t);
  fundamental.stop(t + ring + 0.05);
  partial.stop(t + 0.2);
}

let noiseBuffer = null;

/** Short unpitched click for the metronome. */
export function click(accent = false) {
  const c = audio();
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, Math.round(c.sampleRate * 0.03), c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = accent ? 3500 : 2200;
  filter.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = accent ? 0.9 : 0.6;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

export function closeAudio() {
  if (ctx) {
    ctx.close();
    ctx = null;
    master = null;
    noiseBuffer = null;
  }
}
