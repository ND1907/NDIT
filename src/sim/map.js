// Kaartgenerator: plaatst 2–6 forten in een ring rond een open slagveld,
// met veroveringspunten, wegen en decor. Puur data (geen rendering).
import { makeObstacle } from './geom.js';
import { makeRng } from './math.js';
import { FACTIONS } from './data.js';

export const FORT = {
  W: 22, // halve binnenmaat
  T: 2.6, // muurdikte
  H: 9, // muurhoogte
  gateHalf: 3,
  towerHalf: 3,
  keepHalf: 5,
  keepH: 18,
  captureR: 12,
};
export const BYZ = { outerGap: 12, outerH: 7, outerT: 2.4, moatIn: 3, moatOut: 8, innerH: 11 };

const RING = { 2: 105, 3: 118, 4: 128, 5: 142, 6: 156 };

// Basis-HP van bouwwerken (geschaald met de potjeslengte)
export const STRUCT_HP = { wall: 9000, tower: 14000, gate: 7000, outerWall: 6500, outerGate: 5500, outerTower: 9000 };

export function generateMap(teams, { seed = 1453, structHp = 1 } = {}) {
  const rng = makeRng(seed);
  const N = teams.length;
  const R = RING[N] || 156;
  const radius = R + 62;
  const half = radius + 12;
  const obstacles = [];
  const structures = [];
  const forts = [];
  const moats = [];
  const decor = [];
  const roads = [];
  let sid = 0;

  const addOb = (o) => {
    const ob = makeObstacle(o);
    obstacles.push(ob);
    return ob;
  };

  teams.forEach((team, i) => {
    const ang = N === 2 ? (i === 0 ? -Math.PI / 2 : Math.PI / 2) : -Math.PI / 2 + (i * Math.PI * 2) / N;
    const cx = Math.cos(ang) * R;
    const cz = Math.sin(ang) * R;
    // lokale Z-as wijst naar het midden van de kaart
    const rot = Math.atan2(-cx, -cz);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const W = (u, v) => [cx + cos * u + sin * v, cz - sin * u + cos * v];
    const style = FACTIONS[team].fortStyle;
    const byz = style === 'byzantine';
    const F = FORT;
    const H = byz ? BYZ.innerH : F.H;

    const fort = {
      team, style, cx, cz, rot, W: F.W, H, byz,
      structures: [], posts: [], spawn: [], buildings: [],
      fallen: false, capture: 0, captureBy: null, breached: false,
    };
    fort.toWorld = W;

    const mkStruct = (kind, u, v, hu, hv, h, hp, material, extra = {}) => {
      const [x, z] = W(u, v);
      const ob = addOb({ cx: x, cz: z, hx: hu, hz: hv, rot, y0: 0, y1: h, kind, team });
      const st = { id: sid++, team, kind, hp: hp * structHp, maxHp: hp * structHp, material, ob, fort, destroyed: false, x, z, h, u, v, hu, hv, rot, ...extra };
      ob.struct = st;
      structures.push(st);
      fort.structures.push(st);
      return st;
    };

    // ---- ring van muren met torens ----
    const ring = (Wr, h, t, tag, gateHp, wallHp, towerHp, postsOnSides) => {
      const g = F.gateHalf;
      const th = F.towerHalf;
      const segs = [];
      // voorzijde (met poort), achterzijde, links, rechts
      const sides = [
        { axis: 'u', fixed: Wr, from: -Wr, to: Wr, gap: true, front: true },
        { axis: 'u', fixed: -Wr, from: -Wr, to: Wr },
        { axis: 'v', fixed: -Wr, from: -Wr, to: Wr },
        { axis: 'v', fixed: Wr, from: -Wr, to: Wr },
      ];
      for (const s of sides) {
        const pieces = [];
        if (s.gap) {
          pieces.push([s.from + th, -g - th * 2], [g + th * 2, s.to - th]);
        } else pieces.push([s.from + th, s.to - th]);
        for (const [a, b] of pieces) {
          const len = b - a;
          const n = Math.max(1, Math.round(len / 11));
          for (let k = 0; k < n; k++) {
            const pa = a + (len * k) / n;
            const pb = a + (len * (k + 1)) / n;
            const mid = (pa + pb) / 2;
            const hl = (pb - pa) / 2;
            const st = s.axis === 'u'
              ? mkStruct(tag, mid, s.fixed, hl, t / 2, h, wallHp, 'stone', { side: s.front ? 'front' : s.fixed > 0 ? 'front' : 'back', normalU: 0, normalV: Math.sign(s.fixed) })
              : mkStruct(tag, s.fixed, mid, t / 2, hl, h, wallHp, 'stone', { side: 'side', normalU: Math.sign(s.fixed), normalV: 0 });
            segs.push(st);
            // posten bovenop de muur (verdedigers)
            const wantPosts = s.front || (postsOnSides && (s.axis === 'v'));
            if (wantPosts) {
              const cnt = Math.max(1, Math.floor((pb - pa) / 5));
              for (let q = 0; q < cnt; q++) {
                const along = pa + ((q + 0.5) * (pb - pa)) / cnt;
                const pu = s.axis === 'u' ? along : s.fixed;
                const pv = s.axis === 'u' ? s.fixed : along;
                const inU = s.axis === 'u' ? 0 : -Math.sign(s.fixed);
                const inV = s.axis === 'u' ? -Math.sign(s.fixed) : 0;
                const [px, pz] = W(pu + inU * 0.1, pv + inV * 0.1);
                const [fx, fz] = W(pu + inU * (t / 2 + 1.8), pv + inV * (t / 2 + 1.8));
                const [ox, oz] = W(pu - inU * 6, pv - inV * 6);
                fort.posts.push({ x: px, z: pz, y: h, footX: fx, footZ: fz, faceYaw: Math.atan2(ox - px, oz - pz), struct: st, occupant: null, front: !!s.front });
              }
            }
          }
        }
      }
      // torens op de hoeken
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const tw = mkStruct(tag === 'outerWall' ? 'outerTower' : 'tower', su * Wr, sv * Wr, th, th, h + 4, towerHp, 'stone', { round: style !== 'serbia' && style !== 'venice', corner: true });
        if (sv > 0) {
          const [px, pz] = W(su * Wr, sv * Wr);
          const [fx, fz] = W(su * (Wr - th - 1.8), sv * (Wr - th - 1.8));
          const [ox, oz] = W(su * (Wr + 8), sv * (Wr + 8));
          fort.posts.push({ x: px, z: pz, y: h + 4, footX: fx, footZ: fz, faceYaw: Math.atan2(ox - px, oz - pz), struct: tw, occupant: null, front: true });
        }
      }
      // poorttorens + poort
      for (const su of [-1, 1]) {
        const gt = mkStruct(tag === 'outerWall' ? 'outerTower' : 'tower', su * (g + th), Wr, th, th + 0.4, h + 3, towerHp, 'stone', { gatehouse: true });
        const [px, pz] = W(su * (g + th), Wr);
        const [fx, fz] = W(su * (g + th), Wr - th - 2.2);
        const [ox, oz] = W(su * (g + th), Wr + 8);
        fort.posts.push({ x: px, z: pz, y: h + 3, footX: fx, footZ: fz, faceYaw: Math.atan2(ox - px, oz - pz), struct: gt, occupant: null, front: true });
      }
      const gate = mkStruct(tag === 'outerWall' ? 'outerGate' : 'gate', 0, Wr, g, t / 2 + 0.2, 6, gateHp, 'wood', { gate: true });
      // bovendorpel boven de poort (onverwoestbaar, je loopt eronder door)
      const [lx, lz] = W(0, Wr);
      addOb({ cx: lx, cz: lz, hx: g, hz: t / 2, rot, y0: 6, y1: h + 0.5, kind: 'lintel', team });
      return { segs, gate };
    };

    const inner = ring(F.W, H, F.T, 'wall', STRUCT_HP.gate, STRUCT_HP.wall, STRUCT_HP.tower, true);
    fort.gate = inner.gate;
    fort.gates = [inner.gate];

    if (byz) {
      // Theodosiaans: lagere voormuur met eigen poort en een gracht ervoor
      const Wo = F.W + BYZ.outerGap;
      const outer = ring(Wo, BYZ.outerH, BYZ.outerT, 'outerWall', STRUCT_HP.outerGate, STRUCT_HP.outerWall, STRUCT_HP.outerTower, false);
      fort.outerGate = outer.gate;
      fort.gates.unshift(outer.gate);
      const m0 = Wo + BYZ.moatIn;
      const m1 = Wo + BYZ.moatOut;
      const mh = (m1 - m0) / 2;
      const mid = (m0 + m1) / 2;
      const moat = (u, v, hu, hv) => {
        const [x, z] = W(u, v);
        moats.push(makeObstacle({ cx: x, cz: z, hx: hu, hz: hv, rot, y0: -2, y1: 0, kind: 'moat', team }));
      };
      // voorzijde met dam bij de poort
      const cw = 4.5;
      moat(-(m1 + cw) / 2, mid, (m1 - cw) / 2, mh);
      moat((m1 + cw) / 2, mid, (m1 - cw) / 2, mh);
      moat(0, -mid, m1, mh);
      moat(-mid, 0, mh, m0);
      moat(mid, 0, mh, m0);
      fort.extent = m1 + 2;
      fort.moatR = [m0, m1];
    } else fort.extent = F.W + F.towerHalf + 2;

    // ---- donjon + gebouwen binnen ----
    const kv = -F.W * 0.45;
    const [kx, kz] = W(0, kv);
    const keepOb = addOb({ cx: kx, cz: kz, hx: F.keepHalf, hz: F.keepHalf, rot, y0: 0, y1: F.keepH, kind: 'keep', team });
    fort.keep = { x: kx, z: kz, r: F.captureR, ob: keepOb };
    for (const su of [-1, 1]) {
      const [bx, bz] = W(su * (F.W - 7.5), -F.W + 7);
      const b = addOb({ cx: bx, cz: bz, hx: 3.5, hz: 4.5, rot, y0: 0, y1: 5, kind: 'building', team });
      fort.buildings.push({ x: bx, z: bz, hx: 3.5, hz: 4.5, rot, h: 5, kind: su < 0 ? 'barracks' : 'stable' });
      b.building = true;
    }
    for (let k = 0; k < 12; k++) {
      const [sx, sz] = W(-12 + (k % 6) * 4.8, 2 + Math.floor(k / 6) * 5);
      fort.spawn.push({ x: sx, z: sz });
    }
    const outerFront = byz ? F.W + BYZ.outerGap + BYZ.moatOut + 6 : F.W + 12;
    const [rx, rz] = W(0, outerFront);
    fort.rally = { x: rx, z: rz };
    const [ix, iz] = W(0, F.W - 6);
    fort.inside = { x: ix, z: iz };
    // plek voor eigen belegeringsgeschut (net buiten de poort)
    const [sx2, sz2] = W(10, outerFront - 2);
    fort.siegeYard = { x: sx2, z: sz2 };
    forts.push(fort);
    roads.push({ x0: rx, z0: rz, x1: 0, z1: 0, w: 6 });
  });

  // ---- veroveringspunten ----
  const capturePoints = [];
  const cpNames = ['Dorpsbron', 'Kapel van Sint-Romanos', 'Molenheuvel', 'Ruïne van Blachernae', 'Hoeve aan de Lycus', 'Oude Wachttoren'];
  capturePoints.push({ id: 0, name: 'Dorp bij de Lycus', x: 0, z: 0, r: 10, owner: null, progress: 0, by: null });
  if (N === 2) {
    capturePoints.push({ id: 1, name: cpNames[0], x: -58, z: 0, r: 9, owner: null, progress: 0, by: null });
    capturePoints.push({ id: 2, name: cpNames[1], x: 58, z: 0, r: 9, owner: null, progress: 0, by: null });
  } else {
    for (let i = 0; i < N; i++) {
      const a = forts[i];
      const b = forts[(i + 1) % N];
      const mx = (a.cx + b.cx) / 2;
      const mz = (a.cz + b.cz) / 2;
      const d = Math.hypot(mx, mz) || 1;
      const rr = R * 0.55;
      capturePoints.push({ id: capturePoints.length, name: cpNames[i % cpNames.length], x: (mx / d) * rr, z: (mz / d) * rr, r: 9, owner: null, progress: 0, by: null });
    }
  }

  // ---- decor: huisjes bij veroveringspunten, bomen, rotsen, akkers ----
  const blocked = (x, z, pad) => {
    if (Math.hypot(x, z) > radius - 6) return true;
    for (const f of forts) if (Math.hypot(x - f.cx, z - f.cz) < f.extent * 1.45 + pad) return true;
    for (const c of capturePoints) if (Math.hypot(x - c.x, z - c.z) < c.r + 3 + pad) return true;
    for (const r of roads) {
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / L2));
      if (Math.hypot(x - (r.x0 + dx * t), z - (r.z0 + dz * t)) < r.w + 2 + pad) return true;
    }
    for (const o of obstacles) if (Math.hypot(x - o.cx, z - o.cz) < o.radius + 2 + pad) return true;
    return false;
  };

  for (const c of capturePoints) {
    const n = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 0.6;
      const d = c.r + 5 + rng() * 4;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      const hx = 2.6 + rng() * 1.4;
      const hz = 3.2 + rng() * 1.6;
      const rr = a + Math.PI / 2;
      addOb({ cx: x, cz: z, hx, hz, rot: rr, y0: 0, y1: 4, kind: 'house' });
      decor.push({ kind: 'house', x, z, hx, hz, rot: rr, h: 4, v: rng() });
    }
    // lage stenen muurtjes als dekking
    for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2;
      const d = c.r + 13 + rng() * 6;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      if (blocked(x, z, 0)) continue;
      const len = 3 + rng() * 3;
      addOb({ cx: x, cz: z, hx: len, hz: 0.5, rot: a + Math.PI / 2, y0: 0, y1: 1.2, kind: 'lowwall', blocksLos: false });
      decor.push({ kind: 'lowwall', x, z, hx: len, hz: 0.5, rot: a + Math.PI / 2, h: 1.2 });
    }
  }

  // bossen in groepjes
  for (let g = 0; g < 26 + N * 4; g++) {
    const a = rng() * Math.PI * 2;
    const d = 30 + rng() * (radius - 40);
    const gx = Math.cos(a) * d;
    const gz = Math.sin(a) * d;
    const n = 3 + Math.floor(rng() * 7);
    for (let k = 0; k < n; k++) {
      const x = gx + (rng() - 0.5) * 16;
      const z = gz + (rng() - 0.5) * 16;
      if (blocked(x, z, 1)) continue;
      const kind = rng() < 0.45 ? 'cypress' : rng() < 0.6 ? 'olive' : 'oak';
      const s = 0.8 + rng() * 0.5;
      addOb({ cx: x, cz: z, hx: 0.35 * s, hz: 0.35 * s, y0: 0, y1: 7, kind: 'tree', blocksLos: false });
      decor.push({ kind, x, z, s, rot: rng() * 6.28 });
    }
  }
  for (let k = 0; k < 40; k++) {
    const x = (rng() * 2 - 1) * radius;
    const z = (rng() * 2 - 1) * radius;
    if (blocked(x, z, 2)) continue;
    const s = 0.6 + rng() * 1.2;
    if (s > 1.2) addOb({ cx: x, cz: z, hx: s * 0.8, hz: s * 0.7, rot: rng() * 3, y0: 0, y1: s, kind: 'rock', blocksLos: false });
    decor.push({ kind: 'rock', x, z, s, rot: rng() * 6.28 });
  }
  for (let k = 0; k < 18; k++) {
    const x = (rng() * 2 - 1) * radius * 0.8;
    const z = (rng() * 2 - 1) * radius * 0.8;
    if (blocked(x, z, 6)) continue;
    decor.push({ kind: 'field', x, z, hx: 8 + rng() * 10, hz: 6 + rng() * 8, rot: rng() * 3, v: rng() });
  }
  for (let k = 0; k < 60; k++) {
    const x = (rng() * 2 - 1) * radius;
    const z = (rng() * 2 - 1) * radius;
    if (blocked(x, z, 0)) continue;
    decor.push({ kind: 'bush', x, z, s: 0.6 + rng() * 0.8, rot: rng() * 6.28 });
  }

  return { teams, N, R, radius, half, obstacles, structures, forts, moats, capturePoints, decor, roads, seed };
}
