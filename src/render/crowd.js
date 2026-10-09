import * as THREE from 'three';

// Crowd-renderer: alle eenheden van hetzelfde model worden in één draw call getekend.
// Per eenheid staan de botmatrices (3 texels per bot) + 1 info-texel (kleurtint) in een
// float-textuur. De vertex shader leest via gl_InstanceID de juiste matrices.

const TEX_W = 2048;

const VERT_HEAD = /* glsl */ `
uniform highp sampler2D uBones;
uniform float uOffset;
uniform float uStride;
attribute float aBone;
attribute float aMetal;
attribute float aTint;
varying float vMetal;
vec4 boneTexel(int i) { return texelFetch(uBones, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0); }
mat4 boneMat(float b) {
  int base = int((uOffset + float(gl_InstanceID)) * uStride + b * 3.0 + 0.5);
  vec4 r0 = boneTexel(base);
  vec4 r1 = boneTexel(base + 1);
  vec4 r2 = boneTexel(base + 2);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
vec3 instTint() {
  int base = int((uOffset + float(gl_InstanceID)) * uStride + uStride - 1.0 + 0.5);
  return boneTexel(base).rgb;
}
`;

function patchVertex(src, withNormal) {
  src = src.replace('#include <common>', '#include <common>\n' + VERT_HEAD);
  if (withNormal) {
    src = src.replace('#include <beginnormal_vertex>', 'mat4 bMat = boneMat(aBone);\nvec3 objectNormal = normalize(mat3(bMat) * normal + 1e-6);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif');
    src = src.replace('#include <begin_vertex>', 'vec3 transformed = (bMat * vec4(position, 1.0)).xyz;\nvMetal = aMetal;');
  } else {
    src = src.replace('#include <begin_vertex>', 'vec3 transformed = (boneMat(aBone) * vec4(position, 1.0)).xyz;\nvMetal = aMetal;');
  }
  src = src.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb = mix(vColor.rgb, vColor.rgb * instTint(), aTint);\n#endif');
  return src;
}

export class CrowdRenderer {
  constructor(scene, { nb, capacity = 1500, quality = 'high', name = 'crowd' }) {
    this.scene = scene;
    this.nb = nb;
    this.stride = nb * 3 + 1; // texels per eenheid
    this.capacity = capacity;
    const texels = this.stride * capacity;
    this.rows = Math.ceil(texels / TEX_W);
    this.data = new Float32Array(TEX_W * this.rows * 4);
    this.tex = new THREE.DataTexture(this.data, TEX_W, this.rows, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.types = new Map();
    this.order = [];
    this.quality = quality;
    this.name = name;
    this.used = 0;
  }

  _material(uniforms) {
    const mat = this.quality === 'low'
      ? new THREE.MeshLambertMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = patchVertex(shader.vertexShader, true);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMetal;');
      if (this.quality !== 'low') {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.3, vMetal);')
          .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMetal * 0.9;');
      }
    };
    mat.customProgramCacheKey = () => 'crowd-' + this.quality;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = patchVertex(shader.vertexShader, false);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMetal;');
    };
    depth.customProgramCacheKey = () => 'crowd-depth';
    return { mat, depth };
  }

  // Registreert een model (geometrie met aBone/aMetal/aTint/color). lods: [{geo, maxDist, shadow}]
  addType(key, lods) {
    const t = { key, lods: [], list: [] };
    for (const lod of lods) {
      const uniforms = { uBones: { value: this.tex }, uOffset: { value: 0 }, uStride: { value: this.stride } };
      const { mat, depth } = this._material(uniforms);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = lod.geo.index;
      for (const [k, v] of Object.entries(lod.geo.attributes)) geo.setAttribute(k, v);
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false;
      mesh.castShadow = !!lod.shadow;
      mesh.receiveShadow = this.quality !== 'low';
      mesh.name = `${this.name}:${key}:${t.lods.length}`;
      this.scene.add(mesh);
      t.lods.push({ mesh, uniforms, maxDist: lod.maxDist ?? Infinity, list: [] });
    }
    this.types.set(key, t);
    this.order.push(t);
    return t;
  }

  begin() {
    for (const t of this.order) for (const l of t.lods) l.list.length = 0;
  }

  // Voeg een instantie toe; writer(data, floatOffset) schrijft de botmatrices.
  add(key, dist, item) {
    const t = this.types.get(key);
    if (!t) return;
    let l = t.lods[t.lods.length - 1];
    for (const lod of t.lods) if (dist <= lod.maxDist) {
      l = lod;
      break;
    }
    l.list.push(item);
  }

  // writer(item, data, floatOffset, tintOffset)
  end(writer) {
    let slot = 0;
    const d = this.data;
    for (const t of this.order) {
      for (const l of t.lods) {
        const n = Math.min(l.list.length, this.capacity - slot);
        l.uniforms.uOffset.value = slot;
        l.mesh.geometry.instanceCount = n;
        l.mesh.visible = n > 0;
        for (let i = 0; i < n; i++) {
          const o = (slot + i) * this.stride * 4;
          writer(l.list[i], d, o, o + this.nb * 12);
        }
        slot += n;
      }
    }
    this.used = slot;
    // alleen de gebruikte rijen uploaden
    const rowsUsed = Math.min(this.rows, Math.ceil((slot * this.stride) / TEX_W) + 1);
    this.tex.clearUpdateRanges();
    for (let r = 0; r < rowsUsed; r++) this.tex.addUpdateRange(r * TEX_W * 4, TEX_W * 4);
    this.tex.needsUpdate = true;
  }

  dispose() {
    for (const t of this.order) for (const l of t.lods) {
      this.scene.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mesh.material.dispose();
      l.mesh.customDepthMaterial.dispose();
    }
    this.tex.dispose();
  }
}
