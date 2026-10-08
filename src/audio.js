// Alle geluiden worden live gesynthetiseerd met de Web Audio API.
let ctx = null;
let master = null;
let noise = null;
export let muted = false;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.6;
}

function env(gainNode, t, attack, peak, decay) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noiseBurst(t, dur, freq, q, vol, type = 'lowpass') {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.003, vol, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(t, type, f0, f1, dur, vol) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  env(g, t, 0.004, vol, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// vol: 0..1 (afhankelijk van afstand)
export function playShot(weapon, vol = 1) {
  if (!ctx || muted || vol <= 0.02) return;
  const t = ctx.currentTime;
  if (weapon === 'musket') {
    noiseBurst(t, 0.45, 1800, 0.7, 0.9 * vol);
    noiseBurst(t, 0.9, 380, 0.5, 0.7 * vol);
    tone(t, 'sine', 120, 35, 0.35, 0.8 * vol);
  } else {
    tone(t, 'triangle', 420, 90, 0.18, 0.5 * vol);
    noiseBurst(t, 0.08, 3500, 2, 0.5 * vol, 'bandpass');
    tone(t + 0.01, 'square', 160, 60, 0.08, 0.15 * vol);
  }
}

export function playHit() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  tone(t, 'square', 1400, 900, 0.06, 0.12);
}

export function playKill() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  tone(t, 'triangle', 660, 660, 0.12, 0.25);
  tone(t + 0.1, 'triangle', 990, 990, 0.2, 0.25);
}

export function playHurt() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.15, 600, 1, 0.5);
  tone(t, 'sawtooth', 180, 90, 0.18, 0.15);
}

export function playReload() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.05, 4000, 3, 0.4, 'bandpass');
  noiseBurst(t + 0.35, 0.05, 3000, 3, 0.4, 'bandpass');
  noiseBurst(t + 0.7, 0.07, 2000, 3, 0.5, 'bandpass');
}

export function playImpact(vol = 1) {
  if (!ctx || muted || vol <= 0.05) return;
  noiseBurst(ctx.currentTime, 0.12, 900, 1, 0.35 * vol);
}

export function playHorn() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  tone(t, 'sawtooth', 220, 220, 0.9, 0.12);
  tone(t, 'sawtooth', 330, 330, 0.9, 0.08);
  tone(t + 0.9, 'sawtooth', 294, 294, 1.2, 0.12);
}
