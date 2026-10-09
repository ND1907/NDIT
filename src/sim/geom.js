// Obstakels als gedraaide dozen (OBB) + ruimtelijke rasters voor snelle zoekopdrachten.
//
// Een obstakel: { cx, cz, hx, hz, rot, y0, y1, active, ... }
// Lokale assen in de wereld: X = (cos rot, -sin rot), Z = (sin rot, cos rot)
// (gelijk aan three.js `rotation.y = rot`).

export function makeObstacle(o) {
  const ob = { rot: 0, y0: 0, active: true, blocksLos: true, ...o };
  ob.cos = Math.cos(ob.rot);
  ob.sin = Math.sin(ob.rot);
  ob.radius = Math.hypot(ob.hx, ob.hz);
  return ob;
}

export function toLocal(o, x, z) {
  const dx = x - o.cx;
  const dz = z - o.cz;
  return [o.cos * dx - o.sin * dz, o.sin * dx + o.cos * dz];
}

export function toWorld(o, lx, lz) {
  return [o.cx + o.cos * lx + o.sin * lz, o.cz - o.sin * lx + o.cos * lz];
}

export function pointInside(o, x, z, margin = 0) {
  const [lx, lz] = toLocal(o, x, z);
  return Math.abs(lx) <= o.hx + margin && Math.abs(lz) <= o.hz + margin;
}

// Duwt een cirkel uit het obstakel. Geeft [nx, nz] (nieuwe positie) of null.
export function pushCircle(o, x, z, r) {
  const [lx, lz] = toLocal(o, x, z);
  const qx = lx < -o.hx ? -o.hx : lx > o.hx ? o.hx : lx;
  const qz = lz < -o.hz ? -o.hz : lz > o.hz ? o.hz : lz;
  let dx = lx - qx;
  let dz = lz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  let nlx;
  let nlz;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nlx = qx + (dx / d) * r;
    nlz = qz + (dz / d) * r;
  } else {
    // middelpunt binnen de doos: naar de dichtstbijzijnde zijde
    const px = o.hx - Math.abs(lx);
    const pz = o.hz - Math.abs(lz);
    if (px < pz) {
      nlx = Math.sign(lx || 1) * (o.hx + r);
      nlz = lz;
    } else {
      nlx = lx;
      nlz = Math.sign(lz || 1) * (o.hz + r);
    }
  }
  return toWorld(o, nlx, nlz);
}

// Straal (origin + dir * t) tegen het obstakel. Geeft t of Infinity.
export function rayObstacle(o, ox, oy, oz, dx, dy, dz, maxT) {
  const rx = ox - o.cx;
  const rz = oz - o.cz;
  const lox = o.cos * rx - o.sin * rz;
  const loz = o.sin * rx + o.cos * rz;
  const ldx = o.cos * dx - o.sin * dz;
  const ldz = o.sin * dx + o.cos * dz;
  let tmin = 0;
  let tmax = maxT;
  // x
  if (Math.abs(ldx) < 1e-9) {
    if (lox < -o.hx || lox > o.hx) return Infinity;
  } else {
    let t1 = (-o.hx - lox) / ldx;
    let t2 = (o.hx - lox) / ldx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // y
  if (Math.abs(dy) < 1e-9) {
    if (oy < o.y0 || oy > o.y1) return Infinity;
  } else {
    let t1 = (o.y0 - oy) / dy;
    let t2 = (o.y1 - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // z
  if (Math.abs(ldz) < 1e-9) {
    if (loz < -o.hz || loz > o.hz) return Infinity;
  } else {
    let t1 = (-o.hz - loz) / ldz;
    let t2 = (o.hz - loz) / ldz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// ---------------------------------------------------------------------------
// Statisch raster voor obstakels (cellen van `cell` meter)
// ---------------------------------------------------------------------------
export class ObstacleGrid {
  constructor(half, cell = 8) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((half * 2) / cell);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.stamp = 0;
    this.list = [];
  }

  idx(cx, cz) {
    return cz * this.n + cx;
  }

  cellOf(v) {
    const c = Math.floor((v + this.half) / this.cell);
    return c < 0 ? 0 : c >= this.n ? this.n - 1 : c;
  }

  insert(o) {
    o._stamp = 0;
    this.list.push(o);
    // alle cellen die de omhullende AABB raakt
    const ex = Math.abs(o.cos) * o.hx + Math.abs(o.sin) * o.hz;
    const ez = Math.abs(o.sin) * o.hx + Math.abs(o.cos) * o.hz;
    const x0 = this.cellOf(o.cx - ex);
    const x1 = this.cellOf(o.cx + ex);
    const z0 = this.cellOf(o.cz - ez);
    const z1 = this.cellOf(o.cz + ez);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[this.idx(x, z)].push(o);
  }

  // Roept fn(o) aan voor elk actief obstakel nabij (x, z) binnen straal r.
  near(x, z, r, fn) {
    const s = ++this.stamp;
    const x0 = this.cellOf(x - r);
    const x1 = this.cellOf(x + r);
    const z0 = this.cellOf(z - r);
    const z1 = this.cellOf(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[this.idx(cx, cz)];
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          if (o._stamp === s || !o.active) continue;
          o._stamp = s;
          fn(o);
        }
      }
    }
  }

  // Eerste treffer langs een straal. filter(o) kan obstakels overslaan.
  raycast(ox, oy, oz, dx, dy, dz, maxT, filter) {
    const s = ++this.stamp;
    let best = maxT;
    let hit = null;
    // cellen doorlopen langs de straal (2D DDA)
    const cell = this.cell;
    let cx = this.cellOf(ox);
    let cz = this.cellOf(oz);
    const len2 = Math.hypot(dx, dz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const nextX = (cx + (dx > 0 ? 1 : 0)) * cell - this.half;
    const nextZ = (cz + (dz > 0 ? 1 : 0)) * cell - this.half;
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : (nextX - ox) / dx;
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : (nextZ - oz) / dz;
    const tDX = Math.abs(dx) < 1e-9 ? Infinity : cell / Math.abs(dx);
    const tDZ = Math.abs(dz) < 1e-9 ? Infinity : cell / Math.abs(dz);
    let tCell = 0;
    if (cx < 0 || cz < 0) return null;
    for (let guard = 0; guard < 400; guard++) {
      const arr = this.cells[this.idx(cx, cz)];
      for (let i = 0; i < arr.length; i++) {
        const o = arr[i];
        if (o._stamp === s || !o.active) continue;
        o._stamp = s;
        if (filter && !filter(o)) continue;
        const t = rayObstacle(o, ox, oy, oz, dx, dy, dz, best);
        if (t < best) {
          best = t;
          hit = o;
        }
      }
      if (best <= Math.min(tMaxX, tMaxZ) || len2 < 1e-9) break;
      if (tMaxX < tMaxZ) {
        tCell = tMaxX;
        tMaxX += tDX;
        cx += stepX;
      } else {
        tCell = tMaxZ;
        tMaxZ += tDZ;
        cz += stepZ;
      }
      if (tCell > best || cx < 0 || cz < 0 || cx >= this.n || cz >= this.n) break;
    }
    return hit ? { t: best, o: hit } : null;
  }
}

// ---------------------------------------------------------------------------
// Dynamisch raster voor eenheden (elk frame opnieuw gevuld)
// ---------------------------------------------------------------------------
export class UnitGrid {
  constructor(half, cell = 4, capacity = 4096) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((half * 2) / cell);
    this.head = new Int32Array(this.n * this.n);
    this.next = new Int32Array(capacity);
    this.items = new Array(capacity);
  }

  rebuild(units) {
    this.head.fill(-1);
    if (units.length > this.next.length) {
      this.next = new Int32Array(units.length * 2);
      this.items = new Array(units.length * 2);
    }
    let k = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive) continue;
      const c = this.cellIdx(u.x, u.z);
      this.items[k] = u;
      this.next[k] = this.head[c];
      this.head[c] = k;
      k++;
    }
  }

  cellIdx(x, z) {
    let cx = Math.floor((x + this.half) / this.cell);
    let cz = Math.floor((z + this.half) / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.n) cx = this.n - 1;
    if (cz < 0) cz = 0;
    else if (cz >= this.n) cz = this.n - 1;
    return cz * this.n + cx;
  }

  // fn(u) voor elke levende eenheid binnen straal r van (x, z); stopt als fn true geeft.
  query(x, z, r, fn) {
    const n = this.n;
    const x0 = Math.max(0, Math.floor((x - r + this.half) / this.cell));
    const x1 = Math.min(n - 1, Math.floor((x + r + this.half) / this.cell));
    const z0 = Math.max(0, Math.floor((z - r + this.half) / this.cell));
    const z1 = Math.min(n - 1, Math.floor((z + r + this.half) / this.cell));
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let k = this.head[cz * n + cx]; k !== -1; k = this.next[k]) {
          const u = this.items[k];
          const dx = u.x - x;
          const dz = u.z - z;
          if (dx * dx + dz * dz <= r2 && fn(u)) return;
        }
      }
    }
  }
}
