import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HB, PB } from './rig.js';

// ---------------------------------------------------------------------------
// Modelbouwer: voegt primitieven samen tot één geometrie met per vertex
// kleur, botnummer, metaalgehalte en "tint"-vlag (voor huidskleur/vacht/vaandel).
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

class MB {
  constructor(lod = 0) {
    this.lod = lod;
    this.geos = [];
  }

  seg(n) {
    return this.lod ? Math.max(4, Math.round(n * 0.55)) : n;
  }

  add(geo, bone, color, o = {}) {
    if (o.detail && this.lod) {
      geo.dispose();
      return this;
    }
    const p = o.p || [0, 0, 0];
    const r = o.r || [0, 0, 0];
    const s = o.s || [1, 1, 1];
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(p[0], p[1], p[2]), _q, new THREE.Vector3(s[0], s[1], s[2]));
    geo.applyMatrix4(_m);
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const n = geo.attributes.position.count;
    _c.set(color);
    const col = new Float32Array(n * 3);
    const shade = o.shade ?? 1;
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r * shade;
      col[i * 3 + 1] = _c.g * shade;
      col[i * 3 + 2] = _c.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aBone', new THREE.BufferAttribute(new Float32Array(n).fill(bone), 1));
    geo.setAttribute('aMetal', new THREE.BufferAttribute(new Float32Array(n).fill(o.metal || 0), 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(o.tint || 0), 1));
    geo.deleteAttribute('uv');
    if (geo.attributes.uv1) geo.deleteAttribute('uv1');
    this.geos.push(geo);
    return this;
  }

  box(bone, w, h, d, color, o) {
    return this.add(new THREE.BoxGeometry(w, h, d), bone, color, o);
  }

  cyl(bone, rt, rb, h, color, o = {}) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, this.seg(o.seg || 10), 1, !!o.open), bone, color, o);
  }

  sph(bone, r, color, o = {}) {
    return this.add(new THREE.SphereGeometry(r, this.seg(o.ws || 12), this.seg(o.hs || 9), 0, Math.PI * 2, 0, o.half ? Math.PI / 2 : Math.PI), bone, color, o);
  }

  cone(bone, r, h, color, o = {}) {
    return this.add(new THREE.ConeGeometry(r, h, this.seg(o.seg || 10)), bone, color, o);
  }

  torus(bone, r, tube, color, o = {}) {
    return this.add(new THREE.TorusGeometry(r, tube, this.seg(5), this.seg(o.seg || 14), o.arc || Math.PI * 2), bone, color, o);
  }

  // omwentelingslichaam uit [radius, y]-punten
  lathe(bone, pts, color, o = {}) {
    const v = pts.map(([r, y]) => new THREE.Vector2(r, y));
    return this.add(new THREE.LatheGeometry(v, this.seg(o.seg || 12)), bone, color, o);
  }

  build() {
    const g = mergeGeometries(this.geos, false);
    for (const x of this.geos) x.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Basislichaam
// ---------------------------------------------------------------------------
function body(b, S) {
  const skin = S.skin || '#c99b77';
  const lod = b.lod;
  // benen
  for (const [th, sh, side] of [[HB.THIGH_R, HB.SHIN_R, -1], [HB.THIGH_L, HB.SHIN_L, 1]]) {
    if (S.legs === 'plate') {
      b.cyl(th, 0.085, 0.07, 0.44, S.steel || '#a9b0ba', { p: [0, -0.22, 0], metal: 1 });
      b.sph(th, 0.07, S.steel || '#a9b0ba', { p: [0, -0.44, 0.02], metal: 1, s: [1, 1, 1.2] });
      b.cyl(sh, 0.065, 0.05, 0.42, S.steel || '#a9b0ba', { p: [0, -0.21, 0], metal: 1 });
      b.box(sh, 0.1, 0.07, 0.25, S.steel || '#a9b0ba', { p: [0, -0.465, 0.05], metal: 1 });
    } else {
      b.cyl(th, 0.08, 0.062, 0.44, S.legColor || '#3b3a35', { p: [0, -0.22, 0], tint: S.tintLegs ? 1 : 0 });
      b.cyl(sh, 0.06, 0.045, 0.3, S.legColor || '#3b3a35', { p: [0, -0.15, 0] });
      // laarzen
      const bc = S.boots || '#4a3020';
      const tall = S.bootsTall;
      b.cyl(sh, 0.058, 0.052, tall ? 0.34 : 0.18, bc, { p: [0, tall ? -0.3 : -0.38, 0] });
      b.box(sh, 0.095, 0.075, 0.24, bc, { p: [0, -0.465, 0.045] });
      if (S.bootsPointed) b.cone(sh, 0.035, 0.1, bc, { p: [0, -0.475, 0.19], r: [Math.PI / 2, 0, 0], seg: 6, detail: true });
    }
    void side;
  }
  // bekken
  b.cyl(HB.PELVIS, 0.165, 0.15, 0.2, S.hipColor || S.legColor || '#3b3a35', { p: [0, 0.0, 0], s: [1, 1, 0.75] });
  // romp
  const tc = S.torsoColor || '#7a6a50';
  b.lathe(HB.SPINE, [[0.0, -0.02], [0.155, -0.02], [0.165, 0.12], [0.185, 0.3], [0.17, 0.42], [0.09, 0.48], [0.0, 0.49]], tc, { s: [1, 1, 0.7], metal: S.torsoMetal || 0 });
  b.cyl(HB.SPINE, 0.052, 0.058, 0.08, skin, { p: [0, 0.5, 0.005], tint: 1 });
  // armen
  for (const [ua, la, hand] of [[HB.UARM_R, HB.LARM_R, -1], [HB.UARM_L, HB.LARM_L, 1]]) {
    const sc = S.sleeve || tc;
    b.sph(ua, 0.068, S.pauldron || sc, { p: [0, -0.01, 0], metal: S.pauldron ? 1 : 0, s: S.pauldron ? [1.35, 1.0, 1.25] : [1, 1, 1] });
    b.cyl(ua, 0.052, 0.046, 0.28, sc, { p: [0, -0.14, 0], metal: S.armMetal || 0 });
    b.cyl(la, 0.045, 0.038, 0.24, S.forearm || sc, { p: [0, -0.12, 0], metal: S.forearmMetal || 0 });
    if (S.cuffs) b.cyl(la, 0.05, 0.05, 0.05, S.cuffs, { p: [0, -0.21, 0], detail: true });
    b.box(la, 0.075, 0.095, 0.05, S.gloves || skin, { p: [0, -0.27, 0.005], tint: S.gloves ? 0 : 1, metal: S.glovesMetal || 0 });
    void hand;
  }
  // hoofd
  const H = HB.HEAD;
  b.sph(H, 0.108, skin, { p: [0, 0.13, 0.005], s: [0.9, 1.08, 1], tint: 1, ws: 14, hs: 10 });
  b.box(H, 0.026, 0.05, 0.035, skin, { p: [0, 0.12, 0.104], r: [-0.25, 0, 0], tint: 1 }); // neus
  b.sph(H, 0.022, skin, { p: [-0.093, 0.125, 0.0], tint: 1, detail: true }); // oren
  b.sph(H, 0.022, skin, { p: [0.093, 0.125, 0.0], tint: 1, detail: true });
  if (!lod) {
    b.box(H, 0.024, 0.014, 0.01, '#1a1410', { p: [-0.035, 0.145, 0.095] });
    b.box(H, 0.024, 0.014, 0.01, '#1a1410', { p: [0.035, 0.145, 0.095] });
    b.box(H, 0.036, 0.01, 0.012, S.brow || '#2a1a10', { p: [-0.036, 0.168, 0.094], r: [0, 0, 0.12] });
    b.box(H, 0.036, 0.01, 0.012, S.brow || '#2a1a10', { p: [0.036, 0.168, 0.094], r: [0, 0, -0.12] });
  }
  if (S.mustache) {
    b.box(H, 0.05, 0.016, 0.02, S.mustache, { p: [-0.026, 0.087, 0.1], r: [0, 0, 0.3] });
    b.box(H, 0.05, 0.016, 0.02, S.mustache, { p: [0.026, 0.087, 0.1], r: [0, 0, -0.3] });
  }
  if (S.beard) b.sph(H, 0.085, S.beard, { p: [0, 0.06, 0.045], s: [0.95, S.beardLong ? 1.15 : 0.75, 0.75] });
}

// ---------------------------------------------------------------------------
// Kleding en wapenrusting
// ---------------------------------------------------------------------------
function garments(b, S) {
  const P = HB.PELVIS;
  const SP = HB.SPINE;
  const lod = b.lod;
  switch (S.skirt) {
    case 'kaftan': // lange Ottomaanse jas tot onder de knie
      b.lathe(P, [[0.17, 0.08], [0.2, -0.1], [0.27, -0.45], [0.3, -0.62]], S.skirtColor, { s: [1, 1, 0.82], seg: 14 });
      break;
    case 'tunic':
      b.lathe(P, [[0.17, 0.06], [0.2, -0.08], [0.25, -0.3]], S.skirtColor, { s: [1, 1, 0.82] });
      break;
    case 'robe': // tot op de enkels
      b.lathe(P, [[0.17, 0.08], [0.21, -0.1], [0.3, -0.6], [0.34, -0.86]], S.skirtColor, { s: [1, 1, 0.85], seg: 14 });
      break;
    case 'pteruges': // leren stroken onder lamellair
      b.lathe(P, [[0.17, 0.06], [0.21, -0.06], [0.24, -0.26]], S.skirtColor, { s: [1, 1, 0.82] });
      if (!lod) for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        b.box(P, 0.06, 0.22, 0.015, S.strap || '#6b4423', { p: [Math.sin(a) * 0.235, -0.16, Math.cos(a) * 0.19], r: [0, a, 0] });
      }
      break;
    case 'mail': // maliënrok
      b.lathe(P, [[0.17, 0.06], [0.205, -0.08], [0.24, -0.3]], '#7d838c', { s: [1, 1, 0.82], metal: 0.7 });
      break;
    case 'tassets': // plaatharnas: heupplaten
      b.lathe(P, [[0.17, 0.08], [0.2, -0.04], [0.22, -0.18]], S.steel || '#a9b0ba', { s: [1, 1, 0.8], metal: 1 });
      break;
    default:
      break;
  }
  if (S.surcoat) {
    // wapenkleed met kruis/strepen tot op de dij
    b.lathe(P, [[0.175, 0.1], [0.21, -0.05], [0.24, -0.34]], S.surcoat, { s: [1, 1, 0.8] });
    b.lathe(SP, [[0.168, 0.0], [0.18, 0.15], [0.19, 0.3], [0.174, 0.4]], S.surcoat, { s: [1, 1, 0.72], open: true });
    if (S.surcoatCross) {
      b.box(SP, 0.06, 0.4, 0.01, S.surcoatCross, { p: [0, 0.2, 0.138] });
      b.box(SP, 0.3, 0.06, 0.01, S.surcoatCross, { p: [0, 0.28, 0.138] });
      b.box(P, 0.06, 0.4, 0.01, S.surcoatCross, { p: [0, -0.15, 0.18], r: [-0.12, 0, 0] });
    }
    if (S.surcoatStripes) for (let i = 0; i < 4; i++) b.box(SP, 0.3, 0.035, 0.01, S.surcoatStripes, { p: [0, 0.06 + i * 0.09, 0.138] });
  }
  // borststuk
  if (S.chest === 'lamellar') {
    b.lathe(SP, [[0.17, 0.0], [0.18, 0.12], [0.195, 0.3], [0.178, 0.42]], S.lamColor || '#8f96a3', { s: [1, 1, 0.73], metal: 0.8, open: true });
    if (!lod) for (let i = 0; i < 6; i++) b.cyl(SP, 0.196 - Math.abs(i - 3) * 0.004, 0.196, 0.012, S.lamBand || '#5f656e', { p: [0, 0.04 + i * 0.065, 0], s: [1, 1, 0.74], metal: 0.6, open: true });
    if (S.lamGold) b.cyl(SP, 0.2, 0.2, 0.03, '#d4a72c', { p: [0, 0.42, 0], s: [1, 1, 0.74], metal: 1 });
  } else if (S.chest === 'plate') {
    b.lathe(SP, [[0.16, 0.0], [0.19, 0.08], [0.2, 0.25], [0.18, 0.38], [0.12, 0.44]], S.steel || '#b5bcc6', { s: [1, 1, 0.78], metal: 1 });
    b.box(SP, 0.012, 0.32, 0.02, S.steelRidge || '#d5dbe2', { p: [0, 0.2, 0.152], metal: 1, detail: true });
    if (S.goldTrim) b.cyl(SP, 0.205, 0.205, 0.03, '#d4a72c', { p: [0, 0.38, 0], s: [1, 1, 0.78], metal: 1, open: true });
  } else if (S.chest === 'brigandine') {
    b.lathe(SP, [[0.168, 0.0], [0.182, 0.12], [0.195, 0.3], [0.176, 0.42]], S.brigColor || '#8e1b1b', { s: [1, 1, 0.74], open: true });
    if (!lod) for (let r = 0; r < 4; r++) for (let c = -2; c <= 2; c++) b.sph(SP, 0.009, '#d6c38a', { p: [c * 0.055, 0.08 + r * 0.09, 0.143], metal: 1, ws: 5, hs: 4 });
  } else if (S.chest === 'mail') {
    b.lathe(SP, [[0.17, 0.0], [0.18, 0.12], [0.192, 0.3], [0.175, 0.43]], '#7d838c', { s: [1, 1, 0.73], metal: 0.7, open: true });
  } else if (S.chest === 'gambeson') {
    b.lathe(SP, [[0.172, 0.0], [0.186, 0.12], [0.2, 0.3], [0.178, 0.43]], S.gambColor || '#b8a27a', { s: [1, 1, 0.76], open: true });
    if (!lod) for (let i = 0; i < 6; i++) b.box(SP, 0.006, 0.4, 0.01, '#8c7a58', { p: [-0.12 + i * 0.048, 0.21, 0.142] });
  } else if (S.chest === 'kaftan') {
    if (S.inner) b.box(SP, 0.11, 0.38, 0.02, S.inner, { p: [0, 0.2, 0.124] });
    if (!lod && S.buttons) for (let i = 0; i < 5; i++) b.sph(SP, 0.012, S.buttons, { p: [0, 0.06 + i * 0.07, 0.137], metal: 1, ws: 6, hs: 4 });
  }
  if (S.fur) b.torus(SP, 0.15, 0.04, S.fur, { p: [0, 0.43, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.75, 1] });
  // gordel/sjerp
  if (S.sash) b.cyl(SP, 0.172, 0.172, 0.07, S.sash, { p: [0, 0.03, 0], s: [1, 1, 0.75] });
  if (S.belt) {
    b.cyl(SP, 0.17, 0.17, 0.035, S.belt, { p: [0, 0.0, 0], s: [1, 1, 0.75] });
    b.box(SP, 0.04, 0.035, 0.01, '#d4a72c', { p: [0, 0.0, 0.13], metal: 1, detail: true });
  }
  // mantel/cape
  if (S.cape) {
    b.box(HB.CAPE, 0.42, 0.04, 0.1, S.cape, { p: [0, 0.0, 0.03] });
    b.add(new THREE.CylinderGeometry(0.24, 0.36, 1.1, b.seg(10), 1, true, Math.PI * 0.62, Math.PI * 0.76), HB.CAPE, S.cape, { p: [0, -0.55, 0.12], s: [1, 1, 0.55] });
    if (S.capeTrim) b.add(new THREE.CylinderGeometry(0.362, 0.37, 0.05, b.seg(10), 1, true, Math.PI * 0.62, Math.PI * 0.76), HB.CAPE, S.capeTrim, { p: [0, -1.08, 0.12], s: [1, 1, 0.55], detail: true });
  }
  // pijlkoker
  if (S.quiver) {
    b.cyl(HB.EXTRA, 0.065, 0.055, 0.55, S.quiver, { p: [0.12, -0.05, 0.0], r: [0, 0, -0.35] });
    if (!lod) for (let i = 0; i < 5; i++) b.box(HB.EXTRA, 0.012, 0.13, 0.03, '#ece7da', { p: [0.21 + (i - 2) * 0.012, 0.25, (i % 2) * 0.02], r: [0, 0, -0.35] });
  }
}

function headgear(b, S) {
  const H = HB.HEAD;
  const h = S.head;
  if (!h) {
    b.sph(H, 0.112, S.hair || '#2a1a10', { p: [0, 0.155, -0.01], s: [0.93, 0.9, 1], half: true });
    return;
  }
  const c = S.headColor;
  switch (h) {
    case 'bork': // janitsaren-börk: hoge witte vilten muts met afhangende flap
      b.cyl(H, 0.112, 0.112, 0.06, '#d4a72c', { p: [0, 0.21, 0], metal: 0.6 });
      b.cyl(H, 0.085, 0.108, 0.34, c || '#efece4', { p: [0, 0.4, -0.01] });
      b.box(H, 0.15, 0.42, 0.03, c || '#efece4', { p: [0, 0.2, -0.13], r: [0.22, 0, 0] });
      b.box(H, 0.04, 0.12, 0.03, S.ornament || '#d4a72c', { p: [0, 0.3, 0.1], metal: 0.8 });
      if (S.plume) for (let i = -1; i <= 1; i++) b.cone(H, 0.03, 0.45, S.plume, { p: [i * 0.04, 0.72, -0.02], r: [-0.25, 0, i * 0.25], seg: 5 });
      break;
    case 'turban':
      b.sph(H, 0.125, c || '#efe8d8', { p: [0, 0.2, 0], s: [1, 0.75, 1] });
      b.torus(H, 0.11, 0.035, c || '#efe8d8', { p: [0, 0.2, 0], r: [Math.PI / 2, 0, 0] });
      if (S.turbanTop) b.cone(H, 0.06, 0.12, S.turbanTop, { p: [0, 0.3, 0], seg: 8 });
      break;
    case 'greatTurban': // grote kavuk van de sultan
      b.sph(H, 0.19, c || '#f7f4ec', { p: [0, 0.27, 0], s: [1, 0.9, 1] });
      b.torus(H, 0.17, 0.055, c || '#f7f4ec', { p: [0, 0.22, 0], r: [Math.PI / 2, 0, 0] });
      b.torus(H, 0.15, 0.05, '#e9e3d6', { p: [0, 0.31, 0], r: [Math.PI / 2 + 0.2, 0, 0.1] });
      b.cyl(H, 0.06, 0.07, 0.12, S.turbanTop || '#b3141f', { p: [0, 0.44, 0] });
      b.box(H, 0.05, 0.07, 0.02, '#e3b23c', { p: [0, 0.3, 0.19], metal: 1 });
      b.sph(H, 0.022, '#2f8f4a', { p: [0, 0.3, 0.2], metal: 0.5, detail: true });
      b.cone(H, 0.022, 0.32, '#f4f0e6', { p: [0.02, 0.5, 0.15], r: [-0.4, 0, -0.2], seg: 5 }); // sorguç (veer)
      break;
    case 'spikedHelm': // Ottomaanse çiçak met maliënkraag
      b.lathe(H, [[0.122, 0.13], [0.125, 0.2], [0.1, 0.29], [0.04, 0.35], [0.0, 0.43]], c || '#9aa1ab', { metal: 1 });
      b.cyl(H, 0.123, 0.14, 0.14, '#7d838c', { p: [0, 0.07, -0.01], metal: 0.7, open: true });
      b.box(H, 0.02, 0.12, 0.02, c || '#9aa1ab', { p: [0, 0.15, 0.125], metal: 1 });
      if (S.turbanWrap) b.torus(H, 0.125, 0.03, S.turbanWrap, { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0] });
      break;
    case 'byzHelm': // spitse Byzantijnse helm met aventail en pluim
      b.lathe(H, [[0.122, 0.13], [0.124, 0.2], [0.09, 0.3], [0.0, 0.38]], c || '#a9afb8', { metal: 1 });
      b.cyl(H, 0.125, 0.15, 0.16, '#7d838c', { p: [0, 0.06, -0.015], metal: 0.7, open: true });
      b.box(H, 0.022, 0.1, 0.025, c || '#a9afb8', { p: [0, 0.14, 0.125], metal: 1 });
      if (S.plume) b.cone(H, 0.035, 0.22, S.plume, { p: [0, 0.46, -0.03], r: [-0.4, 0, 0], seg: 6 });
      if (S.crest) b.box(H, 0.03, 0.08, 0.26, S.crest, { p: [0, 0.38, -0.02] });
      break;
    case 'stemma': // keizerskroon met pendilia
      b.cyl(H, 0.118, 0.112, 0.09, '#e3b23c', { p: [0, 0.22, 0], metal: 1 });
      b.sph(H, 0.11, '#e3b23c', { p: [0, 0.25, 0], half: true, metal: 1, s: [1, 0.7, 1] });
      b.box(H, 0.02, 0.08, 0.02, '#e3b23c', { p: [0, 0.36, 0], metal: 1 });
      b.box(H, 0.06, 0.02, 0.02, '#e3b23c', { p: [0, 0.37, 0], metal: 1 });
      for (const s of [-1, 1]) b.cyl(H, 0.008, 0.008, 0.16, '#e3b23c', { p: [s * 0.11, 0.12, 0.02], metal: 1, detail: true });
      if (!b.lod) for (let i = 0; i < 6; i++) b.sph(H, 0.014, i % 2 ? '#b3141f' : '#2f6fb3', { p: [Math.sin(i) * 0.118, 0.22, Math.cos(i) * 0.118], ws: 6, hs: 4 });
      b.sph(H, 0.112, S.hair || '#3a2a1c', { p: [0, 0.12, -0.02], s: [0.95, 0.9, 0.95] });
      break;
    case 'despotCrown': // open kroon van de despoot
      b.cyl(H, 0.12, 0.115, 0.07, '#e3b23c', { p: [0, 0.22, 0], metal: 1, open: true });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.cone(H, 0.025, 0.08, '#e3b23c', { p: [Math.sin(a) * 0.115, 0.29, Math.cos(a) * 0.115], seg: 4, metal: 1 });
      }
      b.sph(H, 0.112, S.hair || '#3a2a1c', { p: [0, 0.14, -0.01], s: [0.95, 0.85, 1] });
      break;
    case 'kettle': // ijzerhoed met brede rand
      b.sph(H, 0.125, c || '#8f969f', { p: [0, 0.18, 0], half: true, metal: 1, s: [1, 0.95, 1] });
      b.cyl(H, 0.2, 0.2, 0.012, c || '#8f969f', { p: [0, 0.19, 0], metal: 1, seg: 14 });
      break;
    case 'sallet': // salade met nekscherm
      b.sph(H, 0.128, c || '#b5bcc6', { p: [0, 0.16, -0.01], half: true, metal: 1 });
      b.cyl(H, 0.13, 0.14, 0.09, c || '#b5bcc6', { p: [0, 0.11, -0.01], metal: 1, open: true });
      b.box(H, 0.22, 0.03, 0.12, c || '#b5bcc6', { p: [0, 0.08, -0.13], r: [-0.4, 0, 0], metal: 1 });
      if (S.visor) b.box(H, 0.2, 0.05, 0.03, c || '#b5bcc6', { p: [0, 0.12, 0.125], metal: 1 });
      if (S.plume) b.cone(H, 0.04, 0.25, S.plume, { p: [0, 0.32, -0.08], r: [-0.8, 0, 0], seg: 6 });
      break;
    case 'armet': // gesloten Italiaanse helm
      b.sph(H, 0.135, c || '#c3cad3', { p: [0, 0.13, 0], metal: 1, s: [1, 1.1, 1.05] });
      b.box(H, 0.16, 0.012, 0.02, '#1a1a1a', { p: [0, 0.15, 0.136] });
      b.cone(H, 0.06, 0.12, c || '#c3cad3', { p: [0, 0.1, 0.1], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.6], metal: 1, seg: 8 });
      if (S.plume) for (let i = -1; i <= 1; i++) b.cone(H, 0.035, 0.3, S.plume, { p: [i * 0.03, 0.34, -0.07], r: [-0.7, 0, i * 0.2], seg: 5 });
      break;
    case 'barbuta': // Italiaanse barbuta met T-opening
      b.sph(H, 0.13, c || '#aeb5bf', { p: [0, 0.14, 0], metal: 1, s: [1, 1.15, 1.05] });
      b.box(H, 0.04, 0.12, 0.02, '#151515', { p: [0, 0.1, 0.134] });
      b.box(H, 0.13, 0.03, 0.02, '#151515', { p: [0, 0.15, 0.132] });
      break;
    case 'furHat': // Hongaarse/Servische bontmuts
      b.cyl(H, 0.125, 0.12, 0.13, c || '#4a3426', { p: [0, 0.25, 0] });
      b.sph(H, 0.1, S.hatTop || '#b3141f', { p: [0, 0.31, 0], half: true, s: [1, 0.6, 1] });
      if (S.plume) b.cone(H, 0.025, 0.28, S.plume, { p: [0.05, 0.42, 0.04], r: [-0.25, 0, -0.35], seg: 5 });
      break;
    case 'hood': // mijnwerkerskap
      b.sph(H, 0.13, c || '#5a4632', { p: [0, 0.14, -0.015], s: [1, 1.1, 1.05] });
      b.box(H, 0.16, 0.2, 0.03, c || '#5a4632', { p: [0, 0.02, -0.11], r: [0.3, 0, 0] });
      break;
    case 'redCap': // Venetiaanse berretta
      b.cyl(H, 0.12, 0.112, 0.08, c || '#9b1020', { p: [0, 0.22, 0] });
      b.sph(H, 0.12, c || '#9b1020', { p: [0, 0.26, 0], half: true, s: [1, 0.5, 1] });
      break;
    case 'feltCap': // vilten muts (azap/boogschutter)
      b.lathe(H, [[0.118, 0.15], [0.12, 0.22], [0.08, 0.3], [0.0, 0.32]], c || '#9a2a1c');
      break;
    case 'skullcap':
      b.sph(H, 0.118, c || '#8f969f', { p: [0, 0.15, 0], half: true, metal: 1 });
      break;
    default:
      break;
  }
  if (S.mailCoif) b.cyl(H, 0.125, 0.15, 0.13, '#7d838c', { p: [0, 0.05, -0.02], metal: 0.7, open: true });
}

// ---------------------------------------------------------------------------
// Wapens (greep in de oorsprong, punt/kling langs +Z)
// ---------------------------------------------------------------------------
function weapon(b, bone, model, S) {
  const steel = '#d6dbe0';
  const wood = '#6b4a2b';
  const darkWood = '#4a3020';
  switch (model) {
    case 'kilij': {
      b.box(bone, 0.035, 0.035, 0.15, '#2a1a10', { p: [0, 0, 0.0] });
      b.box(bone, 0.15, 0.025, 0.025, '#d4a72c', { p: [0, 0, 0.085], metal: 1 });
      const segs = [[0.26, 0.22, 0.0], [0.24, 0.46, 0.1], [0.2, 0.66, 0.24], [0.12, 0.8, 0.45]];
      for (const [l, z, r] of segs) b.box(bone, 0.012, 0.042, l, steel, { p: [0, r * 0.18, z], r: [-r, 0, 0], metal: 1 });
      break;
    }
    case 'sword':
      b.box(bone, 0.035, 0.035, 0.15, darkWood, { p: [0, 0, 0] });
      b.sph(bone, 0.03, '#c9a227', { p: [0, 0, -0.09], metal: 1 });
      b.box(bone, 0.2, 0.03, 0.03, '#c9a227', { p: [0, 0, 0.085], metal: 1 });
      b.box(bone, 0.012, 0.05, 0.72, steel, { p: [0, 0, 0.46], metal: 1 });
      b.cone(bone, 0.025, 0.08, steel, { p: [0, 0, 0.86], r: [Math.PI / 2, 0, 0], s: [0.5, 1, 1], metal: 1, seg: 4 });
      break;
    case 'longsword':
      b.box(bone, 0.035, 0.035, 0.26, darkWood, { p: [0, 0, -0.05] });
      b.sph(bone, 0.032, '#a9afb8', { p: [0, 0, -0.2], metal: 1 });
      b.box(bone, 0.26, 0.03, 0.03, '#a9afb8', { p: [0, 0, 0.09], metal: 1 });
      b.box(bone, 0.012, 0.05, 0.92, steel, { p: [0, 0, 0.56], metal: 1 });
      break;
    case 'mace':
      b.cyl(bone, 0.018, 0.02, 0.55, darkWood, { p: [0, 0, 0.17], r: [Math.PI / 2, 0, 0] });
      b.sph(bone, 0.055, '#9aa1ab', { p: [0, 0, 0.47], metal: 1 });
      for (let i = 0; i < 6; i++) b.box(bone, 0.012, 0.09, 0.1, '#9aa1ab', { p: [Math.sin(i) * 0.045, Math.cos(i) * 0.045, 0.47], r: [0, 0, i], metal: 1, detail: true });
      break;
    case 'axe':
      b.cyl(bone, 0.018, 0.02, 0.7, wood, { p: [0, 0, 0.22], r: [Math.PI / 2, 0, 0] });
      b.box(bone, 0.015, 0.17, 0.13, steel, { p: [0, -0.07, 0.52], metal: 1 });
      break;
    case 'pick':
      b.cyl(bone, 0.02, 0.022, 0.75, wood, { p: [0, 0, 0.24], r: [Math.PI / 2, 0, 0] });
      b.cone(bone, 0.025, 0.24, '#6f747a', { p: [0, -0.12, 0.58], r: [Math.PI, 0, 0], metal: 0.8, seg: 5 });
      b.cone(bone, 0.025, 0.16, '#6f747a', { p: [0, 0.08, 0.58], metal: 0.8, seg: 5 });
      break;
    case 'spear':
      b.cyl(bone, 0.018, 0.02, 2.4, wood, { p: [0, 0, 0.15], r: [Math.PI / 2, 0, 0], seg: 6 });
      b.cone(bone, 0.035, 0.26, steel, { p: [0, 0, 1.47], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.35], metal: 1, seg: 6 });
      break;
    case 'pike':
      b.cyl(bone, 0.017, 0.02, 4.8, wood, { p: [0, 0, 0.6], r: [Math.PI / 2, 0, 0], seg: 6 });
      b.cone(bone, 0.025, 0.22, steel, { p: [0, 0, 3.1], r: [Math.PI / 2, 0, 0], metal: 1, seg: 4 });
      break;
    case 'halberd':
      b.cyl(bone, 0.018, 0.02, 2.0, wood, { p: [0, 0, 0.5], r: [Math.PI / 2, 0, 0], seg: 6 });
      b.box(bone, 0.012, 0.24, 0.2, steel, { p: [0, -0.12, 1.42], metal: 1 });
      b.cone(bone, 0.02, 0.1, steel, { p: [0, 0.08, 1.42], r: [0, 0, 0], metal: 1, seg: 4 });
      b.cone(bone, 0.022, 0.25, steel, { p: [0, 0, 1.62], r: [Math.PI / 2, 0, 0], metal: 1, seg: 4 });
      break;
    case 'lance':
      b.cyl(bone, 0.025, 0.04, 3.4, S.lanceColor || '#c9b27a', { p: [0, 0, 0.9], r: [Math.PI / 2, 0, 0], seg: 6 });
      b.cone(bone, 0.09, 0.18, '#9aa1ab', { p: [0, 0, 0.12], r: [-Math.PI / 2, 0, 0], metal: 1, seg: 8 });
      b.cone(bone, 0.03, 0.2, steel, { p: [0, 0, 2.68], r: [Math.PI / 2, 0, 0], metal: 1, seg: 5 });
      if (S.pennon) b.box(bone, 0.005, 0.18, 0.3, S.pennon, { p: [0, 0.1, 2.35], detail: false });
      break;
    case 'turkbow': // Turkse reflexboog: kort, sterk gekromd
      b.box(bone, 0.04, 0.04, 0.12, '#2a1a10', {});
      for (const s of [-1, 1]) {
        b.box(bone, 0.028, 0.025, 0.36, '#7a2a1a', { p: [0, 0.05, s * 0.22], r: [s * 0.35, 0, 0] });
        b.box(bone, 0.024, 0.02, 0.16, '#d4a72c', { p: [0, 0.04, s * 0.45], r: [-s * 0.55, 0, 0] });
      }
      b.box(bone, 0.006, 0.006, 1.0, '#efe6cf', { p: [0, 0.14, 0] });
      break;
    case 'bow':
      b.box(bone, 0.04, 0.04, 0.12, '#2a1a10', {});
      for (const s of [-1, 1]) b.box(bone, 0.03, 0.026, 0.62, '#6b4423', { p: [0, 0.07, s * 0.33], r: [s * 0.28, 0, 0] });
      b.box(bone, 0.006, 0.006, 1.24, '#efe6cf', { p: [0, 0.17, 0] });
      break;
    case 'crossbow':
      b.box(bone, 0.05, 0.07, 0.75, darkWood, { p: [0, 0, 0.12] });
      b.box(bone, 0.72, 0.04, 0.05, '#5d6066', { p: [0, 0.03, 0.46], metal: 0.8 });
      b.torus(bone, 0.06, 0.012, '#5d6066', { p: [0, 0, 0.55], r: [0, Math.PI / 2, 0], metal: 0.8, detail: true });
      b.box(bone, 0.7, 0.006, 0.006, '#efe6cf', { p: [0, 0.05, 0.3], detail: true });
      break;
    case 'arquebus':
      b.box(bone, 0.05, 0.09, 0.42, '#5a3418', { p: [0, -0.02, -0.12] });
      b.box(bone, 0.045, 0.05, 0.45, '#6b4020', { p: [0, 0.02, 0.3] });
      b.cyl(bone, 0.02, 0.025, 1.0, '#3a3a3e', { p: [0, 0.06, 0.45], r: [Math.PI / 2, 0, 0], metal: 0.8, seg: 8 });
      b.box(bone, 0.03, 0.06, 0.06, '#b08a2e', { p: [0.04, 0.03, 0.02], metal: 1, detail: true });
      break;
    case 'javelin':
      b.cyl(bone, 0.013, 0.015, 1.3, wood, { p: [0, 0, 0.2], r: [Math.PI / 2, 0, 0], seg: 5 });
      b.cone(bone, 0.022, 0.15, steel, { p: [0, 0, 0.92], r: [Math.PI / 2, 0, 0], metal: 1, seg: 4 });
      break;
    case 'siphon': // handsifon voor Grieks vuur
      b.cyl(bone, 0.035, 0.045, 0.7, '#b07a2a', { p: [0, 0, 0.25], r: [Math.PI / 2, 0, 0], metal: 0.9, seg: 8 });
      b.cone(bone, 0.06, 0.12, '#b07a2a', { p: [0, 0, 0.64], r: [-Math.PI / 2, 0, 0], metal: 0.9, seg: 8 });
      b.cyl(bone, 0.07, 0.07, 0.22, '#7a5a2a', { p: [0, -0.1, -0.05], metal: 0.6 });
      break;
    default:
      break;
  }
}

// Schilden (vlak naar +Z in de schildruimte), met embleem per factie.
function shield(b, kind, S) {
  const B = HB.SHIELD;
  const face = S.shieldColor || '#8c1c1c';
  const rim = S.shieldRim || '#c9a227';
  const em = S.emblem;
  const ec = S.emblemColor || '#e3b23c';
  const zf = 0.035;
  if (kind === 'round') {
    b.cyl(B, 0.33, 0.33, 0.04, face, { r: [Math.PI / 2, 0, 0], seg: 18 });
    b.torus(B, 0.33, 0.022, rim, { metal: 0.8 });
    b.sph(B, 0.07, rim, { p: [0, 0, 0.02], half: true, r: [Math.PI / 2, 0, 0], metal: 1 });
  } else if (kind === 'kite') {
    b.box(B, 0.4, 0.52, 0.04, face, { p: [0, 0.12, 0] });
    b.cone(B, 0.28, 0.42, face, { p: [0, -0.35, 0], r: [Math.PI, 0, 0], s: [1, 1, 0.14], seg: 4 });
    b.box(B, 0.42, 0.03, 0.05, rim, { p: [0, 0.38, 0], metal: 0.6 });
  } else if (kind === 'pavise') {
    b.box(B, 0.62, 1.05, 0.05, face, { p: [0, 0.1, 0] });
    b.box(B, 0.12, 1.05, 0.08, face, { p: [0, 0.1, 0.02], shade: 0.9 });
    b.box(B, 0.64, 0.04, 0.07, rim, { p: [0, 0.62, 0] });
  } else if (kind === 'tarcsa') { // Hongaarse vleugelschild
    b.box(B, 0.42, 0.62, 0.04, face, { p: [0, 0.05, 0] });
    b.box(B, 0.16, 0.22, 0.04, face, { p: [0.2, 0.38, 0], r: [0, 0, -0.5] });
    b.box(B, 0.44, 0.03, 0.05, rim, { p: [0, -0.26, 0], metal: 0.6 });
  }
  // emblemen
  if (em === 'cross') {
    b.box(B, 0.07, 0.5, 0.01, ec, { p: [0, 0.05, zf] });
    b.box(B, 0.4, 0.07, 0.01, ec, { p: [0, 0.12, zf] });
  } else if (em === 'byzCross') {
    b.box(B, 0.06, 0.46, 0.01, ec, { p: [0, 0, zf], metal: 0.7 });
    b.box(B, 0.46, 0.06, 0.01, ec, { p: [0, 0, zf], metal: 0.7 });
    if (!b.lod) for (const [x, y] of [[-0.13, 0.13], [0.13, 0.13], [-0.13, -0.13], [0.13, -0.13]]) b.torus(B, 0.045, 0.01, ec, { p: [x, y, zf], arc: Math.PI * 1.5, r: [0, 0, x > 0 ? Math.PI : 0], metal: 0.7 });
  } else if (em === 'crescent') {
    b.torus(B, 0.13, 0.03, ec, { p: [0, 0.02, zf], arc: Math.PI * 1.3, r: [0, 0, 0.9] });
  } else if (em === 'lion') { // gevleugelde leeuw van San Marco (gestileerd)
    b.box(B, 0.24, 0.12, 0.01, ec, { p: [0, 0.05, zf] });
    b.sph(B, 0.07, ec, { p: [0.12, 0.14, zf], s: [1, 1, 0.15] });
    b.box(B, 0.22, 0.05, 0.01, ec, { p: [-0.02, 0.2, zf], r: [0, 0, 0.6] });
    b.box(B, 0.03, 0.12, 0.01, ec, { p: [-0.08, -0.06, zf] });
    b.box(B, 0.03, 0.12, 0.01, ec, { p: [0.08, -0.06, zf] });
  } else if (em === 'eagle') { // dubbelkoppige adelaar (gestileerd)
    b.box(B, 0.08, 0.28, 0.01, ec, { p: [0, 0, zf] });
    b.box(B, 0.36, 0.08, 0.01, ec, { p: [0, 0.03, zf], r: [0, 0, 0.0] });
    b.box(B, 0.14, 0.05, 0.01, ec, { p: [-0.13, 0.12, zf], r: [0, 0, 0.6] });
    b.box(B, 0.14, 0.05, 0.01, ec, { p: [0.13, 0.12, zf], r: [0, 0, -0.6] });
    b.sph(B, 0.035, ec, { p: [-0.05, 0.17, zf], s: [1, 1, 0.3] });
    b.sph(B, 0.035, ec, { p: [0.05, 0.17, zf], s: [1, 1, 0.3] });
  } else if (em === 'stripes') {
    for (let i = 0; i < 4; i++) b.box(B, 0.38, 0.06, 0.01, ec, { p: [0, -0.15 + i * 0.12, zf] });
  } else if (em === 'raven') {
    b.sph(B, 0.09, ec, { p: [0, 0.02, zf], s: [1.4, 0.8, 0.15] });
    b.sph(B, 0.04, ec, { p: [0.13, 0.08, zf], s: [1, 1, 0.3] });
    b.torus(B, 0.025, 0.008, '#e3b23c', { p: [0.18, 0.08, zf + 0.01] });
  }
}

// ---------------------------------------------------------------------------
// Uitrusting per eenheidsmodel
// ---------------------------------------------------------------------------
const STEEL = '#b5bcc6';
const SPEC = {
  // ===== Ottomanen =====
  janissary: { skin: '#c99b77', torsoColor: '#a8141e', sleeve: '#a8141e', chest: 'kaftan', inner: '#efe2bf', buttons: '#e0b53a', skirt: 'kaftan', skirtColor: '#a8141e', sash: '#1b6b3a', legColor: '#1f3d7a', boots: '#cf9a1e', bootsTall: true, bootsPointed: true, head: 'bork', mustache: '#2a1a10', quiver: '#7a1a12' },
  janissary_gun: { skin: '#c99b77', torsoColor: '#24407a', sleeve: '#24407a', chest: 'kaftan', inner: '#efe2bf', buttons: '#e0b53a', skirt: 'kaftan', skirtColor: '#24407a', sash: '#a8141e', legColor: '#7a1f1f', boots: '#cf9a1e', bootsTall: true, bootsPointed: true, head: 'bork', mustache: '#1a120c' },
  azap: { skin: '#b98a63', torsoColor: '#8a6a3a', sleeve: '#d8ccb0', skirt: 'tunic', skirtColor: '#8a6a3a', belt: '#4a2f1b', legColor: '#d8ccb0', boots: '#5a3a22', head: 'turban', headColor: '#e9e0cc', turbanTop: '#a8141e', mustache: '#2a1a10', shieldColor: '#a8722a', shieldRim: '#5a3a1a', emblem: null },
  sipahi: { skin: '#c99b77', torsoColor: '#a8141e', sleeve: '#7d838c', chest: 'mail', skirt: 'kaftan', skirtColor: '#a8141e', sash: '#e0b53a', legColor: '#2b4a7a', boots: '#cf9a1e', bootsTall: true, head: 'spikedHelm', turbanWrap: '#efe8d8', mustache: '#2a1a10', shieldColor: '#a8141e', shieldRim: '#d4a72c', emblem: 'crescent', emblemColor: '#efe8d8', pennon: '#a8141e' },
  solak: { skin: '#c99b77', torsoColor: '#b3141f', sleeve: '#b3141f', chest: 'kaftan', inner: '#e3b23c', buttons: '#e0b53a', skirt: 'kaftan', skirtColor: '#b3141f', sash: '#e3b23c', legColor: '#1b6b3a', boots: '#cf9a1e', bootsTall: true, bootsPointed: true, head: 'bork', plume: '#f4f0e6', mustache: '#2a1a10', quiver: '#d4a72c' },
  mehmed: { scale: 1.12, skin: '#c99b77', torsoColor: '#d4a72c', sleeve: '#d4a72c', chest: 'kaftan', inner: '#2f6f3a', buttons: '#f4e6a0', skirt: 'robe', skirtColor: '#c9962a', sash: '#2f6f3a', fur: '#6b4a2e', legColor: '#7a1f1f', boots: '#b3141f', bootsTall: true, bootsPointed: true, head: 'greatTurban', mustache: '#3a2414', beard: '#3a2414', cape: '#2f6f3a', capeTrim: '#d4a72c' },
  // ===== Byzantijnen =====
  skoutatos: { skin: '#cfa27c', torsoColor: '#6a2a7a', sleeve: '#6a2a7a', chest: 'lamellar', skirt: 'pteruges', skirtColor: '#6a2a7a', legColor: '#7a1f1f', boots: '#4a2f1b', bootsTall: true, head: 'byzHelm', plume: '#b3141f', beard: '#3b2414', shieldColor: '#8c1c1c', emblem: 'byzCross' },
  toxotes: { skin: '#cfa27c', torsoColor: '#3a5a7a', sleeve: '#3a5a7a', chest: 'gambeson', gambColor: '#7a6a4a', skirt: 'tunic', skirtColor: '#3a5a7a', belt: '#4a2f1b', legColor: '#6b5a3a', boots: '#4a2f1b', head: 'skullcap', beard: '#3b2414', quiver: '#4a2f1b' },
  siphonarios: { skin: '#cfa27c', torsoColor: '#7a3a1a', sleeve: '#7a3a1a', chest: 'gambeson', gambColor: '#5a4632', skirt: 'tunic', skirtColor: '#7a3a1a', belt: '#2a1a10', legColor: '#4a3a2a', boots: '#2a1a10', head: 'byzHelm', beard: '#2a1a10' },
  kataphrakt: { skin: '#cfa27c', torsoColor: '#5b1a7a', sleeve: '#7d838c', chest: 'lamellar', lamGold: true, skirt: 'mail', legColor: '#5b1a7a', legs: 'plate', steel: '#9aa1ab', head: 'byzHelm', plume: '#e3b23c', mailCoif: true, beard: '#3b2414', cape: '#5b1a7a', pennon: '#5b1a7a', lanceColor: '#8a6a3a' },
  byzguard: { scale: 1.05, skin: '#cfa27c', torsoColor: '#5b1a7a', sleeve: '#5b1a7a', chest: 'lamellar', lamColor: '#c9a85a', lamBand: '#8a6a2a', lamGold: true, skirt: 'pteruges', skirtColor: '#5b1a7a', strap: '#c9a227', legColor: '#5b1a7a', boots: '#7a1f1f', bootsTall: true, head: 'byzHelm', headColor: '#d4b25a', crest: '#b3141f', beard: '#3b2414', cape: '#5b1a7a', shieldColor: '#5b1a7a', emblem: 'byzCross' },
  constantine: { scale: 1.12, skin: '#cfa27c', torsoColor: '#5b1a7a', sleeve: '#5b1a7a', chest: 'lamellar', lamColor: '#d4a72c', lamBand: '#9a7a2a', lamGold: true, skirt: 'pteruges', skirtColor: '#5b1a7a', strap: '#d4a72c', legColor: '#5b1a7a', boots: '#b3141f', bootsTall: true, head: 'stemma', beard: '#4a3020', beardLong: true, cape: '#4b1466', capeTrim: '#d4a72c', shieldColor: '#9b1020', emblem: 'eagle', emblemColor: '#e3b23c' },
  // ===== Genua =====
  gen_crossbow: { skin: '#d6aa86', torsoColor: '#c8102e', sleeve: '#d8ccb0', chest: 'brigandine', brigColor: '#c8102e', skirt: 'tunic', skirtColor: '#d8ccb0', legColor: '#c8102e', boots: '#3a2a1a', head: 'kettle', shieldColor: '#f2f0ea', shieldRim: '#8a6a3a', emblem: 'cross', emblemColor: '#c8102e' },
  gen_spear: { skin: '#d6aa86', torsoColor: '#f2f0ea', sleeve: '#7d838c', chest: 'mail', surcoat: '#f2f0ea', surcoatCross: '#c8102e', legColor: '#c8102e', boots: '#3a2a1a', head: 'sallet', shieldColor: '#f2f0ea', emblem: 'cross', emblemColor: '#c8102e', shieldRim: '#9aa1ab' },
  gen_maa: { skin: '#d6aa86', torsoColor: STEEL, sleeve: STEEL, armMetal: 1, forearmMetal: 1, gloves: STEEL, glovesMetal: 1, chest: 'plate', pauldron: STEEL, surcoat: '#f2f0ea', surcoatCross: '#c8102e', skirt: 'tassets', legs: 'plate', head: 'armet' },
  giustiniani: { scale: 1.1, skin: '#d6aa86', torsoColor: STEEL, sleeve: STEEL, armMetal: 1, forearmMetal: 1, gloves: STEEL, glovesMetal: 1, chest: 'plate', goldTrim: true, pauldron: '#c9cfd8', surcoat: '#f2f0ea', surcoatCross: '#c8102e', skirt: 'tassets', legs: 'plate', head: 'armet', plume: '#c8102e', cape: '#c8102e', capeTrim: '#e3b23c' },
  // ===== Venetië =====
  ven_crossbow: { skin: '#d6aa86', torsoColor: '#8e1b1b', sleeve: '#e3c27a', chest: 'brigandine', brigColor: '#8e1b1b', skirt: 'tunic', skirtColor: '#e3c27a', legColor: '#8e1b1b', boots: '#3a2a1a', head: 'kettle', shieldColor: '#8e1b1b', shieldRim: '#e3b23c', emblem: 'lion', emblemColor: '#e3b23c' },
  ven_gun: { skin: '#d6aa86', torsoColor: '#8e1b1b', sleeve: '#8e1b1b', chest: 'gambeson', gambColor: '#a8322a', skirt: 'tunic', skirtColor: '#8e1b1b', belt: '#3a2a1a', legColor: '#e3c27a', boots: '#3a2a1a', head: 'barbuta' },
  ven_halberd: { skin: '#d6aa86', torsoColor: '#8e1b1b', sleeve: '#7d838c', chest: 'brigandine', brigColor: '#8e1b1b', skirt: 'mail', legColor: '#e3c27a', boots: '#3a2a1a', head: 'barbuta', surcoat: null },
  ven_cav: { skin: '#d6aa86', torsoColor: STEEL, sleeve: STEEL, armMetal: 1, forearmMetal: 1, gloves: STEEL, glovesMetal: 1, chest: 'plate', pauldron: STEEL, surcoat: '#8e1b1b', skirt: 'tassets', legs: 'plate', head: 'sallet', visor: true, plume: '#e3b23c', pennon: '#8e1b1b', lanceColor: '#8e1b1b' },
  minotto: { scale: 1.1, skin: '#d6aa86', torsoColor: '#9b1020', sleeve: '#9b1020', chest: 'plate', steel: '#c9cfd8', goldTrim: true, skirt: 'robe', skirtColor: '#9b1020', fur: '#e8e0d0', legColor: '#9b1020', boots: '#2a1a10', head: 'redCap', headColor: '#9b1020', beard: '#5a4a3a', cape: '#7a0c18', capeTrim: '#e3b23c' },
  // ===== Servië =====
  srb_cav: { skin: '#d1a37e', torsoColor: '#9b1c1c', sleeve: '#7d838c', chest: 'lamellar', skirt: 'mail', legColor: '#4a3a2a', boots: '#3a2a1a', bootsTall: true, head: 'byzHelm', headColor: '#9aa1ab', mailCoif: true, mustache: '#2a1a10', shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea', pennon: '#9b1c1c' },
  srb_spear: { skin: '#d1a37e', torsoColor: '#7a6a4a', sleeve: '#7a6a4a', chest: 'gambeson', gambColor: '#8a7a5a', skirt: 'tunic', skirtColor: '#5a4a3a', legColor: '#4a3a2a', boots: '#3a2a1a', head: 'kettle', mustache: '#2a1a10', shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea', shieldRim: '#6b4423' },
  srb_archer: { skin: '#d1a37e', torsoColor: '#5a3a2a', sleeve: '#5a3a2a', chest: null, skirt: 'tunic', skirtColor: '#5a3a2a', belt: '#2a1a10', legColor: '#7a6a4a', boots: '#3a2a1a', head: 'furHat', headColor: '#3a2a1a', hatTop: '#9b1c1c', mustache: '#2a1a10', quiver: '#3a2a1a' },
  srb_miner: { skin: '#c9946e', torsoColor: '#6b5a42', sleeve: '#6b5a42', chest: 'gambeson', gambColor: '#4a3a2a', skirt: 'tunic', skirtColor: '#3a2a1a', belt: '#2a1a10', legColor: '#4a3a2a', boots: '#2a1a10', head: 'hood', headColor: '#5a4632', beard: '#3a2a1a' },
  srb_guard: { scale: 1.05, skin: '#d1a37e', torsoColor: '#9b1c1c', sleeve: '#9b1c1c', chest: 'lamellar', lamGold: true, skirt: 'mail', legColor: '#9b1c1c', boots: '#3a2a1a', bootsTall: true, head: 'byzHelm', plume: '#f4f1ea', mailCoif: true, mustache: '#2a1a10', cape: '#7a1414', shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea' },
  brankovic: { scale: 1.1, skin: '#d1a37e', torsoColor: '#9b1c1c', sleeve: '#d4a72c', chest: 'kaftan', inner: '#d4a72c', buttons: '#f4e6a0', skirt: 'robe', skirtColor: '#9b1c1c', fur: '#e8e0d0', legColor: '#9b1c1c', boots: '#d4a72c', bootsTall: true, head: 'despotCrown', beard: '#6a5a4a', beardLong: true, cape: '#9b1c1c', capeTrim: '#d4a72c', shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea' },
  // ===== Hongarije =====
  hun_knight: { skin: '#d6aa86', torsoColor: STEEL, sleeve: STEEL, armMetal: 1, forearmMetal: 1, gloves: STEEL, glovesMetal: 1, chest: 'plate', pauldron: STEEL, surcoat: '#c8102e', surcoatStripes: '#f2f0ea', skirt: 'tassets', legs: 'plate', head: 'sallet', visor: true, plume: '#f2f0ea', pennon: '#1d5a32', lanceColor: '#c8102e' },
  hun_light: { skin: '#d6aa86', torsoColor: '#1f4a8a', sleeve: '#1f4a8a', chest: 'kaftan', inner: '#d4a72c', buttons: '#d4a72c', skirt: 'tunic', skirtColor: '#1f4a8a', sash: '#c8102e', legColor: '#c8102e', boots: '#cf9a1e', bootsTall: true, head: 'furHat', headColor: '#2a1e16', hatTop: '#c8102e', plume: '#f2f0ea', mustache: '#3a2414', shieldColor: '#c8102e', emblem: 'stripes', emblemColor: '#f2f0ea', pennon: '#1d5a32' },
  hun_pike: { skin: '#d6aa86', torsoColor: '#1d5a32', sleeve: '#d8ccb0', chest: 'brigandine', brigColor: '#1d5a32', skirt: 'tunic', skirtColor: '#d8ccb0', legColor: '#c8102e', boots: '#3a2a1a', head: 'kettle', mustache: '#3a2414' },
  hun_gun: { skin: '#d6aa86', torsoColor: '#7a6a4a', sleeve: '#7a6a4a', chest: 'gambeson', gambColor: '#9a8a6a', skirt: 'tunic', skirtColor: '#1d5a32', belt: '#3a2a1a', legColor: '#c8102e', boots: '#3a2a1a', head: 'kettle', mustache: '#3a2414', shieldColor: '#1d5a32', shieldRim: '#6b4423', emblem: 'stripes', emblemColor: '#c8102e' },
  hun_guard: { scale: 1.05, skin: '#d6aa86', torsoColor: STEEL, sleeve: STEEL, armMetal: 1, forearmMetal: 1, gloves: STEEL, glovesMetal: 1, chest: 'plate', pauldron: STEEL, surcoat: '#1d5a32', skirt: 'tassets', legs: 'plate', head: 'sallet', plume: '#c8102e', cape: '#1d5a32', shieldColor: '#c8102e', emblem: 'stripes', emblemColor: '#f2f0ea' },
  hunyadi: { scale: 1.12, skin: '#d6aa86', torsoColor: '#c9cfd8', sleeve: '#c9cfd8', armMetal: 1, forearmMetal: 1, gloves: '#c9cfd8', glovesMetal: 1, chest: 'plate', goldTrim: true, pauldron: '#d4a72c', surcoat: '#1f3f7a', skirt: 'tassets', legs: 'plate', head: 'furHat', headColor: '#2a1e16', hatTop: '#c8102e', plume: '#f2f0ea', mustache: '#4a3020', cape: '#9b1020', capeTrim: '#e8e0d0' },
};

// Waar het ongebruikte wapen wordt opgeborgen
function stowFor(model) {
  if (['sword', 'kilij', 'longsword'].includes(model)) return 'hip';
  if (['mace', 'axe', 'pick'].includes(model)) return 'belt';
  if (['pike', 'lance', 'halberd', 'spear'].includes(model)) return 'backLong';
  return 'back';
}

// Bouwt een eenheidsmodel. def = UNITS-entry, weapons = WEAPONS-entries.
export function buildUnitModel(def, weapons, lod) {
  const S = SPEC[def.model];
  if (!S) throw new Error('Onbekend model ' + def.model);
  const b = new MB(lod);
  body(b, S);
  garments(b, S);
  headgear(b, S);
  const info = { scale: S.scale || 1, shield: def.shield, weaponA: weapons[0]?.model, weaponB: weapons[1]?.model };
  if (weapons[0]) weapon(b, HB.WPN_A, weapons[0].model, S);
  if (weapons[1]) weapon(b, HB.WPN_B, weapons[1].model, S);
  info.stowA = stowFor(weapons[0]?.model);
  info.stowB = stowFor(weapons[1]?.model);
  info.hideStowedA = weapons[0]?.model === 'lance' || weapons[0]?.model === 'pike';
  if (def.shield) shield(b, def.shield, S);
  // vaandeldrager
  return { geo: b.build(), info };
}

// Vaandel (apart model aan de EXTRA-bot, gebruikt voor vaandeldragers)
export function buildBanner(color, color2, lod) {
  const b = new MB(lod);
  b.cyl(HB.EXTRA, 0.022, 0.026, 3.4, '#5a3d22', { p: [0, 1.0, -0.05], seg: 6 });
  b.box(HB.EXTRA, 0.01, 0.75, 1.0, color, { p: [0, 2.2, -0.56] });
  b.box(HB.EXTRA, 0.012, 0.12, 1.02, color2, { p: [0, 1.85, -0.56] });
  b.sph(HB.EXTRA, 0.05, '#d4a72c', { p: [0, 2.72, -0.05], metal: 1 });
  return b.build();
}

// ---------------------------------------------------------------------------
// Paard met schabrak/barding in factiekleuren (vacht via tint)
// ---------------------------------------------------------------------------
const HORSE_DRESS = {
  ottoman: { cloth: '#a8141e', trim: '#d4a72c', saddle: '#5a2a1a', plume: '#efe8d8' },
  byzantine: { cloth: '#5b1a7a', trim: '#d4a72c', saddle: '#3a2a1a', mail: true },
  genoa: { cloth: '#f2f0ea', trim: '#c8102e', saddle: '#3a2a1a' },
  venice: { cloth: '#8e1b1b', trim: '#e3b23c', saddle: '#3a2a1a', plate: true },
  serbia: { cloth: '#9b1c1c', trim: '#f4f1ea', saddle: '#3a2a1a' },
  hungary: { cloth: '#c8102e', trim: '#f2f0ea', saddle: '#3a2a1a', stripes: true, plate: true },
};

export function buildHorseModel(faction, lod) {
  const D = HORSE_DRESS[faction] || HORSE_DRESS.ottoman;
  const b = new MB(lod);
  const coat = '#ffffff';
  const T = { tint: 1 };
  const B = PB.BODY;
  // romp (ovaal), borst en achterhand
  b.sph(B, 0.42, coat, { ...T, s: [0.78, 0.85, 1.75], ws: 14, hs: 10 });
  b.sph(B, 0.36, coat, { ...T, p: [0, 0.02, 0.55], s: [0.85, 0.95, 0.9] });
  b.sph(B, 0.38, coat, { ...T, p: [0, 0.05, -0.55], s: [0.88, 0.95, 0.9] });
  // hals en hoofd
  b.cyl(PB.NECK, 0.15, 0.24, 0.75, coat, { ...T, p: [0, 0.3, 0.12], r: [0.55, 0, 0], s: [0.85, 1, 1] });
  b.box(PB.NECK, 0.06, 0.65, 0.12, '#1e1610', { p: [0, 0.35, 0.0], r: [0.55, 0, 0] }); // manen
  b.sph(PB.HEAD, 0.14, coat, { ...T, p: [0, 0.02, 0.05], s: [0.85, 1, 1.1] });
  b.cyl(PB.HEAD, 0.075, 0.11, 0.45, coat, { ...T, p: [0, -0.12, 0.28], r: [-1.05, 0, 0], s: [0.85, 1, 1] });
  b.cone(PB.HEAD, 0.045, 0.14, coat, { ...T, p: [-0.07, 0.17, 0.0], seg: 5 });
  b.cone(PB.HEAD, 0.045, 0.14, coat, { ...T, p: [0.07, 0.17, 0.0], seg: 5 });
  b.box(PB.HEAD, 0.18, 0.03, 0.03, '#2a1a10', { p: [0, -0.05, 0.2], r: [-1.05, 0, 0] }); // hoofdstel
  b.sph(PB.HEAD, 0.02, '#111', { p: [-0.1, 0.02, 0.12], detail: true });
  b.sph(PB.HEAD, 0.02, '#111', { p: [0.1, 0.02, 0.12], detail: true });
  // benen
  for (const [u1, l1] of [[PB.FL_U, PB.FL_L], [PB.FR_U, PB.FR_L], [PB.HL_U, PB.HL_L], [PB.HR_U, PB.HR_L]]) {
    b.cyl(u1, 0.085, 0.065, 0.52, coat, { ...T, p: [0, -0.24, 0] });
    b.cyl(l1, 0.045, 0.04, 0.48, coat, { ...T, p: [0, -0.24, 0] });
    b.cyl(l1, 0.055, 0.065, 0.1, '#1e1610', { p: [0, -0.52, 0.01] });
  }
  b.cone(PB.TAIL, 0.09, 0.7, '#1e1610', { p: [0, -0.35, 0], r: [Math.PI, 0, 0], seg: 6 });
  // schabrak, zadel en tuig
  b.lathe(B, [[0.0, 0.42], [0.37, 0.33], [0.44, 0.0], [0.45, -0.3]], D.cloth, { s: [1, 1, 2.2], p: [0, 0, -0.05], open: true, seg: 14 });
  b.cyl(B, 0.452, 0.452, 0.05, D.trim, { p: [0, -0.3, -0.05], s: [1, 1, 2.2], open: true, detail: true });
  if (D.stripes && !lod) for (let i = 0; i < 4; i++) b.cyl(B, 0.448, 0.448, 0.05, '#f2f0ea', { p: [0, -0.2 + i * 0.12, -0.05], s: [1, 1, 2.21], open: true });
  b.box(B, 0.36, 0.1, 0.55, D.saddle, { p: [0, 0.42, -0.02] });
  b.box(B, 0.3, 0.14, 0.06, D.saddle, { p: [0, 0.5, 0.25] });
  b.box(B, 0.3, 0.12, 0.06, D.saddle, { p: [0, 0.49, -0.3] });
  if (D.mail) b.cyl(PB.NECK, 0.2, 0.27, 0.7, '#7d838c', { p: [0, 0.3, 0.1], r: [0.55, 0, 0], metal: 0.7, s: [0.9, 1, 1], open: true });
  if (D.plate) b.box(PB.HEAD, 0.16, 0.06, 0.45, '#b5bcc6', { p: [0, 0.03, 0.28], r: [-1.05, 0, 0], metal: 1 });
  if (D.plume) b.cone(PB.HEAD, 0.04, 0.22, D.plume, { p: [0, 0.25, 0.0], seg: 5 });
  return b.build();
}

// ---------------------------------------------------------------------------
// Belegeringstuig (vaantje in teamkleur via tint)
// ---------------------------------------------------------------------------
export function buildSiegeModel(kind, lod) {
  const b = new MB(lod);
  const wood = '#6b4a2b';
  const dark = '#4a3020';
  const iron = '#4f5258';
  if (kind === 'bombard') {
    // de reuzenkanonnen van Urban: bronzen loop op een houten slede
    b.box(0, 1.6, 0.4, 4.4, dark, { p: [0, 0.2, 0] });
    b.box(0, 0.25, 0.7, 3.8, wood, { p: [-0.7, 0.55, 0] });
    b.box(0, 0.25, 0.7, 3.8, wood, { p: [0.7, 0.55, 0] });
    b.cyl(1, 0.55, 0.62, 3.6, '#a8772f', { p: [0, 1.15, 0.2], r: [Math.PI / 2, 0, 0], metal: 0.9, seg: 16 });
    b.cyl(1, 0.66, 0.66, 1.0, '#9a6a28', { p: [0, 1.15, -1.5], r: [Math.PI / 2, 0, 0], metal: 0.9, seg: 16 });
    for (let i = 0; i < 4; i++) b.torus(1, 0.6, 0.05, '#c9963a', { p: [0, 1.15, -0.8 + i * 1.0], metal: 1, seg: 16 });
    b.cyl(1, 0.4, 0.4, 0.05, '#111', { p: [0, 1.15, 2.01], r: [Math.PI / 2, 0, 0] });
    for (const x of [-1.2, 1.2]) b.cyl(2, 0.15, 0.15, 0.6, wood, { p: [x, 0.3, 1.6], r: [0, 0, Math.PI / 2] });
    b.cyl(3, 0.02, 0.02, 2.2, dark, { p: [-0.9, 1.1, -2] });
    b.box(3, 0.01, 0.4, 0.7, '#ffffff', { p: [-0.9, 2.0, -2.35], tint: 1 });
  } else if (kind === 'trebuchet') {
    b.box(0, 3.4, 0.3, 4.4, dark, { p: [0, 0.15, 0] });
    for (const x of [-1.2, 1.2]) {
      b.box(0, 0.25, 5.4, 0.3, wood, { p: [x, 2.7, 0.6], r: [0.2, 0, 0] });
      b.box(0, 0.25, 5.4, 0.3, wood, { p: [x, 2.7, -0.6], r: [-0.2, 0, 0] });
    }
    b.cyl(0, 0.12, 0.12, 2.8, iron, { p: [0, 5.2, 0], r: [0, 0, Math.PI / 2], metal: 0.8 });
    // arm (bot 1, draaipunt op de as)
    b.box(1, 0.28, 0.28, 8.5, wood, { p: [0, 0, 1.6] });
    b.box(1, 1.4, 1.4, 1.4, '#5a5a5a', { p: [0, -0.9, -2.4] });
    b.cyl(1, 0.01, 0.01, 2.4, '#d8ccb0', { p: [0, -1.1, 5.8], detail: true });
    for (const x of [-1.6, 1.6]) for (const z of [-1.8, 1.8]) b.cyl(2, 0.35, 0.35, 0.2, wood, { p: [x, 0.35, z], r: [0, 0, Math.PI / 2] });
    b.cyl(3, 0.02, 0.02, 2.0, dark, { p: [1.3, 6.4, 0] });
    b.box(3, 0.01, 0.4, 0.7, '#ffffff', { p: [1.3, 7.2, -0.35], tint: 1 });
  } else if (kind === 'ram') {
    // overdekte stormram met huiden op het dak
    for (const x of [-1, 1]) for (const z of [-1.6, 1.6]) b.box(0, 0.2, 2.6, 0.2, wood, { p: [x, 1.4, z] });
    b.box(0, 2.3, 0.2, 3.8, wood, { p: [0, 0.45, 0] });
    b.add(new THREE.CylinderGeometry(1.5, 1.5, 4.0, 3, 1, true), 0, '#7a5a3a', { p: [0, 2.8, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.75] });
    b.cyl(1, 0.22, 0.25, 4.6, '#5a3d22', { p: [0, 0, 0], r: [Math.PI / 2, 0, 0], seg: 8 });
    b.cyl(1, 0.3, 0.26, 0.45, iron, { p: [0, 0, 2.4], r: [Math.PI / 2, 0, 0], metal: 0.8 });
    for (const x of [-1.25, 1.25]) for (const z of [-1.3, 1.3]) b.cyl(2, 0.4, 0.4, 0.18, dark, { p: [x, 0.4, z], r: [0, 0, Math.PI / 2] });
    b.cyl(3, 0.02, 0.02, 1.6, dark, { p: [0, 3.8, -1.6] });
    b.box(3, 0.01, 0.35, 0.6, '#ffffff', { p: [0, 4.4, -1.9], tint: 1 });
  } else if (kind === 'tower') {
    // belegeringstoren met huiden en valbrug
    b.box(0, 4.2, 0.3, 4.6, dark, { p: [0, 0.4, 0] });
    for (const x of [-1.9, 1.9]) for (const z of [-2.1, 2.1]) b.box(0, 0.3, 11.5, 0.3, wood, { p: [x * 0.92, 6.1, z * 0.92], r: [0, 0, -Math.sign(x) * 0.03] });
    for (let k = 0; k < 4; k++) b.box(0, 3.9, 0.2, 4.3, wood, { p: [0, 2.8 + k * 2.6, 0] });
    b.box(0, 3.6, 10.5, 0.15, '#7a5a3a', { p: [0, 5.8, -2.0] });
    b.box(0, 0.15, 10.5, 4.0, '#6e5236', { p: [-1.85, 5.8, 0] });
    b.box(0, 0.15, 10.5, 4.0, '#6e5236', { p: [1.85, 5.8, 0] });
    b.box(1, 3.4, 0.15, 3.6, wood, { p: [0, 1.8, 0], r: [0, 0, 0] });
    for (const x of [-2, 2]) for (const z of [-1.8, 1.8]) b.cyl(2, 0.55, 0.55, 0.25, dark, { p: [x, 0.55, z], r: [0, 0, Math.PI / 2] });
    b.cyl(3, 0.03, 0.03, 2.5, dark, { p: [0, 12.6, -1.5] });
    b.box(3, 0.01, 0.5, 0.9, '#ffffff', { p: [0, 13.5, -1.95], tint: 1 });
  }
  return b.build();
}

export { SPEC };
