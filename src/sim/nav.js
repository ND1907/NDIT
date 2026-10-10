// Navigatie met flow fields: per doel (donjon, veroveringspunt) en per alliantie één
// afstandsveld. Elke eenheid kijkt alleen naar haar cel en volgt de buur met de
// kleinste afstand. Zo kunnen honderden eenheden tegelijk navigeren.
//
// Vijandelijke poorten en muren zijn niet "verboden" maar duur: het veld leidt naar
// de poort (die dan aangevallen wordt) en pas door een muur als er een bres is.
import { pointInside } from './geom.js';

const COST_ENEMY_GATE = 45;
const COST_ENEMY_WALL = 260;
const COST_MOAT = 3.5;
const INF = 1e9;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export class NavGrid {
  constructor(map, cell = 2) {
    this.map = map;
    this.cell = cell;
    this.half = map.half;
    this.n = Math.ceil((map.half * 2) / cell);
    const N = this.n * this.n;
    this.blocked = new Uint8Array(N); // 1 = onbegaanbaar (gebouw, boom, donjon)
    this.moat = new Uint8Array(N);
    this.structAt = new Int32Array(N).fill(-1); // index in map.structures
    this.outside = new Uint8Array(N); // buiten de speelcirkel
    this.fields = new Map();
    this.version = 1;
    this.dirty = new Set();
    this._build();
  }

  idx(x, z) {
    let cx = Math.floor((x + this.half) / this.cell);
    let cz = Math.floor((z + this.half) / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.n) cx = this.n - 1;
    if (cz < 0) cz = 0;
    else if (cz >= this.n) cz = this.n - 1;
    return cz * this.n + cx;
  }

  center(i) {
    const cx = i % this.n;
    const cz = (i / this.n) | 0;
    return [(cx + 0.5) * this.cell - this.half, (cz + 0.5) * this.cell - this.half];
  }

  _build() {
    const { map } = this;
    const pad = 0.55;
    const structIndex = new Map(map.structures.map((s, i) => [s, i]));
    for (let i = 0; i < this.blocked.length; i++) {
      const [x, z] = this.center(i);
      if (Math.hypot(x, z) > map.radius) {
        this.outside[i] = 1;
        this.blocked[i] = 1;
      }
    }
    for (const o of map.obstacles) {
      if (o.kind === 'lintel') continue;
      if (o.y1 < 0.9 && o.kind !== 'lowwall') continue;
      const ext = o.radius + pad + this.cell;
      const x0 = this.idx(o.cx - ext, o.cz - ext);
      const x1 = this.idx(o.cx + ext, o.cz + ext);
      const cx0 = x0 % this.n;
      const cz0 = (x0 / this.n) | 0;
      const cx1 = x1 % this.n;
      const cz1 = (x1 / this.n) | 0;
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const i = cz * this.n + cx;
          const [x, z] = this.center(i);
          if (!pointInside(o, x, z, pad)) continue;
          if (o.struct) this.structAt[i] = structIndex.get(o.struct);
          else this.blocked[i] = 1;
        }
      }
    }
    for (const m of map.moats) {
      const ext = m.radius + this.cell;
      for (let z = m.cz - ext; z <= m.cz + ext; z += this.cell) {
        for (let x = m.cx - ext; x <= m.cx + ext; x += this.cell) {
          const i = this.idx(x, z);
          const [px, pz] = this.center(i);
          if (pointInside(m, px, pz, 0)) this.moat[i] = 1;
        }
      }
    }
  }

  // Kosten van een cel voor een alliantie; INF = onbegaanbaar.
  cost(i, alliance, allianceOf, docks) {
    if (this.blocked[i]) return INF;
    const si = this.structAt[i];
    let c = this.moat[i] ? COST_MOAT : 1;
    if (si >= 0) {
      const st = this.map.structures[si];
      if (!st.destroyed) {
        const friendly = allianceOf(st.team) === alliance;
        if (st.gate) c = friendly ? 1 : COST_ENEMY_GATE;
        else if (friendly) return INF;
        else {
          c = COST_ENEMY_WALL;
          if (st.dock && st.dock.alliance === alliance) c = 2; // belegeringstoren aangelegd
        }
      }
    }
    return c;
  }

  // wide = voor breed belegeringstuig: vaste obstakels (bomen, huizen) een cel breder maken
  costsFor(alliance, allianceOf, wide = false) {
    this._costs = this._costs || new Map();
    const ck = alliance + (wide ? '|w' : '');
    const c = this._costs.get(ck);
    if (c && c.version === this.version) return c.arr;
    const N = this.n * this.n;
    const arr = c && c.arr.length === N ? c.arr : new Float32Array(N);
    if (!wide) for (let i = 0; i < N; i++) arr[i] = this.cost(i, alliance, allianceOf);
    else {
      arr.set(this.costsFor(alliance, allianceOf));
      const n = this.n;
      for (let i = 0; i < N; i++) {
        if (!this.blocked[i] || this.outside[i]) continue;
        const cx = i % n;
        const cz = (i / n) | 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const z = cz + dz;
          if (x >= 0 && z >= 0 && x < n && z < n) arr[z * n + x] = INF;
        }
      }
    }
    this._costs.set(ck, { arr, version: this.version });
    return arr;
  }

  // Afstandsveld naar doelcellen (lijst van [x, z, r]), in één keer.
  compute(key, goals, alliance, allianceOf, wide = false) {
    const job = this.startJob(key, goals, alliance, allianceOf, wide);
    this.runJob(job, Infinity);
    return job.field;
  }

  // Tijdgesneden variant: elke frame een beperkt aantal cellen verwerken.
  startJob(key, goals, alliance, allianceOf, wide = false) {
    const N = this.n * this.n;
    const dist = new Float32Array(N).fill(INF);
    const costs = this.costsFor(alliance, allianceOf, wide);
    const heap = new BinaryHeap(N);
    for (const [gx, gz, gr] of goals) {
      const r = gr + this.cell;
      for (let z = gz - r; z <= gz + r; z += this.cell) {
        for (let x = gx - r; x <= gx + r; x += this.cell) {
          if (Math.hypot(x - gx, z - gz) > gr) continue;
          const i = this.idx(x, z);
          if (costs[i] >= INF || dist[i] === 0) continue;
          dist[i] = 0;
          heap.push(i, 0);
        }
      }
    }
    return { key, dist, costs, heap, alliance, version: this.version, done: false, field: null };
  }

  // Verwerkt maximaal `budget` cellen; geeft true als het veld klaar is.
  runJob(job, budget) {
    const { dist, costs, heap } = job;
    const n = this.n;
    let pops = 0;
    while (heap.size && pops++ < budget) {
      const [i, d] = heap.pop();
      if (d > dist[i]) continue;
      const cx = i % n;
      const cz = (i / n) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const nz = cz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const j = nz * n + nx;
        const cj = costs[j];
        if (cj >= INF) continue;
        // geen hoeken afsnijden langs blokkades
        if (k >= 4 && (costs[cz * n + nx] >= INF || costs[nz * n + cx] >= INF)) continue;
        const nd = d + DL[k] * (cj + costs[i]) * 0.5;
        if (nd < dist[j]) {
          dist[j] = nd;
          heap.push(j, nd);
        }
      }
    }
    if (heap.size) return false;
    job.done = true;
    job.field = { key: job.key, dist, version: job.version, alliance: job.alliance };
    this.fields.set(job.key, job.field);
    return true;
  }

  // Richting (eenheidsvector) langs het veld vanaf (x, z). Geeft null als er geen pad is.
  dirAt(field, x, z, out) {
    if (!field) return false;
    const n = this.n;
    const i = this.idx(x, z);
    const cx = i % n;
    const cz = (i / n) | 0;
    const d0 = field.dist[i];
    let best = d0;
    let bx = 0;
    let bz = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const d = field.dist[nz * n + nx];
        if (dx && dz) {
          if (field.dist[cz * n + nx] >= INF || field.dist[nz * n + cx] >= INF) continue;
        }
        const w = d + (dx && dz ? 0.01 : 0);
        if (w < best) {
          best = w;
          bx = dx;
          bz = dz;
        }
      }
    }
    if (best >= INF || (bx === 0 && bz === 0)) {
      out.x = 0;
      out.z = 0;
      out.d = d0;
      return d0 < INF;
    }
    // naar het midden van de beste buurcel sturen (vloeiender dan rasterrichtingen)
    const [tx, tz] = this.center((cz + bz) * n + cx + bx);
    const vx = tx - x;
    const vz = tz - z;
    const l = Math.hypot(vx, vz) || 1;
    out.x = vx / l;
    out.z = vz / l;
    out.d = d0;
    return true;
  }

  // Is de rechte lijn tussen twee punten begaanbaar (geen muren of gebouwen)?
  clearLine(x0, z0, x1, z1, alliance = null) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(d / (this.cell * 0.7));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const i = this.idx(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (this.blocked[i]) return false;
      const si = this.structAt[i];
      if (si >= 0) {
        const st = this.map.structures[si];
        if (!st.destroyed && !(st.gate && (alliance === null || st.alliance === alliance))) return false;
      }
    }
    return true;
  }

  distAt(field, x, z) {
    if (!field) return INF;
    return field.dist[this.idx(x, z)];
  }

  invalidate() {
    this.version++;
  }
}

export const NAV_INF = INF;

class BinaryHeap {
  constructor(cap) {
    this.ids = new Int32Array(cap * 2 + 16);
    this.keys = new Float32Array(cap * 2 + 16);
    this.size = 0;
  }

  push(id, key) {
    if (this.size >= this.ids.length) {
      const ni = new Int32Array(this.ids.length * 2);
      const nk = new Float32Array(this.ids.length * 2);
      ni.set(this.ids);
      nk.set(this.keys);
      this.ids = ni;
      this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p];
      this.keys[i] = this.keys[p];
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }

  pop() {
    const id = this.ids[0];
    const key = this.keys[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c];
      this.keys[i] = this.keys[c];
      i = c;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return [id, key];
  }
}
