// BULLSEYE — player intro videos ("throw clips"). A short video of a player
// throwing, played at the start of the winning-dart cinematic. Clips are kept
// on the device in IndexedDB (they are too big for localStorage), keyed by
// the player's name the same way photos are. A private deployment can also
// ship clips next to the page with a players/clips.json manifest.

const DB = 'bullseye-media';
const STORE = 'clips';
const key = (name) => String(name ?? '').trim().toLowerCase();
const urls = new Map(); // name key -> object URL (or shipped URL)
let shipped = null; // manifest: { "name": "players/file.mp4" }
let known = new Set(); // name keys that have a clip on this device

function open() {
  return new Promise((ok, no) => {
    if (!('indexedDB' in globalThis)) return no(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((ok, no) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => ok(out?.result ?? out);
    t.onerror = () => no(t.error);
  });
}

/** Load which players have clips (device and shipped). Call once at start. */
export async function initClips() {
  try {
    const keys = await tx('readonly', (s) => s.getAllKeys());
    known = new Set(keys);
  } catch {
    known = new Set();
  }
  try {
    const res = await fetch('players/clips.json', { cache: 'no-cache' });
    if (res.ok) {
      const m = await res.json();
      shipped = {};
      for (const [n, file] of Object.entries(m)) if (typeof file === 'string' && /^players\/[\w.-]+\.(mp4|webm)$/i.test(file)) shipped[key(n)] = file;
    }
  } catch {
    shipped = null;
  }
  return known;
}

/** Does this player have a clip (on this device or shipped with the site)? */
export const hasClip = (name) => known.has(key(name)) || !!shipped?.[key(name)];
/** Is the clip one this device saved (so it can be removed)? */
export const hasOwnClip = (name) => known.has(key(name));

/** A playable URL for the player's clip, or null. */
export async function clipUrl(name) {
  const k = key(name);
  if (urls.has(k)) return urls.get(k);
  if (known.has(k)) {
    try {
      const blob = await tx('readonly', (s) => s.get(k));
      if (blob) {
        const u = URL.createObjectURL(blob);
        urls.set(k, u);
        return u;
      }
    } catch {
      /* fall through to shipped */
    }
  }
  if (shipped?.[k]) {
    urls.set(k, shipped[k]);
    return shipped[k];
  }
  return null;
}

/** Save a video file as this player's clip. */
export async function saveClip(name, file) {
  const k = key(name);
  if (!k || !file || !/^video\//.test(file.type)) throw new Error('type');
  if (file.size > 60 * 1024 * 1024) throw new Error('size');
  await tx('readwrite', (s) => s.put(file, k));
  known.add(k);
  if (urls.has(k) && urls.get(k).startsWith('blob:')) URL.revokeObjectURL(urls.get(k));
  urls.delete(k);
}

export async function removeClip(name) {
  const k = key(name);
  await tx('readwrite', (s) => s.delete(k));
  known.delete(k);
  if (urls.get(k)?.startsWith('blob:')) URL.revokeObjectURL(urls.get(k));
  urls.delete(k);
}

/**
 * Play a clip full screen, broadcast style, with the player's name and a skip
 * button. Resolves when it ends, is skipped, or cannot play.
 */
export function playClip(url, { name = '', color = '#f5c46b', title = '', skip = 'Skip', avatar = '', onStart } = {}) {
  return new Promise((resolve) => {
    const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const root = document.createElement('div');
    root.className = 'clip-stage';
    root.style.setProperty('--pc', color);
    root.innerHTML = `
      <video playsinline muted preload="auto"></video>
      <div class="cine-bar top"><span class="cine-tag"><i></i>${esc(title)}</span></div>
      <div class="cine-lower">${avatar ? `<span class="cl-av">${avatar}</span>` : ''}<div class="cl-text"><small>${esc(title)}</small><b>${esc(name)}</b></div></div>
      <div class="cine-bar bottom"><span></span><button type="button" class="cine-skip">${esc(skip)} ›</button></div>`;
    document.body.appendChild(root);
    const v = root.querySelector('video');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      document.removeEventListener('keydown', onKey);
      root.classList.add('out');
      setTimeout(() => root.remove(), 380);
      resolve();
    };
    const onKey = (e) => e.key === 'Escape' && finish();
    document.addEventListener('keydown', onKey);
    root.querySelector('.cine-skip').addEventListener('click', finish);
    v.addEventListener('ended', finish);
    v.addEventListener('error', finish);
    // never hang the game: give up if the clip will not start, and cap its length
    let guard = setTimeout(finish, 4000);
    v.addEventListener('playing', () => {
      clearTimeout(guard);
      guard = setTimeout(finish, Math.min(12, (v.duration || 6) + 1) * 1000);
      onStart?.();
    }, { once: true });
    v.src = url;
    v.play().catch(finish);
  });
}
