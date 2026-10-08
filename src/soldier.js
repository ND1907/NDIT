import * as THREE from 'three';
import { TEAMS } from './teams.js';

// ---------------------------------------------------------------------------
// Gedeelde materialen (één materiaal per kleur scheelt veel GPU-werk op mobiel)
// ---------------------------------------------------------------------------
const matCache = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return matCache.get(key);
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
const box = (w, h, d, c, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat(c), x, y, z);
const cyl = (rt, rb, h, c, x, y, z, seg = 10) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c), x, y, z);
const sphere = (r, c, x, y, z) => mesh(new THREE.SphereGeometry(r, 12, 10), mat(c), x, y, z);

const SKIN = '#d9a77c';

// Arm met scharnier in de schouder. Hangt standaard langs -Y.
function makeArm(sleeveColor, x) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 1.52, 0);
  pivot.add(box(0.13, 0.5, 0.13, sleeveColor, 0, -0.24, 0));
  pivot.add(box(0.1, 0.1, 0.1, SKIN, 0, -0.52, 0));
  return pivot;
}

// Been met scharnier in de heup.
function makeLeg(trouserColor, bootColor, x) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.9, 0);
  pivot.add(box(0.17, 0.62, 0.19, trouserColor, 0, -0.33, 0));
  pivot.add(box(0.18, 0.2, 0.3, bootColor, 0, -0.8, 0.04));
  return pivot;
}

// Wapens zijn naar +Z gericht; de loop eindigt ongeveer bij z = 0.95.
function makeMusket() {
  const g = new THREE.Group();
  g.add(box(0.07, 0.11, 0.62, '#5a3418', 0, -0.02, 0.05)); // kolf
  g.add(box(0.06, 0.06, 0.55, '#6b4020', 0, 0.02, 0.55)); // voorhout
  const barrel = cyl(0.022, 0.026, 0.95, '#3a3a3e', 0, 0.07, 0.45, 8);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  g.add(box(0.03, 0.05, 0.08, '#b08a2e', 0.04, 0.05, 0.12)); // lontslot (messing)
  g.userData.muzzle = new THREE.Vector3(0, 0.07, 0.95);
  return g;
}

function makeCrossbow() {
  const g = new THREE.Group();
  g.add(box(0.07, 0.09, 0.85, '#6b4423', 0, 0, 0.28)); // lade
  const prod = box(0.72, 0.05, 0.06, '#4a4a50', 0, 0.04, 0.66); // boog
  g.add(prod);
  const s1 = box(0.37, 0.01, 0.01, '#e8e0c8', -0.17, 0.05, 0.56);
  s1.rotation.y = -0.45;
  const s2 = box(0.37, 0.01, 0.01, '#e8e0c8', 0.17, 0.05, 0.56);
  s2.rotation.y = 0.45;
  g.add(s1, s2);
  g.add(box(0.02, 0.02, 0.4, '#c9b27a', 0, 0.065, 0.55)); // pijl
  g.userData.muzzle = new THREE.Vector3(0, 0.06, 0.78);
  return g;
}

function makeMuzzleFlash() {
  const m = new THREE.MeshBasicMaterial({
    color: '#ffcf5a',
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const g = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), m);
  const p2 = p1.clone();
  p2.rotation.y = Math.PI / 2;
  const p3 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), m);
  p3.rotation.x = Math.PI / 2;
  g.add(p1, p2, p3);
  g.visible = false;
  return g;
}

// ---------------------------------------------------------------------------
// Ottomaanse janitsaar: rode kaftan, groene sjerp, gele laarzen,
// hoge witte börk-muts met afhangende flap.
// ---------------------------------------------------------------------------
function buildOttoman(s) {
  const b = s.body;
  s.legL = makeLeg('#1f3d7a', '#d8a521', -0.12);
  s.legR = makeLeg('#1f3d7a', '#d8a521', 0.12);
  b.add(s.legL, s.legR);

  b.add(cyl(0.27, 0.37, 0.62, '#b3141f', 0, 0.82, 0, 12)); // lange kaftan-rok
  b.add(box(0.52, 0.56, 0.32, '#b3141f', 0, 1.3, 0)); // bovenlijf
  b.add(box(0.2, 0.5, 0.02, '#f1e2b8', 0, 1.32, 0.165)); // binnenvest
  b.add(box(0.55, 0.12, 0.35, '#1b7a3a', 0, 1.06, 0)); // sjerp
  for (let i = 0; i < 4; i++) b.add(box(0.035, 0.035, 0.02, '#e0b53a', 0, 1.18 + i * 0.1, 0.17));

  b.add(box(0.12, 0.08, 0.12, SKIN, 0, 1.62, 0)); // nek
  b.add(sphere(0.15, SKIN, 0, 1.79, 0)); // hoofd
  b.add(box(0.17, 0.035, 0.03, '#2a1a10', 0, 1.74, 0.14)); // snor
  b.add(box(0.03, 0.03, 0.02, '#111', -0.05, 1.81, 0.14));
  b.add(box(0.03, 0.03, 0.02, '#111', 0.05, 1.81, 0.14));

  // börk (janitsarenmuts)
  b.add(cyl(0.155, 0.16, 0.08, '#d4a72c', 0, 1.9, 0, 14)); // gouden band
  b.add(cyl(0.12, 0.155, 0.36, '#f4f1ea', 0, 2.1, 0, 14));
  const flap = box(0.2, 0.5, 0.035, '#f4f1ea', 0, 1.95, -0.2);
  flap.rotation.x = 0.25;
  b.add(flap);
  b.add(box(0.05, 0.16, 0.04, '#d4a72c', 0, 2.02, 0.15)); // kaşıklık (lepelhouder) ornament

  s.armL = makeArm('#b3141f', -0.33);
  s.armR = makeArm('#b3141f', 0.33);
  b.add(s.armL, s.armR);
}

// ---------------------------------------------------------------------------
// Byzantijnse soldaat: lamellair harnas, paarse tuniek en mantel,
// spitse stalen helm met rode pluim, rond schild op de rug.
// ---------------------------------------------------------------------------
function buildByzantine(s) {
  const b = s.body;
  s.legL = makeLeg('#7a1f1f', '#4a2f1b', -0.12);
  s.legR = makeLeg('#7a1f1f', '#4a2f1b', 0.12);
  b.add(s.legL, s.legR);

  b.add(cyl(0.29, 0.34, 0.36, '#5b1a7a', 0, 0.94, 0, 12)); // tuniek-rok
  // pteruges (leren stroken)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const strip = box(0.09, 0.22, 0.03, '#7a4a22', Math.sin(a) * 0.33, 0.86, Math.cos(a) * 0.33);
    strip.rotation.y = a;
    b.add(strip);
  }
  b.add(box(0.54, 0.58, 0.34, '#8f96a3', 0, 1.3, 0)); // lamellair harnas
  for (let i = 0; i < 4; i++) b.add(box(0.55, 0.02, 0.35, '#6d7480', 0, 1.1 + i * 0.13, 0));
  b.add(box(0.56, 0.08, 0.36, '#c9a227', 0, 1.06, 0)); // gouden gordel
  const cloak = box(0.56, 0.95, 0.04, '#4b1466', 0, 1.1, -0.2);
  cloak.rotation.x = -0.08;
  b.add(cloak);

  // schild op de rug
  const shield = cyl(0.33, 0.33, 0.05, '#8c1c1c', 0, 1.28, -0.25, 18);
  shield.rotation.x = Math.PI / 2;
  b.add(shield);
  const rim = mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 20), mat('#d4a72c'), 0, 1.28, -0.28);
  b.add(rim);
  b.add(box(0.06, 0.4, 0.02, '#d4a72c', 0, 1.28, -0.285));
  b.add(box(0.4, 0.06, 0.02, '#d4a72c', 0, 1.28, -0.285));

  b.add(box(0.12, 0.08, 0.12, SKIN, 0, 1.62, 0));
  b.add(sphere(0.15, SKIN, 0, 1.79, 0));
  b.add(box(0.2, 0.12, 0.08, '#3b2414', 0, 1.69, 0.1)); // baard
  b.add(box(0.03, 0.03, 0.02, '#111', -0.05, 1.82, 0.14));
  b.add(box(0.03, 0.03, 0.02, '#111', 0.05, 1.82, 0.14));

  // helm met maliënkraag en pluim
  b.add(cyl(0.165, 0.2, 0.18, '#7d838c', 0, 1.74, -0.02, 14)); // aventail
  b.add(cyl(0.16, 0.165, 0.1, '#a9afb8', 0, 1.9, 0, 14));
  b.add(mesh(new THREE.ConeGeometry(0.165, 0.28, 14), mat('#a9afb8'), 0, 2.09, 0));
  b.add(box(0.04, 0.05, 0.12, '#a9afb8', 0, 1.82, 0.16)); // neusstuk
  const plume = cyl(0.01, 0.05, 0.22, '#c41e1e', 0, 2.3, 0, 6);
  plume.rotation.x = -0.3;
  b.add(plume);

  s.armL = makeArm('#5b1a7a', -0.33);
  s.armR = makeArm('#5b1a7a', 0.33);
  b.add(s.armL, s.armR);
}

// ---------------------------------------------------------------------------
export class Soldier {
  constructor({ team, name, isPlayer = false }) {
    this.team = team;
    this.cfg = TEAMS[team];
    this.name = name;
    this.isPlayer = isPlayer;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    if (team === 'ottoman') buildOttoman(this);
    else buildByzantine(this);

    // wapen hangt aan een draaipunt ter hoogte van de borst en volgt de pitch
    this.weaponPivot = new THREE.Group();
    this.weaponPivot.position.set(0.1, 1.38, 0.12);
    this.weapon = this.cfg.weapon === 'musket' ? makeMusket() : makeCrossbow();
    this.weaponPivot.add(this.weapon);
    this.flash = makeMuzzleFlash();
    this.flash.position.copy(this.weapon.userData.muzzle);
    this.weapon.add(this.flash);
    this.body.add(this.weaponPivot);

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.38;
    this.height = 1.95;
    this.walkPhase = 0;
    this.flashT = 0;
    this.recoil = 0;
    this.kills = 0;
    this.deaths = 0;
    this.reset();
  }

  reset() {
    this.hp = 100;
    this.alive = true;
    this.deadT = 0;
    this.ammo = this.cfg.magazine;
    this.reloadT = 0;
    this.fireCd = 0;
    this.lastHurtT = -99;
    this.lastFireT = -99;
    this.onGround = true;
    this.vel.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.root.visible = true;
  }

  // muzzle-positie in wereldcoördinaten
  muzzleWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.weapon.localToWorld(out.copy(this.weapon.userData.muzzle));
  }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.7, this.pos.z);
  }

  showFlash() {
    this.flashT = 0.06;
    this.recoil = 1;
  }

  updateAnim(dt, groundSpeed) {
    this.root.rotation.y = this.yaw;

    if (!this.alive) {
      // omvallen
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.45);
      this.body.rotation.x = -k * (Math.PI / 2) * (k * (2 - k));
      this.body.position.y = -0.1 * k;
      this.flash.visible = false;
      return;
    }

    const moving = groundSpeed > 0.3 && this.onGround;
    this.walkPhase += dt * (moving ? 2.2 + groundSpeed * 1.4 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * Math.min(0.75, groundSpeed * 0.14) : 0;
    this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, swing, 0.4);
    this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, -swing, 0.4);
    if (!this.onGround) {
      this.legL.rotation.x = 0.5;
      this.legR.rotation.x = -0.2;
    }
    this.body.position.y = moving ? Math.abs(Math.cos(this.walkPhase)) * 0.04 : 0;

    // armen houden het wapen vast, met de blikrichting mee
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const p = this.pitch;
    const reloading = this.reloadT > 0;
    const aimP = reloading ? -0.6 : p;
    this.weaponPivot.rotation.x = -aimP - this.recoil * 0.25;
    this.weaponPivot.rotation.z = reloading ? 0.5 : 0;
    this.weaponPivot.position.z = 0.12 - this.recoil * 0.06;
    this.armR.rotation.set(-Math.PI / 2 - aimP + 0.35, 0, -0.15);
    this.armL.rotation.set(-Math.PI / 2 - aimP + 0.05, 0, 0.55);

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * Math.PI;
  }
}
