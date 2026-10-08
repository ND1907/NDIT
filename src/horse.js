import * as THREE from 'three';
import { box, cyl, mergeStatic } from './soldier.js';

const COATS = ['#5a3a22', '#2b1d14', '#8a5e3a', '#d8d0c0', '#6e6a66'];

function makeLeg(coat, x, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 1.05, z);
  pivot.add(box(0.15, 0.55, 0.18, coat, 0, -0.27, 0));
  pivot.add(box(0.11, 0.45, 0.12, coat, 0, -0.75, 0));
  pivot.add(box(0.14, 0.1, 0.16, '#1e1610', 0, -1.0, 0.01));
  mergeStatic(pivot);
  return pivot;
}

// Paard met zadel en schabrak (dekkleed) in teamkleuren. Kijkt naar +Z.
export class Horse {
  constructor(team, coatIdx) {
    this.team = team;
    const coat = COATS[coatIdx % COATS.length];
    const mane = coatIdx % COATS.length === 3 ? '#b8ab98' : '#1a120c';
    const cloth = team === 'ottoman' ? '#b3141f' : '#5b1a7a';
    const trim = '#d4a72c';

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const b = this.body;

    b.add(box(0.62, 0.68, 1.7, coat, 0, 1.3, 0)); // romp
    b.add(box(0.58, 0.6, 0.4, coat, 0, 1.35, 0.9)); // borst
    b.add(box(0.58, 0.62, 0.35, coat, 0, 1.32, -0.88)); // kont
    // hals + hoofd
    const neck = box(0.32, 0.85, 0.42, coat, 0, 1.85, 1.05);
    neck.rotation.x = 0.55;
    b.add(neck);
    const maneM = box(0.08, 0.8, 0.14, mane, 0, 1.95, 0.9);
    maneM.rotation.x = 0.55;
    b.add(maneM);
    const head = box(0.26, 0.28, 0.62, coat, 0, 2.18, 1.42);
    head.rotation.x = 0.45;
    b.add(head);
    b.add(box(0.06, 0.14, 0.06, coat, -0.09, 2.42, 1.22)); // oren
    b.add(box(0.06, 0.14, 0.06, coat, 0.09, 2.42, 1.22));
    b.add(box(0.27, 0.05, 0.05, '#111', 0, 2.25, 1.38)); // ogen-band/teugel
    const tail = box(0.1, 0.7, 0.12, mane, 0, 1.25, -1.15);
    tail.rotation.x = -0.35;
    b.add(tail);

    // zadel en schabrak
    b.add(box(0.7, 0.42, 1.2, cloth, 0, 1.38, -0.05));
    b.add(box(0.72, 0.06, 1.22, trim, 0, 1.17, -0.05));
    b.add(box(0.5, 0.14, 0.62, '#4a2f1b', 0, 1.69, -0.05));
    b.add(box(0.48, 0.18, 0.08, '#4a2f1b', 0, 1.78, 0.24));
    b.add(box(0.48, 0.14, 0.08, '#4a2f1b', 0, 1.76, -0.34));
    if (team === 'ottoman') b.add(cyl(0.05, 0.05, 0.05, trim, 0, 2.05, 1.05, 8)); // pluim-houder
    mergeStatic(b);

    this.legs = [
      makeLeg(coat, -0.2, 0.68), makeLeg(coat, 0.2, 0.68),
      makeLeg(coat, -0.2, -0.7), makeLeg(coat, 0.2, -0.7),
    ];
    for (const l of this.legs) this.body.add(l);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.radius = 0.75;
    this.rider = null;
    this.home = new THREE.Vector3();
    this.homeYaw = 0;
    this.gallopPhase = Math.random() * 6;
    this.idleT = Math.random() * 5;
    this.onGround = true;
    this.trampleCd = new Map();
  }

  sendHome() {
    this.pos.copy(this.home);
    this.yaw = this.homeYaw;
    this.vel.set(0, 0, 0);
    this.speed = 0;
  }

  updateAnim(dt) {
    this.root.rotation.y = this.yaw;
    const sp = this.speed;
    if (sp > 0.3) {
      // draf/galop: diagonale benen bewegen samen
      this.gallopPhase += dt * (3 + sp * 0.9);
      const amp = Math.min(0.75, 0.15 + sp * 0.06);
      const ph = this.gallopPhase;
      this.legs[0].rotation.x = Math.sin(ph) * amp;
      this.legs[3].rotation.x = Math.sin(ph + 0.3) * amp;
      this.legs[1].rotation.x = Math.sin(ph + Math.PI) * amp;
      this.legs[2].rotation.x = Math.sin(ph + Math.PI + 0.3) * amp;
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.08 * Math.min(1, sp / 6);
      this.body.rotation.x = Math.sin(ph * 2) * 0.03 * Math.min(1, sp / 6);
    } else {
      for (const l of this.legs) l.rotation.x *= 0.85;
      this.body.position.y *= 0.85;
      this.body.rotation.x *= 0.85;
    }
  }
}
