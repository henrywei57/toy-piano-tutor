import './styles.css';
import { h } from './ui/dom.js';
import { profilesView } from './ui/profilesView.js';
import { calibrateView } from './ui/calibrateView.js';
import { songView } from './ui/songView.js';
import { mapView } from './ui/mapView.js';
import { tutorView } from './ui/tutorView.js';
import { getActiveId, onProfilesChange } from './profile/store.js';

const app = document.getElementById('app');
const tabs = document.getElementById('tabs');

// path pattern -> view. Views are (root, ctx) => cleanup.
const routes = [
  { pattern: /^#\/?$/, view: profilesView, tab: 'pianos' },
  { pattern: /^#\/calibrate\/([\w-]+)$/, view: calibrateView, tab: 'calibrate', keys: ['id'] },
  { pattern: /^#\/song$/, view: songView, tab: 'song' },
  { pattern: /^#\/map$/, view: mapView, tab: 'map' },
  { pattern: /^#\/play$/, view: tutorView, tab: 'play' },
];

let cleanup = null;
let currentTab = 'pianos';

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  let hash = location.hash || '#/';
  if (hash === '#/calibrate') {
    const id = getActiveId();
    hash = id ? '#/calibrate/' + id : '#/';
    history.replaceState(null, '', hash);
  }
  const match = routes.map((r) => ({ r, m: r.pattern.exec(hash) })).find((x) => x.m)
    || { r: routes[0], m: [] };
  const params = {};
  (match.r.keys || []).forEach((k, i) => { params[k] = decodeURIComponent(match.m[i + 1]); });

  if (cleanup) cleanup();
  window.scrollTo(0, 0);
  currentTab = match.r.tab;
  cleanup = match.r.view(app, { params, navigate }) || null;
  renderTabs(currentTab);
}

function renderTabs(activeTab = currentTab) {
  const hasActive = Boolean(getActiveId());
  const items = [
    { id: 'pianos', label: 'Pianos', href: '#/' },
    { id: 'calibrate', label: 'Calibrate', href: '#/calibrate', disabled: !hasActive },
    { id: 'song', label: 'Songs', href: '#/song' },
    { id: 'map', label: 'Map', href: '#/map' },
    { id: 'play', label: 'Play', href: '#/play' },
  ];
  tabs.replaceChildren(...items.map((t) => h('a', {
    class: 'tab' + (t.id === activeTab ? ' on' : '') + (t.disabled ? ' disabled' : ''),
    href: t.disabled ? null : t.href,
    'aria-current': t.id === activeTab ? 'page' : null,
    'aria-disabled': t.disabled ? 'true' : null,
  }, t.label)));
}

window.addEventListener('hashchange', route);
onProfilesChange(() => renderTabs());
route();

// Offline support / installability. Only in production builds, so the dev
// server never serves stale cached files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
  });
}
