import * as THREE from 'three';
import { mat } from './soldier.js';

export const MAP_HALF = 58; // speelbare halve breedte (meter)
export const WALL_Z = 38; // lijn van de Theodosiaanse muren
export const GAPS = [-30, 0, 30]; // bressen in de muur
const GAP_W = 7;

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
  }, 40, 40);
}

// Kalksteen met rode baksteenbanden, zoals de echte muren van Constantinopel.
function wallTexture(rx, ry) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#c2b08e';
    g.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        const x = col * 64 + (row % 2) * 32;
        const shade = 170 + Math.floor(r() * 40);
        g.fillStyle = `rgb(${shade + 20},${shade + 5},${shade - 25})`;
        g.fillRect(x + 1, row * 22 + 1, 62, 20);
      }
    }
    g.fillStyle = '#9c4a32';
    g.fillRect(0, 180, w, 40);
    g.fillStyle = '#7d3a27';
    for (let i = 0; i < 5; i++) g.fillRect(0, 182 + i * 8, w, 2);
    g.fillStyle = 'rgba(60,40,20,0.25)';
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

export function buildWorld(scene, { shadows = true } = {}) {
  const obstacles = []; // AABB's voor botsing en kogels
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

  // ---- lucht, licht, mist ----
  scene.background = new THREE.Color('#c9d6df');
  scene.fog = new THREE.Fog('#c9d6df', 60, 190);
  scene.add(new THREE.HemisphereLight('#e8f0ff', '#6b5a3a', 1.6));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(-40, 70, -30);
  sun.target.position.set(0, 0, 0);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -75;
    s.right = s.top = 75;
    s.near = 10;
    s.far = 200;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);

  // ---- grond ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ map: grassTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = shadows;
  scene.add(ground);

  // zandweg door het midden
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 100), mat('#a68d62'));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -8);
  road.receiveShadow = shadows;
  scene.add(road);

  // ---- Theodosiaanse muren met bressen en torens ----
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture(6, 1.2) });
  const towerMat = new THREE.MeshLambertMaterial({ map: wallTexture(1.5, 2) });
  const edges = [-75];
  for (const gx of GAPS) edges.push(gx - GAP_W / 2, gx + GAP_W / 2);
  edges.push(75);
  const merlonGeo = new THREE.BoxGeometry(1, 1, 0.6);
  const merlonPos = [];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i];
    const b = edges[i + 1];
    addBox((a + b) / 2, WALL_Z, b - a, 3, 7, wallMat);
    for (let x = a + 0.6; x < b - 0.4; x += 2) merlonPos.push([x, 7.5, WALL_Z - 1.2]);
  }
  for (const gx of GAPS) {
    for (const side of [-1, 1]) {
      const tx = gx + side * (GAP_W / 2 + 2.5);
      addBox(tx, WALL_Z - 0.5, 5, 5, 10, towerMat);
      for (let k = -2; k <= 2; k += 2) merlonPos.push([tx + k, 10.5, WALL_Z - 2.8]);
    }
    // puin in de bres
    addBox(gx + (r() - 0.5) * 3, WALL_Z + 0.5, 1.4, 1.2, 0.9, mat('#a99878'));
  }
  const merlons = new THREE.InstancedMesh(merlonGeo, mat('#b9a785'), merlonPos.length);
  const dummy = new THREE.Object3D();
  merlonPos.forEach(([x, y, z], i) => {
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    merlons.setMatrixAt(i, dummy.matrix);
  });
  merlons.castShadow = shadows;
  scene.add(merlons);

  // ---- Constantinopel op de achtergrond (Hagia Sophia-silhouet) ----
  const city = new THREE.Group();
  const stone = mat('#cdb995');
  const dome = mat('#8c8a84');
  const hb = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), stone);
  hb.position.y = 7;
  city.add(hb);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(11, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), dome);
  hd.position.y = 14;
  city.add(hd);
  for (const [dx, dz] of [[-15, 0], [15, 0]]) {
    const sd = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dome);
    sd.position.set(dx, 10, dz);
    city.add(sd);
  }
  city.position.set(10, 0, 115);
  scene.add(city);
  for (let i = 0; i < 26; i++) {
    const w = 6 + r() * 10;
    const h = 5 + r() * 9;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6 + r() * 8), stone);
    m.position.set(-110 + i * 9 + r() * 4, h / 2, 82 + r() * 18);
    scene.add(m);
  }

  // ---- Ottomaans legerkamp ----
  const tentRed = mat('#b51c22');
  const tentWhite = mat('#efe6d2');
  for (const tx of [-44, -28, 28, 44]) {
    const tz = -50 + (r() - 0.5) * 3;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 2.2, 10), tentWhite);
    base.position.set(tx, 1.1, tz);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.6, 10), tentRed);
    roof.position.set(tx, 3.5, tz);
    const pole = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), mat('#d4a72c'));
    pole.position.set(tx, 4.9, tz);
    for (const m of [base, roof]) {
      m.castShadow = shadows;
      m.receiveShadow = shadows;
    }
    scene.add(base, roof, pole);
    obstacles.push({ min: new THREE.Vector3(tx - 2.6, 0, tz - 2.6), max: new THREE.Vector3(tx + 2.6, 3.4, tz + 2.6) });
  }
  // bronzen belegeringskanonnen (Şahi topu)
  for (const cx of [-14, 14]) {
    const cz = -38;
    addBox(cx, cz, 2.2, 4.2, 0.9, mat('#5c3b1e'));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 5, 14), mat('#a8772f'));
    barrel.rotation.x = Math.PI / 2 - 0.12;
    barrel.position.set(cx, 1.4, cz + 0.4);
    barrel.castShadow = shadows;
    scene.add(barrel);
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 12), mat('#3e2915'));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(cx + s * 1.2, 0.6, cz - 1);
      scene.add(wheel);
    }
    // kogelpiramide
    for (let i = 0; i < 4; i++) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat('#4a4a4a'));
      ball.position.set(cx + 2 + (i % 2) * 0.6, i < 3 ? 0.3 : 0.75, cz - 2 + (i === 2 ? 0.5 : 0) + (i === 3 ? 0.25 : 0));
      scene.add(ball);
    }
  }

  // ---- vlaggen ----
  const flag = (x, z, kind, y0 = 0) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 8), mat('#5a3d22'));
    pole.position.set(x, y0 + 4.5, z);
    pole.castShadow = shadows;
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2, 8, 1),
      new THREE.MeshLambertMaterial({ map: flagTexture(kind), side: THREE.DoubleSide }),
    );
    cloth.position.set(x + 1.65, y0 + 7.8, z);
    cloth.userData.wave = true;
    scene.add(pole, cloth);
    return cloth;
  };
  const flags = [flag(0, -54, 'ottoman'), flag(-38, -46, 'ottoman'), flag(38, -46, 'ottoman')];
  for (const gx of GAPS) flags.push(flag(gx + GAP_W / 2 + 2.5, WALL_Z - 0.5, 'byzantine', 10));

  // ---- dekking op het middenveld ----
  const crateMat = mat('#8a5a2b');
  const crateDark = mat('#6e4521');
  const stoneMat = mat('#9e937e');
  const hayMat = mat('#d1b45c');
  const placed = [];
  const free = (x, z, d) => placed.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > d * d);
  let tries = 0;
  while (placed.length < 46 && tries++ < 2000) {
    const x = (r() * 2 - 1) * (MAP_HALF - 4);
    const z = -33 + r() * 64;
    if (!free(x, z, 5.5)) continue;
    if (Math.abs(x) < 4 && z < 30) continue; // weg vrij houden
    placed.push([x, z]);
    const kind = r();
    if (kind < 0.35) {
      // kratten (sommige gestapeld; op te springen)
      const s = 1.1;
      addBox(x, z, s, s, s, r() < 0.5 ? crateMat : crateDark);
      if (r() < 0.6) addBox(x + s, z + (r() - 0.5) * 0.3, s, s, s, crateMat);
      if (r() < 0.35) addBox(x + s * 0.5, z, s, s, s, crateDark, s);
    } else if (kind < 0.6) {
      // ruïnemuurtje
      const horiz = r() < 0.5;
      const len = 3 + r() * 4;
      addBox(x, z, horiz ? len : 1, horiz ? 1 : len, 1.3 + r() * 0.9, stoneMat);
    } else if (kind < 0.75) {
      // hooibaal
      const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 12), hayMat);
      hay.rotation.z = Math.PI / 2;
      hay.position.set(x, 0.75, z);
      hay.castShadow = shadows;
      hay.receiveShadow = shadows;
      scene.add(hay);
      obstacles.push({ min: new THREE.Vector3(x - 0.7, 0, z - 0.75), max: new THREE.Vector3(x + 0.7, 1.5, z + 0.75) });
    } else {
      // cipres / olijfboom
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
      obstacles.push({ min: new THREE.Vector3(x - 0.35, 0, z - 0.35), max: new THREE.Vector3(x + 0.35, 6, z + 0.35) });
    }
  }

  // ---- bomen langs de rand (decor) ----
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2;
    const d = 70 + r() * 25;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (z > 60) continue;
    const t = new THREE.Mesh(new THREE.ConeGeometry(1.4 + r(), 7 + r() * 4, 7), mat('#34502a'));
    t.position.set(x, 4, z);
    scene.add(t);
  }

  // ---- spawnpunten ----
  const spawns = {
    ottoman: Array.from({ length: 10 }, (_, i) => new THREE.Vector3(-20 + i * 4.4, 0, -44 - (i % 3) * 2)),
    byzantine: Array.from({ length: 10 }, (_, i) => new THREE.Vector3(-45 + i * 10, 0, 47 + (i % 3) * 3)),
  };

  return { obstacles, spawns, flags };
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
