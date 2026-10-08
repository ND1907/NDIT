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

// Pees die loslaat + suizende pijl. vol: 0..1 (afhankelijk van afstand)
export function playBow(vol = 1) {
  if (!ctx || muted || vol <= 0.02) return;
  const t = ctx.currentTime;
  tone(t, 'triangle', 180, 70, 0.16, 0.45 * vol);
  noiseBurst(t, 0.06, 2500, 2, 0.35 * vol, 'bandpass');
  noiseBurst(t + 0.03, 0.25, 5000, 1.5, 0.12 * vol, 'highpass');
}

// Zwaai van een zwaard (whoosh)
export function playSwing(vol = 1) {
  if (!ctx || muted || vol <= 0.02) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 3;
  f.frequency.setValueAtTime(600, t);
  f.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
  const g = ctx.createGain();
  env(g, t, 0.05, 0.4 * vol, 0.16);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + 0.3);
}

// Staal op staal/schild
export function playClash(vol = 1) {
  if (!ctx || muted || vol <= 0.02) return;
  const t = ctx.currentTime;
  for (const f of [1250, 1870, 2930, 4100]) tone(t, 'sine', f, f * 0.98, 0.5, 0.09 * vol);
  noiseBurst(t, 0.05, 6000, 1, 0.3 * vol, 'highpass');
}

// Treffer in het lichaam
export function playFlesh(vol = 1) {
  if (!ctx || muted || vol <= 0.02) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.12, 500, 1, 0.5 * vol);
  tone(t, 'sine', 140, 60, 0.12, 0.35 * vol);
}

// Pijl slaat in hout/steen
export function playThunk(vol = 1) {
  if (!ctx || muted || vol <= 0.05) return;
  const t = ctx.currentTime;
  tone(t, 'square', 320, 120, 0.05, 0.12 * vol);
  noiseBurst(t, 0.08, 1200, 1, 0.25 * vol);
}

export function playHoof(vol = 1) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  tone(t, 'sine', 95, 50, 0.08, 0.35 * vol);
  noiseBurst(t, 0.05, 700, 1, 0.15 * vol);
}

export function playSwitch() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.12, 3500, 2, 0.25, 'bandpass');
  tone(t + 0.05, 'sine', 2200, 2100, 0.15, 0.04);
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

export function playHorn() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  tone(t, 'sawtooth', 220, 220, 0.9, 0.12);
  tone(t, 'sawtooth', 330, 330, 0.9, 0.08);
  tone(t + 0.9, 'sawtooth', 294, 294, 1.2, 0.12);
}
