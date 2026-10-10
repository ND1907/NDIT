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
// botten: 0 romp, 1 hals, 2 hoofd (nek/poll), per been boven (schouder/heup), midden (knie/sprong)
// en onder (kogel → koot en hoef), 11/16 staart (wortel, haar)
//   3/4/12 linksvoor · 5/6/13 rechtsvoor · 7/8/14 linksachter · 9/10/15 rechtsachter
const BIND = [
  [0, 1.28, 0], // 0 romp
  [0, 1.4, 0.66], // 1 hals (basis)
  [0, 1.93, 1.0], // 2 hoofd (nek)
  [0.16, 1.17, 0.64], [0.16, 0.57, 0.64], // 3 LV boven, 4 LV knie
  [-0.16, 1.17, 0.64], [-0.16, 0.57, 0.64], // 5 RV boven, 6 RV knie
  [0.15, 1.3, -0.6], [0.15, 0.56, -0.79], // 7 LA heup, 8 LA sprong
  [-0.15, 1.3, -0.6], [-0.15, 0.56, -0.79], // 9 RA heup, 10 RA sprong
  [0, 1.47, -0.9], // 11 staartwortel
  [0.16, 0.17, 0.635], [-0.16, 0.17, 0.635], // 12/13 kogel voor
  [0.15, 0.17, -0.775], [-0.15, 0.17, -0.775], // 14/15 kogel achter
  [0, 1.1, -1.04], // 16 staarthaar
];
const PARENTS = [-1, 0, 1, 0, 3, 0, 5, 0, 7, 0, 9, 0, 4, 6, 8, 10, 11];
// beenketens (voor de skinning: benen niet met elkaar mengen)
const CHAIN = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 0, 1, 2, 3, 4, 0];
const UPPER = new Set([3, 5, 7, 9]);

// ---------------------------------------------------------------- SDF-primitieven
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
// afgeronde kegel tussen a (straal ra) en b (straal rb); sx/sy schalen de doorsnede (afgeplat)
function capsule(p, a, b, ra, rb, sx = 1) {
  const ba = sub(b, a);
  const pa = sub(p, a);
  const h = Math.max(0, Math.min(1, dot(pa, ba) / dot(ba, ba)));
  const q = sub(pa, [ba[0] * h, ba[1] * h, ba[2] * h]);
  q[0] /= sx;
  return (len(q) - (ra + (rb - ra) * h)) * Math.min(1, sx);
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
const E = (c, r, bone, region = 0, k = 0.07) => P((p) => ellipsoid(p, c, r), bone, region, k);
const C = (a, b, ra, rb, bone, region = 0, k = 0.06, sx = 1) => P((p) => capsule(p, a, b, ra, rb, sx), bone, region, k);

// ---- romp: ton, borst, schoft, rug, lendenen, kruis en achterhand; buik opgetrokken naar de flank
E([0, 1.2, 0.12], [0.3, 0.35, 0.52], 0, 0, 0.12);
E([0, 1.17, 0.45], [0.27, 0.37, 0.3], 0, 0, 0.12);
E([0, 1.13, 0.72], [0.19, 0.24, 0.14], 0, 0, 0.08);
E([0, 1.5, 0.38], [0.1, 0.1, 0.27], 0, 0, 0.1);
E([0, 1.42, 0.0], [0.22, 0.14, 0.45], 0, 0, 0.12);
E([0, 1.42, -0.36], [0.24, 0.15, 0.26], 0, 0, 0.1);
E([0, 1.43, -0.62], [0.25, 0.17, 0.3], 0, 0, 0.1);
E([0, 1.28, -0.6], [0.29, 0.3, 0.32], 0, 0, 0.12);
E([0, 1.0, 0.02], [0.23, 0.19, 0.46], 0, 0, 0.12);
for (const s of [-1, 1]) {
  // borstspieren, schouderblad en opperarm
  E([s * 0.11, 1.07, 0.68], [0.1, 0.16, 0.12], 0, 0, 0.06);
  C([s * 0.15, 1.18, 0.78], [s * 0.11, 1.5, 0.42], 0.11, 0.06, 0, 0, 0.07);
  C([s * 0.15, 1.17, 0.79], [s * 0.165, 1.0, 0.58], 0.105, 0.095, s > 0 ? 3 : 5, 0, 0.06);
  // bil, dij en knieschijf (stifle)
  E([s * 0.15, 1.36, -0.58], [0.15, 0.2, 0.26], 0, 0, 0.08);
  E([s * 0.155, 1.12, -0.6], [0.13, 0.28, 0.24], s > 0 ? 7 : 9, 0, 0.08);
  E([s * 0.1, 1.17, -0.8], [0.11, 0.22, 0.12], s > 0 ? 7 : 9, 0, 0.07);
  E([s * 0.175, 0.99, -0.44], [0.065, 0.08, 0.08], s > 0 ? 7 : 9, 0, 0.07);
}

// ---- hals: gewelfd, aan de basis breed en diep, met kam en keelgang
E([0, 1.36, 0.72], [0.2, 0.27, 0.2], 1, 0, 0.12);
C([0, 1.42, 0.72], [0, 1.82, 0.98], 0.19, 0.11, 1, 0, 0.12, 0.82);
C([0, 1.28, 0.84], [0, 1.72, 1.03], 0.1, 0.065, 1, 0, 0.08, 0.85);
C([0, 1.55, 0.58], [0, 1.92, 0.92], 0.085, 0.06, 1, 0, 0.08, 0.75);

// ---- hoofd: wigvormig — brede schedel en ganasjes (wangen), rechte neusrug, onderkaak, snuit, ogen en oren
E([0, 1.94, 1.03], [0.095, 0.1, 0.115], 2, 0, 0.07);
for (const s of [-1, 1]) E([s * 0.058, 1.79, 1.0], [0.064, 0.14, 0.135], 2, 0, 0.08);
C([0, 1.93, 1.1], [0, 1.62, 1.37], 0.082, 0.06, 2, 0, 0.07, 0.95); // neusrug
C([0, 1.74, 1.02], [0, 1.53, 1.31], 0.075, 0.046, 2, 0, 0.08, 0.9); // onderkaak
E([0, 1.57, 1.39], [0.074, 0.08, 0.085], 2, 3, 0.05);
E([0, 1.505, 1.355], [0.046, 0.036, 0.056], 2, 3, 0.03);
for (const s of [-1, 1]) {
  E([s * 0.075, 1.9, 1.095], [0.03, 0.032, 0.045], 2, 0, 0.025); // oogkas
  E([s * 0.09, 1.88, 1.11], [0.017, 0.022, 0.027], 2, 3, 0.008); // oog
  E([s * 0.04, 1.585, 1.455], [0.022, 0.03, 0.02], 2, 3, 0.02); // neusgat
  C([s * 0.05, 2.0, 1.0], [s * 0.078, 2.165, 0.975], 0.032, 0.008, 2, 0, 0.02, 0.7); // oren
}

// ---- manen (hangen naar rechts), voorlok en staart
for (let i = 0; i <= 9; i++) {
  const t = i / 9;
  const c = [-0.01, 1.62 + (1.97 - 1.62) * t + 0.02, 0.46 + (0.95 - 0.46) * t];
  E(c, [0.03, 0.06, 0.07], 1, 1, 0.05);
}
E([0, 1.97, 1.07], [0.035, 0.06, 0.04], 2, 1, 0.02);
C([0, 1.5, -0.86], [0, 1.32, -1.0], 0.065, 0.05, 11, 0, 0.05);
E([0, 1.27, -1.0], [0.06, 0.2, 0.075], 11, 1, 0.05);
C([0, 1.12, -1.04], [0, 0.6, -1.06], 0.085, 0.05, 16, 1, 0.06, 0.75);
E([0, 0.86, -1.07], [0.07, 0.24, 0.065], 16, 1, 0.06);

// ---- benen: onderarm/schenkel, knie/sprong, pijp met pees, kogel, koot en hoef
for (const s of [-1, 1]) {
  const x = s * 0.16;
  const [U, M, L] = s > 0 ? [3, 4, 12] : [5, 6, 13];
  C([x, 1.02, 0.6], [x, 0.62, 0.64], 0.095, 0.058, U, 0, 0.06);
  E([x, 0.87, 0.635], [0.074, 0.16, 0.088], U, 0, 0.05);
  E([x, 0.57, 0.645], [0.058, 0.065, 0.063], M, 0, 0.03);
  C([x, 0.55, 0.648], [x, 0.21, 0.643], 0.042, 0.04, M, 0, 0.03);
  C([x, 0.52, 0.612], [x, 0.23, 0.61], 0.028, 0.026, M, 0, 0.025);
  E([x, 0.17, 0.628], [0.053, 0.058, 0.064], L, 0, 0.03);
  C([x, 0.16, 0.638], [x, 0.07, 0.678], 0.04, 0.044, L, 0, 0.025);
  C([x, 0.068, 0.688], [x, 0.012, 0.708], 0.05, 0.064, L, 2, 0.012);
}
for (const s of [-1, 1]) {
  const x = s * 0.15;
  const [U, M, L] = s > 0 ? [7, 8, 14] : [9, 10, 15];
  C([s * 0.16, 0.96, -0.55], [x, 0.6, -0.76], 0.105, 0.064, U, 0, 0.06);
  C([s * 0.125, 1.08, -0.84], [x, 0.63, -0.855], 0.08, 0.036, U, 0, 0.07); // hamstring en hielpees
  E([s * 0.155, 0.8, -0.665], [0.07, 0.14, 0.09], U, 0, 0.05);
  E([x, 0.56, -0.79], [0.055, 0.075, 0.07], M, 0, 0.03);
  E([x, 0.6, -0.845], [0.037, 0.05, 0.037], M, 0, 0.03);
  C([x, 0.53, -0.782], [x, 0.21, -0.77], 0.045, 0.041, M, 0, 0.03);
  C([x, 0.5, -0.818], [x, 0.23, -0.8], 0.029, 0.026, M, 0, 0.025);
  E([x, 0.17, -0.782], [0.053, 0.058, 0.062], L, 0, 0.03);
  C([x, 0.16, -0.774], [x, 0.07, -0.738], 0.04, 0.044, L, 0, 0.025);
  C([x, 0.068, -0.728], [x, 0.012, -0.708], 0.05, 0.062, L, 2, 0.012);
}

function sdf(p) {
  let d = 1e9;
  for (const q of parts) d = smin(d, q.fn(p), q.k);
  return Math.max(d, -p[1]); // vlakke hoefzolen
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
const min = [-0.45, -0.03, -1.22];
const max = [0.45, 2.3, 1.6];
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
  // benen niet met de andere benen mengen; onderbenen niet met de romp
  const top = list[0][0];
  list = list.filter(([b]) => b === top || (CHAIN[b] && CHAIN[b] === CHAIN[top]) || (!CHAIN[b] && (!CHAIN[top] || UPPER.has(top))));
  const tot = list.reduce((a, x) => a + x[1], 0);
  return list.map(([b, w]) => [b, w / tot]);
}


// ---------------------------------------------------------------- over het lijf gedrapeerde rasters
// (zadelkleed, riemen, harnas, manen): stralen vanuit het lijf naar buiten tot het oppervlak
function grad(p) {
  const e = 0.003;
  const g = [sdf([p[0] + e, p[1], p[2]]) - sdf([p[0] - e, p[1], p[2]]), sdf([p[0], p[1] + e, p[2]]) - sdf([p[0], p[1] - e, p[2]]), sdf([p[0], p[1], p[2] + e]) - sdf([p[0], p[1], p[2] - e])];
  const l = len(g) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}
function project(o, d) {
  let t0 = 0;
  let t1 = 0;
  const at = (t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  for (t1 = 0.004; t1 < 1.2; t1 += 0.004) {
    if (sdf(at(t1)) > 0) break;
    t0 = t1;
  }
  for (let k = 0; k < 18; k++) {
    const m = (t0 + t1) / 2;
    if (sdf(at(m)) > 0) t1 = m;
    else t0 = m;
  }
  return at((t0 + t1) / 2);
}
const norm3 = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
// raster nu × nv: f(i, j) → [punt, uitsteek (m)]
function grid(nu, nv, f) {
  const P = [];
  const N = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const [p, off] = f(i / (nu - 1), j / (nv - 1));
    const n = grad(p);
    P.push([p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off]);
    N.push(n);
  }
  return { nu, nv, P, N };
}
const GRIDS = {};
// zadelkleed: van zoom tot zoom over de rug, z van −0,38 tot 0,34; de zoom hangt los van de buik
{
  const hem = (z) => 1.1 + 0.07 * Math.max(0, (Math.abs(z + 0.02) - 0.24) / 0.12) ** 2;
  const ray = (z, th) => project([0, 1.22, z], [Math.sin(th), Math.cos(th), 0]);
  const thMax = (z) => {
    let a = 0.5;
    let b = 2.8;
    for (let k = 0; k < 24; k++) {
      const m = (a + b) / 2;
      if (ray(z, m)[1] > hem(z)) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  GRIDS.blanket = grid(30, 30, (u, v) => {
    const z = -0.38 + u * 0.72;
    const tm = thMax(z);
    const th = (v * 2 - 1) * tm;
    const edge = Math.abs(v * 2 - 1);
    return [ray(z, th), 0.022 + 0.03 * edge ** 3];
  });
}
// borstriem van schouder tot schouder, iets oplopend naar de zijkanten
GRIDS.breast = grid(34, 2, (u, v) => {
  const t = (u * 2 - 1) * 1.5;
  const y = 1.3 + 0.1 * (Math.abs(t) / 1.5) ** 2 + (v - 0.5) * 0.045;
  return [project([0, y, 0.3], [Math.sin(t), 0, Math.cos(t)]), 0.014];
});
// singel onder de buik
GRIDS.girth = grid(30, 2, (u, v) => {
  const th = 1.7 + u * (Math.PI * 2 - 3.4);
  return [project([0, 1.2, 0.24 + (v - 0.5) * 0.05], [Math.sin(th), Math.cos(th), 0]), 0.016];
});
// staartriem over het kruis
GRIDS.crupper = grid(22, 2, (u, v) => {
  const z = -0.3 - u * 0.6;
  return [project([(v - 0.5) * 0.045, 1.25, z], [0, 1, 0]), 0.014];
});
// borstplaat (peytral)
GRIDS.peytral = grid(26, 12, (u, v) => {
  const t = (u * 2 - 1) * 1.3;
  const y = 0.98 + v * 0.48;
  return [project([0, y, 0.32], [Math.sin(t), 0, Math.cos(t)]), 0.03];
});
// hals: as van de basis naar de nek; th = hoek rond de as (0 = boven)
const NA = [0, 1.43, 0.66];
const NB = [0, 1.86, 0.98];
const NT = norm3(sub(NB, NA));
const NU = norm3([0, NT[2], -NT[1]]);
const neckRay = (s, th) => {
  const o = [NA[0] + (NB[0] - NA[0]) * s, NA[1] + (NB[1] - NA[1]) * s, NA[2] + (NB[2] - NA[2]) * s];
  return project(o, [Math.sin(th), NU[1] * Math.cos(th), NU[2] * Math.cos(th)]);
};
GRIDS.crinet = grid(20, 14, (u, v) => [neckRay(0.05 + u * 0.85, (v * 2 - 1) * 1.35), 0.032]);
GRIDS.mailneck = grid(22, 26, (u, v) => [neckRay(0.02 + u * 0.88, (v * 2 - 1) * 2.75), 0.022]);
// manen: van de kam naar rechts omlaag hangend, met ongelijke lokken onderaan
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ends = Array.from({ length: 26 }, () => -0.85 - rnd() * 0.3);
  GRIDS.mane = grid(26, 9, (u, v) => {
    const i = Math.round(u * 25);
    const th = 0.1 + v * (ends[i] - 0.1);
    const thick = 0.03 * Math.min(1, v * 5) * (1 - v) ** 0.6 + 0.005;
    return [neckRay(0.02 + u * 0.93, th), thick];
  });
}
// chanfron (hoofdplaat): over voorhoofd en neusrug
{
  const A = [0, 1.9, 1.02];
  const B2 = [0, 1.62, 1.29];
  const T = norm3(sub(B2, A));
  const F = norm3([0, -T[2], T[1]]).map((x) => -x);
  const Fv = F[1] < 0 ? F.map((x) => -x) : F; // naar voren/boven
  GRIDS.chanfron = grid(14, 10, (u, v) => {
    const o = [A[0] + (B2[0] - A[0]) * u, A[1] + (B2[1] - A[1]) * u, A[2] + (B2[2] - A[2]) * u];
    const ph = (v * 2 - 1) * (0.95 - u * 0.25);
    return [project(o, [Math.sin(ph), Fv[1] * Math.cos(ph), Fv[2] * Math.cos(ph)]), 0.02];
  });
}
console.log('rasters', Object.entries(GRIDS).map(([k, g]) => `${k} ${g.nu}×${g.nv}`).join(', '));

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
const header = { bind: BIND, parents: PARENTS, lods: [] };
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
    rg[k * 4 + 1] = Math.round(Math.max(0.5, Math.min(1, (p[1] > 0.75 ? 0.62 + (p[1] - 0.8) * 0.7 + Math.abs(p[0]) * 0.7 : 0.8 + Math.abs(Math.abs(p[0]) - 0.1) * 2))) * 255);
  });
  header.lods.push({ count: n, tris: L.idx.length / 3, pos: push(pp), nor: push(nn), si: push(si), sw: push(sw), rg: push(rg), idx: push(new Uint16Array(L.idx)) });
}
header.grids = {};
for (const [k, G] of Object.entries(GRIDS)) {
  const n = G.P.length;
  const pp = new Float32Array(n * 3);
  const nn = new Int8Array(n * 4);
  const si = new Uint8Array(n * 4);
  const sw = new Uint8Array(n * 4);
  G.P.forEach((p, i) => {
    pp.set(p, i * 3);
    for (let a = 0; a < 3; a++) nn[i * 4 + a] = Math.round(G.N[i][a] * 127);
    const w = weights(p);
    let tot = 0;
    const q = w.map(([b, x]) => {
      const v = Math.round(x * 255);
      tot += v;
      return [b, v];
    });
    q[0][1] += 255 - tot;
    for (let a = 0; a < 4; a++) {
      si[i * 4 + a] = q[a] ? q[a][0] : 0;
      sw[i * 4 + a] = q[a] ? q[a][1] : 0;
    }
  });
  header.grids[k] = { nu: G.nu, nv: G.nv, pos: push(pp), nor: push(nn), si: push(si), sw: push(sw) };
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
