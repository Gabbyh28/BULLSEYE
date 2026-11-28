// BULLSEYE — player intro videos ("throw clips"). A short video of a player
// throwing, played at the start of the winning-dart cinematic. Clips are kept
// on the device in IndexedDB (they are too big for localStorage), keyed by
// the player's name the same way photos are. A private deployment can also
// ship clips next to the page with a players/clips.json manifest.

const DB = 'bullseye-media';
const STORE = 'clips';
const key = (name) => String(name ?? '').trim().toLowerCase();
const urls = new Map(); // name key -> object URL (or shipped URL)
let shipped = null; // name key -> { file, type, enc } for clips that ship with the site
let known = new Set(); // name keys that have a clip on this device
let sealed = null; // encrypted manifest (public site): { kdf, index }
let aesKey = null; // unlocked key for the encrypted clips
const KEY_STORE = 'bullseye:clipkey';
const subtle = () => globalThis.crypto?.subtle;
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));

async function open_(bytes) {
  const iv = bytes.slice(0, 12);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, aesKey, bytes.slice(12)));
}

/** Decrypt the name list with the current key; throws when the key is wrong. */
async function readIndex() {
  const idx = JSON.parse(new TextDecoder().decode(await open_(fromB64(sealed.index))));
  shipped = {};
  for (const [n, v] of Object.entries(idx)) if (v && /^c\d+\.bin$/.test(v.file)) shipped[key(n)] = { file: `players/${v.file}`, type: v.type === 'video/webm' ? 'video/webm' : 'video/mp4', enc: true };
}

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
      if (m?.v === 1 && m.kdf?.salt && m.index) {
        // encrypted videos: unlock with the key this device saved, if any
        sealed = m;
        const saved = localStorage.getItem(KEY_STORE);
        if (saved && subtle()) {
          try {
            aesKey = await subtle().importKey('raw', fromB64(saved), 'AES-GCM', false, ['decrypt']);
            await readIndex();
          } catch {
            aesKey = null;
            shipped = null;
            localStorage.removeItem(KEY_STORE); // the videos were re-encrypted with a new password
          }
        }
      } else {
        // a private deployment may list plain files: { "name": "players/file.mp4" }
        shipped = {};
        for (const [n, file] of Object.entries(m)) if (typeof file === 'string' && /^players\/[\w.-]+\.(mp4|webm)$/i.test(file)) shipped[key(n)] = { file, enc: false };
      }
    }
  } catch {
    /* no shipped clips */
  }
  return known;
}

/** Whether this site has encrypted videos, and whether this device has unlocked them. */
export const clipsLock = () => ({ available: !!sealed, locked: !!sealed && !aesKey, count: shipped ? Object.keys(shipped).length : 0 });

/** Unlock the site's encrypted videos with the group password; remembered on this device. */
export async function unlockClips(password) {
  if (!sealed || !subtle()) throw new Error('unavailable');
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const k = await subtle().deriveKey({ name: 'PBKDF2', salt: fromB64(sealed.kdf.salt), iterations: sealed.kdf.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  const prev = aesKey;
  aesKey = k;
  try {
    await readIndex();
  } catch {
    aesKey = prev;
    throw new Error('password');
  }
  try {
    localStorage.setItem(KEY_STORE, toB64(await subtle().exportKey('raw', k)));
  } catch {
    /* unlocked for this visit only */
  }
  return Object.keys(shipped).length;
}

/** Forget the password on this device. */
export function lockClips() {
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
  aesKey = null;
  if (sealed) shipped = null;
  for (const [k, u] of urls) if (!known.has(k)) {
    if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    urls.delete(k);
  }
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
  const sh = shipped?.[k];
  if (sh && !sh.enc) {
    urls.set(k, sh.file);
    return sh.file;
  }
  if (sh?.enc && aesKey) {
    try {
      const res = await fetch(sh.file);
      if (!res.ok) return null;
      const plain = await open_(new Uint8Array(await res.arrayBuffer()));
      const u = URL.createObjectURL(new Blob([plain], { type: sh.type }));
      urls.set(k, u);
      return u;
    } catch {
      return null;
    }
  }
  return null;
}

/** Fetch and decrypt a player's clip ahead of time, so the winning dart is not kept waiting. */
export function prefetchClip(name) {
  if (hasClip(name)) clipUrl(name).catch(() => {});
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
