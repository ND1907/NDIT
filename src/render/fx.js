import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { particleTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

function ix(g) {
  return g.index ? g : g;
}

// Geometrie per projectieltype, langs +Y
function projGeo(kind) {
  if (kind === 'arrow' || kind === 'bolt') {
    const L = kind === 'arrow' ? 0.82 : 0.42;
    const r = kind === 'arrow' ? 0.012 : 0.02;
    return mergeGeometries([
      new THREE.CylinderGeometry(r, r, L, 4).translate(0, 0, 0),
      new THREE.ConeGeometry(r * 2.4, 0.08, 4).translate(0, L / 2 + 0.03, 0),
      new THREE.BoxGeometry(0.06, 0.12, 0.004).translate(0, -L / 2 + 0.07, 0),
      new THREE.BoxGeometry(0.004, 0.12, 0.06).translate(0, -L / 2 + 0.07, 0),
    ].map((g) => g.toNonIndexed()));
  }
  if (kind === 'javelin') return new THREE.CylinderGeometry(0.015, 0.015, 1.3, 4);
  if (kind === 'bullet') return new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4);
  if (kind === 'cannonball') return new THREE.SphereGeometry(0.32, 10, 8);
  if (kind === 'stone') return new THREE.DodecahedronGeometry(0.5, 0);
  return new THREE.BoxGeometry(0.1, 0.1, 0.1);
}
const PROJ_MAT = {
  arrow: '#b89a64', bolt: '#6b4a2b', javelin: '#8a6a3a', bullet: '#ffe8a0', cannonball: '#2c2c2e', stone: '#8a8478',
};

export class FxView {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    this.proj = {};
    for (const k of Object.keys(PROJ_MAT)) {
      const mat = k === 'bullet'
        ? new THREE.MeshBasicMaterial({ color: PROJ_MAT[k], transparent: true, opacity: 0.7 })
        : new THREE.MeshLambertMaterial({ color: PROJ_MAT[k] });
      const m = new THREE.InstancedMesh(ix(projGeo(k)), mat, k === 'arrow' ? 1200 : 300);
      m.frustumCulled = false;
      m.count = 0;
      m.castShadow = k === 'cannonball' || k === 'stone';
      scene.add(m);
      this.proj[k] = m;
    }
    // vastzittende pijlen/bouten
    this.stuckMax = quality === 'low' ? 250 : 600;
    this.stuck = new THREE.InstancedMesh(projGeo('arrow'), new THREE.MeshLambertMaterial({ color: '#b89a64' }), this.stuckMax);
    this.stuck.count = 0;
    this.stuck.frustumCulled = false;
    scene.add(this.stuck);
    this.stuckIdx = 0;
    this.stuckN = 0;

    // deeltjes: normaal (rook/stof/bloed) en additief (vuur/vonken/mondingsvuur)
    this.max = quality === 'low' ? 1200 : 3000;
    this.normal = this._particles(false);
    this.additive = this._particles(true);
  }

  _particles(additive) {
    const N = this.max;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); // xyz + grootte
    const col = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); // rgb + alpha
    pos.setUsage(THREE.DynamicDrawUsage);
    col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', pos);
    geo.setAttribute('iCol', col);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: particleTexture() }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
      vertexShader: /* glsl */ `
        attribute vec4 iPos; attribute vec4 iCol;
        varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main() {
          vUv = uv; vCol = iCol;
          vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
          mv.xy += position.xy * iPos.w;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main() {
          float a = texture2D(map, vUv).a * vCol.a;
          if (a < 0.01) discard;
          vec3 c = vCol.rgb;
          float f = smoothstep(fogNear, fogFar, vDepth);
          ${additive ? 'gl_FragColor = vec4(c * a * (1.0 - f), a);' : 'gl_FragColor = vec4(mix(c, fogColor, f), a);'}
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 11 : 10;
    this.scene.add(mesh);
    return { mesh, pos, col, list: [], N };
  }

  syncFog(fog) {
    for (const s of [this.normal, this.additive]) {
      s.mesh.material.uniforms.fogColor.value.copy(fog.color);
      s.mesh.material.uniforms.fogNear.value = fog.near;
      s.mesh.material.uniforms.fogFar.value = fog.far;
    }
  }

  // type: 'dust' | 'smoke' | 'blood' | 'spark' | 'fire' | 'flash' | 'debris'
  emit(type, x, y, z, n = 1, o = {}) {
    for (let i = 0; i < n; i++) {
      const add = type === 'fire' || type === 'spark' || type === 'flash';
      const sys = add ? this.additive : this.normal;
      if (sys.list.length >= sys.N) sys.list.shift();
      const r = () => Math.random() - 0.5;
      const p = { x: x + r() * (o.spread || 0), y: y + r() * (o.spread || 0) * 0.5, z: z + r() * (o.spread || 0), vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.3, grow: 0, g: 0, r: 1, gC: 1, b: 1, a: 1, drag: 1 };
      const sp = o.speed ?? 1;
      const dx = o.dir ? o.dir[0] : 0;
      const dz = o.dir ? o.dir[2] : 0;
      switch (type) {
        case 'dust':
          Object.assign(p, { vx: r() * 3 * sp + dx * 2, vy: 0.5 + Math.random() * 1.5 * sp, vz: r() * 3 * sp + dz * 2, life: 1.2 + Math.random() * 1.2, size: 0.5 * (o.size || 1), grow: 1.4 * (o.size || 1), r: 0.62, gC: 0.55, b: 0.44, a: 0.55, drag: 2 });
          break;
        case 'smoke':
          Object.assign(p, { vx: r() * 0.8 + dx * sp, vy: 0.5 + Math.random() * 0.6, vz: r() * 0.8 + dz * sp, life: 2.5 + Math.random() * 2.5, size: 0.4 * (o.size || 1), grow: 1.1 * (o.size || 1), r: 0.82, gC: 0.8, b: 0.77, a: 0.5, drag: 1.2 });
          break;
        case 'blood':
          Object.assign(p, { vx: r() * 2.2 + dx * 1.5, vy: 0.5 + Math.random() * 1.8, vz: r() * 2.2 + dz * 1.5, life: 0.5 + Math.random() * 0.3, size: 0.08 + Math.random() * 0.06, grow: 0.05, g: 9, r: 0.42, gC: 0.03, b: 0.03, a: 0.9 });
          break;
        case 'spark':
          Object.assign(p, { vx: r() * 6, vy: Math.random() * 4, vz: r() * 6, life: 0.25 + Math.random() * 0.25, size: 0.06, g: 9, r: 1, gC: 0.8, b: 0.4, a: 1 });
          break;
        case 'fire':
          Object.assign(p, { vx: r() * 0.8 + dx * sp, vy: 1 + Math.random() * 1.5, vz: r() * 0.8 + dz * sp, life: 0.5 + Math.random() * 0.5, size: 0.35 * (o.size || 1), grow: 0.6, r: 1, gC: 0.45 + Math.random() * 0.25, b: 0.12, a: 0.85, drag: 1 });
          break;
        case 'flash':
          Object.assign(p, { life: 0.08, size: 0.9 * (o.size || 1), grow: 3, r: 1, gC: 0.8, b: 0.45, a: 1 });
          break;
        case 'debris':
          Object.assign(p, { vx: r() * 8 * sp, vy: 3 + Math.random() * 6 * sp, vz: r() * 8 * sp, life: 1.2, size: 0.25, g: 12, r: 0.5, gC: 0.46, b: 0.4, a: 1 });
          break;
        default:
          break;
      }
      sys.list.push(p);
    }
  }

  addStuck(x, y, z, dx, dy, dz) {
    _v.set(dx, dy, dz).normalize();
    _q.setFromUnitVectors(UP, _v);
    _p.set(x - dx * 0.3, y - dy * 0.3, z - dz * 0.3);
    _m.compose(_p, _q, _s);
    this.stuck.setMatrixAt(this.stuckIdx, _m);
    this.stuckIdx = (this.stuckIdx + 1) % this.stuckMax;
    this.stuckN = Math.min(this.stuckMax, this.stuckN + 1);
    this.stuck.count = this.stuckN;
    this.stuck.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.stuckN = 0;
    this.stuck.count = 0;
    this.normal.list.length = 0;
    this.additive.list.length = 0;
    for (const m of Object.values(this.proj)) m.count = 0;
  }

  update(dt, projectiles) {
    // projectielen
    const counts = {};
    for (const k in this.proj) counts[k] = 0;
    for (const p of projectiles) {
      const m = this.proj[p.kind];
      if (!m || counts[p.kind] >= m.instanceMatrix.count) continue;
      _v.set(p.vx, p.vy, p.vz).normalize();
      _q.setFromUnitVectors(UP, _v);
      _p.set(p.x, p.y, p.z);
      _m.compose(_p, _q, _s);
      m.setMatrixAt(counts[p.kind]++, _m);
    }
    for (const k in this.proj) {
      this.proj[k].count = counts[k];
      this.proj[k].instanceMatrix.needsUpdate = true;
    }
    // deeltjes
    for (const sys of [this.normal, this.additive]) {
      const L = sys.list;
      let w = 0;
      const P = sys.pos.array;
      const C = sys.col.array;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        p.age += dt;
        if (p.age >= p.life) continue;
        const k = 1 - Math.min(1, dt * p.drag * 0.8);
        p.vx *= k;
        p.vz *= k;
        p.vy = p.vy * k - p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.02 && p.g) {
          p.y = 0.02;
          p.vy = 0;
          p.vx *= 0.5;
          p.vz *= 0.5;
        }
        const t = p.age / p.life;
        L[w++] = p;
        const o = (w - 1) * 4;
        P[o] = p.x;
        P[o + 1] = p.y;
        P[o + 2] = p.z;
        P[o + 3] = p.size + p.grow * p.age;
        C[o] = p.r;
        C[o + 1] = p.gC;
        C[o + 2] = p.b;
        C[o + 3] = p.a * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      }
      L.length = w;
      sys.mesh.geometry.instanceCount = w;
      sys.pos.needsUpdate = true;
      sys.col.needsUpdate = true;
      sys.pos.clearUpdateRanges();
      sys.col.clearUpdateRanges();
      if (w) {
        sys.pos.addUpdateRange(0, w * 4);
        sys.col.addUpdateRange(0, w * 4);
      }
    }
  }
}
