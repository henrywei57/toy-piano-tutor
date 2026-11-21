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
 * Notice that a song in another tab has ended: after some sound, a few
 * seconds of near silence (a video's end, or the gap before the next video).
 * A tab's sound is silent between songs, unlike a microphone's.
 * update(db, seconds) is fed each block's level and length; true = stop now.
 */
export function createEndDetector({ quietDb = -65, quietFor = 4, soundFor = 3 } = {}) {
  let sound = 0;
  let quiet = 0;
  return {
    update(db, seconds) {
      if (db > quietDb) {
        sound += seconds;
        quiet = 0;
      } else if (sound >= soundFor) {
        quiet += seconds;
      }
      return sound >= soundFor && quiet >= quietFor;
    },
  };
}

/**
 * Record from a capture ({sampleRate, subscribe}) until stop() or the limit.
 * The recording can be paused (setOpen(false)): sound while paused is not
 * kept, except the last couple of seconds, which setOpen(true, back) can add
 * back in.
 * @param {object} capture  openMic() / openTabAudio() result
 * @param {object} [o]
 * @param {number} [o.maxSeconds=300]
 * @param {boolean} [o.open=true]          start recording right away
 * @param {(db:number, seconds:number)=>void} [o.onLevel]   level of each block (dBFS) and its length
 * @param {()=>void} [o.onLimit]            the limit was reached
 * @returns {{seconds:number, open:boolean, setOpen:(on:boolean, back?:number)=>void,
 *   stop:()=>{samples:Float32Array, sampleRate:number}}}
 */
export function recordCapture(capture, { maxSeconds = 300, open = true, onLevel, onLimit } = {}) {
  const rate = capture.sampleRate;
  const blocks = [];
  const max = Math.round(maxSeconds * rate);
  const keepBack = 2 * rate;
  let recent = []; // sound while paused: the last couple of seconds
  let recentLength = 0;
  let length = 0;
  let stopped = false;
  let isOpen = open;

  function keep(block) {
    if (length >= max) return;
    const take = block.length > max - length ? block.subarray(0, max - length) : block;
    blocks.push(take);
    length += take.length;
    if (length >= max && onLimit) onLimit();
  }

  const off = capture.subscribe((block) => {
    if (stopped || length >= max) return;
    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
      onLevel(10 * Math.log10(sum / Math.max(1, block.length) + 1e-12), block.length / rate);
    }
    if (isOpen) return keep(block);
    recent.push(block);
    recentLength += block.length;
    while (recent.length > 1 && recentLength - recent[0].length >= keepBack) recentLength -= recent.shift().length;
  });

  return {
    get seconds() { return length / rate; },
    get open() { return isOpen; },
    setOpen(on, back = 0) {
      if (stopped || on === isOpen) return;
      if (on && back > 0) {
        let need = Math.min(Math.round(back * rate), recentLength);
        const tail = [];
        for (let i = recent.length - 1; i >= 0 && need > 0; i--) {
          const b = recent[i];
          tail.unshift(b.length > need ? b.subarray(b.length - need) : b);
          need -= b.length;
        }
        tail.forEach(keep);
      }
      recent = [];
      recentLength = 0;
      isOpen = on;
    },
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
