// Alle geluiden en muziek worden live gesynthetiseerd met de Web Audio API
// (geen geluidsbestanden nodig, werkt offline en in de app).
let ctx = null;
let master;
let sfxBus;
let musicBus;
let ambBus;
let noise;
let reverb;
const vols = { master: 0.8, music: 0.5, sfx: 0.9 };

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    // lichte compressie zodat kanonnen niet clippen
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(master);
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    ambBus = ctx.createGain();
    sfxBus.connect(comp);
    musicBus.connect(comp);
    ambBus.connect(comp);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // eenvoudige galm voor kanonnen en instortingen
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    const rg = ctx.createGain();
    rg.gain.value = 0.35;
    reverb.connect(rg).connect(comp);
    applyVolumes();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setVolumes(v) {
  Object.assign(vols, v);
  applyVolumes();
}
function applyVolumes() {
  if (!ctx) return;
  master.gain.value = vols.master;
  sfxBus.gain.value = vols.sfx;
  musicBus.gain.value = vols.music * 0.5;
  ambBus.gain.value = vols.sfx * 0.6;
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function nz(t, dur, freq, q, vol, type = 'lowpass', out = sfxBus, wet = 0) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.004, vol, dur);
  src.connect(f).connect(g).connect(out);
  if (wet) {
    const wg = ctx.createGain();
    wg.gain.value = wet;
    g.connect(wg).connect(reverb);
  }
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.1);
  return f;
}

function tone(t, type, f0, f1, dur, vol, out = sfxBus, attack = 0.004) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, attack, vol, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + attack + 0.05);
  return o;
}

// beperkt het aantal gelijktijdige geluiden per soort
const last = {};
function gate(key, minGap) {
  const t = ctx.currentTime;
  if (last[key] && t - last[key] < minGap) return false;
  last[key] = t;
  return true;
}

const ok = (v) => ctx && v > 0.02;

export const sfx = {
  shot(w, v, player) {
    if (!ok(v)) return;
    const t = ctx.currentTime;
    if (!player && !gate('shot' + w.proj, w.kind === 'siege' ? 0 : 0.04)) return;
    switch (w.proj) {
      case 'arrow':
        tone(t, 'triangle', 190, 75, 0.15, 0.35 * v);
        nz(t + 0.02, 0.22, 5200, 1.2, 0.1 * v, 'highpass');
        break;
      case 'bolt':
        tone(t, 'square', 140, 60, 0.07, 0.2 * v);
        nz(t, 0.06, 2600, 2, 0.4 * v, 'bandpass');
        tone(t + 0.01, 'triangle', 380, 110, 0.12, 0.25 * v);
        break;
      case 'bullet':
        nz(t, 0.5, 1700, 0.7, 0.85 * v, 'lowpass', sfxBus, 0.5 * v);
        nz(t, 1.1, 360, 0.5, 0.6 * v);
        tone(t, 'sine', 110, 32, 0.35, 0.75 * v);
        break;
      case 'javelin':
        nz(t, 0.3, 900, 2, 0.25 * v, 'bandpass');
        break;
      case 'cannonball':
        nz(t, 2.8, 220, 0.6, 1.0 * v, 'lowpass', sfxBus, 0.8 * v);
        nz(t, 0.7, 1300, 0.5, 0.7 * v);
        tone(t, 'sine', 70, 22, 1.4, 1.0 * v);
        break;
      case 'stone':
        tone(t, 'sawtooth', 70, 40, 0.4, 0.15 * v);
        nz(t + 0.1, 0.8, 500, 1.5, 0.3 * v, 'bandpass');
        break;
      default:
        break;
    }
  },
  swing(w, v) {
    if (!ok(v) || !gate('swing', 0.05)) return;
    const t = ctx.currentTime;
    const f = nz(t, 0.2, 600, 3, 0.3 * v, 'bandpass');
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(w.dmg === 'blunt' ? 1200 : 2600, t + 0.16);
  },
  clash(v) {
    if (!ok(v) || !gate('clash', 0.05)) return;
    const t = ctx.currentTime;
    const base = 900 + Math.random() * 700;
    for (const k of [1, 1.51, 2.37, 3.3]) tone(t, 'sine', base * k, base * k * 0.985, 0.45, 0.07 * v);
    nz(t, 0.04, 6000, 1, 0.25 * v, 'highpass');
  },
  flesh(v) {
    if (!ok(v) || !gate('flesh', 0.04)) return;
    const t = ctx.currentTime;
    nz(t, 0.12, 500, 1, 0.45 * v);
    tone(t, 'sine', 150, 60, 0.12, 0.3 * v);
  },
  hurt() {
    if (!ctx) return;
    const t = ctx.currentTime;
    nz(t, 0.15, 600, 1, 0.5);
    tone(t, 'sawtooth', 170, 85, 0.2, 0.12);
  },
  hit(head) {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 'square', head ? 1800 : 1300, head ? 1200 : 850, 0.06, 0.1);
  },
  charge(v) {
    if (!ok(v)) return;
    nz(ctx.currentTime, 0.3, 300, 1, 0.6 * v, 'lowpass', sfxBus, 0.2);
  },
  thunk(v) {
    if (!ok(v) || !gate('thunk', 0.03)) return;
    const t = ctx.currentTime;
    tone(t, 'square', 320, 120, 0.05, 0.1 * v);
    nz(t, 0.07, 1200, 1, 0.2 * v);
  },
  impact(v, big) {
    if (!ok(v)) return;
    const t = ctx.currentTime;
    nz(t, big ? 2.2 : 1.5, 380, 0.6, 0.9 * v, 'lowpass', sfxBus, 0.7 * v);
    tone(t, 'sine', 60, 25, 0.9, 0.8 * v);
    nz(t + 0.05, 0.9, 2500, 0.8, 0.25 * v, 'bandpass');
  },
  gateHit(v) {
    if (!ok(v) || !gate('gate', 0.25)) return;
    const t = ctx.currentTime;
    tone(t, 'sine', 95, 45, 0.35, 0.6 * v);
    nz(t, 0.25, 700, 1, 0.5 * v, 'lowpass', sfxBus, 0.3 * v);
  },
  collapse(v) {
    if (!ok(v)) return;
    const t = ctx.currentTime;
    nz(t, 3.5, 260, 0.5, 1.0 * v, 'lowpass', sfxBus, 0.9 * v);
    for (let k = 0; k < 8; k++) nz(t + k * 0.2 + Math.random() * 0.2, 0.4, 900 + Math.random() * 900, 1, 0.35 * v, 'bandpass');
    tone(t, 'sine', 50, 20, 2.5, 0.8 * v);
  },
  greekFire(v) {
    if (!ok(v)) return;
    const t = ctx.currentTime;
    nz(t, 1.3, 1100, 0.4, 0.55 * v, 'lowpass');
    nz(t, 1.2, 3500, 0.5, 0.2 * v, 'highpass');
  },
  death(v) {
    if (!ok(v) || !gate('death', 0.15)) return;
    const t = ctx.currentTime;
    // korte schreeuw (gefilterde zaagtand met formant)
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 140 + Math.random() * 90;
    o.frequency.setValueAtTime(f0 * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.45);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 300;
    bp.Q.value = 3;
    const g = ctx.createGain();
    env(g, t, 0.02, 0.18 * v, 0.45);
    o.connect(bp).connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + 0.6);
  },
  // strijdkreet: koor van stemmen met klinkerformanten
  warCry(faction, v) {
    if (!ok(v)) return;
    const t = ctx.currentTime;
    const formants = faction === 'ottoman' || faction === 'serbia' ? [[730, 1090], [270, 2290]] : [[570, 840], [730, 1090]];
    for (let k = 0; k < 9; k++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 110 + Math.random() * 70;
      const st = t + Math.random() * 0.25;
      o.frequency.setValueAtTime(f0, st);
      o.frequency.linearRampToValueAtTime(f0 * 1.25, st + 0.5);
      o.frequency.linearRampToValueAtTime(f0 * 1.1, st + 1.6);
      const g = ctx.createGain();
      env(g, st, 0.15, 0.05 * v, 1.6);
      for (const [f1, f2] of formants) {
        const b1 = ctx.createBiquadFilter();
        b1.type = 'bandpass';
        b1.frequency.value = f1;
        b1.Q.value = 5;
        const b2 = ctx.createBiquadFilter();
        b2.type = 'bandpass';
        b2.frequency.value = f2;
        b2.Q.value = 6;
        o.connect(b1).connect(g);
        o.connect(b2).connect(g);
      }
      g.connect(sfxBus);
      const wg = ctx.createGain();
      wg.gain.value = 0.4;
      g.connect(wg).connect(reverb);
      o.start(st);
      o.stop(st + 2);
    }
  },
  horn() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [s, f, d] of [[0, 196, 0.9], [0.9, 262, 0.5], [1.4, 294, 1.4]]) {
      tone(t + s, 'sawtooth', f, f, d, 0.1, sfxBus, 0.06);
      tone(t + s, 'square', f * 2, f * 2, d, 0.025, sfxBus, 0.06);
    }
  },
  ui() {
    if (!ctx) return;
    tone(ctx.currentTime, 'triangle', 660, 660, 0.08, 0.08);
  },
  kill() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 'triangle', 660, 660, 0.1, 0.15);
    tone(t + 0.09, 'triangle', 990, 990, 0.16, 0.15);
  },
  announce(bad) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const fs = bad ? [330, 262, 196] : [262, 330, 392];
    fs.forEach((f, i) => tone(t + i * 0.18, 'triangle', f, f, 0.35, 0.12));
  },
};

// ---------------------------------------------------------------------------
// Slaggeruis: afstandelijk rumoer, sterker naarmate er meer gevochten wordt
// ---------------------------------------------------------------------------
let amb = null;
export function setBattleIntensity(x) {
  if (!ctx) return;
  if (!amb) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 520;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(ambBus);
    src.start();
    amb = g;
  }
  amb.gain.setTargetAtTime(Math.min(0.22, x * 0.22), ctx.currentTime, 0.8);
}

// ---------------------------------------------------------------------------
// Muziek: mehter (trommels + zurna in Hicaz) of Byzantijns/Latijns koraal (drone + modale melodie)
// ---------------------------------------------------------------------------
const music = { on: false, style: null, next: 0, step: 0, timer: null };
const HICAZ = [0, 1, 4, 5, 7, 8, 10, 12];
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12];

export function startMusic(style) {
  if (!ctx) return;
  stopMusic();
  music.on = true;
  music.style = style;
  music.next = ctx.currentTime + 0.3;
  music.step = 0;
  music.drone = null;
  if (style === 'chant') {
    // ison: aangehouden grondtoon
    const nodes = [];
    for (const f of [73.4, 110]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 3);
      o.connect(lp).connect(g).connect(musicBus);
      o.start();
      nodes.push({ o, g });
    }
    music.drone = nodes;
  }
  music.timer = setInterval(scheduleMusic, 100);
}

export function stopMusic() {
  if (music.timer) clearInterval(music.timer);
  music.timer = null;
  music.on = false;
  if (music.drone && ctx) {
    for (const { o, g } of music.drone) {
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
      o.stop(ctx.currentTime + 2);
    }
  }
  music.drone = null;
}

function scheduleMusic() {
  if (!music.on || !ctx) return;
  while (music.next < ctx.currentTime + 0.4) {
    const t = music.next;
    const s = music.step++;
    if (music.style === 'mehter') {
      // 8-tels patroon: davul (diep) + nakkare (hoog)
      const beat = s % 8;
      if (beat === 0 || beat === 3 || beat === 6) {
        tone(t, 'sine', 90, 45, 0.35, 0.5, musicBus);
        nz(t, 0.12, 300, 1, 0.25, 'lowpass', musicBus);
      }
      if (beat === 2 || beat === 5 || beat === 7) nz(t, 0.05, 2400, 3, 0.16, 'bandpass', musicBus);
      // zurna-melodie (rietinstrument): korte frasen
      if (s % 2 === 0 && Math.floor(s / 16) % 2 === 0) {
        const deg = [0, 1, 2, 1, 3, 2, 1, 0][(s / 2) % 8];
        const f = 293.7 * Math.pow(2, HICAZ[deg] / 12);
        const o = tone(t, 'sawtooth', f, f, 0.36, 0.045, musicBus, 0.03);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 6;
        const lg = ctx.createGain();
        lg.gain.value = 4;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 0.45);
      }
      music.next += 0.22;
    } else {
      // gezongen melodie boven de drone, langzaam
      if (s % 2 === 0) {
        const deg = [0, 2, 3, 4, 3, 2, 1, 0, 4, 5, 4, 3, 2, 1, 2, 0][(s / 2) % 16];
        const f = 146.8 * Math.pow(2, DORIAN[deg] / 12);
        for (const det of [-3, 3]) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          o.detune.value = det;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.035, t + 0.25);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
          o.connect(g).connect(musicBus);
          o.start(t);
          o.stop(t + 1.6);
        }
      }
      if (s % 16 === 0) tone(t, 'sine', 55, 40, 1.2, 0.25, musicBus);
      music.next += 0.75;
    }
  }
}
