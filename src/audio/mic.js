// Microphone (and browser tab) capture. Streams raw mono Float32 blocks to
// subscribers. Browser processing (echo cancellation, noise suppression, AGC)
// is turned off: it smears attacks and pumps the level of short metallic notes.

const WORKLET_SRC = `
class TptCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('tpt-capture', TptCapture);
`;

export class MicError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function explain(err) {
  if (err instanceof MicError) return err;
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MicError('denied', 'Microphone permission was denied. Allow it in your browser’s site settings and try again.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new MicError('no-device', 'No microphone was found.');
  }
  if (name === 'NotReadableError') {
    return new MicError('busy', 'The microphone is in use by another app.');
  }
  return new MicError('unknown', 'Could not start the microphone: ' + (err && err.message ? err.message : String(err)));
}

let current = null;

/**
 * Open (or reuse) the microphone. Must be called from a user gesture the
 * first time on iOS, because it creates/resumes the AudioContext.
 * @returns {Promise<{sampleRate:number, subscribe:(fn:(block:Float32Array)=>void)=>()=>void, close:()=>void}>}
 */
export async function openMic() {
  if (current) return current;
  if (!window.isSecureContext) {
    throw new MicError('insecure', 'The microphone only works over HTTPS or on localhost. Open the app from an https:// address.');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new MicError('unsupported', 'This browser does not support microphone input.');
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
  } catch (err) {
    throw explain(err);
  }

  const mic = await captureStream(stream);
  const close = mic.close;
  mic.close = () => {
    close();
    if (current === mic) current = null;
  };
  current = mic;
  return mic;
}

export function closeMic() {
  if (current) current.close();
}

export function micIsOpen() {
  return current !== null;
}

/** True if this browser can record the sound of another tab. */
export function canCaptureTab() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
    && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Record the sound of a browser tab (e.g. a video playing there). The browser
 * asks which tab to share; "Also share tab audio" must be on.
 * @param {object} [o]
 * @param {boolean} [o.thisTab]  this app's own tab (a video playing inside the
 *   app); the browser then just asks to allow it
 * @returns {Promise<{sampleRate:number, subscribe:Function, onEnded:(fn:()=>void)=>void, close:()=>void}>}
 */
export async function openTabAudio({ thisTab = false } = {}) {
  if (!canCaptureTab()) {
    throw new MicError('unsupported', 'This browser can’t record a tab. Use Chrome or Edge on a computer, or record with the microphone.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // required; only the sound is used
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      ...(thisTab
        ? { preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude' }
        : { selfBrowserSurface: 'exclude', systemAudio: 'include' }),
    });
  } catch (err) {
    if (err && err.name === 'NotAllowedError') throw new MicError('denied', 'Sharing was cancelled.');
    throw explain(err);
  }
  const audio = stream.getAudioTracks();
  if (!audio.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new MicError('no-audio', thisTab
      ? 'No sound was shared. Try again and keep “Also share tab audio” on.'
      : 'No sound was shared. Choose the tab with the video and turn on “Also share tab audio”.');
  }
  const cap = await captureStream(stream);
  cap.onEnded = (fn) => audio[0].addEventListener('ended', fn, { once: true });
  return cap;
}

/** Feed a MediaStream's sound through a capture worklet. */
async function captureStream(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const listeners = new Set();
  const emit = (block) => { for (const fn of listeners) fn(block); };

  let node;
  let blobUrl;
  try {
    blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(blobUrl);
    node = new AudioWorkletNode(ctx, 'tpt-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' }); // stereo is mixed down
    node.port.onmessage = (e) => emit(e.data);
  } catch {
    // Older browsers: fall back to the deprecated ScriptProcessorNode.
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => emit(new Float32Array(e.inputBuffer.getChannelData(0)));
  }

  // Keep the graph pulled without playing the mic back through the speaker.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  return {
    sampleRate: ctx.sampleRate,
    context: ctx,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      listeners.clear();
      try { source.disconnect(); node.disconnect(); mute.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
  };
}
