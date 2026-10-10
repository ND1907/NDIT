// Bouwt het menselijke basismodel voor de soldaten uit de MakeHuman-basismesh (CC0).
//
//   node scripts/build-human.mjs
//
// Stappen:
//  1. basismesh hm08 inlezen + targets (volwassen man, gespierd) toepassen
//  2. met het MakeHuman-skelet en zijn gewichten naar de rustpose van het spel brengen
//     (armen recht omlaag, benen recht, handen tot vuist om een greep)
//  3. de 163 MakeHuman-botten samenvoegen tot de 20 botten van het spelskelet (max. 4 per vertex)
//  4. drie detailniveaus maken met meshoptimizer
//  5. alles compact (deflate + base64) wegschrijven naar src/render/assets/human-data.js
//
// Bronbestanden staan in assets-src/makehuman (CC0, zie CREDITS.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src/makehuman');
const OUT = path.join(ROOT, 'src/render/assets/human-data.js');
const SCALE = 0.1; // MakeHuman-eenheden zijn decimeters

// ---------------------------------------------------------------- OBJ inlezen
const objLines = fs.readFileSync(path.join(SRC, 'base.obj'), 'utf8').split('\n');
const V = [];
const VT = [];
const faces = []; // { g, v: [..], t: [..] }
let group = '';
for (const l of objLines) {
  if (l.startsWith('v ')) {
    const p = l.split(/\s+/);
    V.push([+p[1], +p[2], +p[3]]);
  } else if (l.startsWith('vt ')) {
    const p = l.split(/\s+/);
    VT.push([+p[1], +p[2]]);
  } else if (l.startsWith('g ')) group = l.slice(2).trim();
  else if (l.startsWith('f ')) {
    const p = l.trim().split(/\s+/).slice(1);
    faces.push({ g: group, v: p.map((x) => +x.split('/')[0] - 1), t: p.map((x) => +x.split('/')[1] - 1) });
  }
}

function applyTarget(file, w) {
  for (const l of fs.readFileSync(path.join(SRC, file), 'utf8').split('\n')) {
    if (!l || l[0] === '#') continue;
    const p = l.trim().split(/\s+/);
    const i = +p[0];
    V[i][0] += w * p[1];
    V[i][1] += w * p[2];
    V[i][2] += w * p[3];
  }
}
applyTarget('caucasian-male-young.target', 1.0);
applyTarget('universal-male-young-maxmuscle-averageweight.target', 0.55);

// ---------------------------------------------------------------- skelet
const SK = JSON.parse(fs.readFileSync(path.join(SRC, 'default.mhskel'), 'utf8'));
const WT = JSON.parse(fs.readFileSync(path.join(SRC, 'default_weights.mhw'), 'utf8')).weights;
const jointPos = (name) => {
  const vs = SK.joints[name];
  const c = [0, 0, 0];
  for (const i of vs) for (let k = 0; k < 3; k++) c[k] += V[i][k];
  return c.map((x) => x / vs.length);
};
const BONES = Object.keys(SK.bones);
const bone = {};
for (const n of BONES) bone[n] = { name: n, parent: SK.bones[n].parent, head: jointPos(SK.bones[n].head), tail: jointPos(SK.bones[n].tail), L: ident() };
// topologische volgorde (ouders eerst)
const order = [];
const seen = new Set();
const visit = (n) => {
  if (seen.has(n)) return;
  const p = bone[n].parent;
  if (p) visit(p);
  seen.add(n);
  order.push(n);
};
BONES.forEach(visit);

// ---------------------------------------------------------------- kleine wiskunde (3x3 rijmatrices)
function ident() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}
function mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function apply(m, v) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
function transpose(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
function axisAngle(ax, a) {
  const l = Math.hypot(...ax);
  const [x, y, z] = ax.map((q) => q / l);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const nrm = (a) => scl(a, 1 / (Math.hypot(...a) || 1));
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// rotatie die richting a op richting b legt
function rotBetween(a, b) {
  a = nrm(a);
  b = nrm(b);
  const ax = crs(a, b);
  const s = Math.hypot(...ax);
  const c = dt(a, b);
  if (s < 1e-8) return c > 0 ? ident() : axisAngle(Math.abs(a[0]) < 0.9 ? crs(a, [1, 0, 0]) : crs(a, [0, 1, 0]), Math.PI);
  return axisAngle(ax, Math.atan2(s, c));
}

// ---------------------------------------------------------------- poseren (wereldrotaties per bot)
// G = globale rotatie, P = geposeerde kop.
function solve() {
  for (const n of order) {
    const b = bone[n];
    const p = b.parent ? bone[b.parent] : null;
    b.G = p ? mul(p.G, b.L) : b.L;
    b.P = p ? add(p.P, apply(p.G, sub(b.head, p.head))) : b.head;
  }
}
// zet de lokale rotatie zodat de botrichting (kop → doel) in wereld naar dir wijst
function aim(n, targetJointOf, dir) {
  solve();
  const b = bone[n];
  const cur = sub(posed(targetJointOf), b.P);
  const R = rotBetween(cur, dir);
  const parentG = b.parent ? bone[b.parent].G : ident();
  // nieuwe G = R * oude G  →  L = parentG^T * R * G
  b.L = mul(transpose(parentG), mul(R, b.G));
  solve();
}
// gerelateerde (geposeerde) positie van een bot-kop
function posed(n) {
  solve();
  return bone[n].P;
}
// draai een bot (in wereldruimte) om een as
function rotWorld(n, axis, ang) {
  solve();
  const b = bone[n];
  const R = axisAngle(axis, ang);
  const parentG = b.parent ? bone[b.parent].G : ident();
  b.L = mul(transpose(parentG), mul(R, b.G));
  solve();
}
solve();

for (const s of ['R', 'L']) {
  const sx = s === 'R' ? -1 : 1;
  // benen recht omlaag
  aim(`upperleg01.${s}`, `lowerleg01.${s}`, [0, -1, 0]);
  aim(`lowerleg01.${s}`, `foot.${s}`, [0, -1, 0]);
  // armen recht omlaag langs het lichaam
  aim(`upperarm01.${s}`, `lowerarm01.${s}`, [0, -1, 0]);
  aim(`lowerarm01.${s}`, `wrist.${s}`, [0, -1, 0]);
  // hand in het verlengde, handpalm naar het been (duim naar voren)
  aim(`wrist.${s}`, `finger3-1.${s}`, [0, -1, 0]);
  {
    // draai om de onderarm tot de handpalm naar binnen wijst
    solve();
    const a = posed(`finger2-1.${s}`);
    const b = posed(`finger5-1.${s}`);
    const across = nrm(sub(a, b)); // van pink naar wijsvinger: moet naar voren (+z)
    const flat = nrm([across[0], 0, across[2]]);
    const ang = Math.atan2(crs(flat, [0, 0, 1])[1], dt(flat, [0, 0, 1]));
    rotWorld(`lowerarm01.${s}`, [0, 1, 0], ang);
  }
  // vingers krullen tot een vuist rond een greep langs +z
  const curl = [1.15, 1.45, 1.0];
  for (let f = 2; f <= 5; f++) {
    for (let k = 1; k <= 3; k++) rotWorld(`finger${f}-${k}.${s}`, [0, 0, -sx], curl[k - 1] * (1 - (f - 2) * 0.02));
  }
  // duim over de vingers
  rotWorld(`finger1-1.${s}`, [0, 1, 0], -sx * 0.5);
  rotWorld(`finger1-2.${s}`, [0, 0, -sx], 0.6);
  rotWorld(`finger1-3.${s}`, [0, 0, -sx], 0.7);
}
solve();

// ---------------------------------------------------------------- vertices skinnen (LBS, alle MakeHuman-botten)
const vw = Array.from({ length: V.length }, () => []);
for (const [bn, list] of Object.entries(WT)) for (const [vi, w] of list) vw[vi].push([bn, w]);
const PV = V.map((v, i) => {
  const ws = vw[i];
  if (!ws.length) return v.slice();
  let tot = 0;
  const o = [0, 0, 0];
  for (const [bn, w] of ws) {
    const b = bone[bn];
    if (!b) continue;
    const p = add(apply(b.G, sub(v, b.head)), b.P);
    o[0] += p[0] * w;
    o[1] += p[1] * w;
    o[2] += p[2] * w;
    tot += w;
  }
  return tot > 0 ? scl(o, 1 / tot) : v.slice();
});

// ---------------------------------------------------------------- spelskelet
// Indices moeten overeenkomen met HB in src/render/rig.js
const GB = { PELVIS: 0, SPINE: 1, HEAD: 2, UARM_R: 3, LARM_R: 4, UARM_L: 5, LARM_L: 6, THIGH_R: 7, SHIN_R: 8, THIGH_L: 9, SHIN_L: 10, HAND_R: 11, HAND_L: 12, FOOT_R: 18, FOOT_L: 19 };
let minY = Infinity;
for (let i = 0; i < 13380; i++) minY = Math.min(minY, PV[i][1]);
const toM = (p) => [p[0] * SCALE, (p[1] - minY) * SCALE, p[2] * SCALE];
const J = {
  pelvis: toM(posed('spine05')),
  spine: toM(posed('spine03')),
  neck: toM(posed('neck01')),
  shoulderR: toM(posed('upperarm01.R')),
  shoulderL: toM(posed('upperarm01.L')),
  elbowR: toM(posed('lowerarm01.R')),
  elbowL: toM(posed('lowerarm01.L')),
  wristR: toM(posed('wrist.R')),
  wristL: toM(posed('wrist.L')),
  hipR: toM(posed('upperleg01.R')),
  hipL: toM(posed('upperleg01.L')),
  kneeR: toM(posed('lowerleg01.R')),
  kneeL: toM(posed('lowerleg01.L')),
  ankleR: toM(posed('foot.R')),
  ankleL: toM(posed('foot.L')),
  eyeR: toM(posed('eye.R')),
  eyeL: toM(posed('eye.L')),
  head: toM(posed('head')),
};
// greeppunt van de vuist: midden tussen de middelste vingerkootjes
for (const s of ['R', 'L']) {
  const a = toM(posed(`finger3-2.${s}`));
  const b = toM(posed(`finger3-1.${s}`));
  J['grip' + s] = [(a[0] + b[0]) / 2 + (s === 'R' ? 0.012 : -0.012), (a[1] + b[1]) / 2 - 0.004, (a[2] + b[2]) / 2];
}
// gezicht: mond, kaak en neuspunt
J.mouth = toM(posed('oris01'));
J.lowerLip = toM(posed('oris05'));
J.jaw = toM(posed('jaw'));
{
  let best = null;
  let chin = null;
  let top = -1;
  let mn = [1e9, 1e9, 1e9];
  let mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < 13380; i++) {
    const p = toM(PV[i]);
    if (p[1] < J.neck[1] + 0.03) continue;
    if (Math.abs(p[0]) < 0.25) {
      top = Math.max(top, p[1]);
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], p[k]);
        mx[k] = Math.max(mx[k], p[k]);
      }
    }
    if (Math.abs(p[0]) < 0.006 && p[1] > J.eyeR[1] - 0.09 && p[1] < J.eyeR[1] && (!best || p[2] > best[2])) best = p;
    if (Math.abs(p[0]) < 0.006 && p[2] > 0.06 && p[1] < J.mouth[1] && (!chin || p[1] < chin[1])) chin = p;
  }
  J.noseTip = best;
  J.chin = chin;
  J.headTop = [0, top, 0];
  J.headMin = mn;
  J.headMax = mx;
}
// symmetrisch maken
for (const k of Object.keys(J)) J[k] = J[k].map((x) => +x.toFixed(4));

const BONE_POS = new Array(20).fill(null);
BONE_POS[GB.PELVIS] = J.pelvis;
BONE_POS[GB.SPINE] = J.spine;
BONE_POS[GB.HEAD] = J.neck;
BONE_POS[GB.UARM_R] = J.shoulderR;
BONE_POS[GB.LARM_R] = J.elbowR;
BONE_POS[GB.UARM_L] = J.shoulderL;
BONE_POS[GB.LARM_L] = J.elbowL;
BONE_POS[GB.THIGH_R] = J.hipR;
BONE_POS[GB.SHIN_R] = J.kneeR;
BONE_POS[GB.THIGH_L] = J.hipL;
BONE_POS[GB.SHIN_L] = J.kneeL;
BONE_POS[GB.HAND_R] = J.wristR;
BONE_POS[GB.HAND_L] = J.wristL;
BONE_POS[GB.FOOT_R] = J.ankleR;
BONE_POS[GB.FOOT_L] = J.ankleL;

// MakeHuman-bot → [[spelbot, aandeel], ...]
function mapBone(n) {
  const side = n.endsWith('.R') ? 'R' : n.endsWith('.L') ? 'L' : '';
  const b = n.replace(/\.[RL]$/, '');
  const S = (k) => GB[k + '_' + side];
  if (b === 'root' || b === 'spine05' || b === 'pelvis') return [[GB.PELVIS, 1]];
  if (b === 'spine04') return [[GB.PELVIS, 0.55], [GB.SPINE, 0.45]];
  if (/^spine0[123]$/.test(b) || b === 'clavicle' || b === 'breast') return [[GB.SPINE, 1]];
  if (b === 'shoulder01') return [[GB.SPINE, 0.35], [S('UARM'), 0.65]];
  if (b === 'neck01') return [[GB.SPINE, 0.5], [GB.HEAD, 0.5]];
  if (/^upperarm/.test(b)) return [[S('UARM'), 1]];
  if (/^lowerarm/.test(b)) return [[S('LARM'), 1]];
  if (b === 'wrist' || /^metacarpal/.test(b) || /^finger/.test(b)) return [[S('HAND'), 1]];
  if (/^upperleg/.test(b)) return [[S('THIGH'), 1]];
  if (/^lowerleg/.test(b)) return [[S('SHIN'), 1]];
  if (b === 'foot' || /^toe/.test(b)) return [[S('FOOT'), 1]];
  return [[GB.HEAD, 1]]; // hals, hoofd, gezicht, ogen, tong
}
function gameWeights(vi) {
  const acc = new Map();
  for (const [bn, w] of vw[vi]) for (const [g, k] of mapBone(bn)) acc.set(g, (acc.get(g) || 0) + w * k);
  let list = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!list.length) list = [[GB.HEAD, 1]];
  const tot = list.reduce((a, x) => a + x[1], 0);
  return list.map(([g, w]) => [g, w / tot]);
}

// ---------------------------------------------------------------- geometrie opbouwen (unieke v/vt-paren)
const keep = (g) => g === 'body' || g === 'helper-r-eye' || g === 'helper-l-eye';
const key2i = new Map();
const P = [];
const UV = [];
const SRCV = [];
const PART = []; // 0 = lichaam, 1 = oog
const tris = [];
for (const f of faces) {
  if (!keep(f.g)) continue;
  const ids = f.v.map((v, k) => {
    const key = v * 100000 + f.t[k];
    let id = key2i.get(key);
    if (id == null) {
      id = P.length;
      key2i.set(key, id);
      P.push(toM(PV[v]));
      UV.push(VT[f.t[k]]);
      SRCV.push(v);
      PART.push(f.g === 'body' ? 0 : 1);
    }
    return id;
  });
  for (let k = 1; k + 1 < ids.length; k++) tris.push(ids[0], ids[k], ids[k + 1]);
}
// ogen: UV naar een eigen hoekje van de atlas (bolcoördinaten rond het oogmidden)
for (let i = 0; i < P.length; i++) {
  if (!PART[i]) continue;
  const c = P[i][0] < 0 ? J.eyeR : J.eyeL;
  const d = nrm(sub(P[i], c));
  // voorkant van het oog (+z) komt in het midden van het oogvak
  const u = 0.5 + Math.atan2(d[0], d[2]) / (Math.PI * 2);
  const v = 0.5 + Math.asin(Math.max(-1, Math.min(1, d[1]))) / Math.PI;
  UV[i] = [0.94 + u * 0.05, 0.94 + v * 0.05];
}
console.log('vertices', P.length, 'driehoeken', tris.length / 3);

// normalen
function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const fn = crs(e1, e2);
    for (const q of [a, b, c]) {
      n[q] += fn[0];
      n[q + 1] += fn[1];
      n[q + 2] += fn[2];
    }
  }
  // naden: normalen van vertices op dezelfde plek samenvoegen
  const byPos = new Map();
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${pos[i * 3].toFixed(4)},${pos[i * 3 + 1].toFixed(4)},${pos[i * 3 + 2].toFixed(4)}`;
    if (!byPos.has(k)) byPos.set(k, []);
    byPos.get(k).push(i);
  }
  for (const list of byPos.values()) {
    if (list.length < 2) continue;
    const s = [0, 0, 0];
    for (const i of list) for (let k = 0; k < 3; k++) s[k] += n[i * 3 + k];
    for (const i of list) for (let k = 0; k < 3; k++) n[i * 3 + k] = s[k];
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

// ---------------------------------------------------------------- ambient occlusion (alleen kleine holtes: oksels, vingers, ogen, oren)
function bakeAO(pos, nrmA, idx, maxD) {
  const nv = pos.length / 3;
  const cell = maxD;
  const grid = new Map();
  const ck = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let t = 0; t < idx.length; t += 3) {
    let mn = [1e9, 1e9, 1e9];
    let mx = [-1e9, -1e9, -1e9];
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k] * 3;
      for (let a = 0; a < 3; a++) {
        mn[a] = Math.min(mn[a], pos[v + a]);
        mx[a] = Math.max(mx[a], pos[v + a]);
      }
    }
    for (let x = Math.floor(mn[0] / cell); x <= Math.floor(mx[0] / cell); x++)
      for (let y = Math.floor(mn[1] / cell); y <= Math.floor(mx[1] / cell); y++)
        for (let z = Math.floor(mn[2] / cell); z <= Math.floor(mx[2] / cell); z++) {
          const k = `${x},${y},${z}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(t);
        }
  }
  // vaste set richtingen (Fibonacci-halve bol)
  const NR = 24;
  const dirs = [];
  for (let i = 0; i < NR; i++) {
    const z = 1 - (i + 0.5) / NR;
    const r = Math.sqrt(1 - z * z);
    const a = i * 2.39996;
    dirs.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }
  const ao = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const o = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const nn = [nrmA[i * 3], nrmA[i * 3 + 1], nrmA[i * 3 + 2]];
    const t1 = nrm(Math.abs(nn[0]) < 0.9 ? crs(nn, [1, 0, 0]) : crs(nn, [0, 1, 0]));
    const t2 = crs(nn, t1);
    const cand = new Set();
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const k = `${Math.floor(o[0] / cell) + x},${Math.floor(o[1] / cell) + y},${Math.floor(o[2] / cell) + z}`;
      const l = grid.get(k);
      if (l) for (const t of l) cand.add(t);
    }
    let occ = 0;
    const org = add(o, scl(nn, 0.0015));
    for (const d0 of dirs) {
      const d = add(add(scl(t1, d0[0]), scl(t2, d0[1])), scl(nn, d0[2]));
      let hit = Infinity;
      for (const t of cand) {
        const a = idx[t] * 3;
        const b = idx[t + 1] * 3;
        const c = idx[t + 2] * 3;
        if (idx[t] === i || idx[t + 1] === i || idx[t + 2] === i) continue;
        // Möller–Trumbore
        const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
        const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
        const pv = crs(d, e2);
        const det = dt(e1, pv);
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tv = [org[0] - pos[a], org[1] - pos[a + 1], org[2] - pos[a + 2]];
        const u = dt(tv, pv) * inv;
        if (u < 0 || u > 1) continue;
        const qv = crs(tv, e1);
        const v = dt(d, qv) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = dt(e2, qv) * inv;
        if (tt > 0 && tt < hit) hit = tt;
      }
      if (hit < maxD) occ += 1 - hit / maxD;
    }
    ao[i] = 1 - Math.min(0.85, (occ / NR) * 1.6);
  }
  return ao;
}

// ---------------------------------------------------------------- LODs
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;
const pos0 = new Float32Array(P.flat());
const idx0 = new Uint32Array(tris);
const nor0 = normals(pos0, idx0);

function lod(targetTris, withEyes) {
  // ogen eruit voor verre LODs
  let idx = idx0;
  if (!withEyes) {
    const keepT = [];
    for (let t = 0; t < idx0.length; t += 3) if (!PART[idx0[t]]) keepT.push(idx0[t], idx0[t + 1], idx0[t + 2]);
    idx = new Uint32Array(keepT);
  }
  let out = idx;
  if (targetTris < idx.length / 3) {
    const attrs = new Float32Array(P.length * 5);
    for (let i = 0; i < P.length; i++) {
      attrs[i * 5] = nor0[i * 3];
      attrs[i * 5 + 1] = nor0[i * 3 + 1];
      attrs[i * 5 + 2] = nor0[i * 3 + 2];
      attrs[i * 5 + 3] = UV[i][0];
      attrs[i * 5 + 4] = UV[i][1];
    }
    const [res, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos0, 3, attrs, 5, [0.6, 0.6, 0.6, 1.2, 1.2], null, targetTris * 3, 0.05, []);
    out = res;
    console.log(`  LOD ${targetTris}: ${res.length / 3} driehoeken, fout ${err.toFixed(4)}`);
  }
  // compact: alleen gebruikte vertices
  const remap = new Map();
  const list = [];
  const ni = new Uint32Array(out.length);
  for (let k = 0; k < out.length; k++) {
    let r = remap.get(out[k]);
    if (r == null) {
      r = list.length;
      remap.set(out[k], r);
      list.push(out[k]);
    }
    ni[k] = r;
  }
  return { verts: list, idx: ni };
}

const LODS = [lod(12000, true), lod(3200, false), lod(900, false)];

console.log('AO bakken…');
const ao0 = bakeAO(pos0, nor0, idx0, 0.045);

// ---------------------------------------------------------------- wegschrijven
// per LOD: pos f32*3, nor i8*3+pad, uv u16*2, skinIdx u8*4, skinW u8*4, ao u8, part u8, srcV u16 (voor naden)
const chunks = [];
const header = { joints: J, bonePos: BONE_POS, lods: [] };
let offset = 0;
function push(buf) {
  // 4-byte uitlijning
  const pad = (4 - (buf.byteLength % 4)) % 4;
  const b = Buffer.concat([Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), Buffer.alloc(pad)]);
  chunks.push(b);
  const o = offset;
  offset += b.length;
  return o;
}
for (const L of LODS) {
  const n = L.verts.length;
  const pos = new Float32Array(n * 3);
  const nor = new Int8Array(n * 4);
  const uv = new Uint16Array(n * 2);
  const si = new Uint8Array(n * 4);
  const sw = new Uint8Array(n * 4);
  const misc = new Uint8Array(n * 4); // ao, part, -, -
  for (let k = 0; k < n; k++) {
    const i = L.verts[k];
    for (let a = 0; a < 3; a++) {
      pos[k * 3 + a] = pos0[i * 3 + a];
      nor[k * 4 + a] = Math.round(nor0[i * 3 + a] * 127);
    }
    uv[k * 2] = Math.round(Math.min(1, Math.max(0, UV[i][0])) * 65535);
    uv[k * 2 + 1] = Math.round(Math.min(1, Math.max(0, UV[i][1])) * 65535);
    const gw = gameWeights(SRCV[i]);
    let tot = 0;
    const q = gw.map(([g, w]) => {
      const v = Math.round(w * 255);
      tot += v;
      return [g, v];
    });
    q[0][1] += 255 - tot;
    for (let a = 0; a < 4; a++) {
      si[k * 4 + a] = q[a] ? q[a][0] : 0;
      sw[k * 4 + a] = q[a] ? q[a][1] : 0;
    }
    misc[k * 4] = Math.round(ao0[i] * 255);
    misc[k * 4 + 1] = PART[i];
  }
  const idx = n < 65536 ? new Uint16Array(L.idx) : L.idx;
  header.lods.push({
    count: n, tris: L.idx.length / 3, idx32: n >= 65536,
    pos: push(pos), nor: push(nor), uv: push(uv), si: push(si), sw: push(sw), misc: push(misc), idx: push(idx),
  });
}
const bin = Buffer.concat(chunks);
const z = zlib.deflateSync(bin, { level: 9 });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  `// GEGENEREERD door scripts/build-human.mjs uit de MakeHuman-basismesh (CC0). Niet met de hand bewerken.\n` +
    `export const HUMAN_HEADER = ${JSON.stringify(header)};\n` +
    `export const HUMAN_BIN = '${z.toString('base64')}';\n`,
);
console.log(`geschreven: ${path.relative(ROOT, OUT)} (${(bin.length / 1024).toFixed(0)} KB ruw, ${(z.length / 1024).toFixed(0)} KB gecomprimeerd)`);
console.log('gewrichten (m):', JSON.stringify(J));
fs.writeFileSync(
  path.join(path.dirname(OUT), 'human-rig.js'),
  `// GEGENEREERD door scripts/build-human.mjs: gewrichten en gezichtspunten van het basislichaam (meter, rustpose).\nexport const HUMAN_JOINTS = ${JSON.stringify(J)};\n`,
);

// debug: LOD als OBJ (node scripts/build-human.mjs --obj map)
const objArg = process.argv.indexOf('--obj');
if (objArg > 0) {
  const dir = process.argv[objArg + 1];
  LODS.forEach((L, li) => {
    let s = '';
    for (const i of L.verts) s += `v ${pos0[i * 3]} ${pos0[i * 3 + 1]} ${pos0[i * 3 + 2]}\n`;
    for (let k = 0; k < L.idx.length; k += 3) s += `f ${L.idx[k] + 1} ${L.idx[k + 1] + 1} ${L.idx[k + 2] + 1}\n`;
    fs.writeFileSync(path.join(dir, `human-lod${li}.obj`), s);
  });
}
