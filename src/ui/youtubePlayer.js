// An embedded YouTube player (the official IFrame Player API, on the
// youtube-nocookie.com host). The video plays normally inside the app; the
// app only listens to the tab's sound while it plays.

const API_URL = 'https://www.youtube.com/iframe_api';
const STATES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };

let apiPromise = null;

/** Load YouTube's player API once. */
export function loadYouTubeApi({ timeout = 15000 } = {}) {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  apiPromise ||= new Promise((resolve, reject) => {
    const fail = () => {
      apiPromise = null;
      reject(new Error('YouTube’s player couldn’t load. Check the internet connection and try again.'));
    };
    const timer = setTimeout(fail, timeout);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = API_URL;
    s.async = true;
    s.onerror = () => { clearTimeout(timer); s.remove(); fail(); };
    document.head.append(s);
  });
  return apiPromise;
}

/**
 * Put a video player into `box` (the box must stay in the page: moving an
 * iframe reloads it).
 * @param {HTMLElement} box
 * @param {string} id      video id
 * @param {object} [o]
 * @param {number} [o.start]                     seconds
 * @param {(p:object)=>void} [o.onReady]
 * @param {(state:string)=>void} [o.onState]     unstarted|ended|playing|paused|buffering|cued
 * @param {(message:string, code:number)=>void} [o.onError]
 */
export async function createYouTubePlayer(box, id, { start = 0, onReady, onState, onError } = {}) {
  const YT = await loadYouTubeApi();
  const target = document.createElement('div');
  box.replaceChildren(target);
  let player = null;
  let ready = false;
  const api = {
    get ready() { return ready; },
    get id() { return id; },
    state() { return ready ? STATES[player.getPlayerState()] || 'unstarted' : 'unstarted'; },
    time() { return ready ? player.getCurrentTime() || 0 : 0; },
    duration() { return ready ? player.getDuration() || 0 : 0; },
    title() {
      try { return (ready && player.getVideoData && player.getVideoData().title) || ''; } catch { return ''; }
    },
    play() { if (ready) player.playVideo(); },
    pause() { if (ready) player.pauseVideo(); },
    seek(t) { if (ready) player.seekTo(t, true); },
    destroy() {
      try { if (player) player.destroy(); } catch { /* already gone */ }
      box.replaceChildren();
    },
  };
  player = new YT.Player(target, {
    host: 'https://www.youtube-nocookie.com',
    videoId: id,
    width: '100%',
    height: '100%',
    playerVars: { start: Math.floor(start) || undefined, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
    events: {
      onReady: () => { ready = true; if (onReady) onReady(api); },
      onStateChange: (e) => { if (onState) onState(STATES[e.data] || 'unstarted'); },
      onError: (e) => { if (onError) onError(errorText(e.data), e.data); },
    },
  });
  return api;
}

function errorText(code) {
  if (code === 101 || code === 150) return 'This video can’t play inside other apps. Its owner may have turned that off, or it may be private or removed.';
  if (code === 100) return 'This video wasn’t found. It may be private or removed.';
  if (code === 2) return 'That doesn’t look like a working YouTube link.';
  return 'This video can’t be played here.';
}
