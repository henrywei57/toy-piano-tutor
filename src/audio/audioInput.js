// Getting a song's sound into the app: decode an audio file, or record a
// stream (microphone or browser tab) into one buffer, at the sample rate the
// note finder wants.

function offlineContext(channels, length, rate) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new Offline(channels, length, rate);
}

/** Average the channels of an AudioBuffer into one. */
function mixDown(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= buffer.numberOfChannels;
  return out;
}

/** Resample mono audio with the browser's own resampler. */
export async function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ctx = offlineContext(1, Math.max(1, Math.ceil((samples.length * toRate) / fromRate)), toRate);
  const buffer = ctx.createBuffer(1, samples.length, fromRate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/**
 * Decode an audio file (MP3, M4A/AAC, WAV, OGG… whatever the browser plays)
 * to mono at `rate`.
 * @param {ArrayBuffer} data
 * @returns {Promise<Float32Array>}
 */
export async function decodeAudio(data, rate) {
  let buffer = null;
  // decodeAudioData resamples to its context's rate; some browsers only allow common rates.
  for (const r of [rate, 44100]) {
    try {
      buffer = await offlineContext(1, 1, r).decodeAudioData(data.slice(0));
      break;
    } catch { /* try the next rate, or give up */ }
  }
  if (!buffer) throw new Error('This file couldn’t be read as audio. Try an MP3, M4A, WAV or OGG file.');
  return resample(mixDown(buffer), buffer.sampleRate, rate);
}

/**
 * Record from a capture ({sampleRate, subscribe}) until stop() or the limit.
 * @param {object} capture  openMic() / openTabAudio() result
 * @param {object} [o]
 * @param {number} [o.maxSeconds=300]
 * @param {(db:number)=>void} [o.onLevel]   level of each block, dBFS
 * @param {()=>void} [o.onLimit]            the limit was reached
 * @returns {{seconds:number, stop:()=>{samples:Float32Array, sampleRate:number}}}
 */
export function recordCapture(capture, { maxSeconds = 300, onLevel, onLimit } = {}) {
  const blocks = [];
  const max = Math.round(maxSeconds * capture.sampleRate);
  let length = 0;
  let stopped = false;
  const off = capture.subscribe((block) => {
    if (stopped || length >= max) return;
    const take = block.length > max - length ? block.subarray(0, max - length) : block;
    blocks.push(take);
    length += take.length;
    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < take.length; i++) sum += take[i] * take[i];
      onLevel(10 * Math.log10(sum / Math.max(1, take.length) + 1e-12));
    }
    if (length >= max && onLimit) onLimit();
  });
  return {
    get seconds() { return length / capture.sampleRate; },
    stop() {
      stopped = true;
      off();
      const samples = new Float32Array(length);
      let at = 0;
      for (const b of blocks) { samples.set(b, at); at += b.length; }
      return { samples, sampleRate: capture.sampleRate };
    },
  };
}
