// BULLSEYE — phone scoring for big-screen mode.
// The big screen hosts a room; phones join by scanning a QR code and send
// darts, undo and next-player. Devices find each other through PeerJS's
// signalling server, then talk directly (WebRTC data channel). Nothing is stored.
//
// Libraries (MIT, vendored): PeerJS (vendor/peerjs), qrcode-generator (vendor/qrcode).

const BASE = new URL('../', import.meta.url);
const loaded = {};

function loadScript(path, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  loaded[path] ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = new URL(path, BASE).href;
    s.onload = () => (window[globalName] ? ok(window[globalName]) : fail(new Error(`${globalName} missing`)));
    s.onerror = () => fail(new Error(`could not load ${path}`));
    document.head.appendChild(s);
  });
  return loaded[path];
}

/** Optional override for testing or self-hosting: localStorage 'bullseye:peer' = {"host":..,"port":..,"path":..,"secure":..}. */
function peerOptions() {
  let custom = null;
  try {
    custom = JSON.parse(localStorage.getItem('bullseye:peer') || 'null');
  } catch {
    custom = null;
  }
  return { debug: 0, ...(custom || {}) };
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const peerIdFor = (code) => `bullseye-room-${code.toLowerCase()}`;

export const remoteCodeFromHash = () => {
  const m = /^#remote-([A-Za-z0-9]{5})$/.exec(location.hash);
  return m ? m[1].toUpperCase() : null;
};

export function remoteUrl(code) {
  return `${location.origin}${location.pathname}#remote-${code}`;
}

export async function qrSvg(text) {
  const qrcode = await loadScript('vendor/qrcode/qrcode.js', 'qrcode');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

/**
 * Host a room on the big screen.
 * onMessage(msg) receives {type:'dart', value, mult} | {type:'undo'} | {type:'next'}.
 * onPeers(count) reports how many phones are connected.
 */
export async function hostRoom({ onMessage, onPeers, onError }) {
  const Peer = await loadScript('vendor/peerjs/peerjs.min.js', 'Peer');
  const conns = new Set();
  let last = null;
  let peer = null;
  let code = null;

  const open = () =>
    new Promise((ok, fail) => {
      code = newCode();
      peer = new Peer(peerIdFor(code), peerOptions());
      peer.on('open', () => ok());
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id') {
          peer.destroy();
          open().then(ok, fail);
        } else if (!peer.open) fail(e);
        else onError?.(e);
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          conns.add(conn);
          onPeers?.(conns.size);
          if (last) conn.send(last);
        });
        conn.on('data', (msg) => {
          if (msg && typeof msg === 'object' && ['dart', 'undo', 'next'].includes(msg.type)) onMessage?.(msg);
        });
        const drop = () => {
          conns.delete(conn);
          onPeers?.(conns.size);
        };
        conn.on('close', drop);
        conn.on('error', drop);
      });
      peer.on('disconnected', () => {
        try {
          peer.reconnect();
        } catch {
          /* will retry on next action */
        }
      });
    });

  await open();
  return {
    get code() {
      return code;
    },
    broadcast(state) {
      last = state;
      conns.forEach((c) => c.open && c.send(state));
    },
    close() {
      conns.forEach((c) => c.close());
      peer?.destroy();
    },
  };
}

/** Join a room from a phone. onState(state) receives the live scoreboard. */
export async function joinRoom(code, { onState, onStatus }) {
  const Peer = await loadScript('vendor/peerjs/peerjs.min.js', 'Peer');
  let peer = null;
  let conn = null;
  let stopped = false;

  const connect = () => {
    onStatus?.('connecting');
    peer?.destroy();
    peer = new Peer(peerOptions());
    peer.on('open', () => {
      conn = peer.connect(peerIdFor(code), { reliable: true });
      conn.on('open', () => onStatus?.('connected'));
      conn.on('data', (s) => s && typeof s === 'object' && onState?.(s));
      conn.on('close', () => !stopped && retry());
      conn.on('error', () => !stopped && retry());
    });
    peer.on('error', (e) => {
      onStatus?.(e.type === 'peer-unavailable' ? 'missing' : 'error');
      if (!stopped) retry();
    });
  };
  let timer = 0;
  const retry = () => {
    clearTimeout(timer);
    onStatus?.('lost');
    timer = setTimeout(connect, 2500);
  };
  connect();
  return {
    send(msg) {
      if (conn?.open) {
        conn.send(msg);
        return true;
      }
      return false;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      peer?.destroy();
    },
  };
}
