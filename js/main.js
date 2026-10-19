// ─────────────────────────────────────────────────────────────
//  PRISMA – UI, Eingabe & Spielschleife
// ─────────────────────────────────────────────────────────────
import { COLS, ROWS, TOWERS, TOWER_ORDER, REACTIONS, MAX_LEVEL, upgradeCost, WIN_WAVE } from './data.js';
import { Game, renderBackground, renderGame, drawTower, RIFT_COOLDOWN, OC_COOLDOWN } from './game.js';
import { sfx, unlockAudio, isMuted, setMuted } from './audio.js';

const $ = s => document.querySelector(s);
const cv = $('#cv');
const ctx = cv.getContext('2d');
const bg = document.createElement('canvas');
const bgx = bg.getContext('2d');

const game = new Game();
window.__game = game; // für Tests/Debug
window.__view = () => view;

const ui = {
  shopSel: null,     // gewählter Turmtyp
  ghost: null,       // {type,x,y}
  preview: null,     // Ergebnis von previewPlacement
  selected: null,    // ausgewählter Turm
  paused: true,
  speed: 1,
  started: false,
};

let view = { ts: 40, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

let best = 0;
try { best = parseInt(localStorage.getItem('prisma.best') || '0', 10) || 0; } catch (e) { /* */ }
const seenHelp = (() => { try { return localStorage.getItem('prisma.help') === '1'; } catch (e) { return false; } })();

// ── Layout ────────────────────────────────────────────────
function resize() {
  const stage = $('#stage');
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  bg.width = w * dpr; bg.height = h * dpr;
  const pad = 10;
  const ts = Math.floor(Math.min((w - pad * 2) / COLS, (h - pad * 2) / ROWS));
  const ox = Math.floor((w - ts * COLS) / 2), oy = Math.floor((h - ts * ROWS) / 2);
  view = { ts, ox, oy, w, h, dpr };
  redrawBg();
}

function redrawBg() {
  bgx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  renderBackground(bgx, game, view);
}

// ── Shop ──────────────────────────────────────────────────
const shopEl = $('#shop');
const cards = {};
for (const type of TOWER_ORDER) {
  const def = TOWERS[type];
  const b = document.createElement('button');
  b.className = 'card';
  b.style.setProperty('--c', def.color);
  b.innerHTML = `<canvas width="88" height="88"></canvas><span class="nm">${def.name}</span><span class="cost"><i class="gem"></i>${def.cost}</span>`;
  const ic = b.querySelector('canvas').getContext('2d');
  ic.setTransform(2, 0, 0, 2, 0, 0);
  drawTower(ic, type, 22, 22, 36, -Math.PI / 2, 1, 0.6);
  b.addEventListener('click', () => selectShop(type));
  shopEl.appendChild(b);
  cards[type] = b;
}

function selectShop(type) {
  unlockAudio();
  deselectTower();
  if (ui.shopSel === type) { ui.shopSel = null; ui.ghost = null; ui.preview = null; hideHint(); }
  else {
    ui.shopSel = type; ui.ghost = null; ui.preview = null;
    const d = TOWERS[type];
    showHint(`<b style="color:${d.color}">${d.name}</b> – ${d.blurb}<br><span class="dim">Feld antippen = Vorschau · nochmal tippen = bauen</span>`);
  }
  updateShop();
}

function updateShop() {
  for (const type of TOWER_ORDER) {
    const c = cards[type];
    c.classList.toggle('sel', ui.shopSel === type);
    c.classList.toggle('poor', game.gold < TOWERS[type].cost);
  }
}

// ── Turm-Panel ────────────────────────────────────────────
const panel = $('#panel');
function selectTower(t) {
  ui.shopSel = null; ui.ghost = null; ui.preview = null;
  hideHint();
  ui.selected = t;
  shopEl.classList.add('hidden');
  panel.classList.remove('hidden');
  renderPanel(true);
  updateShop();
}
function deselectTower() {
  ui.selected = null;
  panel.classList.add('hidden');
  shopEl.classList.remove('hidden');
}

const MODE_NAME = { first: 'Erster', strong: 'Stärkster', near: 'Nächster' };
let panelSig = '';
function renderPanel(force) {
  const t = ui.selected;
  if (!t) return;
  const def = TOWERS[t.type];
  const st = game.towerStats(t);
  const upCost = t.level < MAX_LEVEL ? upgradeCost(t.type, t.level) : 0;
  const ocReady = t.ocCd <= 0 && t.heat <= 0;
  const sig = [t.id, t.level, t.res, t.mode, Math.round(st.dmg), game.gold >= upCost, ocReady, t.oc > 0, t.heat > 0, Math.ceil(Math.max(0, t.ocCd)), t.kills, t.fired].join('|');
  if (!force && sig === panelSig) return;
  panelSig = sig;
  const sell = game.sellValue(t);
  let ocLabel = 'Überladen';
  if (t.oc > 0) ocLabel = 'Aktiv!';
  else if (t.heat > 0) ocLabel = 'Überhitzt';
  else if (t.ocCd > 0) ocLabel = `${Math.ceil(t.ocCd)}s`;
  panel.style.setProperty('--c', def.color);
  panel.innerHTML = `
    <div class="ph">
      <canvas id="picon" width="80" height="80"></canvas>
      <div class="pt">
        <div class="pn">${def.name} <span class="lv">${'◆'.repeat(t.level)}${'◇'.repeat(MAX_LEVEL - t.level)}</span></div>
        <div class="ps">
          <span>⚔ ${st.dmg < 10 ? st.dmg.toFixed(1) : Math.round(st.dmg)}</span>
          <span>◎ ${st.range.toFixed(1)}</span>
          <span>⟳ ${st.rate.toFixed(2)}/s</span>
          <span>☠ ${t.kills}</span>
          ${t.res ? `<span class="res">✦ Resonanz +${t.res * 15}%</span>` : ''}
        </div>
      </div>
      <button class="x" id="pclose" aria-label="Schließen">✕</button>
    </div>
    <div class="pb">
      ${t.level < MAX_LEVEL
        ? `<button id="pup" class="pbtn up ${game.gold < upCost ? 'off' : ''}"><b>⬆ Stufe ${t.level + 1}</b><small><i class="gem"></i>${upCost}</small></button>`
        : `<button class="pbtn up off"><b>MAX</b><small>${def.special.replace('Stufe 3: ', '')}</small></button>`}
      <button id="poc" class="pbtn oc ${ocReady ? '' : 'off'} ${t.oc > 0 ? 'on' : ''}"><b>${ocLabel}</b><small>⚡ 5s Turbo</small></button>
      <button id="pmode" class="pbtn"><b>${MODE_NAME[t.mode]}</b><small>🎯 Ziel</small></button>
      <button id="psell" class="pbtn sell"><b>Verkauf</b><small>+${sell}</small></button>
    </div>`;
  const pi = $('#picon').getContext('2d');
  pi.setTransform(2, 0, 0, 2, 0, 0);
  drawTower(pi, t.type, 20, 20, 34, -Math.PI / 2, t.level, 0.6);
  $('#pclose').onclick = () => deselectTower();
  const up = $('#pup');
  if (up) up.onclick = () => { if (game.upgrade(t)) renderPanel(true); else flash(up); };
  $('#poc').onclick = e => { if (game.overcharge(t)) renderPanel(true); else flash(e.currentTarget); };
  $('#pmode').onclick = () => { game.cycleMode(t); renderPanel(true); };
  $('#psell').onclick = () => { game.sell(t); deselectTower(); updateShop(); };
}

function flash(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}

// ── Hinweise & Toasts ─────────────────────────────────────
const hintEl = $('#hint');
function showHint(html) { hintEl.innerHTML = html; hintEl.classList.add('show'); }
function hideHint() { hintEl.classList.remove('show'); }

const toastEl = $('#toast');
const toastQ = [];
let toastBusy = false;
function toast(title, body, color = '#7df3ff') {
  toastQ.push({ title, body, color });
  if (!toastBusy) nextToast();
}
function nextToast() {
  const t = toastQ.shift();
  if (!t) { toastBusy = false; return; }
  toastBusy = true;
  toastEl.style.setProperty('--c', t.color);
  toastEl.innerHTML = `<b>${t.title}</b><span>${t.body}</span>`;
  toastEl.classList.remove('show'); void toastEl.offsetWidth;
  toastEl.classList.add('show');
  setTimeout(() => { toastEl.classList.remove('show'); setTimeout(nextToast, 300); }, 3200);
}

// ── HUD ───────────────────────────────────────────────────
const goldEl = $('#gold'), livesEl = $('#lives'), waveEl = $('#wave');
let shownGold = game.gold;
function setLives() {
  livesEl.textContent = game.lives;
  livesEl.parentElement.classList.remove('bump'); void livesEl.offsetWidth; livesEl.parentElement.classList.add('bump');
}
const comboEl = $('#combo');

game.on((type, data) => {
  switch (type) {
    case 'gold': updateShop(); break;
    case 'lives': setLives(); break;
    case 'wave': waveEl.textContent = game.wave; if (!ui.shopSel) hideHint(); break;
    case 'toast': toast(data.title, data.body, '#ff3dd1'); break;
    case 'discover': {
      const r = REACTIONS[data];
      toast(`Reaktion entdeckt: ${r.name}`, `${r.combo} – ${r.desc}`, r.color);
      break;
    }
    case 'waveClear': toast(`Welle ${game.wave} geschafft`, `+${data} Energie Bonus`, '#5dff8a'); break;
    case 'combo':
      if (data >= 3) {
        comboEl.textContent = `ERNTE-KOMBO ×${data}`;
        comboEl.classList.remove('pop'); void comboEl.offsetWidth; comboEl.classList.add('pop');
      } else if (data === 0) comboEl.classList.remove('pop');
      break;
    case 'over': endGame(false); break;
    case 'win': endGame(true); break;
  }
});

// ── Aktionsleiste ─────────────────────────────────────────
const waveBtn = $('#btnWave'), riftBtn = $('#btnRift'), speedBtn = $('#btnSpeed');
waveBtn.addEventListener('click', () => {
  unlockAudio();
  if (game.state === 'ready' || game.state === 'break') game.startWave();
});
riftBtn.addEventListener('click', () => { unlockAudio(); if (!game.useRift()) flash(riftBtn); });
speedBtn.addEventListener('click', () => {
  ui.speed = ui.speed === 1 ? 2 : ui.speed === 2 ? 3 : 1;
  speedBtn.textContent = ui.speed + '×';
  speedBtn.classList.toggle('on', ui.speed > 1);
});
$('#btnPause').addEventListener('click', () => openPause());

let waveSig = '';
function updateActions() {
  let sig, html, cls = '';
  if (game.state === 'ready') {
    sig = 'r' + game.wave;
    html = `<b>▶ Welle ${game.wave + 1} starten</b>`;
    cls = 'go';
  } else if (game.state === 'break') {
    const s = Math.ceil(game.breakT);
    sig = 'b' + s;
    html = `<b>▶ Welle ${game.wave + 1}</b><small>in ${s}s · jetzt +${Math.floor(game.breakT) * 2}</small>`;
    cls = 'go';
  } else if (game.state === 'wave') {
    const n = game.enemies.length + game.queue.length;
    sig = 'w' + n;
    html = `<b>Welle ${game.wave}</b><small>${n} Gegner übrig</small>`;
  } else { sig = 'o'; html = '<b>—</b>'; }
  if (sig !== waveSig) {
    waveSig = sig;
    waveBtn.innerHTML = html;
    waveBtn.className = 'wavebtn ' + cls;
  }
  if (game.state === 'break') waveBtn.style.setProperty('--p', (1 - game.breakT / 12).toFixed(3));
  else waveBtn.style.setProperty('--p', '0');

  const cd = Math.max(0, game.riftCd);
  const ready = cd <= 0;
  riftBtn.classList.toggle('ready', ready);
  riftBtn.classList.toggle('active', game.rift > 0);
  riftBtn.style.setProperty('--p', ready ? '1' : (1 - cd / RIFT_COOLDOWN).toFixed(3));
  const lbl = ready ? 'bereit' : `${Math.ceil(cd)}s`;
  if (riftBtn.dataset.l !== lbl) { riftBtn.dataset.l = lbl; riftBtn.querySelector('small').textContent = lbl; }

  // Gold-Zähler animiert
  if (shownGold !== game.gold) {
    const d = game.gold - shownGold;
    shownGold += Math.abs(d) < 2 ? d : Math.round(d * 0.25);
    goldEl.textContent = shownGold;
  }
  if (ui.selected) renderPanel(false);
}

// ── Eingabe auf dem Spielfeld ─────────────────────────────
const ptr = { down: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false, id: null };
let lastTap = { t: 0, tower: null };

function toWorld(clientX, clientY) {
  const r = cv.getBoundingClientRect();
  return { x: (clientX - r.left - view.ox) / view.ts, y: (clientY - r.top - view.oy) / view.ts, px: clientX - r.left, py: clientY - r.top };
}

cv.addEventListener('pointerdown', e => {
  unlockAudio();
  if (ui.paused) return;
  cv.setPointerCapture(e.pointerId);
  const w = toWorld(e.clientX, e.clientY);
  Object.assign(ptr, { down: true, sx: w.px, sy: w.py, lx: w.x, ly: w.y, moved: false, id: e.pointerId });
  game.harvestSegment(w.x, w.y, w.x, w.y);
});
cv.addEventListener('pointermove', e => {
  if (!ptr.down || e.pointerId !== ptr.id) return;
  const w = toWorld(e.clientX, e.clientY);
  if (Math.hypot(w.px - ptr.sx, w.py - ptr.sy) > 12) ptr.moved = true;
  game.harvestSegment(ptr.lx, ptr.ly, w.x, w.y);
  ptr.lx = w.x; ptr.ly = w.y;
});
const endPtr = e => {
  if (!ptr.down || e.pointerId !== ptr.id) return;
  ptr.down = false;
  if (!ptr.moved && e.type === 'pointerup') {
    const w = toWorld(e.clientX, e.clientY);
    tap(w.x, w.y);
  }
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);

function tap(wx, wy) {
  const cx = Math.floor(wx), cy = Math.floor(wy);
  const inside = cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS;
  const tower = inside ? game.towerAt[cy * COLS + cx] : null;

  if (tower) {
    const now = performance.now();
    if (lastTap.tower === tower && now - lastTap.t < 320) {
      game.overcharge(tower);
      lastTap = { t: 0, tower: null };
    } else lastTap = { t: now, tower };
    selectTower(tower);
    return;
  }

  if (ui.shopSel && inside) {
    if (ui.ghost && ui.ghost.x === cx && ui.ghost.y === cy) {
      const res = game.build(ui.shopSel, cx, cy);
      if (res.ok) {
        ui.ghost = null; ui.preview = null;
        updateShop();
        if (game.gold < TOWERS[ui.shopSel].cost) { ui.shopSel = null; hideHint(); updateShop(); }
      } else {
        showHint(`<span class="warn">✕ ${res.reason}</span>`);
      }
      return;
    }
    ui.ghost = { type: ui.shopSel, x: cx, y: cy };
    ui.preview = game.previewPlacement(ui.shopSel, cx, cy);
    const def = TOWERS[ui.shopSel];
    if (!ui.preview.ok) showHint(`<span class="warn">✕ ${ui.preview.reason}</span>`);
    else if (game.gold < def.cost) showHint(`<span class="warn">✕ Zu wenig Energie (${def.cost})</span>`);
    else showHint(`<b style="color:${def.color}">${def.name}</b> hier bauen? <span class="dim">Nochmal tippen</span>${ui.preview.resonance ? ` · <span class="res">✦ Resonanz +${ui.preview.resonance * 15}%</span>` : ''}`);
    return;
  }

  if (ui.selected) deselectTower();
  if (ui.shopSel) { ui.shopSel = null; ui.ghost = null; ui.preview = null; hideHint(); updateShop(); }
}

// ── Overlays ──────────────────────────────────────────────
function show(id) { $(id).classList.add('show'); }
function hide(id) { $(id).classList.remove('show'); }

function updateMenu() {
  $('#bestLine').textContent = best ? `Rekord: Welle ${best}` : 'Noch kein Rekord – leg los!';
}
updateMenu();

$('#btnPlay').addEventListener('click', () => {
  unlockAudio();
  hide('#menu');
  if (!seenHelp) { show('#help'); try { localStorage.setItem('prisma.help', '1'); } catch (e) { /* */ } }
  else startPlaying();
});
$('#btnHelpMenu').addEventListener('click', () => show('#help'));
$('#btnHelpClose').addEventListener('click', () => {
  hide('#help');
  if (!$('#menu').classList.contains('show') && !$('#pause').classList.contains('show')) startPlaying();
});

function startPlaying() {
  ui.started = true;
  ui.paused = false;
  if (game.state === 'ready' && game.wave === 0 && !game.towers.length) {
    showHint('Wähle unten einen Turm und baue ein <b>Labyrinth</b> – Gegner laufen immer den kürzesten Weg zum Kern.');
  }
}

function openPause() {
  if (!ui.started) return;
  ui.paused = true;
  $('#btnMute').textContent = isMuted() ? 'Ton: aus' : 'Ton: an';
  show('#pause');
}
$('#btnResume').addEventListener('click', () => { hide('#pause'); ui.paused = false; });
$('#btnMute').addEventListener('click', () => { setMuted(!isMuted()); $('#btnMute').textContent = isMuted() ? 'Ton: aus' : 'Ton: an'; });
$('#btnHelpPause').addEventListener('click', () => show('#help'));
$('#btnRestart').addEventListener('click', () => { hide('#pause'); newGame(); startPlaying(); });
$('#btnMenu').addEventListener('click', () => { hide('#pause'); newGame(); ui.started = false; ui.paused = true; updateMenu(); show('#menu'); });
$('#btnAgain').addEventListener('click', () => { hide('#over'); newGame(); startPlaying(); });
$('#btnContinue').addEventListener('click', () => { hide('#over'); ui.paused = false; });

function newGame() {
  game.seed = Math.floor(Math.random() * 100000);
  game.reset();
  ui.shopSel = null; ui.ghost = null; ui.preview = null;
  deselectTower();
  hideHint();
  shownGold = game.gold; goldEl.textContent = game.gold;
  livesEl.textContent = game.lives;
  waveEl.textContent = game.wave;
  redrawBg();
  updateShop();
}

function endGame(win) {
  if (game.wave > best) {
    best = game.wave;
    try { localStorage.setItem('prisma.best', String(best)); } catch (e) { /* */ }
  }
  ui.paused = true;
  const s = game.stats;
  $('#overTitle').textContent = win ? 'Sieg!' : 'Kern zerstört';
  $('#overTitle').className = win ? 'win' : 'lose';
  $('#overSub').textContent = win ? `Du hast alle ${WIN_WAVE} Wellen gehalten.` : `Du hast bis Welle ${game.wave} durchgehalten.`;
  $('#overStats').innerHTML = `
    <div><b>${game.wave}</b><span>Welle</span></div>
    <div><b>${s.kills}</b><span>Besiegt</span></div>
    <div><b>${s.reactions}</b><span>Reaktionen</span></div>
    <div><b>${s.harvested}</b><span>Geerntet</span></div>`;
  $('#overBest').textContent = `Rekord: Welle ${best}`;
  $('#btnContinue').style.display = win ? '' : 'none';
  setTimeout(() => show('#over'), win ? 300 : 900);
}

document.addEventListener('visibilitychange', () => { if (document.hidden && ui.started && !ui.paused) openPause(); });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

// ── Schleife ──────────────────────────────────────────────
let lastT = performance.now();
let acc = 0;
const STEP = 1 / 60;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!ui.paused) {
    acc += dt * ui.speed;
    let n = 0;
    while (acc >= STEP && n < 8) { game.update(STEP); acc -= STEP; n++; }
    if (n === 8) acc = 0;
  } else if (!ui.started) {
    // Menühintergrund: Zeit läuft sanft weiter
    game.time += dt * 0.5;
    game.updateFx(dt);
  }
  // Auswahl ungültig?
  if (ui.selected && !game.towers.includes(ui.selected)) deselectTower();

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  const sh = game.shake * 6;
  ctx.save();
  if (sh > 0) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
  ctx.drawImage(bg, 0, 0, view.w, view.h);
  renderGame(ctx, game, view, ui);
  ctx.restore();

  updateActions();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => setTimeout(resize, 60));
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe($('#stage'));
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawBg());
resize();
updateShop();
goldEl.textContent = game.gold;
livesEl.textContent = game.lives;
requestAnimationFrame(frame);

// Service Worker für Offline/Homescreen
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
