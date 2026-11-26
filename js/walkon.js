// BULLSEYE — TV-style walk-on intros before a match.
// The arena darkens, spotlights sweep, and each player gets a moment: photo,
// name and career numbers, introduced by the caller to a crowd roar. Two
// players finish on a face-off; then GAME ON. Skippable at any point.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * players: [{ name, color, face (trusted HTML: <img> or emoji), chips: [{label, value}] }]
 * text: { introducing, vs, gameOn, skip, debut }
 * hooks: { onPlayer(p), onVs(a, b), onGameOn() } for voice and sound
 */
export function playWalkOn({ players, text, rival = null, hooks = {} }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'walkon';
    root.innerHTML = `
      <div class="wo-beams" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="wo-haze" aria-hidden="true"></div>
      <div class="wo-stage" aria-live="polite"></div>
      <button type="button" class="wo-skip">${esc(text.skip)} ›</button>`;
    document.body.appendChild(root);
    const stage = root.querySelector('.wo-stage');
    let skipped = false;
    let done = false;
    const timers = [];
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      root.classList.add('out');
      setTimeout(() => root.remove(), 450);
      document.removeEventListener('keydown', onKey);
      resolve({ skipped });
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        skipped = true;
        finish();
      }
    };
    document.addEventListener('keydown', onKey);
    root.querySelector('.wo-skip').addEventListener('click', () => {
      skipped = true;
      finish();
    });
    const at = (ms, fn) => timers.push(setTimeout(() => !done && fn(), ms));

    const card = (p) => `
      <div class="wo-card" style="--pc:${p.color}">
        <div class="wo-photo"><span>${p.face}</span><i class="wo-ring"></i></div>
        <div class="wo-copy">
          <small>${esc(p.team ? text.introTeam ?? text.introducing : text.introducing)}</small>
          <h2>${esc(p.name)}</h2>
          <div class="wo-chips">${
            p.chips?.length
              ? p.chips.map((c) => `<span><b dir="ltr">${esc(c.value)}</b><em>${esc(c.label)}</em></span>`).join('')
              : `<span class="debut"><b>★</b><em>${esc(text.debut)}</em></span>`
          }</div>
        </div>
      </div>`;

    const PER = players.length > 4 ? 1700 : 2500;
    let t = 350;
    players.forEach((p, i) => {
      at(t, () => {
        stage.innerHTML = card(p);
        root.style.setProperty('--pc', p.color);
        hooks.onPlayer?.(p, i);
      });
      at(t + PER - 380, () => stage.firstElementChild?.classList.add('leave'));
      t += PER;
    });
    if (players.length === 2) {
      const [a, b] = players;
      at(t, () => {
        stage.innerHTML = `
          <div class="wo-vs">
            <div class="wo-side l" style="--pc:${a.color}"><div class="wo-photo sm"><span>${a.face}</span><i class="wo-ring"></i></div><h3>${esc(a.name)}</h3></div>
            <strong class="wo-vs-mark">${esc(text.vs)}</strong>
            <div class="wo-side r" style="--pc:${b.color}"><div class="wo-photo sm"><span>${b.face}</span><i class="wo-ring"></i></div><h3>${esc(b.name)}</h3></div>
            ${rival ? rivalHTML(rival, a, b, text) : ''}
          </div>`;
        hooks.onVs?.(a, b);
      });
      t += rival?.played ? 3300 : 2100;
    }
    at(t, () => {
      stage.innerHTML = `<strong class="wo-gameon">${esc(text.gameOn)}</strong>`;
      hooks.onGameOn?.();
    });
    at(t + 1150, finish);
  });
}

/** Head-to-head strip under the face-off: record, last five, streak. */
function rivalHTML(r, a, b, text) {
  if (!r.played) return `<div class="wo-rival first"><b>${esc(r.headline)}</b></div>`;
  return `<div class="wo-rival">
    <div class="wo-rec"><span style="--pc:${a.color}">${r.a}</span><i>–</i><span style="--pc:${b.color}">${r.b}</span></div>
    <b>${esc(r.headline)}</b>
    <div class="wo-last"><em>${esc(text.last5)}</em>${r.last.map((w) => `<i style="--pc:${w ? a.color : b.color}" title="${esc(w ? a.name : b.name)}"></i>`).join('')}</div>
    ${r.streak ? `<small>${esc(r.streak)}</small>` : ''}
  </div>`;
}
