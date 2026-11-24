// BULLSEYE — application shell, screens and game flow.
import {
  MODES, CRICKET_KEYS, isX01, modeInfo, makeDart, randomPointFor, checkout, createMatch, throwDart,
  nextTurn, commitLeg, activePlayer, targetsFor, aroundTarget, activeBracketMatch, legsTarget, setsTarget,
} from './engine.js';
import { Board, BOARD_SKINS } from './board.js';
import { sfx, say, confetti, callout, configureFx, haptic, unlockSpeech, voiceStatus } from './fx.js';
import { load, save, flush, recordLeg, recordMatch, resetStats } from './storage.js';
import { t, setLang, getLang } from './i18n.js';

const data = load();
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
  const tb = $('#topbar');
  const setTop = () => document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
  setTop();
  if ('ResizeObserver' in window) new ResizeObserver(setTop).observe(tb);
  go('lobby');
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', unlockSpeech, { capture: true, passive: true });
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

function go(view) {
  clearTimeout(state.autoTimer);
  clearInterval(state.demoTimer);
  state.view = view;
  state.board = null;
  state.demo = null;
  state.statsBoard = null;
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
    <section class="hero">
      <div class="hero-copy reveal">
        <span class="kicker"><i class="live-dot"></i>${t('heroKicker')}</span>
        <h1><span>${t('heroTitle1')}</span><em>${t('heroTitle2')}</em></h1>
        <p>${t('heroText')}</p>
        <div class="hero-actions">
          <button class="btn primary xl" data-lobby="start">${t('start')} ${icon('next')}</button>
          ${resumable ? `<button class="btn ghost xl" data-lobby="resume">${t('resume')} · <span dir="ltr">${esc(modeTitle(data.match.config.mode))}</span></button>` : ''}
        </div>
        <div class="next-up panel">
          <span class="glyph" dir="ltr">${MODE_GLYPH[c.mode]}</span>
          <div><small>${t('nextUp')}</small><b id="summary"></b></div>
        </div>
      </div>
      <div class="hero-board reveal" style="--d:.1s">
        <div class="spot"></div>
        <div class="board-host demo" id="demo-board"></div>
        <div class="floor"></div>
      </div>
    </section>

    <section class="step reveal" style="--d:.15s">
      <header class="step-head"><span class="step-no">01</span><div><h2>${t('step1t')}</h2><p>${t('step1s')}</p></div></header>
      <div class="mode-grid" role="radiogroup">
        ${MODES.map((m) => `
          <button class="mode-card ${m.id === c.mode ? 'on' : ''}" role="radio" aria-checked="${m.id === c.mode}" data-mode="${m.id}">
            <span class="mode-glyph" dir="ltr">${MODE_GLYPH[m.id]}</span>
            <b>${modeTitle(m.id)}</b>
            <small>${t('m' + m.id + 'd')}</small>
          </button>`).join('')}
      </div>
      <div class="rules panel" id="rules"></div>
    </section>

    <section class="step reveal" style="--d:.2s">
      <header class="step-head"><span class="step-no">02</span><div><h2>${t('step2t')}</h2><p>${t('step2s')}</p></div></header>
      <ol class="roster" id="roster"></ol>
      <button class="btn ghost add-player" data-lobby="add">${icon('plus')} ${t('addPlayer')}</button>
    </section>

    <section class="step reveal" style="--d:.25s">
      <header class="step-head"><span class="step-no">03</span><div><h2>${t('step3t')}</h2><p>${t('step3s')}</p></div></header>
      <div class="arena-grid" id="arenas"></div>
    </section>

    <div class="start-bar">
      <div class="start-inner panel">
        <div class="start-summary"><b id="summary2"></b><small>${t('startHint')}</small></div>
        <p class="form-error" id="lobby-error" role="alert"></p>
        <button class="btn primary xl" data-lobby="start">${t('start')} ${icon('next')}</button>
      </div>
    </div>`;

  renderRules();
  renderRoster();
  renderArenas();
  updateSummary();

  state.demo = new Board($('#demo-board'), { interactive: false, skin: prefs.theme });
  state.demo.setQuality(prefs.quality === 'high' ? 'high' : 'low');
  const demoThrow = () => {
    if (!state.demo) return;
    if (state.demo.darts.length >= 3) state.demo.clearDarts();
    const pick = [[20, 3], [20, 3], [20, 1], [19, 3], [25, 2], [20, 3], [5, 1], [1, 1]][Math.floor(Math.random() * 8)];
    const p = randomPointFor(...pick);
    state.demo.addDart(makeDart(pick[0], pick[1], p.x, p.y), { color: COLORS[Math.floor(Math.random() * 4)], index: state.demo.darts.length });
  };
  if (prefs.motion !== 'off') {
    setTimeout(demoThrow, 900);
    state.demoTimer = setInterval(demoThrow, 1700);
  }

  const bar = $('.start-bar');
  if ('IntersectionObserver' in window) {
    bar.classList.add('tucked');
    const io = new IntersectionObserver(([en]) => bar.classList.toggle('tucked', en.isIntersecting || en.boundingClientRect.top > 0), { threshold: 0 });
    io.observe($('.hero-actions'));
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
  $('#rules').innerHTML = `
    <div class="rules-desc">
      <span class="eyebrow">${t('rules')}</span>
      <h3>${modeTitle(c.mode)}</h3>
      <p>${t('m' + c.mode + 'd')}</p>
    </div>
    <div class="rules-opts">
      ${x01 ? `
      <label class="switch">
        <input type="checkbox" data-cfg="doubleOut" ${c.doubleOut ? 'checked' : ''}>
        <span class="track"><span class="thumb"></span></span>
        <span><b>${t('doubleOut')}</b><small>${t('doubleOutHint')}</small></span>
      </label>` : ''}
      <div class="field">
        <span class="label">${t('format')}</span>
        <div class="seg" role="radiogroup">
          ${['single', 'legs', 'tournament'].map((f) => `<button role="radio" aria-checked="${c.format === f}" class="${c.format === f ? 'on' : ''}" data-format="${f}">${t('fmt' + f[0].toUpperCase() + f.slice(1))}</button>`).join('')}
        </div>
      </div>
      ${c.format !== 'single' ? stepper('legs', t('legsToWin'), c.legs, 1, 11) : ''}
      ${c.format === 'legs' ? stepper('sets', t('setsToWin'), c.sets, 1, 7) : ''}
    </div>`;
}

function stepper(key, label, value, min, max) {
  return `<div class="field"><span class="label">${label}</span>
    <div class="stepper" data-key="${key}" data-min="${min}" data-max="${max}">
      <button data-step="-1" aria-label="-">−</button><output dir="ltr">${value}</output><button data-step="1" aria-label="+">+</button>
    </div></div>`;
}

function renderRoster() {
  const list = $('#roster');
  list.innerHTML = data.roster
    .map(
      (p, i) => `
    <li class="player-row" data-idx="${i}" style="--pc:${p.color}">
      <span class="grip" data-grip aria-hidden="true">${icon('grip')}</span>
      <span class="order" dir="ltr">${String(i + 1).padStart(2, '0')}</span>
      <button class="avatar" data-avatar="${i}" aria-label="avatar">${p.avatar}</button>
      <input class="name" maxlength="24" value="${esc(p.name)}" data-name="${i}" aria-label="${t('playerN', { n: i + 1 })}">
      <div class="swatches">${COLORS.map((col) => `<button class="sw ${col === p.color ? 'on' : ''}" style="--c:${col}" data-color="${i}:${col}" aria-label="${col}"></button>`).join('')}</div>
      <span class="row-tools">
        <button class="icon-btn sm" data-move="${i}:-1" aria-label="${t('moveUp')}" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button class="icon-btn sm" data-move="${i}:1" aria-label="${t('moveDown')}" ${i === data.roster.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button class="icon-btn sm danger" data-remove="${i}" aria-label="${t('remove')}" ${data.roster.length <= 1 ? 'disabled' : ''}>${icon('x')}</button>
      </span>
    </li>`,
    )
    .join('');
  $('[data-lobby="add"]').disabled = data.roster.length >= 8;
}

function renderArenas() {
  const host = $('#arenas');
  if (!host) return;
  host.innerHTML = THEMES.map((th) => {
    const s = BOARD_SKINS[th];
    return `<button class="arena-card th-${th} ${th === prefs.theme ? 'on' : ''}" data-arena="${th}" aria-pressed="${th === prefs.theme}">
      <span class="arena-scene"><span class="mini-board" style="--d:${s.dark};--l:${s.light};--r:${s.red};--g:${s.green};--rim:${s.rim[0]}"></span></span>
      <b>${t('th_' + th)}</b>
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
  ['#summary', '#summary2'].forEach((s) => $(s) && ($(s).textContent = txt));
  const g = $('.next-up .glyph');
  if (g) g.textContent = MODE_GLYPH[c.mode];
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
    const p = data.roster[+b.dataset.avatar];
    p.avatar = AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length];
    b.textContent = p.avatar;
    b.animate([{ transform: 'scale(.7) rotate(-20deg)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  } else if (b.dataset.color) {
    const [i, col] = b.dataset.color.split(':');
    data.roster[+i].color = col;
    renderRoster();
  } else if (b.dataset.move) {
    const [i, d] = b.dataset.move.split(':').map(Number);
    moveRoster(i, i + d);
  } else if (b.dataset.remove != null) {
    data.roster.splice(+b.dataset.remove, 1);
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
    data.roster[+e.target.dataset.name].name = e.target.value;
  }
  updateSummary();
  save();
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
  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    const row = grip.closest('.player-row');
    drag = { row, idx: +row.dataset.idx, y0: e.clientY, h: row.getBoundingClientRect().height + 10 };
    row.classList.add('dragging');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    drag.row.style.transform = `translateY(${dy}px)`;
    drag.target = Math.max(0, Math.min(data.roster.length - 1, drag.idx + Math.round(dy / drag.h)));
  });
  const end = () => {
    if (!drag) return;
    const { idx, target, row } = drag;
    drag = null;
    row.classList.remove('dragging');
    row.style.transform = '';
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
  go('game');
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
  state.board = new Board($('#game-board'), {
    skin: prefs.theme,
    onHit: (d) => onDart(d),
  });
  state.board.setQuality(prefs.quality === 'high' ? 'high' : 'low');
  state.board.showDarts(leg().turn, pinfo(activePlayer(leg()).pid).color);
  main.onclick = onGameClick;
  updateGame();
  if (leg().winners) setTimeout(showResult, 200);
  else if (!leg().turn.length) setTimeout(announceTurn, 700);
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
  if (!m || m.finished || leg().winners || $('.modal.open')) return;
  if (leg().turnDone) advance(true);
  clearTimeout(state.autoTimer);
  state.undo.push(clone(m));
  if (state.undo.length > 300) state.undo.shift();
  const before = leg();
  const player = activePlayer(before);
  const { leg: next, events } = throwDart(before, dart);
  m.leg = next;
  const color = pinfo(player.pid).color;
  state.board.addDart(dart, { color, index: next.turn.length - 1 });
  sfx.hit(dart);
  haptic(dart.mult >= 2 ? 20 : 10);
  save();
  updateGame({ popDart: next.turn.length - 1 });
  handleEvents(events, before, next, player);
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
      say(getLang() === 'he' ? 'נשרף' : 'Bust', { interrupt: true });
      $('.board-wrap')?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 380 });
    }, 230);
  } else if (has('checkout') || has('win') || has('shanghai')) {
    setTimeout(() => {
      sfx.fanfare(true);
      const title = has('shanghai') ? t('shanghaiCall') : has('checkout') ? t('gameShot') : '🏆';
      const sub = has('checkout') ? `${esc(name)} · ${record.startScore}` : esc(after.winners.map((w) => pinfo(w).name).join(' & '));
      callout(host, { title, sub, tone: 'gold', duration: 1300 });
      confetti(180);
      say(has('checkout') ? (getLang() === 'he' ? `סגירה! ${record.startScore}` : `Game shot! ${name}`) : name);
    }, 260);
    setTimeout(showResult, 1500);
    return;
  } else if (has('180')) {
    setTimeout(() => {
      sfx.fanfare(true);
      callout(host, { title: '180', sub: '★ ★ ★', tone: 'gold', duration: 1900 });
      confetti(220);
      say(getLang() === 'he' ? 'מאה ושמונים!' : 'One hundred and eighty!', { interrupt: true });
    }, 260);
  } else if (has('ton') && record) {
    setTimeout(() => {
      sfx.fanfare(false);
      callout(host, { title: String(record.counted), sub: t('ton') + (record.counted >= 140 ? '+' : ''), tone: 'cool' });
      say(record.counted);
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
    if (isX01(after.mode)) say(record.counted || (getLang() === 'he' ? 'אפס' : 'No score'));
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
  if (!silent) {
    const p = pinfo(activePlayer(leg()).pid);
    toast(`<span class="toast-av" style="--pc:${p.color}">${p.avatar}</span><span><small>${t('upNext')}</small><b>${esc(p.name)}</b></span>`);
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
  const he = getLang() === 'he';
  let line = he ? `התור של ${name}` : name;
  if (isX01(L.mode) && p.score <= 170 && checkout(p.score, 3, L.doubleOut)) {
    line += he ? `, נשארו ${p.score}` : `, you require ${p.score}`;
  }
  say(line);
}

function undo() {
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
    <div class="chips">${bits.join('')}</div>`;
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
      <span class="avatar lg" style="--pc:${pi.color}">${pi.avatar}</span>
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
        <span class="avatar xs">${oi.avatar}</span>
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
          return `<span class="c-player ${p === cur ? 'on' : ''}" style="--pc:${pi.color}"><i class="avatar sm">${pi.avatar}</i><b>${esc(pi.name)}</b><em dir="ltr">${p.score}</em>${showLegs ? `<small dir="ltr">${m.legWins[p.pid]}</small>` : ''}</span>`;
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
        <span class="avatar">${pi.avatar}</span>
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
            return `<li style="--pc:${pi.color}"><span class="avatar xs">${pi.avatar}</span><b>${esc(pi.name)}</b><span class="fd" dir="ltr">${x.darts.map((d) => `<i class="m${d.mult}">${d.label}</i>`).join('')}</span><em dir="ltr" class="${x.bust ? 'bad' : x.counted >= 100 ? 'hot' : ''}">${x.bust ? 'BUST' : x.counted}</em></li>`;
          })
          .join('')}</ul>`
      : `<p class="muted">${t('noTurns')}</p>`
  }`;
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
        <td><span class="avatar xs">${pi.avatar}</span> ${esc(pi.name)}</td>
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
      <div class="trophy">${final ? trophySVG() : `<span class="avatar xl" style="--pc:${winners[0].color}">${winners[0].avatar}</span>`}</div>
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

  if (final) {
    confetti(260);
    sfx.fanfare(true);
  }
}

function commitPending() {
  const p = state.pending;
  if (!p) return null;
  const old = match();
  recordLeg(old.leg, old.roster);
  if (p.outcome.type === 'match' || p.outcome.type === 'tournament') recordMatch(old, p.outcome.winners);
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
    toast(`<span class="toast-av" style="--pc:${p.color}">${p.avatar}</span><span><small>${t('upNext')}</small><b>${esc(p.name)}</b></span>`);
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

  main.innerHTML = `
    <section class="stats-page">
      <header class="step-head reveal"><span class="step-no">◎</span><div><h2>${t('statsTitle')}</h2><p>${t('statsSub')}</p></div>
        ${all.length ? `<button class="btn ghost sm" data-s="reset">${t('resetStats')}</button>` : ''}</header>
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
          ${tile(t('bestTurn'), s.bestTurn)}
          ${tile(t('bestCheckout'), s.bestCheckout || '—')}
          ${tile(t('t180'), s.t180, 'hot')}
          ${tile(t('t140'), s.t140)}
          ${tile(t('t100'), s.t100)}
          ${tile(t('dartsThrown'), s.darts)}
          ${tile(t('trebleRate'), s.darts ? ((s.trebles / s.darts) * 100).toFixed(1) + '%' : '—')}
          ${tile(t('secPerTurn'), s.turns ? (s.turnMs / s.turns / 1000).toFixed(1) : '—')}
        </div>
        <div class="heat panel reveal" style="--d:.15s">
          <h4>${t('heatmap')}</h4>
          <div class="board-host heat-board" id="stats-board"></div>
          ${favBeds(s)}
        </div>
      </div>
      ${data.history.length ? `<div class="history panel reveal" style="--d:.2s"><h4>${t('history')}</h4><ul>${data.history.slice(0, 15).map((h) => `
        <li><span class="glyph" dir="ltr">${MODE_GLYPH[h.mode] ?? h.mode}</span><span>${h.players.map((n) => (h.winners.includes(n) ? `<b>🏆 ${esc(n)}</b>` : esc(n))).join(' · ')}</span><time>${new Date(h.at).toLocaleDateString(getLang() === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>`).join('')}</ul></div>` : ''}
      `}
    </section>`;

  const host = $('#stats-board');
  if (host) {
    state.statsBoard = new Board(host, { interactive: false, skin: prefs.theme });
    state.statsBoard.setQuality(prefs.quality === 'high' ? 'high' : 'low');
    if (s) state.statsBoard.setHeat(s.points);
  }
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sPlayer) {
      state.statsPlayer = b.dataset.sPlayer;
      renderStats(main);
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

const avg3 = (s) => (s.x01Darts ? (s.x01Points / s.x01Darts) * 3 : 0);
const rosterEntry = (name) => data.roster.find((p) => p.name.toLowerCase() === name.toLowerCase());
const colorFor = (name) => rosterEntry(name)?.color ?? '#8b9dff';
const avatarFor = (name) => rosterEntry(name)?.avatar ?? '🎯';

function tile(label, value, tone = '') {
  return `<article class="tile ${tone}"><small>${label}</small><b dir="ltr">${value}</b></article>`;
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
  if (e.target.matches('input, textarea')) return;
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
