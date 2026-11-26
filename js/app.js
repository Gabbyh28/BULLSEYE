// BULLSEYE — application shell, screens and game flow.
import {
  MODES, CRICKET_KEYS, isX01, modeInfo, makeDart, randomPointFor, checkout, createMatch, throwDart,
  nextTurn, commitLeg, activePlayer, currentThrower, targetsFor, aroundTarget, activeBracketMatch, legsTarget, setsTarget,
} from './engine.js';
import { Board, BOARD_SKINS } from './board.js';
import { sfx, say, confetti, callout, configureFx, haptic, unlockSpeech, voiceStatus, voiceChoices, loadClip, fireworks, winnerBanner } from './fx.js';
import { load, save, flush, recordLeg, recordMatch, resetStats, exportBackup, readBackup, restoreBackup, photoKey, rivalry, cleanTheme, doublesReport, grantBadges } from './storage.js';
import { t, setLang, getLang } from './i18n.js';
import { call180, callTurnScore, callBust, callGameShot, callUpNext, callIntro, callVersus, callGameOn, callRivalry } from './caller.js';
import { playWalkOn } from './walkon.js';
import { FLIGHTS, BARRELS, drawFlight, drawDartPreview } from './dartstyle.js';
import { PRESETS, WALLS, installTheme, expandTheme } from './themes.js';
import { BADGES, badgeById, earnedBadges } from './achievements.js';
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
  // a team shows both members, side by side
  if (p?.mates?.length) return `<span class="duo">${p.mates.map((m) => `<span>${face(m)}</span>`).join('')}</span>`;
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
  if (prefs.theme === 'custom' && !prefs.customTheme) prefs.theme = 'championship';
  // the custom arena writes its colours straight onto the page
  const custom = installTheme(prefs.customTheme);
  const tokens = Object.keys(expandTheme(PRESETS.classic).vars);
  tokens.forEach((k) => root.style.removeProperty(k));
  if (prefs.theme === 'custom' && custom) Object.entries(custom.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.dataset.tone = prefs.theme === 'custom' && custom?.light ? 'light' : prefs.theme === 'daylight' ? 'light' : 'dark';
  root.dataset.theme = prefs.theme;
  root.dataset.motion = prefs.motion;
  root.dataset.quality = prefs.quality;
  configureFx({ sound: prefs.sound, voice: prefs.voice, lang: prefs.lang, voiceName: prefs.voiceName?.[prefs.lang] ?? '' });
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
        ${prefs.customTheme ? `<button role="radio" aria-checked="${prefs.theme === 'custom'}" title="${esc(prefs.customTheme.name)}" data-theme-pick="custom" class="dot th-custom" style="background:conic-gradient(${prefs.customTheme.accent} 0 50%, ${prefs.customTheme.green} 0)"></button>` : ''}
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
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
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
    dart: '<path d="M3 21l7-7"/><path d="M10 14l3.5-3.5"/><path d="M13.5 10.5 16 5l3 3-5.5 2.5"/><path d="M16 5l3-2 2 2-2 3"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
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
  document.documentElement.classList.toggle('in-game', view === 'game');
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
  else if (view === 'report') renderReport(main);
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
    ${c.format !== 'tournament' && [4, 6].includes(data.roster.length) ? `
    <label class="switch sm" title="${t('teamsHint')}">
      <input type="checkbox" data-cfg="teams" ${c.teams ? 'checked' : ''}>
      <span class="track"><span class="thumb"></span></span>
      <span><b>${t('teams')}</b></span>
    </label>` : ''}
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
      ${teamsOn() ? `<span class="team-tag t${Math.floor(i / 2)}" title="${t('teamN', { n: 'ABC'[Math.floor(i / 2)] })}">${'ABC'[Math.floor(i / 2)]}</span>` : ''}
      <input class="name" maxlength="24" value="${esc(p.name)}" data-name="${i}" aria-label="${t('playerN', { n: i + 1 })}">
      <button class="color-dot" data-color-cycle="${i}" style="--c:${p.color}" aria-label="colour"></button>
      <button class="icon-btn xs danger" data-remove="${i}" aria-label="${t('remove')}" ${data.roster.length <= 1 ? 'disabled' : ''}>${icon('x')}</button>
    </li>`,
    )
    .join('');
  list.classList.toggle('teamed', teamsOn());
  list.classList.toggle('many', data.roster.length > 4);
  $('.setup')?.classList.toggle('many', data.roster.length > 4);
  $('[data-lobby="add"]').disabled = data.roster.length >= 8;
  if ($('#rules')) renderRules();
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
  }).join('') + customChip();
}

/** The custom arena chip: builds one the first time, then selects it, then edits it. */
function customChip() {
  const ct = prefs.customTheme;
  const on = prefs.theme === 'custom';
  if (!ct) return `<button class="arena-chip add" data-arena-custom="new" title="${t('customArena')}"><span class="mini-board plus">${icon('palette')}</span><small>${t('th_custom')}</small></button>`;
  return `<button class="arena-chip th-custom ${on ? 'on' : ''}" data-arena-custom="${on ? 'edit' : 'pick'}" role="radio" aria-checked="${on}" title="${on ? t('editArena') : esc(ct.name)}">
    <span class="mini-board" style="--d:${ct.dark};--l:${ct.light};--r:${ct.red};--g:${ct.green};--rim:${ct.accent}"></span>
    ${on ? `<i class="chip-pen" aria-hidden="true">${icon('pen')}</i>` : ''}
    <small>${esc(ct.name)}</small>
  </button>`;
}

/* ── theme builder ── */

function openThemeBuilder() {
  const before = { theme: prefs.theme, custom: prefs.customTheme };
  let cur = cleanTheme(prefs.customTheme ?? { ...PRESETS.classic, name: t('th_custom') });
  const preview = () => {
    prefs.customTheme = cur;
    prefs.theme = 'custom';
    applyPrefs();
    const mb = $('.tb-preview .mini-board');
    if (mb) ['d:dark', 'l:light', 'r:red', 'g:green', 'rim:accent'].forEach((kv) => {
      const [v, k] = kv.split(':');
      mb.style.setProperty('--' + v, cur[k]);
    });
    $$('.tb [data-tb-mode]').forEach((b) => b.classList.toggle('on', b.dataset.tbMode === cur.mode));
    $$('.tb [data-tb-wall]').forEach((b) => b.classList.toggle('on', b.dataset.tbWall === cur.wall));
    $$('.tb input[type=color]').forEach((i) => (i.value = cur[i.dataset.tbColor]));
  };
  const colour = (k, label) => `<label class="tb-col"><input type="color" data-tb-color="${k}" value="${cur[k]}"><span>${label}</span></label>`;
  openModal(`
    <div class="tb">
      <h2>${icon('palette')} ${t('customArena')}</h2>
      <div class="tb-top">
        <div class="tb-preview"><span class="mini-board"></span></div>
        <div class="tb-fields">
          <label class="field"><span class="label">${t('arenaName')}</span><input class="tb-name" maxlength="24" value="${esc(cur.name)}"></label>
          <div class="seg sm" role="radiogroup" aria-label="${t('themeBase')}">
            <button data-tb-mode="dark">${t('baseDark')}</button><button data-tb-mode="light">${t('baseLight')}</button>
          </div>
        </div>
      </div>
      <div class="tb-group"><h4>${t('presets')}</h4><div class="tb-presets">
        ${Object.entries(PRESETS).map(([k, pr]) => `<button class="tb-preset" data-tb-preset="${k}" style="--a:${pr.accent};--g:${pr.green};--bg:${pr.mode === 'light' ? '#f3f1ea' : '#11131a'}"><i></i>${t('pre_' + k)}</button>`).join('')}
      </div></div>
      <div class="tb-group"><h4>${t('accent')} · ${t('lightTone')}</h4><div class="tb-cols">${colour('accent', t('accent'))}${colour('lightColor', t('lightTone'))}</div></div>
      <div class="tb-group"><h4>${t('boardColours')}</h4><div class="tb-cols">${colour('dark', t('segDark'))}${colour('light', t('segLight'))}${colour('red', t('segRed'))}${colour('green', t('segGreen'))}</div></div>
      <div class="tb-group"><h4>${t('wall')}</h4><div class="tb-walls">${WALLS.map((w) => `<button data-tb-wall="${w}">${t('wall_' + w)}</button>`).join('')}</div></div>
      <div class="result-actions">
        <button class="btn ghost" data-tb="cancel">${t('cancel')}</button>
        <button class="btn primary" data-tb="use">${t('useArena')}</button>
      </div>
    </div>`, {
    dismissable: false,
    onClick: (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tbMode) cur.mode = b.dataset.tbMode;
      else if (b.dataset.tbWall) cur.wall = b.dataset.tbWall;
      else if (b.dataset.tbPreset) cur = cleanTheme({ ...PRESETS[b.dataset.tbPreset], name: t('pre_' + b.dataset.tbPreset) });
      else if (b.dataset.tb === 'cancel') {
        prefs.theme = before.theme;
        prefs.customTheme = before.custom;
        closeModal();
        applyPrefs();
        renderTopbar();
        renderArenas();
        return;
      } else if (b.dataset.tb === 'use') {
        cur.name = $('.tb-name').value.trim() || t('th_custom');
        prefs.customTheme = cleanTheme(cur);
        prefs.theme = 'custom';
        closeModal();
        applyPrefs();
        renderTopbar();
        renderArenas();
        save();
        return;
      } else return;
      const nm = $('.tb-name');
      if (b.dataset.tbPreset && nm) nm.value = cur.name;
      sfx.tick();
      preview();
    },
  });
  $('.tb').addEventListener('input', (e) => {
    const k = e.target.dataset.tbColor;
    if (!k) return;
    cur[k] = e.target.value;
    preview();
  });
  preview();
}

function updateSummary() {
  const c = data.config;
  const parts = [modeTitle(c.mode)];
  if (isX01(c.mode) && c.doubleOut) parts.push(t('doubleOut'));
  if (c.format === 'legs') parts.push(`${t('legsToWin')} ${c.legs}${c.sets > 1 ? ` · ${t('sets')} ${c.sets}` : ''}`);
  if (c.format === 'tournament') parts.push(t('fmtTournament'));
  if (teamsOn()) parts.push(t('teamsOf', { n: data.roster.length / 2 }));
  else parts.push(`${data.roster.length} ${data.roster.length === 1 ? t('player') : t('players')}`);
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
    renderRoster();
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
  } else if (b.dataset.arenaCustom) {
    if (b.dataset.arenaCustom === 'pick') {
      prefs.theme = 'custom';
      applyPrefs();
      renderTopbar();
      renderArenas();
    } else openThemeBuilder();
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
    state.undo = restoreUndo(); // undo still works after a reload
    go('game');
    return;
  } else return;
  updateSummary();
  save();
}

function onLobbyInput(e) {
  if (e.target.dataset.cfg) {
    data.config[e.target.dataset.cfg] = e.target.checked;
    if (e.target.dataset.cfg === 'teams') renderRoster();
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
    <button role="menuitem" data-pm="darts" ${p.name.trim() ? '' : 'disabled'}>${icon('dart')} ${t('customiseDarts')}</button>
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
    } else if (a === 'darts') {
      closePhotoMenu();
      openDartCustomiser(p);
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

/* ── dart customiser ── */

function openDartCustomiser(p) {
  const key = photoKey(p.name);
  data.darts ??= {};
  const cur = { flight: 'classic', barrel: 'silver', color: '', ...(data.darts[key] ?? {}) };
  const swatches = ['', ...COLORS, '#ffffff', '#16171b'];
  const paintChips = () =>
    $$('canvas[data-fl]').forEach((cv) => {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      drawFlight(ctx, cv.width, cv.height, cur.color || p.color, cv.dataset.fl);
    });
  const draw = () => {
    const cv = $('.dc-preview canvas');
    if (cv) drawDartPreview(cv, { ...cur, color: cur.color || p.color });
    $$('.dc-opt').forEach((b) => {
      const on = cur[b.dataset.k] === b.dataset.v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    });
  };
  openModal(`
    <div class="dart-custom">
      <h2>${t('dartsFor', { name: esc(p.name.trim()) })}</h2>
      <div class="dc-preview" style="--pc:${p.color}"><canvas aria-hidden="true"></canvas></div>
      <div class="dc-group"><h4>${t('flight')}</h4><div class="dc-row" role="radiogroup" aria-label="${t('flight')}">
        ${FLIGHTS.map((f) => `<button class="dc-opt fl" role="radio" data-k="flight" data-v="${f}"><canvas data-fl="${f}" width="48" height="64" aria-hidden="true"></canvas><small>${t('fl_' + f)}</small></button>`).join('')}
      </div></div>
      <div class="dc-group"><h4>${t('flightColor')}</h4><div class="dc-row swatches" role="radiogroup" aria-label="${t('flightColor')}">
        ${swatches.map((c) => `<button class="dc-opt sw ${c ? '' : 'auto'}" role="radio" data-k="color" data-v="${c}" style="--c:${c || p.color}" title="${c || t('playerColour')}" aria-label="${c || t('playerColour')}"></button>`).join('')}
      </div></div>
      <div class="dc-group"><h4>${t('barrel')}</h4><div class="dc-row" role="radiogroup" aria-label="${t('barrel')}">
        ${Object.entries(BARRELS).map(([k, b]) => `<button class="dc-opt br" role="radio" data-k="barrel" data-v="${k}"><i style="--b0:${b.css[0]};--b1:${b.css[1]};--b2:${b.css[2]}"></i><small>${t('br_' + k)}</small></button>`).join('')}
      </div></div>
      <div class="result-actions"><button class="btn primary" data-dc="done">${t('done')}</button></div>
    </div>`, {
    onClick: (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.dc === 'done') return closeModal();
      if (!b.dataset.k) return;
      cur[b.dataset.k] = b.dataset.v;
      data.darts[key] = { ...cur };
      save();
      sfx.tick();
      if (b.dataset.k === 'color') paintChips();
      draw();
    },
  });
  paintChips();
  requestAnimationFrame(draw);
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
  data.match = newMatch(c, data.roster);
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
/** A new match, stamped so a saved undo history can be matched to it after a reload. */
const newMatch = (config, roster) => ({ ...createMatch(config, roster), started: Date.now() });
const UNDO_KEY = 'bullseye:undo';
/** Keep the last few undo steps in this tab's session storage (survives a reload, not a new tab). */
function writeUndo() {
  clearTimeout(state.undoSave);
  state.undoSave = 0;
  try {
    sessionStorage.setItem(UNDO_KEY, JSON.stringify({ started: match()?.started ?? 0, stack: state.undo.slice(-20) }));
  } catch {
    /* storage full or blocked: undo still works until the page reloads */
  }
}
function persistUndo() {
  clearTimeout(state.undoSave);
  state.undoSave = setTimeout(writeUndo, 250);
}
// write straight away when the page is going away (reload, tab switch, phone locking)
addEventListener('pagehide', () => state.undoSave && writeUndo());
document.addEventListener('visibilitychange', () => document.hidden && state.undoSave && writeUndo());
function restoreUndo() {
  try {
    const u = JSON.parse(sessionStorage.getItem(UNDO_KEY) ?? 'null');
    if (u?.started && u.started === match()?.started && Array.isArray(u.stack)) return u.stack;
  } catch {
    /* ignore */
  }
  return [];
}
const leg = () => data.match?.leg;
const pinfo = (pid) => {
  const m = match();
  const team = m.teams?.find((tm) => tm.id === pid);
  if (team) return { ...team, mates: team.members.map((id) => m.roster.find((p) => p.id === id)).filter(Boolean) };
  return m.roster.find((p) => p.id === pid);
};
/** Who is holding the darts: the player, or in team play the teammate whose turn it is. */
const throwerInfo = (L = leg()) => pinfo(currentThrower(L));
/** A player's dart style from the customiser (flight, barrel, colour), saved to their name. */
const styleOf = (name) => data.darts?.[photoKey(name ?? '')] ?? null;
/** Teams are on when switched on, with 4 or 6 players, outside knockouts. */
const teamsOn = (c = data.config, n = data.roster.length) => !!c.teams && c.format !== 'tournament' && (n === 4 || n === 6);

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
    b.showDarts(leg().turn, pinfo(activePlayer(leg()).pid).color, styleOf(throwerInfo().name));
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
  } else if (a === 'edit') {
    openDartEditor(b, +b.dataset.i);
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
  const style = styleOf(throwerInfo(before).name);
  const hitSound = () => (dart.value === 1 ? sfx.ole() : sfx.hit(dart));
  save();

  // The winning dart gets the full cinematic on the 3D board.
  if (next.winners && state.board?.playWinningThrow && prefs.motion !== 'off') {
    state.cinematic = true;
    updateGame({ popDart: next.turn.length - 1 });
    const pi = pinfo(currentThrower(before));
    sfx.whoosh();
    state.board
      .playWinningThrow(dart, {
        color,
        style,
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

  state.board.addDart(dart, { color, index: next.turn.length - 1, style });
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
  if (has('turn-end') && !after.winners && prefs.autoNext) {
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
  sfx.turn();
  if (!silent) {
    const p = throwerInfo();
    const unit = pinfo(activePlayer(leg()).pid);
    toast(`<span class="toast-av" style="--pc:${p.color}">${face(p)}</span><span><small>${unit.team ? esc(unit.name) : t('upNext')}</small><b>${esc(p.name)}</b></span>`);
  }
  announceTurn();
}

/** Caller line before every turn: the player's name, plus what they need in X01. */
function announceTurn() {
  const L = leg();
  if (!L || L.winners || L.turn.length) return;
  const p = activePlayer(L);
  const require = isX01(L.mode) && p.score <= 170 && checkout(p.score, 3, L.doubleOut) ? p.score : 0;
  callUpNext({ require, lang: getLang() });
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
  state.board.showDarts(leg().turn, pinfo(activePlayer(leg()).pid).color, styleOf(throwerInfo().name));
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
  persistUndo();
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
  const thr = pi.team ? throwerInfo(L) : pi;
  const total = L.turn.reduce((s, d) => s + d.points, 0);
  const host = $('#hero');
  const prevNum = host.dataset.num;
  const num = mainNumber(L, p);
  host.style.setProperty('--pc', pi.color);
  host.innerHTML = `
    <div class="hero-top">
      <span class="avatar lg" style="--pc:${pi.color}">${face(thr)}</span>
      <div class="who"><small><i class="live-dot"></i>${pi.team ? esc(pi.name) : t('throwing')}</small><b>${esc(thr.name)}</b></div>
      <div class="big-num ${L.bust ? 'bust' : ''}" dir="ltr" data-v="${num}">${num}</div>
    </div>
    ${scoreline(L, p)}
    <div class="dart-slots" dir="ltr">
      ${[0, 1, 2].map((i) => {
        const d = L.turn[i];
        const cls = d ? `filled m${d.mult} ${opts.popDart === i ? 'pop' : ''}` : i === L.turn.length && !L.turnDone ? 'next' : '';
        if (d && canEditDart(i)) return `<button type="button" class="slot editable ${cls}" data-g="edit" data-i="${i}" title="${t('fixDart')}">${`<b>${d.label}</b><small>${d.points}</small>`}<i class="edit-pen" aria-hidden="true">${icon('pen')}</i></button>`;
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

/** Everyone's score in one compact row: always shown in Cricket, and on phones in every mode. */
function scoreline(L, cur) {
  const points = ['cricket', 'shanghai', 'highscore'].includes(L.mode);
  const best = Math.max(...L.players.map((o) => o.score));
  const leaders = L.players.filter((o) => o.score === best).length;
  return `<div class="scoreline ${L.mode === 'cricket' ? 'always' : ''}" style="--n:${L.players.length}">${L.players
    .map((o) => {
      const oi = pinfo(o.pid);
      const lead = points && o.score === best && leaders === 1 && best > 0;
      const small =
        L.mode === 'cricket' ? `${CRICKET_KEYS.filter((k) => o.marks[k] >= 3).length}/7` :
        L.mode === 'killer' ? '♥'.repeat(Math.max(0, o.lives)) : '';
      return `<div class="sl ${o === cur ? 'on' : ''} ${lead ? 'lead' : ''} ${L.mode === 'killer' && o.lives <= 0 ? 'out' : ''}" style="--pc:${oi.color}">
        <span class="avatar xs">${face(oi)}</span>
        <b>${esc(oi.name)}</b>
        ${small ? `<small dir="ltr">${small}</small>` : ''}
        <em dir="ltr">${mainNumber(L, o)}</em>
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
  $('.game')?.classList.toggle('kp', show);
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
            const who = x.thrower != null && x.thrower !== x.pid ? pinfo(x.thrower) : pi; // in teams, whoever threw
            return `<li style="--pc:${pi.color}"><span class="avatar xs">${face(who)}</span><b>${esc(who.name)}</b><span class="fd" dir="ltr">${x.darts.map((d) => `<i class="m${d.mult}">${d.label}</i>`).join('')}</span><em dir="ltr" class="${x.bust ? 'bad' : x.counted >= 100 ? 'hot' : ''}">${x.bust ? 'BUST' : x.counted}</em></li>`;
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
  const units = m.teams ? m.teams.map((tm) => pinfo(tm.id)) : m.config.format === 'tournament' ? m.leg.players.map((p) => pinfo(p.pid)) : m.roster;
  const players = units.map((p) => ({
    name: p.name,
    color: p.color,
    face: face(p),
    team: !!p.team,
    // a team card lists each member with their average (or debut)
    chips: p.team
      ? p.mates.map((mm) => {
          const s = data.stats[photoKey(mm.name)];
          return { label: mm.name, value: s?.x01Darts ? avg3(s).toFixed(1) : '★' };
        })
      : walkOnChips(p.name),
  }));
  let rival = null;
  if (players.length === 2 && !m.teams) {
    const r = rivalry(players[0].name, players[1].name, data.history);
    if (r.played) {
      const [a, b] = players.map((p) => p.name);
      const lead = r.a === r.b ? '' : r.a > r.b ? a : b;
      rival = {
        played: r.played,
        a: r.a,
        b: r.b,
        last: r.last,
        headline: lead ? t('rivalLeads', { name: lead, w: Math.max(r.a, r.b), l: Math.min(r.a, r.b) }) : t('rivalLevel', { n: r.a }),
        streak: r.streak >= 2 ? t('rivalStreak', { name: r.streakA ? a : b, n: r.streak }) : '',
        lead,
        w: Math.max(r.a, r.b),
        l: Math.min(r.a, r.b),
      };
    } else rival = { played: 0, headline: t('rivalFirst') };
  }
  await playWalkOn({
    players,
    rival,
    text: { introducing: t('introducing'), introTeam: t('introTeam'), vs: t('versus'), gameOn: t('gameOnBig'), skip: t('skip'), debut: t('debut'), last5: t('rivalLast5') },
    hooks: {
      onPlayer: (p) => {
        sfx.crowd(0.7);
        callIntro(p.name, lang);
      },
      onVs: (a, b) => {
        sfx.boom();
        callVersus(a.name, b.name, lang);
        if (rival?.played) callRivalry({ lead: rival.lead, w: rival.w, l: rival.l, lang });
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
    name: pi.team ? throwerInfo(L).name : pi.name, // in teams, whoever holds the darts
    avatar: pi.team ? throwerInfo(L).avatar : pi.avatar,
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

/* ───────────────────────── fix one dart ───────────────────────── */

/** The match as it was just before the current turn's first dart (from the undo history). */
function turnStartSnapshot() {
  const L = leg();
  const n = L?.turn.length ?? 0;
  if (!n || state.undo.length < n) return null;
  const snap = state.undo[state.undo.length - n];
  const sl = snap?.leg;
  if (!sl || sl.turn.length || sl.current !== L.current || sl.round !== L.round || sl.winners) return null;
  return snap;
}

function canEditDart(i) {
  const L = leg();
  return !!L && i < L.turn.length && !L.winners && !state.cinematic && !!turnStartSnapshot();
}

function openDartEditor(anchor, i) {
  closePhotoMenu();
  const old = leg().turn[i];
  let mult = old.mult === 3 ? 3 : old.mult === 2 && old.value !== 25 ? 2 : 1;
  const menu = document.createElement('div');
  menu.className = 'photo-menu dart-editor panel';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', t('fixDartN', { n: i + 1 }));
  const draw = () => {
    menu.innerHTML = `
      <p class="pm-for">${t('fixDartN', { n: i + 1 })} · <b dir="ltr">${old.label}</b></p>
      <div class="seg mults" dir="ltr">${[[1, t('single')], [2, t('double')], [3, t('treble')]].map(([v, l]) => `<button class="${mult === v ? 'on' : ''} m${v}" data-em="${v}">${l}</button>`).join('')}</div>
      <div class="nums" dir="ltr">
        ${Array.from({ length: 20 }, (_, k) => `<button data-ev="${k + 1}" class="m${mult}">${k + 1}</button>`).join('')}
        <button data-ev="25" data-emm="1" class="bull">25</button>
        <button data-ev="25" data-emm="2" class="bull hot">BULL</button>
        <button data-ev="0" data-emm="0" class="missbtn">${t('miss')}</button>
      </div>`;
  };
  draw();
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  menu.style.left = `${Math.min(innerWidth - mw - 8, Math.max(8, r.left + r.width / 2 - mw / 2))}px`;
  const below = r.bottom + 6;
  menu.style.top = `${below + menu.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 6) : below}px`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.em) {
      mult = +b.dataset.em;
      draw();
      return;
    }
    if (b.dataset.ev != null) {
      const v = +b.dataset.ev;
      const m = v === 0 ? 0 : v === 25 ? +b.dataset.emm : mult;
      closePhotoMenu();
      editDart(i, v, m);
    }
  });
  state.photoMenuAway = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) closePhotoMenu();
  };
  setTimeout(() => document.addEventListener('pointerdown', state.photoMenuAway, true), 0);
}

/** Replace dart i of the current turn and rescore the turn from its start. */
function editDart(i, value, mult) {
  const base = turnStartSnapshot();
  const L = leg();
  if (!base || !L) return;
  const old = L.turn[i];
  if (old.value === value && old.mult === mult) return;
  clearTimeout(state.autoTimer);
  const p = randomPointFor(value, mult);
  const darts = L.turn.map((d, k) => (k === i ? makeDart(value, mult, p.x, p.y) : d));
  const player = activePlayer(base.leg);
  state.undo.length -= L.turn.length;
  let m = clone(base);
  let events = [];
  let before = m.leg;
  for (const d of darts) {
    state.undo.push(clone(m));
    before = m.leg;
    const res = throwDart(m.leg, d);
    m.leg = res.leg;
    events = res.events;
    if (res.leg.turnDone) break; // a bust or a finish ends the turn early
  }
  data.match = m;
  state.board.showDarts(m.leg.turn, pinfo(player.pid).color, styleOf(throwerInfo(m.leg).name));
  sfx.tick();
  save();
  updateGame({ popDart: Math.min(i, m.leg.turn.length - 1) });
  if (m.leg.turnDone) handleEvents(events, before, m.leg, player);
}

/* ───────────────────────── match report ───────────────────────── */

function reportFromMatch(m, winners) {
  return {
    at: Date.now(),
    config: clone(m.config),
    roster: m.roster.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color })).concat(
      (m.teams ?? []).map((tm) => ({ id: tm.id, name: tm.name, avatar: tm.avatar, color: tm.color, team: true,
        mates: tm.members.map((id) => m.roster.find((p) => p.id === id)).filter(Boolean).map((p) => ({ name: p.name, avatar: p.avatar })) })),
    ),
    legLog: clone(m.legLog ?? []),
    winners: [...winners],
  };
}

const rname = (rep, pid) => rep.roster.find((p) => p.id === pid) ?? { name: '?', avatar: '🎯', color: '#888' };

function reportTotals(rep) {
  const tot = new Map(rep.roster.map((p) => [p.id, { darts: 0, x01Darts: 0, x01Pts: 0, t180: 0, t140: 0, t100: 0, best: 0, legs: 0, att: 0, hit: 0, checkouts: [] }]));
  for (const lg of rep.legLog) {
    lg.winners.forEach((w) => tot.has(w) && (tot.get(w).legs += 1));
    for (const t of lg.turns) {
      const s = tot.get(t.pid);
      if (!s) continue;
      s.darts += t.darts.length;
      s.best = Math.max(s.best, t.counted);
      if (isX01(lg.mode)) {
        s.x01Darts += t.darts.length;
        s.x01Pts += t.counted;
        if (t.counted === 180) s.t180 += 1;
        else if (t.counted >= 140) s.t140 += 1;
        else if (t.counted >= 100) s.t100 += 1;
        if (t.checkout) s.checkouts.push(t.startScore);
        if (lg.doubleOut) {
          let left = t.startScore;
          for (const d of t.darts) {
            if (left === 50 || (left >= 2 && left <= 40 && left % 2 === 0)) {
              s.att += 1;
              if (d.mult === 2 && d.points === left) s.hit += 1;
            }
            left -= d.points;
            if (left <= 1) break;
          }
        }
      }
    }
  }
  return tot;
}

function renderReport(main) {
  const rep = data.lastReport;
  if (!rep || !rep.legLog?.length) return go('stats');
  const tot = reportTotals(rep);
  const x01 = isX01(rep.config.mode);
  const avg = (s) => (s.x01Darts ? (s.x01Pts / s.x01Darts) * 3 : 0);
  const players = rep.roster.filter((p) => tot.get(p.id)?.darts);
  const winners = rep.winners.map((w) => rname(rep, w));
  // player of the match: best average in X01, otherwise the winner
  const potm = x01 ? players.slice().sort((a, b) => avg(tot.get(b.id)) - avg(tot.get(a.id)))[0] : winners[0];
  const potmWhy = x01 ? `${t('threeDart')} ${avg(tot.get(potm.id)).toFixed(1)}` : t('winner');
  // key moments
  const moments = [];
  let bestTurn = null;
  let bestOut = null;
  rep.legLog.forEach((lg) =>
    lg.turns.forEach((tt) => {
      if (!bestTurn || tt.counted > bestTurn.counted) bestTurn = { ...tt, legNo: lg.legNo };
      if (tt.checkout && (!bestOut || tt.startScore > bestOut.startScore)) bestOut = { ...tt, legNo: lg.legNo };
      if (x01 && tt.counted === 180) moments.push({ icon: '★', text: t('momentMax', { name: esc(rname(rep, tt.thrower ?? tt.pid).name), leg: lg.legNo }) });
    }),
  );
  if (bestTurn?.counted && !(x01 && bestTurn.counted === 180)) moments.unshift({ icon: '↑', text: t('momentBestTurn', { name: esc(rname(rep, bestTurn.thrower ?? bestTurn.pid).name), n: bestTurn.counted, leg: bestTurn.legNo }) });
  if (bestOut) moments.unshift({ icon: '◎', text: t('momentCheckout', { name: esc(rname(rep, bestOut.thrower ?? bestOut.pid).name), n: bestOut.startScore, leg: bestOut.legNo }) });
  if (x01) {
    const quickest = rep.legLog
      .filter((lg) => lg.winners.length === 1)
      .map((lg) => ({ lg, darts: lg.turns.filter((tt) => tt.pid === lg.winners[0]).reduce((a, tt) => a + tt.darts.length, 0) }))
      .sort((a, b) => a.darts - b.darts)[0];
    if (quickest) moments.push({ icon: '⚡', text: t('momentQuickest', { name: esc(rname(rep, quickest.lg.winners[0]).name), n: quickest.darts, leg: quickest.lg.legNo }) });
  }
  const date = new Date(rep.at).toLocaleDateString(getLang() === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  state.reportLeg = Math.min(state.reportLeg ?? 0, rep.legLog.length - 1);

  main.innerHTML = `
    <section class="report">
      <header class="report-head reveal">
        <div>
          <span class="eyebrow">${t('matchReport')} · ${modeTitle(rep.config.mode)} · ${date}</span>
          <h2>${winners.map((w) => `<span class="avatar" style="--pc:${w.color}">${face(w)}</span><b style="--pc:${w.color}">${esc(w.name)}</b>`).join(' & ')} <small>${winners.length > 1 ? t('sharedWin') : t('matchWon')}</small></h2>
        </div>
        <div class="report-actions">
          <button class="btn ghost sm" data-rp="stats">${t('viewStats')}</button>
          <button class="btn ghost sm" data-rp="new">${t('newGame')}</button>
          <button class="btn primary sm" data-rp="rematch">${t('rematch')}</button>
        </div>
      </header>
      <div class="report-grid reveal" style="--d:.06s">
        <div class="panel worm-panel">
          <div class="worm-top"><h4>${x01 ? t('wormX01') : rep.config.mode === 'killer' ? t('wormLives') : rep.config.mode === 'around' ? t('wormProgress') : t('wormPoints')}</h4>
            ${rep.legLog.length > 1 ? `<div class="seg sm leg-tabs" role="tablist">${rep.legLog.map((lg, k) => `<button role="tab" class="${k === state.reportLeg ? 'on' : ''}" data-rleg="${k}">${t('leg')} ${lg.legNo}</button>`).join('')}</div>` : ''}</div>
          <div id="worm">${wormChart(rep, rep.legLog[state.reportLeg])}</div>
        </div>
        <div class="panel potm">
          <span class="eyebrow">${t('potm')}</span>
          <span class="avatar xl" style="--pc:${potm.color}">${face(potm)}</span>
          <b>${esc(potm.name)}</b>
          <small>${potmWhy}</small>
        </div>
      </div>
      <div class="report-grid two reveal" style="--d:.12s">
        <div class="panel report-table-wrap">
          <table class="report-table">
            <thead><tr><th></th>${x01 ? `<th>${t('avg')}</th>` : ''}<th>${t('legs')}</th><th>${t('darts')}</th><th>${t('bestTurn')}</th>${x01 ? `<th>180</th><th>140+</th><th>100+</th><th>${t('checkoutRate')}</th>` : ''}</tr></thead>
            <tbody>${players
              .map((p) => {
                const s = tot.get(p.id);
                return `<tr style="--pc:${p.color}"><td><span class="avatar xs">${face(p)}</span> ${esc(p.name)}</td>${x01 ? `<td>${avg(s).toFixed(1)}</td>` : ''}<td>${s.legs}</td><td>${s.darts}</td><td>${s.best}</td>${x01 ? `<td>${s.t180}</td><td>${s.t140}</td><td>${s.t100}</td><td>${s.att ? Math.round((s.hit / s.att) * 100) + '%' : '—'}</td>` : ''}</tr>`;
              })
              .join('')}</tbody>
          </table>
        </div>
        <div class="panel moments">
          <h4>${t('keyMoments')}</h4>
          ${moments.length ? `<ul>${moments.slice(0, 8).map((mm) => `<li><i>${mm.icon}</i><span>${mm.text}</span></li>`).join('')}</ul>` : `<p class="muted">—</p>`}
        </div>
      </div>
    </section>`;

  bindWorm();
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rleg != null) {
      state.reportLeg = +b.dataset.rleg;
      $$('.leg-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      $('#worm').innerHTML = wormChart(rep, rep.legLog[state.reportLeg]);
      bindWorm();
    } else if (b.dataset.rp === 'stats') go('stats');
    else if (b.dataset.rp === 'new') go('lobby');
    else if (b.dataset.rp === 'rematch') {
      data.match = newMatch(rep.config, rep.roster.filter((p) => !p.team)); // team entries are not players
      state.undo = [];
      save();
      go('game');
    }
  };
}

/** Worm chart: each player's standing after every round of one leg (one line per player). */
function wormChart(rep, lg) {
  const W = 760;
  const H = 300;
  const L = 44;
  const R = 92;
  const T = 16;
  const B = 30;
  const x01 = isX01(lg.mode);
  const series = lg.players.map((pid) => {
    const pts = lg.turns.filter((tt) => tt.pid === pid).map((tt) => tt.after ?? 0);
    const startVal = x01 ? lg.start : lg.mode === 'killer' ? 3 : 0;
    return { pid, p: rname(rep, pid), vals: [startVal, ...pts] };
  });
  const rounds = Math.max(1, ...series.map((sr) => sr.vals.length - 1));
  const all = series.flatMap((sr) => sr.vals);
  const hiRaw = Math.max(...all, 1);
  const step = hiRaw > 200 ? 100 : hiRaw > 60 ? 20 : hiRaw > 20 ? 5 : 1;
  const hi = Math.ceil(hiRaw / (step >= 100 ? step / 2 : step)) * (step >= 100 ? step / 2 : step);
  const x = (i) => L + (i * (W - L - R)) / rounds;
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi || 1);
  const grid = [];
  for (let g = 0; g <= hi; g += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="c-grid"/><text x="${L - 8}" y="${y(g)}" class="c-tick" text-anchor="end" dominant-baseline="central">${g}</text>`);
  const xt = [];
  const every = Math.max(1, Math.ceil(rounds / 10));
  for (let i = 0; i <= rounds; i += every) xt.push(`<text x="${x(i)}" y="${H - 8}" class="c-tick" text-anchor="middle">${i}</text>`);
  // end labels, nudged apart so they never overlap
  const ends = series.map((sr) => ({ sr, y: y(sr.vals.at(-1)) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15;
  const label = new Map(ends.map((e) => [e.sr.pid, e.y]));
  const lines = series
    .map((sr) => {
      const d = sr.vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
      const li = sr.vals.length - 1;
      return `<g style="--pc:${sr.p.color}">
        <path d="${d}" class="w-line"/>
        <circle cx="${x(li)}" cy="${y(sr.vals[li])}" r="4.5" class="w-end"/>
        ${series.length <= 4 ? `<text x="${x(li) + 9}" y="${label.get(sr.pid)}" class="w-label" dominant-baseline="central">${esc(sr.p.name)} ${sr.vals[li]}</text>` : ''}
      </g>`;
    })
    .join('');
  return `<div class="chart worm" data-series='${esc(JSON.stringify(series.map((sr) => ({ n: sr.p.name, c: sr.p.color, v: sr.vals }))))}' data-geo="${[W, H, L, R, T, B, rounds, hi].join(',')}">
    <div class="w-legend">${series.map((sr) => `<span style="--pc:${sr.p.color}"><i></i>${esc(sr.p.name)}</span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((sr) => `${sr.p.name}: ${sr.vals.join(', ')}`).join('; '))}">
      ${grid.join('')}${xt.join('')}
      <text x="${W - R + 22}" y="${H - 8}" class="c-tick c-axis-title">${t('round')} →</text>
      ${lines}
      <g class="c-hover" visibility="hidden"><line class="c-cross" y1="${T}" y2="${H - B}"/></g>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="c-hit"/>
    </svg>
    <div class="c-tip" hidden></div>
  </div>`;
}

function bindWorm() {
  const el = $('.chart.worm');
  if (!el) return;
  const series = JSON.parse(el.dataset.series);
  const [W, H, L, R, T, B, rounds] = el.dataset.geo.split(',').map(Number);
  const svg = el.querySelector('svg');
  const hover = svg.querySelector('.c-hover');
  const cross = hover.querySelector('.c-cross');
  const tip = el.querySelector('.c-tip');
  const show = (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(rounds, Math.round(((p.x - L) / (W - L - R)) * rounds)));
    const cx = L + (i * (W - L - R)) / rounds;
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    hover.setAttribute('visibility', 'visible');
    const box = el.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const sx = svgBox.width / W;
    tip.innerHTML = `<small>${t('round')} ${i}</small>${series.map((s) => `<span style="--pc:${s.c}"><i></i>${esc(s.n)} <b dir="ltr">${s.v[i] ?? s.v.at(-1)}</b></span>`).join('')}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(0, cx * sx + 12))}px`;
    tip.style.top = `${svgBox.top - box.top + 8}px`;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
}

/* ───────────────────────── results ───────────────────────── */

function showResult() {
  const m = match();
  if (!m || !leg().winners || $('.modal.open')) return;
  const { match: next, outcome } = commitLeg(m);
  // badges are only worked out here and saved when the result is accepted, so undo takes them back
  let badges = [];
  try {
    badges = earnedBadges({ leg: leg(), match: m, outcome, next, stats: data.stats, history: data.history, have: data.badges ?? {} });
  } catch (e) {
    console.warn('badges', e);
  }
  state.pending = { next, outcome, badges };
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
      ${badges.length ? badgesUnlocked(badges, m) : ''}
      ${m.config.format === 'tournament' ? `<div class="bracket-wrap">${bracketHTML(next.bracket ?? m.bracket, m.roster)}</div>` : ''}
      <div class="result-actions">
        <button class="btn ghost" data-r="undo">${icon('undo')} ${t('undoLast')}</button>
        ${final ? `<button class="btn ghost" data-r="report">${icon('chart')} ${t('matchReport')}</button><button class="btn ghost" data-r="new">${t('newGame')}</button>` : ''}
        ${primary}
      </div>
    </div>`, { dismissable: false, onClick: onResultClick });

  if (final && !state.celebrated) {
    confetti(160);
  }
  if (badges.length) setTimeout(() => $('.badges-new') && sfx.unlock(), 650);
}

/** A badge as a medal: tier colours, the icon, dimmed when still locked. */
function medal(b, earned = true, size = '') {
  return `<span class="medal tier-${b.tier} ${earned ? '' : 'locked'} ${size}" aria-hidden="true"><i>${earned ? b.icon : '?'}</i></span>`;
}

/** The result screen's "Badges unlocked" strip. */
function badgesUnlocked(list, m) {
  const rank = { legend: 0, gold: 1, silver: 2, bronze: 3 };
  const shown = [...list].sort((x, y) => rank[badgeById(x.id).tier] - rank[badgeById(y.id).tier]).slice(0, 8);
  const more = list.length - shown.length;
  const many = new Set(list.map((b) => b.name)).size > 1 || m.roster.length > 1;
  return `<div class="badges-new">
    <h4><span>✦</span> ${t('badgesNew')}</h4>
    <ul>${shown
      .map((x, i) => {
        const b = badgeById(x.id);
        const p = m.roster.find((r) => r.name === x.name);
        return `<li style="--i:${i}">${medal(b)}<div><b>${t('ach_' + b.id)}</b><small>${many ? `${esc(x.name)} · ` : ''}${t('ach_' + b.id + '_d')}</small></div>${many && p ? `<span class="avatar xs" style="--pc:${p.color}">${face(p)}</span>` : ''}</li>`;
      })
      .join('')}</ul>
    ${more > 0 ? `<p class="muted">+${more}</p>` : ''}
  </div>`;
}

/** Stats: every badge, earned ones in colour with the date, locked ones as a goal. */
function trophyCabinet(s) {
  const own = data.badges?.[photoKey(s.name)] ?? {};
  const n = BADGES.filter((b) => own[b.id]).length;
  const fmt = (at) => new Date(at).toLocaleDateString(getLang() === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const order = [...BADGES].sort((a, b) => (own[b.id] ? 1 : 0) - (own[a.id] ? 1 : 0));
  return `<div class="cabinet panel reveal" style="--d:.2s">
    <header><h4>${t('trophyCabinet')}</h4><span class="cab-count" dir="ltr"><b>${n}</b> / ${BADGES.length}</span>
      <span class="cab-bar" role="img" aria-label="${t('badgesCount', { n, m: BADGES.length })}"><i style="width:${(n / BADGES.length) * 100}%"></i></span></header>
    <ul>${order
      .map((b) => {
        const at = own[b.id];
        return `<li class="${at ? 'got' : ''}" title="${at ? t('badgeEarned', { date: fmt(at) }) : t('badgeLocked')} · ${t('tier_' + b.tier)}">${medal(b, !!at)}<b>${t('ach_' + b.id)}</b><small>${t('ach_' + b.id + '_d')}</small></li>`;
      })
      .join('')}</ul>
  </div>`;
}

function commitPending() {
  const p = state.pending;
  if (!p) return null;
  const old = match();
  if (p.badges?.length) grantBadges(p.badges);
  recordLeg(old.leg, old.roster);
  if (p.outcome.type === 'match' || p.outcome.type === 'tournament') {
    recordMatch(old, p.outcome.winners, p.outcome.type === 'tournament' ? p.next.bracket : null);
    data.lastReport = reportFromMatch(p.next, p.outcome.winners);
    state.reportLeg = 0;
  }
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
    sfx.turn();
    const p = throwerInfo();
    const unit = pinfo(activePlayer(leg()).pid);
    toast(`<span class="toast-av" style="--pc:${p.color}">${face(p)}</span><span><small>${unit.team ? esc(unit.name) : t('upNext')}</small><b>${esc(p.name)}</b></span>`);
    announceTurn();
  } else if (a === 'rematch') {
    const rm = data.match;
    data.match = newMatch(rm.config, rm.roster);
    state.undo = [];
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
  } else if (a === 'report') {
    data.match = null;
    save();
    go('report');
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
        ${voicePicker()}
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
    if (e.target.id === 'voice-pick') {
      prefs.voiceName = { ...(prefs.voiceName || {}), [prefs.lang]: e.target.value };
      save();
      applyPrefs();
      $('#voice-status').innerHTML = voiceLine();
      say(prefs.lang === 'he' ? 'סגירה, והמשחק!' : 'Game shot, and the match!', { interrupt: true, force: true });
      return;
    }
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

function voicePicker() {
  const list = voiceChoices(prefs.lang);
  if (list.length < 2) return '';
  const chosen = prefs.voiceName?.[prefs.lang] ?? '';
  return `<label class="voice-pick"><span class="label">${t('voicePick')}</span>
    <select id="voice-pick">
      <option value="">${t('voiceAuto')}</option>
      ${list.map((v) => `<option value="${esc(v.name)}" ${v.name === chosen ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
    </select></label>`;
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
          ${data.lastReport ? `<button class="btn ghost sm" data-s="report">${icon('chart')} ${t('lastReport')}</button>` : ''}
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
      ${doublesPanel(s)}
      ${trophyCabinet(s)}
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
    } else if (b.dataset.s === 'report') {
      go('report');
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
/** Weak spots: hit rate per double, with the best and weakest called out and a tip. */
function doublesPanel(s) {
  const { rows, best, weak } = doublesReport(s);
  const head = `<h4>${t('doublesTitle')}</h4><p class="muted dbl-sub">${t('doublesSub')}</p>`;
  if (!rows.length) return `<div class="doubles panel reveal" style="--d:.19s">${head}<p class="muted">${t('dblEmpty')}</p></div>`;
  const tip = best ? (best.d === 'BULL' ? t('dblTipBull', { p: best.pct }) : t('dblTip', { d: best.d, p: best.pct, n: best.value })) : '';
  const card = (r, label, tone) =>
    r ? `<div class="dbl-card ${tone}"><small>${label}</small><b dir="ltr">${r.d === 'BULL' ? 'BULL' : r.d}</b><em dir="ltr">${r.pct}%</em><span>${t('dblDarts', { h: r.h, a: r.a })}</span></div>` : '';
  return `<div class="doubles panel reveal" style="--d:.19s">
    ${head}
    <div class="dbl-top">
      ${card(best, t('bestDouble'), 'good')}
      ${card(weak, t('weakDouble'), 'bad')}
      ${tip ? `<p class="dbl-tip">💡 ${tip}</p>` : ''}
    </div>
    <ul class="dbl-bars">${rows.slice(0, 12).map((r) => `
      <li class="${r === best ? 'best' : r === weak ? 'weak' : ''}">
        <b dir="ltr">${r.d}</b>
        <span class="bar" role="img" aria-label="${r.d} ${r.pct}%"><i style="width:${Math.max(2, r.pct)}%"></i></span>
        <em dir="ltr">${r.pct}%</em>
        <small dir="ltr">${r.h}/${r.a}</small>
      </li>`).join('')}</ul>
  </div>`;
}

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
