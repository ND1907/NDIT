// Realistisch menselijk lichaam (MakeHuman-basismesh, CC0) met per eenheidstype
// geschilderde kleding en wapenrusting.
//
// Werkwijze:
//  - De basismesh (3 LOD's, 4 botten per vertex) wordt uit human-data.js gedecodeerd.
//  - Eén keer wordt een "positiekaart" in UV-ruimte gerasterd: per texel de 3D-rustpositie,
//    de normaal en het lichaamsdeel. Daardoor kan kleding op basis van 3D-positie worden
//    geschilderd: naadloos over de UV-naden heen en per lichaamszone (mouw, romp, been…).
//  - Een uitrusting (outfit) is een stapel lagen, van buiten naar binnen. Per texel bepaalt de
//    buitenste laag die daar iets heeft de kleur, het metaalgehalte en het reliëf; per vertex
//    bepaalt dezelfde laag hoeveel de geometrie naar buiten wordt geduwd (stofdikte, harnas).
import * as THREE from 'three';
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { HUMAN_HEADER, HUMAN_BIN } from './assets/human-data.js';
import { HUMAN_JOINTS as J } from './assets/human-rig.js';

export { J as HUMAN_JOINTS };

// Lichaamsdelen (op basis van het zwaarste bot)
export const PART = { PELVIS: 0, SPINE: 1, HEAD: 2, UARM: 3, LARM: 4, HAND: 5, THIGH: 6, SHIN: 7, FOOT: 8, EYE: 9 };
const BONE_PART = { 0: 0, 1: 1, 2: 2, 3: 3, 5: 3, 4: 4, 6: 4, 11: 5, 12: 5, 7: 6, 9: 6, 8: 7, 10: 7, 18: 8, 19: 8 };

// Vrije plekken in de UV-atlas (het lichaam gebruikt die niet)
export const ATLAS = {
  skirt: [0.47, 0.845, 0.63, 0.995],
  cape: [0.64, 0.845, 0.76, 0.995],
  sw: { cloth: [0.77, 0.845, 0.81, 0.915], metal: [0.815, 0.845, 0.855, 0.915], wood: [0.86, 0.845, 0.9, 0.915], leather: [0.77, 0.925, 0.81, 0.995], fur: [0.815, 0.925, 0.855, 0.995], dark: [0.86, 0.925, 0.9, 0.995] },
  eye: [0.94, 0.94, 0.99, 0.99],
};

// ---------------------------------------------------------------------------
// Basismesh decoderen
// ---------------------------------------------------------------------------
let BASE = null;
function b64(s) {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}
export function humanBase() {
  if (BASE) return BASE;
  const raw = unzlibSync(b64(HUMAN_BIN));
  const buf = raw.buffer;
  const o0 = raw.byteOffset;
  BASE = HUMAN_HEADER.lods.map((L) => {
    const n = L.count;
    const lod = {
      count: n,
      pos: new Float32Array(buf, o0 + L.pos, n * 3),
      nor: new Int8Array(buf, o0 + L.nor, n * 4),
      uv: new Uint16Array(buf, o0 + L.uv, n * 2),
      si: new Uint8Array(buf, o0 + L.si, n * 4),
      sw: new Uint8Array(buf, o0 + L.sw, n * 4),
      misc: new Uint8Array(buf, o0 + L.misc, n * 4),
      idx: L.idx32 ? new Uint32Array(buf, o0 + L.idx, L.tris * 3) : new Uint16Array(buf, o0 + L.idx, L.tris * 3),
    };
    lod.part = new Uint8Array(n);
    for (let i = 0; i < n; i++) lod.part[i] = lod.misc[i * 4 + 1] ? PART.EYE : BONE_PART[lod.si[i * 4]] ?? PART.SPINE;
    return lod;
  });
  return BASE;
}

// ---------------------------------------------------------------------------
// Ruis (3D, op rustpositie → naadloos)
// ---------------------------------------------------------------------------
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
function fbm(x, y, z, oct = 3) {
  let a = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    a += vnoise(x * f, y * f, z * f) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return a;
}

// kleur hulpjes: [r,g,b] 0..1 in sRGB (de textuur is sRGB, dus geen omzetting naar lineair)
export function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------------------------------------------------------------------------
// Positiekaart (UV-ruimte) — één keer per resolutie
// ---------------------------------------------------------------------------
const GB = new Map();
function gbuffer(N) {
  if (GB.has(N)) return GB.get(N);
  const L = humanBase()[0];
  const pos = new Float32Array(N * N * 3);
  const nor = new Float32Array(N * N * 3);
  const part = new Uint8Array(N * N).fill(255);
  const uvx = (i) => (L.uv[i * 2] / 65535) * N - 0.5;
  const uvy = (i) => (L.uv[i * 2 + 1] / 65535) * N - 0.5;
  for (let t = 0; t < L.idx.length; t += 3) {
    const a = L.idx[t];
    const b = L.idx[t + 1];
    const c = L.idx[t + 2];
    const ax = uvx(a), ay = uvy(a), bx = uvx(b), by = uvy(b), cx = uvx(c), cy = uvy(c);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)));
    // dominant lichaamsdeel van de driehoek (meerderheid)
    const pa = L.part[a];
    const pb = L.part[b];
    const pc = L.part[c];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
        let w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
        let w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        w0 = Math.max(0, w0);
        w1 = Math.max(0, w1);
        w2 = Math.max(0, w2);
        const s = w0 + w1 + w2;
        w0 /= s;
        w1 /= s;
        w2 /= s;
        const k = y * N + x;
        for (let q = 0; q < 3; q++) {
          pos[k * 3 + q] = L.pos[a * 3 + q] * w0 + L.pos[b * 3 + q] * w1 + L.pos[c * 3 + q] * w2;
          nor[k * 3 + q] = (L.nor[a * 4 + q] * w0 + L.nor[b * 4 + q] * w1 + L.nor[c * 4 + q] * w2) / 127;
        }
        part[k] = w0 >= w1 && w0 >= w2 ? pa : w1 >= w2 ? pb : pc;
      }
    }
  }
  // randen uitbreiden (tegen naden bij mipmaps)
  for (let pass = 0; pass < 6; pass++) {
    const src = part.slice();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const k = y * N + x;
      if (src[k] !== 255) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const kk = yy * N + xx;
        if (src[kk] === 255) continue;
        part[k] = src[kk];
        for (let q = 0; q < 3; q++) {
          pos[k * 3 + q] = pos[kk * 3 + q];
          nor[k * 3 + q] = nor[kk * 3 + q];
        }
        break;
      }
    }
  }
  const g = { N, pos, nor, part };
  GB.set(N, g);
  return g;
}

// ---------------------------------------------------------------------------
// Lichaamsmaten (rustpose, meter)
// ---------------------------------------------------------------------------
export const BODY = {
  ankle: J.ankleR[1], knee: J.kneeR[1], hip: J.hipR[1], crotch: J.hipR[1] - 0.075, waist: 1.03, chest: 1.26,
  shoulder: J.shoulderR[1], neck: J.neck[1], neckBase: J.neck[1] - 0.04, chin: J.chin[1], mouth: (J.mouth[1] + J.lowerLip[1]) / 2,
  nose: J.noseTip[1], eye: J.eyeR[1], brow: J.eyeR[1] + 0.022, top: J.headTop[1], wrist: J.wristR[1], elbow: J.elbowR[1],
};

// ---------------------------------------------------------------------------
// Lagen. Elke laag: (ctx) => null | { c:[r,g,b], m: metaal 0..1, h: reliëf 0..1, t: dikte (m), skin?: bool }
// ctx = { x, y, z, nx, ny, nz, part, ax: |x|, side }
// ---------------------------------------------------------------------------
const torsoParts = (p) => p === PART.SPINE || p === PART.PELVIS;
const armPart = (p) => p === PART.UARM || p === PART.LARM;
const legPart = (p) => p === PART.THIGH || p === PART.SHIN || p === PART.FOOT;

// Is dit punt bedekt door een kledingstuk dat de romp bedekt van `bottom` tot de hals, met mouwen tot `sleeve`?
function coversTorso(q, bottom, sleeve, neck = 'round', top = null) {
  const { y, part } = q;
  if (part === PART.HEAD || part === PART.EYE || part === PART.HAND || part === PART.FOOT) {
    if (part === PART.HEAD && y < BODY.neckBase - 0.01) return true;
    return false;
  }
  if (armPart(part)) {
    if (sleeve === 'none') return part === PART.UARM && y > BODY.shoulder - 0.06;
    if (sleeve === 'short') return part === PART.UARM && y > BODY.elbow + 0.1;
    if (sleeve === 'elbow') return part === PART.UARM || (part === PART.LARM && y > BODY.elbow - 0.04);
    return y > BODY.wrist + 0.025;
  }
  if (legPart(part) && y < BODY.crotch) return false;
  if (y < bottom) return false;
  // halsopening
  const ny = top ?? BODY.neckBase;
  if (neck === 'v' && q.z > 0) return y < ny - Math.max(0, 0.11 - q.ax * 1.6);
  if (neck === 'high') return y < ny + 0.035;
  if (neck === 'low') return y < ny - (q.z > 0 ? 0.035 : 0);
  return y < ny;
}

// stofstructuur: lichte kleurvariatie en plooien
function cloth(q, base, k = 1, weave = 1) {
  const n = fbm(q.x * 9, q.y * 4, q.z * 9);
  const fine = vnoise(q.x * 260, q.y * 260, q.z * 260);
  const fold = Math.pow(Math.abs(Math.sin(q.x * 37 + Math.sin(q.z * 23) * 2 + n * 5)), 3) * 0.12;
  const s = 1 + (n - 0.5) * 0.22 * k - fold * k + (fine - 0.5) * 0.06 * weave;
  return mulc(base, s);
}
function leather(q, base) {
  const n = fbm(q.x * 30, q.y * 30, q.z * 30);
  const w = fbm(q.x * 5, q.y * 5, q.z * 5);
  return mulc(base, 0.85 + n * 0.25 + (w - 0.5) * 0.25);
}
function steel(q, base, polish = 1) {
  const n = fbm(q.x * 6, q.y * 6, q.z * 6);
  const scratch = vnoise(q.x * 400, q.y * 40, q.z * 400);
  return mulc(base, 0.86 + n * 0.22 * polish - scratch * 0.05);
}

// banden en kruizen op de borst/rug (x = links/rechts, y = hoogte)
const band = (v, c, w) => Math.abs(v - c) < w;

export const LAYERS = {
  // --- basis: huid
  skin(q, o) {
    const tone = o.tone;
    const n = fbm(q.x * 40, q.y * 40, q.z * 40);
    let c = mulc(tone, 0.94 + n * 0.12);
    if (q.part === PART.HEAD) {
      // rode wangen/neus/oren, lichtere stoppels
      const cheek = Math.max(0, 1 - Math.hypot(q.ax - 0.045, q.y - BODY.nose + 0.005, q.z - 0.11) / 0.03);
      c = mixc(c, mixc(tone, [0.78, 0.4, 0.36], 0.6), cheek * 0.35);
      if (q.z > 0.13 && q.ax < 0.012 && q.y < BODY.nose + 0.02 && q.y > BODY.nose - 0.015) c = mixc(c, [0.75, 0.42, 0.38], 0.15);
    }
    return { c, m: 0, h: n * 0.2, t: 0, skin: true };
  },
  // --- gezicht: ogen, wenkbrauwen, lippen, baard, snor, haar
  face(q, o) {
    const p = q.part;
    if (p === PART.EYE) {
      // oogbol: wit met iris en pupil naar voren
      const ex = q.x < 0 ? J.eyeR : J.eyeL;
      const dx = q.x - ex[0];
      const dy = q.y - ex[1];
      const r = Math.hypot(dx, dy);
      const front = q.z > ex[2] + 0.004;
      if (front && r < 0.0035) return { c: [0.03, 0.02, 0.02], m: 0, h: 0, t: 0 };
      if (front && r < 0.0068) return { c: mixc(o.iris, mulc(o.iris, 0.5), r / 0.0068), m: 0, h: 0, t: 0 };
      return { c: [0.86, 0.82, 0.78], m: 0, h: 0, t: 0 };
    }
    if (p !== PART.HEAD) return null;
    const { y, z, ax } = q;
    const front = z > 0.07;
    // wenkbrauwen
    if (front && y > BODY.eye + 0.012 && y < BODY.eye + 0.024 + (0.05 - ax) * 0.1 && ax > 0.008 && ax < 0.058 && z > 0.1) {
      const n = vnoise(q.x * 900, q.y * 900, 0);
      return { c: mixc(o.hair, mulc(o.hair, 1.4), n * 0.3), m: 0, h: 0.4, t: 0.0008 };
    }
    // lippen
    if (z > 0.14 && Math.abs(y - BODY.mouth) < 0.0065 && ax < 0.024) return { c: mixc(o.tone, [0.62, 0.3, 0.28], 0.45), m: 0, h: 0.2, t: 0 };
    // snor
    if (o.mustache && z > 0.12 && y > BODY.mouth + 0.002 && y < BODY.nose - 0.01 && ax < (o.mustache === 'long' ? 0.045 : 0.03)) {
      return { c: mulc(o.beard, 0.9 + vnoise(q.x * 600, q.y * 150, q.z * 600) * 0.25), m: 0, h: 0.8, t: 0.004 };
    }
    // baard: onder de kaaklijn (loopt op van de kin naar de oren), zachte rand met ruis
    if (o.beardStyle) {
      const jaw = BODY.chin - 0.01 + Math.max(0, 0.13 - z) * 0.42; // onderrand (hals blijft vrij)
      const top = o.beardStyle === 'goatee' ? BODY.mouth - 0.004 : BODY.mouth + 0.01 - Math.max(0, 0.12 - z) * 0.05;
      const wMax = o.beardStyle === 'goatee' ? 0.028 : o.beardStyle === 'short' ? 0.07 : 0.09;
      const edge = vnoise(q.x * 300, q.y * 300, q.z * 300) * 0.012;
      const lipFree = z > 0.14 && Math.abs(y - BODY.mouth) < 0.007 && ax < 0.022;
      const cheekFree = y > BODY.mouth - 0.002 && ax > 0.032 && z > 0.07;
      const below = y > jaw - (o.beardLong ? 0.05 : 0) - edge && y < top + edge;
      if (below && ax < wMax && z > (o.beardStyle === 'full' ? -0.01 : 0.03) && !lipFree && !cheekFree) {
        const n = vnoise(q.x * 500, q.y * 120, q.z * 500);
        const thick = o.beardStyle === 'full' ? (o.beardLong ? 0.02 : 0.012) : o.beardStyle === 'short' ? 0.006 : 0.004;
        const fade = Math.min(1, (y - jaw + 0.02) / 0.02);
        const base = LAYERS.skin(q, o).c;
        return { c: mixc(base, mulc(o.beard, 0.8 + n * 0.4), 0.55 + 0.45 * Math.min(1, fade)), m: 0, h: 0.9, t: thick * Math.max(0.3, fade) };
      }
    }
    // stoppels
    if (o.stubble && front && y < BODY.mouth + 0.012 && y > BODY.chin - 0.04 && !(z > 0.14 && Math.abs(y - BODY.mouth) < 0.007)) {
      const base = LAYERS.skin(q, o);
      base.c = mixc(base.c, o.beard, 0.28);
      return base;
    }
    // hoofdhaar
    if (o.hairStyle !== 'bald') {
      const hairline = o.hairStyle === 'shaved' ? 1 : 0;
      const fromFront = z - 0.03;
      const scalp =
        (y > BODY.eye + 0.055 - Math.max(0, -fromFront) * 0.3 && !(front && y < BODY.eye + 0.06 + hairline * 0.02)) ||
        (z < 0.0 && y > BODY.neck + 0.035) ||
        (ax > 0.07 && y > BODY.eye - 0.005 && z < 0.06 && !(Math.abs(z - 0.03) < 0.02 && y < BODY.eye + 0.03));
      if (scalp && !(o.hairStyle === 'tonsure' && y > BODY.top - 0.03)) {
        const n = vnoise(q.x * 700, q.y * 200, q.z * 700);
        const c = o.hairStyle === 'shaved' ? mixc(o.tone, o.hair, 0.35) : mulc(o.hair, 0.75 + n * 0.45);
        return { c, m: 0, h: 0.6, t: o.hairStyle === 'shaved' ? 0 : o.hairStyle === 'long' ? 0.012 : 0.006 };
      }
    }
    return null;
  },

  // --- broek/hozen
  hose(q, o) {
    const { part, y } = q;
    if (!(legPart(part) || (part === PART.PELVIS && y < BODY.waist + 0.02))) return null;
    if (part === PART.FOOT && !o.feet) return null;
    let c = cloth(q, o.color, 0.6);
    if (o.stripe && q.ax > 0.0 && Math.abs(q.x - Math.sign(q.x) * 0.13) < 0.012) c = o.stripe;
    return { c, m: 0, h: 0.15, t: o.t ?? 0.004 };
  },
  // --- laarzen (top = hoogte van de schacht)
  boots(q, o) {
    const { part, y } = q;
    if (!(part === PART.FOOT || ((part === PART.SHIN || part === PART.THIGH) && y < o.top))) return null;
    let c = leather(q, o.color);
    if (Math.abs(y - o.top) < 0.012) c = mulc(c, 0.75);
    if (o.cuff && y > o.top - 0.04) c = o.cuff;
    if (part === PART.FOOT && y < 0.012) c = mulc(c, 0.55);
    // schoen: tenen wegwerken (dikker over de voet)
    const toe = part === PART.FOOT ? 0.008 : 0;
    return { c, m: 0, h: 0.35, t: (o.t ?? 0.006) + toe + (y > o.top - 0.02 ? 0.003 : 0) };
  },
  // --- hemd/tuniek/kaftan/gambeson: alles wat romp + mouwen bedekt
  coat(q, o) {
    if (!coversTorso(q, o.bottom ?? BODY.crotch, o.sleeves ?? 'long', o.neck ?? 'round')) return null;
    let c = cloth(q, o.color, 1);
    let h = 0.2;
    let m = 0;
    // voorsluiting (kaftan)
    if (o.open && q.z > 0.02 && q.ax < 0.012 + (o.trimW || 0)) {
      if (q.ax < 0.004) c = mulc(o.inner || o.color, 0.45);
      else if (o.trim) c = o.trim;
    }
    if (o.trim && o.open && q.z > 0.02 && Math.abs(q.ax - 0.012) < (o.trimW || 0.01) && q.y < BODY.neckBase) c = o.trim;
    // knopen/lussen (çapraz) op de borst
    if (o.frogs && q.z > 0.05 && q.y > BODY.waist && q.y < BODY.chest + 0.12 && q.ax < 0.05) {
      const row = (q.y - BODY.waist) / 0.045;
      if (Math.abs(row - Math.round(row)) < 0.18) {
        c = o.frogs;
        h = 0.8;
        m = 0.6;
      }
    }
    // gewatteerd (verticale stiklijnen)
    if (o.quilt) {
      const a = Math.atan2(q.x, q.z) * 0.16;
      const line = Math.abs(((a + 10) % 0.028) - 0.014) < 0.0022;
      if (line && !armPart(q.part)) {
        c = mulc(c, 0.72);
        h = 0;
      } else h = 0.7;
      if (armPart(q.part)) {
        const ring = Math.abs(((q.y + 10) % 0.035) - 0.0175) < 0.0025;
        if (ring) {
          c = mulc(c, 0.72);
          h = 0;
        }
      }
    }
    // zoom aan de mouw en onderrand
    if (armPart(q.part) && (o.sleeves ?? 'long') === 'long' && q.y < BODY.wrist + 0.05 && o.cuff) c = o.cuff;
    if (o.hem && torsoParts(q.part) && q.y < (o.bottom ?? BODY.crotch) + 0.025) c = o.hem;
    if (o.brocade && !armPart(q.part)) {
      // brokaat: zacht granaatappelmotief (geweven, laag contrast)
      const a = Math.atan2(q.x, q.z) * 0.16;
      const u = a * 26;
      const v = q.y * 26 + (Math.floor(u) % 2) * 0.5;
      const fu = u - Math.floor(u) - 0.5;
      const fv = v - Math.floor(v) - 0.5;
      const motif = Math.max(0, 1 - Math.hypot(fu * 1.3, fv) * 2.6);
      c = mixc(c, o.brocade, motif * 0.45);
      if (motif > 0) return { c, m: motif * 0.35, h: 0.2 + motif * 0.6, t: o.t ?? 0.006 };
    }
    return { c, m, h, t: o.t ?? 0.006 };
  },
  // --- maliënhemd
  mail(q, o) {
    if (!coversTorso(q, o.bottom ?? BODY.crotch + 0.04, o.sleeves ?? 'elbow', 'high', o.coif ? BODY.top : null)) {
      // maliënkap (camail/aventail) rond de hals
      if (!(o.aventail && q.part === PART.HEAD && q.y < BODY.chin - 0.005 + (q.z < 0.02 ? 0.06 : 0))) return null;
    }
    const row = q.y * 145;
    const a = Math.atan2(q.x, q.z) * 0.16 * 145 + (Math.floor(row) % 2) * 0.5;
    const fx = a - Math.floor(a);
    const fy = row - Math.floor(row);
    const ring = Math.hypot(fx - 0.5, fy - 0.5);
    const lit = ring > 0.18 && ring < 0.45 ? 1 : 0.42;
    const base = o.color || [0.55, 0.57, 0.6];
    const rust = fbm(q.x * 12, q.y * 12, q.z * 12);
    const c = mixc(mulc(base, lit), [0.42, 0.3, 0.2], Math.max(0, rust - 0.62) * 0.8);
    return { c, m: 0.75 * lit, h: lit, t: o.t ?? 0.012 };
  },
  // --- lamellair (rijen kleine plaatjes, met veters verbonden)
  lamellar(q, o) {
    if (!torsoParts(q.part) && !(q.part === PART.UARM && o.sleeves && q.y > BODY.elbow + 0.08)) return null;
    if (q.y > (o.top ?? BODY.shoulder + 0.02) || q.y < (o.bottom ?? BODY.waist - 0.08)) return null;
    if (legPart(q.part)) return null;
    // schouders open laten waar de hals is
    if (q.y > BODY.neckBase - 0.02 && q.ax < 0.08) return null;
    const rowH = 0.05;
    const r = (q.y - 0.4) / rowH;
    const ri = Math.floor(r);
    const fy = r - ri;
    const a = Math.atan2(q.x, q.z) * 0.16 / 0.022 + (ri % 2) * 0.5;
    const fx = a - Math.floor(a);
    const lace = fy < 0.12 || (fy > 0.45 && fy < 0.52 && Math.abs(fx - 0.5) < 0.12);
    const edge = fx < 0.07 || fx > 0.93;
    const base = o.color || [0.62, 0.64, 0.66];
    let c = steel(q, base);
    let h = 0.85 - fy * 0.35;
    let m = o.metal ?? 0.85;
    if (edge) {
      c = mulc(c, 0.55);
      h = 0.3;
    }
    if (lace) {
      c = cloth(q, o.lace || [0.45, 0.12, 0.1], 0.3);
      h = 0.15;
      m = 0;
    }
    return { c, m, h, t: o.t ?? 0.02 };
  },
  // --- brigandine (stof met klinknagels)
  brigandine(q, o) {
    if (!torsoParts(q.part)) return null;
    if (q.y > BODY.shoulder - 0.02 || q.y < (o.bottom ?? BODY.waist - 0.1)) return null;
    if (q.y > BODY.neckBase - 0.04 && q.ax < 0.09) return null;
    let c = cloth(q, o.color, 0.5);
    let h = 0.5;
    let m = 0;
    const a = Math.atan2(q.x, q.z) * 0.16 / 0.028;
    const r = q.y / 0.03;
    const fx = a - Math.round(a);
    const fy = r - Math.round(r);
    if (fx * fx + fy * fy < 0.045) {
      c = steel(q, o.rivet || [0.85, 0.72, 0.4]);
      m = 0.9;
      h = 1;
    }
    return { c, m, h, t: o.t ?? 0.018 };
  },
  // --- plaatharnas op de romp (borstkuras)
  plate(q, o) {
    if (!torsoParts(q.part)) return null;
    if (q.y > (o.top ?? BODY.shoulder - 0.03) || q.y < (o.bottom ?? BODY.waist - 0.12)) return null;
    if (q.y > BODY.neckBase - 0.05 && q.ax < 0.1) return null;
    const base = o.color || [0.75, 0.77, 0.8];
    let c = steel(q, base, 0.6);
    let h = 0.6;
    // middenrib en randen
    if (q.z > 0.05 && q.ax < 0.006) h = 1;
    const fauld = q.y < BODY.waist;
    if (fauld) {
      const r = (q.y - 0.5) / 0.04;
      const fy = r - Math.floor(r);
      h = 0.4 + fy * 0.5;
      if (fy < 0.1) c = mulc(c, 0.6);
    }
    if (o.trim && (Math.abs(q.y - (o.top ?? BODY.shoulder - 0.03)) < 0.012 || (q.y > BODY.neckBase - 0.07 && q.ax < 0.115))) c = o.trim;
    return { c, m: 0.95, h, t: o.t ?? 0.028 };
  },
  // --- wapenrok/tabbaard met kruis of strepen
  tabard(q, o) {
    if (!torsoParts(q.part)) return null;
    if (q.y > BODY.shoulder - 0.01 || q.y < (o.bottom ?? BODY.crotch)) return null;
    if (q.y > BODY.neckBase - 0.03 && q.ax < 0.075) return null;
    // zijkanten open (onder de oksels)
    if (Math.abs(q.nx) > 0.82 && q.y < BODY.chest + 0.04) return null;
    let c = cloth(q, o.color, 0.8);
    if (o.cross) {
      const fb = q.z > 0 ? 1 : -1;
      void fb;
      if ((q.ax < 0.04 && q.y < BODY.shoulder - 0.02) || band(q.y, BODY.chest + 0.02, 0.035)) c = cloth(q, o.cross, 0.8);
    }
    if (o.stripes) {
      const s = Math.floor((q.y - 0.6) / 0.06);
      if (s % 2 === 0) c = cloth(q, o.stripes, 0.8);
    }
    if (o.quarter) {
      if ((q.x > 0) !== (q.y > BODY.chest - 0.05)) c = cloth(q, o.quarter, 0.8);
    }
    return { c, m: 0, h: 0.2, t: o.t ?? 0.034 };
  },
  // --- gordel/sjerp
  belt(q, o) {
    if (!torsoParts(q.part) && !(q.part === PART.THIGH && q.y > o.y - o.w)) return null;
    if (Math.abs(q.y - o.y) > o.w) return null;
    let c = o.sash ? cloth(q, o.color, 1.2) : leather(q, o.color);
    let m = 0;
    if (!o.sash && o.buckle && q.z > 0.08 && q.ax < 0.022) {
      c = steel(q, o.buckle);
      m = 0.9;
    }
    if (o.sash && Math.abs(Math.sin((q.y - o.y) * 260 + q.x * 30)) > 0.85) c = mulc(c, 0.8);
    return { c, m, h: o.sash ? 0.6 : 0.8, t: o.t ?? 0.03 };
  },
  // --- handschoenen / plaathandschoenen
  gloves(q, o) {
    if (q.part !== PART.HAND && !(q.part === PART.LARM && q.y < BODY.wrist + (o.cuff ?? 0.06))) return null;
    if (o.metal) return { c: steel(q, o.color), m: 0.92, h: 0.6, t: 0.006 };
    return { c: leather(q, o.color), m: 0, h: 0.4, t: 0.003 };
  },
  // --- onderarmplaten
  vambrace(q, o) {
    if (!(q.part === PART.LARM && q.y > BODY.wrist + 0.03 && q.y < BODY.elbow + 0.02)) return null;
    return { c: steel(q, o.color), m: 0.92, h: 0.7, t: 0.016 };
  },
  // --- bovenarmplaten + elleboogkop
  rerebrace(q, o) {
    if (!(armPart(q.part) && q.y > BODY.elbow - 0.04 && q.y < BODY.shoulder - 0.02)) return null;
    return { c: steel(q, o.color), m: 0.92, h: 0.7, t: 0.018 };
  },
  // --- beenplaten
  greaves(q, o) {
    if (!(q.part === PART.SHIN && q.y > BODY.ankle + 0.02)) return null;
    return { c: steel(q, o.color), m: 0.92, h: 0.7, t: 0.012 };
  },
  cuisses(q, o) {
    if (!(q.part === PART.THIGH && q.y < BODY.crotch && q.z > -0.02)) return null;
    if (q.part === PART.THIGH && q.y > BODY.crotch) return null;
    return { c: steel(q, o.color), m: 0.92, h: 0.7, t: 0.014 };
  },
  sabatons(q, o) {
    if (q.part !== PART.FOOT) return null;
    const r = q.z / 0.025;
    const fr = r - Math.floor(r);
    return { c: steel(q, o.color), m: 0.92, h: 0.4 + fr * 0.5, t: 0.008 };
  },
};

// ---------------------------------------------------------------------------
// Een outfit evalueren op een punt
// ---------------------------------------------------------------------------
const Q = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, ax: 0, part: 0 };
function evalOutfit(outfit, x, y, z, nx, ny, nz, part) {
  Q.x = x;
  Q.y = y;
  Q.z = z;
  Q.nx = nx;
  Q.ny = ny;
  Q.nz = nz;
  Q.ax = Math.abs(x);
  Q.part = part;
  for (const [fn, o] of outfit.stack) {
    const r = fn(Q, o);
    if (r) return r;
  }
  return LAYERS.skin(Q, outfit.face);
}

// Outfitspecificatie → interne stapel (buitenste laag eerst)
export function compileOutfit(spec) {
  const face = {
    tone: rgb(spec.skin || '#c8946f'),
    hair: rgb(spec.hair || '#2a1c12'),
    beard: rgb(spec.beard || spec.hair || '#2a1c12'),
    iris: rgb(spec.eyes || '#4a3020'),
    hairStyle: spec.hairStyle || 'short',
    beardStyle: spec.beardStyle || null,
    beardLong: !!spec.beardLong,
    mustache: spec.mustache || null,
    stubble: spec.stubble ?? !spec.beardStyle,
  };
  const stack = [];
  for (const l of spec.layers || []) {
    const fn = LAYERS[l[0]];
    if (!fn) throw new Error('Onbekende laag ' + l[0]);
    const o = { ...l[1] };
    for (const k of Object.keys(o)) if (typeof o[k] === 'string' && o[k][0] === '#') o[k] = rgb(o[k]);
    stack.push([fn, o]);
  }
  stack.push([LAYERS.face, face]);
  return { stack, face, spec };
}

// ---------------------------------------------------------------------------
// Textuur schilderen (kleur + metaal in alfa, en een normal map uit het reliëf)
// ---------------------------------------------------------------------------
const TEX_CACHE = new Map();
export function paintOutfit(key, outfit, N = 512, extras = null) {
  const ck = key + '@' + N;
  if (TEX_CACHE.has(ck)) return TEX_CACHE.get(ck);
  const g = gbuffer(N);
  const col = new Uint8Array(N * N * 4);
  const height = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const p = g.part[k];
    if (p === 255) {
      col[k * 4] = col[k * 4 + 1] = col[k * 4 + 2] = 200;
      continue;
    }
    const r = evalOutfit(outfit, g.pos[k * 3], g.pos[k * 3 + 1], g.pos[k * 3 + 2], g.nor[k * 3], g.nor[k * 3 + 1], g.nor[k * 3 + 2], p);
    col[k * 4] = Math.max(0, Math.min(255, r.c[0] * 255));
    col[k * 4 + 1] = Math.max(0, Math.min(255, r.c[1] * 255));
    col[k * 4 + 2] = Math.max(0, Math.min(255, r.c[2] * 255));
    col[k * 4 + 3] = Math.round((r.m || 0) * 255);
    height[k] = r.h || 0;
  }
  paintSwatches(col, height, N);
  if (extras) extras(col, height, N);
  // normal map uit reliëf
  const nrm = new Uint8Array(N * N * 4);
  const s = 2.2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    const hl = height[y * N + Math.max(0, x - 1)];
    const hr = height[y * N + Math.min(N - 1, x + 1)];
    const hd = height[Math.max(0, y - 1) * N + x];
    const hu = height[Math.min(N - 1, y + 1) * N + x];
    let nx = (hl - hr) * s;
    let ny = (hd - hu) * s;
    const l = Math.hypot(nx, ny, 1);
    nrm[k * 4] = ((nx / l) * 0.5 + 0.5) * 255;
    nrm[k * 4 + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    nrm[k * 4 + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    nrm[k * 4 + 3] = 255;
  }
  const map = new THREE.DataTexture(col, N, N, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.DataTexture(nrm, N, N, THREE.RGBAFormat);
  for (const t of [map, normalMap]) {
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
  }
  const res = { map, normalMap, col, N };
  TEX_CACHE.set(ck, res);
  return res;
}

// Kleine stalen (hout, metaal, leer, stof…) voor starre onderdelen; worden met de vertexkleur vermenigvuldigd.
function paintSwatches(col, height, N) {
  const fill = (rect, fn) => {
    const x0 = Math.floor(rect[0] * N);
    const y0 = Math.floor(rect[1] * N);
    const x1 = Math.ceil(rect[2] * N);
    const y1 = Math.ceil(rect[3] * N);
    // met een rand van een paar texels (tegen doorlekken bij mipmaps)
    const g = 1;
    for (let y = Math.max(0, y0 - g); y < Math.min(N, y1 + g); y++) for (let x = Math.max(0, x0 - g); x < Math.min(N, x1 + g); x++) {
      const u = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
      const v = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
      const [c, h] = fn(u, v);
      const k = y * N + x;
      const cv = Math.max(0, Math.min(255, Math.round(c * 255))); // klemmen: Uint8 zou overlopen
      col[k * 4] = cv;
      col[k * 4 + 1] = cv;
      col[k * 4 + 2] = cv;
      col[k * 4 + 3] = 0;
      height[k] = h;
    }
  };
  fill(ATLAS.sw.cloth, (u, v) => [0.97 + (vnoise(u * 40, v * 40, 1) - 0.5) * 0.08, 0.3]);
  fill(ATLAS.sw.metal, (u, v) => [0.95 + (vnoise(u * 6, v * 80, 2) - 0.5) * 0.1, 0.5]);
  fill(ATLAS.sw.wood, (u, v) => {
    const g = Math.sin(u * 60 + vnoise(u * 4, v * 20, 3) * 8) * 0.5 + 0.5;
    return [0.86 + g * 0.14, g * 0.6];
  });
  fill(ATLAS.sw.leather, (u, v) => [0.88 + vnoise(u * 50, v * 50, 4) * 0.12, 0.4]);
  fill(ATLAS.sw.fur, (u, v) => [0.9 + vnoise(u * 90, v * 12, 5) * 0.1, 0.8]);
  fill(ATLAS.sw.dark, () => [0.95, 0.2]);
}

// ---------------------------------------------------------------------------
// Lichaamsgeometrie per type: rustmesh + verdikking per kledinglaag
// ---------------------------------------------------------------------------
// Geeft attributen terug voor de crowd-renderer.
export function bodyGeometry(outfit, lod) {
  const L = humanBase()[lod];
  const n = L.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const skin = new Uint8Array(n * 4);
  const wts = new Uint8Array(n * 4);
  const ao = new Float32Array(n);
  const tint = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = L.pos[i * 3];
    const y = L.pos[i * 3 + 1];
    const z = L.pos[i * 3 + 2];
    const nx = L.nor[i * 4] / 127;
    const ny = L.nor[i * 4 + 1] / 127;
    const nz = L.nor[i * 4 + 2] / 127;
    const r = evalOutfit(outfit, x, y, z, nx, ny, nz, L.part[i]);
    const t = L.part[i] === PART.EYE ? 0 : r.t || 0;
    pos[i * 3] = x + nx * t;
    pos[i * 3 + 1] = y + ny * t;
    pos[i * 3 + 2] = z + nz * t;
    nor[i * 3] = nx;
    nor[i * 3 + 1] = ny;
    nor[i * 3 + 2] = nz;
    uv[i * 2] = L.uv[i * 2] / 65535;
    uv[i * 2 + 1] = L.uv[i * 2 + 1] / 65535;
    for (let k = 0; k < 4; k++) {
      skin[i * 4 + k] = L.si[i * 4 + k];
      wts[i * 4 + k] = L.sw[i * 4 + k];
    }
    // AO: huid en dunne stof houden de gebakken holtes; over dik harnas minder
    const a = L.misc[i * 4] / 255;
    ao[i] = 1 - (1 - a) * (t > 0.015 ? 0.4 : 1);
    tint[i] = r.skin ? 1 : 0;
  }
  return { pos, nor, uv, skin, wts, ao, tint, idx: L.idx, count: n };
}
