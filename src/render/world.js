import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { FACTIONS } from '../sim/data.js';

const TEX_M = 7; // meter per textuurherhaling voor metselwerk

// UV's van een box schalen naar echte afmetingen (één gedeeld materiaal voor alle maten)
function boxGeo(w, h, d, scale = TEX_M) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / scale, (uv.getY(i) * dims[f][1]) / scale);
  }
  return g;
}

function cylGeo(rt, rb, h, seg, scale = TEX_M, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const uv = g.attributes.uv;
  const circ = Math.PI * 2 * Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / scale, (uv.getY(i) * h) / scale);
  return g;
}

// Zadeldak precies op een rechthoekig huis (halve maten hx × hz, muurhoogte h):
// nok langs de lange zijde, overstek rondom, twee dakvlakken en twee geveldriehoeken.
// Geeft { roof, gables } (geometrie rond de oorsprong; de onderkant van het dak op y = h).
function gableRoof(hx, hz, h, over = 0.35, pitch = 0.62) {
  const alongX = hx >= hz;
  const L = (alongX ? hx : hz) + over; // halve lengte langs de nok
  const Wd = (alongX ? hz : hx) + over; // halve breedte (dakvoet)
  const rise = (alongX ? hz : hx) * pitch * 1.6;
  const y0 = h - 0.05;
  // punten in (langs, hoog, dwars)
  const P = (a, y, c) => (alongX ? [a, y, c] : [c, y, a]);
  const pos = [];
  const uv = [];
  const quad = (p0, p1, p2, p3, uv0) => {
    pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    uv.push(...uv0[0], ...uv0[1], ...uv0[2], ...uv0[0], ...uv0[2], ...uv0[3]);
  };
  const slope = Math.hypot(Wd, rise + over * pitch);
  const yEave = y0 - over * pitch;
  for (const sd of [-1, 1]) {
    const a = P(-L, yEave, sd * Wd);
    const b = P(L, yEave, sd * Wd);
    const c = P(L, y0 + rise, 0);
    const d = P(-L, y0 + rise, 0);
    const U = [[0, 0], [(2 * L) / 3, 0], [(2 * L) / 3, slope / 3], [0, slope / 3]];
    if (sd > 0) quad(a, b, c, d, U);
    else quad(b, a, d, c, U);
  }
  // het verwisselen van de assen (nok langs z) spiegelt de geometrie: winding omdraaien
  const flip = (P3, UV2) => {
    if (alongX) return;
    for (let t = 0; t < P3.length / 9; t++) {
      for (let k = 0; k < 3; k++) [P3[t * 9 + 3 + k], P3[t * 9 + 6 + k]] = [P3[t * 9 + 6 + k], P3[t * 9 + 3 + k]];
      for (let k = 0; k < 2; k++) [UV2[t * 6 + 2 + k], UV2[t * 6 + 4 + k]] = [UV2[t * 6 + 4 + k], UV2[t * 6 + 2 + k]];
    }
  };
  flip(pos, uv);
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roof.computeVertexNormals();
  // geveldriehoeken in muurkleur (sluiten de zolder af)
  const gp = [];
  const guv = [];
  const ga = alongX ? hx : hz;
  const gw = alongX ? hz : hx;
  for (const e of [-1, 1]) {
    const p0 = P(e * ga, y0, -gw);
    const p1 = P(e * ga, y0, gw);
    const p2 = P(e * ga, y0 + rise * (gw / (gw + over)) + 0.02, 0);
    if (e > 0) gp.push(...p0, ...p2, ...p1);
    else gp.push(...p0, ...p1, ...p2);
    guv.push(0, 0, 1, 0, 0.5, 0.5);
  }
  flip(gp, guv);
  const gables = new THREE.BufferGeometry();
  gables.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  gables.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2));
  gables.computeVertexNormals();
  return { roof, gables };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function place(g, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s, s, s));
  g.applyMatrix4(_m);
  return g;
}

function merge(list) {
  if (!list.length) return null;
  // gemengde lijsten (met en zonder index) eerst gelijktrekken
  if (list.some((x) => !x.index) && list.some((x) => x.index)) list = list.map((x) => (x.index ? x.toNonIndexed() : x));
  const g = mergeGeometries(list, false);
  return g;
}

// Wapperende vlag (vertex-animatie in de shader)
const flagUniforms = { uTime: { value: 0 } };
export function flagMaterial(faction) {
  const m = new THREE.MeshLambertMaterial({ map: TX.flagTexture(faction), side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = flagUniforms.uTime;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position;\nfloat fx = uv.x;\ntransformed.z += sin(fx * 6.0 - uTime * 5.0 + position.y) * 0.18 * fx;');
  };
  m.customProgramCacheKey = () => 'flag';
  return m;
}
export function tickFlags(t) {
  flagUniforms.uTime.value = t;
}

export function makeFlag(faction, w = 3, h = 1.9) {
  const g = new THREE.PlaneGeometry(w, h, 10, 2);
  g.translate(w / 2, 0, 0);
  const mesh = new THREE.Mesh(g, flagMaterial(faction));
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
export class WorldView {
  constructor(scene, map, match, quality) {
    this.scene = scene;
    this.map = map;
    this.match = match;
    this.q = quality;
    this.shadows = quality !== 'low';
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mats = {};
    this._materials();
    this._terrain();
    this._decor();
    this.forts = map.forts.map((f) => new FortView(this, f));
    this._capturePoints();
  }

  _materials() {
    const M = this.mats;
    M.grass = new THREE.MeshLambertMaterial({ map: TX.grassTexture() });
    M.dirt = new THREE.MeshLambertMaterial({ map: TX.dirtTexture() });
    M.fields = [0, 1, 2].map((k) => new THREE.MeshLambertMaterial({ map: TX.fieldTexture(k) }));
    M.plaster = new THREE.MeshLambertMaterial({ map: TX.plasterTexture() });
    M.tiles = new THREE.MeshLambertMaterial({ map: TX.roofTexture('#a4553a') });
    M.wood = new THREE.MeshLambertMaterial({ map: TX.woodTexture() });
    M.water = new THREE.MeshLambertMaterial({ map: TX.waterTexture(), color: '#8fb0b0' });
    M.lead = new THREE.MeshLambertMaterial({ color: '#6f7780' });
    M.copper = new THREE.MeshLambertMaterial({ color: '#5e8a7a' });
    M.redRoof = new THREE.MeshLambertMaterial({ map: TX.roofTexture('#b0402a') });
    M.darkWood = new THREE.MeshLambertMaterial({ color: '#4a3020' });
    M.rubble = {};
    M.stone = {};
    M.stoneDmg = {};
    for (const style of ['ottoman', 'byzantine', 'genoa', 'venice', 'serbia', 'hungary']) {
      M.stone[style] = new THREE.MeshLambertMaterial({ map: TX.masonryTexture(style) });
      M.stoneDmg[style] = new THREE.MeshLambertMaterial({ map: TX.masonryTexture(style, true) });
    }
  }

  _terrain() {
    const R = this.map.radius;
    const size = R * 4;
    // grote kleurvlakken (droog/vers/vertrapt) tegen zichtbare textuurherhaling
    const gg = new THREE.PlaneGeometry(size, size, 160, 160);
    gg.rotateX(-Math.PI / 2);
    const pos = gg.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const n2 = (x, z) => Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2) * Math.cos(z * 0.017 - Math.sin(x * 0.011) * 1.5);
    const forts = this.map.forts;
    // natuurlijke variatie: weelderig ↔ iets droger ↔ vertrapte aarde (alle tinten ≤ 1, geen paarse/felle vlekken)
    const lush = [0.96, 1.0, 0.94];
    const dry = [1.04, 1.0, 0.82];
    const earth = [0.86, 0.76, 0.6];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = n2(x, z) * 0.5 + n2(x * 2.3 + 40, z * 2.1 - 17) * 0.3 + n2(x * 5.1, z * 4.7) * 0.15;
      const kDry = Math.max(0, Math.min(1, n2(x * 0.7 + 90, z * 0.8 - 30) * 0.9 + 0.1)) * 0.6;
      let kEarth = 0;
      for (const f of forts) {
        const d = Math.hypot(x - f.cx, z - f.cz);
        kEarth = Math.max(kEarth, Math.max(0, 1 - Math.abs(d - f.extent - 8) / 16) * 0.55);
      }
      const bright = 0.94 + a * 0.08;
      for (let k = 0; k < 3; k++) {
        let c = lush[k] + (dry[k] - lush[k]) * kDry;
        c += (earth[k] - c) * kEarth;
        col[i * 3 + k] = Math.min(1.05, c * bright);
      }
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mats.grass.vertexColors = true;
    this.mats.grass.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
        vec4 t1 = texture2D(map, vMapUv);
        vec4 t2 = texture2D(map, vMapUv * 0.231 + vec2(0.37, 0.71));
        vec4 t3 = texture2D(map, vec2(vMapUv.y, -vMapUv.x) * 0.057);
        diffuseColor *= vec4(mix(t1.rgb, (t2.rgb + t3.rgb) * 0.5, 0.45), 1.0);
        #endif`,
      );
    };
    const ground = new THREE.Mesh(gg, this.mats.grass);
    ground.receiveShadow = this.shadows;
    ground.material.map.repeat.set(size / 9, size / 9);
    this.group.add(ground);

    // heuvels aan de horizon
    const hills = new THREE.Group();
    const hm = new THREE.MeshLambertMaterial({ color: '#6b7444' });
    const rr = this.match.rng || Math.random;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const d = R + 70 + ((i * 37) % 23) * 3;
      const h = 14 + ((i * 53) % 17) * 1.6;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), hm);
      m.scale.set(48, h, 30);
      m.position.set(Math.cos(a) * d, -2, Math.sin(a) * d);
      m.rotation.y = -a;
      hills.add(m);
    }
    void rr;
    this.group.add(hills);

    // zee (Marmara) aan één kant
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(R * 5, R * 2), this.mats.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(R * 0.3, -0.6, R + 210);
    this.group.add(sea);

    // wegen van de poorten naar het midden
    const roadGeos = [];
    for (const r of this.map.roads) {
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const len = Math.hypot(dx, dz);
      const g = new THREE.PlaneGeometry(r.w, len + r.w);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) * len) / 8);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(dx, dz));
      g.translate((r.x0 + r.x1) / 2, 0.03, (r.z0 + r.z1) / 2);
      roadGeos.push(g);
    }
    if (roadGeos.length) {
      const road = new THREE.Mesh(merge(roadGeos), this.mats.dirt);
      road.receiveShadow = this.shadows;
      this.group.add(road);
    }
  }

  _decor() {
    const D = this.map.decor;
    const sh = this.shadows;
    // akkers
    const fieldGeos = [[], [], []];
    for (const d of D) if (d.kind === 'field') {
      const g = new THREE.PlaneGeometry(d.hx * 2, d.hz * 2);
      g.rotateX(-Math.PI / 2);
      g.rotateY(d.rot);
      g.translate(d.x, 0.02, d.z);
      fieldGeos[Math.floor(d.v * 3)].push(g);
    }
    fieldGeos.forEach((list, k) => {
      if (!list.length) return;
      const m = new THREE.Mesh(merge(list), this.mats.fields[k]);
      m.receiveShadow = sh;
      this.group.add(m);
    });

    // bomen (instanced)
    const trees = D.filter((d) => d.kind === 'cypress' || d.kind === 'olive' || d.kind === 'oak');
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.4, 6).translate(0, 1.2, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#5b4026' }), trees.length);
    const cyp = trees.filter((t) => t.kind === 'cypress');
    const oli = trees.filter((t) => t.kind !== 'cypress');
    const cypGeo = new THREE.LatheGeometry([[0, 0], [0.9, 0.6], [1.15, 2.2], [0.9, 4.6], [0.35, 6.4], [0, 7]].map(([r, y]) => new THREE.Vector2(r, y)), 8).translate(0, 1.6, 0);
    const cypM = new THREE.InstancedMesh(cypGeo, new THREE.MeshLambertMaterial({ color: '#2e4524' }), cyp.length);
    const crownGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.6, 0),
      new THREE.IcosahedronGeometry(1.4, 0).translate(1.1, 3.0, 0.5),
      new THREE.IcosahedronGeometry(1.3, 0).translate(-1.0, 3.2, -0.4),
    ].map((g) => (g.index ? g.toNonIndexed() : g)));
    const oliM = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#5a6b3a', flatShading: true }), oli.length);
    const dm = new THREE.Object3D();
    trees.forEach((t, i) => {
      dm.position.set(t.x, 0, t.z);
      dm.rotation.set(0, t.rot, 0);
      dm.scale.setScalar(t.s);
      dm.updateMatrix();
      trunk.setMatrixAt(i, dm.matrix);
    });
    cyp.forEach((t, i) => {
      dm.position.set(t.x, 0, t.z);
      dm.rotation.set(0, t.rot, 0);
      dm.scale.set(t.s * 0.9, t.s * (0.9 + (i % 5) * 0.08), t.s * 0.9);
      dm.updateMatrix();
      cypM.setMatrixAt(i, dm.matrix);
    });
    const tmpC = new THREE.Color();
    oli.forEach((t, i) => {
      dm.position.set(t.x, 0, t.z);
      dm.rotation.set(0, t.rot, 0);
      dm.scale.setScalar(t.s * (t.kind === 'oak' ? 1.25 : 1));
      dm.updateMatrix();
      oliM.setMatrixAt(i, dm.matrix);
      oliM.setColorAt(i, tmpC.set(t.kind === 'oak' ? '#4e6b2e' : '#6e7a4a'));
    });
    for (const m of [trunk, cypM, oliM]) {
      m.castShadow = sh;
      m.receiveShadow = sh;
      this.group.add(m);
    }

    // rotsen en struiken
    const rocks = D.filter((d) => d.kind === 'rock');
    const rockM = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#8a8478', flatShading: true }), rocks.length);
    rocks.forEach((r, i) => {
      dm.position.set(r.x, r.s * 0.3, r.z);
      dm.rotation.set(r.rot, r.rot * 2, 0);
      dm.scale.set(r.s, r.s * 0.7, r.s * 0.9);
      dm.updateMatrix();
      rockM.setMatrixAt(i, dm.matrix);
    });
    rockM.castShadow = sh;
    this.group.add(rockM);
    const bushes = D.filter((d) => d.kind === 'bush');
    const bushM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#56683a', flatShading: true }), bushes.length);
    bushes.forEach((b, i) => {
      dm.position.set(b.x, b.s * 0.45, b.z);
      dm.rotation.set(0, b.rot, 0);
      dm.scale.set(b.s * 1.2, b.s * 0.8, b.s);
      dm.updateMatrix();
      bushM.setMatrixAt(i, dm.matrix);
    });
    this.group.add(bushM);

    // dorpshuizen en lage muurtjes
    const walls = [];
    const roofs = [];
    const lows = [];
    for (const d of D) {
      if (d.kind === 'house') {
        walls.push(place(boxGeo(d.hx * 2, d.h, d.hz * 2, 4), d.x, d.h / 2, d.z, d.rot));
        const { roof, gables } = gableRoof(d.hx, d.hz, d.h);
        roofs.push(place(roof, d.x, 0, d.z, d.rot));
        walls.push(place(gables, d.x, 0, d.z, d.rot));
      } else if (d.kind === 'lowwall') {
        lows.push(place(boxGeo(d.hx * 2, d.h, d.hz * 2, 4), d.x, d.h / 2, d.z, d.rot));
      }
    }
    if (walls.length) this._addMesh(merge(walls), this.mats.plaster);
    if (roofs.length) this._addMesh(merge(roofs), this.mats.tiles);
    if (lows.length) this._addMesh(merge(lows), this.mats.stone.byzantine);
  }

  _addMesh(geo, mat, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast && this.shadows;
    m.receiveShadow = this.shadows;
    this.group.add(m);
    return m;
  }

  _capturePoints() {
    this.cpFlags = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false });
    for (const c of this.map.capturePoints) {
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 9, 8), this.mats.darkWood);
      pole.position.y = 4.5;
      pole.castShadow = this.shadows;
      g.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 0.6, 10), this.mats.stone.byzantine);
      base.position.y = 0.3;
      g.add(base);
      const ring = new THREE.Mesh(new THREE.RingGeometry(c.r - 0.25, c.r, 48), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      const flags = {};
      for (const t of this.match.teams) {
        const f = makeFlag(t.id, 2.6, 1.6);
        f.position.y = 8;
        f.visible = false;
        g.add(f);
        flags[t.id] = f;
      }
      const neutral = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5).translate(1.2, 0, 0), new THREE.MeshLambertMaterial({ color: '#e8e2d2', side: THREE.DoubleSide }));
      neutral.position.y = 8;
      g.add(neutral);
      this.group.add(g);
      this.cpFlags.push({ c, g, flags, neutral, ring });
    }
  }

  update(t) {
    tickFlags(t);
    for (const cp of this.cpFlags) {
      const c = cp.c;
      for (const [id, f] of Object.entries(cp.flags)) {
        f.visible = c.owner === id;
        f.position.y = 1.5 + 6.5 * (c.owner === id ? c.progress : 0);
      }
      cp.neutral.visible = !c.owner;
      cp.neutral.position.y = 8 - (c.by && !c.owner ? c.progress * 6 : 0);
      const col = c.owner ? FACTIONS[c.owner].ui : '#ffffff';
      cp.ring.material.color.set(col);
    }
    for (const f of this.forts) f.update();
  }
}

// ---------------------------------------------------------------------------
// Fort: alle bouwwerken per materiaal samengevoegd; opnieuw opgebouwd bij schade
// ---------------------------------------------------------------------------
class FortView {
  constructor(world, fort) {
    this.w = world;
    this.f = fort;
    this.style = fort.style;
    this.group = new THREE.Group();
    world.group.add(this.group);
    this.meshes = [];
    this.state = '';
    this.parts = new Map(); // struct → { intact: {bucket: [geo]}, rubble: [geo] }
    for (const st of fort.structures) this.parts.set(st, this._buildStruct(st));
    this._static();
    this.rebuild();
  }

  _buildStruct(st) {
    const B = { stone: [], roof: [], wood: [], dark: [] };
    const rubble = [];
    const { x, z, h, rot } = st;
    const ob = st.ob;
    const style = this.style;
    if (st.kind === 'wall' || st.kind === 'outerWall') {
      const len = ob.hx * 2;
      const thick = ob.hz * 2;
      const thin = ob.hx < ob.hz;
      const L = thin ? ob.hz * 2 : len;
      const T = thin ? ob.hx * 2 : thick;
      const g = boxGeo(thin ? T : L, h, thin ? L : T);
      B.stone.push(place(g, x, h / 2, z, rot));
      // kantelen aan de buitenkant
      const n = Math.max(2, Math.floor(L / 1.8));
      const swallow = style === 'genoa' || style === 'venice'; // zwaluwstaartkantelen (Italiaans)
      for (let k = 0; k < n; k++) {
        const a = -L / 2 + (k + 0.5) * (L / n);
        const lx = thin ? -Math.sign(st.normalU || 1) * 0 + (st.normalU || 0) * (T / 2 - 0.3) : a;
        const lz = thin ? a : (st.normalV || 0) * (T / 2 - 0.3);
        const wx = x + ob.cos * lx + ob.sin * lz;
        const wz = z - ob.sin * lx + ob.cos * lz;
        const mg = swallow ? merlonSwallow() : boxGeo(0.95, 1.1, 0.55, 3);
        B.stone.push(place(mg, wx, h + 0.55, wz, rot + (thin ? Math.PI / 2 : 0)));
      }
      // borstwering aan de binnenkant (lage rand)
      for (let k = 0; k < 3; k++) {
        const a = -L / 2 + (k + 0.5) * (L / 3);
        const lx = thin ? (st.normalU ? -st.normalU : 0) * (T / 2 - 0.15) : a;
        const lz = thin ? a : (st.normalV ? -st.normalV : 0) * (T / 2 - 0.15);
        B.stone.push(place(boxGeo(thin ? 0.3 : L / 3, 0.5, thin ? L / 3 : 0.3, 3), x + ob.cos * lx + ob.sin * lz, h + 0.25, z - ob.sin * lx + ob.cos * lz, rot));
      }
      rubbleFor(rubble, st, h, L, T, thin);
    } else if (st.kind === 'tower' || st.kind === 'outerTower') {
      const r = ob.hx;
      if (st.round) {
        B.stone.push(place(cylGeo(r * 1.05, r * 1.15, h, 16), x, h / 2, z));
        B.stone.push(place(cylGeo(r * 1.12, r * 1.12, 0.6, 16), x, h + 0.3, z));
        const roofH = style === 'ottoman' ? r * 2.1 : style === 'hungary' ? r * 2.6 : r * 1.6;
        B.roof.push(place(new THREE.ConeGeometry(r * 1.3, roofH, 16), x, h + 0.6 + roofH / 2, z));
      } else {
        B.stone.push(place(boxGeo(ob.hx * 2.1, h, ob.hz * 2.1), x, h / 2, z, rot));
        // kantelen rondom
        for (let k = -1; k <= 1; k++) for (const s of [-1, 1]) {
          B.stone.push(place(boxGeo(0.9, 1.1, 0.5, 3), x + ob.cos * k * 1.9 + ob.sin * s * ob.hz, h + 0.55, z - ob.sin * k * 1.9 + ob.cos * s * ob.hz, rot));
          B.stone.push(place(boxGeo(0.5, 1.1, 0.9, 3), x + ob.cos * s * ob.hx + ob.sin * k * 1.9, h + 0.55, z - ob.sin * s * ob.hx + ob.cos * k * 1.9, rot));
        }
        if (style === 'byzantine' && !st.gatehouse) {
          // lage piramidedaken op sommige torens (zoals bij de landmuren)
        }
        if (style === 'venice' || style === 'hungary') B.roof.push(place(new THREE.ConeGeometry(ob.hx * 1.6, 3.5, 4), x, h + 1.8, z, rot + Math.PI / 4));
      }
      rubbleFor(rubble, st, h, ob.hx * 2, ob.hz * 2, false, true);
    } else if (st.gate) {
      // dubbele houten poortdeur in een stenen boog
      const thin = ob.hx < ob.hz;
      const W = thin ? ob.hz * 2 : ob.hx * 2;
      for (const s of [-1, 1]) {
        const lx = thin ? 0 : (s * W) / 4;
        const lz = thin ? (s * W) / 4 : 0;
        B.wood.push(place(boxGeo(thin ? 0.35 : W / 2 - 0.05, 6, thin ? W / 2 - 0.05 : 0.35, 6), x + ob.cos * lx + ob.sin * lz, 3, z - ob.sin * lx + ob.cos * lz, rot));
      }
      for (let k = 0; k < 5; k++) {
        const g = new THREE.BoxGeometry(thin ? 0.4 : W, 0.12, thin ? W : 0.4);
        B.dark.push(place(g, x, 0.8 + k * 1.2, z, rot));
      }
      // kapotte poort: planken op de grond
      for (let k = 0; k < 6; k++) {
        const g = boxGeo(0.4, 0.12, 2.5 + (k % 3) * 0.5, 4);
        const lx = (k - 2.5) * 0.9;
        const lz = ((k * 7) % 5) * 0.4 - 1;
        rubble.push({ g: place(g, x + ob.cos * lx + ob.sin * lz, 0.08, z - ob.sin * lx + ob.cos * lz, rot + k * 0.5, 0, (k % 2) * 0.2), mat: 'wood' });
      }
    }
    return { B, rubble };
  }

  _static() {
    const f = this.f;
    const M = this.w.mats;
    const stone = [];
    const roof = [];
    const wood = [];
    const style = this.style;
    // donjon
    const k = f.keep;
    const kh = 18;
    const ko = k.ob;
    stone.push(place(boxGeo(ko.hx * 2, kh, ko.hz * 2), k.x, kh / 2, k.z, f.rot));
    for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) {
      stone.push(place(boxGeo(1, 1.2, 0.6, 3), k.x + ko.cos * i * 2 + ko.sin * s * ko.hz, kh + 0.6, k.z - ko.sin * i * 2 + ko.cos * s * ko.hz, f.rot));
      stone.push(place(boxGeo(0.6, 1.2, 1, 3), k.x + ko.cos * s * ko.hx + ko.sin * i * 2, kh + 0.6, k.z - ko.sin * s * ko.hx + ko.cos * i * 2, f.rot));
    }
    if (style === 'ottoman') roof.push(place(new THREE.ConeGeometry(ko.hx * 1.35, 7, 4), k.x, kh + 3.5, k.z, f.rot + Math.PI / 4));
    else if (style === 'byzantine') roof.push(place(new THREE.SphereGeometry(ko.hx * 0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.x, kh, k.z));
    else if (style === 'genoa') {
      // Galatatoren-achtige ronde top
      stone.push(place(cylGeo(ko.hx * 0.75, ko.hx * 0.8, 6, 16), k.x, kh + 3, k.z));
      roof.push(place(new THREE.ConeGeometry(ko.hx * 0.95, 6, 16), k.x, kh + 9, k.z));
    } else if (style === 'hungary') roof.push(place(new THREE.ConeGeometry(ko.hx * 1.3, 9, 4), k.x, kh + 4.5, k.z, f.rot + Math.PI / 4));
    else if (style === 'venice') {
      stone.push(place(boxGeo(ko.hx * 1.1, 7, ko.hz * 1.1), k.x, kh + 3.5, k.z, f.rot));
      roof.push(place(new THREE.ConeGeometry(ko.hx * 0.85, 6, 4), k.x, kh + 10, k.z, f.rot + Math.PI / 4));
    } else roof.push(place(new THREE.ConeGeometry(ko.hx * 1.35, 6, 4), k.x, kh + 3, k.z, f.rot + Math.PI / 4));
    // grote banier op de donjon
    this.keepFlag = makeFlag(f.team, 5, 3.2);
    const flagY = kh + (style === 'genoa' ? 13 : style === 'venice' ? 14 : 8);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 6), M.darkWood);
    pole.position.set(k.x, flagY - 1, k.z);
    this.group.add(pole);
    this.keepFlag.position.set(k.x, flagY + 1.2, k.z);
    this.keepFlagBase = flagY + 1.2;
    this.group.add(this.keepFlag);
    this.capFlags = {};

    // gebouwen in het fort
    for (const b of f.buildings) {
      stone.push(place(boxGeo(b.hx * 2, b.h, b.hz * 2), b.x, b.h / 2, b.z, b.rot));
      const gr = gableRoof(b.hx, b.hz, b.h, 0.4);
      roof.push(place(gr.roof, b.x, 0, b.z, b.rot));
      stone.push(place(gr.gables, b.x, 0, b.z, b.rot));
    }
    // bovendorpels/bogen boven de poorten
    for (const o of this.w.map.obstacles) {
      if (o.kind !== 'lintel' || o.team !== f.team) continue;
      const thin = o.hx < o.hz;
      stone.push(place(boxGeo(thin ? o.hx * 2 : o.hx * 2 + 0.4, o.y1 - o.y0, thin ? o.hz * 2 + 0.4 : o.hz * 2), o.cx, (o.y0 + o.y1) / 2, o.cz, o.rot));
    }
    // ladders naar de muurposten
    for (const p of f.posts) {
      const dx = p.x - p.footX;
      const dz = p.z - p.footZ;
      const yaw = Math.atan2(dx, dz);
      const len = Math.hypot(Math.hypot(dx, dz), p.y);
      const tilt = Math.atan2(Math.hypot(dx, dz), p.y);
      for (const s of [-0.28, 0.28]) {
        const g = new THREE.BoxGeometry(0.08, len, 0.08);
        g.translate(s, len / 2, 0);
        g.rotateX(tilt);
        g.rotateY(yaw);
        g.translate(p.footX, 0, p.footZ);
        wood.push(g);
      }
      for (let r = 0.5; r < len; r += 0.45) {
        const g = new THREE.BoxGeometry(0.6, 0.05, 0.05);
        g.translate(0, r, 0);
        g.rotateX(tilt);
        g.rotateY(yaw);
        g.translate(p.footX, 0, p.footZ);
        wood.push(g);
      }
    }
    // gracht (Byzantijns)
    if (f.byz) {
      const water = [];
      for (const m of this.w.map.moats) {
        if (m.team !== f.team) continue;
        const g = new THREE.PlaneGeometry(m.hx * 2, m.hz * 2);
        g.rotateX(-Math.PI / 2);
        water.push(place(g, m.cx, 0.04, m.cz, m.rot));
      }
      if (water.length) {
        const wm = new THREE.Mesh(merge(water), M.water);
        wm.receiveShadow = this.w.shadows;
        this.group.add(wm);
      }
    }
    const st = new THREE.Mesh(merge(stone), M.stone[style]);
    st.castShadow = st.receiveShadow = this.w.shadows;
    this.group.add(st);
    const rf = new THREE.Mesh(merge(roof.map((g) => (g.attributes.uv ? g : g))), style === 'hungary' || style === 'venice' ? M.redRoof : M.lead);
    rf.castShadow = this.w.shadows;
    this.group.add(rf);
    if (wood.length) {
      const wd = new THREE.Mesh(merge(wood), M.darkWood);
      wd.castShadow = this.w.shadows;
      this.group.add(wd);
    }
    // vlaggen op de hoektorens
    for (const s of f.structures) {
      if (!s.corner) continue;
      const fl = makeFlag(f.team, 2.4, 1.5);
      const top = s.h + (s.round ? (style === 'hungary' ? 9 : 6) : 3.5);
      const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3, 6), M.darkWood);
      p2.position.set(s.x, top, s.z);
      fl.position.set(s.x, top + 1.1, s.z);
      s._flag = fl;
      s._pole = p2;
      this.group.add(p2, fl);
    }
  }

  // Samengevoegde meshes opnieuw opbouwen na schade
  rebuild() {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    const M = this.w.mats;
    const buckets = { stone: [], stoneDmg: [], roof: [], wood: [], dark: [], rubble: [], rubbleWood: [] };
    for (const [st, p] of this.parts) {
      if (st.destroyed) {
        for (const r of p.rubble) (r.mat === 'wood' ? buckets.rubbleWood : buckets.rubble).push(r.g.clone());
        if (st._flag) st._flag.visible = st._pole.visible = false;
        continue;
      }
      const dmg = st.hp / st.maxHp < 0.5;
      for (const g of p.B.stone) (dmg ? buckets.stoneDmg : buckets.stone).push(g.clone());
      for (const g of p.B.roof) buckets.roof.push(g.clone());
      for (const g of p.B.wood) buckets.wood.push(g.clone());
      for (const g of p.B.dark) buckets.dark.push(g.clone());
    }
    const add = (list, mat, cast = true) => {
      if (!list.length) return;
      const m = new THREE.Mesh(merge(list), mat);
      m.castShadow = cast && this.w.shadows;
      m.receiveShadow = this.w.shadows;
      this.group.add(m);
      this.meshes.push(m);
      for (const g of list) g.dispose();
    };
    add(buckets.stone, M.stone[this.style]);
    add(buckets.stoneDmg, M.stoneDmg[this.style]);
    add(buckets.roof, this.style === 'hungary' || this.style === 'venice' ? M.redRoof : M.lead);
    add(buckets.wood, M.wood);
    add(buckets.dark, M.darkWood, false);
    add(buckets.rubble, M.stoneDmg[this.style]);
    add(buckets.rubbleWood, M.wood);
  }

  update() {
    // alleen herbouwen als de toestand veranderd is (vernield of zwaar beschadigd)
    let key = '';
    for (const st of this.f.structures) key += st.destroyed ? 'x' : st.hp / st.maxHp < 0.5 ? 'd' : 'o';
    if (key !== this.state) {
      this.state = key;
      this.rebuild();
    }
    // banier zakt bij inname van de donjon; die van de veroveraar gaat omhoog
    const f = this.f;
    const cap = f.capture;
    this.keepFlag.position.y = this.keepFlagBase - cap * 5.5;
    this.keepFlag.visible = !f.fallen;
    if (f.fallen && f.captureBy && !this.capFlags.shown) {
      const m = this.w.match;
      const victor = m.teams.find((t) => t.alliance === f.captureBy && t.alive) || m.teams.find((t) => t.alliance === f.captureBy);
      if (victor) {
        const fl = makeFlag(victor.id, 5, 3.2);
        fl.position.copy(this.keepFlag.position);
        fl.position.y = this.keepFlagBase;
        this.group.add(fl);
        this.capFlags.shown = true;
      }
    }
  }
}

function merlonSwallow() {
  const a = boxGeo(0.95, 0.8, 0.55, 3).translate(0, -0.15, 0);
  const b = boxGeo(0.32, 0.5, 0.55, 3).translate(-0.3, 0.45, 0);
  const c = boxGeo(0.32, 0.5, 0.55, 3).translate(0.3, 0.45, 0);
  return mergeGeometries([a, b, c]);
}

function rubbleFor(out, st, h, L, T, thin, tower = false) {
  // puinhoop op de plek van het verwoeste stuk muur
  const n = tower ? 10 : Math.max(6, Math.round(L / 1.6));
  let seed = st.id * 97 + 13;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ob = st.ob;
  for (let i = 0; i < n; i++) {
    const a = (r() - 0.5) * (thin ? T * 1.6 : L);
    const b = (r() - 0.5) * (thin ? L : T * 2.2);
    const s = 0.6 + r() * 1.3;
    const g = boxGeo(s * 1.4, s * 0.8, s, 3);
    const lx = thin ? b : a;
    const lz = thin ? a : b;
    out.push({ g: place(g, st.x + ob.cos * lx + ob.sin * lz, s * 0.3, st.z - ob.sin * lx + ob.cos * lz, r() * 3, r() * 0.5, r() * 0.5), mat: 'stone' });
  }
  // restant van de muur
  const g = boxGeo(thin ? T : L * 0.3, h * 0.25, thin ? L * 0.3 : T);
  out.push({ g: place(g, st.x + ob.cos * (thin ? 0 : -L * 0.35) + ob.sin * (thin ? -L * 0.35 : 0), h * 0.125, st.z - ob.sin * (thin ? 0 : -L * 0.35) + ob.cos * (thin ? -L * 0.35 : 0), st.rot), mat: 'stone' });
  if (tower) out.push({ g: place(boxGeo(L * 0.8, h * 0.3, T * 0.8), st.x, h * 0.15, st.z, st.rot + 0.3), mat: 'stone' });
}
