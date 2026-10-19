// ─────────────────────────────────────────────────────────────
//  PRISMA – Spieldaten: Türme, Gegner, Reaktionen, Wellen
// ─────────────────────────────────────────────────────────────

export const COLS = 9;
export const ROWS = 13;

export const CORE = { x: 4, y: 12 };
export const SPAWNS = [
  { x: 4, y: 0, opensAt: 1 },
  { x: 0, y: 5, opensAt: 12 },
];

export const START_GOLD = 200;
export const START_LIVES = 20;
export const MAX_LEVEL = 3;

// Multiplikatoren pro Stufe
export const LVL_DMG = [1, 1.75, 3.0];
export const LVL_RANGE = [0, 0.3, 0.6];
export const LVL_RATE = [1, 1.15, 1.35];

export const TOWERS = {
  pulse: {
    name: 'Puls', el: 'kinetik', color: '#3df5ff', cost: 50,
    range: 2.6, rate: 2.2, dmg: 8, air: true,
    blurb: 'Schnelle Energiebolzen. Zuverlässig gegen alles.',
    special: 'Stufe 3: Doppelschuss',
  },
  frost: {
    name: 'Frost', el: 'frost', color: '#9fc4ff', cost: 70,
    range: 2.3, rate: 0.95, dmg: 5, air: true,
    blurb: 'Eissplitter mit Flächenschaden. Verlangsamt Gegner.',
    special: 'Stufe 3: größerer Radius, stärkere Kälte',
  },
  flame: {
    name: 'Glut', el: 'feuer', color: '#ff7a2f', cost: 90,
    range: 1.75, rate: 4, dmg: 2.4, air: false,
    blurb: 'Verbrennt alle Bodengegner in der Nähe.',
    special: 'Stufe 3: doppelte Brandwirkung',
  },
  volt: {
    name: 'Volt', el: 'blitz', color: '#ffe23d', cost: 110,
    range: 2.8, rate: 0.9, dmg: 15, air: true,
    blurb: 'Kettenblitz springt auf bis zu 3 Gegner.',
    special: 'Stufe 3: springt auf 5 Gegner',
  },
  grav: {
    name: 'Vortex', el: 'gravitation', color: '#d14bff', cost: 140,
    range: 2.7, rate: 0.28, dmg: 7, air: false,
    blurb: 'Schwerkraftbrunnen bündelt und bremst Gegner, dann implodiert er – je mehr gefangen, desto härter.',
    special: 'Stufe 3: größerer, längerer Brunnen',
  },
  lance: {
    name: 'Lanze', el: 'kinetik', color: '#f4f7ff', cost: 160,
    range: 4.6, rate: 0.5, dmg: 55, air: true,
    blurb: 'Präziser Strahl über große Distanz. Ignoriert Panzerung.',
    special: 'Stufe 3: 30% Chance auf kritischen Treffer (x3)',
  },
};
export const TOWER_ORDER = ['pulse', 'frost', 'flame', 'volt', 'grav', 'lance'];

export function upgradeCost(type, level) {
  const c = TOWERS[type].cost;
  return level === 1 ? Math.round(c * 0.9) : Math.round(c * 1.6);
}

export const ENEMIES = {
  runner:   { name: 'Läufer',   hp: 22,  speed: 1.25, bounty: 4,   armor: 0, size: 0.26, color: '#ff3d7f', shape: 'tri',     leak: 1 },
  swift:    { name: 'Flitzer',  hp: 13,  speed: 2.2,  bounty: 3,   armor: 0, size: 0.21, color: '#ff9de0', shape: 'dart',    leak: 1 },
  swarm:    { name: 'Schwarm',  hp: 7,   speed: 1.6,  bounty: 1,   armor: 0, size: 0.15, color: '#ffb3c6', shape: 'dot',     leak: 1 },
  tank:     { name: 'Panzer',   hp: 95,  speed: 0.7,  bounty: 10,  armor: 3, size: 0.38, color: '#ff5a3d', shape: 'hex',     leak: 2 },
  splitter: { name: 'Splitter', hp: 48,  speed: 1.0,  bounty: 5,   armor: 0, size: 0.32, color: '#ff6bd5', shape: 'diamond', leak: 2 },
  glider:   { name: 'Gleiter',  hp: 30,  speed: 1.05, bounty: 6,   armor: 0, size: 0.28, color: '#7dffb3', shape: 'wing',    leak: 1, flying: true },
  phantom:  { name: 'Phantom',  hp: 42,  speed: 1.3,  bounty: 6,   armor: 0, size: 0.28, color: '#b9a7ff', shape: 'ghost',   leak: 1 },
  healer:   { name: 'Heiler',   hp: 60,  speed: 0.95, bounty: 8,   armor: 1, size: 0.30, color: '#5dff8a', shape: 'cross',   leak: 1 },
  boss:     { name: 'Koloss',   hp: 950, speed: 0.48, bounty: 120, armor: 6, size: 0.58, color: '#ff2d55', shape: 'star',    leak: 10, boss: true },
};

export const REACTIONS = {
  thermo: { name: 'Thermoschock', color: '#ffb36b', combo: 'Frost + Glut',
    desc: 'Heftiger Burst-Schaden. Der Gegner wird brüchig und erleidet 30% mehr Schaden.' },
  super:  { name: 'Supraleiter',  color: '#9ff7ff', combo: 'Frost + Volt',
    desc: 'Der Gegner gefriert kurz komplett (Betäubung).' },
  plasma: { name: 'Plasma',       color: '#ff8af3', combo: 'Glut + Volt',
    desc: 'Explosion, die alle Gegner im Umkreis trifft.' },
};

// HP-Skalierung je Welle
export function hpMul(n) {
  const k = n - 1;
  return (1 + 0.15 * k) * (1 + 0.0032 * k * k);
}
export function bountyMul(n) { return 1 + 0.035 * (n - 1); }
export function reactionBase(n) { return 11 * Math.pow(hpMul(n), 0.8); }

// Deterministischer Zufall
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNLOCK = { runner: 1, swift: 2, swarm: 3, tank: 5, splitter: 7, glider: 8, phantom: 10, healer: 13 };
const WEIGHT = { runner: 1, swift: 0.7, swarm: 0.33, tank: 3, splitter: 2.2, glider: 1.6, phantom: 1.8, healer: 2.6 };
const GAP = { runner: 0.75, swift: 0.5, swarm: 0.22, tank: 1.5, splitter: 1.1, glider: 0.9, phantom: 0.9, healer: 1.3 };

/** Liefert die Spawn-Liste einer Welle: [{type, t, spawn}] */
export function buildWave(n, seed = 1) {
  const r = rng(n * 7919 + seed * 104729);
  const out = [];
  const pool = Object.keys(UNLOCK).filter(k => UNLOCK[k] <= n);
  const twoPortals = n >= SPAWNS[1].opensAt;
  let t = 0;

  if (n === 1) {
    for (let i = 0; i < 8; i++) out.push({ type: 'runner', t: i * 1.0, spawn: 0 });
    return out;
  }

  const groups = 2 + (n > 6 ? 1 : 0) + (n > 16 ? 1 : 0);
  const budget = 9 + n * 2.3;
  for (let g = 0; g < groups; g++) {
    // neue Gegnertypen bevorzugt in der Welle ihrer Einführung zeigen
    let type = pool[Math.floor(r() * pool.length)];
    const fresh = pool.find(k => UNLOCK[k] === n);
    if (fresh && g === 0) type = fresh;
    const count = Math.max(2, Math.round(budget / groups / WEIGHT[type]));
    const gap = GAP[type] / (1 + n * 0.015);
    const spawn = twoPortals && r() < 0.5 ? 1 : 0;
    for (let i = 0; i < count; i++) out.push({ type, t: t + i * gap, spawn });
    t += count * gap * (n > 10 ? 0.55 : 0.8) + 1.2;
  }

  if (n % 10 === 0) {
    const bosses = Math.floor(n / 10);
    for (let b = 0; b < bosses; b++) out.push({ type: 'boss', t: t + 1 + b * 4, spawn: b % (twoPortals ? 2 : 1) });
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

export const WIN_WAVE = 30;
