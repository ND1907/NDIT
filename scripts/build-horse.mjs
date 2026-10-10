// Bouwt een organisch paardenlichaam uit een signed distance field (vloeiend samengevoegde
// capsules/ellipsoïden) met surface nets, vereenvoudigd met meshoptimizer en geskind op het
// paardenskelet uit src/render/rig.js (PB).
//
//   node scripts/build-horse.mjs
//
// Volledig zelf gemaakt (geen externe bestanden).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/render/assets/horse-data.js');

// ---------------------------------------------------------------- skelet (gelijk aan HORSE_SKEL)
// botten: 0 romp, 1 hals, 2 hoofd, 3/4 linksvoor boven/onder, 5/6 rechtsvoor, 7/8 linksachter, 9/10 rechtsachter, 11 staart
const BODY = [0, 1.28, 0];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const NECK = add(BODY, [0, 0.22, 0.72]);
const HEAD = add(NECK, [0, 0.62, 0.28]);
const FLU = add(BODY, [0.19, -0.12, 0.62]);
const FRU = add(BODY, [-0.19, -0.12, 0.62]);
const HLU = add(BODY, [0.19, -0.08, -0.66]);
const HRU = add(BODY, [-0.19, -0.08, -0.66]);
const down = (p, d) => [p[0], p[1] - d, p[2]];
const FLL = down(FLU, 0.5);
const FRL = down(FRU, 0.5);
const HLL = down(HLU, 0.5);
const HRL = down(HRU, 0.5);
const TAIL = add(BODY, [0, 0.18, -0.86]);
const BIND = [BODY, NECK, HEAD, FLU, FLL, FRU, FRL, HLU, HLL, HRU, HRL, TAIL];

// ---------------------------------------------------------------- SDF-primitieven
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
// afgeronde kegel tussen a (straal ra) en b (straal rb)
function capsule(p, a, b, ra, rb) {
  const ba = sub(b, a);
  const pa = sub(p, a);
  const h = Math.max(0, Math.min(1, dot(pa, ba) / dot(ba, ba)));
  const q = sub(pa, [ba[0] * h, ba[1] * h, ba[2] * h]);
  return len(q) - (ra + (rb - ra) * h);
}
// ellipsoïde (benadering)
function ellipsoid(p, c, r) {
  const q = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]];
  const k0 = len(q);
  const k1 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}
function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

// onderdelen: [sdf(p), bot, regio] — regio voor kleur (0 vacht, 1 manen/staart, 2 hoef, 3 snuit/oog)
const parts = [];
const P = (fn, bone, region = 0, k = 0.07) => parts.push({ fn, bone, region, k });
// romp: borstkas, buik, achterhand, schoft
P((p) => ellipsoid(p, [0, 1.27, 0.05], [0.29, 0.33, 0.78]), 0, 0, 0.1);
P((p) => ellipsoid(p, [0, 1.3, 0.52], [0.27, 0.34, 0.34]), 0, 0, 0.1);
P((p) => ellipsoid(p, [0, 1.33, -0.55], [0.3, 0.33, 0.36]), 0, 0, 0.1);
P((p) => ellipsoid(p, [0, 1.47, 0.42], [0.13, 0.12, 0.3]), 0, 0, 0.08);
P((p) => ellipsoid(p, [0, 1.09, 0.0], [0.24, 0.16, 0.55]), 0, 0, 0.1);
// hals en hoofd
P((p) => capsule(p, [0, 1.36, 0.66], [0, 1.84, 0.98], 0.25, 0.13), 1, 0, 0.1);
P((p) => ellipsoid(p, [0, 1.55, 0.78], [0.15, 0.26, 0.2]), 1, 0, 0.1);
P((p) => ellipsoid(p, [0, 1.98, 1.06], [0.1, 0.14, 0.15]), 2, 0, 0.07);
P((p) => ellipsoid(p, [0, 1.9, 1.04], [0.105, 0.11, 0.11]), 2, 0, 0.06);
P((p) => capsule(p, [0, 1.96, 1.12], [0, 1.7, 1.36], 0.095, 0.072), 2, 0, 0.06);
P((p) => ellipsoid(p, [0, 1.67, 1.37], [0.075, 0.075, 0.085]), 2, 3, 0.04);
for (const s of [-1, 1]) {
  P((p) => capsule(p, [s * 0.05, 2.09, 1.0], [s * 0.07, 2.22, 0.97], 0.025, 0.008), 2, 0, 0.02); // oren
  P((p) => ellipsoid(p, [s * 0.085, 2.0, 1.12], [0.018, 0.02, 0.022]), 2, 3, 0.01); // ogen
}
// manen
P((p) => capsule(p, [0, 1.55, 0.6], [0, 2.0, 0.95], 0.045, 0.03), 1, 1, 0.03);
// benen: bovenbeen (gespierd), onderbeen (pijp), kogel en hoef
const legs = [
  [FLU, FLL, 3, 4, 1],
  [FRU, FRL, 5, 6, 1],
  [HLU, HLL, 7, 8, -1],
  [HRU, HRL, 9, 10, -1],
];
for (const [u, l, bu, bl, front] of legs) {
  const sx = Math.sign(u[0]);
  if (front > 0) {
    P((p) => capsule(p, [u[0] * 0.95, u[1] + 0.08, u[2] + 0.04], [l[0], l[1] + 0.02, l[2] - 0.01], 0.15, 0.065), bu, 0, 0.07);
  } else {
    // dij en spronggewricht naar achteren
    P((p) => ellipsoid(p, [u[0] * 0.95, u[1] + 0.05, u[2] - 0.05], [0.15, 0.24, 0.2]), bu, 0, 0.08);
    P((p) => capsule(p, [u[0], u[1] - 0.05, u[2] - 0.05], [l[0], l[1] + 0.02, l[2] - 0.09], 0.11, 0.06), bu, 0, 0.05);
  }
  void sx;
  const zk = front > 0 ? 0 : -0.07;
  P((p) => capsule(p, [l[0], l[1], l[2] + zk], [l[0], l[1] - 0.38, l[2] + zk * 0.2], 0.045, 0.036), bl, 0, 0.03);
  P((p) => ellipsoid(p, [l[0], l[1] - 0.4, l[2] + 0.02], [0.05, 0.045, 0.055]), bl, 0, 0.02);
  P((p) => capsule(p, [l[0], l[1] - 0.44, l[2] + 0.03], [l[0], l[1] - 0.5, l[2] + 0.06], 0.05, 0.062), bl, 2, 0.01);
}
// staart
P((p) => capsule(p, [0, 1.45, -0.86], [0, 0.85, -1.05], 0.06, 0.09), 11, 1, 0.04);

function sdf(p) {
  let d = 1e9;
  for (const q of parts) d = smin(d, q.fn(p), q.k);
  return d;
}
// dichtstbijzijnde onderdeel (voor bot en regio)
function nearest(p) {
  let best = null;
  let bd = 1e9;
  const ds = parts.map((q) => q.fn(p));
  for (let i = 0; i < parts.length; i++) if (ds[i] < bd) {
    bd = ds[i];
    best = i;
  }
  return { i: best, ds };
}

// ---------------------------------------------------------------- surface nets
const H = 0.022;
const min = [-0.45, -0.02, -1.25];
const max = [0.45, 2.32, 1.58];
const N = [Math.ceil((max[0] - min[0]) / H) + 1, Math.ceil((max[1] - min[1]) / H) + 1, Math.ceil((max[2] - min[2]) / H) + 1];
const at = (x, y, z) => (z * N[1] + y) * N[0] + x;
const field = new Float32Array(N[0] * N[1] * N[2]);
for (let z = 0; z < N[2]; z++) for (let y = 0; y < N[1]; y++) for (let x = 0; x < N[0]; x++) field[at(x, y, z)] = sdf([min[0] + x * H, min[1] + y * H, min[2] + z * H]);
console.log('veld', N.join('×'));
const vid = new Int32Array(N[0] * N[1] * N[2]).fill(-1);
const pos = [];
const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
for (let z = 0; z < N[2] - 1; z++) for (let y = 0; y < N[1] - 1; y++) for (let x = 0; x < N[0] - 1; x++) {
  const v = corners.map(([a, b, c]) => field[at(x + a, y + b, z + c)]);
  let inside = 0;
  for (const q of v) if (q < 0) inside++;
  if (inside === 0 || inside === 8) continue;
  const acc = [0, 0, 0];
  let n = 0;
  for (const [a, b] of edges) {
    if (v[a] < 0 === v[b] < 0) continue;
    const t = v[a] / (v[a] - v[b]);
    for (let k = 0; k < 3; k++) acc[k] += corners[a][k] + (corners[b][k] - corners[a][k]) * t;
    n++;
  }
  vid[at(x, y, z)] = pos.length;
  pos.push([min[0] + (x + acc[0] / n) * H, min[1] + (y + acc[1] / n) * H, min[2] + (z + acc[2] / n) * H]);
}
const idx = [];
for (let z = 1; z < N[2] - 1; z++) for (let y = 1; y < N[1] - 1; y++) for (let x = 1; x < N[0] - 1; x++) {
  const f0 = field[at(x, y, z)];
  // langs x
  for (const [dx, dy, dz, c] of [[1, 0, 0, [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]]], [0, 1, 0, [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]]], [0, 0, 1, [[0, 0, 0], [-1, 0, 0], [-1, -1, 0], [0, -1, 0]]]]) {
    const f1 = field[at(x + dx, y + dy, z + dz)];
    if (f0 < 0 === f1 < 0) continue;
    const q = c.map(([a, b, cc]) => vid[at(x + a, y + b, z + cc)]);
    if (q.some((i) => i < 0)) continue;
    if (f0 < 0) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
  }
}
console.log('vertices', pos.length, 'driehoeken', idx.length / 3);

// enkele gladstrijk-iteraties en normalen uit de SDF-gradiënt
const nrm = pos.map((p) => {
  const e = 0.004;
  const g = [sdf([p[0] + e, p[1], p[2]]) - sdf([p[0] - e, p[1], p[2]]), sdf([p[0], p[1] + e, p[2]]) - sdf([p[0], p[1] - e, p[2]]), sdf([p[0], p[1], p[2] + e]) - sdf([p[0], p[1], p[2] - e])];
  const l = len(g) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
});

// ---------------------------------------------------------------- skinning en kleurregio's
// gewicht per bot: zachte overgang op basis van afstand tot de onderdelen van dat bot
function weights(p) {
  const { ds } = nearest(p);
  const perBone = new Map();
  for (let i = 0; i < parts.length; i++) {
    const w = Math.exp(-Math.max(0, ds[i] + 0.01) / 0.025);
    perBone.set(parts[i].bone, (perBone.get(parts[i].bone) || 0) + w);
  }
  let list = [...perBone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  // benen niet met de andere benen mengen
  const top = list[0][0];
  list = list.filter(([b]) => b === top || b === 0 || b === 1 || b === 2 || b === 11 || Math.abs(b - top) === 1 && Math.min(b, top) % 2 === 1);
  const tot = list.reduce((a, x) => a + x[1], 0);
  return list.map(([b, w]) => [b, w / tot]);
}

await MeshoptSimplifier.ready;
const P0 = new Float32Array(pos.flat());
const I0 = new Uint32Array(idx);
function lod(target) {
  const [res] = MeshoptSimplifier.simplify(I0, P0, 3, target * 3, 0.02, []);
  const remap = new Map();
  const list = [];
  const ni = new Uint32Array(res.length);
  for (let k = 0; k < res.length; k++) {
    let r = remap.get(res[k]);
    if (r == null) {
      r = list.length;
      remap.set(res[k], r);
      list.push(res[k]);
    }
    ni[k] = r;
  }
  console.log(`  LOD ${target}: ${res.length / 3} driehoeken, ${list.length} vertices`);
  return { list, idx: ni };
}
const LODS = [lod(9000), lod(2600), lod(800)];

const chunks = [];
let off = 0;
const push = (a) => {
  const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const pad = (4 - (b.length % 4)) % 4;
  chunks.push(Buffer.concat([b, Buffer.alloc(pad)]));
  const o = off;
  off += b.length + pad;
  return o;
};
const header = { bind: BIND, lods: [] };
for (const L of LODS) {
  const n = L.list.length;
  const pp = new Float32Array(n * 3);
  const nn = new Int8Array(n * 4);
  const si = new Uint8Array(n * 4);
  const sw = new Uint8Array(n * 4);
  const rg = new Uint8Array(n * 4);
  L.list.forEach((i, k) => {
    const p = pos[i];
    pp.set(p, k * 3);
    for (let a = 0; a < 3; a++) nn[k * 4 + a] = Math.round(nrm[i][a] * 127);
    const w = weights(p);
    let tot = 0;
    const q = w.map(([b, x]) => {
      const v = Math.round(x * 255);
      tot += v;
      return [b, v];
    });
    q[0][1] += 255 - tot;
    for (let a = 0; a < 4; a++) {
      si[k * 4 + a] = q[a] ? q[a][0] : 0;
      sw[k * 4 + a] = q[a] ? q[a][1] : 0;
    }
    const near = nearest(p).i;
    rg[k * 4] = parts[near].region;
    // lichte AO onder de buik en tussen de benen
    rg[k * 4 + 1] = Math.round(Math.max(0.55, Math.min(1, 0.6 + (p[1] - 0.9) * 0.6 + Math.abs(p[0]) * 0.6)) * 255);
  });
  header.lods.push({ count: n, tris: L.idx.length / 3, pos: push(pp), nor: push(nn), si: push(si), sw: push(sw), rg: push(rg), idx: push(new Uint16Array(L.idx)) });
}
const bin = Buffer.concat(chunks);
const z = zlib.deflateSync(bin, { level: 9 });
fs.writeFileSync(OUT, `// GEGENEREERD door scripts/build-horse.mjs (eigen SDF-model). Niet met de hand bewerken.\nexport const HORSE_HEADER = ${JSON.stringify(header)};\nexport const HORSE_BIN = '${z.toString('base64')}';\n`);
console.log(`geschreven: ${path.relative(ROOT, OUT)} (${(z.length / 1024).toFixed(0)} KB)`);
if (process.argv.includes('--obj')) {
  let s = '';
  for (const i of LODS[0].list) s += `v ${pos[i].join(' ')}\n`;
  for (let k = 0; k < LODS[0].idx.length; k += 3) s += `f ${LODS[0].idx[k] + 1} ${LODS[0].idx[k + 1] + 1} ${LODS[0].idx[k + 2] + 1}\n`;
  fs.writeFileSync(process.argv[process.argv.indexOf('--obj') + 1], s);
}
