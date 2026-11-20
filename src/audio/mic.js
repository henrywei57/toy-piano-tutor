// Microphone capture. Streams raw mono Float32 blocks to subscribers.
// Browser processing (echo cancellation, noise suppression, AGC) is turned
// off: it smears attacks and pumps the level of short metallic notes.

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
    node = new AudioWorkletNode(ctx, 'tpt-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
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

  const mic = {
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
      if (current === mic) current = null;
    },
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
