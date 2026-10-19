// ─────────────────────────────────────────────────────────────
//  PRISMA – Spiellogik & Rendering
// ─────────────────────────────────────────────────────────────
import {
  COLS, ROWS, CORE, SPAWNS, TOWERS, ENEMIES, REACTIONS, START_GOLD, START_LIVES,
  MAX_LEVEL, LVL_DMG, LVL_RANGE, LVL_RATE, upgradeCost, hpMul, bountyMul,
  reactionBase, buildWave, rng, WIN_WAVE,
} from './data.js';
import { sfx } from './audio.js';

const N = COLS * ROWS;
const idx = (x, y) => y * COLS + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export const RIFT_DURATION = 6;
export const RIFT_COOLDOWN = 45;
export const OC_DURATION = 5;
export const OC_HEAT = 3;
export const OC_COOLDOWN = 22;

let uid = 1;

export class Game {
  constructor(seed = Date.now() % 100000) {
    this.seed = seed;
    this.listeners = [];
    this.reset();
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  reset() {
    this.gold = START_GOLD;
    this.lives = START_LIVES;
    this.wave = 0;
    this.state = 'ready'; // ready | wave | break | over
    this.time = 0;
    this.waveT = 0;
    this.breakT = 0;
    this.queue = [];
    this.towers = [];
    this.enemies = [];
    this.projs = [];
    this.parts = [];
    this.texts = [];
    this.shards = [];
    this.wells = [];
    this.beams = [];
    this.trail = [];
    this.links = [];
    this.combo = 0;
    this.lastHarvest = -10;
    this.rift = 0;
    this.riftCd = 0;
    this.shake = 0;
    this.coreFlash = 0;
    this.discovered = new Set();
    this.stats = { kills: 0, reactions: 0, harvested: 0 };
    this.won = false;

    this.grid = new Uint8Array(N); // 0 frei, 1 Fels, 2 Turm
    this.towerAt = new Array(N).fill(null);
    this.genRocks();
    this.refreshField();
  }

  // ── Karte ────────────────────────────────────────────────
  isReserved(x, y) {
    if (x === CORE.x && y === CORE.y) return true;
    for (const s of SPAWNS) if (s.x === x && s.y === y) return true;
    return false;
  }

  genRocks() {
    const r = rng(this.seed);
    let placed = 0, tries = 0;
    while (placed < 11 && tries < 400) {
      tries++;
      const x = Math.floor(r() * COLS), y = Math.floor(r() * ROWS);
      if (this.grid[idx(x, y)] !== 0) continue;
      let near = false;
      for (const p of [CORE, ...SPAWNS]) if (Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1) near = true;
      if (near) continue;
      this.grid[idx(x, y)] = 1;
      const f = this.computeField();
      if (!this.spawnsReachable(f)) { this.grid[idx(x, y)] = 0; continue; }
      placed++;
    }
  }

  walk(i, block) { return this.grid[i] === 0 && i !== block; }

  computeField(block = -1) {
    const d = new Float32Array(N).fill(Infinity);
    const done = new Uint8Array(N);
    const start = idx(CORE.x, CORE.y);
    d[start] = 0;
    for (;;) {
      let best = -1, bv = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && d[i] < bv) { bv = d[i]; best = i; }
      if (best < 0) break;
      done[best] = 1;
      const bx = best % COLS, by = (best / COLS) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = bx + dx, ny = by + dy;
        if (!inB(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (!this.walk(ni, block)) continue;
        if (dx && dy && (!this.walk(idx(bx + dx, by), block) || !this.walk(idx(bx, by + dy), block))) continue;
        const nd = bv + (dx && dy ? 1.4142 : 1);
        if (nd < d[ni]) d[ni] = nd;
      }
    }
    return d;
  }

  spawnsReachable(f) {
    return SPAWNS.every(s => Number.isFinite(f[idx(s.x, s.y)]));
  }

  nextMap(f, block = -1) {
    const next = new Int16Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(f[i]) || f[i] === 0) continue;
      const x = i % COLS, y = (i / COLS) | 0;
      let best = -1, bv = f[i];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (!this.walk(ni, block)) continue;
        if (dx && dy && (!this.walk(idx(x + dx, y), block) || !this.walk(idx(x, y + dy), block))) continue;
        const v = f[ni] + (dx && dy ? 1.4142 : 1);
        if (v < bv + 1.5 && f[ni] < bv) { bv = f[ni]; best = ni; }
      }
      next[i] = best;
    }
    return next;
  }

  tracePath(f, next, sx, sy) {
    const pts = [];
    let i = idx(sx, sy), guard = 0;
    while (i >= 0 && guard++ < N) {
      pts.push({ x: (i % COLS) + 0.5, y: ((i / COLS) | 0) + 0.5 });
      if (f[i] === 0) break;
      i = next[i];
    }
    return pts;
  }

  refreshField() {
    this.field = this.computeField();
    this.next = this.nextMap(this.field);
    this.paths = SPAWNS.map((s, k) => ({
      active: this.spawnActive(k),
      pts: this.tracePath(this.field, this.next, s.x, s.y),
    }));
    this.computeResonance();
  }

  spawnActive(k) { return this.wave >= SPAWNS[k].opensAt || (k === 0); }

  // ── Bauen ────────────────────────────────────────────────
  previewPlacement(type, x, y) {
    const res = { ok: false, reason: '', paths: null, resonance: 0 };
    if (!inB(x, y)) { res.reason = 'Außerhalb'; return res; }
    const i = idx(x, y);
    if (this.grid[i] === 1) { res.reason = 'Fels'; return res; }
    if (this.grid[i] === 2) { res.reason = 'Belegt'; return res; }
    if (this.isReserved(x, y)) { res.reason = 'Portal/Kern'; return res; }
    for (const e of this.enemies) {
      if (!e.flying && Math.floor(e.x) === x && Math.floor(e.y) === y) { res.reason = 'Gegner im Weg'; return res; }
    }
    const f = this.computeField(i);
    if (!this.spawnsReachable(f)) { res.reason = 'Weg blockiert!'; return res; }
    for (const e of this.enemies) {
      if (e.flying) continue;
      const ei = idx(clamp(Math.floor(e.x), 0, COLS - 1), clamp(Math.floor(e.y), 0, ROWS - 1));
      if (!Number.isFinite(f[ei])) { res.reason = 'Gegner eingesperrt'; return res; }
    }
    const nx = this.nextMap(f, i);
    res.paths = SPAWNS.map((s, k) => ({ active: this.spawnActive(k), pts: this.tracePath(f, nx, s.x, s.y) }));
    const kinds = new Set();
    for (const t of this.towers) if (Math.abs(t.cx - x) <= 1 && Math.abs(t.cy - y) <= 1 && t.type !== type) kinds.add(t.type);
    res.resonance = kinds.size;
    res.ok = true;
    return res;
  }

  build(type, x, y) {
    const def = TOWERS[type];
    if (this.gold < def.cost) { sfx.error(); return { ok: false, reason: 'Zu wenig Energie' }; }
    const p = this.previewPlacement(type, x, y);
    if (!p.ok) { sfx.error(); return p; }
    this.gold -= def.cost;
    const t = {
      id: uid++, type, cx: x, cy: y, x: x + 0.5, y: y + 0.5, level: 1, cd: 0.2,
      angle: -Math.PI / 2, spent: def.cost, fired: false, oc: 0, heat: 0, ocCd: 0,
      mode: 'first', kills: 0, res: 0, born: this.time, spin: 0, flash: 0,
    };
    this.towers.push(t);
    this.grid[idx(x, y)] = 2;
    this.towerAt[idx(x, y)] = t;
    this.refreshField();
    sfx.build();
    this.burst(t.x, t.y, def.color, 14, 2.2);
    this.ring(t.x, t.y, def.color, 0.9);
    this.emit('gold');
    return { ok: true, tower: t };
  }

  upgrade(t) {
    if (t.level >= MAX_LEVEL) return false;
    const c = upgradeCost(t.type, t.level);
    if (this.gold < c) { sfx.error(); return false; }
    this.gold -= c;
    t.spent += c;
    t.level++;
    t.flash = 1;
    sfx.upgrade();
    this.ring(t.x, t.y, TOWERS[t.type].color, 1.4);
    this.burst(t.x, t.y, '#ffffff', 18, 3);
    this.emit('gold');
    return true;
  }

  sellValue(t) { return t.fired ? Math.floor(t.spent * 0.7) : t.spent; }

  sell(t) {
    this.gold += this.sellValue(t);
    this.towers = this.towers.filter(o => o !== t);
    this.grid[idx(t.cx, t.cy)] = 0;
    this.towerAt[idx(t.cx, t.cy)] = null;
    this.refreshField();
    sfx.sell();
    this.burst(t.x, t.y, TOWERS[t.type].color, 16, 2.5);
    this.emit('gold');
  }

  overcharge(t) {
    if (t.ocCd > 0 || t.heat > 0) return false;
    t.oc = OC_DURATION;
    t.ocCd = OC_COOLDOWN;
    sfx.overcharge();
    this.ring(t.x, t.y, '#ffffff', 1.6);
    this.text(t.x, t.y - 0.5, 'ÜBERLADEN!', '#ffffff', 0.34);
    return true;
  }

  cycleMode(t) {
    const modes = ['first', 'strong', 'near'];
    t.mode = modes[(modes.indexOf(t.mode) + 1) % modes.length];
  }

  computeResonance() {
    this.links = [];
    for (const t of this.towers) {
      const kinds = new Set();
      for (const o of this.towers) {
        if (o === t) continue;
        if (Math.abs(o.cx - t.cx) <= 1 && Math.abs(o.cy - t.cy) <= 1) {
          if (o.type !== t.type) kinds.add(o.type);
          if (o.id > t.id && o.type !== t.type) this.links.push([t, o]);
        }
      }
      t.res = kinds.size;
    }
  }

  towerStats(t) {
    const def = TOWERS[t.type];
    const L = t.level - 1;
    const resMul = 1 + 0.15 * t.res;
    const ocMul = t.oc > 0 ? 1.25 : 1;
    return {
      dmg: def.dmg * LVL_DMG[L] * resMul * ocMul,
      range: def.range + LVL_RANGE[L],
      rate: def.rate * LVL_RATE[L] * (t.oc > 0 ? 2.5 : 1),
      resMul,
    };
  }

  // ── Fähigkeiten ──────────────────────────────────────────
  useRift() {
    if (this.riftCd > 0 || this.state === 'over') return false;
    this.rift = RIFT_DURATION;
    this.riftCd = RIFT_COOLDOWN;
    sfx.rift();
    this.ring(CORE.x + 0.5, CORE.y + 0.5, '#b07bff', 8);
    return true;
  }

  // ── Wellen ───────────────────────────────────────────────
  startWave() {
    if (this.state === 'wave' || this.state === 'over') return;
    let bonus = 0;
    if (this.state === 'break' && this.breakT > 1) {
      bonus = Math.floor(this.breakT) * 2;
      this.gold += bonus;
      this.text(CORE.x + 0.5, CORE.y - 0.4, `+${bonus} Eile-Bonus`, '#ffe23d', 0.3);
    }
    this.wave++;
    this.queue = buildWave(this.wave, this.seed);
    this.waveT = 0;
    this.state = 'wave';
    if (this.wave === SPAWNS[1].opensAt) {
      this.refreshField();
      this.emit('toast', { title: 'Zweites Portal erwacht!', body: 'Gegner kommen jetzt auch von links.' });
      const s = SPAWNS[1];
      this.ring(s.x + 0.5, s.y + 0.5, '#ff3dd1', 2.5);
    }
    if (this.wave % 10 === 0) {
      this.emit('toast', { title: 'Koloss naht', body: 'Ein schwer gepanzerter Boss betritt das Feld.' });
    }
    sfx.wave();
    this.emit('wave');
    this.emit('gold');
  }

  // ── Gegner ───────────────────────────────────────────────
  spawnEnemy(type, k, at = null) {
    const def = ENEMIES[type];
    const s = SPAWNS[k];
    const hp = def.hp * hpMul(this.wave);
    const e = {
      id: uid++, type, def, x: at ? at.x : s.x + 0.5, y: at ? at.y : s.y + 0.5,
      hp, maxhp: hp, speed: def.speed * (1 + Math.min(this.wave, 40) * 0.006),
      armor: def.armor * (1 + this.wave * 0.04), flying: !!def.flying, size: def.size,
      bounty: Math.max(1, Math.round(def.bounty * bountyMul(this.wave))),
      chill: 0, chillAmt: 0, burn: 0, burnDps: 0, charge: 0, vuln: 0, stun: 0, reactCd: 0,
      phaseT: Math.random() * 3, phased: false, healT: 1, hit: 0, dead: false,
      dir: Math.PI / 2, wob: Math.random() * TAU, born: this.time, spawn: k,
      fx: s.x + 0.5, fy: s.y + 0.5,
    };
    if (at) { e.x += (Math.random() - 0.5) * 0.3; e.y += (Math.random() - 0.5) * 0.3; }
    this.enemies.push(e);
    if (def.boss) { this.shake = Math.max(this.shake, 0.6); sfx.boss(); }
    if (!at) this.ring(e.x, e.y, def.color, 0.7);
    return e;
  }

  remaining(e) {
    if (e.flying) return dist(e.x, e.y, CORE.x + 0.5, CORE.y + 0.5);
    const tx = clamp(Math.floor(e.x), 0, COLS - 1), ty = clamp(Math.floor(e.y), 0, ROWS - 1);
    const i = idx(tx, ty);
    const n = this.next[i];
    if (n < 0) return Number.isFinite(this.field[i]) ? this.field[i] : 99;
    return this.field[n] + dist(e.x, e.y, (n % COLS) + 0.5, ((n / COLS) | 0) + 0.5);
  }

  moveEnemy(e, dt) {
    let sp = e.speed;
    if (e.chill > 0) sp *= 1 - e.chillAmt;
    if (e.stun > 0) sp = 0;
    if (this.rift > 0) sp *= 0.45;
    if (e.inWell) sp *= 0.3;
    const step = sp * dt;
    const cx = CORE.x + 0.5, cy = CORE.y + 0.5;

    if (e.flying) {
      const d = dist(e.x, e.y, cx, cy);
      if (d < 0.2) return this.leak(e);
      const ang = Math.atan2(cy - e.y, cx - e.x);
      e.dir = ang;
      const w = Math.sin(this.time * 2 + e.wob) * 0.6;
      e.x += Math.cos(ang) * step + Math.cos(ang + Math.PI / 2) * w * step * 0.5;
      e.y += Math.sin(ang) * step + Math.sin(ang + Math.PI / 2) * w * step * 0.5;
      return;
    }

    const tx = clamp(Math.floor(e.x), 0, COLS - 1), ty = clamp(Math.floor(e.y), 0, ROWS - 1);
    const i = idx(tx, ty);
    let gx, gy;
    if (this.field[i] === 0) {
      gx = cx; gy = cy;
      if (dist(e.x, e.y, cx, cy) < 0.15) return this.leak(e);
    } else {
      const n = this.next[i];
      if (n < 0) { gx = cx; gy = cy; } else { gx = (n % COLS) + 0.5; gy = ((n / COLS) | 0) + 0.5; }
    }
    const dx = gx - e.x, dy = gy - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ta = Math.atan2(dy, dx);
    let da = ta - e.dir;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    e.dir += da * Math.min(1, dt * 10);
    const m = Math.min(step, d);
    e.x += (dx / d) * m;
    e.y += (dy / d) * m;
  }

  leak(e) {
    e.dead = true;
    e.leaked = true;
    this.lives -= e.def.leak;
    this.shake = Math.max(this.shake, 0.35 + e.def.leak * 0.05);
    this.coreFlash = 1;
    sfx.leak();
    this.burst(e.x, e.y, '#ff2d55', 20, 3);
    this.text(CORE.x + 0.5, CORE.y - 0.2, `-${e.def.leak}`, '#ff2d55', 0.42);
    this.emit('lives');
    if (this.lives <= 0) {
      this.lives = 0;
      this.state = 'over';
      this.emit('over');
    }
  }

  damage(e, amount, opts = {}) {
    if (e.dead) return 0;
    if (e.phased) {
      if (Math.random() < 0.2) this.text(e.x, e.y - 0.3, 'immun', '#b9a7ff', 0.2);
      return 0;
    }
    let d = amount;
    if (!opts.pierce) d = Math.max(d * 0.25, d - e.armor);
    if (e.vuln > 0) d *= 1.3;
    e.hp -= d;
    e.hit = 1;
    if (opts.crit) this.text(e.x, e.y - 0.4, `KRIT ${Math.round(d)}`, '#ffffff', 0.3);
    if (e.hp <= 0) this.kill(e, opts.src);
    return d;
  }

  kill(e, src) {
    if (e.dead) return;
    e.dead = true;
    this.stats.kills++;
    if (src) src.kills++;
    sfx.kill();
    const col = e.def.color;
    this.burst(e.x, e.y, col, e.def.boss ? 60 : 12, e.def.boss ? 5 : 2.6);
    this.ring(e.x, e.y, col, e.def.boss ? 2.5 : 0.6);
    // Energiesplitter
    const pieces = e.def.boss ? 8 : 1;
    for (let k = 0; k < pieces; k++) {
      const a = Math.random() * TAU, r = e.def.boss ? 0.3 + Math.random() * 0.7 : 0;
      this.shards.push({
        x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r,
        v: Math.max(1, Math.round(e.bounty / pieces)), age: 0, life: 6.5,
        bob: Math.random() * TAU, dead: false,
      });
    }
    if (e.type === 'splitter') {
      for (let k = 0; k < 3; k++) {
        const c = this.spawnEnemy('swarm', e.spawn, { x: e.x, y: e.y });
        c.dir = e.dir;
      }
    }
    if (e.def.boss) this.shake = Math.max(this.shake, 0.8);
  }

  // ── Elemente & Reaktionen ────────────────────────────────
  applyElement(e, el, power = 1) {
    if (e.dead) return;
    const canReact = e.reactCd <= 0;
    if (el === 'frost') {
      if (canReact && e.burn > 0) return this.react(e, 'thermo');
      if (canReact && e.charge > 0) return this.react(e, 'super');
      e.chill = 2.6;
      e.chillAmt = Math.max(e.chillAmt, power);
    } else if (el === 'feuer') {
      if (canReact && e.chill > 0) return this.react(e, 'thermo');
      if (canReact && e.charge > 0) return this.react(e, 'plasma');
      e.burn = 3;
      e.burnDps = Math.max(e.burnDps, power);
    } else if (el === 'blitz') {
      if (canReact && e.chill > 0) return this.react(e, 'super');
      if (canReact && e.burn > 0) return this.react(e, 'plasma');
      e.charge = 3;
    }
  }

  react(e, kind) {
    const R = reactionBase(this.wave);
    const info = REACTIONS[kind];
    e.reactCd = 1.8;
    this.stats.reactions++;
    sfx.reaction(kind);
    this.text(e.x, e.y - 0.45, info.name, info.color, 0.3);
    if (!this.discovered.has(kind)) {
      this.discovered.add(kind);
      this.emit('discover', kind);
    }
    if (kind === 'thermo') {
      e.burn = 0; e.chill = 0; e.chillAmt = 0;
      e.vuln = 4;
      this.burst(e.x, e.y, '#ffd0a0', 16, 3);
      this.burst(e.x, e.y, '#9fc4ff', 10, 2.5);
      this.ring(e.x, e.y, info.color, 1.0);
      this.damage(e, R * 1.6, { pierce: true });
    } else if (kind === 'super') {
      e.charge = 0;
      e.stun = e.def.boss ? 0.45 : 1.4;
      this.ring(e.x, e.y, info.color, 0.8);
      this.burst(e.x, e.y, '#e8ffff', 12, 2);
      this.damage(e, R * 0.6, { pierce: true });
    } else if (kind === 'plasma') {
      e.charge = 0; e.burn = 0;
      this.ring(e.x, e.y, info.color, 1.5);
      this.burst(e.x, e.y, '#ff8af3', 26, 4);
      this.shake = Math.max(this.shake, 0.15);
      for (const o of this.enemies) {
        if (o.dead) continue;
        if (dist(o.x, o.y, e.x, e.y) < 1.4) this.damage(o, R * (o === e ? 1.3 : 1), { pierce: true });
      }
    }
  }

  // ── Türme ────────────────────────────────────────────────
  findTarget(t, range, def) {
    let best = null, bv = Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.phased) continue;
      if (e.flying && !def.air) continue;
      const d = dist(t.x, t.y, e.x, e.y);
      if (d > range) continue;
      let v;
      if (t.mode === 'first') v = this.remaining(e);
      else if (t.mode === 'strong') v = -e.hp;
      else v = d;
      if (v < bv) { bv = v; best = e; }
    }
    return best;
  }

  updateTower(t, dt) {
    const def = TOWERS[t.type];
    t.flash = Math.max(0, t.flash - dt * 2);
    t.spin += dt;
    if (t.ocCd > 0) t.ocCd -= dt;
    if (t.oc > 0) {
      t.oc -= dt;
      if (Math.random() < dt * 20) this.spark(t.x, t.y, '#ffffff');
      if (t.oc <= 0) { t.heat = OC_HEAT; this.text(t.x, t.y - 0.4, 'überhitzt', '#ff6b4a', 0.24); }
    }
    if (t.heat > 0) {
      t.heat -= dt;
      if (Math.random() < dt * 8) this.parts.push({ x: t.x + (Math.random() - 0.5) * 0.4, y: t.y, vx: 0, vy: -0.6, life: 1, t: 0, color: '#666', size: 0.14, kind: 'smoke' });
      return;
    }
    const st = this.towerStats(t);
    t.cd -= dt;
    if (t.type === 'flame') {
      // Glut trifft alle Bodengegner im Umkreis
      let any = false;
      for (const e of this.enemies) if (!e.dead && !e.flying && !e.phased && dist(t.x, t.y, e.x, e.y) <= st.range) { any = true; break; }
      if (!any) return;
      t.angle += dt * 4;
      if (Math.random() < dt * 30) {
        const a = Math.random() * TAU, sp = 1.2 + Math.random() * 1.5;
        this.parts.push({ x: t.x, y: t.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: st.range / sp * 0.9, t: 0, color: Math.random() < 0.5 ? '#ff7a2f' : '#ffd23d', size: 0.16, kind: 'flame' });
      }
      if (t.cd <= 0) {
        t.cd = 1 / st.rate;
        t.fired = true;
        sfx.shoot('flame');
        const burnPow = st.dmg * 1.3 * (t.level >= 3 ? 2 : 1);
        for (const e of this.enemies) {
          if (e.dead || e.flying) continue;
          if (dist(t.x, t.y, e.x, e.y) <= st.range) {
            this.damage(e, st.dmg, { src: t });
            this.applyElement(e, 'feuer', burnPow);
          }
        }
      }
      return;
    }

    const target = this.findTarget(t, st.range, def);
    if (!target) return;
    const ta = Math.atan2(target.y - t.y, target.x - t.x);
    let da = ta - t.angle;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    t.angle += da * Math.min(1, dt * 14);
    if (t.cd > 0) return;
    t.cd = 1 / st.rate;
    t.fired = true;
    sfx.shoot(t.type);
    const mx = t.x + Math.cos(t.angle) * 0.32, my = t.y + Math.sin(t.angle) * 0.32;

    switch (t.type) {
      case 'pulse': {
        this.projs.push({ kind: 'bolt', x: mx, y: my, tgt: target, tx: target.x, ty: target.y, sp: 13, dmg: st.dmg, color: def.color, src: t });
        if (t.level >= 3) {
          let other = null;
          for (const e of this.enemies) if (e !== target && !e.dead && !e.phased && dist(t.x, t.y, e.x, e.y) <= st.range) { other = e; break; }
          const o = other || target;
          this.projs.push({ kind: 'bolt', x: mx, y: my, tgt: o, tx: o.x, ty: o.y, sp: 13, dmg: st.dmg, color: def.color, src: t, delay: 0.06 });
        }
        break;
      }
      case 'frost': {
        this.projs.push({ kind: 'shard', x: mx, y: my, tgt: target, tx: target.x, ty: target.y, sp: 9, dmg: st.dmg, color: def.color, src: t, r: t.level >= 3 ? 1.25 : 0.95, chill: t.level >= 3 ? 0.55 : 0.4 });
        break;
      }
      case 'volt': {
        const hits = [target];
        const max = t.level >= 3 ? 5 : 3;
        let cur = target;
        while (hits.length < max) {
          let nb = null, nd = 1.8;
          for (const e of this.enemies) {
            if (e.dead || e.phased || hits.includes(e)) continue;
            const d = dist(cur.x, cur.y, e.x, e.y);
            if (d < nd) { nd = d; nb = e; }
          }
          if (!nb) break;
          hits.push(nb); cur = nb;
        }
        let px = mx, py = my, dmg = st.dmg;
        for (const e of hits) {
          this.arc(px, py, e.x, e.y, def.color);
          px = e.x; py = e.y;
          this.damage(e, dmg, { src: t });
          this.applyElement(e, 'blitz');
          dmg *= 0.8;
        }
        break;
      }
      case 'grav': {
        this.projs.push({ kind: 'orb', x: mx, y: my, tgt: target, tx: target.x, ty: target.y, sp: 6, dmg: st.dmg, color: def.color, src: t, big: t.level >= 3 });
        break;
      }
      case 'lance': {
        const crit = t.level >= 3 && Math.random() < 0.3;
        this.beams.push({ kind: 'lance', x1: mx, y1: my, x2: target.x, y2: target.y, color: def.color, t: 0, life: 0.22 });
        this.burst(target.x, target.y, '#ffffff', 6, 2);
        this.damage(target, st.dmg * (crit ? 3 : 1), { src: t, pierce: true, crit });
        break;
      }
    }
  }

  updateProj(p, dt) {
    if (p.delay > 0) { p.delay -= dt; return; }
    if (p.tgt && !p.tgt.dead) { p.tx = p.tgt.x; p.ty = p.tgt.y; }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.sp * dt;
    if (d <= step + 0.05) {
      p.dead = true;
      this.impact(p);
      return;
    }
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    if (p.kind !== 'bolt' && Math.random() < dt * 40) {
      this.parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.3, t: 0, color: p.color, size: 0.1, kind: 'glow' });
    }
  }

  impact(p) {
    if (p.kind === 'bolt') {
      if (p.tgt && !p.tgt.dead) this.damage(p.tgt, p.dmg, { src: p.src });
      this.spark(p.tx, p.ty, p.color);
    } else if (p.kind === 'shard') {
      this.ring(p.tx, p.ty, p.color, p.r);
      for (let k = 0; k < 8; k++) this.spark(p.tx, p.ty, '#e6f0ff');
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (dist(e.x, e.y, p.tx, p.ty) <= p.r) {
          this.damage(e, p.dmg, { src: p.src });
          this.applyElement(e, 'frost', p.chill);
        }
      }
    } else if (p.kind === 'orb') {
      const r = p.big ? 1.6 : 1.25;
      this.wells.push({ x: p.tx, y: p.ty, r, t: 0, life: p.big ? 3.0 : 2.2, dps: p.dmg, pull: 1.7, src: p.src, caught: new Set() });
      this.ring(p.tx, p.ty, p.color, r);
    }
  }

  updateWell(w, dt) {
    w.t += dt;
    for (const e of this.enemies) {
      if (e.dead || e.flying) continue;
      const d = dist(e.x, e.y, w.x, w.y);
      if (d > w.r) continue;
      e.inWell = true;
      w.caught.add(e);
      this.damage(e, w.dps * dt, { pierce: true, src: w.src });
      if (d > 0.08) {
        const k = w.pull * dt * (e.def.boss ? 0.25 : 1);
        const nx = e.x + ((w.x - e.x) / d) * Math.min(k, d);
        const ny = e.y + ((w.y - e.y) / d) * Math.min(k, d);
        if (this.isFree(nx, e.y)) e.x = nx;
        if (this.isFree(e.x, ny)) e.y = ny;
      }
    }
    if (Math.random() < dt * 30) {
      const a = Math.random() * TAU;
      this.parts.push({ x: w.x + Math.cos(a) * w.r, y: w.y + Math.sin(a) * w.r, vx: -Math.cos(a) * w.r * 2, vy: -Math.sin(a) * w.r * 2, life: 0.45, t: 0, color: '#d14bff', size: 0.08, kind: 'spark' });
    }
    if (w.t >= w.life) {
      w.dead = true;
      // Implosion: Schaden steigt mit Anzahl gefangener Gegner
      const n = [...w.caught].filter(e => !e.dead).length;
      const dmg = w.dps * 2.2 * (1 + 0.3 * n);
      sfx.implode();
      this.ring(w.x, w.y, '#ff9dff', w.r * 1.2);
      this.burst(w.x, w.y, '#d14bff', 24, 3.5);
      for (const e of this.enemies) if (!e.dead && !e.flying && dist(e.x, e.y, w.x, w.y) <= w.r * 1.1) this.damage(e, dmg, { pierce: true, src: w.src });
      if (n >= 3) this.text(w.x, w.y - 0.3, `Kollaps x${n}`, '#ff9dff', 0.3);
    }
  }

  isFree(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!inB(tx, ty)) return false;
    return this.grid[idx(tx, ty)] === 0;
  }

  // ── Ernte ────────────────────────────────────────────────
  harvestSegment(x0, y0, x1, y1) {
    const R = 0.6;
    const dx = x1 - x0, dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1e-6;
    for (const s of this.shards) {
      if (s.dead) continue;
      let u = ((s.x - x0) * dx + (s.y - y0) * dy) / L2;
      u = clamp(u, 0, 1);
      const px = x0 + dx * u, py = y0 + dy * u;
      if (dist(px, py, s.x, s.y) <= R) this.collect(s, true);
    }
    this.trail.push({ x: x1, y: y1, t: 0 });
  }

  collect(s, manual) {
    s.dead = true;
    let gain;
    if (manual) {
      if (this.time - this.lastHarvest < 0.9) this.combo++;
      else this.combo = 1;
      this.lastHarvest = this.time;
      const mult = Math.min(1.6, 1 + (this.combo - 1) * 0.06);
      gain = Math.max(1, Math.round(s.v * mult));
      sfx.harvest(this.combo);
      this.burst(s.x, s.y, '#ffe23d', 6, 2);
      this.text(s.x, s.y - 0.2, this.combo >= 3 ? `+${gain} ×${mult.toFixed(1)}` : `+${gain}`, '#ffe23d', this.combo >= 3 ? 0.3 : 0.24);
      if (this.combo >= 2) this.emit('combo', this.combo);
    } else {
      gain = Math.max(1, Math.round(s.v * 0.6));
      this.parts.push({ x: s.x, y: s.y, vx: 0, vy: -0.5, life: 0.5, t: 0, color: '#a89a50', size: 0.14, kind: 'glow' });
    }
    this.stats.harvested += gain;
    this.gold += gain;
    this.emit('gold');
  }

  // ── Effekte ──────────────────────────────────────────────
  burst(x, y, color, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = sp * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.4, t: 0, color, size: 0.06 + Math.random() * 0.06, kind: 'spark', drag: 3 });
    }
  }
  spark(x, y, color) {
    const a = Math.random() * TAU, v = 1 + Math.random() * 2;
    this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25, t: 0, color, size: 0.06, kind: 'spark', drag: 4 });
  }
  ring(x, y, color, r) { this.parts.push({ x, y, vx: 0, vy: 0, life: 0.45, t: 0, color, size: r, kind: 'ring' }); }
  text(x, y, text, color, size) { this.texts.push({ x, y, text, color, size, t: 0, life: 1.1 }); }
  arc(x1, y1, x2, y2, color) {
    const pts = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 0.35;
      const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
      pts.push({ x: x1 + (x2 - x1) * u + (nx / l) * j, y: y1 + (y2 - y1) * u + (ny / l) * j });
    }
    this.beams.push({ kind: 'arc', pts, color, t: 0, life: 0.18 });
  }

  // ── Haupt-Update ─────────────────────────────────────────
  update(dt) {
    if (this.state === 'over') { this.updateFx(dt); return; }
    this.time += dt;
    if (this.rift > 0) this.rift -= dt;
    if (this.riftCd > 0) this.riftCd -= dt;

    if (this.state === 'wave') {
      this.waveT += dt;
      while (this.queue.length && this.queue[0].t <= this.waveT) {
        const q = this.queue.shift();
        this.spawnEnemy(q.type, this.spawnActive(q.spawn) ? q.spawn : 0);
      }
      if (!this.queue.length && this.enemies.length === 0) {
        const bonus = 15 + this.wave * 4;
        this.gold += bonus;
        this.state = 'break';
        this.breakT = 12;
        sfx.clear();
        this.emit('waveClear', bonus);
        this.emit('gold');
        if (this.wave === WIN_WAVE && !this.won) { this.won = true; this.emit('win'); }
      }
    } else if (this.state === 'break') {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave();
    }

    // Gegner
    for (const e of this.enemies) e.inWell = false;
    for (const w of this.wells) this.updateWell(w, dt);
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.hit = Math.max(0, e.hit - dt * 6);
      if (e.reactCd > 0) e.reactCd -= dt;
      if (e.vuln > 0) e.vuln -= dt;
      if (e.stun > 0) e.stun -= dt;
      if (e.charge > 0) e.charge -= dt;
      if (e.chill > 0) { e.chill -= dt; if (e.chill <= 0) e.chillAmt = 0; }
      if (e.burn > 0) {
        e.burn -= dt;
        this.damage(e, e.burnDps * dt, { pierce: true });
        if (Math.random() < dt * 6) this.parts.push({ x: e.x + (Math.random() - 0.5) * e.size, y: e.y, vx: 0, vy: -0.8, life: 0.4, t: 0, color: '#ff7a2f', size: 0.08, kind: 'flame' });
        if (e.dead) continue;
      }
      if (e.type === 'phantom') {
        e.phaseT += dt;
        const cyc = e.phaseT % 3.2;
        e.phased = cyc > 2.2;
      }
      if (e.type === 'healer') {
        e.healT -= dt;
        if (e.healT <= 0) {
          e.healT = 1.1;
          let healed = false;
          for (const o of this.enemies) {
            if (o.dead || o === e) continue;
            if (dist(o.x, o.y, e.x, e.y) < 1.7 && o.hp < o.maxhp) {
              o.hp = Math.min(o.maxhp, o.hp + o.maxhp * 0.07);
              healed = true;
            }
          }
          if (healed) this.ring(e.x, e.y, '#5dff8a', 1.7);
        }
      }
      this.moveEnemy(e, dt);
    }

    for (const t of this.towers) this.updateTower(t, dt);
    for (const p of this.projs) this.updateProj(p, dt);

    for (const s of this.shards) {
      if (s.dead) continue;
      s.age += dt;
      if (s.age >= s.life) this.collect(s, false);
    }

    this.updateFx(dt);

    this.enemies = this.enemies.filter(e => !e.dead);
    this.projs = this.projs.filter(p => !p.dead);
    this.wells = this.wells.filter(w => !w.dead);
    this.shards = this.shards.filter(s => !s.dead);
    if (this.time - this.lastHarvest > 0.9 && this.combo) { this.combo = 0; this.emit('combo', 0); }
  }

  updateFx(dt) {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.coreFlash = Math.max(0, this.coreFlash - dt * 2);
    for (const p of this.parts) {
      p.t += dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.parts = this.parts.filter(p => p.t < p.life);
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    for (const b of this.beams) b.t += dt;
    this.beams = this.beams.filter(b => b.t < b.life);
    for (const t of this.texts) t.t += dt;
    this.texts = this.texts.filter(t => t.t < t.life);
    for (const p of this.trail) p.t += dt;
    this.trail = this.trail.filter(p => p.t < 0.25);
  }
}

// ═════════════════════════════════════════════════════════════
//  RENDERING
// ═════════════════════════════════════════════════════════════
const glowCache = new Map();
function glow(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color);
  gr.addColorStop(0.25, hexA(color, 0.55));
  gr.addColorStop(1, hexA(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function poly(ctx, x, y, r, n, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Zeichnet einen Turm. s = Kachelgröße in px. Auch für die Shop-Icons verwendet. */
export function drawTower(ctx, type, x, y, s, angle, level, time, opt = {}) {
  const def = TOWERS[type];
  const col = def.color;
  const heat = opt.heat > 0;
  const oc = opt.oc > 0;
  ctx.save();
  ctx.translate(x, y);

  // Glühen
  ctx.globalCompositeOperation = 'lighter';
  const gs = s * (oc ? 1.9 : 1.3) * (1 + (opt.flash || 0) * 0.5);
  ctx.globalAlpha = heat ? 0.15 : 0.55;
  ctx.drawImage(glow(col), -gs / 2, -gs / 2, gs, gs);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Sockel
  const b = s * 0.42;
  rrect(ctx, -b, -b, b * 2, b * 2, s * 0.14);
  const gr = ctx.createLinearGradient(0, -b, 0, b);
  gr.addColorStop(0, '#1b2350');
  gr.addColorStop(1, '#0a0f2a');
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.strokeStyle = heat ? '#ff6b4a' : hexA(col, 0.85);
  ctx.stroke();
  // Ecken-Akzente
  ctx.fillStyle = hexA(col, 0.5);
  const cs = s * 0.07;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(sx * (b - cs * 1.3) - cs / 2, sy * (b - cs * 1.3) - cs / 2, cs, cs);

  const lw = Math.max(1, s * 0.05);
  ctx.lineWidth = lw;
  ctx.strokeStyle = col;
  ctx.fillStyle = hexA(col, 0.25);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (type) {
    case 'pulse': {
      ctx.rotate(angle);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.2, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.12, 0); ctx.lineTo(s * 0.38, 0); ctx.lineWidth = lw * 2.2; ctx.stroke();
      if (level >= 3) { ctx.beginPath(); ctx.moveTo(s * 0.1, -s * 0.1); ctx.lineTo(s * 0.32, -s * 0.1); ctx.moveTo(s * 0.1, s * 0.1); ctx.lineTo(s * 0.32, s * 0.1); ctx.lineWidth = lw * 1.4; ctx.stroke(); }
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, s * 0.07, 0, TAU); ctx.fill();
      break;
    }
    case 'frost': {
      ctx.rotate(time * 0.6);
      poly(ctx, 0, 0, s * 0.24, 6); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.moveTo(Math.cos(a) * s * 0.1, Math.sin(a) * s * 0.1); ctx.lineTo(Math.cos(a) * s * 0.34, Math.sin(a) * s * 0.34); }
      ctx.stroke();
      ctx.fillStyle = '#ffffff'; poly(ctx, 0, 0, s * 0.08, 6); ctx.fill();
      break;
    }
    case 'flame': {
      const f = 1 + Math.sin(time * 18) * 0.08;
      poly(ctx, 0, s * 0.03, s * 0.27, 3, -Math.PI / 2); ctx.fill(); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath(); ctx.ellipse(0, s * 0.02, s * 0.09 * f, s * 0.14 * f, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(0, s * 0.05, s * 0.04, s * 0.07, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'volt': {
      ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.17, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.rotate(time * 3);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; ctx.moveTo(Math.cos(a) * s * 0.26, Math.sin(a) * s * 0.26); ctx.lineTo(Math.cos(a + 0.3) * s * 0.34, Math.sin(a + 0.3) * s * 0.34); }
      ctx.stroke();
      ctx.rotate(-time * 3);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(-s * 0.03, -s * 0.12); ctx.lineTo(s * 0.06, -s * 0.01); ctx.lineTo(0, 0); ctx.lineTo(s * 0.03, s * 0.12); ctx.lineTo(-s * 0.06, s * 0.01); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      break;
    }
    case 'grav': {
      ctx.fillStyle = '#05010d';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.19, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.rotate(time * 1.5);
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.33, s * 0.11, 0, 0, TAU); ctx.stroke();
      ctx.rotate(Math.PI / 2.5);
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.3, s * 0.09, 0, 0, TAU); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = col;
      const oa = time * 4;
      ctx.beginPath(); ctx.arc(Math.cos(oa) * s * 0.33, Math.sin(oa) * s * 0.11, s * 0.04, 0, TAU); ctx.fill();
      break;
    }
    case 'lance': {
      ctx.rotate(angle);
      poly(ctx, -s * 0.04, 0, s * 0.2, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.05, 0); ctx.lineTo(s * 0.44, 0); ctx.lineWidth = lw * 1.4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.15, -s * 0.07); ctx.lineTo(s * 0.3, -s * 0.07); ctx.moveTo(s * 0.15, s * 0.07); ctx.lineTo(s * 0.3, s * 0.07); ctx.lineWidth = lw; ctx.stroke();
      ctx.fillStyle = '#7df3ff'; ctx.beginPath(); ctx.arc(-s * 0.04, 0, s * 0.06, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();

  // Stufen-Punkte
  if (level > 1) {
    ctx.fillStyle = col;
    for (let i = 0; i < level; i++) {
      const px = x + (i - (level - 1) / 2) * s * 0.16;
      ctx.beginPath(); ctx.arc(px, y + s * 0.34, s * 0.04, 0, TAU); ctx.fill();
    }
  }
  if (oc) {
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + Math.sin(time * 20) * 0.3})`;
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, TAU); ctx.stroke();
  }
}

export function renderBackground(ctx, game, v) {
  const { ts, ox, oy, w, h } = v;
  const gr = ctx.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#0a0b22');
  gr.addColorStop(0.55, '#0d0a26');
  gr.addColorStop(1, '#130a2c');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, w, h);

  // Sterne
  const r = rng(77);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(200,210,255,${0.08 + r() * 0.25})`;
    const sz = r() * 1.6 + 0.4;
    ctx.fillRect(r() * w, r() * h, sz, sz);
  }

  // Spielfeld-Platte
  ctx.save();
  rrect(ctx, ox - 6, oy - 6, COLS * ts + 12, ROWS * ts + 12, 14);
  ctx.fillStyle = 'rgba(20,24,64,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,140,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = ox + x * ts, py = oy + y * ts;
      const g = game.grid[idx(x, y)];
      rrect(ctx, px + 2, py + 2, ts - 4, ts - 4, ts * 0.12);
      ctx.fillStyle = (x + y) % 2 ? 'rgba(90,110,220,0.06)' : 'rgba(90,110,220,0.035)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(130,150,255,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (g === 1) drawRock(ctx, px + ts / 2, py + ts / 2, ts, x * 31 + y * 17);
    }
  }
}

function drawRock(ctx, x, y, s, seed) {
  const r = rng(seed + 5);
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const cx = x + (r() - 0.5) * s * 0.4, cy = y + (r() - 0.5) * s * 0.3 + s * 0.05;
    const h = s * (0.25 + r() * 0.25), wdt = s * (0.1 + r() * 0.08);
    const tilt = (r() - 0.5) * 0.6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(0, -h); ctx.lineTo(wdt, -h * 0.55); ctx.lineTo(wdt * 0.8, h * 0.4); ctx.lineTo(-wdt * 0.8, h * 0.4); ctx.lineTo(-wdt, -h * 0.55); ctx.closePath();
    const g = ctx.createLinearGradient(-wdt, 0, wdt, 0);
    g.addColorStop(0, '#2a2560'); g.addColorStop(0.5, '#4b3f9a'); g.addColorStop(1, '#1a1640');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(170,150,255,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(0, h * 0.4); ctx.strokeStyle = 'rgba(200,190,255,0.18)'; ctx.stroke();
    ctx.restore();
  }
}

function drawEnemyShape(ctx, e, s, time) {
  const def = e.def;
  const r = e.size * s;
  const col = def.color;
  ctx.lineWidth = Math.max(1.2, s * 0.05);
  ctx.strokeStyle = e.hit > 0 ? '#ffffff' : col;
  ctx.fillStyle = e.hit > 0 ? 'rgba(255,255,255,0.6)' : hexA(col, 0.28);
  ctx.lineJoin = 'round';
  switch (def.shape) {
    case 'tri': ctx.rotate(e.dir); poly(ctx, 0, 0, r, 3); break;
    case 'dart':
      ctx.rotate(e.dir);
      ctx.beginPath(); ctx.moveTo(r * 1.3, 0); ctx.lineTo(-r, -r * 0.8); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r, r * 0.8); ctx.closePath();
      break;
    case 'dot': ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); break;
    case 'hex': ctx.rotate(time * 0.5); poly(ctx, 0, 0, r, 6); break;
    case 'diamond': ctx.rotate(e.dir); poly(ctx, 0, 0, r, 4); break;
    case 'wing': {
      ctx.rotate(e.dir);
      const f = Math.sin(time * 10 + e.wob) * 0.25;
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.6, -r * (1.1 + f)); ctx.lineTo(-r * 0.2, 0); ctx.lineTo(-r * 0.6, r * (1.1 + f)); ctx.closePath();
      break;
    }
    case 'ghost': {
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r, Math.PI, 0);
      for (let i = 0; i <= 4; i++) { const px = r - (i / 4) * r * 2; ctx.lineTo(px, r * 0.8 + Math.sin(time * 8 + i) * r * 0.15); }
      ctx.closePath();
      break;
    }
    case 'cross': {
      const a = r * 0.38;
      ctx.beginPath();
      ctx.moveTo(-a, -r); ctx.lineTo(a, -r); ctx.lineTo(a, -a); ctx.lineTo(r, -a); ctx.lineTo(r, a); ctx.lineTo(a, a); ctx.lineTo(a, r); ctx.lineTo(-a, r); ctx.lineTo(-a, a); ctx.lineTo(-r, a); ctx.lineTo(-r, -a); ctx.lineTo(-a, -a); ctx.closePath();
      break;
    }
    case 'star': {
      ctx.rotate(time * 0.4);
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, rr = i % 2 ? r * 0.62 : r; i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath();
      break;
    }
  }
  ctx.fill();
  ctx.stroke();
  if (def.boss) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, TAU); ctx.fill(); }
}

export function renderGame(ctx, game, v, ui) {
  const { ts, ox, oy } = v;
  const T = game.time;
  const X = x => ox + x * ts;
  const Y = y => oy + y * ts;

  // Pfad-Vorschau (fließende Punkte)
  const paths = (ui.preview && ui.preview.paths) || game.paths;
  ctx.save();
  for (let k = 0; k < paths.length; k++) {
    const p = paths[k];
    if (!p.pts.length) continue;
    const active = p.active;
    ctx.beginPath();
    p.pts.forEach((pt, i) => (i ? ctx.lineTo(X(pt.x), Y(pt.y)) : ctx.moveTo(X(pt.x), Y(pt.y))));
    ctx.strokeStyle = ui.preview ? (ui.preview.ok ? 'rgba(93,255,138,0.28)' : 'rgba(255,45,85,0.3)') : (active ? 'rgba(255,61,127,0.16)' : 'rgba(150,150,200,0.07)');
    ctx.lineWidth = ts * 0.32;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.setLineDash([2, ts * 0.45]);
    ctx.lineDashOffset = -T * ts * 1.4;
    ctx.strokeStyle = active ? 'rgba(255,140,190,0.55)' : 'rgba(180,180,220,0.18)';
    ctx.lineWidth = ts * 0.08;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // Portale
  SPAWNS.forEach((s, k) => {
    const x = X(s.x + 0.5), y = Y(s.y + 0.5);
    const active = game.spawnActive(k);
    ctx.save();
    ctx.translate(x, y);
    if (active) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7;
      ctx.drawImage(glow('#ff3dd1'), -ts, -ts, ts * 2, ts * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 3; i++) {
        ctx.rotate(T * (1 + i * 0.5));
        ctx.strokeStyle = hexA(i === 1 ? '#7d5cff' : '#ff3dd1', 0.8 - i * 0.2);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, ts * (0.38 - i * 0.09), 0, Math.PI * 1.3); ctx.stroke();
      }
      ctx.fillStyle = '#ffd0f4';
      ctx.beginPath(); ctx.arc(0, 0, ts * 0.06, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(160,150,200,0.35)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, ts * 0.34, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(200,190,255,0.55)';
      ctx.font = `700 ${Math.round(ts * 0.22)}px Orbitron, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('W' + s.opensAt, 0, 0);
    }
    ctx.restore();
  });

  // Kern
  {
    const x = X(CORE.x + 0.5), y = Y(CORE.y + 0.5);
    const hurt = game.coreFlash;
    const col = hurt > 0.1 ? '#ff2d55' : '#7df3ff';
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    const gs = ts * (1.8 + Math.sin(T * 2) * 0.15);
    ctx.drawImage(glow(col), -gs / 2, -gs / 2, gs, gs);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, ts * 0.44, 0, TAU); ctx.stroke();
    ctx.rotate(T * 0.8);
    poly(ctx, 0, 0, ts * 0.3, 3);
    ctx.fillStyle = 'rgba(125,243,255,0.18)'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.rotate(-T * 1.6);
    poly(ctx, 0, 0, ts * 0.2, 3, Math.PI);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  // Resonanz-Verbindungen
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [a, b] of game.links) {
    const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y);
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, hexA(TOWERS[a.type].color, 0.55));
    g.addColorStop(1, hexA(TOWERS[b.type].color, 0.55));
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(2, ts * 0.07) * (0.8 + Math.sin(T * 4 + a.id) * 0.2);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const u = (T * 0.8 + a.id * 0.37) % 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ax + (bx - ax) * u, ay + (by - ay) * u, ts * 0.045, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // Schwerkraftbrunnen
  for (const w of game.wells) {
    const x = X(w.x), y = Y(w.y), r = w.r * ts;
    const k = Math.min(1, w.t * 4) * (1 - Math.max(0, (w.t - w.life + 0.3) / 0.3));
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(10,0,20,0.85)');
    g.addColorStop(0.5, 'rgba(120,30,180,0.25)');
    g.addColorStop(1, 'rgba(209,75,255,0)');
    ctx.globalAlpha = k;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(230,140,255,0.7)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.rotate(-T * 3);
      ctx.beginPath(); ctx.arc(0, 0, r * (0.35 + i * 0.22), 0, Math.PI * 0.9); ctx.stroke();
    }
    ctx.restore();
  }

  // Splitter (Energie)
  for (const s of game.shards) {
    const x = X(s.x), y = Y(s.y + Math.sin(T * 4 + s.bob) * 0.05);
    const fade = s.age > s.life - 1.5 ? (Math.sin(T * 20) > 0 ? 0.4 : 1) : 1;
    const sc = Math.min(1, s.age * 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = fade;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glow('#ffe23d'), -ts * 0.4, -ts * 0.4, ts * 0.8, ts * 0.8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(T * 2 + s.bob);
    ctx.scale(sc, sc);
    poly(ctx, 0, 0, ts * 0.12, 4);
    ctx.fillStyle = '#fff6b0'; ctx.fill();
    ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  // Gegner
  for (const e of game.enemies) {
    const x = X(e.x), y = Y(e.y);
    const r = e.size * ts;
    ctx.save();
    ctx.translate(x, y);
    if (e.flying) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(r * 0.3, r * 0.9, r * 0.8, r * 0.3, 0, 0, TAU); ctx.fill();
      ctx.translate(0, -r * 0.3);
    }
    ctx.globalAlpha = e.phased ? 0.25 : 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glow(e.def.color), -r * 2, -r * 2, r * 4, r * 4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    drawEnemyShape(ctx, e, ts, T);
    ctx.restore();
    // Status
    if (e.chill > 0) {
      ctx.strokeStyle = 'rgba(160,200,255,0.9)'; ctx.lineWidth = 1.5;
      poly(ctx, 0, 0, r * 1.35, 6, T); ctx.stroke();
    }
    if (e.charge > 0) {
      ctx.strokeStyle = '#ffe23d'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const a = T * 9 + i * 2.1; ctx.moveTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1); ctx.lineTo(Math.cos(a + 0.4) * r * 1.5, Math.sin(a + 0.4) * r * 1.5); }
      ctx.stroke();
    }
    if (e.stun > 0) {
      ctx.fillStyle = 'rgba(210,250,255,0.55)';
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      poly(ctx, 0, 0, r * 1.3, 4, Math.PI / 4); ctx.fill(); ctx.stroke();
    }
    if (e.vuln > 0) {
      ctx.strokeStyle = 'rgba(255,90,60,0.85)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    // Lebensbalken
    if (e.hp < e.maxhp) {
      const bw = Math.max(ts * 0.5, r * 2.2), bh = Math.max(3, ts * 0.07);
      const by = -r - ts * 0.18;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-bw / 2, by, bw, bh);
      const k = clamp(e.hp / e.maxhp, 0, 1);
      ctx.fillStyle = k > 0.5 ? '#5dff8a' : k > 0.25 ? '#ffe23d' : '#ff2d55';
      ctx.fillRect(-bw / 2, by, bw * k, bh);
    }
    ctx.restore();
  }

  // Türme
  for (const t of game.towers) {
    drawTower(ctx, t.type, X(t.x), Y(t.y), ts, t.angle, t.level, T + t.id, { oc: t.oc, heat: t.heat, flash: t.flash });
    if (t.heat > 0) {
      ctx.fillStyle = 'rgba(255,60,40,0.18)';
      ctx.fillRect(X(t.cx) + 3, Y(t.cy) + 3, ts - 6, ts - 6);
    }
  }

  // Projektile
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of game.projs) {
    if (p.delay > 0) continue;
    const x = X(p.x), y = Y(p.y);
    const sz = p.kind === 'orb' ? ts * 0.7 : p.kind === 'shard' ? ts * 0.45 : ts * 0.35;
    ctx.drawImage(glow(p.color), x - sz / 2, y - sz / 2, sz, sz);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, p.kind === 'orb' ? ts * 0.08 : ts * 0.045, 0, TAU); ctx.fill();
  }
  // Strahlen
  for (const b of game.beams) {
    const k = 1 - b.t / b.life;
    ctx.strokeStyle = hexA(b.color === '#f4f7ff' ? '#7df3ff' : b.color, k);
    ctx.lineCap = 'round';
    if (b.kind === 'lance') {
      ctx.lineWidth = ts * 0.14 * k;
      ctx.beginPath(); ctx.moveTo(X(b.x1), Y(b.y1)); ctx.lineTo(X(b.x2), Y(b.y2)); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${k})`;
      ctx.lineWidth = ts * 0.04;
      ctx.stroke();
    } else {
      ctx.lineWidth = ts * 0.06;
      ctx.beginPath();
      b.pts.forEach((pt, i) => (i ? ctx.lineTo(X(pt.x), Y(pt.y)) : ctx.moveTo(X(pt.x), Y(pt.y))));
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${k})`;
      ctx.lineWidth = ts * 0.02;
      ctx.stroke();
    }
  }
  // Partikel
  for (const p of game.parts) {
    const k = 1 - p.t / p.life;
    const x = X(p.x), y = Y(p.y);
    if (p.kind === 'ring') {
      ctx.strokeStyle = hexA(p.color, k * 0.9);
      ctx.lineWidth = Math.max(1, ts * 0.06 * k);
      ctx.beginPath(); ctx.arc(x, y, ts * p.size * (0.3 + (1 - k) * 0.9), 0, TAU); ctx.stroke();
    } else if (p.kind === 'smoke') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(90,90,110,${k * 0.4})`;
      ctx.beginPath(); ctx.arc(x, y, ts * p.size * (2 - k), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
    } else {
      const sz = ts * p.size * (p.kind === 'flame' ? 2.6 * k + 0.5 : 2.2) * (p.kind === 'glow' ? k : 1);
      ctx.globalAlpha = k;
      ctx.drawImage(glow(p.color), x - sz, y - sz, sz * 2, sz * 2);
      ctx.globalAlpha = 1;
    }
  }
  // Wisch-Spur
  if (game.trail.length > 1) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < game.trail.length; i++) {
      const a = game.trail[i - 1], b = game.trail[i];
      const k = 1 - b.t / 0.25;
      ctx.strokeStyle = `rgba(255,226,61,${k * 0.8})`;
      ctx.lineWidth = ts * 0.12 * k;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
    }
  }
  ctx.restore();

  // Auswahl & Vorschau
  if (ui.selected) {
    const t = ui.selected;
    const st = game.towerStats(t);
    rangeCircle(ctx, X(t.x), Y(t.y), st.range * ts, TOWERS[t.type].color, T);
  }
  if (ui.ghost) {
    const gx = ui.ghost.x, gy = ui.ghost.y;
    const def = TOWERS[ui.ghost.type];
    const ok = ui.preview && ui.preview.ok && game.gold >= def.cost;
    rangeCircle(ctx, X(gx + 0.5), Y(gy + 0.5), def.range * ts, ok ? def.color : '#ff2d55', T);
    ctx.globalAlpha = 0.65;
    drawTower(ctx, ui.ghost.type, X(gx + 0.5), Y(gy + 0.5), ts, -Math.PI / 2, 1, T);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#5dff8a' : '#ff2d55';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -T * 20;
    rrect(ctx, X(gx) + 1, Y(gy) + 1, ts - 2, ts - 2, ts * 0.14);
    ctx.stroke();
    ctx.setLineDash([]);
    // Resonanz-Vorschau
    if (ok && ui.preview.resonance > 0) {
      for (const o of game.towers) {
        if (Math.abs(o.cx - gx) <= 1 && Math.abs(o.cy - gy) <= 1 && o.type !== ui.ghost.type) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(X(gx + 0.5), Y(gy + 0.5)); ctx.lineTo(X(o.x), Y(o.y)); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  // Zeitriss-Overlay
  if (game.rift > 0) {
    const k = Math.min(1, game.rift, (RIFT_DURATION - game.rift) * 3);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, COLS * ts, ROWS * ts); ctx.clip();
    ctx.globalAlpha = 0.22 * k;
    ctx.fillStyle = '#6a2cff';
    ctx.fillRect(ox, oy, COLS * ts, ROWS * ts);
    ctx.globalAlpha = 0.5 * k;
    ctx.strokeStyle = '#c9a8ff';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const rr = ((T * 0.6 + i / 4) % 1) * ts * 9;
      ctx.beginPath(); ctx.arc(X(CORE.x + 0.5), Y(CORE.y + 0.5), rr, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  // Texte
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of game.texts) {
    const k = t.t / t.life;
    const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const pop = k < 0.12 ? 0.6 + k / 0.12 * 0.5 : 1.1 - Math.min(0.1, (k - 0.12));
    ctx.font = `800 ${Math.round(ts * t.size * pop)}px Orbitron, system-ui, sans-serif`;
    const x = X(t.x), y = Y(t.y - k * 0.6);
    ctx.globalAlpha = a;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,6,20,0.85)';
    ctx.strokeText(t.text, x, y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, x, y);
  }
  ctx.restore();
}

function rangeCircle(ctx, x, y, r, col, T) {
  ctx.save();
  ctx.fillStyle = hexA(col, 0.07);
  ctx.strokeStyle = hexA(col, 0.6);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = T * 12;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.restore();
}
