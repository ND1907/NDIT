// Skeletten en procedurele animaties voor mensen, paarden en belegeringstuig.
import { HUMAN_JOINTS } from './assets/human-rig.js';
// Per bot wordt een 3x4-matrix (12 floats) berekend; de crowd-renderer stuurt die
// naar de GPU, waar elk model per bot wordt vervormd.

// ---------------------------------------------------------------------------
// Snelle matrixwiskunde (3x4, rij-volgorde: r00 r01 r02 tx | r10 r11 r12 ty | r20 r21 r22 tz)
// ---------------------------------------------------------------------------
const R = new Float32Array(9);
function eulerXYZ(x, y, z) {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  R[0] = cy * cz; R[1] = -cy * sz; R[2] = sy;
  R[3] = cx * sz + sx * sy * cz; R[4] = cx * cz - sx * sy * sz; R[5] = -sx * cy;
  R[6] = sx * sz - cx * sy * cz; R[7] = sx * cz + cx * sy * sz; R[8] = cx * cy;
}

// out[o..o+12] = P(po) * (T(ox,oy,oz) * R(rx,ry,rz) * S(s))
function mulLocal(out, o, P, po, ox, oy, oz, rx, ry, rz, s) {
  eulerXYZ(rx, ry, rz);
  const p0 = P[po], p1 = P[po + 1], p2 = P[po + 2], p3 = P[po + 3];
  const p4 = P[po + 4], p5 = P[po + 5], p6 = P[po + 6], p7 = P[po + 7];
  const p8 = P[po + 8], p9 = P[po + 9], p10 = P[po + 10], p11 = P[po + 11];
  out[o] = (p0 * R[0] + p1 * R[3] + p2 * R[6]) * s;
  out[o + 1] = (p0 * R[1] + p1 * R[4] + p2 * R[7]) * s;
  out[o + 2] = (p0 * R[2] + p1 * R[5] + p2 * R[8]) * s;
  out[o + 3] = p0 * ox + p1 * oy + p2 * oz + p3;
  out[o + 4] = (p4 * R[0] + p5 * R[3] + p6 * R[6]) * s;
  out[o + 5] = (p4 * R[1] + p5 * R[4] + p6 * R[7]) * s;
  out[o + 6] = (p4 * R[2] + p5 * R[5] + p6 * R[8]) * s;
  out[o + 7] = p4 * ox + p5 * oy + p6 * oz + p7;
  out[o + 8] = (p8 * R[0] + p9 * R[3] + p10 * R[6]) * s;
  out[o + 9] = (p8 * R[1] + p9 * R[4] + p10 * R[7]) * s;
  out[o + 10] = (p8 * R[2] + p9 * R[5] + p10 * R[8]) * s;
  out[o + 11] = p8 * ox + p9 * oy + p10 * oz + p11;
}

// Wortel: verplaatsing + draaiing om Y (+ optionele kanteling voor sterven/rijden)
const ROOT = new Float32Array(12);
export function setRoot(x, y, z, yaw, pitch = 0, roll = 0, scale = 1) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // Ry(yaw) * Rx(pitch) * Rz(roll)
  const a00 = cr, a01 = -sr, a02 = 0;
  const a10 = cp * sr, a11 = cp * cr, a12 = -sp;
  const a20 = sp * sr, a21 = sp * cr, a22 = cp;
  ROOT[0] = (cyw * a00 + syw * a20) * scale; ROOT[1] = (cyw * a01 + syw * a21) * scale; ROOT[2] = (cyw * a02 + syw * a22) * scale; ROOT[3] = x;
  ROOT[4] = a10 * scale; ROOT[5] = a11 * scale; ROOT[6] = a12 * scale; ROOT[7] = y;
  ROOT[8] = (-syw * a00 + cyw * a20) * scale; ROOT[9] = (-syw * a01 + cyw * a21) * scale; ROOT[10] = (-syw * a02 + cyw * a22) * scale; ROOT[11] = z;
  return ROOT;
}

// Schrijft alle botmatrices van een skelet naar `out` vanaf float-index `o`.
// pose: { rot: Float32Array(nb*3), off: Float32Array(nb*3), parent: Int8Array(nb), scale: Float32Array(nb) }
export function writeBones(out, o, root, pose, nb) {
  const { rot, off, parent, scale } = pose;
  for (let b = 0; b < nb; b++) {
    const p = parent[b];
    const s = scale[b];
    if (p < 0) mulLocal(out, o + b * 12, root, 0, off[b * 3], off[b * 3 + 1], off[b * 3 + 2], rot[b * 3], rot[b * 3 + 1], rot[b * 3 + 2], s);
    else mulLocal(out, o + b * 12, out, o + p * 12, off[b * 3], off[b * 3 + 1], off[b * 3 + 2], rot[b * 3], rot[b * 3 + 1], rot[b * 3 + 2], s);
  }
}

export function makePose(skel) {
  const nb = skel.length;
  const pose = { rot: new Float32Array(nb * 3), off: new Float32Array(nb * 3), parent: new Int8Array(nb), scale: new Float32Array(nb), nb };
  resetPose(pose, skel);
  return pose;
}

export function resetPose(pose, skel) {
  pose.rot.fill(0);
  for (let b = 0; b < skel.length; b++) {
    pose.parent[b] = skel[b][0];
    pose.off[b * 3] = skel[b][1];
    pose.off[b * 3 + 1] = skel[b][2];
    pose.off[b * 3 + 2] = skel[b][3];
    pose.scale[b] = 1;
  }
}

// ---------------------------------------------------------------------------
// Menselijk skelet (model kijkt naar +Z, rechts = −X), afgeleid van de gewrichten van het
// MakeHuman-lichaam in rustpose (armen recht omlaag). [ouder, offsetX, offsetY, offsetZ]
// ---------------------------------------------------------------------------
export const HB = {
  PELVIS: 0, SPINE: 1, HEAD: 2, UARM_R: 3, LARM_R: 4, UARM_L: 5, LARM_L: 6,
  THIGH_R: 7, SHIN_R: 8, THIGH_L: 9, SHIN_L: 10, HAND_R: 11, HAND_L: 12,
  WPN_A: 13, WPN_B: 14, SHIELD: 15, CAPE: 16, EXTRA: 17, FOOT_R: 18, FOOT_L: 19,
};
const d3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const HJ = HUMAN_JOINTS;
export const PELVIS_Y = HJ.pelvis[1];
export const HUMAN_SKEL = [
  [-1, 0, HJ.pelvis[1], HJ.pelvis[2]], // bekken
  [0, ...d3(HJ.spine, HJ.pelvis)], // romp (onderrug)
  [1, ...d3(HJ.neck, HJ.spine)], // hoofd (nek)
  [1, ...d3(HJ.shoulderR, HJ.spine)], // bovenarm R
  [3, ...d3(HJ.elbowR, HJ.shoulderR)], // onderarm R
  [1, ...d3(HJ.shoulderL, HJ.spine)], // bovenarm L
  [5, ...d3(HJ.elbowL, HJ.shoulderL)], // onderarm L
  [0, ...d3(HJ.hipR, HJ.pelvis)], // dij R
  [7, ...d3(HJ.kneeR, HJ.hipR)], // scheen R
  [0, ...d3(HJ.hipL, HJ.pelvis)], // dij L
  [9, ...d3(HJ.kneeL, HJ.hipL)], // scheen L
  [4, ...d3(HJ.wristR, HJ.elbowR)], // hand R (pols)
  [6, ...d3(HJ.wristL, HJ.elbowL)], // hand L
  [11, 0, 0, 0], // wapen A
  [11, 0, 0, 0], // wapen B
  [6, 0.07, -0.14, 0], // schild
  [1, 0, 0.36, -0.13], // cape
  [1, 0.0, 0.2, -0.16], // extra (pijlkoker / vaandel)
  [8, ...d3(HJ.ankleR, HJ.kneeR)], // voet R
  [10, ...d3(HJ.ankleL, HJ.kneeL)], // voet L
];
// Rustpositie per bot in modelruimte (voor de skin-matrices); 0 = onderdeel in botruimte gemodelleerd
export const HUMAN_BIND = (() => {
  const b = new Float32Array(HUMAN_SKEL.length * 3);
  const set = (i, p) => b.set(p, i * 3);
  set(HB.PELVIS, HJ.pelvis);
  set(HB.SPINE, HJ.spine);
  set(HB.HEAD, HJ.neck);
  set(HB.UARM_R, HJ.shoulderR);
  set(HB.LARM_R, HJ.elbowR);
  set(HB.UARM_L, HJ.shoulderL);
  set(HB.LARM_L, HJ.elbowL);
  set(HB.THIGH_R, HJ.hipR);
  set(HB.SHIN_R, HJ.kneeR);
  set(HB.THIGH_L, HJ.hipL);
  set(HB.SHIN_L, HJ.kneeL);
  set(HB.HAND_R, HJ.wristR);
  set(HB.HAND_L, HJ.wristL);
  set(HB.FOOT_R, HJ.ankleR);
  set(HB.FOOT_L, HJ.ankleL);
  return b;
})();
export const HUMAN_NB = HUMAN_SKEL.length;

// ---------------------------------------------------------------------------
// Paard
// ---------------------------------------------------------------------------
export const PB = { BODY: 0, NECK: 1, HEAD: 2, FL_U: 3, FL_L: 4, FR_U: 5, FR_L: 6, HL_U: 7, HL_L: 8, HR_U: 9, HR_L: 10, TAIL: 11 };
export const HORSE_SKEL = [
  [-1, 0, 1.28, 0],
  [0, 0, 0.22, 0.72],
  [1, 0, 0.62, 0.28],
  [0, 0.19, -0.12, 0.62],
  [3, 0, -0.5, 0],
  [0, -0.19, -0.12, 0.62],
  [5, 0, -0.5, 0],
  [0, 0.19, -0.08, -0.66],
  [7, 0, -0.5, 0],
  [0, -0.19, -0.08, -0.66],
  [9, 0, -0.5, 0],
  [0, 0, 0.18, -0.86],
];
export const HORSE_NB = HORSE_SKEL.length;

// Belegeringstuig: 0 = romp, 1 = bewegend deel (loop/arm/stormbalk/valbrug), 2 = wielen/slinger, 3 = vaantje
export const SIEGE_SKEL = [
  [-1, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];
export const SIEGE_NB = SIEGE_SKEL.length;

// ---------------------------------------------------------------------------
// Animaties
// ---------------------------------------------------------------------------
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function setR(pose, b, x, y = 0, z = 0) {
  pose.rot[b * 3] = x;
  pose.rot[b * 3 + 1] = y;
  pose.rot[b * 3 + 2] = z;
}
function addR(pose, b, x, y = 0, z = 0) {
  pose.rot[b * 3] += x;
  pose.rot[b * 3 + 1] += y;
  pose.rot[b * 3 + 2] += z;
}
function setOff(pose, b, x, y, z) {
  pose.off[b * 3] = x;
  pose.off[b * 3 + 1] = y;
  pose.off[b * 3 + 2] = z;
}

// Waar een niet-gebruikt wapen hangt: [ouder, x, y, z, rx, ry, rz]
const STOW = {
  hip: [0, 0.19, 0.02, -0.03, 1.95, 0, -0.12],
  belt: [0, -0.2, 0.03, 0.02, 1.85, 0, 0.12],
  back: [1, 0.05, 0.12, -0.17, 1.57, 0, 0.55],
  backLong: [1, 0.02, 0.0, -0.17, -1.45, 0, -0.3],
};

function stowWeapon(pose, bone, kind) {
  const s = STOW[kind] || STOW.back;
  pose.parent[bone] = s[0];
  setOff(pose, bone, s[1], s[2], s[3]);
  setR(pose, bone, s[4], s[5], s[6]);
}

// ---------------------------------------------------------------------------
// Kleine vectorhulpjes (arrays) + inverse kinematica voor de armen
// ---------------------------------------------------------------------------
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
  return v;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const EUL = [0, 0, 0];

// Rotatiematrix met kolommen X, Y, Z → Euler XYZ (zelfde conventie als three.js)
function axesToEuler(X, Y, Z) {
  const m02 = Z[0];
  EUL[1] = Math.asin(m02 < -1 ? -1 : m02 > 1 ? 1 : m02);
  if (Math.abs(m02) < 0.99999) {
    EUL[0] = Math.atan2(-Z[1], Z[2]);
    EUL[2] = Math.atan2(-Y[0], X[0]);
  } else {
    EUL[0] = Math.atan2(Y[2], Y[1]);
    EUL[2] = 0;
  }
  return EUL;
}

// De houdingen hieronder zijn geschreven in "romp-ruimte" met de schouders op 0.42 boven het
// rompgewricht; K() zet zo'n punt om naar het echte lichaam (schouders lager en iets naar voren).
const SH_R = sub3(HJ.shoulderR, HJ.spine);
const SH_L = sub3(HJ.shoulderL, HJ.spine);
const K_DY = SH_R[1] - 0.42;
const K_DZ = SH_R[2];
const K = (g) => [g[0], g[1] + K_DY, g[2] + K_DZ];
const ARM_A = Math.hypot(...sub3(HJ.elbowR, HJ.shoulderR));
const ARM_B = Math.hypot(...sub3(HJ.wristR, HJ.elbowR));
const GRIP_R = sub3(HJ.gripR, HJ.wristR);
const GRIP_L = sub3(HJ.gripL, HJ.wristL);

// Wapen/schild vastzetten in romp-ruimte: greep op g, lokale +Z langs f, +Y richting hint h
function hold(pose, bone, g, f, h) {
  const Z = norm([f[0], f[1], f[2]]);
  let hint = h || (Math.abs(Z[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1]);
  let X = cross(hint, Z);
  if (Math.hypot(X[0], X[1], X[2]) < 1e-4) X = cross([1, 0, 0], Z);
  norm(X);
  const Y = cross(Z, X);
  const e = axesToEuler(X, Y, Z);
  const G = K(g);
  pose.parent[bone] = HB.SPINE;
  setOff(pose, bone, G[0], G[1], G[2]);
  setR(pose, bone, e[0], e[1], e[2]);
}

// Twee-bots-IK: pols (side −1 = rechts, +1 = links) naar doel t (echte romp-ruimte); elleboog richting pole.
// Geeft de assen van de onderarm (romp-ruimte) terug.
const FA = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
function ikRaw(pose, side, t, pole) {
  const S = side < 0 ? SH_R : SH_L;
  const d = [t[0] - S[0], t[1] - S[1], t[2] - S[2]];
  let L = Math.hypot(d[0], d[1], d[2]) || 0.001;
  const u = [d[0] / L, d[1] / L, d[2] / L];
  L = Math.max(0.08, Math.min(ARM_A + ARM_B - 0.002, L));
  const cosA = (ARM_A * ARM_A + L * L - ARM_B * ARM_B) / (2 * ARM_A * L);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pd = dot(pole, u);
  let v = [pole[0] - pd * u[0], pole[1] - pd * u[1], pole[2] - pd * u[2]];
  if (Math.hypot(v[0], v[1], v[2]) < 1e-4) v = [0, -1, 0];
  norm(v);
  const E = [S[0] + ARM_A * (cosA * u[0] + sinA * v[0]), S[1] + ARM_A * (cosA * u[1] + sinA * v[1]), S[2] + ARM_A * (cosA * u[2] + sinA * v[2])];
  const Yd = norm([E[0] - S[0], E[1] - S[1], E[2] - S[2]]);
  const T = [S[0] + u[0] * L, S[1] + u[1] * L, S[2] + u[2] * L];
  const f = norm([T[0] - E[0], T[1] - E[1], T[2] - E[2]]);
  const fd = dot(f, Yd);
  let Zl = [f[0] - fd * Yd[0], f[1] - fd * Yd[1], f[2] - fd * Yd[2]];
  if (Math.hypot(Zl[0], Zl[1], Zl[2]) < 1e-4) Zl = v.slice();
  norm(Zl);
  const Yl = [-Yd[0], -Yd[1], -Yd[2]];
  const Xl = cross(Yl, Zl);
  const e = axesToEuler(Xl, Yl, Zl);
  const ua = side < 0 ? HB.UARM_R : HB.UARM_L;
  const la = side < 0 ? HB.LARM_R : HB.LARM_L;
  setR(pose, ua, e[0], e[1], e[2]);
  const th = -Math.acos(Math.max(-1, Math.min(1, fd)));
  setR(pose, la, th, 0, 0);
  const c = Math.cos(th);
  const s = Math.sin(th);
  FA.X = Xl;
  FA.Y = [c * Yl[0] + s * Zl[0], c * Yl[1] + s * Zl[1], c * Yl[2] + s * Zl[2]];
  FA.Z = [-s * Yl[0] + c * Zl[0], -s * Yl[1] + c * Zl[1], -s * Yl[2] + c * Zl[2]];
  return FA;
}
// Arm naar een punt in de (oude) romp-ruimte; de hand blijft in het verlengde van de onderarm.
function ikArm(pose, side, t, pole) {
  ikRaw(pose, side, K(t), pole);
}
// Vuist om een greep: g = greeppunt (oude romp-ruimte), f = richting van het heft.
function grip(pose, side, g, f, pole, upHint) {
  const G = K(g);
  const Z = norm([f[0], f[1], f[2]]);
  const S = side < 0 ? SH_R : SH_L;
  let y0 = upHint ? norm(upHint.slice()) : norm(sub3(S, G));
  let Y = [y0[0] - dot(y0, Z) * Z[0], y0[1] - dot(y0, Z) * Z[1], y0[2] - dot(y0, Z) * Z[2]];
  if (Math.hypot(Y[0], Y[1], Y[2]) < 1e-3) Y = Math.abs(Z[1]) < 0.9 ? [0, 1, 0] : [0, 0, -1];
  norm(Y);
  const X = cross(Y, Z);
  const o = side < 0 ? GRIP_R : GRIP_L;
  const W = [G[0] - (X[0] * o[0] + Y[0] * o[1] + Z[0] * o[2]), G[1] - (X[1] * o[0] + Y[1] * o[1] + Z[1] * o[2]), G[2] - (X[2] * o[0] + Y[2] * o[1] + Z[2] * o[2])];
  const fa = ikRaw(pose, side, W, pole);
  // handrotatie t.o.v. de onderarm: L = FA^T * H
  const col = (v) => [dot(fa.X, v), dot(fa.Y, v), dot(fa.Z, v)];
  const e = axesToEuler(col(X), col(Y), col(Z));
  setR(pose, side < 0 ? HB.HAND_R : HB.HAND_L, e[0], e[1], e[2]);
}

const POLE_R = [-0.5, -0.6, -0.3];
const POLE_L = [0.5, -0.6, -0.3];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// Keyframes [tijd, greep, richting] lineair interpoleren
function keyed(keys, t) {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const k = smooth((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
      return [lerp3(keys[i - 1][1], keys[i][1], k), norm(lerp3(keys[i - 1][2], keys[i][2], k))];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2]];
}

// Aanvallen: [tijd, greep, richting kling]. Uithalen (wind-up), doorslaan, terug in garde.
const SLASH = [
  [0, [-0.2, 0.12, 0.32], [0.05, 0.75, 0.65]],
  [0.14, [-0.36, 0.6, -0.04], [0.25, 0.55, -0.8]],
  [0.24, [-0.14, 0.42, 0.42], [0.75, 0.2, 0.62]],
  [0.32, [0.16, -0.04, 0.4], [0.6, -0.45, 0.66]],
  [0.52, [-0.2, 0.12, 0.32], [0.05, 0.75, 0.65]],
];
const SLASH2 = [
  [0, [-0.2, 0.12, 0.32], [0.05, 0.75, 0.65]],
  [0.14, [0.12, 0.5, 0.18], [-0.55, 0.6, -0.4]],
  [0.25, [-0.06, 0.3, 0.5], [-0.8, 0.1, 0.6]],
  [0.34, [-0.38, 0.02, 0.3], [-0.6, -0.4, 0.6]],
  [0.54, [-0.2, 0.12, 0.32], [0.05, 0.75, 0.65]],
];
const SMASH = [
  [0, [-0.2, 0.12, 0.32], [0, 0.8, 0.55]],
  [0.18, [-0.16, 0.72, 0.02], [0, 0.35, -0.95]],
  [0.32, [-0.08, 0.0, 0.5], [0, -0.6, 0.8]],
  [0.55, [-0.2, 0.12, 0.32], [0, 0.8, 0.55]],
];
const CHOP = [
  [0, [-0.16, 0.0, 0.26], [0, 0.85, 0.5]],
  [0.25, [-0.1, 0.6, 0.06], [0, 0.45, -0.88]],
  [0.42, [-0.1, 0.05, 0.48], [0, -0.25, 1]],
  [0.65, [-0.16, 0.0, 0.26], [0, 0.85, 0.5]],
];

// Houding van armen, wapen en schild per animatieklasse (alles in romp-ruimte).
function upperBody(pose, u, w, info) {
  const pitch = Math.max(-0.7, Math.min(0.7, u.pitch || 0));
  const at = u.attackT;
  const anim = w ? w.anim : 'none';
  const shieldOnArm = !!info.shieldOnArm;
  const bone = u.wi === 1 ? HB.WPN_B : HB.WPN_A;
  const two = w && w.twoHanded;
  let freeLeft = !shieldOnArm;
  const aimDir = (tw) => norm([-Math.sin(tw) * Math.cos(pitch), Math.sin(pitch), Math.cos(tw) * Math.cos(pitch)]);

  if (anim === 'bow') {
    const tw = -0.5;
    setR(pose, HB.SPINE, 0.04, tw, 0);
    setR(pose, HB.HEAD, -pitch * 0.5, -tw * 0.85, 0);
    const a = aimDir(tw);
    const B = add3([0.18, 0.42, 0.02], a, 0.52);
    const stave = norm([0.12, 1, 0]);
    hold(pose, bone, B, stave, [-a[0], -a[1], -a[2]]);
    grip(pose, 1, B, stave, [0.3, -0.5, 0.2], [-a[0], -a[1] - 0.2, -a[2]]);
    const draw = at < 0.12 ? 0.05 : smooth(clamp01((at - 0.15) / Math.max(0.3, w.cooldown * 0.55)));
    info.bowDraw = draw;
    const P = add3(add3(B, a, -(0.14 + draw * 0.5)), [0.02, 0.03, 0]);
    grip(pose, -1, P, [0, 1, 0], [-0.2, 0.3, -0.8], [a[0], a[1], a[2]]);
    return;
  }
  if (anim === 'crossbow' || anim === 'gun') {
    const reload = at > 0.25 && at < w.cooldown - 0.35;
    if (reload) {
      setR(pose, HB.SPINE, 0.28, -0.15, 0);
      setR(pose, HB.HEAD, 0.3, 0, 0);
      if (anim === 'crossbow') {
        // kruisboog met de voet in de stijgbeugel en de spanhaak/windas
        const G = [0.0, -0.22, 0.36];
        const f = norm([0, -0.85, 0.5]);
        hold(pose, bone, G, f, [0, 0, 1]);
        const c = at * 7;
        grip(pose, -1, add3(add3(G, f, -0.22), [Math.cos(c) * 0.07 - 0.04, Math.sin(c) * 0.07, 0]), f, POLE_R);
        grip(pose, 1, add3(G, f, 0.16), f, POLE_L);
      } else {
        // haakbus laden: loop omhoog, laadstok
        const G = [0.06, -0.12, 0.3];
        const f = norm([0, 1, 0.12]);
        hold(pose, bone, G, f, [0, 0, -1]);
        grip(pose, 1, add3(G, f, 0.3), f, POLE_L);
        grip(pose, -1, add3(G, f, 0.62 + Math.sin(at * 6) * 0.18), [0, -1, 0], POLE_R);
      }
      return;
    }
    const tw = -0.35;
    setR(pose, HB.SPINE, 0.02, tw, 0);
    setR(pose, HB.HEAD, -pitch * 0.5 + 0.12, -tw * 0.7, 0.12);
    const a = aimDir(tw);
    const recoil = at < 0.25 ? (1 - at / 0.25) * 0.12 : 0;
    const G = add3(add3([-0.13, 0.33, 0.12], a, 0.12 - recoil), [0, recoil * 0.5, 0]);
    const f = [a[0], a[1] + recoil * 2, a[2]];
    hold(pose, bone, G, f, [0, 1, 0]);
    grip(pose, -1, G, f, POLE_R);
    grip(pose, 1, add3(add3(G, a, 0.32), [0, -0.04, 0]), f, POLE_L);
    return;
  }
  if (anim === 'siphon') {
    const j = at < (w.duration || 1.2) ? Math.sin(at * 40) * 0.01 : 0;
    const G = [-0.12, 0.05 + j, 0.3];
    const f = [0, 0.05 + pitch * 0.5, 1];
    hold(pose, bone, G, f, [0, 1, 0]);
    grip(pose, -1, G, f, POLE_R);
    grip(pose, 1, add3(add3(G, norm(f.slice()), 0.28), [0, -0.06, 0]), f, POLE_L);
    return;
  }
  if (anim === 'throw') {
    const k = clamp01(at / 0.5);
    const back = k < 0.35 ? smooth(k / 0.35) : 1 - smooth((k - 0.35) / 0.65);
    setR(pose, HB.SPINE, 0, -0.45 * back, 0);
    const G = lerp3([-0.2, 0.25, 0.25], [-0.32, 0.6, -0.22], back);
    const f = norm([0, 0.25 + pitch, 1]);
    hold(pose, bone, G, f, [0, 1, 0]);
    grip(pose, -1, G, f, POLE_R);
    ikArm(pose, 1, [0.25, 0.15 + back * 0.15, 0.32], POLE_L);
    return;
  }
  if (anim === 'cry' && at < 1.6) {
    const k = Math.min(1, at / 0.25) * Math.min(1, (1.6 - at) / 0.3);
    const G = lerp3([-0.2, 0.12, 0.32], [-0.24, 0.95, 0.12], k);
    const f = norm([0, 1, 0.2]);
    hold(pose, bone, G, f, [0, 0, 1]);
    grip(pose, -1, G, f, POLE_R);
    setR(pose, HB.HEAD, -0.35 * k, 0, 0);
  } else if (anim === 'thrust' || anim === 'couch') {
    const k = at < 0.45 ? (at < 0.15 ? smooth(at / 0.15) : 1 - smooth((at - 0.15) / 0.3)) : 0;
    setR(pose, HB.SPINE, 0.06 + k * 0.08, -0.18 + k * 0.15, 0);
    const twoH = two || !shieldOnArm;
    let G;
    let f;
    if (anim === 'couch') {
      G = [-0.2, 0.14, 0.02 + k * 0.12];
      f = norm([0.14, -0.03 + pitch * 0.3, 1]);
    } else if (twoH) {
      G = [-0.2, 0.02, 0.06];
      f = norm([0.05, 0.06 + pitch * 0.4, 1]);
      G = add3(G, f, k * 0.4);
    } else {
      G = [-0.24, 0.02, 0.2];
      f = norm([0.04, 0.08 + pitch * 0.4, 1]);
      G = add3(G, f, k * 0.45);
    }
    hold(pose, bone, G, f, [0, 1, 0]);
    grip(pose, -1, G, f, POLE_R);
    if (twoH && anim !== 'couch') {
      grip(pose, 1, add3(G, f, 0.45), f, POLE_L);
      freeLeft = false;
    }
  } else if (anim === 'chop') {
    const [G, f] = at < 0.65 ? keyed(CHOP, at) : [CHOP[0][1], norm(CHOP[0][2].slice())];
    setR(pose, HB.SPINE, 0.05, -0.15, 0);
    hold(pose, bone, G, f, [0, 0, 1]);
    grip(pose, -1, G, f, POLE_R);
    grip(pose, 1, add3(G, f, 0.42), f, POLE_L);
    freeLeft = false;
  } else if (w && w.kind === 'melee') {
    // zwaard / knots / bijl / houweel: afwisselend van rechts en van links
    const keys = anim === 'smash' ? SMASH : (u.swingN || 0) % 2 ? SLASH2 : SLASH;
    const dur = keys[keys.length - 1][0];
    const [G0, f] = at < dur ? keyed(keys, at) : [keys[0][1], norm(keys[0][2].slice())];
    const G = two ? [G0[0] + 0.08, G0[1], G0[2]] : G0;
    const k = at < dur ? Math.sin((at / dur) * Math.PI) : 0;
    const dir = keys === SLASH2 ? -1 : 1;
    setR(pose, HB.SPINE, 0.05 + k * 0.12, -0.1 + (anim === 'smash' ? 0 : k * 0.4 * dir), 0);
    hold(pose, bone, G, f, [0, 0, 1]);
    grip(pose, -1, G, f, POLE_R);
    if (two) {
      grip(pose, 1, add3(G, f, -0.13), f, POLE_L);
      freeLeft = false;
    }
  }

  // schild aan de linkerarm; bij een geblokte klap hoger en naar voren
  if (shieldOnArm) {
    const bash = at < 0.3 ? Math.sin((at / 0.3) * Math.PI) * 0.06 : 0;
    const bt = u.blockT ?? 9;
    const blk = bt < 0.5 ? Math.sin(Math.min(1, bt / 0.12) * Math.PI * 0.5) * (1 - smooth(clamp01((bt - 0.3) / 0.2))) : 0;
    const S = [0.18 - blk * 0.05, 0.12 + blk * 0.18, 0.38 + bash + blk * 0.06];
    hold(pose, HB.SHIELD, S, norm([-0.3 - blk * 0.1, 0, 1]), [0, 1, 0]);
    grip(pose, 1, [S[0] + 0.02, S[1] - 0.02, S[2] - 0.09], [1, 0, 0.2], POLE_L);
  } else if (freeLeft) {
    const sw = info.armSwing || 0;
    setR(pose, HB.UARM_L, -sw * 0.8 + 0.02, 0, 0.09 + info.armOut);
    setR(pose, HB.LARM_L, -0.25 - Math.max(0, sw) * 0.4 - info.armBend, 0, 0);
  }
}

// Loopcyclus per been: p = fase 0..1 vanaf de hielslag. Geeft heup, knie, enkel (rad).
function gauss(p, c, w) {
  let d = p - c;
  d -= Math.round(d);
  return Math.exp(-(d * d) / (2 * w * w));
}
function legCycle(p, run) {
  const walkHip = 0.33 * Math.cos(p * Math.PI * 2) + 0.05;
  const walkKnee = 0.28 * gauss(p, 0.13, 0.07) + 1.08 * gauss(p, 0.72, 0.11) + 0.05;
  const walkAnk = -0.16 * gauss(p, 0.05, 0.04) + 0.14 * gauss(p, 0.42, 0.1) - 0.32 * gauss(p, 0.62, 0.05) + 0.08 * gauss(p, 0.85, 0.06);
  const runHip = 0.55 * Math.cos(p * Math.PI * 2 - 0.25) + 0.12;
  const runKnee = 0.55 * gauss(p, 0.12, 0.08) + 1.75 * gauss(p, 0.62, 0.14) + 0.15;
  const runAnk = -0.2 * gauss(p, 0.03, 0.04) + 0.15 * gauss(p, 0.22, 0.07) - 0.45 * gauss(p, 0.38, 0.06);
  return [walkHip + (runHip - walkHip) * run, walkKnee + (runKnee - walkKnee) * run, walkAnk + (runAnk - walkAnk) * run];
}

// Volledige menselijke pose. info: { shield, cape, weaponA, weaponB, ... } uit het model.
export function poseHuman(pose, u, info, t, mountedYawOffset = 0) {
  resetPose(pose, HUMAN_SKEL);
  const w = u.weapons[u.wi];
  const speed = u.speed || 0;
  const v = u.variant || 0;

  // ---- wapens: actief in de hand, de rest opgeborgen ----
  const wa = info.weaponA;
  const wb = info.weaponB;
  if (wa) {
    if (u.wi !== 0) stowWeapon(pose, HB.WPN_A, info.stowA);
  } else pose.scale[HB.WPN_A] = 0;
  if (wb) {
    if (u.wi !== 1) stowWeapon(pose, HB.WPN_B, info.stowB);
  } else pose.scale[HB.WPN_B] = 0;
  if (info.hideStowedA && u.wi !== 0) pose.scale[HB.WPN_A] = 0;

  // schild: aan de arm (bij slag-/stoot-/werpwapens) of op de rug
  info.shieldOnArm = false;
  if (info.shield) {
    const onArm = w && (w.kind === 'melee' || w.kind === 'thrown') && !w.twoHanded && info.shield !== 'pavise';
    if (!onArm) {
      pose.parent[HB.SHIELD] = HB.SPINE;
      setOff(pose, HB.SHIELD, 0, 0.12, info.shield === 'pavise' ? -0.2 : -0.17);
      setR(pose, HB.SHIELD, 0, Math.PI, 0);
    } else info.shieldOnArm = true;
  } else pose.scale[HB.SHIELD] = 0;

  // pavese: neergezet voor de schutter als die stilstaat met kruisboog/haakbus
  if (info.shield === 'pavise' && w && w.kind === 'ranged' && speed < 0.3 && !u.mounted && u.y < 0.5 && !(u.airT > 0)) {
    pose.parent[HB.SHIELD] = HB.PELVIS;
    setOff(pose, HB.SHIELD, 0.05, -0.38, 0.75);
    setR(pose, HB.SHIELD, -0.12, 0, 0);
  }

  // ---- dood: eerst door de knieën, dan voorover/achterover/opzij ----
  if (!u.alive) {
    const dt = u.deadT || 0;
    const k1 = smooth(clamp01(dt / 0.32));
    const k2 = smooth(clamp01((dt - 0.18) / 0.62));
    const kind = v % 3; // 0 = voorover, 1 = achterover, 2 = opzij
    const fwd = kind !== 1;
    // knieën knikken
    const kneel = k1 * (1 - k2 * 0.7);
    setR(pose, HB.THIGH_R, -0.9 * kneel - (fwd ? 0.1 : -0.2) * k2, 0, -0.05 * k2);
    setR(pose, HB.THIGH_L, -0.6 * kneel - (fwd ? 0 : -0.15) * k2, 0, 0.1 * k2);
    setR(pose, HB.SHIN_R, 1.5 * kneel + 0.25 * k2, 0, 0);
    setR(pose, HB.SHIN_L, 1.2 * kneel + 0.5 * k2, 0, 0);
    setR(pose, HB.FOOT_R, 0.4 * k2, 0, 0);
    setR(pose, HB.FOOT_L, 0.5 * k2, 0, 0);
    pose.off[HB.PELVIS * 3 + 1] = PELVIS_Y - 0.32 * kneel;
    setR(pose, HB.SPINE, fwd ? 0.35 * k1 - 0.15 * k2 : -0.2 * k1 - 0.15 * k2, kind === 2 ? 0.3 * k2 : 0, kind === 2 ? 0.25 * k2 : 0);
    setR(pose, HB.HEAD, fwd ? 0.3 * k1 - 0.5 * k2 : -0.4 * k2, 0.6 * k2 * ((v & 2) ? 1 : -1), 0);
    // armen: slap, bij het neervallen uitgestrekt
    setR(pose, HB.UARM_R, -0.5 * k1 - (fwd ? 2.4 : 1.4) * k2, 0, -0.35 - 0.3 * k2);
    setR(pose, HB.LARM_R, -0.4 - 0.3 * k2, 0, 0);
    setR(pose, HB.UARM_L, -0.3 * k1 - (fwd ? 2.2 : 1.1) * k2, 0, 0.35 + 0.35 * k2);
    setR(pose, HB.LARM_L, -0.5, 0, 0);
    if (u.mounted) {
      setR(pose, HB.THIGH_R, -0.5 * k1, 0, 0);
      setR(pose, HB.THIGH_L, -0.3 * k1, 0, 0);
    }
    // het gevallen wapen ligt naast het lichaam
    pose.scale[HB.WPN_B] = 0;
    info.deathTilt = (fwd ? 1 : -1) * k2 * 1.5;
    info.deathRoll = kind === 2 ? k2 * 0.25 : 0;
    info.deathDrop = 0;
    return;
  }
  info.deathTilt = 0;
  info.deathRoll = 0;
  info.deathDrop = 0;
  info.armSwing = 0;
  info.armOut = 0;
  info.armBend = 0;

  // ---- onderlichaam: lopen/rennen/staan/klimmen/rijden/springen ----
  const mountK = u.mountT != null ? clamp01(u.mountT) : u.mounted ? 1 : 0;
  if (u.mounted || mountK > 0) {
    // in het zadel: dijen gespreid om de paardenflanken, voeten in de stijgbeugels
    const k = smooth(mountK);
    const swing = u.mountT != null && mountK < 1 ? Math.sin(mountK * Math.PI) : 0;
    setR(pose, HB.THIGH_R, -1.0 * k - swing * 0.6, 0, -0.42 * k);
    setR(pose, HB.THIGH_L, -1.0 * k + swing * 0.9, 0, 0.42 * k + swing * 0.5);
    setR(pose, HB.SHIN_R, 1.2 * k, 0, 0);
    setR(pose, HB.SHIN_L, 1.2 * k + swing * 0.4, 0, 0);
    setR(pose, HB.FOOT_R, -0.25 * k, 0, 0);
    setR(pose, HB.FOOT_L, -0.25 * k, 0, 0);
    const gal = Math.min(1, speed / 7);
    const bob = Math.sin(u.gait * 2) * 0.05 * gal;
    addR(pose, HB.SPINE, 0.08 + bob + gal * 0.12, mountedYawOffset, 0);
    setR(pose, HB.HEAD, -bob * 0.6 - gal * 0.08, 0, 0);
    // vrije linkerhand aan de teugels
    info.armSwing = 0;
    info.armOut = -0.05;
    info.armBend = 0.9 * k;
  } else if (u.climb) {
    const c = Math.sin(t * 9);
    setR(pose, HB.THIGH_R, -0.9 + c * 0.5, 0, 0);
    setR(pose, HB.SHIN_R, 1.0 - c * 0.3, 0, 0);
    setR(pose, HB.THIGH_L, -0.9 - c * 0.5, 0, 0);
    setR(pose, HB.SHIN_L, 1.0 + c * 0.3, 0, 0);
    setR(pose, HB.FOOT_R, -0.3, 0, 0);
    setR(pose, HB.FOOT_L, -0.3, 0, 0);
    setR(pose, HB.SPINE, 0.25, 0, 0);
    setR(pose, HB.UARM_R, -2.5 + c * 0.4, 0, -0.1);
    setR(pose, HB.LARM_R, -0.5, 0, 0);
    setR(pose, HB.UARM_L, -2.5 - c * 0.4, 0, 0.1);
    setR(pose, HB.LARM_L, -0.5, 0, 0);
    return;
  } else if (u.airT > 0) {
    // sprong: afzetten, benen intrekken, landen
    const up = (u.vy || 0) > 0;
    const tuck = up ? 0.6 : 0.35;
    setR(pose, HB.THIGH_R, -tuck - 0.25, 0, -0.03);
    setR(pose, HB.THIGH_L, -tuck + 0.15, 0, 0.03);
    setR(pose, HB.SHIN_R, tuck * 1.6, 0, 0);
    setR(pose, HB.SHIN_L, tuck * 1.2 + 0.2, 0, 0);
    setR(pose, HB.FOOT_R, 0.3, 0, 0);
    setR(pose, HB.FOOT_L, 0.3, 0, 0);
    setR(pose, HB.SPINE, 0.12, 0, 0);
    info.armSwing = up ? -0.6 : 0.2;
    info.armOut = 0.25;
  } else {
    const g = u.gait || 0;
    const run = clamp01((speed - 2.8) / 2.2);
    const amp = Math.min(1, speed / 1.4);
    const ph = g / (Math.PI * 2);
    const pr = ph - Math.floor(ph);
    const pl = pr + 0.5;
    const [hr, kr, ar] = legCycle(pr, run);
    const [hl, kl, al] = legCycle(pl, run);
    // heup naar voren = negatieve X-rotatie
    setR(pose, HB.THIGH_R, -hr * amp - run * 0.12, 0, -0.03);
    setR(pose, HB.THIGH_L, -hl * amp - run * 0.12, 0, 0.03);
    setR(pose, HB.SHIN_R, kr * amp + 0.04, 0, 0);
    setR(pose, HB.SHIN_L, kl * amp + 0.04, 0, 0);
    setR(pose, HB.FOOT_R, ar * amp - (kr * amp) * 0.15, 0, 0);
    setR(pose, HB.FOOT_L, al * amp - (kl * amp) * 0.15, 0, 0);
    // bekken: op en neer (laagste bij de hielslag), draaien en kantelen
    const s2 = Math.cos(pr * Math.PI * 4);
    pose.off[HB.PELVIS * 3 + 1] = PELVIS_Y - (0.022 + run * 0.03) * amp * (0.5 + 0.5 * s2) - run * 0.05;
    setR(pose, HB.PELVIS, run * 0.04, Math.cos(pr * Math.PI * 2) * 0.09 * amp, Math.sin(pr * Math.PI * 4) * 0.035 * amp);
    // romp draait tegen het bekken in, licht voorover bij rennen
    setR(pose, HB.SPINE, run * 0.2 + 0.02, -Math.cos(pr * Math.PI * 2) * 0.12 * amp, -Math.sin(pr * Math.PI * 4) * 0.03 * amp);
    setR(pose, HB.HEAD, -run * 0.12, Math.cos(pr * Math.PI * 2) * 0.03 * amp, 0);
    info.armSwing = Math.cos(pr * Math.PI * 2) * (0.32 + run * 0.35) * amp;
    info.armBend = run * 1.0;
    info.armOut = 0.02;
    // rust: gewicht verplaatsen, ademen, af en toe rondkijken
    if (speed < 0.25) {
      const sway = Math.sin(t * 0.55 + v * 1.7);
      const br = Math.sin(t * 1.6 + v) * 0.012;
      pose.off[HB.PELVIS * 3] = sway * 0.018;
      pose.off[HB.PELVIS * 3 + 1] = PELVIS_Y - 0.006;
      setR(pose, HB.PELVIS, 0, 0.04 * Math.sin(v), -sway * 0.03);
      setR(pose, HB.SPINE, 0.03 + br, 0, sway * 0.025);
      setR(pose, HB.THIGH_R, -0.03, 0, -0.06 + sway * 0.03);
      setR(pose, HB.THIGH_L, 0.04, 0, 0.07 + sway * 0.03);
      setR(pose, HB.SHIN_R, 0.06 + Math.max(0, sway) * 0.08, 0, 0);
      setR(pose, HB.SHIN_L, 0.06 + Math.max(0, -sway) * 0.08, 0, 0);
      setR(pose, HB.FOOT_R, -0.03, 0, 0.06);
      setR(pose, HB.FOOT_L, -0.04, 0, -0.07);
      const look = Math.sin(t * 0.23 + v * 2.3);
      setR(pose, HB.HEAD, -0.02, look > 0.6 ? (look - 0.6) * 1.2 : look < -0.7 ? (look + 0.7) * 1.0 : 0, 0);
      info.armSwing = br * 2;
      info.armOut = 0.03;
      info.armBend = 0.15;
    }
  }

  // ---- bovenlichaam ----
  upperBody(pose, u, w, info);
  // getroffen: kort terugdeinzen
  if (u.hitT < 0.3) {
    const h = Math.sin((u.hitT / 0.3) * Math.PI);
    addR(pose, HB.SPINE, -0.25 * h, 0.1 * h * ((v & 1) ? 1 : -1), 0.08 * h);
    addR(pose, HB.HEAD, -0.3 * h, 0, 0);
    addR(pose, HB.SHIN_R, 0.2 * h, 0, 0);
  }
  // cape wappert licht
  setR(pose, HB.CAPE, 0.08 + Math.min(0.5, speed * 0.06) + Math.sin(t * 2.3 + v) * 0.03, 0, 0);
}

// ---------------------------------------------------------------------------
// Paardengangen: stap, draf, galop
// ---------------------------------------------------------------------------
export function poseHorse(pose, u, t) {
  resetPose(pose, HORSE_SKEL);
  const sp = u.speed || 0;
  if (!u.alive) {
    const k = smooth(clamp01(u.deadT / 0.9));
    setR(pose, PB.FL_U, -0.9 * k, 0, 0);
    setR(pose, PB.FR_U, -0.6 * k, 0, 0);
    setR(pose, PB.HL_U, 0.7 * k, 0, 0);
    setR(pose, PB.HR_U, 0.9 * k, 0, 0);
    setR(pose, PB.NECK, 0.5 * k, 0, 0);
    return { tilt: k * 1.45, drop: k * 0.55 };
  }
  const g = u.gait;
  let amp;
  let phases;
  if (sp < 2.5) {
    amp = Math.min(1, sp / 1.5) * 0.32;
    phases = [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5]; // stap: vier tellen
  } else if (sp < 7) {
    amp = 0.45;
    phases = [0, Math.PI, Math.PI, 0]; // draf: diagonaal
  } else {
    amp = 0.7;
    phases = [0, 0.35, Math.PI * 0.85, Math.PI * 1.15]; // galop
  }
  const legs = [[PB.FL_U, PB.FL_L, 1], [PB.FR_U, PB.FR_L, 1], [PB.HL_U, PB.HL_L, -1], [PB.HR_U, PB.HR_L, -1]];
  for (let i = 0; i < 4; i++) {
    const [u1, l1, front] = legs[i];
    const ph = g + phases[i];
    const s = Math.sin(ph);
    const lift = Math.max(0, Math.cos(ph));
    setR(pose, u1, -s * amp, 0, 0);
    // knie (voor) buigt naar achteren, sprong (achter) naar voren
    setR(pose, l1, front > 0 ? lift * amp * 1.4 : -lift * amp * 1.1, 0, 0);
  }
  const gallop = sp >= 7;
  const bob = gallop ? Math.sin(g) * 0.07 : Math.abs(Math.sin(g)) * 0.03 * Math.min(1, sp);
  pose.off[PB.BODY * 3 + 1] = 1.28 + bob;
  setR(pose, PB.BODY, gallop ? Math.cos(g) * 0.06 : 0, 0, 0);
  setR(pose, PB.NECK, gallop ? -0.2 + Math.cos(g) * 0.12 : sp > 0.3 ? -0.05 : 0.15 + Math.sin(t * 0.7 + u.variant) * 0.08, 0, 0);
  setR(pose, PB.HEAD, sp > 0.3 ? 0.1 : 0.25, Math.sin(t * 0.4 + u.variant) * (sp < 0.3 ? 0.2 : 0.03), 0);
  setR(pose, PB.TAIL, 0.5 + Math.min(0.6, sp * 0.06) + Math.sin(t * 3 + u.variant) * 0.1, Math.sin(t * 1.7) * 0.15, 0);
  return { tilt: 0, drop: 0, bob };
}

// ---------------------------------------------------------------------------
// Belegeringstuig
// ---------------------------------------------------------------------------
export function poseSiege(pose, u, kind, t) {
  resetPose(pose, SIEGE_SKEL);
  const at = u.attackT;
  if (kind === 'trebuchet') {
    // arm zwaait door na het vuren en wordt langzaam weer opgedraaid
    const fire = at < 1.2 ? smooth(at / 1.2) : 1 - smooth(clamp01((at - 2) / 8));
    setOff(pose, 1, 0, 5.2, 0);
    setR(pose, 1, -0.9 + fire * 2.3, 0, 0);
  } else if (kind === 'bombard') {
    const rec = at < 0.4 ? Math.sin((at / 0.4) * Math.PI) * 0.6 : 0;
    setOff(pose, 1, 0, 0, -rec);
    setR(pose, 1, -0.06, 0, 0);
  } else if (kind === 'ram') {
    const k = at < 0.9 ? Math.sin((at / 0.9) * Math.PI) : 0;
    const back = at > 0.9 && at < 3 ? smooth(clamp01((at - 0.9) / 2)) : 1;
    setOff(pose, 1, 0, 1.6, (k * 1.2 - (1 - back) * 0.2) - 0.4 * (1 - k) * (1 - back));
  } else if (kind === 'tower') {
    // valbrug zakt als de toren is aangelegd
    const k = u.docked ? Math.min(1, (u._dockAnim = (u._dockAnim || 0) + 0.02)) : 0;
    setOff(pose, 1, 0, 10.5, 1.6);
    setR(pose, 1, k * 1.45, 0, 0);
  }
  if (!u.alive) {
    // vernield tuig zakt scheef in en verdwijnt langzaam in de grond
    const k = smooth(clamp01(u.deadT / 1.5));
    const sink = Math.max(0, u.deadT - 8) * 0.25;
    return { tilt: (kind === 'tower' ? 0.9 : 0.35) * k, drop: 0.8 * k + sink };
  }
  setR(pose, 2, (u.gait || 0) * 0.5, 0, 0);
  setR(pose, 3, 0, Math.sin(t * 2 + u.variant) * 0.3, 0);
  return { tilt: 0, drop: 0 };
}
