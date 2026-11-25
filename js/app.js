// BULLSEYE — application shell, screens and game flow.
import {
  MODES, CRICKET_KEYS, isX01, modeInfo, makeDart, randomPointFor, checkout, createMatch, throwDart,
  nextTurn, commitLeg, activePlayer, targetsFor, aroundTarget, activeBracketMatch, legsTarget, setsTarget,
} from './engine.js';
import { Board, BOARD_SKINS } from './board.js';
import { sfx, say, confetti, callout, configureFx, haptic, unlockSpeech, voiceStatus, loadClip, fireworks, winnerBanner } from './fx.js';
import { load, save, flush, recordLeg, recordMatch, resetStats, exportBackup, readBackup, restoreBackup, photoKey } from './storage.js';
import { t, setLang, getLang } from './i18n.js';
import { call180, callTurnScore, callBust, callGameShot, callUpNext, callIntro, callVersus, callGameOn } from './caller.js';
import { playWalkOn } from './walkon.js';
import { hostRoom, joinRoom, qrSvg, remoteUrl, remoteCodeFromHash } from './remote.js';

const data = load();

/* The 3D board loads in the background; the 2D board covers until it's ready
   and stays as the fallback when WebGL isn't available. */
let Board3D = null;
const board3dReady = (async () => {
  try {
    const m = await import('./board3d.js');
    if (m.webglOK()) Board3D = m.Board3D;
  } catch (e) {
    console.warn('3D board unavailable, using 2D', e);
  }
  return Board3D;
})();
const THEMES = ['championship', 'neon', 'tavern', 'daylight', 'blaze', 'candy'];
const AVATARS = ['🎯', '🦊', '🐯', '🦁', '🐺', '🦅', '🐉', '👑', '⚡', '🔥', '🚀', '🎸', '🍀', '🐙', '🦄', '👾', '🥷', '🧙'];
const COLORS = ['#f5c46b', '#4fd1c5', '#ff6b8b', '#8b9dff', '#7ee081', '#ff9f43', '#c792ea', '#5ad2ff'];
const MODE_GLYPH = { 501: '501', 301: '301', 701: '701', cricket: '15–20', around: '1→20', shanghai: 'S·D·T', killer: '♥♥♥', highscore: '8R' };
const MIN_PLAYERS = { killer: 2 };

const state = {
  view: 'lobby',
  undo: [],
  autoTimer: 0,
  kpMult: 1,
  board: null,
  demo: null,
  demoTimer: 0,
  statsPlayer: null,
  pending: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));
/** What goes inside an avatar: the player's photo if they have one, else their emoji. */
const photoOf = (name) => data.photos?.[photoKey(name)] ?? null;
const face = (p) => {
  const src = p && photoOf(p.name);
  return src ? `<img src="${src}" alt="" draggable="false">` : p?.avatar ?? '🎯';
};
const prefs = data.prefs;

/* ───────────────────────── boot ───────────────────────── */

function boot() {
  if (!prefs.lang) prefs.lang = (navigator.language || 'en').toLowerCase().startsWith('he') ? 'he' : 'en';
  if (!data.roster.length) {
    data.roster.push(newPlayer(0));
    data.roster.push(newPlayer(1));
  }
  applyPrefs();
  renderTopbar();
  let restored = false;
  try {
    restored = sessionStorage.getItem('bullseye:restored') === '1';
    sessionStorage.removeItem('bullseye:restored');
  } catch {
    /* storage unavailable */
  }
  state.notice = restored ? t('restored') : '';
  const tb = $('#topbar');
  const setTop = () => document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
  setTop();
  if ('ResizeObserver' in window) new ResizeObserver(setTop).observe(tb);
  const remoteCode = remoteCodeFromHash();
  if (remoteCode) return renderRemote(remoteCode);
  go(restored ? 'stats' : 'lobby');
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', unlockSpeech, { capture: true, passive: true });
  document.addEventListener('pointerdown', () => prefs.sound && loadClip('ole'), { capture: true, passive: true, once: true });
  document.addEventListener('keydown', unlockSpeech, { capture: true });
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => document.hidden && flush());
}

function applyPrefs() {
  setLang(prefs.lang);
  const root = document.documentElement;
  root.lang = prefs.lang;
  root.dir = prefs.lang === 'he' ? 'rtl' : 'ltr';
  root.dataset.theme = prefs.theme;
  root.dataset.motion = prefs.motion;
  root.dataset.quality = prefs.quality;
  configureFx({ sound: prefs.sound, voice: prefs.voice, lang: prefs.lang });
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#070a12';
  [state.board, state.demo, state.statsBoard].forEach((b) => {
    b?.setSkin(prefs.theme);
    b?.setQuality(prefs.quality === 'high' ? 'high' : 'low');
  });
}

function newPlayer(i) {
  const used = new Set(data.roster.map((p) => p.name.toLowerCase()));
  let n = i + 1;
  let name = t('playerN', { n });
  while (used.has(name.toLowerCase())) name = t('playerN', { n: ++n });
  const usedColors = new Set(data.roster.map((p) => p.color));
  return {
    id: Date.now() + Math.floor(Math.random() * 1e6),
    name,
    avatar: AVATARS[(i * 5 + 1) % AVATARS.length],
    color: COLORS.find((c) => !usedColors.has(c)) ?? COLORS[i % COLORS.length],
  };
}

/* ───────────────────────── top bar ───────────────────────── */

function renderTopbar() {
  $('#topbar').innerHTML = `
    <button class="brand" data-go="lobby" aria-label="BULLSEYE">
      ${logoSVG()}
      <span class="brand-text"><b>BULLSEYE</b><small>${t('tagline')}</small></span>
    </button>
    <nav class="nav" aria-label="main">
      <button data-go="lobby" class="${state.view !== 'stats' ? 'active' : ''}">${t('navPlay')}</button>
      <button data-go="stats" class="${state.view === 'stats' ? 'active' : ''}">${t('navStats')}</button>
    </nav>
    <div class="top-tools">
      <div class="theme-dots" role="radiogroup" aria-label="theme">
        ${THEMES.map((th) => `<button role="radio" aria-checked="${th === prefs.theme}" title="${t('th_' + th)}" data-theme-pick="${th}" class="dot th-${th}"></button>`).join('')}
      </div>
      <button class="icon-btn" data-action="settings" title="${t('settings')}" aria-label="${t('settings')}">${icon('gear')}</button>
      <button class="icon-btn hide-sm" data-action="fullscreen" title="${t('fullscreen')}" aria-label="${t('fullscreen')}">${icon('expand')}</button>
    </div>`;
}

function logoSVG() {
  return `<svg class="logo" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="19" fill="var(--logo-ring)"/>
    <circle cx="20" cy="20" r="14.5" fill="none" stroke="var(--accent)" stroke-width="2.4"/>
    <circle cx="20" cy="20" r="9" fill="none" stroke="var(--logo-mid)" stroke-width="2.4"/>
    <circle cx="20" cy="20" r="4" fill="var(--hot)"/>
    <path d="M31 9 L22 18" stroke="var(--text)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M30 5 l5 5 -3 1 -3 -3z" fill="var(--accent)"/>
  </svg>`;
}

function icon(name) {
  const p = {
    gear: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    tv: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    camera: '<path d="M14.5 4h-5L7.5 6.5H4a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>',
    grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    board: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    pad: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  }[name];
  return `<svg class="ico ico-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ───────────────────────── routing ───────────────────────── */

function makeBoard(host, opts) {
  if (Board3D && prefs.quality === 'high') {
    try {
      return new Board3D(host, opts);
    } catch (e) {
      console.warn('3D board failed, using 2D', e);
      host.querySelectorAll('canvas, .b3d-overlay').forEach((n) => n.remove());
    }
  }
  return new Board(host, opts);
}

/** Mount a board into state[key]; swap to 3D once the engine finishes loading. */
function mountBoard(key, host, opts, after) {
  state[key] = makeBoard(host, opts);
  after?.(state[key]);
  if (!state[key].is3D && prefs.quality === 'high' && !Board3D) {
    board3dReady.then((B) => {
      const cur = state[key];
      if (!B || !cur || cur.host !== host || !host.isConnected) return;
      cur.destroy();
      state[key] = makeBoard(host, opts);
      after?.(state[key]);
    });
  }
}

function destroyBoards() {
  ['board', 'demo', 'statsBoard'].forEach((k) => {
    state[k]?.destroy?.();
    state[k] = null;
  });
}

function go(view) {
  state.cinematic = false;
  closePhotoMenu();
  if (view !== 'game') exitTv();
  clearTimeout(state.autoTimer);
  clearInterval(state.demoTimer);
  state.view = view;
  destroyBoards();
  const main = $('#view');
  main.className = `view view-${view}`;
  if (view === 'lobby') renderLobby(main);
  else if (view === 'game') renderGame(main);
  else if (view === 'stats') renderStats(main);
  renderTopbar();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button, [data-go], [data-action]');
  if (!b) return;
  if (b.dataset.go) {
    if (b.dataset.go === 'lobby' && state.view === 'game') return go('lobby');
    return go(b.dataset.go);
  }
  if (b.dataset.themePick) {
    prefs.theme = b.dataset.themePick;
    save();
    applyPrefs();
    renderTopbar();
    if (state.view === 'lobby') refreshLobbyBits();
    return;
  }
  const a = b.dataset.action;
  if (a === 'settings') openSettings();
  if (a === 'fullscreen') toggleFullscreen();
});

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } catch {
    /* unsupported */
  }
}

/* ───────────────────────── lobby ───────────────────────── */

function renderLobby(main) {
  const c = data.config;
  const resumable = data.match && !data.match.finished;
  main.innerHTML = `
    <section class="setup">
      <div class="setup-stage reveal">
        <div class="stage-copy">
          <span class="kicker"><i class="live-dot"></i>${t('heroKicker')}</span>
          <h1 class="setup-title"><span>${t('heroTitle1')}</span> <em>${t('heroTitle2')}</em></h1>
        </div>
        <div class="setup-board"><div class="spot"></div><div class="board-host demo" id="demo-board"></div></div>
      </div>

      <div class="setup-panel panel reveal" style="--d:.08s">
        <div class="sp-sec">
          <header class="sp-head"><span class="sp-no" dir="ltr">1</span><h2>${t('step1t')}</h2><p class="sp-desc" id="mode-desc">${t('m' + c.mode + 'd')}</p></header>
          <div class="mode-grid compact" role="radiogroup" aria-label="${t('step1t')}">
            ${MODES.map((m) => `
              <button class="mode-card ${m.id === c.mode ? 'on' : ''}" role="radio" aria-checked="${m.id === c.mode}" data-mode="${m.id}" title="${t('m' + m.id + 'd')}">
                <span class="mode-glyph" dir="ltr">${MODE_GLYPH[m.id]}</span>
                <b>${modeTitle(m.id)}</b>
              </button>`).join('')}
          </div>
          <div class="rules-row" id="rules"></div>
        </div>

        <div class="sp-sec">
          <header class="sp-head"><span class="sp-no" dir="ltr">2</span><h2>${t('step2t')}</h2>
            <button class="btn ghost sm add-player" data-lobby="add">${icon('plus')} ${t('addPlayer')}</button></header>
          <ol class="roster compact" id="roster"></ol>
        </div>

        <div class="sp-sec">
          <header class="sp-head"><span class="sp-no" dir="ltr">3</span><h2>${t('step3t')}</h2></header>
          <div class="arena-row" id="arenas" role="radiogroup" aria-label="${t('step3t')}"></div>
        </div>

        <footer class="sp-foot">
          <div class="start-summary"><b id="summary2"></b><small>${t('startHint')}</small></div>
          <p class="form-error" id="lobby-error" role="alert"></p>
          <div class="sp-actions">
            ${resumable ? `<button class="btn ghost" data-lobby="resume">${t('resume')}</button>` : ''}
            <button class="btn primary" data-lobby="start">${t('start')} ${icon('next')}</button>
          </div>
        </footer>
      </div>
    </section>`;

  renderRules();
  renderRoster();
  renderArenas();
  updateSummary();

  // On phones the board is a small emblem: the light 2D board is plenty there.
  const small = matchMedia('(max-width: 699px)').matches;
  if (small) state.demo = new Board($('#demo-board'), { interactive: false, skin: prefs.theme });
  else mountBoard('demo', $('#demo-board'), { interactive: false, skin: prefs.theme, cinematic: true });
  const demoThrow = () => {
    if (!state.demo) return;
    if (state.demo.darts.length >= 3) state.demo.clearDarts();
    const pick = [[20, 3], [20, 3], [20, 1], [19, 3], [25, 2], [20, 3], [5, 1], [1, 1]][Math.floor(Math.random() * 8)];
    const p = randomPointFor(...pick);
    state.demo.addDart(makeDart(pick[0], pick[1], p.x, p.y), { color: COLORS[Math.floor(Math.random() * 4)], index: state.demo.darts.length });
  };
  if (prefs.motion !== 'off' && !small) {
    setTimeout(demoThrow, 900);
    state.demoTimer = setInterval(demoThrow, 1700);
  }

  main.onclick = onLobbyClick;
  main.oninput = onLobbyInput;
  bindRosterDrag();
}

function modeTitle(id) {
  return t('m' + id);
}

function refreshLobbyBits() {
  renderArenas();
  updateSummary();
}

function renderRules() {
  const c = data.config;
  const x01 = isX01(c.mode);
  const desc = $('#mode-desc');
  if (desc) desc.textContent = t('m' + c.mode + 'd');
  $('#rules').innerHTML = `
    ${x01 ? `
    <label class="switch sm" title="${t('doubleOutHint')}">
      <input type="checkbox" data-cfg="doubleOut" ${c.doubleOut ? 'checked' : ''}>
      <span class="track"><span class="thumb"></span></span>
      <span><b>${t('doubleOut')}</b></span>
    </label>` : ''}
    <div class="seg sm" role="radiogroup" aria-label="${t('format')}">
      ${['single', 'legs', 'tournament'].map((f) => `<button role="radio" aria-checked="${c.format === f}" class="${c.format === f ? 'on' : ''}" data-format="${f}">${t('fmt' + f[0].toUpperCase() + f.slice(1))}</button>`).join('')}
    </div>
    ${c.format !== 'single' ? stepper('legs', t('legsToWin'), c.legs, 1, 11) : ''}
    ${c.format === 'legs' ? stepper('sets', t('setsToWin'), c.sets, 1, 7) : ''}`;
}

function stepper(key, label, value, min, max) {
  const short = key === 'legs' ? t('legs') : t('sets');
  return `<div class="field inline"><span class="label"><span class="lbl-long">${label}</span><span class="lbl-short">${short}</span></span>
    <div class="stepper sm" data-key="${key}" data-min="${min}" data-max="${max}">
      <button data-step="-1" aria-label="-">−</button><output dir="ltr">${value}</output><button data-step="1" aria-label="+">+</button>
    </div></div>`;
}

function renderRoster() {
  const list = $('#roster');
  list.innerHTML = data.roster
    .map(
      (p, i) => `
    <li class="player-row" data-idx="${i}" style="--pc:${p.color}">
      <span class="grip" data-grip title="${t('moveUp')} / ${t('moveDown')}">${icon('grip')}</span>
      <button class="avatar sm ${photoOf(p.name) ? 'has-photo' : ''}" data-avatar="${i}" aria-label="${t('photoMenu')}" aria-haspopup="menu">${face(p)}<i class="cam-badge" aria-hidden="true">${icon('camera')}</i></button>
      <input class="name" maxlength="24" value="${esc(p.name)}" data-name="${i}" aria-label="${t('playerN', { n: i + 1 })}">
      <button class="color-dot" data-color-cycle="${i}" style="--c:${p.color}" aria-label="colour"></button>
      <button class="icon-btn xs danger" data-remove="${i}" aria-label="${t('remove')}" ${data.roster.length <= 1 ? 'disabled' : ''}>${icon('x')}</button>
    </li>`,
    )
    .join('');
  list.classList.toggle('many', data.roster.length > 4);
  $('.setup')?.classList.toggle('many', data.roster.length > 4);
  $('[data-lobby="add"]').disabled = data.roster.length >= 8;
}

function renderArenas() {
  const host = $('#arenas');
  if (!host) return;
  host.innerHTML = THEMES.map((th) => {
    const sk = BOARD_SKINS[th];
    return `<button class="arena-chip th-${th} ${th === prefs.theme ? 'on' : ''}" data-arena="${th}" role="radio" aria-checked="${th === prefs.theme}" title="${t('th_' + th)}">
      <span class="mini-board" style="--d:${sk.dark};--l:${sk.light};--r:${sk.red};--g:${sk.green};--rim:${sk.rim[0]}"></span>
      <small>${t('th_' + th)}</small>
    </button>`;
  }).join('');
}

function updateSummary() {
  const c = data.config;
  const parts = [modeTitle(c.mode)];
  if (isX01(c.mode) && c.doubleOut) parts.push(t('doubleOut'));
  if (c.format === 'legs') parts.push(`${t('legsToWin')} ${c.legs}${c.sets > 1 ? ` · ${t('sets')} ${c.sets}` : ''}`);
  if (c.format === 'tournament') parts.push(t('fmtTournament'));
  parts.push(`${data.roster.length} ${data.roster.length === 1 ? t('player') : t('players')}`);
  const txt = parts.join(' · ');
  ['#summary', '#summary2'].forEach((sel) => $(sel) && ($(sel).textContent = txt));
}

function onLobbyClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const c = data.config;
  if (b.dataset.mode) {
    c.mode = b.dataset.mode;
    $$('.mode-card').forEach((m) => {
      m.classList.toggle('on', m.dataset.mode === c.mode);
      m.setAttribute('aria-checked', m.dataset.mode === c.mode);
    });
    renderRules();
    sfx.tick();
  } else if (b.dataset.format) {
    c.format = b.dataset.format;
    renderRules();
  } else if (b.dataset.step) {
    const st = b.closest('.stepper');
    const k = st.dataset.key;
    c[k] = Math.max(+st.dataset.min, Math.min(+st.dataset.max, (c[k] || 1) + +b.dataset.step));
    st.querySelector('output').textContent = c[k];
  } else if (b.dataset.avatar != null) {
    openPhotoMenu(b, +b.dataset.avatar);
    return;
  } else if (b.dataset.colorCycle != null) {
    const p = data.roster[+b.dataset.colorCycle];
    const taken = new Set(data.roster.filter((o) => o !== p).map((o) => o.color));
    let i = COLORS.indexOf(p.color);
    for (let n = 0; n < COLORS.length; n++) {
      i = (i + 1) % COLORS.length;
      if (!taken.has(COLORS[i])) break;
    }
    p.color = COLORS[i];
    renderRoster();
  } else if (b.dataset.move) {
    const [i, d] = b.dataset.move.split(':').map(Number);
    moveRoster(i, i + d);
  } else if (b.dataset.remove != null) {
    data.roster.splice(+b.dataset.remove, 1); // the photo stays saved to the name
    renderRoster();
  } else if (b.dataset.arena) {
    prefs.theme = b.dataset.arena;
    applyPrefs();
    renderTopbar();
    renderArenas();
  } else if (b.dataset.lobby === 'add') {
    if (data.roster.length < 8) data.roster.push(newPlayer(data.roster.length));
    renderRoster();
    $$('.player-row').at(-1)?.querySelector('.name')?.select();
  } else if (b.dataset.lobby === 'start') {
    startMatch();
    return;
  } else if (b.dataset.lobby === 'resume') {
    state.undo = [];
    go('game');
    return;
  } else return;
  updateSummary();
  save();
}

function onLobbyInput(e) {
  if (e.target.dataset.cfg) {
    data.config[e.target.dataset.cfg] = e.target.checked;
  } else if (e.target.dataset.name != null) {
    const i = +e.target.dataset.name;
    const p = data.roster[i];
    const had = photoOf(p.name);
    p.name = e.target.value;
    const now = photoOf(p.name);
    if (had !== now) {
      const btn = $(`[data-avatar="${i}"]`);
      if (btn) {
        btn.classList.toggle('has-photo', !!now);
        btn.innerHTML = `${face(p)}<i class="cam-badge" aria-hidden="true">${icon('camera')}</i>`;
        if (now) btn.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      }
    }
  }
  updateSummary();
  save();
}

/* ── player photos ── */

/** Centre-crop to a square (biased up, where faces usually are) and shrink to a small JPEG. */
async function processPhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('type');
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = no;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width;
  const h = src.height;
  const side = Math.min(w, h);
  const S = 192;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (w - side) / 2, Math.max(0, (h - side) * 0.3), side, side, 0, 0, S, S);
  src.close?.();
  return c.toDataURL('image/jpeg', 0.82);
}

function closePhotoMenu() {
  document.querySelector('.photo-menu')?.remove();
  document.removeEventListener('pointerdown', state.photoMenuAway, true);
}

function openPhotoMenu(anchor, idx) {
  closePhotoMenu();
  const p = data.roster[idx];
  const has = !!photoOf(p.name);
  const menu = document.createElement('div');
  menu.className = 'photo-menu panel';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <p class="pm-for">${p.name.trim() ? t('photoFor', { name: esc(p.name.trim()) }) : t('photoNeedsName')}</p>
    <button role="menuitem" data-pm="upload" ${p.name.trim() ? '' : 'disabled'}>${icon('camera')} ${has ? t('photoChange') : t('photoAdd')}</button>
    ${has ? `<button role="menuitem" data-pm="remove">${icon('x')} ${t('photoRemove')}</button>` : `<button role="menuitem" data-pm="emoji"><span class="pm-emoji">${AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length]}</span> ${t('nextEmoji')}</button>`}
    <input type="file" accept="image/*" hidden>`;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const left = Math.min(innerWidth - mw - 8, Math.max(8, getLang() === 'he' ? r.right - mw : r.left));
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.min(innerHeight - menu.offsetHeight - 8, r.bottom + 6)}px`;
  const input = menu.querySelector('input');
  const refresh = () => {
    closePhotoMenu();
    renderRoster();
    save();
  };
  menu.addEventListener('click', (e) => {
    const a = e.target.closest('[data-pm]')?.dataset.pm;
    if (a === 'upload') input.click();
    else if (a === 'remove') {
      delete data.photos[photoKey(p.name)];
      refresh();
    } else if (a === 'emoji') {
      p.avatar = AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length];
      refresh();
    }
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (!p.name.trim()) throw new Error('name');
      data.photos ??= {};
      data.photos[photoKey(p.name)] = await processPhoto(file);
      refresh();
    } catch {
      closePhotoMenu();
      const err = $('#lobby-error');
      if (err) err.textContent = t('photoError');
    }
  });
  state.photoMenuAway = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePhotoMenu();
  };
  setTimeout(() => document.addEventListener('pointerdown', state.photoMenuAway, true), 0);
  menu.querySelector('button')?.focus();
}

function moveRoster(from, to) {
  if (to < 0 || to >= data.roster.length) return;
  const [p] = data.roster.splice(from, 1);
  data.roster.splice(to, 0, p);
  renderRoster();
  save();
}

function bindRosterDrag() {
  const list = $('#roster');
  let drag = null;
  const clearDrop = () => $$('.player-row.drop', list).forEach((r) => r.classList.toggle('drop', false));
  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    const row = grip.closest('.player-row');
    drag = { row, idx: +row.dataset.idx, x0: e.clientX, y0: e.clientY, target: null };
    row.classList.add('dragging');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.row.style.transform = `translate(${e.clientX - drag.x0}px, ${e.clientY - drag.y0}px)`;
    drag.row.style.pointerEvents = 'none';
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.player-row');
    drag.row.style.pointerEvents = '';
    clearDrop();
    if (over && over !== drag.row) {
      over.classList.add('drop');
      drag.target = +over.dataset.idx;
    } else drag.target = null;
  });
  const end = () => {
    if (!drag) return;
    const { idx, target, row } = drag;
    drag = null;
    row.classList.toggle('dragging', false);
    row.style.transform = '';
    clearDrop();
    if (target != null && target !== idx) moveRoster(idx, target);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

function startMatch() {
  const err = $('#lobby-error');
  const c = data.config;
  const names = data.roster.map((p) => p.name.trim());
  const min = c.format === 'tournament' ? 3 : MIN_PLAYERS[c.mode] ?? 1;
  let msg = '';
  if (names.some((n) => !n) || new Set(names.map((n) => n.toLowerCase())).size !== names.length) msg = t('errNames');
  else if (names.length < min) msg = t('errMin', { n: min });
  if (msg) {
    err.textContent = msg;
    err.parentElement.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 });
    return;
  }
  data.roster.forEach((p) => (p.name = p.name.trim()));
  data.match = createMatch(c, data.roster);
  state.undo = [];
  save();
  sfx.whoosh();
  const intro = prefs.walkOn !== false && prefs.motion !== 'off';
  state.intro = intro;
  go('game');
  if (intro) runWalkOn();
}

/* ───────────────────────── game ───────────────────────── */

const match = () => data.match;
const leg = () => data.match?.leg;
const pinfo = (pid) => match().roster.find((p) => p.id === pid);

function renderGame(main) {
  if (!data.match) return go('lobby');
  main.innerHTML = `
    <section class="game">
      <div class="matchbar" id="matchbar"></div>
      <div class="stage">
        <div class="stage-light"></div>
        <div class="board-wrap">
          <div class="board-host" id="game-board"></div>
          <div class="callouts" id="callouts" aria-live="assertive"></div>
          <div class="toast-slot" id="toast"></div>
        </div>
        <p class="aim-hint">${t('aim')}</p>
      </div>
      <aside class="side">
        <div class="hero-card panel" id="hero"></div>
        <div class="controls" id="controls"></div>
        <div class="keypad panel" id="keypad"></div>
        <div class="scores" id="scores"></div>
        <div class="feed panel" id="feed"></div>
      </aside>
    </section>`;
  main.onclick = onGameClick;
  if (state.tv) {
    $('.game').classList.add('tv');
    setTimeout(renderTvPanel, 0);
  }
  mountBoard('board', $('#game-board'), { skin: prefs.theme, onHit: (d) => onDart(d) }, (b) => {
    b.showDarts(leg().turn, pinfo(activePlayer(leg()).pid).color);
    updateGame();
  });
  if (leg().winners) setTimeout(showResult, 200);
  else if (!leg().turn.length && !state.intro) setTimeout(announceTurn, 700);
}

function onGameClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const a = b.dataset.g;
  if (a === 'undo') undo();
  else if (a === 'next') advance();
  else if (a === 'miss') onDart(manualDart(0, 0));
  else if (a === 'input') {
    prefs.input = prefs.input === 'board' ? 'keypad' : 'board';
    save();
    updateGame();
  } else if (a === 'mult') {
    state.kpMult = +b.dataset.m;
    renderKeypad();
  } else if (a === 'num') {
    const v = +b.dataset.v;
    const m = v === 25 ? Math.min(2, +b.dataset.m || 1) : state.kpMult;
    onDart(manualDart(v, m));
    state.kpMult = 1;
    renderKeypad();
  } else if (a === 'tv') {
    if (state.tv) exitTv();
    else enterTv();
  } else if (a === 'quit') {
    go('lobby');
  }
}

function manualDart(v, m) {
  const p = randomPointFor(v, m);
  return makeDart(v, m, p.x, p.y);
}

function onDart(dart) {
  const m = match();
  if (!m || m.finished || leg().winners || $('.modal.open') || state.cinematic) return;
  if (leg().turnDone) advance(true);
  clearTimeout(state.autoTimer);
  state.undo.push(clone(m));
  if (state.undo.length > 300) state.undo.shift();
  const before = leg();
  const player = activePlayer(before);
  const { leg: next, events } = throwDart(before, dart);
  m.leg = next;
  const color = pinfo(player.pid).color;
  const hitSound = () => (dart.value === 1 ? sfx.ole() : sfx.hit(dart));
  save();

  // The winning dart gets the full cinematic on the 3D board.
  if (next.winners && state.board?.playWinningThrow && prefs.motion !== 'off') {
    state.cinematic = true;
    updateGame({ popDart: next.turn.length - 1 });
    const pi = pinfo(player.pid);
    sfx.whoosh();
    state.board
      .playWinningThrow(dart, {
        color,
        title: t('winningDart'),
        name: pi.name,
        avatar: face(pi),
        detail: events.includes('checkout') ? `${t('checkout')} · ${next.turns.at(-1).startScore}` : modeTitle(next.mode),
        skip: t('skip'),
        onImpact: () => {
          hitSound();
          haptic(40);
          celebrate(events, next, player);
        },
      })
      .then(() => {
        state.cinematic = false;
        setTimeout(showResult, 1400);
      });
    return;
  }

  state.board.addDart(dart, { color, index: next.turn.length - 1 });
  hitSound();
  haptic(dart.mult >= 2 ? 20 : 10);
  updateGame({ popDart: next.turn.length - 1 });
  handleEvents(events, before, next, player);
}

/** Fireworks, confetti, fanfare and a banner naming the winner. */
function celebrate(events, after, player) {
  const has = (e) => events.includes(e);
  const record = after.turns.at(-1);
  const winners = after.winners.map(pinfo);
  const names = winners.map((w) => w.name).join(' & ');
  const label = has('shanghai') ? t('shanghaiCall') : has('checkout') ? `${t('gameShot')} · ${record.startScore}` : t('winner');
  sfx.fanfare(true);
  confetti(240);
  fireworks(4600);
  winnerBanner({ name: names, label, color: winners[0]?.color, avatar: winners.length === 1 ? face(winners[0]) : '🏆', duration: 3400 });
  let matchOver = true;
  try {
    matchOver = ['match', 'tournament'].includes(commitLeg(match()).outcome.type);
  } catch {
    /* preview only */
  }
  callGameShot({ names, matchOver, checkout: has('checkout') ? record.startScore : 0, lang: getLang() });
  state.board?.bigMoment?.('win', winners[0]?.color);
}

function handleEvents(events, before, after, player) {
  const host = $('#callouts');
  const name = pinfo(player.pid).name;
  const record = after.turns.at(-1);
  const has = (e) => events.includes(e);
  if (has('bust')) {
    setTimeout(() => {
      sfx.bust();
      callout(host, { title: t('bust'), sub: t('bustSub', { n: after.players.find((p) => p.pid === player.pid).score }), tone: 'bad' });
      callBust(getLang());
      $('.board-wrap')?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 380 });
    }, 230);
  } else if (has('checkout') || has('win') || has('shanghai')) {
    setTimeout(() => celebrate(events, after, player), 260);
    setTimeout(showResult, 3600);
    return;
  } else if (has('180')) {
    setTimeout(() => {
      sfx.fanfare(true);
      sfx.crowd(1);
      callout(host, { title: '180', sub: '★ ★ ★', tone: 'gold', duration: 1900 });
      confetti(220);
      call180(getLang());
      bigMoment('max', pinfo(player.pid).color);
      if (state.board?.replayDarts && prefs.motion !== 'off') {
        state.cinematic = true;
        state.replaying = true;
        setTimeout(() => {
          if (!state.board?.replayDarts || state.view !== 'game') {
            state.cinematic = state.replaying = false;
            return;
          }
          state.board
            .replayDarts({ label: t('instantReplay'), onLand: () => sfx.hit({ value: 20, mult: 3, points: 60 }) })
            .then(() => {
              state.cinematic = state.replaying = false;
              if (prefs.autoNext && leg()?.turnDone && !leg().winners) state.autoTimer = setTimeout(() => advance(), 700);
            });
        }, 1500);
      }
    }, 260);
  } else if (has('ton') && record) {
    setTimeout(() => {
      sfx.fanfare(false);
      sfx.crowd(record.counted >= 140 ? 0.7 : 0.45);
      callout(host, { title: String(record.counted), sub: t('ton') + (record.counted >= 140 ? '+' : ''), tone: 'cool' });
      callTurnScore(record.counted, getLang());
      bigMoment('ton', pinfo(player.pid).color);
    }, 260);
  } else if (has('killer')) {
    setTimeout(() => {
      sfx.fanfare(false);
      callout(host, { title: t('killerCall'), sub: esc(name), tone: 'bad' });
    }, 260);
  } else if (has('eliminated')) {
    setTimeout(() => {
      sfx.bust();
      callout(host, { title: t('eliminated'), tone: 'bad' });
    }, 260);
  } else if (has('turn-end') && record) {
    if (isX01(after.mode)) callTurnScore(record.counted, getLang());
  }
  if (has('closed') && !has('turn-end')) {
    // subtle feedback only
  }
  if (has('turn-end') && !after.winners && prefs.autoNext && !state.replaying) {
    const delay = has('bust') ? 2100 : has('180') ? 2600 : 1500;
    const btn = $('[data-g="next"]');
    btn?.style.setProperty('--auto', `${delay}ms`);
    btn?.classList.add('counting');
    state.autoTimer = setTimeout(() => advance(), delay);
  }
}

function advance(silent = false) {
  clearTimeout(state.autoTimer);
  const m = match();
  if (!m || !leg().turnDone || leg().winners) return;
  state.undo.push(clone(m));
  m.leg = nextTurn(leg());
  state.board.clearDarts(!silent);
  save();
  updateGame();
  if (!silent) {
    const p = pinfo(activePlayer(leg()).pid);
    toast(`<span class="toast-av" style="--pc:${p.color}">${face(p)}</span><span><small>${t('upNext')}</small><b>${esc(p.name)}</b></span>`);
    sfx.whoosh();
  }
  announceTurn();
}

/** Caller line before every turn: the player's name, plus what they need in X01. */
function announceTurn() {
  const L = leg();
  if (!L || L.winners || L.turn.length) return;
  const p = activePlayer(L);
  const name = pinfo(p.pid).name;
  const require = isX01(L.mode) && p.score <= 170 && checkout(p.score, 3, L.doubleOut) ? p.score : 0;
  callUpNext({ name, require, lang: getLang() });
}

/** 180s and ton-plus scores light up the arena (3D) or flash the stage (2D). */
function bigMoment(kind, color) {
  if (prefs.motion === 'off') return;
  if (state.board?.bigMoment) state.board.bigMoment(kind, color);
  const stage = $('.stage');
  if (stage) {
    stage.style.setProperty('--flash', color);
    stage.classList.remove('flash-max', 'flash-ton');
    void stage.offsetWidth;
    stage.classList.add(kind === 'max' ? 'flash-max' : 'flash-ton');
  }
}

function undo() {
  if (state.cinematic) return;
  clearTimeout(state.autoTimer);
  const prev = state.undo.pop();
  if (!prev) return;
  data.match = prev;
  closeModal();
  state.board.showDarts(leg().turn, pinfo(activePlayer(leg()).pid).color);
  save();
  updateGame();
  sfx.tick();
}

function toast(html) {
  const slot = $('#toast');
  if (!slot) return;
  slot.innerHTML = `<div class="toast">${html}</div>`;
}

function updateGame(opts = {}) {
  const L = leg();
  if (!L || !state.board) return;
  const p = activePlayer(L);
  const pi = pinfo(p.pid);
  document.documentElement.style.setProperty('--player', pi.color);
  state.board.setTargets(targetsFor(L));
  state.board.setDisabled(!!L.winners);
  renderMatchbar();
  renderHero(opts);
  renderControls();
  renderKeypad();
  renderScores();
  renderFeed();
  state.room?.broadcast(remoteState());
}

function renderMatchbar() {
  const m = match();
  const L = leg();
  const c = m.config;
  const info = modeInfo(c.mode);
  const bits = [`<span class="chip strong" dir="ltr">${MODE_GLYPH[c.mode]}</span><span class="chip">${modeTitle(c.mode)}</span>`];
  bits.push(`<span class="chip">${t('round')} <b dir="ltr">${L.round}${info.rounds ? `/${info.rounds}` : ''}</b></span>`);
  if (c.format !== 'single') bits.push(`<span class="chip">${t('leg')} <b dir="ltr">${m.legNo}</b></span>`);
  if (isX01(c.mode) && c.doubleOut) bits.push(`<span class="chip subtle">${t('doubleOut')}</span>`);
  if (c.format === 'tournament') bits.push(`<button class="chip btnchip" data-g="bracket">${t('bracket')}</button>`);
  $('#matchbar').innerHTML = `
    <button class="icon-btn" data-g="quit" aria-label="${t('quit')}" title="${t('quit')}">${icon('x')}</button>
    <div class="chips">${bits.join('')}</div>
    <button class="btn ghost sm tv-toggle" data-g="tv" aria-pressed="${!!state.tv}">${icon('tv')} ${state.tv ? t('tvExit') : t('tvMode')}</button>`;
  const bb = $('[data-g="bracket"]');
  if (bb) bb.onclick = () => openBracket();
}

function mainNumber(L, p) {
  switch (L.mode) {
    case 'around':
      return p.progress > 21 ? '✓' : aroundTarget(p.progress) === 25 ? 'B' : aroundTarget(p.progress);
    case 'killer':
      return p.target;
    default:
      return p.score;
  }
}

function heroHint(L, p) {
  const left = 3 - L.turn.length;
  if (isX01(L.mode)) {
    if (L.bust) return `<span class="hint bad">${t('bust')}</span>`;
    const route = !L.turnDone ? checkout(p.score, left, L.doubleOut) : checkout(p.score, 3, L.doubleOut);
    if (p.score <= 170 && route)
      return `<span class="hint-label">${t('checkout')}</span><span class="route" dir="ltr">${route.map((r) => `<i>${r}</i>`).join('')}</span>`;
    if (p.score <= 170) return `<span class="hint muted">${t('noCheckout')}</span>`;
    return '';
  }
  if (L.mode === 'around') return `<span class="hint-label">${t('target')}</span><span class="route" dir="ltr"><i>${aroundTarget(p.progress) === 25 ? 'BULL' : aroundTarget(p.progress)}</i></span>`;
  if (L.mode === 'shanghai') return `<span class="hint-label">${t('target')}</span><span class="route" dir="ltr"><i>S${L.round}</i><i>D${L.round}</i><i>T${L.round}</i></span>`;
  if (L.mode === 'killer') {
    if (!p.killer) return `<span class="hint-label">${t('charge')}</span><span class="pips">${[0, 1, 2].map((i) => `<i class="${i < p.charge ? 'on' : ''}"></i>`).join('')}</span><span class="route" dir="ltr"><i>${p.target}</i></span>`;
    return `<span class="hint bad">${t('killer')}</span><span class="route" dir="ltr">${L.players.filter((o) => o !== p && o.lives > 0).map((o) => `<i>${o.target}</i>`).join('')}</span>`;
  }
  if (L.mode === 'cricket') {
    const open = CRICKET_KEYS.filter((k) => p.marks[k] < 3);
    return `<span class="hint-label">${t('target')}</span><span class="route" dir="ltr">${open.slice(0, 4).map((k) => `<i>${k === 'B' ? 'BULL' : k}</i>`).join('')}</span>`;
  }
  return '';
}

function renderHero(opts) {
  const L = leg();
  const p = activePlayer(L);
  const pi = pinfo(p.pid);
  const total = L.turn.reduce((s, d) => s + d.points, 0);
  const host = $('#hero');
  const prevNum = host.dataset.num;
  const num = mainNumber(L, p);
  host.style.setProperty('--pc', pi.color);
  host.innerHTML = `
    <div class="hero-top">
      <span class="avatar lg" style="--pc:${pi.color}">${face(pi)}</span>
      <div class="who"><small><i class="live-dot"></i>${t('throwing')}</small><b>${esc(pi.name)}</b></div>
      <div class="big-num ${L.bust ? 'bust' : ''}" dir="ltr" data-v="${num}">${num}</div>
    </div>
    ${L.mode === 'cricket' ? scoreline(L, p) : ''}
    <div class="dart-slots" dir="ltr">
      ${[0, 1, 2].map((i) => {
        const d = L.turn[i];
        const cls = d ? `filled m${d.mult} ${opts.popDart === i ? 'pop' : ''}` : i === L.turn.length && !L.turnDone ? 'next' : '';
        return `<div class="slot ${cls}">${d ? `<b>${d.label}</b><small>${d.points}</small>` : `<span>${i + 1}</span>`}</div>`;
      }).join('')}
      <div class="slot total"><small>${t('turnTotal')}</small><b>${L.bust ? '—' : total}</b></div>
    </div>
    <div class="hero-hint">${heroHint(L, p)}</div>`;
  host.dataset.num = num;
  if (prevNum != null && prevNum !== String(num) && typeof num === 'number' && prefs.motion !== 'off') {
    const from = Number(prevNum);
    if (!Number.isNaN(from)) countTo(host.querySelector('.big-num'), from, num);
  }
}

function scoreline(L, cur) {
  const best = Math.max(...L.players.map((o) => o.score));
  const leaders = L.players.filter((o) => o.score === best).length;
  return `<div class="scoreline" style="--n:${L.players.length}">${L.players
    .map((o) => {
      const oi = pinfo(o.pid);
      const lead = o.score === best && leaders === 1 && best > 0;
      const closed = CRICKET_KEYS.filter((k) => o.marks[k] >= 3).length;
      return `<div class="sl ${o === cur ? 'on' : ''} ${lead ? 'lead' : ''}" style="--pc:${oi.color}">
        <span class="avatar xs">${face(oi)}</span>
        <b>${esc(oi.name)}</b>
        <small dir="ltr">${closed}/7</small>
        <em dir="ltr">${o.score}</em>
      </div>`;
    })
    .join('')}</div>`;
}

function countTo(el, from, to) {
  const start = performance.now();
  const dur = 420;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.animate([{ transform: 'scale(1.12)', filter: 'brightness(1.6)' }, { transform: 'scale(1)', filter: 'none' }], { duration: 420, easing: 'ease-out' });
}

function renderControls() {
  const L = leg();
  const canUndo = state.undo.length > 0;
  const kp = prefs.input === 'keypad';
  $('#controls').innerHTML = `
    <button class="btn ghost" data-g="undo" ${canUndo ? '' : 'disabled'}>${icon('undo')}<span>${t('undo')}</span></button>
    <button class="btn ghost" data-g="miss" ${L.turnDone || L.winners ? 'disabled' : ''}><span>${t('miss')}</span></button>
    <button class="btn ghost" data-g="input" aria-pressed="${kp}">${icon(kp ? 'board' : 'pad')}<span>${kp ? t('board') : t('keypad')}</span></button>
    <button class="btn primary next-btn" data-g="next" ${L.turnDone && !L.winners ? '' : 'disabled'}><span>${t('next')}</span>${icon('next')}<i class="auto-bar"></i></button>`;
}

function renderKeypad() {
  const host = $('#keypad');
  if (!host) return;
  const show = prefs.input === 'keypad';
  host.hidden = !show;
  if (!show) return;
  const m = state.kpMult;
  const L = leg();
  const dis = L.winners ? 'disabled' : '';
  host.innerHTML = `
    <div class="seg mults" dir="ltr">
      ${[[1, t('single')], [2, t('double')], [3, t('treble')]].map(([v, l]) => `<button class="${m === v ? 'on' : ''} m${v}" data-g="mult" data-m="${v}">${l}</button>`).join('')}
    </div>
    <div class="nums" dir="ltr">
      ${Array.from({ length: 20 }, (_, i) => `<button data-g="num" data-v="${i + 1}" class="m${m}" ${dis}>${i + 1}</button>`).join('')}
      <button data-g="num" data-v="25" data-m="1" class="bull" ${dis}>25</button>
      <button data-g="num" data-v="25" data-m="2" class="bull hot" ${dis}>BULL</button>
      <button data-g="num" data-v="0" data-m="0" class="missbtn" ${dis}>${t('miss')}</button>
    </div>`;
}

function legAvg(L, pid) {
  const turns = L.turns.filter((x) => x.pid === pid);
  const darts = turns.reduce((s, x) => s + x.darts.length, 0);
  const pts = turns.reduce((s, x) => s + x.counted, 0);
  return darts ? ((pts / darts) * 3).toFixed(1) : '0.0';
}

function renderScores() {
  const L = leg();
  const m = match();
  const host = $('#scores');
  const cur = activePlayer(L);
  const showLegs = m.config.format !== 'single';
  const showSets = setsTarget(m.config) > 1;

  if (L.mode === 'cricket') {
    host.innerHTML = `
      <div class="cricket panel" style="--cols:${L.players.length}">
        <div class="c-row head"><span></span>${L.players.map((p) => {
          const pi = pinfo(p.pid);
          return `<span class="c-player ${p === cur ? 'on' : ''}" style="--pc:${pi.color}"><i class="avatar sm">${face(pi)}</i><b>${esc(pi.name)}</b><em dir="ltr">${p.score}</em>${showLegs ? `<small dir="ltr">${m.legWins[p.pid]}</small>` : ''}</span>`;
        }).join('')}</div>
        ${CRICKET_KEYS.map((k) => {
          const dead = L.players.every((p) => p.marks[k] >= 3);
          return `<div class="c-row ${dead ? 'dead' : ''}"><span class="c-key" dir="ltr">${k === 'B' ? 'BULL' : k}</span>${L.players.map((p) => `<span class="c-mark mk${p.marks[k]}" style="--pc:${pinfo(p.pid).color}">${markSVG(p.marks[k])}</span>`).join('')}</div>`;
        }).join('')}
      </div>`;
    return;
  }

  host.innerHTML = L.players
    .map((p) => {
      const pi = pinfo(p.pid);
      const on = p === cur;
      const last = L.turns.filter((x) => x.pid === p.pid).at(-1);
      let main = '';
      let extra = '';
      if (isX01(L.mode)) {
        main = p.score;
        extra = `<span><small>${t('avg')}</small><b dir="ltr">${legAvg(L, p.pid)}</b></span><span><small>${t('lastTurn')}</small><b dir="ltr">${last ? (last.bust ? 'BUST' : last.counted) : '—'}</b></span><span><small>${t('darts')}</small><b dir="ltr">${p.darts}</b></span>`;
      } else if (L.mode === 'around') {
        main = p.progress > 21 ? '✓' : aroundTarget(p.progress) === 25 ? 'B' : aroundTarget(p.progress);
        const pct = Math.min(100, ((p.progress - 1) / 21) * 100);
        extra = `<span class="progress"><i style="width:${pct}%"></i></span>`;
      } else if (L.mode === 'killer') {
        main = p.target;
        extra = `<span class="lives">${[0, 1, 2].map((i) => `<i class="${i < p.lives ? 'on' : ''}">♥</i>`).join('')}</span>${p.killer ? `<span class="badge bad">${t('killer')}</span>` : `<span class="pips">${[0, 1, 2].map((i) => `<i class="${i < p.charge ? 'on' : ''}"></i>`).join('')}</span>`}`;
      } else {
        main = p.score;
        extra = `<span><small>${t('lastTurn')}</small><b dir="ltr">${last ? last.counted : '—'}</b></span><span><small>${t('darts')}</small><b dir="ltr">${p.darts}</b></span>`;
      }
      const out = L.mode === 'killer' && p.lives <= 0;
      return `<article class="score-card ${on ? 'on' : ''} ${out ? 'out' : ''}" style="--pc:${pi.color}">
        <span class="avatar">${face(pi)}</span>
        <div class="sc-body">
          <div class="sc-name"><b>${esc(pi.name)}</b>
            ${showSets ? `<span class="tally" title="${t('sets')}" dir="ltr">S${m.setWins[p.pid]}</span>` : ''}
            ${showLegs ? `<span class="tally" title="${t('legs')}" dir="ltr">L${m.legWins[p.pid]}</span>` : ''}
          </div>
          <div class="sc-extra">${extra}</div>
        </div>
        <div class="sc-main" dir="ltr">${main}</div>
      </article>`;
    })
    .join('');
}

function markSVG(n) {
  if (!n) return '';
  return `<svg viewBox="0 0 24 24" aria-label="${n}">
    ${n >= 1 ? '<path d="M6 18 18 6" class="s1"/>' : ''}
    ${n >= 2 ? '<path d="M6 6 18 18" class="s2"/>' : ''}
    ${n >= 3 ? '<circle cx="12" cy="12" r="9.5" class="s3"/>' : ''}
  </svg>`;
}

function renderFeed() {
  const L = leg();
  const host = $('#feed');
  const turns = L.turns.slice(-8).reverse();
  host.innerHTML = `<h4>${t('recent')}</h4>${
    turns.length
      ? `<ul>${turns
          .map((x) => {
            const pi = pinfo(x.pid);
            return `<li style="--pc:${pi.color}"><span class="avatar xs">${face(pi)}</span><b>${esc(pi.name)}</b><span class="fd" dir="ltr">${x.darts.map((d) => `<i class="m${d.mult}">${d.label}</i>`).join('')}</span><em dir="ltr" class="${x.bust ? 'bad' : x.counted >= 100 ? 'hot' : ''}">${x.bust ? 'BUST' : x.counted}</em></li>`;
          })
          .join('')}</ul>`
      : `<p class="muted">${t('noTurns')}</p>`
  }`;
}

/* ───────────────────────── walk-on intros ───────────────────────── */

function walkOnChips(name) {
  const s = data.stats[photoKey(name)];
  if (!s || !(s.games || s.darts)) return [];
  const chips = [];
  if (s.x01Darts) chips.push({ label: t('threeDart'), value: avg3(s).toFixed(1) });
  chips.push({ label: t('wins'), value: `${s.wins}/${s.games}` });
  if (s.t180) chips.push({ label: t('t180'), value: String(s.t180) });
  if (s.bestCheckout) chips.push({ label: t('bestCheckout'), value: String(s.bestCheckout) });
  return chips.slice(0, 4);
}

async function runWalkOn() {
  const m = match();
  if (!m) return;
  state.cinematic = true;
  const lang = getLang();
  const players = (m.config.format === 'tournament' ? m.leg.players.map((p) => pinfo(p.pid)) : m.roster).map((p) => ({
    name: p.name,
    color: p.color,
    face: face(p),
    chips: walkOnChips(p.name),
  }));
  await playWalkOn({
    players,
    text: { introducing: t('introducing'), vs: t('versus'), gameOn: t('gameOnBig'), skip: t('skip'), debut: t('debut') },
    hooks: {
      onPlayer: (p) => {
        sfx.crowd(0.7);
        callIntro(p.name, lang);
      },
      onVs: (a, b) => {
        sfx.boom();
        callVersus(a.name, b.name, lang);
      },
      onGameOn: () => {
        sfx.fanfare(false);
        callGameOn(lang);
      },
    },
  });
  state.cinematic = false;
  state.intro = false;
  if (state.view === 'game') setTimeout(announceTurn, 300);
}

/* ───────────────────────── big screen + phone scoring ───────────────────────── */

function remoteState() {
  const L = leg();
  if (!L || state.view !== 'game') return { v: 1, waiting: true };
  const p = activePlayer(L);
  const pi = pinfo(p.pid);
  const route = isX01(L.mode) && p.score <= 170 && !L.turnDone ? checkout(p.score, 3 - L.turn.length, L.doubleOut) : null;
  return {
    v: 1,
    mode: modeTitle(L.mode),
    round: L.round,
    name: pi.name,
    avatar: pi.avatar,
    color: pi.color,
    main: String(mainNumber(L, p)),
    turn: L.turn.map((d) => d.label),
    total: L.bust ? 0 : L.turn.reduce((sum, d) => sum + d.points, 0),
    turnDone: L.turnDone,
    bust: L.bust,
    hint: route ?? [],
    winner: L.winners ? L.winners.map((w) => pinfo(w).name).join(' & ') : '',
    busy: !!state.cinematic || !!document.querySelector('.modal.open'),
    players: L.players.map((o) => ({ name: pinfo(o.pid).name, color: pinfo(o.pid).color, score: String(mainNumber(L, o)), on: o === p })),
  };
}

function onRemoteMessage(msg) {
  if (state.view !== 'game' || state.cinematic) return;
  if (msg.type === 'dart') {
    const v = Number(msg.value);
    const m = Number(msg.mult);
    const ok = (v === 0 && m === 0) || (v >= 1 && v <= 20 && m >= 1 && m <= 3) || (v === 25 && (m === 1 || m === 2));
    if (ok) onDart(manualDart(v, m));
  } else if (msg.type === 'undo') undo();
  else if (msg.type === 'next') advance();
}

async function enterTv() {
  state.tv = true;
  document.documentElement.classList.add('tv');
  $('.game')?.classList.add('tv');
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  } catch {
    /* optional */
  }
  renderTvPanel();
  updateGame();
  if (state.room) return;
  try {
    state.room = await hostRoom({
      onMessage: onRemoteMessage,
      onPeers: (n) => {
        state.remotePeers = n;
        renderTvPanel();
      },
    });
    state.room.broadcast(remoteState());
  } catch (e) {
    console.warn('phone scoring unavailable', e);
    state.roomError = true;
  }
  renderTvPanel();
}

function exitTv() {
  if (!state.tv && !state.room) return;
  state.tv = false;
  document.documentElement.classList.remove('tv');
  $('.game')?.classList.remove('tv');
  state.room?.close();
  state.room = null;
  state.remotePeers = 0;
  state.roomError = false;
  $('#tv-panel')?.remove();
  try {
    if (document.fullscreenElement) document.exitFullscreen();
  } catch {
    /* optional */
  }
  if (state.view === 'game') updateGame();
}

async function renderTvPanel() {
  if (!state.tv) return;
  let panel = $('#tv-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'tv-panel';
    panel.className = 'tv-panel panel';
    $('.side')?.appendChild(panel);
  }
  const room = state.room;
  if (state.roomError) {
    panel.innerHTML = `<h4>${icon('phone')} ${t('remoteScan')}</h4><p class="muted">${t('remoteUnavailable')}</p>`;
    return;
  }
  if (!room) {
    panel.innerHTML = `<h4>${icon('phone')} ${t('remoteScan')}</h4><p class="muted">${t('remoteConnecting')}</p>`;
    return;
  }
  const url = remoteUrl(room.code);
  const n = state.remotePeers || 0;
  panel.innerHTML = `
    <div class="tv-qr" aria-label="${t('remoteScan')}">${await qrSvg(url)}</div>
    <div class="tv-qr-text">
      <h4>${icon('phone')} ${t('remoteScan')}</h4>
      <p>${t('remoteHint')}</p>
      <p class="tv-code"><small>${t('remoteCode')}</small> <b dir="ltr">${room.code}</b></p>
      <p class="tv-peers ${n ? 'on' : ''}"><i></i>${n ? t('remotePeers', { n }) : t('remoteNone')}</p>
    </div>`;
}

/* The phone keypad page (opened from the QR code). */
function renderRemote(code) {
  document.documentElement.classList.add('remote-mode');
  const main = $('#view');
  main.className = 'view view-remote';
  let mult = 1;
  let last = null;
  let link = null;
  main.innerHTML = `
    <section class="remote">
      <p class="rm-status" id="rm-status" role="status">${t('remoteConnecting')}</p>
      <div class="rm-card panel" id="rm-card"><p class="muted">${t('remoteWaiting')}</p></div>
      <div class="keypad panel rm-keypad" id="rm-keypad"></div>
      <div class="rm-actions">
        <button class="btn ghost" data-rm="undo">${icon('undo')} ${t('undo')}</button>
        <button class="btn primary" data-rm="next">${t('next')} ${icon('next')}</button>
      </div>
    </section>`;

  const pad = () => {
    $('#rm-keypad').innerHTML = `
      <div class="seg mults" dir="ltr">${[[1, t('single')], [2, t('double')], [3, t('treble')]].map(([v, l]) => `<button class="${mult === v ? 'on' : ''} m${v}" data-mult="${v}">${l}</button>`).join('')}</div>
      <div class="nums" dir="ltr">
        ${Array.from({ length: 20 }, (_, i) => `<button data-v="${i + 1}" class="m${mult}">${i + 1}</button>`).join('')}
        <button data-v="25" data-m="1" class="bull">25</button>
        <button data-v="25" data-m="2" class="bull hot">BULL</button>
        <button data-v="0" data-m="0" class="missbtn">${t('miss')}</button>
      </div>`;
  };
  const card = (st) => {
    last = st;
    const host = $('#rm-card');
    if (!st || st.waiting) {
      host.innerHTML = `<p class="muted">${t('remoteWaiting')}</p>`;
      return;
    }
    host.style.setProperty('--pc', /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : '#f5c46b');
    host.innerHTML = `
      <div class="rm-top"><span class="avatar">${esc(st.avatar ?? '🎯')}</span><div><small>${esc(st.mode)} · ${t('round')} ${Number(st.round) || 1}</small><b>${esc(st.name)}</b></div><strong dir="ltr">${esc(st.main)}</strong></div>
      <div class="rm-turn" dir="ltr">${[0, 1, 2].map((i) => `<span class="${st.turn?.[i] ? 'f' : ''}">${esc(st.turn?.[i] ?? '·')}</span>`).join('')}<em>${st.bust ? t('bust') : Number(st.total) || 0}</em></div>
      ${st.hint?.length ? `<p class="rm-hint" dir="ltr">${st.hint.map((h) => `<i>${esc(h)}</i>`).join('')}</p>` : ''}
      ${st.winner ? `<p class="rm-win">🏆 ${esc(st.winner)}</p>` : st.busy ? `<p class="muted">${t('remoteBusy')}</p>` : ''}
      <ul class="rm-players">${(st.players ?? []).map((o) => `<li class="${o.on ? 'on' : ''}"><b>${esc(o.name)}</b><span dir="ltr">${esc(o.score)}</span></li>`).join('')}</ul>`;
    $$('#rm-keypad button, [data-rm]').forEach((b) => (b.disabled = !!st.busy || !!st.winner));
    const nextBtn = $('[data-rm="next"]');
    if (nextBtn && !st.busy && !st.winner) nextBtn.disabled = !st.turnDone;
  };
  pad();
  const status = (s) => {
    const el = $('#rm-status');
    el.className = `rm-status ${s}`;
    el.textContent = { connecting: t('remoteConnecting'), connected: `✓ ${t('remoteConnected')}`, lost: t('remoteLost'), missing: t('remoteMissing'), error: t('remoteLost') }[s] ?? s;
  };
  const send = (msg) => {
    if (!link?.send(msg)) status('lost');
    else haptic(12);
  };
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.mult) {
      mult = +b.dataset.mult;
      pad();
      card(last);
    } else if (b.dataset.v != null) {
      const v = +b.dataset.v;
      const m = v === 0 ? 0 : v === 25 ? +b.dataset.m : mult;
      send({ type: 'dart', value: v, mult: m });
      mult = 1;
      pad();
      card(last);
    } else if (b.dataset.rm) send({ type: b.dataset.rm });
  };
  joinRoom(code, { onState: card, onStatus: status })
    .then((l) => (link = l))
    .catch(() => status('error'));
}

/* ───────────────────────── results ───────────────────────── */

function showResult() {
  const m = match();
  if (!m || !leg().winners || $('.modal.open')) return;
  const { match: next, outcome } = commitLeg(m);
  state.pending = { next, outcome };
  const final = outcome.type === 'match' || outcome.type === 'tournament';
  const winners = outcome.winners.map(pinfo);
  const L = leg();
  const title =
    outcome.type === 'tournament' ? t('tournamentWon') :
    winners.length > 1 ? t('sharedWin') :
    outcome.type === 'match' ? t('matchWon') :
    outcome.type === 'set' ? t('setWon') :
    outcome.type === 'tournament-match' ? t('matchWon') : t('legWon');

  const rows = L.players
    .map((p) => {
      const pi = pinfo(p.pid);
      const turns = L.turns.filter((x) => x.pid === p.pid);
      const best = Math.max(0, ...turns.map((x) => x.counted));
      const isW = L.winners.includes(p.pid);
      return `<tr class="${isW ? 'win' : ''}" style="--pc:${pi.color}">
        <td><span class="avatar xs">${face(pi)}</span> ${esc(pi.name)}</td>
        <td dir="ltr">${isX01(L.mode) ? legAvg(L, p.pid) : p.score}</td>
        <td dir="ltr">${p.darts}</td>
        <td dir="ltr">${best}</td>
        ${m.config.format !== 'single' ? `<td dir="ltr">${setsTarget(m.config) > 1 ? `S${next.setWins[p.pid] ?? 0} · ` : ''}L${m.legWins[p.pid] + (isW ? 1 : 0)}</td>` : ''}
      </tr>`;
    })
    .join('');

  const primary = final
    ? `<button class="btn primary" data-r="rematch">${t('rematch')}</button>`
    : `<button class="btn primary" data-r="continue">${outcome.type === 'tournament-match' ? t('nextMatch') : t('nextLeg')} ${icon('next')}</button>`;

  openModal(`
    <div class="result ${final ? 'final' : ''}">
      <div class="trophy">${final ? trophySVG() : `<span class="avatar xl" style="--pc:${winners[0].color}">${face(winners[0])}</span>`}</div>
      <span class="eyebrow">${modeTitle(m.config.mode)}${m.config.format !== 'single' ? ` · ${t('leg')} ${m.legNo}` : ''}</span>
      <h2><span class="winner-names">${winners.map((w) => `<b style="--pc:${w.color}">${esc(w.name)}</b>`).join(' & ')}</span><small>${title}</small></h2>
      <table class="result-table">
        <thead><tr><th></th><th>${isX01(L.mode) ? t('avg') : t('points')}</th><th>${t('darts')}</th><th>${t('bestTurn')}</th>${m.config.format !== 'single' ? `<th>${t('legs')}</th>` : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${m.config.format === 'tournament' ? `<div class="bracket-wrap">${bracketHTML(next.bracket ?? m.bracket, m.roster)}</div>` : ''}
      <div class="result-actions">
        <button class="btn ghost" data-r="undo">${icon('undo')} ${t('undoLast')}</button>
        ${final ? `<button class="btn ghost" data-r="stats">${t('viewStats')}</button><button class="btn ghost" data-r="new">${t('newGame')}</button>` : ''}
        ${primary}
      </div>
    </div>`, { dismissable: false, onClick: onResultClick });

  if (final && !state.celebrated) {
    confetti(160);
  }
}

function commitPending() {
  const p = state.pending;
  if (!p) return null;
  const old = match();
  recordLeg(old.leg, old.roster);
  if (p.outcome.type === 'match' || p.outcome.type === 'tournament') recordMatch(old, p.outcome.winners, p.outcome.type === 'tournament' ? p.next.bracket : null);
  data.match = p.next;
  state.pending = null;
  state.undo = [];
  save();
  return p;
}

function onResultClick(e) {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  const a = b.dataset.r;
  if (a === 'undo') return undo();
  const done = commitPending();
  closeModal();
  if (!done) return;
  if (a === 'continue') {
    state.board.clearDarts();
    updateGame();
    const p = pinfo(activePlayer(leg()).pid);
    toast(`<span class="toast-av" style="--pc:${p.color}">${face(p)}</span><span><small>${t('upNext')}</small><b>${esc(p.name)}</b></span>`);
    announceTurn();
  } else if (a === 'rematch') {
    const rm = data.match;
    data.match = createMatch(rm.config, rm.roster);
    save();
    go('game');
  } else if (a === 'new') {
    data.match = null;
    save();
    go('lobby');
  } else if (a === 'stats') {
    data.match = null;
    save();
    go('stats');
  }
}

function trophySVG() {
  return `<svg viewBox="0 0 120 120" class="trophy-svg" aria-hidden="true">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#f5c46b"/><stop offset="1" stop-color="#9a6a1c"/></linearGradient></defs>
    <path d="M36 18h48v18c0 18-10 32-24 34-14-2-24-16-24-34z" fill="url(#tg)"/>
    <path d="M36 24H22c0 14 6 24 18 26M84 24h14c0 14-6 24-18 26" fill="none" stroke="url(#tg)" stroke-width="6" stroke-linecap="round"/>
    <rect x="54" y="70" width="12" height="16" fill="url(#tg)"/>
    <rect x="40" y="86" width="40" height="10" rx="3" fill="url(#tg)"/>
    <rect x="34" y="96" width="52" height="10" rx="3" fill="#3a2a10"/>
    <path d="M60 30l4 8 9 1-6.5 6 1.5 9-8-4.5-8 4.5 1.5-9-6.5-6 9-1z" fill="#fff" opacity=".85"/>
  </svg>`;
}

function bracketHTML(bracket, roster) {
  if (!bracket) return '';
  const nm = (id) => (id == null ? `<i class="muted">${t('tbd')}</i>` : esc(roster.find((p) => p.id === id)?.name ?? '?'));
  const active = activeBracketMatch(bracket);
  return `<div class="bracket" style="--rounds:${bracket.rounds.length}">${bracket.rounds
    .map(
      (round) => `<div class="b-round">${round
        .map(
          (m) => `<div class="b-match ${m === active || (active && m.a === active.a && m.b === active.b) ? 'live' : ''}">
            <span class="${m.winner != null && m.winner === m.a ? 'w' : ''}">${nm(m.a)}</span>
            <span class="${m.winner != null && m.winner === m.b ? 'w' : ''}">${m.b == null && m.winner != null && m.a != null ? `<i class="muted">${t('bye')}</i>` : nm(m.b)}</span>
          </div>`,
        )
        .join('')}</div>`,
    )
    .join('')}</div>`;
}

function openBracket() {
  const m = match();
  openModal(`<div class="result"><span class="eyebrow">${t('fmtTournament')}</span><h2><small>${t('bracket')}</small></h2><div class="bracket-wrap">${bracketHTML(m.bracket, m.roster)}</div>
    <div class="result-actions"><button class="btn primary" data-close>${t('close')}</button></div></div>`);
}

/* ───────────────────────── modal ───────────────────────── */

function openModal(html, { dismissable = true, onClick } = {}) {
  const root = $('#modal');
  root.innerHTML = `<div class="modal-backdrop"></div><div class="modal-card panel" role="dialog" aria-modal="true">${html}</div>`;
  root.className = 'modal open';
  root.onclick = (e) => {
    if (e.target.closest('[data-close]') || (dismissable && e.target.classList.contains('modal-backdrop'))) return closeModal();
    onClick?.(e);
  };
  state.modalDismissable = dismissable;
  setTimeout(() => root.querySelector('.modal-card button.primary, .modal-card button')?.focus(), 50);
}

function closeModal() {
  const root = $('#modal');
  root.className = 'modal';
  root.innerHTML = '';
}

function openSettings() {
  const row = (key, label) => `<label class="switch"><input type="checkbox" data-pref="${key}" ${prefs[key] === true || prefs[key] === 'on' || prefs[key] === 'high' ? 'checked' : ''}><span class="track"><span class="thumb"></span></span><span><b>${label}</b></span></label>`;
  openModal(`
    <div class="settings">
      <h2>${t('settings')}</h2>
      <div class="field"><span class="label">${t('language')}</span>
        <div class="seg"><button data-lang="he" class="${prefs.lang === 'he' ? 'on' : ''}">עברית</button><button data-lang="en" class="${prefs.lang === 'en' ? 'on' : ''}">English</button></div>
      </div>
      ${row('sound', t('sound'))}
      ${row('voice', t('voice'))}
      <div class="voice-check">
        <p class="voice-status" id="voice-status">${voiceLine()}</p>
        <button class="btn ghost sm" data-test-voice>${t('testVoice')}</button>
        ${voiceStatus(prefs.lang).voice ? '' : `<details class="voice-help"><summary>${t('voiceHow')}</summary><ul>
          <li><b>iPhone / iPad</b> · ${t('vhIos')}</li>
          <li><b>Android</b> · ${t('vhAndroid')}</li>
          <li><b>Windows</b> · ${t('vhWindows')}</li>
          <li><b>Mac</b> · ${t('vhMac')}</li>
        </ul></details>`}
      </div>
      ${row('autoNext', t('autoNext'))}
      ${row('motion', t('motion'))}
      ${row('walkOn', t('walkOnSetting'))}
      ${row('quality', t('quality'))}
      <div class="result-actions"><button class="btn primary" data-close>${t('close')}</button></div>
    </div>`);
  const root = $('#modal');
  root.onchange = (e) => {
    const k = e.target.dataset.pref;
    if (!k) return;
    const v = e.target.checked;
    prefs[k] = k === 'motion' ? (v ? 'on' : 'off') : k === 'quality' ? (v ? 'high' : 'low') : v;
    save();
    applyPrefs();
    if (k === 'quality' && state.view !== 'stats') go(state.view);
  };
  const prev = root.onclick;
  root.onclick = (e) => {
    if (e.target.closest('[data-test-voice]')) {
      say(prefs.lang === 'he' ? `בדיקת קריין. התור של ${data.roster[0]?.name ?? 'גבי'}, נשארו 40` : `Caller check. ${data.roster[0]?.name ?? 'Player one'}, you require 40`, { interrupt: true, force: true });
      setTimeout(() => {
        const st = $('#voice-status');
        if (st) st.innerHTML = voiceLine();
      }, 400);
      return;
    }
    const l = e.target.closest('[data-lang]');
    if (l) {
      prefs.lang = l.dataset.lang;
      save();
      applyPrefs();
      closeModal();
      go(state.view);
      openSettings();
      return;
    }
    prev(e);
  };
}

function voiceLine() {
  const st = voiceStatus(prefs.lang);
  if (!st.supported) return `<span class="bad">${t('voiceNone')}</span>`;
  if (st.voice) return `<span class="good">✓</span> ${t('voiceFound')}: <b dir="ltr">${esc(st.voice)}</b>`;
  return `<span class="bad">!</span> ${prefs.lang === 'he' ? t('voiceNoHe') : t('voiceNoEn')}`;
}

/* ───────────────────────── stats ───────────────────────── */

function renderStats(main) {
  const all = Object.values(data.stats).filter((s) => s.darts > 0 || s.games > 0);
  all.sort((a, b) => b.wins - a.wins || avg3(b) - avg3(a));
  if (!state.statsPlayer || !all.find((s) => s.name === state.statsPlayer)) state.statsPlayer = all[0]?.name ?? null;
  const s = all.find((x) => x.name === state.statsPlayer);
  const notice = state.notice;
  state.notice = '';

  main.innerHTML = `
    <section class="stats-page">
      <header class="step-head reveal"><span class="step-no">◎</span><div><h2>${t('statsTitle')}</h2><p>${t('statsSub')}</p></div>
        <div class="stats-actions">
          <button class="btn ghost sm" data-s="backup" ${all.length || data.roster.length ? '' : 'disabled'}>${icon('download')} ${t('backup')}</button>
          <button class="btn ghost sm" data-s="restore">${icon('upload')} ${t('restore')}</button>
          ${all.length ? `<button class="btn ghost sm" data-s="reset">${t('resetStats')}</button>` : ''}
          <input type="file" accept=".json,application/json" hidden id="restore-file">
        </div></header>
      ${notice ? `<p class="notice-line" role="status">✓ ${notice}</p>` : ''}
      <p class="form-error" id="stats-error" role="alert"></p>
      ${!all.length ? `<div class="empty panel reveal"><div class="empty-board" id="stats-board"></div><p>${t('noStats')}</p><button class="btn primary" data-go="lobby">${t('start')}</button></div>` : `
      <div class="leaders reveal" style="--d:.05s">
        ${all.map((p, i) => `<button class="leader ${p.name === state.statsPlayer ? 'on' : ''}" data-s-player="${esc(p.name)}">
            <span class="rank" dir="ltr">${i + 1}</span>
            <span class="avatar sm" style="--pc:${colorFor(p.name)}">${avatarFor(p.name)}</span>
            <b>${esc(p.name)}</b>
            <small dir="ltr">${p.wins}W${p.x01Darts ? ` · ${avg3(p).toFixed(1)}` : ''}</small>
          </button>`).join('')}
      </div>
      <div class="stats-grid">
        <div class="tiles reveal" style="--d:.1s">
          ${tile(t('games'), s.games)}
          ${tile(t('wins'), s.wins)}
          ${tile(t('winRate'), s.games ? Math.round((s.wins / s.games) * 100) + '%' : '—')}
          ${tile(t('threeDart'), s.x01Darts ? avg3(s).toFixed(1) : '—', 'hot')}
          ${tile(t('checkoutRate'), s.dblAttempts ? Math.round(((s.dblHits ?? 0) / s.dblAttempts) * 100) + '%' : '—', 'hot', s.dblAttempts ? `${s.dblHits ?? 0}/${s.dblAttempts}` : '')}
          ${tile(t('bestCheckout'), s.bestCheckout || '—')}
          ${tile(t('t180'), s.t180, 'hot')}
          ${tile(t('t140'), s.t140)}
          ${tile(t('t100'), s.t100)}
          ${tile(t('bestTurn'), s.bestTurn)}
          ${tile(t('trebleRate'), s.darts ? ((s.trebles / s.darts) * 100).toFixed(1) + '%' : '—')}
          ${tile(t('secPerTurn'), s.turns ? (s.turnMs / s.turns / 1000).toFixed(1) : '—')}
        </div>
        <div class="heat panel reveal" style="--d:.15s">
          <h4>${t('heatmap')}</h4>
          <div class="board-host heat-board" id="stats-board"></div>
          ${favBeds(s)}
        </div>
      </div>
      <div class="stats-grid two reveal" style="--d:.18s">
        <div class="panel chart-panel">
          <h4>${t('avgTrend')}</h4>
          ${avgChart(s)}
        </div>
        <div class="panel form-panel">
          <h4>${t('form')}</h4>
          ${formStrip(s.name)}
          <h4 class="h2h-title">${t('h2h')}</h4>
          ${h2hList(s)}
        </div>
      </div>
      ${data.history.length ? `<div class="history panel reveal" style="--d:.2s"><h4>${t('history')}</h4><ul>${data.history.slice(0, 15).map((h) => `
        <li><span class="glyph" dir="ltr">${esc(MODE_GLYPH[h.mode] ?? h.mode)}</span><span>${h.players.map((n) => (h.winners.includes(n) ? `<b>🏆 ${esc(n)}</b>` : esc(n))).join(' · ')}</span><time>${new Date(h.at).toLocaleDateString(getLang() === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>`).join('')}</ul></div>` : ''}
      `}
    </section>`;

  const host = $('#stats-board');
  if (host) {
    state.statsBoard = new Board(host, { interactive: false, skin: prefs.theme });
    state.statsBoard.setQuality(prefs.quality === 'high' ? 'high' : 'low');
    if (s) state.statsBoard.setHeat(s.points);
  }
  bindChart(main.querySelector('.chart'));

  const fileInput = $('#restore-file');
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const backup = readBackup(await file.text());
      confirmRestore(backup);
    } catch {
      $('#stats-error').textContent = t('restoreBad');
    }
  };

  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sPlayer) {
      state.statsPlayer = b.dataset.sPlayer;
      renderStats(main);
    } else if (b.dataset.s === 'backup') {
      downloadBackup();
    } else if (b.dataset.s === 'restore') {
      fileInput.click();
    } else if (b.dataset.s === 'reset') {
      if (b.dataset.armed) {
        resetStats();
        renderStats(main);
      } else {
        b.dataset.armed = '1';
        b.textContent = t('resetConfirm');
        b.classList.add('armed');
        setTimeout(() => {
          if (!b.isConnected) return;
          delete b.dataset.armed;
          b.textContent = t('resetStats');
          b.classList.remove('armed');
        }, 4000);
      }
    }
  };
}

/* ── backup & restore ── */

function downloadBackup() {
  const blob = new Blob([exportBackup()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bullseye-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function confirmRestore(backup) {
  const d = backup.data;
  const when = backup.exportedAt ? new Date(backup.exportedAt) : null;
  const date = when && !Number.isNaN(+when) ? when.toLocaleDateString(getLang() === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  openModal(`
    <div class="settings">
      <h2>${t('restoreTitle')}</h2>
      <p class="muted">${t('restoreBody', { date: esc(date), players: d.roster.length, matches: d.history.length, photos: Object.keys(d.photos).length })}</p>
      <div class="result-actions">
        <button class="btn ghost" data-close>${t('cancel')}</button>
        <button class="btn primary" data-restore-now>${t('restoreConfirm')}</button>
      </div>
    </div>`, {
    onClick: (e) => {
      if (!e.target.closest('[data-restore-now]')) return;
      restoreBackup(backup);
      try {
        sessionStorage.setItem('bullseye:restored', '1');
      } catch {
        /* storage unavailable */
      }
      location.reload();
    },
  });
}

/* ── richer stats ── */

/** 3-dart average per X01 leg: one series, line + soft area, overall average as a dashed reference. */
function avgChart(s) {
  const v = s.legAverages ?? [];
  if (v.length < 2) return `<p class="muted chart-empty">${t('chartEmpty')}</p>`;
  const W = 640;
  const H = 230;
  const L = 36;
  const R = 70;
  const T = 14;
  const B = 26;
  const overall = avg3(s);
  const lo0 = Math.min(...v, overall);
  const hi0 = Math.max(...v, overall);
  const step = Math.max(10, Math.ceil((hi0 - lo0) / 4 / 10) * 10);
  const lo = Math.max(0, Math.floor((lo0 - 2) / step) * step);
  const hi = Math.ceil((hi0 + 2) / step) * step;
  const x = (i) => L + (i * (W - L - R)) / (v.length - 1);
  const y = (val) => T + ((hi - val) * (H - T - B)) / (hi - lo || 1);
  const line = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join('');
  const area = `${line}L${x(v.length - 1).toFixed(1)} ${H - B}L${x(0).toFixed(1)} ${H - B}Z`;
  const grid = [];
  for (let g = lo; g <= hi + 0.01; g += step) {
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="c-grid"/><text x="${L - 8}" y="${y(g)}" class="c-tick" text-anchor="end" dominant-baseline="central">${g}</text>`);
  }
  const last = v.length - 1;
  return `<div class="chart" data-vals="${v.join(',')}" data-l="${L}" data-r="${R}" data-w="${W}" data-t="${T}" data-b="${B}" data-h="${H}" data-lo="${lo}" data-hi="${hi}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('avgTrend')}: ${v.length} ${t('legs')}, ${t('latest')} ${v[last]}, ${t('lifetimeAvg')} ${overall.toFixed(1)}">
      <defs><linearGradient id="avg-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${grid.join('')}
      <path d="${area}" fill="url(#avg-fill)"/>
      <line x1="${L}" x2="${W - R}" y1="${y(overall)}" y2="${y(overall)}" class="c-ref"/>
      <text x="${W - R + 6}" y="${y(overall)}" class="c-ref-label" dominant-baseline="central">${t('lifetimeAvg')} ${overall.toFixed(1)}</text>
      <path d="${line}" class="c-line"/>
      <circle cx="${x(last)}" cy="${y(v[last])}" r="5" class="c-end"/>
      <text x="${x(last) + 9}" y="${y(v[last]) - 12}" class="c-end-label">${v[last].toFixed(1)}</text>
      <text x="${L}" y="${H - 6}" class="c-tick">${t('older')}</text>
      <text x="${W - R}" y="${H - 6}" class="c-tick" text-anchor="end">${t('latest')}</text>
      <g class="c-hover" visibility="hidden"><line class="c-cross" y1="${T}" y2="${H - B}"/><circle r="5" class="c-dot"/></g>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="c-hit"/>
    </svg>
    <div class="c-tip" hidden></div>
  </div>`;
}

function bindChart(el) {
  if (!el) return;
  const v = el.dataset.vals.split(',').map(Number);
  const [L, R, W, T, B, H, lo, hi] = ['l', 'r', 'w', 't', 'b', 'h', 'lo', 'hi'].map((k) => Number(el.dataset[k]));
  const svg = el.querySelector('svg');
  const hover = svg.querySelector('.c-hover');
  const cross = hover.querySelector('.c-cross');
  const dot = hover.querySelector('.c-dot');
  const tip = el.querySelector('.c-tip');
  const x = (i) => L + (i * (W - L - R)) / (v.length - 1);
  const y = (val) => T + ((hi - val) * (H - T - B)) / (hi - lo || 1);
  const show = (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(v.length - 1, Math.round(((p.x - L) / (W - L - R)) * (v.length - 1))));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(v[i]));
    hover.setAttribute('visibility', 'visible');
    const box = el.getBoundingClientRect();
    const sx = box.width / W;
    tip.innerHTML = `<small>${t('leg')} ${i + 1}/${v.length}</small><b dir="ltr">${v[i].toFixed(1)}</b>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(box.width - 90, Math.max(0, x(i) * sx - 40))}px`;
    tip.style.top = `${Math.max(0, y(v[i]) * sx - 58)}px`;
  };
  const hide = () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

/** Last 10 match results for a player, newest first: W/L chips (letter + colour). */
function formStrip(name) {
  const key = name.toLowerCase();
  const games = data.history.filter((h) => h.players.some((n) => n.toLowerCase() === key)).slice(0, 10);
  if (!games.length) return `<p class="muted">${t('noForm')}</p>`;
  return `<div class="form-strip" aria-label="${t('form')}">${games
    .map((h) => {
      const won = h.winners.some((n) => n.toLowerCase() === key);
      return `<span class="form-chip ${won ? 'w' : 'l'}" title="${esc(h.players.join(' · '))}">${won ? t('winShort') : t('lossShort')}</span>`;
    })
    .join('')}<small class="muted">← ${t('latest')}</small></div>`;
}

function h2hList(s) {
  const rows = Object.entries(s.h2h ?? {})
    .map(([opp, r]) => ({ opp, ...r, n: r.w + r.l }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  if (!rows.length) return `<p class="muted">${t('noH2h')}</p>`;
  return `<ul class="h2h">${rows
    .map((r) => {
      const st = data.stats[r.opp.toLowerCase()];
      const nm = st?.name ?? r.opp;
      return `<li><span class="avatar xs" style="--pc:${colorFor(nm)}">${avatarFor(nm)}</span><b>${esc(nm)}</b>
        <span class="h2h-bar" aria-hidden="true"><i style="width:${(r.w / r.n) * 100}%"></i></span>
        <em dir="ltr">${r.w}–${r.l}</em></li>`;
    })
    .join('')}</ul>`;
}

const avg3 = (s) => (s.x01Darts ? (s.x01Points / s.x01Darts) * 3 : 0);
const rosterEntry = (name) => data.roster.find((p) => p.name.toLowerCase() === name.toLowerCase());
const colorFor = (name) => rosterEntry(name)?.color ?? '#8b9dff';
const avatarFor = (name) => face(rosterEntry(name));

function tile(label, value, tone = '', sub = '') {
  return `<article class="tile ${tone}"><small>${label}</small><b dir="ltr">${value}</b>${sub ? `<em dir="ltr">${sub}</em>` : ''}</article>`;
}

function favBeds(s) {
  const top = Object.entries(s.beds).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) return '';
  const max = top[0][1];
  return `<div class="beds"><span class="label">${t('favourite')}</span>${top
    .map(([k, v]) => `<div class="bed-row"><b dir="ltr">${k}</b><span class="bar"><i style="width:${(v / max) * 100}%"></i></span><em dir="ltr">${v}</em></div>`)
    .join('')}</div>`;
}

/* ───────────────────────── keyboard ───────────────────────── */

function onKey(e) {
  if (e.target.matches('input, textarea') || state.cinematic) return;
  if (e.key === 'Escape' && document.querySelector('.photo-menu')) return closePhotoMenu();
  if (e.key === 'Escape' && $('.modal.open') && state.modalDismissable) return closeModal();
  if (state.view !== 'game') return;
  if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') {
    e.preventDefault();
    undo();
  } else if ((e.key === 'Enter' || e.key === ' ') && !$('.modal.open')) {
    if (leg()?.turnDone) {
      e.preventDefault();
      advance();
    }
  } else if (e.key === 'm' || e.key === 'M') {
    onDart(manualDart(0, 0));
  }
}

boot();
