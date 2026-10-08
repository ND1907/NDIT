import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEAMS, ARROWS_MAX } from './teams.js';

// ---------------------------------------------------------------------------
// Gedeelde materialen (één materiaal per kleur scheelt veel GPU-werk op mobiel)
// ---------------------------------------------------------------------------
const matCache = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return matCache.get(key);
}

export function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
export const box = (w, h, d, c, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat(c), x, y, z);
export const cyl = (rt, rb, h, c, x, y, z, seg = 10) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c), x, y, z);
export const sphere = (r, c, x, y, z) => mesh(new THREE.SphereGeometry(r, 12, 10), mat(c), x, y, z);

// Voegt de vaste (niet-bewegende) meshes van een groep samen per materiaal:
// van ~40 naar ~10 draw calls per soldaat.
export function mergeStatic(group) {
  const byMat = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.userData.keep) continue;
    child.updateMatrix();
    const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    g.applyMatrix4(child.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!byMat.has(child.material)) byMat.set(child.material, []);
    byMat.get(child.material).push(g);
    group.remove(child);
    child.geometry.dispose();
  }
  for (const [m, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos), m);
    merged.castShadow = true;
    group.add(merged);
  }
}

const SKIN = '#d9a77c';

// Arm met scharnier in de schouder; hangt langs -Y. `hand` zit aan het uiteinde.
function makeArm(sleeveColor, x) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 1.52, 0);
  pivot.add(box(0.13, 0.5, 0.13, sleeveColor, 0, -0.24, 0));
  pivot.add(box(0.1, 0.1, 0.1, SKIN, 0, -0.52, 0));
  pivot.userData.hand = new THREE.Group();
  pivot.userData.hand.position.set(0, -0.54, 0);
  pivot.add(pivot.userData.hand);
  return pivot;
}

function makeLeg(trouserColor, bootColor, x) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.9, 0);
  pivot.add(box(0.17, 0.62, 0.19, trouserColor, 0, -0.33, 0));
  pivot.add(box(0.18, 0.2, 0.3, bootColor, 0, -0.8, 0.04));
  return pivot;
}

// ---------------------------------------------------------------------------
// Wapens. In de hand-ruimte wijst +Z "vooruit" als de arm omlaag hangt.
// ---------------------------------------------------------------------------

// Ottomaanse kılıç: gebogen sabel met verbrede punt (yelman)
function makeKilij() {
  const g = new THREE.Group();
  g.add(box(0.04, 0.04, 0.16, '#3b2414', 0, 0, 0.02)); // greep
  g.add(box(0.18, 0.03, 0.03, '#d4a72c', 0, 0, 0.11)); // pareerstang
  const steel = '#d6dbe0';
  const segs = [[0.3, 0.28, 0.0], [0.3, 0.56, 0.08], [0.24, 0.8, 0.22]];
  for (const [len, z, rot] of segs) {
    const b = box(0.012, 0.045, len, steel, 0, rot * 0.5, z);
    b.rotation.x = -rot;
    g.add(b);
  }
  return g;
}

// Byzantijns spathion: recht tweesnijdend zwaard
function makeSpathion() {
  const g = new THREE.Group();
  g.add(box(0.04, 0.04, 0.16, '#4a2f1b', 0, 0, 0.02));
  g.add(sphere(0.035, '#d4a72c', 0, 0, -0.07));
  g.add(box(0.24, 0.035, 0.035, '#d4a72c', 0, 0, 0.11));
  g.add(box(0.014, 0.06, 0.82, '#d6dbe0', 0, 0, 0.53));
  return g;
}

// Boog in de linkerhand; stave langs Z, pees aan de kant van de schutter (+Y)
function makeBow(recurve) {
  const g = new THREE.Group();
  const wood = recurve ? '#7a2a1a' : '#6b4423';
  g.add(box(0.05, 0.05, 0.14, '#2a1a10', 0, 0, 0)); // greep
  for (const s of [-1, 1]) {
    const limb = box(0.035, 0.03, 0.5, wood, 0, 0.06, s * 0.31);
    limb.rotation.x = s * 0.25;
    g.add(limb);
    if (recurve) {
      const tip = box(0.03, 0.025, 0.14, '#d4a72c', 0, 0.06, s * 0.6);
      tip.rotation.x = -s * 0.6;
      g.add(tip);
    }
  }
  const tipZ = recurve ? 0.64 : 0.56;
  const tipY = recurve ? 0.02 : 0.13;
  const string = box(0.006, 0.006, tipZ * 2, '#efe6cf', 0, tipY, 0);
  string.userData.keep = true;
  g.add(string);
  g.userData.string = string;
  // pijl die op de pees ligt (naar voren = -Y in de hand-ruimte)
  const arrow = new THREE.Group();
  arrow.add(box(0.012, 0.7, 0.012, '#c9b27a', 0, -0.25, 0));
  arrow.add(box(0.025, 0.06, 0.025, '#555', 0, -0.62, 0));
  arrow.add(box(0.03, 0.12, 0.004, '#f1f1f1', 0, 0.06, 0));
  g.add(arrow);
  g.userData.arrow = arrow;
  return g;
}

function makeQuiver(color) {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.06, 0.6, color, 0, 0, 0, 8));
  for (let i = 0; i < 5; i++) g.add(box(0.015, 0.12, 0.03, '#f1efe6', (i - 2) * 0.025, 0.34, (i % 2) * 0.02));
  g.position.set(0.18, 1.35, -0.22);
  g.rotation.z = -0.35;
  return g;
}

function makeRoundShield(face, rimColor, boss) {
  const g = new THREE.Group();
  g.add(cyl(0.33, 0.33, 0.05, face, 0, 0, 0, 18));
  const rim = mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 20), mat(rimColor));
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  if (boss === 'cross') {
    g.add(box(0.06, 0.02, 0.42, rimColor, 0, -0.035, 0));
    g.add(box(0.42, 0.02, 0.06, rimColor, 0, -0.035, 0));
  } else {
    g.add(sphere(0.07, rimColor, 0, -0.03, 0));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Ottomaanse janitsaar: rode kaftan, groene sjerp, gele laarzen, witte börk.
// ---------------------------------------------------------------------------
function buildOttoman(s) {
  const b = s.body;
  s.legL = makeLeg('#1f3d7a', '#d8a521', -0.12);
  s.legR = makeLeg('#1f3d7a', '#d8a521', 0.12);
  b.add(s.legL, s.legR);

  b.add(cyl(0.27, 0.37, 0.62, '#b3141f', 0, 0.82, 0, 12));
  b.add(box(0.52, 0.56, 0.32, '#b3141f', 0, 1.3, 0));
  b.add(box(0.2, 0.5, 0.02, '#f1e2b8', 0, 1.32, 0.165));
  b.add(box(0.55, 0.12, 0.35, '#1b7a3a', 0, 1.06, 0));
  for (let i = 0; i < 4; i++) b.add(box(0.035, 0.035, 0.02, '#e0b53a', 0, 1.18 + i * 0.1, 0.17));

  b.add(box(0.12, 0.08, 0.12, SKIN, 0, 1.62, 0));
  b.add(sphere(0.15, SKIN, 0, 1.79, 0));
  b.add(box(0.17, 0.035, 0.03, '#2a1a10', 0, 1.74, 0.14));
  b.add(box(0.03, 0.03, 0.02, '#111', -0.05, 1.81, 0.14));
  b.add(box(0.03, 0.03, 0.02, '#111', 0.05, 1.81, 0.14));

  b.add(cyl(0.155, 0.16, 0.08, '#d4a72c', 0, 1.9, 0, 14));
  b.add(cyl(0.12, 0.155, 0.36, '#f4f1ea', 0, 2.1, 0, 14));
  const flap = box(0.2, 0.5, 0.035, '#f4f1ea', 0, 1.95, -0.2);
  flap.rotation.x = 0.25;
  b.add(flap);
  b.add(box(0.05, 0.16, 0.04, '#d4a72c', 0, 2.02, 0.15));
  // schede aan de heup
  const scab = box(0.05, 0.07, 0.8, '#3a2214', -0.3, 0.98, -0.05);
  scab.rotation.x = 0.5;
  b.add(scab);
  b.add(makeQuiver('#7a1a12'));

  s.armL = makeArm('#b3141f', -0.33);
  s.armR = makeArm('#b3141f', 0.33);
  b.add(s.armL, s.armR);
  s.sword = makeKilij();
  s.bow = makeBow(true);
}

// ---------------------------------------------------------------------------
// Byzantijnse soldaat: lamellair harnas, paarse tuniek en mantel,
// spitse helm met pluim, rond schild (op de rug of aan de arm).
// ---------------------------------------------------------------------------
function buildByzantine(s) {
  const b = s.body;
  s.legL = makeLeg('#7a1f1f', '#4a2f1b', -0.12);
  s.legR = makeLeg('#7a1f1f', '#4a2f1b', 0.12);
  b.add(s.legL, s.legR);

  b.add(cyl(0.29, 0.34, 0.36, '#5b1a7a', 0, 0.94, 0, 12));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const strip = box(0.09, 0.22, 0.03, '#7a4a22', Math.sin(a) * 0.33, 0.86, Math.cos(a) * 0.33);
    strip.rotation.y = a;
    b.add(strip);
  }
  b.add(box(0.54, 0.58, 0.34, '#8f96a3', 0, 1.3, 0));
  for (let i = 0; i < 4; i++) b.add(box(0.55, 0.02, 0.35, '#6d7480', 0, 1.1 + i * 0.13, 0));
  b.add(box(0.56, 0.08, 0.36, '#c9a227', 0, 1.06, 0));
  const cloak = box(0.56, 0.95, 0.04, '#4b1466', 0, 1.1, -0.2);
  cloak.rotation.x = -0.08;
  b.add(cloak);

  b.add(box(0.12, 0.08, 0.12, SKIN, 0, 1.62, 0));
  b.add(sphere(0.15, SKIN, 0, 1.79, 0));
  b.add(box(0.2, 0.12, 0.08, '#3b2414', 0, 1.69, 0.1));
  b.add(box(0.03, 0.03, 0.02, '#111', -0.05, 1.82, 0.14));
  b.add(box(0.03, 0.03, 0.02, '#111', 0.05, 1.82, 0.14));

  b.add(cyl(0.165, 0.2, 0.18, '#7d838c', 0, 1.74, -0.02, 14));
  b.add(cyl(0.16, 0.165, 0.1, '#a9afb8', 0, 1.9, 0, 14));
  b.add(mesh(new THREE.ConeGeometry(0.165, 0.28, 14), mat('#a9afb8'), 0, 2.09, 0));
  b.add(box(0.04, 0.05, 0.12, '#a9afb8', 0, 1.82, 0.16));
  const plume = cyl(0.01, 0.05, 0.22, '#c41e1e', 0, 2.3, 0, 6);
  plume.rotation.x = -0.3;
  b.add(plume);
  const scab = box(0.05, 0.07, 0.8, '#3a2214', -0.3, 0.98, -0.05);
  scab.rotation.x = 0.5;
  b.add(scab);
  b.add(makeQuiver('#4a2f1b'));

  s.armL = makeArm('#5b1a7a', -0.33);
  s.armR = makeArm('#5b1a7a', 0.33);
  b.add(s.armL, s.armR);
  s.sword = makeSpathion();
  s.bow = makeBow(false);

  // schild: wisselt tussen rug en linkerarm
  s.shield = makeRoundShield('#8c1c1c', '#d4a72c', 'cross');
  s.shieldBack = new THREE.Group();
  s.shieldBack.position.set(0, 1.28, -0.27);
  s.shieldBack.rotation.x = Math.PI / 2;
  b.add(s.shieldBack);
}

// ---------------------------------------------------------------------------
export class Soldier {
  constructor({ team, name, isPlayer = false, role = 'infantry' }) {
    this.team = team;
    this.cfg = TEAMS[team];
    this.name = name;
    this.isPlayer = isPlayer;
    this.role = role;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    if (team === 'ottoman') buildOttoman(this);
    else buildByzantine(this);
    mergeStatic(this.body);
    for (const part of [this.legL, this.legR, this.armL, this.armR]) mergeStatic(part);
    mergeStatic(this.sword);

    this.armR.userData.hand.add(this.sword);
    this.bowHolder = new THREE.Group();
    this.bowHolder.add(this.bow);
    this.armL.userData.hand.add(this.bowHolder);

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.38;
    this.height = 1.95;
    this.walkPhase = 0;
    this.kills = 0;
    this.deaths = 0;
    this.mounted = null; // Horse
    this.ownHorse = null;
    this.weapon = 'sword';
    this.reset();
  }

  reset() {
    this.hp = 100;
    this.alive = true;
    this.deadT = 0;
    this.arrows = ARROWS_MAX;
    this.attackCd = 0;
    this.swingT = 1; // 0..1 voortgang van de zwaardslag
    this.drawT = 1; // 0..1 boog opnieuw spannen
    this.pendingHit = -1;
    this.lastHurtT = -99;
    this.lastAttackT = -99;
    this.onGround = true;
    this.vel.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.root.visible = true;
    this.setWeapon(this.role === 'archer' ? 'bow' : 'sword');
  }

  setWeapon(w) {
    if (w === 'bow' && this.arrows <= 0 && !this.isPlayer) w = 'sword';
    this.weapon = w;
    this.sword.visible = w === 'sword';
    this.bowHolder.visible = w === 'bow';
    if (this.shield) {
      // schild aan de arm bij het zwaard, anders op de rug
      const holder = w === 'sword' ? this.armL.userData.hand : this.shieldBack;
      holder.add(this.shield);
      this.shield.position.set(0, w === 'sword' ? -0.05 : 0, w === 'sword' ? 0.05 : 0);
      this.shield.rotation.set(0, 0, 0);
    }
  }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.7, this.pos.z);
  }

  // positie van de boog (startpunt pijl)
  bowWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.armL.userData.hand.localToWorld(out.set(0, -0.1, 0));
  }

  updateAnim(dt, groundSpeed) {
    this.root.rotation.y = this.yaw;

    if (!this.alive) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.45);
      this.body.rotation.x = -k * (Math.PI / 2) * (k * (2 - k));
      this.body.position.y = -0.1 * k;
      return;
    }

    if (this.mounted) {
      // rijhouding: benen gespreid over de flanken van het paard
      this.legL.rotation.set(-0.45, 0, -0.5);
      this.legR.rotation.set(-0.45, 0, 0.5);
      this.body.position.y = Math.abs(Math.sin(this.mounted.gallopPhase)) * 0.05 * Math.min(1, this.mounted.speed / 6);
    } else {
      const moving = groundSpeed > 0.3 && this.onGround;
      this.walkPhase += dt * (moving ? 2.2 + groundSpeed * 1.4 : 0);
      const swing = moving ? Math.sin(this.walkPhase) * Math.min(0.75, groundSpeed * 0.14) : 0;
      this.legL.rotation.z = this.legR.rotation.z = 0;
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, swing, 0.4);
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, -swing, 0.4);
      if (!this.onGround) {
        this.legL.rotation.x = 0.5;
        this.legR.rotation.x = -0.2;
      }
      this.body.position.y = moving ? Math.abs(Math.cos(this.walkPhase)) * 0.04 : 0;
    }

    const p = this.pitch;
    if (this.weapon === 'bow') {
      // linkerarm strekt de boog naar voren, rechterarm trekt de pees
      this.drawT = Math.min(1, this.drawT + dt / 0.5);
      const pull = this.drawT;
      this.armL.rotation.set(-Math.PI / 2 - p, 0, 0.12);
      this.armR.rotation.set(-Math.PI / 2 - p + 0.25, 0, -0.9 + pull * 0.35);
      this.bowHolder.rotation.set(0, 0, 0.2);
      this.bow.userData.arrow.visible = this.drawT > 0.35 && this.arrows > 0;
      this.bow.userData.string.position.y = (this.bow.userData.arrow.visible ? 0.1 + pull * 0.12 : 0) + (this.team === 'ottoman' ? 0.02 : 0.13);
    } else {
      // zwaard: klaarhouding of slag van boven naar beneden
      this.swingT = Math.min(1, this.swingT + dt / 0.32);
      const t = this.swingT;
      let rx = -0.95 - p * 0.5;
      if (t < 1) rx = t < 0.25 ? THREE.MathUtils.lerp(-0.95, -2.7, t / 0.25) : THREE.MathUtils.lerp(-2.7, -0.15, (t - 0.25) / 0.75);
      this.armR.rotation.set(rx, 0, t < 1 ? -0.35 : 0.05);
      this.armL.rotation.set(this.shield ? -1.25 : -0.4, 0, this.shield ? 0.45 : 0.15);
    }
  }
}
