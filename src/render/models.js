import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HB, PB, HUMAN_BIND } from './rig.js';
import { HUMAN_JOINTS as J, compileOutfit, paintOutfit, bodyGeometry, ATLAS } from './human.js';
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { HORSE_HEADER, HORSE_BIN } from './assets/horse-data.js';

// rustposities van het paardenskelet (modelruimte)
export const HORSE_BIND = new Float32Array(HORSE_HEADER.bind.flat());
let HORSE_BASE = null;
function horseBase() {
  if (HORSE_BASE) return HORSE_BASE;
  const s = atob(HORSE_BIN);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  const raw = unzlibSync(u8);
  const b = raw.buffer;
  const o0 = raw.byteOffset;
  HORSE_BASE = HORSE_HEADER.lods.map((L) => ({
    n: L.count,
    pos: new Float32Array(b, o0 + L.pos, L.count * 3),
    nor: new Int8Array(b, o0 + L.nor, L.count * 4),
    si: new Uint8Array(b, o0 + L.si, L.count * 4),
    sw: new Uint8Array(b, o0 + L.sw, L.count * 4),
    rg: new Uint8Array(b, o0 + L.rg, L.count * 4),
    idx: new Uint16Array(b, o0 + L.idx, L.tris * 3),
  }));
  return HORSE_BASE;
}
// paardenlichaam: vacht (tint), manen/staart, hoeven, snuit
function horseBodyGeo(lod, mane = '#1e1610') {
  const H = horseBase()[Math.min(2, lod)];
  const n = H.n;
  const col = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const skin = new Float32Array(n * 4);
  const wts = new Float32Array(n * 4);
  const uv = new Float32Array(n * 2);
  const tint = new Float32Array(n);
  const ao = new Float32Array(n);
  const cm = new THREE.Color(mane);
  const sw = ATLAS.sw.fur;
  for (let i = 0; i < n; i++) {
    const r = H.rg[i * 4];
    const c = r === 0 ? [1, 1, 1] : r === 1 ? [cm.r, cm.g, cm.b] : r === 2 ? [0.06, 0.05, 0.045] : [0.25, 0.2, 0.18];
    col.set(c, i * 3);
    tint[i] = r === 0 ? 1 : r === 3 ? 0.6 : 0;
    ao[i] = H.rg[i * 4 + 1] / 255;
    for (let k = 0; k < 3; k++) nor[i * 3 + k] = H.nor[i * 4 + k] / 127;
    for (let k = 0; k < 4; k++) {
      skin[i * 4 + k] = H.si[i * 4 + k];
      wts[i * 4 + k] = H.sw[i * 4 + k] / 255;
    }
    const x = H.pos[i * 3];
    const y = H.pos[i * 3 + 1];
    const z = H.pos[i * 3 + 2];
    uv[i * 2] = sw[0] + 0.004 + (sw[2] - sw[0] - 0.008) * tri(z * 1.3 + x * 0.5);
    uv[i * 2 + 1] = sw[1] + 0.004 + (sw[3] - sw[1] - 0.008) * tri(y * 1.7);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(H.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSkin', new THREE.BufferAttribute(skin, 4));
  g.setAttribute('aWeight', new THREE.BufferAttribute(wts, 4));
  g.setAttribute('aMetal', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(H.idx), 1));
  return g;
}

// ---------------------------------------------------------------------------
// Modelbouwer: voegt onderdelen samen tot één geometrie met per vertex kleur, skinning
// (aSkin = 4 botnummers, aWeight = 4 gewichten), metaalgehalte, tint-vlag en AO.
// Starre onderdelen hangen aan één bot. Voor botten met een rustpositie (lichaam) wordt het
// onderdeel in botruimte gemodelleerd en hier naar modelruimte verplaatst.
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const tri = (x) => Math.abs((x - Math.floor(x)) * 2 - 1);

// Hoofddeksels zijn geschreven voor een hoofdmiddelpunt op 0,13 boven de nek; schalen naar het echte hoofd.
const HEAD_C = [0, (J.headTop[1] + J.eyeR[1]) / 2 + 0.006 - J.neck[1], (J.headMin[2] + 0.15) / 2 - J.neck[2]];
const HEAD_XF = new THREE.Matrix4()
  .makeTranslation(HEAD_C[0], HEAD_C[1], HEAD_C[2])
  .multiply(new THREE.Matrix4().makeScale(0.9, 0.9, 0.9))
  .multiply(new THREE.Matrix4().makeTranslation(0, -0.13, -0.005));
// Rompdelen zijn geschreven met de schouders op 0,42 boven het rompgewricht
const SPINE_XF = new THREE.Matrix4().makeTranslation(0, J.shoulderR[1] - J.spine[1] - 0.42, J.shoulderR[2] - J.spine[2]);

class MB {
  constructor(lod = 0, bind = null, human = true) {
    this.lod = lod;
    this.bind = bind;
    this.human = human;
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
    if (this.bind) {
      if (this.human && bone === HB.HEAD && !o.raw) geo.applyMatrix4(HEAD_XF);
      else if (this.human && bone === HB.SPINE && !o.raw) geo.applyMatrix4(SPINE_XF);
      const bx = this.bind[bone * 3];
      const by = this.bind[bone * 3 + 1];
      const bz = this.bind[bone * 3 + 2];
      if (bx || by || bz) geo.translate(bx, by, bz);
    }
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    } else if (!(geo.index.array instanceof Uint32Array)) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.index.array), 1));
    const n = geo.attributes.position.count;
    _c.set(color);
    const col = new Float32Array(n * 3);
    const shade = o.shade ?? 1;
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r * shade;
      col[i * 3 + 1] = _c.g * shade;
      col[i * 3 + 2] = _c.b * shade;
    }
    // uv in een materiaalstaal (hout, metaal, leer, stof…) met een driehoeksgolf → geen naden
    const sw = ATLAS.sw[o.mat || ((o.metal || 0) > 0.5 ? 'metal' : 'cloth')];
    const pos = geo.attributes.position;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      uv[i * 2] = sw[0] + 0.004 + (sw[2] - sw[0] - 0.008) * tri(x * 2.3 + z * 1.7);
      uv[i * 2 + 1] = sw[1] + 0.004 + (sw[3] - sw[1] - 0.008) * tri(y * 2.9 + x * 0.7 + z * 0.4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (geo.attributes.uv1) geo.deleteAttribute('uv1');
    const skin = new Float32Array(n * 4);
    const wts = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      skin[i * 4] = bone;
      wts[i * 4] = 1;
    }
    geo.setAttribute('aSkin', new THREE.BufferAttribute(skin, 4));
    geo.setAttribute('aWeight', new THREE.BufferAttribute(wts, 4));
    geo.setAttribute('aMetal', new THREE.BufferAttribute(new Float32Array(n).fill(o.metal || 0), 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(o.tint || 0), 1));
    geo.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(n).fill(o.ao ?? 1), 1));
    this.geos.push(geo);
    return this;
  }

  // geometrie die al alle attributen heeft (lichaam, rokken)
  addRaw(geo) {
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
    this.add(new THREE.LatheGeometry(v, this.seg(o.seg || 12)), bone, color, o);
    // dubbelzijdig: tweede schaal met omgekeerde winding (binnenkant van helmen, kleden…)
    const g = new THREE.LatheGeometry(v, this.seg(o.seg || 12));
    g.scale(-1, 1, 1);
    return this.add(g, bone, color, { ...o, shade: (o.shade ?? 1) * 0.7 });
  }

  build() {
    const g = mergeGeometries(this.geos, false);
    for (const x of this.geos) x.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Lichaam (MakeHuman) als geometrie met alle attributen
// ---------------------------------------------------------------------------
function bodyGeo(outfit, lod) {
  const b = bodyGeometry(outfit, lod);
  const g = new THREE.BufferGeometry();
  const n = b.count;
  g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  const skin = new Float32Array(n * 4);
  const wts = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) {
    skin[i] = b.skin[i];
    wts[i] = b.wts[i] / 255;
  }
  g.setAttribute('aSkin', new THREE.BufferAttribute(skin, 4));
  g.setAttribute('aWeight', new THREE.BufferAttribute(wts, 4));
  g.setAttribute('aMetal', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(b.tint, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(b.ao, 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(b.idx), 1));
  return g;
}

// ---------------------------------------------------------------------------
// Rokken (kaftan, tuniek, maliën, lamellen, heupplaten): ring-mesh rond de heupen die met
// bekken en dijen meebeweegt. Dubbelzijdig (binnenkant zichtbaar bij het lopen).
// k: { top, bottom, color, trim, hem, open (rad), flare, metal, mat, strips, lames, folds }
// ---------------------------------------------------------------------------
function skirtGeo(k, lod) {
  const nR = lod ? 5 : 10;
  const nA = lod ? 18 : 34;
  const top = k.top ?? 1.02;
  const bot = k.bottom;
  const open = k.open || 0;
  const flare = k.flare ?? 0.22;
  const cz = 0.022;
  const pos = [];
  const col = [];
  const skin = [];
  const wts = [];
  const uvs = [];
  const idx = [];
  const sw = ATLAS.sw[k.mat || (k.metal > 0.5 ? 'metal' : 'cloth')];
  const base = new THREE.Color(k.color);
  const trim = new THREE.Color(k.trim || k.color);
  const hem = new THREE.Color(k.hem || k.trim || k.color);
  // gemeten doorsnede van het lichaam (halve breedte) + speling; daaronder uitlopend over de benen
  const radius = (y) => {
    if (y > 1.0) return 0.172 + (1.0 - y) * 0.25;
    if (y > 0.9) return 0.172 + (1.0 - y) * 0.12;
    if (y > 0.82) return 0.184 + (0.9 - y) * 0.15;
    return 0.196 + (0.82 - y) * flare;
  };
  const shells = [0, 1];
  for (const sh of shells) {
    const base0 = pos.length / 3;
    for (let r = 0; r <= nR; r++) {
      const t = r / nR;
      const y = top + (bot - top) * t;
      for (let a = 0; a <= nA; a++) {
        const ang = open / 2 + (a / nA) * (Math.PI * 2 - open);
        const fold = 1 + Math.sin(ang * (k.folds || 11) + 0.6) * 0.035 * t * t + (k.lames ? (((r % 2) * 0.012) / radius(y)) : 0);
        const rr = radius(y) * fold - sh * 0.005 + (k.t || 0);
        const x = Math.sin(ang) * rr;
        const z = Math.cos(ang) * rr * (y > 0.82 ? 0.72 : 0.72 + (0.82 - y) * 0.4) + cz;
        pos.push(x, y, z);
        // kleur: zoom onderaan en langs de voorsluiting
        let c = base;
        if (k.trim && r === nR) c = hem;
        else if (k.trim && open && (a === 0 || a === nA)) c = trim;
        const sd = k.strips ? (Math.floor((a / nA) * k.strips) % 2 ? 0.82 : 1) : 1;
        const shd = (sh ? 0.55 : 1) * sd * (k.lames && r % 2 ? 0.86 : 1);
        col.push(c.r * shd, c.g * shd, c.b * shd);
        // gewichten: bovenaan het bekken, lager steeds meer de dij aan dezelfde kant
        const wt = Math.max(0, Math.min(1, (0.95 - y) / 0.32)) * 0.88;
        const side = Math.max(0, Math.min(1, 0.5 + x / 0.24));
        skin.push(HB.PELVIS, HB.THIGH_L, HB.THIGH_R, 0);
        wts.push(1 - wt, wt * side, wt * (1 - side), 0);
        uvs.push(sw[0] + 0.004 + (sw[2] - sw[0] - 0.008) * tri(ang * 0.6), sw[1] + 0.004 + (sw[3] - sw[1] - 0.008) * tri(y * 2.2));
      }
    }
    for (let r = 0; r < nR; r++) {
      for (let a = 0; a < nA; a++) {
        const i0 = base0 + r * (nA + 1) + a;
        const i1 = i0 + 1;
        const i2 = i0 + nA + 1;
        const i3 = i2 + 1;
        // pteruges: stroken met tussenruimte onder de bovenrand
        if (k.strips && r > 0 && Math.floor((a / nA) * k.strips * 2) % 2 === 1) continue;
        if (sh === 0) idx.push(i0, i2, i1, i1, i2, i3);
        else idx.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aSkin', new THREE.Float32BufferAttribute(skin, 4));
  g.setAttribute('aWeight', new THREE.Float32BufferAttribute(wts, 4));
  const n = pos.length / 3;
  g.setAttribute('aMetal', new THREE.BufferAttribute(new Float32Array(n).fill(k.metal || 0), 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Starre uitrusting op het lichaam: pauldrons, bontkraag, cape, pijlkoker
// ---------------------------------------------------------------------------
function accessories(b, S) {
  if (S.pauldron) {
    for (const [ua, sx] of [[HB.UARM_R, -1], [HB.UARM_L, 1]]) {
      b.sph(ua, 0.085, S.pauldron, { p: [sx * 0.012, 0.0, 0], metal: 1, s: [1.25, 0.95, 1.3], half: true, r: [0, 0, sx * 0.35] });
      b.cyl(ua, 0.075, 0.068, 0.07, S.pauldron, { p: [sx * 0.004, -0.07, 0], metal: 1, open: true, s: [1, 1, 1.05] });
    }
  }
  if (S.couter) for (const la of [HB.LARM_R, HB.LARM_L]) b.sph(la, 0.045, S.couter, { metal: 1, s: [1, 1, 1.1] });
  if (S.fur) b.torus(HB.SPINE, 0.13, 0.038, S.fur, { p: [0, 0.4, 0.0], r: [Math.PI / 2, 0, 0], s: [1, 0.78, 1], mat: 'fur' });
  if (S.gorget) b.cyl(HB.SPINE, 0.075, 0.12, 0.08, S.gorget, { p: [0, 0.43, 0.005], metal: 1, open: true, s: [1, 1, 0.9] });
  if (S.cape) {
    const g = new THREE.CylinderGeometry(0.22, 0.38, 1.12, b.seg(12), 4, true, Math.PI * 0.6, Math.PI * 0.8);
    b.add(g, HB.CAPE, S.cape, { p: [0, -0.56, 0.12], s: [1, 1, 0.55] });
    b.add(new THREE.CylinderGeometry(0.217, 0.377, 1.12, b.seg(12), 4, true, Math.PI * 0.6, Math.PI * 0.8).scale(-1, 1, 1), HB.CAPE, S.capeInner || S.cape, { p: [0, -0.56, 0.12], s: [1, 1, 0.55], shade: 0.6 });
    if (S.capeTrim) b.add(new THREE.CylinderGeometry(0.381, 0.385, 0.05, b.seg(12), 1, true, Math.PI * 0.6, Math.PI * 0.8), HB.CAPE, S.capeTrim, { p: [0, -1.1, 0.12], s: [1, 1, 0.55], detail: true });
    b.box(HB.CAPE, 0.38, 0.035, 0.1, S.cape, { p: [0, 0.0, 0.04] });
  }
  if (S.quiver) {
    b.cyl(HB.EXTRA, 0.06, 0.05, 0.55, S.quiver, { p: [0.12, -0.05, 0.0], r: [0, 0, -0.35], mat: 'leather' });
    b.cyl(HB.EXTRA, 0.062, 0.062, 0.04, S.quiverTrim || '#b08a3a', { p: [0.21, 0.2, 0.0], r: [0, 0, -0.35], metal: 0.7 });
    if (!b.lod) for (let i = 0; i < 6; i++) b.box(HB.EXTRA, 0.008, 0.12, 0.028, i % 2 ? '#e8e2d2' : '#7a2a1a', { p: [0.22 + (i - 2.5) * 0.011, 0.27, (i % 2) * 0.018 - 0.01], r: [0, 0, -0.35] });
  }
  if (S.bag) b.box(HB.PELVIS, 0.12, 0.14, 0.05, S.bag, { p: [-0.17, -0.02, -0.08], r: [0, 0.6, 0], mat: 'leather' });
}

// ---------------------------------------------------------------------------
// Hoofddeksels (geschreven met het hoofdmiddelpunt op 0,13 boven de nek, straal ±0,11)
// ---------------------------------------------------------------------------
function headgear(b, S) {
  const H = HB.HEAD;
  const h = S.head;
  if (!h) return;
  const c = S.headColor;
  switch (h) {
    case 'bork': {
      // janitsaren-börk: witte vilten muts met over de rug afhangende flap (yatırtma) en een
      // koperen lepelhouder (kaşıklık) vooraan
      const felt = c || '#ece8dc';
      b.lathe(H, [[0.118, 0.155], [0.122, 0.2], [0.112, 0.3], [0.1, 0.42], [0.086, 0.54], [0.0, 0.55]], felt, { seg: 18 });
      b.cyl(H, 0.123, 0.125, 0.055, S.borkBand || '#d4b04a', { p: [0, 0.18, 0], metal: 0.7, seg: 18 });
      b.box(H, 0.15, 0.5, 0.025, felt, { p: [0, 0.27, -0.125], r: [0.32, 0, 0] });
      b.box(H, 0.15, 0.32, 0.024, felt, { p: [0, 0.02, -0.21], r: [0.08, 0, 0] });
      b.box(H, 0.04, 0.16, 0.025, S.ornament || '#c9a24a', { p: [0, 0.3, 0.1], r: [-0.1, 0, 0], metal: 0.9 });
      b.cyl(H, 0.012, 0.012, 0.14, S.ornament || '#c9a24a', { p: [0, 0.36, 0.115], r: [-0.1, 0, 0], metal: 0.9, detail: true });
      if (S.plume) for (let i = -2; i <= 2; i++) b.cone(H, 0.025, 0.5, S.plume, { p: [i * 0.03, 0.78, -0.03], r: [-0.3, 0, i * 0.18], seg: 5 });
      break;
    }
    case 'azapCap': // rode vilten muts van de azaps
      b.lathe(H, [[0.117, 0.15], [0.12, 0.2], [0.1, 0.3], [0.06, 0.37], [0.0, 0.38]], c || '#9a2a1c', { seg: 14 });
      b.torus(H, 0.118, 0.018, S.headTrim || '#efe8d8', { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0] });
      break;
    case 'turban':
      b.sph(H, 0.125, c || '#efe8d8', { p: [0, 0.2, 0], s: [1, 0.75, 1] });
      b.torus(H, 0.112, 0.035, c || '#efe8d8', { p: [0, 0.19, 0], r: [Math.PI / 2, 0, 0] });
      b.torus(H, 0.1, 0.03, c || '#efe8d8', { p: [0, 0.24, 0], r: [Math.PI / 2 + 0.2, 0, 0.15], shade: 0.92 });
      if (S.turbanTop) b.cone(H, 0.06, 0.12, S.turbanTop, { p: [0, 0.3, 0], seg: 8 });
      break;
    case 'greatTurban': // grote tulband van de sultan om een rode muts, met sorguç
      b.sph(H, 0.19, c || '#f7f4ec', { p: [0, 0.27, 0], s: [1, 0.85, 1] });
      b.torus(H, 0.165, 0.055, c || '#f7f4ec', { p: [0, 0.22, 0], r: [Math.PI / 2, 0, 0] });
      b.torus(H, 0.15, 0.05, '#e9e3d6', { p: [0, 0.31, 0], r: [Math.PI / 2 + 0.2, 0, 0.1] });
      b.cyl(H, 0.065, 0.075, 0.14, S.turbanTop || '#a8141e', { p: [0, 0.45, 0] });
      b.box(H, 0.05, 0.07, 0.02, '#e3b23c', { p: [0, 0.3, 0.19], metal: 1 });
      b.sph(H, 0.022, '#2f8f4a', { p: [0, 0.3, 0.2], metal: 0.5, detail: true });
      b.cone(H, 0.022, 0.32, '#f4f0e6', { p: [0.02, 0.5, 0.15], r: [-0.4, 0, -0.2], seg: 5 });
      break;
    case 'cicak': // Ottomaanse tulbandhelm (çiçak): bolle schedel, puntige top, neusstang, maliënkraag
      b.lathe(H, [[0.124, 0.12], [0.128, 0.2], [0.11, 0.29], [0.07, 0.35], [0.03, 0.4], [0.008, 0.5], [0.0, 0.52]], c || '#9aa1ab', { metal: 1, seg: 16 });
      b.lathe(H, [[0.126, 0.12], [0.15, 0.04], [0.16, -0.06]], '#6d737c', { metal: 0.75, seg: 16, open: true });
      b.box(H, 0.014, 0.16, 0.012, c || '#9aa1ab', { p: [0, 0.11, 0.132], metal: 1 });
      if (S.turbanWrap) b.torus(H, 0.128, 0.03, S.turbanWrap, { p: [0, 0.17, 0], r: [Math.PI / 2, 0, 0] });
      if (S.gilt) b.cyl(H, 0.129, 0.129, 0.03, '#c9a24a', { p: [0, 0.135, 0], metal: 1, open: true, seg: 16 });
      break;
    case 'byzHelm': // Byzantijnse spangenhelm met maliën-aventail en pluim
      b.lathe(H, [[0.124, 0.12], [0.126, 0.2], [0.09, 0.3], [0.03, 0.37], [0.0, 0.39]], c || '#a9afb8', { metal: 1, seg: 16 });
      for (let i = 0; i < 4; i++) b.box(H, 0.018, 0.25, 0.012, S.helmBand || '#c9a24a', { p: [Math.sin((i * Math.PI) / 2) * 0.108, 0.25, Math.cos((i * Math.PI) / 2) * 0.108], r: [Math.cos((i * Math.PI) / 2) * -0.6, (i * Math.PI) / 2, 0], metal: 0.9, detail: true });
      b.cyl(H, 0.127, 0.127, 0.025, S.helmBand || '#c9a24a', { p: [0, 0.13, 0], metal: 0.9, open: true, seg: 16 });
      b.lathe(H, [[0.127, 0.12], [0.15, 0.04], [0.17, -0.07]], '#6d737c', { metal: 0.75, seg: 16, open: true });
      if (S.plume) b.cone(H, 0.035, 0.24, S.plume, { p: [0, 0.47, -0.03], r: [-0.4, 0, 0], seg: 6 });
      if (S.crest) b.box(H, 0.03, 0.08, 0.26, S.crest, { p: [0, 0.39, -0.02] });
      break;
    case 'stemma': // gesloten keizerskroon (kamelaukion) met pendilia
      b.cyl(H, 0.122, 0.118, 0.09, '#e3b23c', { p: [0, 0.2, 0], metal: 1, seg: 16 });
      b.sph(H, 0.115, '#e3b23c', { p: [0, 0.24, 0], half: true, metal: 1, s: [1, 0.75, 1] });
      b.box(H, 0.02, 0.08, 0.02, '#e3b23c', { p: [0, 0.36, 0], metal: 1 });
      b.box(H, 0.06, 0.02, 0.02, '#e3b23c', { p: [0, 0.37, 0], metal: 1 });
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) b.sph(H, 0.008, k % 2 ? '#efe6d0' : '#b3141f', { p: [s * 0.125, 0.15 - k * 0.025, 0.03], detail: true });
      if (!b.lod) for (let i = 0; i < 8; i++) b.sph(H, 0.013, i % 2 ? '#b3141f' : '#2f6fb3', { p: [Math.sin(i * 0.8) * 0.122, 0.2, Math.cos(i * 0.8) * 0.122], ws: 6, hs: 4 });
      break;
    case 'despotCrown': // open kroon van de despoot
      b.cyl(H, 0.122, 0.118, 0.07, '#e3b23c', { p: [0, 0.2, 0], metal: 1, open: true, seg: 16 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.cone(H, 0.024, 0.08, '#e3b23c', { p: [Math.sin(a) * 0.118, 0.27, Math.cos(a) * 0.118], seg: 4, metal: 1 });
      }
      break;
    case 'kettle': // ijzerhoed (cappello di ferro) met brede rand
      b.lathe(H, [[0.126, 0.13], [0.128, 0.2], [0.11, 0.28], [0.06, 0.32], [0.0, 0.33]], c || '#8f969f', { metal: 1, seg: 16 });
      b.lathe(H, [[0.126, 0.14], [0.21, 0.11], [0.215, 0.1]], c || '#8f969f', { metal: 1, seg: 16, open: true });
      b.lathe(H, [[0.215, 0.098], [0.21, 0.108], [0.126, 0.138]], c || '#8f969f', { metal: 1, seg: 16, open: true, shade: 0.6 });
      b.cyl(H, 0.118, 0.122, 0.03, '#5a3d22', { p: [0, 0.13, 0], open: true, mat: 'leather', seg: 14 });
      break;
    case 'sallet': // salade met nekscherm (en vizier)
      b.lathe(H, [[0.13, 0.11], [0.133, 0.2], [0.11, 0.29], [0.05, 0.33], [0.0, 0.335]], c || '#b5bcc6', { metal: 1, seg: 16 });
      b.add(new THREE.CylinderGeometry(0.135, 0.17, 0.12, b.seg(14), 1, true, Math.PI * 0.55, Math.PI * 0.9), H, c || '#b5bcc6', { p: [0, 0.07, -0.01], metal: 1 });
      if (S.visor) b.add(new THREE.CylinderGeometry(0.138, 0.138, 0.07, b.seg(14), 1, true, -Math.PI * 0.42, Math.PI * 0.84), H, c || '#b5bcc6', { p: [0, 0.15, 0.0], metal: 1 });
      if (S.visor) b.box(H, 0.15, 0.008, 0.01, '#1a1a1a', { p: [0, 0.17, 0.136] });
      if (S.bevor) b.lathe(H, [[0.06, -0.06], [0.12, 0.02], [0.13, 0.1]], c || '#b5bcc6', { p: [0, 0, 0.02], metal: 1, seg: 14, open: true });
      if (S.plume) b.cone(H, 0.04, 0.28, S.plume, { p: [0, 0.34, -0.08], r: [-0.8, 0, 0], seg: 6 });
      break;
    case 'armet': // gesloten Italiaanse helm (armet) met wangstukken en vizier
      b.sph(H, 0.138, c || '#c3cad3', { p: [0, 0.14, 0], metal: 1, s: [1, 1.08, 1.06], ws: 16, hs: 12 });
      b.box(H, 0.16, 0.012, 0.02, '#1a1a1a', { p: [0, 0.155, 0.142] });
      b.lathe(H, [[0.06, 0.0], [0.12, 0.06], [0.13, 0.13]], c || '#c3cad3', { p: [0, -0.02, 0.025], metal: 1, seg: 14, open: true });
      b.cyl(H, 0.008, 0.008, 0.2, c || '#c3cad3', { p: [0, 0.27, 0], r: [Math.PI / 2, 0, 0], metal: 1, detail: true });
      if (S.plume) for (let i = -1; i <= 1; i++) b.cone(H, 0.035, 0.32, S.plume, { p: [i * 0.03, 0.35, -0.08], r: [-0.7, 0, i * 0.2], seg: 5 });
      break;
    case 'barbuta': // Italiaanse barbuta met T-opening
      b.sph(H, 0.134, c || '#aeb5bf', { p: [0, 0.135, 0], metal: 1, s: [1, 1.15, 1.06], ws: 16, hs: 12 });
      b.box(H, 0.04, 0.13, 0.02, '#141414', { p: [0, 0.09, 0.14] });
      b.box(H, 0.13, 0.032, 0.02, '#141414', { p: [0, 0.15, 0.136] });
      break;
    case 'bascinet': // spitse bascinet met maliënkraag
      b.lathe(H, [[0.128, 0.1], [0.13, 0.2], [0.1, 0.3], [0.04, 0.38], [0.0, 0.4]], c || '#a9b0ba', { metal: 1, seg: 16 });
      b.lathe(H, [[0.13, 0.1], [0.16, 0.0], [0.18, -0.08]], '#6d737c', { metal: 0.75, seg: 16, open: true });
      break;
    case 'furHat': // Hongaarse/Servische bontmuts (kalpak) met veer
      b.cyl(H, 0.13, 0.125, 0.14, c || '#3a2a1e', { p: [0, 0.24, 0], mat: 'fur', seg: 16 });
      b.sph(H, 0.11, S.hatTop || '#9b1020', { p: [0, 0.31, 0], half: true, s: [1, 0.55, 1] });
      if (S.plume) b.cone(H, 0.022, 0.32, S.plume, { p: [0.05, 0.44, 0.04], r: [-0.25, 0, -0.35], seg: 5 });
      if (S.jewel) b.sph(H, 0.02, S.jewel, { p: [0.05, 0.27, 0.12], metal: 1, detail: true });
      break;
    case 'hood': // mijnwerkerskap
      b.sph(H, 0.135, c || '#5a4632', { p: [0, 0.14, -0.015], s: [1, 1.1, 1.05], half: true });
      b.cyl(H, 0.135, 0.15, 0.12, c || '#5a4632', { p: [0, 0.08, -0.02], open: true, s: [1, 1, 1.05] });
      b.lathe(H, [[0.15, 0.04], [0.21, -0.06], [0.22, -0.1]], c || '#5a4632', { open: true, seg: 14 });
      break;
    case 'beret': // Venetiaanse patriciërsmuts (berretta)
      b.cyl(H, 0.123, 0.118, 0.07, c || '#8a1020', { p: [0, 0.2, 0], seg: 16 });
      b.sph(H, 0.125, c || '#8a1020', { p: [0, 0.24, 0], half: true, s: [1, 0.55, 1] });
      break;
    case 'feltCap': // vilten muts
      b.lathe(H, [[0.118, 0.15], [0.12, 0.22], [0.08, 0.3], [0.0, 0.32]], c || '#6a4a2a', { seg: 14 });
      break;
    case 'coif': // maliënkap
      b.sph(H, 0.132, '#7d838c', { p: [0, 0.14, 0], metal: 0.75, half: true, s: [1, 1.1, 1.05] });
      b.cyl(H, 0.132, 0.16, 0.16, '#7d838c', { p: [0, 0.06, -0.01], metal: 0.75, open: true });
      break;
    default:
      break;
  }
  if (S.mailCoif && h !== 'coif') b.lathe(H, [[0.128, 0.13], [0.15, 0.04], [0.17, -0.07]], '#6d737c', { metal: 0.75, seg: 16, open: true });
}

// ---------------------------------------------------------------------------
// Wapens (greep in de oorsprong, punt/kling langs +Z)
// ---------------------------------------------------------------------------
function weapon(b, bone, model, S) {
  const steel = '#d6dbe0';
  const wood = '#6b4a2b';
  const darkWood = '#4a3020';
  const W = { mat: 'wood' };
  const L = { mat: 'leather' };
  switch (model) {
    case 'kilij': {
      b.cyl(bone, 0.016, 0.018, 0.13, '#2a1a10', { p: [0, 0, 0.0], r: [Math.PI / 2, 0, 0], ...L });
      b.box(bone, 0.13, 0.022, 0.022, '#d4a72c', { p: [0, 0, 0.075], metal: 1 });
      b.sph(bone, 0.022, '#d4a72c', { p: [0, 0, -0.075], metal: 1 });
      const segs = [[0.26, 0.21, 0.0], [0.24, 0.45, 0.1], [0.2, 0.65, 0.24], [0.13, 0.8, 0.45]];
      for (const [l, z, r] of segs) b.box(bone, 0.008, 0.04, l, steel, { p: [0, r * 0.18, z], r: [-r, 0, 0], metal: 1 });
      break;
    }
    case 'sword':
      b.cyl(bone, 0.016, 0.017, 0.14, darkWood, { p: [0, 0, 0], r: [Math.PI / 2, 0, 0], ...L });
      b.sph(bone, 0.028, '#c9a227', { p: [0, 0, -0.085], metal: 1 });
      b.box(bone, 0.2, 0.024, 0.024, '#c9a227', { p: [0, 0, 0.08], metal: 1 });
      b.box(bone, 0.008, 0.046, 0.72, steel, { p: [0, 0, 0.45], metal: 1 });
      b.box(bone, 0.012, 0.012, 0.6, '#aeb4bb', { p: [0, 0, 0.4], metal: 1, detail: true });
      b.cone(bone, 0.023, 0.08, steel, { p: [0, 0, 0.85], r: [Math.PI / 2, 0, 0], s: [0.35, 1, 1], metal: 1, seg: 4 });
      break;
    case 'longsword':
      b.cyl(bone, 0.016, 0.017, 0.26, darkWood, { p: [0, 0, -0.05], r: [Math.PI / 2, 0, 0], ...L });
      b.sph(bone, 0.03, '#a9afb8', { p: [0, 0, -0.19], metal: 1 });
      b.box(bone, 0.26, 0.026, 0.026, '#a9afb8', { p: [0, 0, 0.09], metal: 1 });
      b.box(bone, 0.008, 0.05, 0.92, steel, { p: [0, 0, 0.56], metal: 1 });
      b.cone(bone, 0.025, 0.08, steel, { p: [0, 0, 1.06], r: [Math.PI / 2, 0, 0], s: [0.35, 1, 1], metal: 1, seg: 4 });
      break;
    case 'mace':
      b.cyl(bone, 0.016, 0.018, 0.55, darkWood, { p: [0, 0, 0.17], r: [Math.PI / 2, 0, 0], ...W });
      b.sph(bone, 0.045, '#8f969f', { p: [0, 0, 0.47], metal: 1 });
      for (let i = 0; i < 7; i++) b.box(bone, 0.01, 0.085, 0.11, '#9aa1ab', { p: [Math.sin((i / 7) * Math.PI * 2) * 0.038, Math.cos((i / 7) * Math.PI * 2) * 0.038, 0.47], r: [0, 0, -(i / 7) * Math.PI * 2], metal: 1 });
      break;
    case 'axe':
      b.cyl(bone, 0.017, 0.019, 0.7, wood, { p: [0, 0, 0.22], r: [Math.PI / 2, 0, 0], ...W });
      b.box(bone, 0.012, 0.16, 0.12, steel, { p: [0, -0.07, 0.52], metal: 1 });
      b.box(bone, 0.012, 0.2, 0.03, '#eef1f4', { p: [0, -0.15, 0.52], metal: 1 });
      break;
    case 'pick':
      b.cyl(bone, 0.02, 0.022, 0.75, wood, { p: [0, 0, 0.24], r: [Math.PI / 2, 0, 0], ...W });
      b.cone(bone, 0.025, 0.24, '#6f747a', { p: [0, -0.12, 0.58], r: [Math.PI, 0, 0], metal: 0.8, seg: 5 });
      b.cone(bone, 0.025, 0.16, '#6f747a', { p: [0, 0.08, 0.58], metal: 0.8, seg: 5 });
      break;
    case 'spear':
      b.cyl(bone, 0.016, 0.019, 2.4, wood, { p: [0, 0, 0.15], r: [Math.PI / 2, 0, 0], seg: 6, ...W });
      b.cone(bone, 0.032, 0.28, steel, { p: [0, 0, 1.49], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.3], metal: 1, seg: 6 });
      b.cyl(bone, 0.02, 0.02, 0.08, '#6f747a', { p: [0, 0, 1.33], r: [Math.PI / 2, 0, 0], metal: 0.8, seg: 6 });
      break;
    case 'pike':
      b.cyl(bone, 0.016, 0.019, 4.8, wood, { p: [0, 0, 0.6], r: [Math.PI / 2, 0, 0], seg: 6, ...W });
      b.cone(bone, 0.024, 0.22, steel, { p: [0, 0, 3.1], r: [Math.PI / 2, 0, 0], metal: 1, seg: 4 });
      break;
    case 'halberd':
      b.cyl(bone, 0.017, 0.019, 2.0, wood, { p: [0, 0, 0.5], r: [Math.PI / 2, 0, 0], seg: 6, ...W });
      b.box(bone, 0.01, 0.24, 0.2, steel, { p: [0, -0.12, 1.42], metal: 1 });
      b.cone(bone, 0.02, 0.1, steel, { p: [0, 0.08, 1.42], metal: 1, seg: 4 });
      b.cone(bone, 0.022, 0.25, steel, { p: [0, 0, 1.62], r: [Math.PI / 2, 0, 0], metal: 1, seg: 4 });
      break;
    case 'lance':
      b.cyl(bone, 0.025, 0.04, 3.4, S.lanceColor || '#c9b27a', { p: [0, 0, 0.9], r: [Math.PI / 2, 0, 0], seg: 8, ...W });
      b.cone(bone, 0.09, 0.18, '#9aa1ab', { p: [0, 0, 0.12], r: [-Math.PI / 2, 0, 0], metal: 1, seg: 8 });
      b.cone(bone, 0.03, 0.2, steel, { p: [0, 0, 2.68], r: [Math.PI / 2, 0, 0], metal: 1, seg: 5 });
      if (S.pennon) b.box(bone, 0.004, 0.18, 0.32, S.pennon, { p: [0, 0.1, 2.35] });
      break;
    case 'turkbow': // Turkse composietboog: kort, sterk gekromd, met bot/hoorn-versiering
      b.box(bone, 0.032, 0.034, 0.12, '#3a2414', { ...L });
      for (const s of [-1, 1]) {
        b.box(bone, 0.024, 0.022, 0.36, '#6a2a18', { p: [0, 0.05, s * 0.22], r: [s * 0.35, 0, 0], ...W });
        b.box(bone, 0.02, 0.018, 0.16, '#d4b06a', { p: [0, 0.045, s * 0.45], r: [-s * 0.6, 0, 0], ...W });
      }
      b.box(bone, 0.004, 0.004, 1.0, '#efe6cf', { p: [0, 0.14, 0] });
      break;
    case 'bow':
      b.box(bone, 0.034, 0.034, 0.12, '#2a1a10', { ...L });
      for (const s of [-1, 1]) b.box(bone, 0.026, 0.022, 0.62, '#6b4423', { p: [0, 0.07, s * 0.33], r: [s * 0.28, 0, 0], ...W });
      b.box(bone, 0.004, 0.004, 1.24, '#efe6cf', { p: [0, 0.17, 0] });
      break;
    case 'crossbow':
      b.box(bone, 0.045, 0.06, 0.75, darkWood, { p: [0, 0, 0.12], ...W });
      b.box(bone, 0.7, 0.035, 0.045, '#5d6066', { p: [0, 0.03, 0.46], metal: 0.8 });
      b.torus(bone, 0.055, 0.01, '#5d6066', { p: [0, 0, 0.56], r: [0, Math.PI / 2, 0], metal: 0.8, detail: true });
      b.box(bone, 0.7, 0.004, 0.004, '#efe6cf', { p: [0, 0.05, 0.3], detail: true });
      break;
    case 'arquebus':
      b.box(bone, 0.045, 0.085, 0.42, '#5a3418', { p: [0, -0.02, -0.12], ...W });
      b.box(bone, 0.04, 0.045, 0.45, '#6b4020', { p: [0, 0.02, 0.3], ...W });
      b.cyl(bone, 0.018, 0.024, 1.0, '#3a3a3e', { p: [0, 0.06, 0.45], r: [Math.PI / 2, 0, 0], metal: 0.8, seg: 8 });
      b.box(bone, 0.03, 0.05, 0.06, '#b08a2e', { p: [0.04, 0.03, 0.02], metal: 1, detail: true });
      break;
    case 'javelin':
      b.cyl(bone, 0.012, 0.014, 1.3, wood, { p: [0, 0, 0.2], r: [Math.PI / 2, 0, 0], seg: 5, ...W });
      b.cone(bone, 0.02, 0.15, steel, { p: [0, 0, 0.92], r: [Math.PI / 2, 0, 0], metal: 1, seg: 4 });
      break;
    case 'siphon': // handsifon voor Grieks vuur
      b.cyl(bone, 0.032, 0.042, 0.7, '#b07a2a', { p: [0, 0, 0.25], r: [Math.PI / 2, 0, 0], metal: 0.9, seg: 8 });
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
  const zf = 0.03;
  if (kind === 'round') {
    b.cyl(B, 0.33, 0.31, 0.035, face, { r: [Math.PI / 2, 0, 0], seg: 20, mat: S.shieldMat || 'wood' });
    b.torus(B, 0.325, 0.018, rim, { metal: 0.8, seg: 20 });
    b.sph(B, 0.065, rim, { p: [0, 0, 0.018], half: true, r: [Math.PI / 2, 0, 0], metal: 1 });
  } else if (kind === 'kite') {
    b.box(B, 0.4, 0.5, 0.035, face, { p: [0, 0.12, 0], mat: 'wood' });
    b.cone(B, 0.28, 0.42, face, { p: [0, -0.34, 0], r: [Math.PI, 0, 0], s: [1, 1, 0.12], seg: 4, mat: 'wood' });
    b.box(B, 0.42, 0.03, 0.045, rim, { p: [0, 0.37, 0], metal: 0.6 });
  } else if (kind === 'pavise') {
    b.box(B, 0.62, 1.05, 0.045, face, { p: [0, 0.1, 0], mat: 'wood' });
    b.box(B, 0.13, 1.05, 0.07, face, { p: [0, 0.1, 0.02], shade: 0.9, mat: 'wood' });
    b.box(B, 0.64, 0.035, 0.06, rim, { p: [0, 0.62, 0], mat: 'wood' });
  } else if (kind === 'tarcsa') { // Hongaars schild met opstaande "vleugel"
    b.box(B, 0.42, 0.62, 0.035, face, { p: [0, 0.05, 0], mat: 'wood' });
    b.box(B, 0.16, 0.22, 0.035, face, { p: [0.2, 0.38, 0], r: [0, 0, -0.5], mat: 'wood' });
    b.box(B, 0.44, 0.03, 0.045, rim, { p: [0, -0.26, 0], metal: 0.6 });
  }
  // emblemen
  if (em === 'cross') { // kruis van Sint-Joris
    b.box(B, 0.08, kind === 'pavise' ? 0.9 : 0.5, 0.01, ec, { p: [0, kind === 'pavise' ? 0.1 : 0.05, zf + (kind === 'pavise' ? 0.035 : 0)] });
    b.box(B, kind === 'pavise' ? 0.6 : 0.4, 0.08, 0.01, ec, { p: [0, kind === 'pavise' ? 0.28 : 0.12, zf + (kind === 'pavise' ? 0.035 : 0)] });
  } else if (em === 'byzCross') { // Palaiologen: kruis met vier vuurslagen (B's)
    b.box(B, 0.05, 0.46, 0.01, ec, { p: [0, 0, zf], metal: 0.7 });
    b.box(B, 0.46, 0.05, 0.01, ec, { p: [0, 0, zf], metal: 0.7 });
    if (!b.lod) for (const [x, y] of [[-0.13, 0.13], [0.13, 0.13], [-0.13, -0.13], [0.13, -0.13]]) {
      const sx = x < 0 ? 1 : -1;
      b.torus(B, 0.034, 0.009, ec, { p: [x, y + 0.03, zf], arc: Math.PI, r: [0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2], metal: 0.7 });
      b.torus(B, 0.034, 0.009, ec, { p: [x, y - 0.035, zf], arc: Math.PI, r: [0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2], metal: 0.7 });
      b.box(B, 0.01, 0.13, 0.01, ec, { p: [x + sx * 0.0, y, zf], metal: 0.7 });
    }
  } else if (em === 'kalkan') { // Ottomaans gevlochten schild: concentrische banden
    for (let i = 1; i <= 3; i++) b.torus(B, 0.08 * i + 0.02, 0.012, ec, { p: [0, 0, zf - 0.008], seg: 18 });
  } else if (em === 'lion') { // gevleugelde leeuw van San Marco (gestileerd)
    b.box(B, 0.24, 0.1, 0.01, ec, { p: [0, 0.05 + (kind === 'pavise' ? 0.15 : 0), zf + 0.03] });
    b.sph(B, 0.065, ec, { p: [0.12, 0.14 + (kind === 'pavise' ? 0.15 : 0), zf + 0.03], s: [1, 1, 0.15] });
    b.box(B, 0.22, 0.05, 0.01, ec, { p: [-0.03, 0.2 + (kind === 'pavise' ? 0.15 : 0), zf + 0.03], r: [0, 0, 0.6] });
    b.box(B, 0.025, 0.12, 0.01, ec, { p: [-0.08, -0.05 + (kind === 'pavise' ? 0.15 : 0), zf + 0.03] });
    b.box(B, 0.025, 0.12, 0.01, ec, { p: [0.08, -0.05 + (kind === 'pavise' ? 0.15 : 0), zf + 0.03] });
  } else if (em === 'eagle') { // dubbelkoppige adelaar (gestileerd)
    b.box(B, 0.07, 0.26, 0.01, ec, { p: [0, 0.0, zf] });
    b.box(B, 0.34, 0.07, 0.01, ec, { p: [0, 0.04, zf] });
    b.box(B, 0.13, 0.045, 0.01, ec, { p: [-0.12, 0.13, zf], r: [0, 0, 0.6] });
    b.box(B, 0.13, 0.045, 0.01, ec, { p: [0.12, 0.13, zf], r: [0, 0, -0.6] });
    b.sph(B, 0.032, ec, { p: [-0.05, 0.17, zf], s: [1, 1, 0.3] });
    b.sph(B, 0.032, ec, { p: [0.05, 0.17, zf], s: [1, 1, 0.3] });
    b.box(B, 0.12, 0.05, 0.01, ec, { p: [0, -0.15, zf] });
  } else if (em === 'stripes') { // Árpád-strepen
    for (let i = 0; i < 4; i++) b.box(B, 0.38, 0.055, 0.01, ec, { p: [0, -0.15 + i * 0.12 + (kind === 'pavise' ? 0.2 : 0), zf + (kind === 'pavise' ? 0.035 : 0)] });
  } else if (em === 'raven') { // raaf van Hunyadi met gouden ring
    b.sph(B, 0.085, ec, { p: [0, 0.02, zf], s: [1.4, 0.8, 0.15] });
    b.sph(B, 0.038, ec, { p: [0.13, 0.08, zf], s: [1, 1, 0.3] });
    b.torus(B, 0.025, 0.008, '#e3b23c', { p: [0.18, 0.08, zf + 0.01], metal: 1 });
  } else if (em === 'doubleCross') { // Hongaars dubbelkruis
    b.box(B, 0.045, 0.42, 0.01, ec, { p: [0, 0.02 + (kind === 'pavise' ? 0.15 : 0), zf + 0.035] });
    b.box(B, 0.22, 0.045, 0.01, ec, { p: [0, 0.12 + (kind === 'pavise' ? 0.15 : 0), zf + 0.035] });
    b.box(B, 0.3, 0.045, 0.01, ec, { p: [0, 0.0 + (kind === 'pavise' ? 0.15 : 0), zf + 0.035] });
  }
}

// ---------------------------------------------------------------------------
// Uitrusting per eenheidsmodel (rond 1453). Lagen van buiten naar binnen.
//   face: huid, haar, baard/snor, ogen
//   layers: [laag, opties] — zie human.js (coat, mail, lamellar, brigandine, plate, tabard, belt, boots…)
//   skirts: rokken als losse geometrie; head: hoofddeksel; overige: starre onderdelen
// ---------------------------------------------------------------------------
const STEEL = '#b9c0c9';
const DARKSTEEL = '#8f969f';
const OTT_SKIN = '#c08a62';
const MED_SKIN = '#c9946e';
const N_SKIN = '#d4a283';

// bouwstenen
const plateHarness = (c = STEEL, trim) => [
  ['gloves', { color: c, metal: true }],
  ['vambrace', { color: c }],
  ['rerebrace', { color: c }],
  ['plate', { color: c, trim }],
  ['sabatons', { color: c }],
  ['greaves', { color: c }],
  ['cuisses', { color: c }],
];

const SPEC = {
  // ===== Ottomanen =====
  // Janitsaar: witte börk, lange dolama (hier blauw) met zijden sjerp, wijde şalvar, gele laarzen; alleen snor.
  janissary: {
    face: { skin: OTT_SKIN, hair: '#1b120c', mustache: 'long' },
    layers: [
      ['belt', { y: 1.03, w: 0.045, color: '#c9a24a', sash: true }],
      ['coat', { color: '#2b4583', sleeves: 'long', neck: 'v', open: true, inner: '#e6dcc4', trim: '#c9a24a', trimW: 0.005, cuff: '#c9a24a' }],
      ['boots', { color: '#c79a2c', top: 0.4 }],
      ['hose', { color: '#d8cfba' }],
    ],
    skirts: [{ bottom: 0.3, color: '#2b4583', open: 0.55, trim: '#c9a24a', flare: 0.3 }],
    head: 'bork', quiver: '#7a1a12',
  },
  janissary_gun: {
    face: { skin: OTT_SKIN, hair: '#16100b', mustache: 'long' },
    layers: [
      ['belt', { y: 1.03, w: 0.045, color: '#2b4583', sash: true }],
      ['coat', { color: '#8e1b1f', sleeves: 'long', neck: 'v', open: true, inner: '#e6dcc4', trim: '#c9a24a', trimW: 0.005 }],
      ['boots', { color: '#c79a2c', top: 0.4 }],
      ['hose', { color: '#d8cfba' }],
    ],
    skirts: [{ bottom: 0.3, color: '#8e1b1f', open: 0.55, trim: '#c9a24a', flare: 0.3 }],
    head: 'bork', bag: '#5a3a1a',
  },
  // Azap: lichte infanterie, rode vilten muts, eenvoudige entari en een gevlochten rond schild.
  azap: {
    face: { skin: '#b9845c', hair: '#1e150e', beardStyle: 'short', mustache: 'short', beard: '#1e150e' },
    layers: [
      ['belt', { y: 1.03, w: 0.03, color: '#4a2f1b', buckle: '#9a8a6a' }],
      ['coat', { color: '#9c7a4c', sleeves: 'long', neck: 'v' }],
      ['boots', { color: '#5a3a22', top: 0.3 }],
      ['hose', { color: '#d4c8ae' }],
    ],
    skirts: [{ bottom: 0.56, color: '#9c7a4c', flare: 0.25 }],
    head: 'azapCap', headColor: '#a0281c',
    shieldColor: '#b8945a', shieldRim: '#6a4a2a', emblem: 'kalkan', emblemColor: '#a0281c',
  },
  // Sipahi: çiçak-helm met maliënkraag, maliënhemd over een rode kaftan, gele laarzen, lans met wimpel.
  sipahi: {
    face: { skin: OTT_SKIN, hair: '#1b120c', beardStyle: 'full', mustache: 'long' },
    layers: [
      ['belt', { y: 1.03, w: 0.035, color: '#3a2414', buckle: '#c9a24a' }],
      ['mail', { sleeves: 'elbow', bottom: 0.86 }],
      ['coat', { color: '#9b1d20', sleeves: 'long' }],
      ['boots', { color: '#c79a2c', top: 0.42 }],
      ['hose', { color: '#2b4583' }],
    ],
    skirts: [{ bottom: 0.62, color: '#7d838c', metal: 0.75, mat: 'metal', flare: 0.18, t: 0.01 }, { bottom: 0.4, color: '#9b1d20', open: 0.5, trim: '#c9a24a', flare: 0.3 }],
    head: 'cicak', turbanWrap: '#efe8d8',
    shieldColor: '#b8945a', shieldRim: '#c9a24a', emblem: 'kalkan', emblemColor: '#9b1d20', pennon: '#9b1d20', shieldMat: 'cloth',
  },
  // Solak: lijfwacht-boogschutters van de sultan; börk met witte veren, rode dolama.
  solak: {
    face: { skin: OTT_SKIN, hair: '#1b120c', mustache: 'long' },
    layers: [
      ['belt', { y: 1.03, w: 0.045, color: '#d4b04a', sash: true }],
      ['coat', { color: '#a8141e', sleeves: 'long', neck: 'v', open: true, inner: '#e3b23c', trim: '#e3c06a', trimW: 0.006, brocade: '#d4a72c' }],
      ['boots', { color: '#a8141e', top: 0.42 }],
      ['hose', { color: '#1b6b3a' }],
    ],
    skirts: [{ bottom: 0.3, color: '#a8141e', open: 0.55, trim: '#e3c06a', flare: 0.3 }],
    head: 'bork', plume: '#f4f0e6', quiver: '#d4a72c',
  },
  // Mehmed II (21 jaar): korte baard, grote tulband om een rode muts, brokaten kaftan met bont.
  mehmed: {
    scale: 1.05,
    face: { skin: '#c48e66', hair: '#2a1a10', beardStyle: 'short', mustache: 'long' },
    layers: [
      ['belt', { y: 1.03, w: 0.05, color: '#1f6b3a', sash: true }],
      ['coat', { color: '#9b1d20', sleeves: 'long', neck: 'v', open: true, inner: '#d9b34a', trim: '#e3c06a', trimW: 0.008, brocade: '#e3b23c', frogs: '#e3c06a' }],
      ['boots', { color: '#a8141e', top: 0.42 }],
      ['hose', { color: '#d9b34a' }],
    ],
    skirts: [{ bottom: 0.12, color: '#9b1d20', open: 0.6, trim: '#e3c06a', flare: 0.42 }],
    head: 'greatTurban', fur: '#6b4a2e', cape: '#1f5a34', capeTrim: '#d4a72c', capeInner: '#6b4a2e',
  },

  // ===== Byzantijnen =====
  // Skoutatos: lamellair kuras over een gewatteerde kavadion, leren pteruges, spangenhelm, rond schild met Palaiologenkruis.
  skoutatos: {
    face: { skin: MED_SKIN, hair: '#2e1d12', beardStyle: 'full', mustache: 'long' },
    layers: [
      ['belt', { y: 1.0, w: 0.03, color: '#3a2414', buckle: '#c9a24a' }],
      ['lamellar', { color: '#8d939c', lace: '#7a1e1e', bottom: 0.94 }],
      ['coat', { color: '#7a1e1e', sleeves: 'long', quilt: true }],
      ['boots', { color: '#3a2414', top: 0.42 }],
      ['hose', { color: '#4a3e30' }],
    ],
    skirts: [{ bottom: 0.66, color: '#6b4423', strips: 14, mat: 'leather', top: 0.97, t: 0.022, flare: 0.15 }, { bottom: 0.6, color: '#7a1e1e', flare: 0.2 }],
    head: 'byzHelm', plume: '#a8141e',
    shieldColor: '#8c1c1c', emblem: 'byzCross', emblemColor: '#e3b23c',
  },
  // Toxotes: boogschutter in gewatteerde kavadion met vilten muts.
  toxotes: {
    face: { skin: MED_SKIN, hair: '#2e1d12', beardStyle: 'full', mustache: 'short' },
    layers: [
      ['belt', { y: 1.02, w: 0.03, color: '#3a2414', buckle: '#8a7a5a' }],
      ['coat', { color: '#9a8656', sleeves: 'long', quilt: true, neck: 'high' }],
      ['boots', { color: '#3a2414', top: 0.36 }],
      ['hose', { color: '#5a4a3a' }],
    ],
    skirts: [{ bottom: 0.58, color: '#9a8656', flare: 0.2 }],
    head: 'feltCap', headColor: '#6a2a24', quiver: '#4a2f1b',
  },
  siphonarios: {
    face: { skin: MED_SKIN, hair: '#2a1a10', beardStyle: 'full' },
    layers: [
      ['belt', { y: 1.02, w: 0.04, color: '#2a1a10', buckle: '#8a7a5a' }],
      ['coat', { color: '#5a4632', sleeves: 'long', quilt: true, neck: 'high' }],
      ['gloves', { color: '#3a2a1a', cuff: 0.12 }],
      ['boots', { color: '#2a1a10', top: 0.42 }],
      ['hose', { color: '#3a3026' }],
    ],
    skirts: [{ bottom: 0.48, color: '#4a3a2a', mat: 'leather', flare: 0.18 }],
    head: 'byzHelm', helmBand: '#7d838c',
  },
  // Kavallarios (zware ruiter): lamellair met maliënmouwen, rode mantel.
  kataphrakt: {
    face: { skin: MED_SKIN, hair: '#2e1d12', beardStyle: 'full', mustache: 'long' },
    layers: [
      ['belt', { y: 1.0, w: 0.03, color: '#3a2414', buckle: '#c9a24a' }],
      ['lamellar', { color: '#9aa0a8', lace: '#5b1a3a', bottom: 0.94 }],
      ['mail', { sleeves: 'long', bottom: 0.9 }],
      ['gloves', { color: '#3a2a1a' }],
      ['greaves', { color: DARKSTEEL }],
      ['boots', { color: '#3a2414', top: 0.42 }],
      ['hose', { color: '#5b1a3a' }],
    ],
    skirts: [{ bottom: 0.6, color: '#7d838c', metal: 0.75, mat: 'metal', flare: 0.15, t: 0.01 }],
    head: 'byzHelm', plume: '#e3b23c', mailCoif: true, cape: '#7a1e1e', pennon: '#8c1c1c', lanceColor: '#8a6a3a',
  },
  // Keizerlijke garde: verguld lamellair, purperen tuniek.
  byzguard: {
    face: { skin: MED_SKIN, hair: '#2e1d12', beardStyle: 'full', mustache: 'long' },
    layers: [
      ['belt', { y: 1.0, w: 0.035, color: '#5a1a3a', buckle: '#e3b23c' }],
      ['lamellar', { color: '#c9a85a', lace: '#5b1a5a', bottom: 0.94, metal: 0.95 }],
      ['coat', { color: '#5b1a5a', sleeves: 'long' }],
      ['vambrace', { color: '#c9a85a' }],
      ['boots', { color: '#7a1f1f', top: 0.42 }],
      ['hose', { color: '#5b1a5a' }],
    ],
    skirts: [{ bottom: 0.66, color: '#b08a3a', strips: 16, mat: 'leather', top: 0.97, t: 0.022, flare: 0.15 }, { bottom: 0.58, color: '#5b1a5a', flare: 0.2 }],
    head: 'byzHelm', headColor: '#d4b25a', crest: '#a8141e', cape: '#5b1a5a', capeTrim: '#d4a72c',
    shieldColor: '#5b1a5a', emblem: 'byzCross', emblemColor: '#e3b23c',
  },
  // Constantijn XI: kamelaukion-kroon, verguld lamellair, purper, rode keizerlaarzen (tzangia).
  constantine: {
    scale: 1.05,
    face: { skin: MED_SKIN, hair: '#3a2a1e', beardStyle: 'full', beardLong: true, mustache: 'long', beard: '#4a3a2c' },
    layers: [
      ['belt', { y: 1.0, w: 0.04, color: '#e3b23c', buckle: '#e3b23c' }],
      ['lamellar', { color: '#d4a93c', lace: '#4b1466', bottom: 0.94, metal: 1 }],
      ['coat', { color: '#4b1466', sleeves: 'long', brocade: '#d4a72c' }],
      ['vambrace', { color: '#d4a93c' }],
      ['boots', { color: '#a8141e', top: 0.42 }],
      ['hose', { color: '#4b1466' }],
    ],
    skirts: [{ bottom: 0.66, color: '#d4a93c', strips: 18, mat: 'leather', top: 0.97, t: 0.022, flare: 0.15 }, { bottom: 0.5, color: '#4b1466', flare: 0.22, trim: '#d4a72c' }],
    head: 'stemma', cape: '#4b1466', capeTrim: '#d4a72c', capeInner: '#9b1d20',
    shieldColor: '#9b1020', emblem: 'eagle', emblemColor: '#e3b23c',
  },

  // ===== Genua =====
  // Genuese kruisboogschutter: brigandine met koperen nagels, ijzerhoed, pavese met het kruis van Sint-Joris.
  gen_crossbow: {
    face: { skin: N_SKIN, hair: '#3a2416', stubble: true },
    layers: [
      ['belt', { y: 0.99, w: 0.025, color: '#3a2416', buckle: '#b9c0c9' }],
      ['brigandine', { color: '#a81c24', rivet: '#d9b45a' }],
      ['coat', { color: '#e8e2d2', sleeves: 'long', neck: 'high' }],
      ['boots', { color: '#3a2a1a', top: 0.2 }],
      ['hose', { color: '#a81c24' }],
    ],
    skirts: [{ bottom: 0.7, color: '#e8e2d2', flare: 0.15 }],
    head: 'kettle', bag: '#5a3a1a',
    shieldColor: '#f2f0ea', shieldRim: '#8a6a3a', emblem: 'cross', emblemColor: '#c8102e',
  },
  // Genuese speerman: maliën met witte wapenrok en rood kruis, salade.
  gen_spear: {
    face: { skin: N_SKIN, hair: '#3a2416', beardStyle: 'short' },
    layers: [
      ['belt', { y: 1.0, w: 0.025, color: '#3a2416', buckle: '#b9c0c9' }],
      ['tabard', { color: '#efebe2', cross: '#c8102e' }],
      ['mail', { sleeves: 'long', bottom: 0.86 }],
      ['gloves', { color: '#3a2a1a' }],
      ['boots', { color: '#3a2a1a', top: 0.2 }],
      ['hose', { color: '#c8102e' }],
    ],
    skirts: [{ bottom: 0.62, color: '#efebe2', flare: 0.15, t: 0.012 }, { bottom: 0.66, color: '#7d838c', metal: 0.75, mat: 'metal', flare: 0.12 }],
    head: 'sallet', shieldColor: '#f2f0ea', emblem: 'cross', emblemColor: '#c8102e', shieldRim: '#9aa1ab',
  },
  // Genuese man-at-arms in "wit" Milanees plaatharnas.
  gen_maa: {
    face: { skin: N_SKIN, hair: '#3a2416' },
    layers: [...plateHarness(), ['hose', { color: '#c8102e' }]],
    skirts: [{ bottom: 0.74, color: STEEL, metal: 0.95, mat: 'metal', lames: true, top: 1.0, flare: 0.12, t: 0.02 }],
    head: 'armet', pauldron: STEEL, couter: STEEL, gorget: STEEL,
  },
  // Giustiniani: plaatharnas met vergulde randen, rode mantel en pluim.
  giustiniani: {
    scale: 1.05,
    face: { skin: N_SKIN, hair: '#4a3020', beardStyle: 'short' },
    layers: [...plateHarness('#c9cfd8', '#d4a72c'), ['hose', { color: '#c8102e' }]],
    skirts: [{ bottom: 0.74, color: '#c9cfd8', metal: 0.95, mat: 'metal', lames: true, top: 1.0, flare: 0.12, t: 0.02 }],
    head: 'armet', plume: '#c8102e', pauldron: '#c9cfd8', couter: '#c9cfd8', gorget: '#d4a72c', cape: '#c8102e', capeTrim: '#e3b23c',
  },

  // ===== Venetië =====
  ven_crossbow: {
    face: { skin: N_SKIN, hair: '#2e1d12', stubble: true },
    layers: [
      ['belt', { y: 0.99, w: 0.025, color: '#2e1d12', buckle: '#d4a72c' }],
      ['brigandine', { color: '#8e1b1b', rivet: '#e3b23c' }],
      ['coat', { color: '#c9a25a', sleeves: 'long', neck: 'high' }],
      ['boots', { color: '#2a1a10', top: 0.2 }],
      ['hose', { color: '#8e1b1b' }],
    ],
    skirts: [{ bottom: 0.7, color: '#c9a25a', flare: 0.15 }],
    head: 'kettle', bag: '#4a2a1a',
    shieldColor: '#8e1b1b', shieldRim: '#e3b23c', emblem: 'lion', emblemColor: '#e3b23c',
  },
  ven_gun: {
    face: { skin: N_SKIN, hair: '#2e1d12', beardStyle: 'short' },
    layers: [
      ['belt', { y: 1.0, w: 0.03, color: '#2a1a10', buckle: '#b9c0c9' }],
      ['coat', { color: '#9a2a24', sleeves: 'long', quilt: true, neck: 'high' }],
      ['boots', { color: '#2a1a10', top: 0.2 }],
      ['hose', { color: '#c9a25a' }],
    ],
    skirts: [{ bottom: 0.66, color: '#9a2a24', flare: 0.15 }],
    head: 'barbuta', bag: '#4a2a1a',
  },
  // Venetiaanse marinier (galeiknecht): brigandine, maliënrok, barbuta, hellebaard.
  ven_halberd: {
    face: { skin: N_SKIN, hair: '#2e1d12', beardStyle: 'short', mustache: 'short' },
    layers: [
      ['belt', { y: 0.99, w: 0.03, color: '#2a1a10', buckle: '#d4a72c' }],
      ['brigandine', { color: '#7a1414', rivet: '#e3b23c' }],
      ['mail', { sleeves: 'elbow', bottom: 0.86 }],
      ['coat', { color: '#c9a25a', sleeves: 'long' }],
      ['boots', { color: '#2a1a10', top: 0.2 }],
      ['hose', { color: '#7a1414', stripe: '#c9a25a' }],
    ],
    skirts: [{ bottom: 0.66, color: '#7d838c', metal: 0.75, mat: 'metal', flare: 0.12 }],
    head: 'barbuta',
  },
  ven_cav: {
    face: { skin: N_SKIN, hair: '#2e1d12' },
    layers: [['tabard', { color: '#8e1b1b', bottom: 0.92 }], ...plateHarness(), ['hose', { color: '#8e1b1b' }]],
    skirts: [{ bottom: 0.74, color: STEEL, metal: 0.95, mat: 'metal', lames: true, top: 1.0, flare: 0.12, t: 0.02 }],
    head: 'sallet', visor: true, bevor: true, plume: '#e3b23c', pauldron: STEEL, couter: STEEL, pennon: '#8e1b1b', lanceColor: '#8e1b1b',
  },
  // Girolamo Minotto, bailo: patriciërsrobe (vesta) in karmijn met bont over een borstkuras, berretta.
  minotto: {
    scale: 1.04,
    face: { skin: N_SKIN, hair: '#6a5a4a', beardStyle: 'full', mustache: 'long', beard: '#7a6a5a' },
    layers: [
      ['belt', { y: 1.02, w: 0.03, color: '#2a1a10', buckle: '#e3b23c' }],
      ['plate', { color: '#c9cfd8', trim: '#d4a72c', bottom: 0.98 }],
      ['coat', { color: '#9b1020', sleeves: 'long', brocade: '#b8323a' }],
      ['boots', { color: '#2a1a10', top: 0.2 }],
      ['hose', { color: '#9b1020' }],
    ],
    skirts: [{ bottom: 0.1, color: '#9b1020', flare: 0.4, trim: '#e8e0d0' }],
    head: 'beret', headColor: '#7a0c18', fur: '#e8e0d0', cape: '#7a0c18', capeTrim: '#e3b23c',
  },

  // ===== Servisch Despotaat =====
  srb_cav: {
    face: { skin: MED_SKIN, hair: '#2a1a10', mustache: 'long', beardStyle: 'short' },
    layers: [
      ['belt', { y: 1.0, w: 0.03, color: '#3a2414', buckle: '#b9c0c9' }],
      ['lamellar', { color: '#8d939c', lace: '#9b1c1c', bottom: 0.94 }],
      ['mail', { sleeves: 'long', bottom: 0.9 }],
      ['gloves', { color: '#3a2a1a' }],
      ['boots', { color: '#3a2a1a', top: 0.42 }],
      ['hose', { color: '#9b1c1c' }],
    ],
    skirts: [{ bottom: 0.6, color: '#7d838c', metal: 0.75, mat: 'metal', flare: 0.15 }],
    head: 'bascinet', headColor: '#9aa1ab',
    shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea', pennon: '#9b1c1c',
  },
  srb_spear: {
    face: { skin: MED_SKIN, hair: '#2a1a10', mustache: 'long', beardStyle: 'short' },
    layers: [
      ['belt', { y: 1.01, w: 0.03, color: '#3a2414', buckle: '#8a7a5a' }],
      ['coat', { color: '#8a7650', sleeves: 'long', quilt: true, neck: 'high' }],
      ['boots', { color: '#3a2a1a', top: 0.36 }],
      ['hose', { color: '#4a3a2a' }],
    ],
    skirts: [{ bottom: 0.58, color: '#8a7650', flare: 0.18 }],
    head: 'kettle', shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea', shieldRim: '#6b4423',
  },
  srb_archer: {
    face: { skin: MED_SKIN, hair: '#2a1a10', mustache: 'long' },
    layers: [
      ['belt', { y: 1.02, w: 0.035, color: '#9b1c1c', sash: true }],
      ['coat', { color: '#6a4a32', sleeves: 'long', neck: 'v', open: true, inner: '#e8e0d0', trim: '#9b1c1c', trimW: 0.004 }],
      ['boots', { color: '#3a2a1a', top: 0.36 }],
      ['hose', { color: '#d8ccb0' }],
    ],
    skirts: [{ bottom: 0.5, color: '#6a4a32', open: 0.4, trim: '#9b1c1c', flare: 0.22 }],
    head: 'furHat', headColor: '#2a1e16', hatTop: '#9b1c1c', quiver: '#3a2a1a',
  },
  // Mijnwerker uit Novo Brdo: leren kiel en voorschoot, kap.
  srb_miner: {
    face: { skin: '#c08a66', hair: '#2a1a10', beardStyle: 'full', mustache: 'long' },
    layers: [
      ['belt', { y: 1.02, w: 0.04, color: '#2a1a10', buckle: '#8a7a5a' }],
      ['coat', { color: '#5a4632', sleeves: 'elbow', neck: 'round' }],
      ['gloves', { color: '#3a2a1a' }],
      ['boots', { color: '#2a1a10', top: 0.32 }],
      ['hose', { color: '#4a3a2a' }],
    ],
    skirts: [{ bottom: 0.48, color: '#6b4a2e', mat: 'leather', flare: 0.15 }],
    head: 'hood', headColor: '#5a4632',
  },
  srb_guard: {
    face: { skin: MED_SKIN, hair: '#2a1a10', mustache: 'long', beardStyle: 'short' },
    layers: [
      ['belt', { y: 1.0, w: 0.035, color: '#9b1c1c', buckle: '#e3b23c' }],
      ['lamellar', { color: '#c9a85a', lace: '#9b1c1c', bottom: 0.94, metal: 0.95 }],
      ['mail', { sleeves: 'long', bottom: 0.9 }],
      ['gloves', { color: '#3a2a1a' }],
      ['boots', { color: '#3a2a1a', top: 0.42 }],
      ['hose', { color: '#9b1c1c' }],
    ],
    skirts: [{ bottom: 0.6, color: '#7d838c', metal: 0.75, mat: 'metal', flare: 0.15 }],
    head: 'bascinet', plume: '#f4f1ea', cape: '#7a1414',
    shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea',
  },
  // Despoot Đurađ Branković: Byzantijns-Servisch hofgewaad, open kroon, lange baard.
  brankovic: {
    scale: 1.04,
    face: { skin: MED_SKIN, hair: '#8a7a6a', beardStyle: 'full', beardLong: true, mustache: 'long', beard: '#9a8a7a' },
    layers: [
      ['belt', { y: 1.02, w: 0.04, color: '#d4a72c', buckle: '#d4a72c' }],
      ['coat', { color: '#9b1c1c', sleeves: 'long', brocade: '#d4a72c', trim: '#d4a72c', frogs: '#e3c06a' }],
      ['boots', { color: '#d4a72c', top: 0.42 }],
      ['hose', { color: '#9b1c1c' }],
    ],
    skirts: [{ bottom: 0.12, color: '#9b1c1c', flare: 0.42, trim: '#d4a72c' }],
    head: 'despotCrown', fur: '#e8e0d0', cape: '#9b1c1c', capeTrim: '#d4a72c', capeInner: '#e8e0d0',
    shieldColor: '#9b1c1c', emblem: 'eagle', emblemColor: '#f4f1ea',
  },

  // ===== Koninkrijk Hongarije =====
  hun_knight: {
    face: { skin: N_SKIN, hair: '#3a2414', mustache: 'long' },
    layers: [['tabard', { color: '#c8102e', stripes: '#efebe2', bottom: 0.92 }], ...plateHarness(), ['hose', { color: '#c8102e' }]],
    skirts: [{ bottom: 0.74, color: STEEL, metal: 0.95, mat: 'metal', lames: true, top: 1.0, flare: 0.12, t: 0.02 }],
    head: 'sallet', visor: true, bevor: true, plume: '#efebe2', pauldron: STEEL, couter: STEEL, pennon: '#1d5a32', lanceColor: '#c8102e',
  },
  // Huszár: lichte ruiter in dolman met tressen, bontmuts, tarcsa-schild.
  hun_light: {
    face: { skin: N_SKIN, hair: '#2a1a10', mustache: 'long' },
    layers: [
      ['belt', { y: 1.02, w: 0.035, color: '#c8102e', sash: true }],
      ['coat', { color: '#1f3f7a', sleeves: 'long', frogs: '#d4a72c', neck: 'high' }],
      ['boots', { color: '#c79a2c', top: 0.42 }],
      ['hose', { color: '#c8102e' }],
    ],
    skirts: [{ bottom: 0.62, color: '#1f3f7a', open: 0.4, flare: 0.2 }],
    head: 'furHat', headColor: '#2a1e16', hatTop: '#c8102e', plume: '#f2f0ea',
    shieldColor: '#c8102e', emblem: 'stripes', emblemColor: '#f2f0ea', pennon: '#1d5a32',
  },
  hun_pike: {
    face: { skin: N_SKIN, hair: '#3a2414', mustache: 'long' },
    layers: [
      ['belt', { y: 0.99, w: 0.03, color: '#3a2414', buckle: '#b9c0c9' }],
      ['brigandine', { color: '#1d5a32', rivet: '#c9b27a' }],
      ['coat', { color: '#d8ccb0', sleeves: 'long', neck: 'high' }],
      ['boots', { color: '#3a2a1a', top: 0.24 }],
      ['hose', { color: '#c8102e' }],
    ],
    skirts: [{ bottom: 0.66, color: '#d8ccb0', flare: 0.15 }],
    head: 'kettle',
  },
  hun_xbow: {
    face: { skin: N_SKIN, hair: '#3a2414', mustache: 'long', stubble: true },
    layers: [
      ['belt', { y: 0.99, w: 0.03, color: '#3a2414', buckle: '#b9c0c9' }],
      ['brigandine', { color: '#1d5a32', rivet: '#c9b27a' }],
      ['coat', { color: '#c8b48a', sleeves: 'long', neck: 'high' }],
      ['boots', { color: '#3a2a1a', top: 0.24 }],
      ['hose', { color: '#c8102e' }],
    ],
    skirts: [{ bottom: 0.66, color: '#c8b48a', flare: 0.15 }],
    head: 'kettle', bag: '#4a2a1a',
    shieldColor: '#c8102e', shieldRim: '#6b4423', emblem: 'doubleCross', emblemColor: '#f2f0ea',
  },
  hun_gun: {
    face: { skin: N_SKIN, hair: '#3a2414', mustache: 'long' },
    layers: [
      ['belt', { y: 1.0, w: 0.03, color: '#3a2a1a', buckle: '#b9c0c9' }],
      ['coat', { color: '#8a7a5a', sleeves: 'long', quilt: true, neck: 'high' }],
      ['boots', { color: '#3a2a1a', top: 0.24 }],
      ['hose', { color: '#1d5a32' }],
    ],
    skirts: [{ bottom: 0.62, color: '#1d5a32', flare: 0.15 }],
    head: 'kettle', bag: '#4a2a1a',
    shieldColor: '#1d5a32', shieldRim: '#6b4423', emblem: 'stripes', emblemColor: '#c8102e',
  },
  hun_guard: {
    face: { skin: N_SKIN, hair: '#3a2414', mustache: 'long' },
    layers: [['tabard', { color: '#1d5a32', bottom: 0.92 }], ...plateHarness(), ['hose', { color: '#1d5a32' }]],
    skirts: [{ bottom: 0.74, color: STEEL, metal: 0.95, mat: 'metal', lames: true, top: 1.0, flare: 0.12, t: 0.02 }],
    head: 'sallet', plume: '#c8102e', pauldron: STEEL, couter: STEEL, cape: '#1d5a32',
    shieldColor: '#c8102e', emblem: 'stripes', emblemColor: '#f2f0ea',
  },
  // János Hunyadi: plaatharnas met verguldsel, bontmuts met veer, rode mantel; snor.
  hunyadi: {
    scale: 1.05,
    face: { skin: N_SKIN, hair: '#3a2414', mustache: 'long' },
    layers: [['tabard', { color: '#1f3f7a', bottom: 0.92 }], ...plateHarness('#c9cfd8', '#d4a72c'), ['hose', { color: '#c8102e' }]],
    skirts: [{ bottom: 0.74, color: '#c9cfd8', metal: 0.95, mat: 'metal', lames: true, top: 1.0, flare: 0.12, t: 0.02 }],
    head: 'furHat', headColor: '#2a1e16', hatTop: '#c8102e', plume: '#f2f0ea', jewel: '#e3b23c', pauldron: '#d4a72c', couter: '#c9cfd8', cape: '#9b1020', capeTrim: '#e8e0d0',
  },
};

// Waar het ongebruikte wapen wordt opgeborgen
function stowFor(model) {
  if (['sword', 'kilij', 'longsword'].includes(model)) return 'hip';
  if (['mace', 'axe', 'pick'].includes(model)) return 'belt';
  if (['pike', 'lance', 'halberd', 'spear'].includes(model)) return 'backLong';
  return 'back';
}

// Outfit → lichaamstextuur (gecachet per model)
const OUTFITS = new Map();
function outfitOf(model) {
  if (OUTFITS.has(model)) return OUTFITS.get(model);
  const S = SPEC[model];
  const o = compileOutfit({ ...S.face, layers: S.layers });
  OUTFITS.set(model, o);
  return o;
}

export function unitTextures(def, quality = 'high') {
  return paintOutfit(def.model, outfitOf(def.model), quality === 'low' ? 256 : 512);
}

// Bouwt een eenheidsmodel. def = UNITS-entry, weapons = WEAPONS-entries, lod 0..2.
export function buildUnitModel(def, weapons, lod) {
  const S = SPEC[def.model];
  if (!S) throw new Error('Onbekend model ' + def.model);
  const b = new MB(Math.min(1, lod), HUMAN_BIND);
  b.addRaw(bodyGeo(outfitOf(def.model), lod));
  for (const k of S.skirts || []) b.addRaw(skirtGeo(k, lod));
  accessories(b, S);
  headgear(b, S);
  const info = { scale: S.scale || 1, shield: def.shield, weaponA: weapons[0]?.model, weaponB: weapons[1]?.model };
  if (weapons[0]) weapon(b, HB.WPN_A, weapons[0].model, S);
  if (weapons[1]) weapon(b, HB.WPN_B, weapons[1].model, S);
  info.stowA = stowFor(weapons[0]?.model);
  info.stowB = stowFor(weapons[1]?.model);
  info.hideStowedA = weapons[0]?.model === 'lance' || weapons[0]?.model === 'pike';
  if (def.shield) shield(b, def.shield, S);
  return { geo: b.build(), info };
}

// Vaandel (apart model aan de EXTRA-bot, gebruikt voor vaandeldragers)
export function buildBanner(color, color2, lod) {
  const b = new MB(lod, HUMAN_BIND);
  b.cyl(HB.EXTRA, 0.022, 0.026, 3.4, '#5a3d22', { p: [0, 1.0, -0.05], seg: 6, mat: 'wood' });
  b.box(HB.EXTRA, 0.01, 0.75, 1.0, color, { p: [0, 2.2, -0.56] });
  b.box(HB.EXTRA, 0.012, 0.12, 1.02, color2, { p: [0, 1.85, -0.56] });
  b.sph(HB.EXTRA, 0.05, '#d4a72c', { p: [0, 2.72, -0.05], metal: 1 });
  return b.build();
}

// ---------------------------------------------------------------------------
// Paard met schabrak/barding in factiekleuren (vacht via tint)
// ---------------------------------------------------------------------------
const HORSE_DRESS = {
  ottoman: { cloth: '#9b1d20', trim: '#d4a72c', saddle: '#5a2a1a', plume: '#efe8d8' },
  byzantine: { cloth: '#7a1e1e', trim: '#d4a72c', saddle: '#3a2a1a', mail: true },
  genoa: { cloth: '#f2f0ea', trim: '#c8102e', saddle: '#3a2a1a' },
  venice: { cloth: '#8e1b1b', trim: '#e3b23c', saddle: '#3a2a1a', plate: true },
  serbia: { cloth: '#9b1c1c', trim: '#f4f1ea', saddle: '#3a2a1a' },
  hungary: { cloth: '#c8102e', trim: '#f2f0ea', saddle: '#3a2a1a', stripes: true, plate: true },
};

export function buildHorseModel(faction, lod) {
  const D = HORSE_DRESS[faction] || HORSE_DRESS.ottoman;
  const b = new MB(Math.min(1, lod), HORSE_BIND, false);
  b.addRaw(horseBodyGeo(lod));
  const B = PB.BODY;
  // hoofdstel en teugels
  b.box(PB.HEAD, 0.2, 0.025, 0.025, '#2a1a10', { p: [0, -0.07, 0.2], r: [-0.8, 0, 0], mat: 'leather' });
  b.box(PB.HEAD, 0.19, 0.025, 0.025, '#2a1a10', { p: [0, -0.24, 0.38], r: [-0.8, 0, 0], mat: 'leather' });
  b.box(PB.HEAD, 0.21, 0.025, 0.025, '#2a1a10', { p: [0, 0.04, 0.02], r: [0.2, 0, 0], mat: 'leather', detail: true });
  // schabrak (kleed) en zadel met hoge boom
  b.lathe(B, [[0.0, 0.47], [0.34, 0.4], [0.42, 0.1], [0.43, -0.2]], D.cloth, { s: [1, 1, 1.45], p: [0, 0, -0.02], open: true, seg: 16 });
  b.lathe(B, [[0.432, -0.2], [0.436, -0.26]], D.trim, { s: [1, 1, 1.45], p: [0, 0, -0.02], open: true, seg: 16, detail: true });
  if (D.stripes && !lod) for (let i = 0; i < 4; i++) b.lathe(B, [[0.428 - i * 0.002, 0.1 - i * 0.07], [0.43 - i * 0.002, 0.07 - i * 0.07]], '#f2f0ea', { s: [1, 1, 1.46], p: [0, 0, -0.02], open: true, seg: 16 });
  b.box(B, 0.34, 0.08, 0.5, D.saddle, { p: [0, 0.48, 0.0], mat: 'leather' });
  b.box(B, 0.3, 0.16, 0.06, D.saddle, { p: [0, 0.56, 0.24], mat: 'leather' });
  b.box(B, 0.3, 0.13, 0.06, D.saddle, { p: [0, 0.55, -0.26], mat: 'leather' });
  for (const s2 of [-1, 1]) b.box(B, 0.02, 0.4, 0.03, '#2a1a10', { p: [s2 * 0.2, 0.25, 0.05], mat: 'leather', detail: true });
  if (D.mail) b.cyl(PB.NECK, 0.22, 0.29, 0.7, '#7d838c', { p: [0, 0.3, 0.06], r: [0.55, 0, 0], metal: 0.7, s: [0.85, 1, 1], open: true });
  if (D.plate) b.box(PB.HEAD, 0.17, 0.05, 0.42, '#b5bcc6', { p: [0, 0.06, 0.18], r: [-0.85, 0, 0], metal: 1 });
  if (D.plume) b.cone(PB.HEAD, 0.04, 0.22, D.plume, { p: [0, 0.3, -0.02], seg: 5 });
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
  const W = { mat: 'wood' };
  if (kind === 'bombard') {
    // de reuzenkanonnen van Urban: bronzen loop op een houten slede
    b.box(0, 1.6, 0.4, 4.4, dark, { p: [0, 0.2, 0], ...W });
    b.box(0, 0.25, 0.7, 3.8, wood, { p: [-0.7, 0.55, 0], ...W });
    b.box(0, 0.25, 0.7, 3.8, wood, { p: [0.7, 0.55, 0], ...W });
    b.cyl(1, 0.55, 0.62, 3.6, '#a8772f', { p: [0, 1.15, 0.2], r: [Math.PI / 2, 0, 0], metal: 0.9, seg: 16 });
    b.cyl(1, 0.66, 0.66, 1.0, '#9a6a28', { p: [0, 1.15, -1.5], r: [Math.PI / 2, 0, 0], metal: 0.9, seg: 16 });
    for (let i = 0; i < 4; i++) b.torus(1, 0.6, 0.05, '#c9963a', { p: [0, 1.15, -0.8 + i * 1.0], metal: 1, seg: 16 });
    b.cyl(1, 0.4, 0.4, 0.05, '#111', { p: [0, 1.15, 2.01], r: [Math.PI / 2, 0, 0] });
    for (const x of [-1.2, 1.2]) b.cyl(2, 0.15, 0.15, 0.6, wood, { p: [x, 0.3, 1.6], r: [0, 0, Math.PI / 2], ...W });
    b.cyl(3, 0.02, 0.02, 2.2, dark, { p: [-0.9, 1.1, -2], ...W });
    b.box(3, 0.01, 0.4, 0.7, '#ffffff', { p: [-0.9, 2.0, -2.35], tint: 1 });
  } else if (kind === 'trebuchet') {
    b.box(0, 3.4, 0.3, 4.4, dark, { p: [0, 0.15, 0], ...W });
    for (const x of [-1.2, 1.2]) {
      b.box(0, 0.25, 5.4, 0.3, wood, { p: [x, 2.7, 0.6], r: [0.2, 0, 0], ...W });
      b.box(0, 0.25, 5.4, 0.3, wood, { p: [x, 2.7, -0.6], r: [-0.2, 0, 0], ...W });
    }
    b.cyl(0, 0.12, 0.12, 2.8, iron, { p: [0, 5.2, 0], r: [0, 0, Math.PI / 2], metal: 0.8 });
    // arm (bot 1, draaipunt op de as)
    b.box(1, 0.28, 0.28, 8.5, wood, { p: [0, 0, 1.6], ...W });
    b.box(1, 1.4, 1.4, 1.4, '#5a5a5a', { p: [0, -0.9, -2.4] });
    b.cyl(1, 0.01, 0.01, 2.4, '#d8ccb0', { p: [0, -1.1, 5.8], detail: true });
    for (const x of [-1.6, 1.6]) for (const z of [-1.8, 1.8]) b.cyl(2, 0.35, 0.35, 0.2, wood, { p: [x, 0.35, z], r: [0, 0, Math.PI / 2], ...W });
    b.cyl(3, 0.02, 0.02, 2.0, dark, { p: [1.3, 6.4, 0], ...W });
    b.box(3, 0.01, 0.4, 0.7, '#ffffff', { p: [1.3, 7.2, -0.35], tint: 1 });
  } else if (kind === 'ram') {
    // overdekte stormram met huiden op het dak
    for (const x of [-1, 1]) for (const z of [-1.6, 1.6]) b.box(0, 0.2, 2.6, 0.2, wood, { p: [x, 1.4, z], ...W });
    b.box(0, 2.3, 0.2, 3.8, wood, { p: [0, 0.45, 0], ...W });
    b.add(new THREE.CylinderGeometry(1.5, 1.5, 4.0, 3, 1, true), 0, '#7a5a3a', { p: [0, 2.8, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.75], mat: 'leather' });
    b.cyl(1, 0.22, 0.25, 4.6, '#5a3d22', { p: [0, 0, 0], r: [Math.PI / 2, 0, 0], seg: 8, ...W });
    b.cyl(1, 0.3, 0.26, 0.45, iron, { p: [0, 0, 2.4], r: [Math.PI / 2, 0, 0], metal: 0.8 });
    for (const x of [-1.25, 1.25]) for (const z of [-1.3, 1.3]) b.cyl(2, 0.4, 0.4, 0.18, dark, { p: [x, 0.4, z], r: [0, 0, Math.PI / 2], ...W });
    b.cyl(3, 0.02, 0.02, 1.6, dark, { p: [0, 3.8, -1.6], ...W });
    b.box(3, 0.01, 0.35, 0.6, '#ffffff', { p: [0, 4.4, -1.9], tint: 1 });
  } else if (kind === 'tower') {
    // belegeringstoren met huiden en valbrug
    b.box(0, 4.2, 0.3, 4.6, dark, { p: [0, 0.4, 0], ...W });
    for (const x of [-1.9, 1.9]) for (const z of [-2.1, 2.1]) b.box(0, 0.3, 11.5, 0.3, wood, { p: [x * 0.92, 6.1, z * 0.92], r: [0, 0, -Math.sign(x) * 0.03], ...W });
    for (let k = 0; k < 4; k++) b.box(0, 3.9, 0.2, 4.3, wood, { p: [0, 2.8 + k * 2.6, 0], ...W });
    b.box(0, 3.6, 10.5, 0.15, '#7a5a3a', { p: [0, 5.8, -2.0], mat: 'leather' });
    b.box(0, 0.15, 10.5, 4.0, '#6e5236', { p: [-1.85, 5.8, 0], mat: 'leather' });
    b.box(0, 0.15, 10.5, 4.0, '#6e5236', { p: [1.85, 5.8, 0], mat: 'leather' });
    b.box(1, 3.4, 0.15, 3.6, wood, { p: [0, 1.8, 0], ...W });
    for (const x of [-2, 2]) for (const z of [-1.8, 1.8]) b.cyl(2, 0.55, 0.55, 0.25, dark, { p: [x, 0.55, z], r: [0, 0, Math.PI / 2], ...W });
    b.cyl(3, 0.03, 0.03, 2.5, dark, { p: [0, 12.6, -1.5], ...W });
    b.box(3, 0.01, 0.5, 0.9, '#ffffff', { p: [0, 13.5, -1.95], tint: 1 });
  }
  return b.build();
}

// Neutrale atlas (alleen materiaalstalen) voor paarden en belegeringstuig
let NEUTRAL = null;
export function neutralTextures() {
  if (!NEUTRAL) NEUTRAL = paintOutfit('__neutraal', compileOutfit({ layers: [] }), 128);
  return NEUTRAL;
}

export { SPEC };
