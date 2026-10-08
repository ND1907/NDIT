import * as THREE from 'three';
import { mat } from './soldier.js';

export const MAP_X = 58; // speelbare halve breedte (meter)
export const MAP_Z = 82; // speelbare halve lengte
export const FORT = { halfW: 22, front: 50, back: 78, gateW: 8, sideGateW: 5 };

// Forten: Ottomaans in het zuiden (-z), Byzantijns in het noorden (+z).
export const FORT_SIGN = { ottoman: -1, byzantine: 1 };

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function grassTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#6f7d3a';
    g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 3500; i++) {
      const v = r();
      g.fillStyle = v < 0.33 ? '#61712f' : v < 0.66 ? '#7d8a45' : '#8a8a4a';
      g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = 'rgba(120,95,60,0.35)';
      g.beginPath();
      g.arc(r() * w, r() * h, 4 + r() * 10, 0, Math.PI * 2);
      g.fill();
    }
  }, 50, 50);
}

// Byzantijns metselwerk: kalksteen met rode baksteenbanden.
// Ottomaans metselwerk: grijze breuksteen (zoals Rumelihisarı).
function wallTexture(style, rx, ry) {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = rng(style === 'byzantine' ? 11 : 23);
    g.fillStyle = style === 'byzantine' ? '#c2b08e' : '#9a958a';
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 5; col++) {
        const bw = style === 'byzantine' ? 64 : 40 + r() * 30;
        const x = col * 56 + (row % 2) * 28 + (style === 'byzantine' ? 0 : r() * 8);
        const shade = (style === 'byzantine' ? 170 : 130) + Math.floor(r() * 40);
        g.fillStyle = style === 'byzantine' ? `rgb(${shade + 20},${shade + 5},${shade - 25})` : `rgb(${shade},${shade - 3},${shade - 12})`;
        g.fillRect(x + 1, row * 32 + 1, bw - 2, 30);
      }
    }
    if (style === 'byzantine') {
      g.fillStyle = '#9c4a32';
      g.fillRect(0, 180, w, 40);
      g.fillStyle = '#7d3a27';
      for (let i = 0; i < 5; i++) g.fillRect(0, 182 + i * 8, w, 2);
    }
    g.fillStyle = 'rgba(40,30,20,0.25)';
    for (let i = 0; i < 400; i++) g.fillRect(r() * w, r() * h, 2, 2);
  }, rx, ry);
}

function flagTexture(kind) {
  return canvasTexture(256, 160, (g, w, h) => {
    if (kind === 'ottoman') {
      g.fillStyle = '#c8102e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f5f0e6';
      g.beginPath();
      g.arc(110, 80, 46, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c8102e';
      g.beginPath();
      g.arc(124, 80, 38, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f5f0e6';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 ? 9 : 22;
        g.lineTo(175 + Math.cos(a) * rad, 80 + Math.sin(a) * rad);
      }
      g.fill();
    } else {
      // Palaiologos-vlag: gouden kruis met vier vuurstalen op rood
      g.fillStyle = '#9b1020';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e3b23c';
      g.fillRect(w / 2 - 10, 0, 20, h);
      g.fillRect(0, h / 2 - 10, w, 20);
      g.font = 'bold 54px serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const pts = [[w / 4, h / 4, 1], [3 * w / 4, h / 4, -1], [w / 4, 3 * h / 4, 1], [3 * w / 4, 3 * h / 4, -1]];
      for (const [x, y, flip] of pts) {
        g.save();
        g.translate(x, y);
        g.scale(flip, 1);
        g.fillText('B', 0, 2);
        g.restore();
      }
    }
  });
}

// Poorten van een fort: positie in de muur + richting naar binnen.
export function fortGates(team) {
  const s = FORT_SIGN[team];
  const midZ = s * (FORT.front + FORT.back) / 2;
  return [
    { x: 0, z: s * FORT.front, nx: 0, nz: s }, // hoofdpoort richting slagveld
    { x: -FORT.halfW, z: midZ, nx: 1, nz: 0 }, // zijpoorten
    { x: FORT.halfW, z: midZ, nx: -1, nz: 0 },
  ];
}

// In welk gebied ligt een punt: binnen een fort, of op het open veld?
export function regionOf(x, z) {
  if (Math.abs(x) < FORT.halfW && Math.abs(z) > FORT.front && Math.abs(z) < FORT.back) return z > 0 ? 'byzantine' : 'ottoman';
  return 'field';
}

export function buildWorld(scene, { shadows = true } = {}) {
  const obstacles = []; // AABB's voor botsing en pijlen
  const r = rng(1453);

  const addBox = (x, z, w, d, h, material, y0 = 0, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y0 + h / 2, z);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    scene.add(m);
    if (collide) {
      obstacles.push({
        min: new THREE.Vector3(x - w / 2, y0, z - d / 2),
        max: new THREE.Vector3(x + w / 2, y0 + h, z + d / 2),
      });
    }
    return m;
  };
  const addObstacle = (x, z, w, d, h, y0 = 0) => obstacles.push({
    min: new THREE.Vector3(x - w / 2, y0, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y0 + h, z + d / 2),
  });

  // ---- lucht, licht, mist ----
  scene.background = new THREE.Color('#c9d6df');
  scene.fog = new THREE.Fog('#c9d6df', 70, 220);
  scene.add(new THREE.HemisphereLight('#e8f0ff', '#6b5a3a', 1.6));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(-40, 80, -25);
  sun.target.position.set(0, 0, 0);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -95;
    s.right = s.top = 95;
    s.near = 10;
    s.far = 230;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.05;
  }
  scene.add(sun, sun.target);

  // ---- grond ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ map: grassTexture() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = shadows;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 2 * FORT.front), mat('#a68d62'));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 0);
  road.receiveShadow = shadows;
  scene.add(road);

  // ---- vlaggen ----
  const flags = [];
  const flag = (x, z, kind, y0 = 0) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 8), mat('#5a3d22'));
    pole.position.set(x, y0 + 3, z);
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2, 8, 1),
      new THREE.MeshLambertMaterial({ map: flagTexture(kind), side: THREE.DoubleSide }),
    );
    cloth.position.set(x + 1.65, y0 + 4.9, z);
    scene.add(pole, cloth);
    flags.push(cloth);
  };

  // ---- de twee forten ----
  const horseSpots = { ottoman: [], byzantine: [] };
  const spawns = { ottoman: [], byzantine: [] };
  const merlonGeo = new THREE.BoxGeometry(1, 1, 1);

  for (const team of ['ottoman', 'byzantine']) {
    const s = FORT_SIGN[team];
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture(team, 5, 1) });
    const towerMat = new THREE.MeshLambertMaterial({ map: wallTexture(team, 3, 1.4) });
    const roofMat = mat(team === 'ottoman' ? '#6f7680' : '#5d6a72');
    const H = 6;
    const T = 2; // muurdikte
    const W = FORT.halfW;
    const zf = s * FORT.front;
    const zb = s * FORT.back;
    const zMid = (zf + zb) / 2;
    const merlons = [];
    const wallX = (x1, x2, z) => {
      addBox((x1 + x2) / 2, z, x2 - x1, T, H, wallMat);
      for (let x = x1 + 0.6; x < x2 - 0.4; x += 1.8) merlons.push([x, H + 0.5, z - s * (T / 2 - 0.3)]);
    };
    const wallZ = (z1, z2, x) => {
      const a = Math.min(z1, z2);
      const b = Math.max(z1, z2);
      addBox(x, (a + b) / 2, T, b - a, H, wallMat);
      for (let z = a + 0.6; z < b - 0.4; z += 1.8) merlons.push([x - Math.sign(x) * (T / 2 - 0.3), H + 0.5, z]);
    };

    const g2 = FORT.gateW / 2;
    const sg2 = FORT.sideGateW / 2;
    wallX(-W, -g2, zf);
    wallX(g2, W, zf);
    wallX(-W, W, zb);
    for (const x of [-W, W]) {
      wallZ(zf, zMid - s * sg2, x);
      wallZ(zMid + s * sg2, zb, x);
    }
    // bovendorpels boven de poorten (hoog genoeg om onderdoor te lopen)
    addBox(0, zf, FORT.gateW + 0.2, T, 1.6, wallMat, H - 1.6);
    for (const x of [-W, W]) addBox(x, zMid, T, FORT.sideGateW + 0.2, 1.8, wallMat, H - 1.8);
    // poorttorens
    for (const x of [-g2 - 1.6, g2 + 1.6]) {
      addBox(x, zf, 3.2, 3.6, H + 2.5, towerMat);
      for (const dx of [-1, 0, 1]) merlons.push([x + dx, H + 3, zf - s * 1.5]);
    }
    // ronde hoektorens met spits/koepeldak
    for (const x of [-W, W]) {
      for (const z of [zf, zb]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 9.5, 16), towerMat);
        tower.position.set(x, 4.75, z);
        tower.castShadow = shadows;
        tower.receiveShadow = shadows;
        scene.add(tower);
        const roof = team === 'ottoman'
          ? new THREE.Mesh(new THREE.ConeGeometry(3.5, 4.5, 16), roofMat)
          : new THREE.Mesh(new THREE.SphereGeometry(3.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), roofMat);
        roof.position.set(x, team === 'ottoman' ? 11.75 : 9.5, z);
        roof.castShadow = shadows;
        scene.add(roof);
        addObstacle(x, z, 6, 6, 9.5);
        flag(x, z, team, team === 'ottoman' ? 13.5 : 12.4);
      }
    }
    const merl = new THREE.InstancedMesh(merlonGeo, towerMat, merlons.length);
    const dummy = new THREE.Object3D();
    merlons.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.scale.set(0.9, 1, 0.9);
      dummy.updateMatrix();
      merl.setMatrixAt(i, dummy.matrix);
    });
    merl.castShadow = shadows;
    scene.add(merl);

    // donjon (woontoren) achterin
    const keepZ = s * 71;
    addBox(0, keepZ, 9, 7, 11, towerMat);
    const keepRoof = team === 'ottoman'
      ? new THREE.Mesh(new THREE.ConeGeometry(6.2, 5, 4), roofMat)
      : new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), roofMat);
    keepRoof.position.set(0, team === 'ottoman' ? 13.5 : 11, keepZ);
    if (team === 'ottoman') keepRoof.rotation.y = Math.PI / 4;
    keepRoof.castShadow = shadows;
    scene.add(keepRoof);
    flag(0, keepZ, team, team === 'ottoman' ? 16 : 15);

    // stal met afdak (linksachter)
    const stableZ = s * 70;
    for (const [px, pz] of [[-19.5, stableZ - 4], [-19.5, stableZ + 4], [-10.5, stableZ - 4], [-10.5, stableZ + 4]]) {
      addBox(px, pz, 0.35, 0.35, 3.2, mat('#5b4026'));
    }
    addBox(-15, stableZ, 10.5, 9.5, 0.3, mat('#7a5232'), 3.2, false);
    addBox(-15, stableZ + s * 4.6, 10, 0.3, 1.2, mat('#6b4423'), 0, false);
    for (let i = 0; i < 4; i++) {
      horseSpots[team].push({ pos: new THREE.Vector3(-18 + i * 2.2, 0, stableZ), yaw: s > 0 ? Math.PI : 0 });
    }

    // rechtsachter: tenten (Ottomaans) of kapel met koepel (Byzantijns)
    if (team === 'ottoman') {
      for (const tx of [11, 17]) {
        const tz = s * 70;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 2.2, 10), mat('#efe6d2'));
        base.position.set(tx, 1.1, tz);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 2.4, 10), mat('#b51c22'));
        roof.position.set(tx, 3.4, tz);
        base.castShadow = roof.castShadow = shadows;
        scene.add(base, roof);
        addObstacle(tx, tz, 4.4, 4.4, 3.2);
      }
    } else {
      addBox(14, s * 70, 7, 7, 5, mat('#cdb995'));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#8c8a84'));
      dome.position.set(14, 5, s * 70);
      scene.add(dome);
      addBox(14, s * 70 - 3.6 * s, 0.25, 0.15, 1.6, mat('#d4a72c'), 5.2, false);
    }

    // blijde (trebuchet) bij de voormuur, decoratie met botsing
    const tb = new THREE.Group();
    const wood = mat('#5b4026');
    const post = (x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 0.3), wood);
      m.position.set(x, 2.1, 0);
      tb.add(m);
    };
    post(-0.8);
    post(0.8);
    const baseB = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 3.2), wood);
    baseB.position.y = 0.15;
    tb.add(baseB);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 7), mat('#6b4423'));
    arm.position.set(0, 4.1, 0);
    arm.rotation.x = -0.6;
    tb.add(arm);
    const cw = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat('#4a4a4a'));
    cw.position.set(0, 2.2, -2);
    tb.add(cw);
    tb.traverse((o) => { if (o.isMesh) o.castShadow = shadows; });
    tb.position.set(18.5, 0, s * 57);
    tb.rotation.y = s > 0 ? Math.PI : 0;
    scene.add(tb);
    addObstacle(18.5, s * 57, 2.6, 3.4, 4);

    // spawnpunten binnen het fort
    for (let i = 0; i < 10; i++) spawns[team].push(new THREE.Vector3(-14 + (i % 5) * 7, 0, s * (55 + Math.floor(i / 5) * 4)));
  }

  // ---- Constantinopel op de achtergrond ----
  const stone = mat('#cdb995');
  const domeMat = mat('#8c8a84');
  const hb = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), stone);
  hb.position.set(10, 7, 140);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(11, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  hd.position.set(10, 14, 140);
  scene.add(hb, hd);
  for (let i = 0; i < 24; i++) {
    const w = 6 + r() * 10;
    const h = 5 + r() * 9;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6 + r() * 8), stone);
    m.position.set(-110 + i * 9.5 + r() * 4, h / 2, 116 + r() * 18);
    scene.add(m);
  }

  // ---- dekking op het slagveld ----
  const crateMat = mat('#8a5a2b');
  const crateDark = mat('#6e4521');
  const stoneMat = mat('#9e937e');
  const hayMat = mat('#d1b45c');
  const placed = [];
  const free = (x, z, d) => placed.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > d * d);
  let tries = 0;
  while (placed.length < 52 && tries++ < 3000) {
    const x = (r() * 2 - 1) * (MAP_X - 4);
    const z = (r() * 2 - 1) * (FORT.front - 7);
    if (!free(x, z, 6)) continue;
    if (Math.abs(x) < 4.5) continue; // weg vrij houden
    placed.push([x, z]);
    const kind = r();
    if (kind < 0.3) {
      const s = 1.1;
      addBox(x, z, s, s, s, r() < 0.5 ? crateMat : crateDark);
      if (r() < 0.6) addBox(x + s, z + (r() - 0.5) * 0.3, s, s, s, crateMat);
      if (r() < 0.35) addBox(x + s * 0.5, z, s, s, s, crateDark, s);
    } else if (kind < 0.55) {
      const horiz = r() < 0.5;
      const len = 3 + r() * 4;
      addBox(x, z, horiz ? len : 1, horiz ? 1 : len, 1.3 + r() * 0.9, stoneMat);
    } else if (kind < 0.7) {
      const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 12), hayMat);
      hay.rotation.z = Math.PI / 2;
      hay.position.set(x, 0.75, z);
      hay.castShadow = shadows;
      hay.receiveShadow = shadows;
      scene.add(hay);
      addObstacle(x, z, 1.4, 1.5, 1.5);
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2, 6), mat('#5b4026'));
      trunk.position.set(x, 1, z);
      const cypress = r() < 0.5;
      const leaves = cypress
        ? new THREE.Mesh(new THREE.ConeGeometry(1.1, 6, 8), mat('#2f4a24'))
        : new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), mat('#56693a'));
      leaves.position.set(x, cypress ? 4.6 : 3.4, z);
      for (const m of [trunk, leaves]) {
        m.castShadow = shadows;
        scene.add(m);
      }
      addObstacle(x, z, 0.7, 0.7, 6);
    }
  }

  // ---- bomen langs de rand (decor) ----
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    const x = Math.cos(a) * (72 + r() * 25);
    const z = Math.sin(a) * (100 + r() * 25);
    if (z > 95) continue;
    const t = new THREE.Mesh(new THREE.ConeGeometry(1.4 + r(), 7 + r() * 4, 7), mat('#34502a'));
    t.position.set(x, 4, z);
    scene.add(t);
  }

  return { obstacles, spawns, flags, horseSpots };
}

// Ray tegen AABB (slab-methode). Geeft afstand of Infinity.
export function rayAABB(o, d, box, maxT) {
  let tmin = 0;
  let tmax = maxT;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-8) {
      if (o[ax] < box.min[ax] || o[ax] > box.max[ax]) return Infinity;
    } else {
      const inv = 1 / d[ax];
      let t1 = (box.min[ax] - o[ax]) * inv;
      let t2 = (box.max[ax] - o[ax]) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}
