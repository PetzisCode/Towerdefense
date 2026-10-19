// Kleiner Synthesizer für Soundeffekte (WebAudio, keine Dateien nötig)

let ctx = null;
let master = null;
let muted = false;
const last = {};

try { muted = localStorage.getItem('prisma.muted') === '1'; } catch (e) { /* ignorieren */ }

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.22;
  master.connect(ctx.destination);
  // iOS: stillen Puffer abspielen, um Audio freizuschalten
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b; s.connect(master); s.start(0);
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('prisma.muted', m ? '1' : '0'); } catch (e) { /* ignorieren */ }
  if (master) master.gain.value = m ? 0 : 0.22;
}

function tone({ f = 440, f2 = null, d = 0.1, type = 'sine', v = 0.5, delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + d);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + d + 0.02);
}

function noise(d = 0.2, v = 0.3, hp = 400) {
  if (!ctx || muted) return;
  const len = Math.floor(ctx.sampleRate * d);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass'; filt.frequency.value = hp;
  const g = ctx.createGain(); g.gain.value = v;
  s.connect(filt); filt.connect(g); g.connect(master);
  s.start();
}

function throttle(key, ms) {
  const now = performance.now();
  if (last[key] && now - last[key] < ms) return false;
  last[key] = now;
  return true;
}

export const sfx = {
  shoot(kind) {
    if (!throttle('shoot' + kind, 70)) return;
    switch (kind) {
      case 'pulse': tone({ f: 880, f2: 520, d: 0.06, type: 'square', v: 0.07 }); break;
      case 'frost': tone({ f: 1500, f2: 900, d: 0.12, type: 'triangle', v: 0.12 }); break;
      case 'volt': tone({ f: 200, f2: 1200, d: 0.09, type: 'sawtooth', v: 0.07 }); noise(0.06, 0.08, 2000); break;
      case 'grav': tone({ f: 120, f2: 60, d: 0.35, type: 'sine', v: 0.25 }); break;
      case 'lance': tone({ f: 2400, f2: 300, d: 0.18, type: 'sawtooth', v: 0.07 }); break;
      case 'flame': if (throttle('flame2', 260)) noise(0.12, 0.05, 800); break;
    }
  },
  kill() { if (throttle('kill', 40)) tone({ f: 600, f2: 160, d: 0.12, type: 'triangle', v: 0.12 }); },
  harvest(combo) {
    if (!throttle('harv', 30)) return;
    const f = 660 * Math.pow(2, Math.min(combo, 12) / 12);
    tone({ f, d: 0.12, type: 'sine', v: 0.18 });
    tone({ f: f * 1.5, d: 0.1, type: 'sine', v: 0.08, delay: 0.03 });
  },
  reaction(kind) {
    if (!throttle('react', 90)) return;
    const base = kind === 'thermo' ? 330 : kind === 'super' ? 523 : 392;
    tone({ f: base, d: 0.3, type: 'triangle', v: 0.16 });
    tone({ f: base * 1.26, d: 0.3, type: 'triangle', v: 0.12, delay: 0.04 });
    tone({ f: base * 1.5, d: 0.35, type: 'triangle', v: 0.1, delay: 0.08 });
  },
  build() { tone({ f: 300, f2: 600, d: 0.12, type: 'square', v: 0.08 }); tone({ f: 900, d: 0.08, type: 'sine', v: 0.1, delay: 0.08 }); },
  upgrade() { [523, 659, 784, 1046].forEach((f, i) => tone({ f, d: 0.12, type: 'triangle', v: 0.12, delay: i * 0.05 })); },
  sell() { tone({ f: 700, f2: 250, d: 0.2, type: 'triangle', v: 0.12 }); },
  error() { tone({ f: 150, d: 0.15, type: 'square', v: 0.08 }); },
  leak() { tone({ f: 90, f2: 40, d: 0.4, type: 'sawtooth', v: 0.2 }); noise(0.25, 0.15, 100); },
  wave() { [392, 523, 659].forEach((f, i) => tone({ f, d: 0.25, type: 'sawtooth', v: 0.05, delay: i * 0.09 })); },
  clear() { [659, 784, 988, 1318].forEach((f, i) => tone({ f, d: 0.2, type: 'triangle', v: 0.1, delay: i * 0.07 })); },
  overcharge() { tone({ f: 200, f2: 1600, d: 0.4, type: 'sawtooth', v: 0.08 }); },
  rift() { tone({ f: 800, f2: 100, d: 0.8, type: 'sine', v: 0.25 }); tone({ f: 1200, f2: 150, d: 0.8, type: 'triangle', v: 0.1 }); },
  implode() { if (throttle('imp', 120)) { tone({ f: 60, f2: 300, d: 0.25, type: 'sine', v: 0.3 }); noise(0.15, 0.12, 300); } },
  boss() { tone({ f: 70, d: 1.0, type: 'sawtooth', v: 0.18 }); tone({ f: 73, d: 1.0, type: 'sawtooth', v: 0.18 }); },
};
