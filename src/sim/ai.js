// AI op drie niveaus:
//  1. Commander (per team): verdeelt squads over verdedigen, muurposten, veroveren, aanvallen en belegeren.
//  2. Squad: beweegt in formatie langs het flow field naar het doel van haar order.
//  3. Eenheid: kiest doelwit en wapen, vecht volgens haar rol (boogschutter houdt afstand,
//     ruiters chargeren, speren zetten zich schrap, mijnwerkers ondergraven muren...).
import { angleDiff, clamp } from './math.js';
import { toLocal } from './geom.js';
import { regionOf } from './map.js';
import { NAV_INF } from './nav.js';

const tmpDir = { x: 0, z: 0, d: 0 };

const RANGED_ROLES = new Set(['archer', 'crossbow', 'gunner']);

// ---------------------------------------------------------------------------
// Commandant
// ---------------------------------------------------------------------------
export class Commander {
  constructor(match, team) {
    this.m = match;
    this.team = team;
    this.t = 1 + team.index * 0.37;
    this.targetTeam = null;
    this.targetT = 0;
    this.attackGo = false;
    this.musterT = 0;
    this.threat = 0;
    this.leaderMode = 'defend';
    this.waves = 0;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 2;
    const m = this.m;
    const t = this.team;
    const fort = t.fort;
    const tactics = this._isPlayerSide() ? 0.8 : m.diff.tactics;

    // dreiging bij het eigen fort
    let threat = 0;
    let inside = 0;
    m.unitGrid.query(fort.cx, fort.cz, fort.extent + 40, (u) => {
      if (u.alliance !== t.alliance) {
        threat += u.siege ? 6 : 1;
        if (regionOf(m.map, u.x, u.z) === t.id || Math.hypot(u.x - fort.keep.x, u.z - fort.keep.z) < 26) inside++;
      }
      return false;
    });
    this.threat = threat;
    this.inside = inside;

    // doelwit kiezen: dichtstbijzijnde vijandelijke fort, met voorkeur voor verzwakte forten
    const enemies = m.teams.filter((o) => o.alive && o.alliance !== t.alliance);
    if (!enemies.length) return;
    this.targetT -= 2;
    if (!this.targetTeam || !this.targetTeam.alive || this.targetT <= 0) {
      let best = null;
      let bs = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.fort.cx - fort.cx, e.fort.cz - fort.cz);
        const hpFrac = e.fort.structures.reduce((a, s) => a + s.hp, 0) / e.fort.structures.reduce((a, s) => a + s.maxHp, 0);
        const score = d * (0.6 + hpFrac * 0.6) * (e.fort.breached ? 0.7 : 1) * (0.9 + m.rng() * 0.2);
        if (score < bs) {
          bs = score;
          best = e;
        }
      }
      this.targetTeam = best;
      this.targetT = 90;
    }
    const target = this.targetTeam;

    const squads = m.squads.filter((s) => s.team === t.id && s.members.length);
    const ownUnits = squads.reduce((a, s) => a + s.members.length, 0);
    const field = squads.filter((s) => s.order.kind !== 'guard' && s.order.kind !== 'siege');
    for (const s of field) if (s.order.kind === 'rally' && s.order.since == null) s.order.since = m.time;

    // ---- krachtsverhouding (het leger is eindig: elke man telt) ----
    // alliantie tegen alliantie (bondgenoten tellen mee)
    const enemySoldiers = enemies.filter((e) => e.alliance === target.alliance).reduce((a, e) => a + Math.max(0, e.soldiers), 0);
    const allySoldiers = m.teams.filter((o) => o.alive && o.alliance === t.alliance).reduce((a, o) => a + Math.max(0, o.soldiers), 0);
    const ratio = allySoldiers / Math.max(1, enemySoldiers);
    const late = m.time > m.length.timeLimit * 0.6;
    // veel sterker → alles op alles; veel zwakker (of laat en zwakker) → verschansen
    const early = m.time < m.length.timeLimit * 0.25 && !target.fort.breached;
    const allIn = !early && (ratio > 1.7 || (late && ratio > 1.1) || (target.fort.breached && ratio > 1.0));
    const turtle = !allIn && (ratio < 0.6 || (late && ratio < 0.9));

    // ---- muurposten voor schutters ----
    const freePosts = fort.posts.filter((p) => !p.struct.destroyed).length;
    let postWanted = Math.min(freePosts, Math.round(ownUnits * (0.16 + Math.min(0.2, threat / 80))));
    // ---- garnizoen: een vast deel blijft altijd thuis ----
    let defendShare = clamp(0.3 + threat / Math.max(20, ownUnits * 1.2), 0.3, 0.8);
    if (allIn) {
      // overmacht: (bijna) iedereen mee; alleen een wacht als er vijanden bij het fort zijn
      defendShare = threat > 3 ? clamp(threat / Math.max(20, ownUnits * 1.5), 0.05, 0.4) : 0;
      postWanted = threat > 3 ? Math.min(postWanted, Math.round(ownUnits * 0.06)) : 0;
    }
    if (turtle) defendShare = Math.max(defendShare, 0.85);
    if (fort.breached) defendShare = Math.max(defendShare, 0.45);
    const defendWanted = Math.round(ownUnits * defendShare);

    // squads sorteren op afstand tot het eigen fort
    const dist = (s) => Math.hypot(s.members[0].x - fort.cx, s.members[0].z - fort.cz);
    field.sort((a, b) => dist(a) - dist(b));

    // ---- lopende aanvalsgolf bewaken: zwaar gehavend → terugtrekken en hergroeperen ----
    if (this.attackGo && this.waveStart) {
      const attacking = field.filter((s) => s.order.kind === 'attack').reduce((a, s) => a + s.members.length, 0);
      if (!allIn && (attacking < this.waveStart * 0.45 || t.morale < 22) && !target.fort.breached) {
        this.attackGo = false;
        this.retreatT = m.time;
        for (const s of field) if (s.order.kind === 'attack') s.order = { kind: 'rally', since: m.time, retreat: true };
        m.events.push({ t: 'retreat', team: t.id });
      } else if (attacking < 3 && !allIn) this.attackGo = false;
    }

    let posted = 0;
    let defending = 0;
    let spotIdx = Math.floor(m.rng() * 10);
    const capturers = new Map();
    for (const s of field) {
      const role = s.type.role;
      const n = s.members.length;
      // vijand binnen de muren: iedereen in de buurt naar de donjon
      if (inside > 0 && dist(s) < fort.extent + 25 && s.order.kind !== 'keep') {
        s.order = { kind: 'keep', since: m.time };
        defending += n;
        continue;
      }
      if (s.order.kind === 'keep') {
        if (inside > 0 || m.time - s.order.since < 20) {
          defending += n;
          continue;
        }
      }
      // al aanvallend: blijven aanvallen (de golf wordt hierboven bewaakt)
      if (s.order.kind === 'attack' && this.attackGo) continue;
      if (RANGED_ROLES.has(role) || role === 'fire') {
        const keepPost = s.order.kind === 'posts' && posted < postWanted * 1.3 && postWanted > 0;
        if (keepPost || (posted < postWanted && s.order.kind !== 'attack')) {
          if (s.order.kind !== 'posts') s.order = { kind: 'posts', since: m.time };
          posted += n;
          continue;
        }
      }
      if (defending < defendWanted && role !== 'cavalry' && role !== 'sapper') {
        if (s.order.kind !== 'defend') s.order = { kind: 'defend', spot: spotIdx++ % fort.defendSpots.length };
        defending += n;
        continue;
      }
      // veroveringspunten: ruiters
      const cps = m.map.capturePoints
        .filter((c) => !c.owner || m.allianceOf(c.owner) !== t.alliance)
        .sort((a, b) => Math.hypot(a.x - fort.cx, a.z - fort.cz) - Math.hypot(b.x - fort.cx, b.z - fort.cz));
      const cp = cps.find((c) => (capturers.get(c.id) || 0) < 1);
      if (cp && !this.attackGo && role === 'cavalry' && !turtle) {
        s.order = { kind: 'capture', cp: cp.id };
        capturers.set(cp.id, (capturers.get(cp.id) || 0) + 1);
        continue;
      }
      if (role === 'cavalry') {
        // ruiters: flankeren zodra de aanval loopt, anders bij het verzamelpunt
        if (this.attackGo) s.order = { kind: 'raid', team: target.id };
        else if (s.order.kind !== 'rally') s.order = { kind: 'rally', since: m.time };
        continue;
      }
      if (this.attackGo) s.order = { kind: 'attack', team: target.id };
      else if (s.order.kind !== 'rally') s.order = { kind: 'rally', since: m.time };
    }

    // ---- aanval starten: samen met het belegeringstuig, met genoeg mannen ----
    const rallying = field.filter((s) => s.order.kind === 'rally' && !(s.order.retreat && m.time - s.order.since < 45));
    const rallyCount = rallying.reduce((a, s) => a + s.members.length, 0);
    const tf = target.fort;
    const siegeNear = m.time > 150 && m.units.some((u) => u.alive && u.team === t.id && u.siege && Math.hypot(u.x - tf.cx, u.z - tf.cz) < tf.extent + 40);
    const ready = siegeNear || tf.breached || m.time > 300 + this.waves * 90 || (allIn && m.time > 120);
    const cooled = !this.retreatT || m.time - this.retreatT > 50;
    if (!this.attackGo && !turtle && ready && cooled) {
      if (rallyCount >= Math.max(6, t.startSoldiers * 0.22) || (allIn && rallyCount >= 3)) {
        this.waves++;
        this.attackGo = true;
        this.waveStart = rallyCount;
        for (const s of rallying) s.order = { kind: 'attack', team: target.id };
        m.events.push({ t: 'attackWave', team: t.id, target: target.id });
      }
    }

    // belegeringsgeschut altijd op het doel richten
    for (const s of squads) if (s.order.kind === 'siege') s.order.team = target.id;

    // leider
    const L = t.leader;
    if (L && L.alive && !L.isPlayer) {
      const attackers = field.filter((s) => s.order.kind === 'attack');
      if (L.hp < L.maxHp * 0.35) this.leaderMode = 'retreat';
      else if (this.attackGo && attackers.length >= 2 && (target.fort.breached || allIn)) this.leaderMode = 'attack';
      else this.leaderMode = 'defend';
      this.leaderFollow = attackers[0]?.members[0] || null;
    }
  }

  _isPlayerSide() {
    const p = this.m.player;
    return p && p.alliance === this.team.alliance;
  }
}

// ---------------------------------------------------------------------------
// Doelwit zoeken
// ---------------------------------------------------------------------------
function hasLos(m, u, e) {
  const ey = u.y + (u.mounted ? 2.4 : 1.6);
  const ty = e.y + e.height * 0.6;
  const dx = e.x - u.x;
  const dy = ty - ey;
  const dz = e.z - u.z;
  const l = Math.hypot(dx, dy, dz);
  const hit = m.obGrid.raycast(u.x, ey, u.z, dx / l, dy / l, dz / l, l, (o) => o.blocksLos);
  return !hit;
}

const cand = [];
function findTarget(m, u, radius, needLos, prefer) {
  const cur = u.ai.target;
  cand.length = 0;
  const melee = !needLos;
  m.unitGrid.query(u.x, u.z, radius, (e) => {
    if (e.alliance === u.alliance || !e.alive) return false;
    if (melee && e.y > 1 && !e.climb) return false; // op de muur: onbereikbaar voor voetvolk
    let d = Math.hypot(e.x - u.x, e.z - u.z);
    if (e === cur) d -= 6;
    if (prefer) d *= prefer(e);
    cand.push([d, e]);
    return false;
  });
  if (!cand.length) return null;
  cand.sort((a, b) => a[0] - b[0]);
  // de beste paar kandidaten op zicht (schutters) of begaanbaarheid (voetvolk) controleren
  for (let k = 0; k < Math.min(3, cand.length); k++) {
    const e = cand[k][1];
    if (needLos ? hasLos(m, u, e) : reachable(m, u, e)) return e;
  }
  return null;
}

function reachable(m, u, e) {
  const d = Math.hypot(e.x - u.x, e.z - u.z);
  if (d < 4) return true;
  return m.nav.clearLine(u.x, u.z, e.x, e.z, u.alliance);
}

function weaponIndex(u, kind) {
  for (let i = 0; i < u.weapons.length; i++) {
    const k = u.weapons[i].kind;
    if (kind === 'melee' ? k === 'melee' : k === 'ranged' || k === 'thrown') return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Denken (een paar keer per seconde)
// ---------------------------------------------------------------------------
export function unitThink(m, u) {
  const ai = u.ai;
  const order = u.squad?.order || { kind: 'defend' };
  if (u.siege) return siegeThink(m, u);

  // vastgelopen?
  const moved = Math.hypot(u.x - ai.lx, u.z - ai.lz);
  ai.lx = u.x;
  ai.lz = u.z;
  if (moved < 0.15 && ai.wantMove && !ai.target && !u.post) {
    ai.stuckT += 0.4;
    if (ai.stuckT > 2.5) {
      ai.unstickT = 0.8;
      ai.unstickDir = m.rng() * Math.PI * 2;
      ai.stuckT = 0;
    }
  } else ai.stuckT = 0;
  // langdurig geen voortgang (bv. formatieplek achter bondgenoten): een tijd zelfstandig het veld volgen
  if (!ai.wantMove || ai.target || u.post || Math.hypot(u.x - (ai.px ?? u.x), u.z - (ai.pz ?? u.z)) > 3 || ai.pt == null) {
    ai.px = u.x;
    ai.pz = u.z;
    ai.pt = m.time;
  } else if (m.time - ai.pt > 12) {
    ai.soloT = m.time + 20;
    ai.unstickT = 1.2;
    ai.unstickDir = m.rng() * Math.PI * 2;
    ai.pt = m.time;
  }

  const w0 = u.weapons[0];
  const ranged = RANGED_ROLES.has(u.role) || (u.role === 'guard' && w0.kind === 'ranged');
  const rangeW = ranged ? u.weapons[weaponIndex(u, 'ranged')] : null;
  let senseR;
  if (u.post) senseR = rangeW ? rangeW.range * 1.1 : 30;
  else if (ranged) senseR = Math.min(rangeW.range, 70);
  else if (u.role === 'cavalry') senseR = order.kind === 'raid' ? 55 : 35;
  else if (u.role === 'sapper') senseR = 6;
  else if (u.role === 'fire') senseR = 22;
  else senseR = order.kind === 'defend' || order.kind === 'keep' ? 32 : 22;
  if (u.role === 'leader') senseR = 18;

  // houd het huidige doel vast zolang het bereikbaar is
  let t = ai.target;
  if (t && (!t.alive || Math.hypot(t.x - u.x, t.z - u.z) > senseR * 1.4)) t = null;
  if (!t || m.rng() < 0.25) {
    const prefer = u.role === 'cavalry'
      ? (e) => (RANGED_ROLES.has(e.role) || e.siege ? 0.5 : e.role === 'spear' ? 1.8 : 1)
      : u.role === 'spear' ? (e) => (e.mounted ? 0.6 : 1) : null;
    const nt = findTarget(m, u, senseR, ranged || u.post, prefer);
    if (nt && nt !== t) {
      t = nt;
      ai.reactT = m.diff.reaction * (u.alliance === m.player?.alliance ? 0.6 : 1) * (0.6 + m.rng() * 0.8);
    } else if (!nt && t && ranged && !hasLos(m, u, t)) t = null;
  }
  ai.target = t;

  // wapenkeuze
  if (ranged && !u.post) {
    const ri = weaponIndex(u, 'ranged');
    const mi = weaponIndex(u, 'melee');
    const d = t ? Math.hypot(t.x - u.x, t.z - u.z) : 99;
    if ((d < 4.5 || u.ammo[ri] <= 0) && mi >= 0) u.wi = mi;
    else u.wi = ri;
  } else if (u.post) {
    const ri = weaponIndex(u, 'ranged');
    if (ri >= 0) u.wi = ri;
  } else if (u.role === 'spear' && u.weapons[1]?.kind === 'thrown') {
    const d = t ? Math.hypot(t.x - u.x, t.z - u.z) : 99;
    u.wi = d > 9 && d < 28 && u.ammo[1] > 0 ? 1 : 0;
  } else if (u.weapons[u.wi].kind !== 'melee' && u.weapons[u.wi].kind !== 'spray') u.wi = Math.max(0, weaponIndex(u, 'melee'));

  // muurposten
  if (order.kind === 'posts' && !u.post && !u.climb && !t) {
    if (!ai.post || ai.post.occupant || ai.post.struct.destroyed) {
      ai.post = m.nearestFreePost(u, 200);
      if (ai.post) ai.post.reserved = u;
    }
    if (ai.post && Math.hypot(ai.post.footX - u.x, ai.post.footZ - u.z) < 1.8) {
      m.takePost(u, ai.post);
      ai.post = null;
    }
  }
  if (u.post && order.kind !== 'posts') m.leavePost(u);

  // via een aangelegde belegeringstoren over de muur
  if (u.blockedBy && u.blockedBy.dock && u.blockedBy.dock.alliance === u.alliance && !ai.dockSt) {
    ai.dockSt = u.blockedBy;
    ai.dockPhase = 0;
  }

  // doel achter een gesloten vijandelijke poort/muur: eerst die aanvallen
  if (t && !ranged && !u.post && u.blockedBy && !u.blockedBy.destroyed && !reachable(m, u, t)) {
    if (u.blockedBy.gate) ai.forceStruct = u.blockedBy;
    t = null;
    ai.target = null;
  }

  // poort/muur aanvallen als die de weg verspert
  ai.struct = null;
  if (ai.forceStruct && !ai.forceStruct.destroyed && Math.hypot(ai.forceStruct.x - u.x, ai.forceStruct.z - u.z) < 12) ai.struct = ai.forceStruct;
  else ai.forceStruct = null;
  if (!t && u.blockedBy && !u.blockedBy.destroyed && (order.kind === 'attack' || order.kind === 'raid')) {
    if (u.blockedBy.gate || u.role === 'sapper') ai.struct = u.blockedBy;
  }
  if (u.role === 'sapper' && order.kind === 'attack') {
    // mijnwerkers zoeken de dichtstbijzijnde vijandelijke muur
    const tf = m.teamById[order.team]?.fort;
    if (tf && !ai.struct) {
      let best = null;
      let bd = 60;
      for (const st of tf.structures) {
        if (st.destroyed || st.gate) continue;
        const d = Math.hypot(st.x - u.x, st.z - u.z);
        if (d < bd) {
          bd = d;
          best = st;
        }
      }
      if (best) ai.struct = best;
    }
  }
}

// ---------------------------------------------------------------------------
// Sturen (elk frame)
// ---------------------------------------------------------------------------
export function unitSteer(m, u, dt) {
  const ai = u.ai;
  u.dvx = 0;
  u.dvz = 0;
  ai.wantMove = false;
  if (u.climb) return;
  if (u.siege) return siegeSteer(m, u, dt);
  const order = u.squad?.order || { kind: 'defend' };
  const sp = m.speedOf(u);
  const t = ai.target;
  ai.reactT -= dt;

  if (ai.unstickT > 0) {
    ai.unstickT -= dt;
    move(u, Math.sin(ai.unstickDir), Math.cos(ai.unstickDir), sp * 0.7);
    return;
  }

  // over de muur via de belegeringstoren
  if (ai.dockSt && (!t || Math.hypot(t.x - u.x, t.z - u.z) > 6)) {
    const st = ai.dockSt;
    if (st.destroyed || !st.dock) ai.dockSt = null;
    else {
      const dk = st.dock;
      let ix = st.fort.cx - dk.x;
      let iz = st.fort.cz - dk.z;
      const il = Math.hypot(ix, iz) || 1;
      ix /= il;
      iz /= il;
      if (ai.dockPhase === 0) {
        const d = Math.hypot(dk.x - u.x, dk.z - u.z);
        if (d > 1.4) move(u, (dk.x - u.x) / d, (dk.z - u.z) / d, sp);
        else ai.dockPhase = 1;
      } else {
        const tx = dk.x + ix * 10;
        const tz = dk.z + iz * 10;
        const d = Math.hypot(tx - u.x, tz - u.z);
        if (d > 1) move(u, (tx - u.x) / d, (tz - u.z) / d, sp * 0.8);
        else ai.dockSt = null;
      }
      faceMove(u, dt);
      return;
    }
  }

  // op de muur: alleen draaien en schieten
  if (u.post) {
    if (t) {
      faceTo(u, t.x, t.z, dt, 5);
      tryShoot(m, u, t);
    } else u.yaw += clamp(angleDiff(u.yaw, u.post.faceYaw), -2 * dt, 2 * dt);
    return;
  }

  // leider en lijfwacht
  if (u.role === 'leader' && !t) return leaderMove(m, u, dt, sp);
  if (u.role === 'guard' && !t && order.leader) {
    const L = order.leader;
    if (L.alive) {
      const k = u.squad.members.indexOf(u);
      const a = L.yaw + Math.PI + (k - 1.5) * 0.9;
      const gx = L.x + Math.sin(a) * 2.6;
      const gz = L.z + Math.cos(a) * 2.6;
      // staat de leider stil en zijn we dichtbij, dan blijven we staan (geen geschuifel tegen muren)
      if (Math.hypot(L.vx || 0, L.vz || 0) < 0.5 && Math.hypot(L.x - u.x, L.z - u.z) < 4.5) {
        move(u, 0, 0, 0);
        u.yaw += clamp(angleDiff(u.yaw, L.yaw), -2 * dt, 2 * dt);
        return;
      }
      seek(m, u, gx, gz, sp * (L.mounted ? 1.4 : 1), dt, 0.8, order, L.team);
      return;
    }
  }

  // muur/poort aanvallen
  if (!t && ai.struct) {
    const st = ai.struct;
    const [lx, lz] = toLocal(st.ob, u.x, u.z);
    const ox = Math.max(0, Math.abs(lx) - st.ob.hx);
    const oz = Math.max(0, Math.abs(lz) - st.ob.hz);
    const d = Math.hypot(ox, oz);
    const reach = u.weapons[u.wi].reach || 2;
    if (d > reach * 0.8) {
      // naar het dichtstbijzijnde punt van het bouwwerk
      const qx = clamp(lx, -st.ob.hx, st.ob.hx);
      const qz = clamp(lz, -st.ob.hz, st.ob.hz);
      const wx = st.ob.cx + st.ob.cos * qx + st.ob.sin * qz;
      const wz = st.ob.cz - st.ob.sin * qx + st.ob.cos * qz;
      seek(m, u, wx, wz, sp, dt, 0, null);
    } else {
      faceTo(u, st.x, st.z, dt, 6);
      m.startMelee(u, st);
    }
    return;
  }

  if (t) {
    const dx = t.x - u.x;
    const dz = t.z - u.z;
    const d = Math.hypot(dx, dz) || 0.01;
    const w = u.weapons[u.wi];
    if (w.kind === 'ranged' || w.kind === 'thrown') {
      // afstand houden, dreigend voetvolk ontwijken
      let threat = null;
      m.unitGrid.query(u.x, u.z, 7, (e) => {
        if (e.alliance !== u.alliance && e.alive && !e.siege) {
          threat = e;
          return true;
        }
        return false;
      });
      if (threat && u.role !== 'guard') {
        const tx = u.x - threat.x;
        const tz = u.z - threat.z;
        const l = Math.hypot(tx, tz) || 1;
        move(u, tx / l, tz / l, sp * 0.9);
      } else if (d > w.range * 0.85) {
        seek(m, u, t.x, t.z, sp * 0.85, dt, 0, order, u.team);
      } else {
        // kleine zijstapjes
        ai.strafeT = (ai.strafeT || 0) - dt;
        if (ai.strafeT <= 0) {
          ai.strafeT = 1 + m.rng() * 2;
          ai.strafe = m.rng() < 0.6 ? 0 : m.rng() < 0.5 ? -1 : 1;
        }
        if (ai.strafe) move(u, (dz / d) * ai.strafe, (-dx / d) * ai.strafe, sp * 0.35);
      }
      faceTo(u, t.x, t.z, dt, 5);
      tryShoot(m, u, t);
      return;
    }
    if (w.kind === 'spray') {
      if (d > w.range * 0.7) seek(m, u, t.x, t.z, sp, dt, 0, order, u.team);
      faceTo(u, t.x, t.z, dt, 5);
      if (d < w.range && ai.reactT <= 0 && Math.abs(angleDiff(u.yaw, Math.atan2(dx, dz))) < 0.3) {
        if (!m.startSpray(u)) {
          // geen vuur meer: met het zwaard verder
          if (u.ammo[0] <= 0) u.wi = 1;
        }
      }
      return;
    }
    // ruiters: charge erdoorheen, keren en opnieuw
    if (u.mounted) {
      if (ai.passT > 0) {
        ai.passT -= dt;
        move(u, Math.sin(u.yaw), Math.cos(u.yaw), sp);
      } else {
        const lead = Math.min(1, d / 20);
        move(u, (dx + t.vx * lead) / d, (dz + t.vz * lead) / d, sp);
        if (d < 3.4) ai.passT = 0.8 + m.rng() * 0.5;
      }
      if (d < w.reach + t.radius + 0.9 && ai.reactT <= 0 && Math.abs(angleDiff(u.yaw, Math.atan2(dx, dz))) < 0.9) m.startMelee(u, null);
      return;
    }
    // voetvolk in het gevecht
    const reach = w.reach + t.radius;
    if (d > reach * 0.85) {
      if (d < 4 || reachableCached(m, u, t)) move(u, dx / d, dz / d, sp * (d > 8 ? 1 : 0.8));
      else seek(m, u, t.x, t.z, sp, dt, 0, order, u.team);
    } else {
      ai.strafeT = (ai.strafeT || 0) - dt;
      if (ai.strafeT <= 0) {
        ai.strafeT = 0.6 + m.rng();
        ai.strafe = m.rng() < 0.5 ? -1 : 1;
      }
      move(u, (dz / d) * ai.strafe, (-dx / d) * ai.strafe, sp * 0.25);
    }
    faceTo(u, t.x, t.z, dt, 7);
    if (d < reach + 0.35 && ai.reactT <= 0 && Math.abs(angleDiff(u.yaw, Math.atan2(dx, dz))) < 0.6) m.startMelee(u, null);
    return;
  }

  // geen vijand: order uitvoeren
  orderMove(m, u, dt, sp, order);
}

function reachableCached(m, u, t) {
  if (u.ai._rT === t && u.ai._rTime > m.time - 0.5) return u.ai._r;
  u.ai._rT = t;
  u.ai._rTime = m.time;
  u.ai._r = reachable(m, u, t);
  return u.ai._r;
}

function tryShoot(m, u, t) {
  const w = u.weapons[u.wi];
  if (u.ai.reactT > 0 || u.cd > 0) return;
  const want = Math.atan2(t.x - u.x, t.z - u.z);
  if (Math.abs(angleDiff(u.yaw, want)) > 0.2) return;
  const d = Math.hypot(t.x - u.x, t.z - u.z);
  const range = w.range * (u.post ? 1.15 : 1);
  if (d > range) return;
  const tt = d / w.speed;
  const acc = m.player && u.alliance === m.player.alliance ? 1 : m.diff.spread;
  m.shoot(u, t.x + t.vx * tt, t.y + t.height * 0.6, t.z + t.vz * tt, acc);
}

function move(u, dx, dz, speed) {
  u.dvx = dx * speed;
  u.dvz = dz * speed;
  if (u.mounted) u.dmag = clamp(speed / Math.max(1, u.def.speed), 0, 1.1);
  u.ai.wantMove = speed > 0.1;
}

function faceTo(u, x, z, dt, rate) {
  if (u.mounted && u.speed > 1) return; // ruiters kijken in de rijrichting
  u.yaw += clamp(angleDiff(u.yaw, Math.atan2(x - u.x, z - u.z)), -rate * dt, rate * dt);
}

function faceMove(u, dt) {
  if (u.mounted) return;
  if (Math.abs(u.dvx) + Math.abs(u.dvz) > 0.2) u.yaw += clamp(angleDiff(u.yaw, Math.atan2(u.dvx, u.dvz)), -6 * dt, 6 * dt);
}

// Naar een punt: direct als het dichtbij en vrij is, anders via het flow field.
function seek(m, u, x, z, speed, dt, arrive = 0.5, order = null, teamForField = null) {
  const dx = x - u.x;
  const dz = z - u.z;
  const d = Math.hypot(dx, dz);
  if (d < arrive) {
    u.ai.wantMove = false;
    return;
  }
  const field = order ? fieldForOrder(m, u, order) : null;
  const sameRegion = d < 18 && (d < 4 || m.nav.clearLine(u.x, u.z, x, z));
  if (sameRegion || !field) {
    const k = d < 2 ? d / 2 : 1;
    move(u, dx / d, dz / d, speed * k);
  } else if (m.nav.dirAt(field, u.x, u.z, tmpDir) && (tmpDir.x || tmpDir.z)) {
    move(u, tmpDir.x, tmpDir.z, speed);
  } else move(u, dx / d, dz / d, speed);
  faceMove(u, dt);
}

function fieldForOrder(m, u, order) {
  switch (order.kind) {
    case 'attack': return m.field('keep:' + order.team, u.alliance);
    case 'raid': return m.field('keep:' + order.team, u.alliance);
    case 'capture': return m.field('cp:' + order.cp, u.alliance);
    case 'rally': return m.field('rally:' + u.team, u.alliance);
    case 'keep': return m.field('keep:' + u.team, u.alliance);
    default: return m.field('home:' + u.team, u.alliance);
  }
}

function goalOf(m, u, order) {
  const t = m.teamById[u.team];
  switch (order.kind) {
    case 'attack':
    case 'raid': {
      const k = m.teamById[order.team].fort.keep;
      return [k.x, k.z];
    }
    case 'capture': {
      const c = m.map.capturePoints[order.cp];
      return [c.x, c.z];
    }
    case 'rally': return [t.fort.rally.x, t.fort.rally.z];
    case 'keep': return [t.fort.keep.x, t.fort.keep.z];
    default: return [t.fort.inside.x, t.fort.inside.z];
  }
}

// Formatie-offsets per squadtype
function slotOffset(u, k) {
  const role = u.role;
  if (role === 'cavalry') {
    const row = Math.floor((k + 1) / 2);
    const side = k % 2 ? -1 : 1;
    return [side * row * 2.6, -row * 2.8];
  }
  const ranged = RANGED_ROLES.has(role);
  const width = ranged ? 6 : 5;
  const sx = ranged ? 2.1 : 1.45;
  const sz = ranged ? 2.3 : 1.7;
  const row = Math.floor(k / width);
  const col = (k % width) - (width - 1) / 2;
  return [col * sx, -row * sz];
}

function orderMove(m, u, dt, sp, order) {
  const sq = u.squad;
  const ai = u.ai;
  // schutters voor een gesloten vijandelijk fort: schietpositie innemen in plaats van tegen de muur te duwen
  if ((order.kind === 'attack' || order.kind === 'raid') && (RANGED_ROLES.has(u.role) || u.role === 'fire')) {
    const tf = m.teamById[order.team]?.fort;
    if (tf && !tf.breached) {
      const d = Math.hypot(u.x - tf.cx, u.z - tf.cz);
      const stand = tf.extent + 18 + (u.id % 5) * 2;
      if (d < stand + 4) {
        if (d < stand - 6) move(u, (u.x - tf.cx) / d, (u.z - tf.cz) / d, sp * 0.6);
        else move(u, 0, 0, 0);
        faceTo(u, tf.cx, tf.cz, dt, 3);
        return;
      }
    }
  }
  if (order.kind === 'posts') {
    if (ai.post) {
      seek(m, u, ai.post.footX, ai.post.footZ, sp, dt, 0.4, { kind: 'defend' }, u.team);
      return;
    }
    // geen vrije post: als verdediger achter de poort blijven
    const f = m.teamById[u.team].fort;
    const spot = f.defendSpots[(u.id * 7) % f.defendSpots.length];
    seek(m, u, spot.x + ((u.id % 5) - 2) * 1.6, spot.z + ((u.id % 3) - 1) * 1.6, sp * 0.7, dt, 1.2, { kind: 'defend' }, u.team);
    return;
  }
  if (order.kind === 'defend' && order.spot != null) {
    // eigen plek in het fort, iedereen op een vaste plaats rond die plek
    const f = m.teamById[u.team].fort;
    const spot = f.defendSpots[order.spot % f.defendSpots.length];
    const k = sq ? sq.members.indexOf(u) : 0;
    const [ox, oz] = slotOffset(u, Math.max(0, k));
    const c = Math.cos(f.rot);
    const s2 = Math.sin(f.rot);
    const tx = spot.x + c * ox + s2 * oz;
    const tz = spot.z - s2 * ox + c * oz;
    if (Math.hypot(tx - u.x, tz - u.z) > 0.8) seek(m, u, tx, tz, sp * 0.8, dt, 0.6, { kind: 'defend' }, u.team);
    else u.yaw += clamp(angleDiff(u.yaw, f.rot), -3 * dt, 3 * dt);
    return;
  }
  // de eerste levende eenheid (niet op de muur) is het anker van de squad
  let anchor = sq ? sq.members[0] : u;
  if (anchor && (anchor.post || anchor.climb)) anchor = sq.members.find((x) => !x.post && !x.climb) || u;
  if (anchor === u || !sq) {
    const field = fieldForOrder(m, u, order);
    let speed = sp * (order.kind === 'attack' || order.kind === 'raid' ? 0.8 : 0.7);
    // wachten op achterblijvers
    if (sq && sq.members.length > 1) {
      let far = 0;
      for (let k = 1; k < sq.members.length; k++) {
        const o = sq.members[k];
        if (Math.hypot(o.x - u.x, o.z - u.z) > 12) far++;
      }
      if (far > sq.members.length * 0.4) speed *= 0.35;
    }
    if (!field) {
      // veld wordt nog berekend: rechtstreeks richting doel
      const g = goalOf(m, u, order);
      const gd = Math.hypot(g[0] - u.x, g[1] - u.z);
      if (gd > 5) move(u, (g[0] - u.x) / gd, (g[1] - u.z) / gd, speed);
      faceMove(u, dt);
      return;
    }
    const d = m.nav.distAt(field, u.x, u.z);
    const hold = order.kind === 'defend' || order.kind === 'rally' || order.kind === 'posts' || order.kind === 'capture' || order.kind === 'keep' || order.kind === 'guard';
    if (hold && d < (order.kind === 'guard' || order.kind === 'keep' ? 9 : 6)) return; // aangekomen
    if (d >= NAV_INF) return;
    if (m.nav.dirAt(field, u.x, u.z, tmpDir) && (tmpDir.x || tmpDir.z)) {
      move(u, tmpDir.x, tmpDir.z, speed);
      faceMove(u, dt);
    }
    return;
  }
  // volger: naar zijn plek in de formatie
  const k = sq.members.indexOf(u);
  const [ox, oz] = slotOffset(u, k);
  const c = Math.cos(anchor.yaw);
  const s = Math.sin(anchor.yaw);
  const tx = anchor.x + c * ox + s * oz;
  const tz = anchor.z - s * ox + c * oz;
  const d = Math.hypot(tx - u.x, tz - u.z);
  if (d > 14 || (ai.soloT || 0) > m.time || m.nav.blocked[m.nav.idx(tx, tz)] || !m.nav.clearLine(u.x, u.z, tx, tz)) {
    // plek niet direct bereikbaar: zelf het veld van de order volgen
    const field = fieldForOrder(m, u, order);
    if (field && m.nav.dirAt(field, u.x, u.z, tmpDir) && (tmpDir.x || tmpDir.z)) {
      move(u, tmpDir.x, tmpDir.z, sp);
      faceMove(u, dt);
    } else seek(m, u, anchor.x, anchor.z, sp, dt, 2, null);
  } else if (d > 0.6) {
    const speed = d > 4 ? sp : sp * Math.max(0.35, d / 4);
    move(u, (tx - u.x) / d, (tz - u.z) / d, speed);
    faceMove(u, dt);
  } else {
    u.yaw += clamp(angleDiff(u.yaw, anchor.yaw), -3 * dt, 3 * dt);
  }
}

function leaderMove(m, u, dt, sp) {
  const cmd = m.commanders[m.teamById[u.team].index];
  const fort = m.teamById[u.team].fort;
  // strijdkreet als er genoeg strijders en vijanden in de buurt zijn
  if ((u.cryCd || 0) < m.time) {
    let allies = 0;
    let foes = 0;
    m.unitGrid.query(u.x, u.z, 24, (o) => {
      if (o.alliance === u.alliance) allies++;
      else foes++;
      return false;
    });
    if (allies >= 6 && foes >= 3) m.battleCry(u);
  }
  if (cmd.leaderMode === 'attack' && cmd.leaderFollow && cmd.leaderFollow.alive) {
    const f = cmd.leaderFollow;
    seek(m, u, f.x - Math.sin(f.yaw) * 6, f.z - Math.cos(f.yaw) * 6, sp * 0.9, dt, 2, { kind: 'attack', team: cmd.targetTeam?.id }, u.team);
    return;
  }
  // verdedigen: vóór de donjon blijven
  const kx = fort.keep.x + Math.sin(fort.rot) * 9;
  const kz = fort.keep.z + Math.cos(fort.rot) * 9;
  seek(m, u, kx, kz, sp * 0.8, dt, 2.5, { kind: 'defend' }, u.team);
}

// ---------------------------------------------------------------------------
// Belegeringsgeschut
// ---------------------------------------------------------------------------
function siegeThink(m, u) {
  const order = u.squad?.order;
  const tf = order?.team ? m.teamById[order.team]?.fort : null;
  const ai = u.ai;
  if (!tf) {
    ai.struct = null;
    return;
  }
  if (u.role === 'ram') {
    ai.struct = tf.gates.find((g) => !g.destroyed) || null;
  } else if (u.role === 'tower') {
    if (u.docked && !u.docked.destroyed) return;
    // dichtstbijzijnde intacte muur (geen poort) aan de kant van de aanvaller
    let best = null;
    let bd = Infinity;
    for (const st of tf.structures) {
      if (st.destroyed || st.gate || st.kind.includes('ower') || st.dock) continue;
      const d = Math.hypot(st.x - u.x, st.z - u.z);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    ai.struct = best;
  } else {
    // bombarde/blijde: eerst de poort, dan de muur ernaast
    const g = tf.gates.find((s) => !s.destroyed);
    if (g) ai.struct = g;
    else {
      let best = null;
      let bd = Infinity;
      for (const st of tf.structures) {
        if (st.destroyed) continue;
        const d = Math.hypot(st.x - u.x, st.z - u.z);
        if (d < bd) {
          bd = d;
          best = st;
        }
      }
      ai.struct = best;
    }
  }
}

function siegeSteer(m, u, dt) {
  const ai = u.ai;
  const st = ai.struct;
  const order = u.squad?.order;
  const sp = m.speedOf(u);
  if (!st || st.destroyed) {
    if (order?.team) {
      const f = m.field('keep:' + order.team, u.alliance);
      if (u.role !== 'tower' && m.nav.distAt(f, u.x, u.z) > 30 && m.nav.dirAt(f, u.x, u.z, tmpDir)) move(u, tmpDir.x, tmpDir.z, sp);
    }
    return;
  }
  const d = Math.hypot(st.x - u.x, st.z - u.z);
  if (u.role === 'ram') {
    const [lx, lz] = toLocal(st.ob, u.x, u.z);
    const gap = Math.hypot(Math.max(0, Math.abs(lx) - st.ob.hx), Math.max(0, Math.abs(lz) - st.ob.hz));
    if (gap > 3.5) {
      const f = m.field('gate:' + st.team, u.alliance);
      if (d < 16) move(u, (st.x - u.x) / d, (st.z - u.z) / d, sp);
      else if (m.nav.dirAt(f, u.x, u.z, tmpDir)) move(u, tmpDir.x, tmpDir.z, sp);
    } else {
      u.yaw += clamp(angleDiff(u.yaw, Math.atan2(st.x - u.x, st.z - u.z)), -dt, dt);
      m.startMelee(u, st);
    }
    return;
  }
  if (u.role === 'tower') {
    if (u.docked) return;
    if (d < 20) {
      // recht op de buitenkant van de muur af
      const [lx, lz] = toLocal(st.ob, u.x, u.z);
      const side = Math.sign(st.ob.hz < st.ob.hx ? lz : lx) || 1;
      const thin = st.ob.hz < st.ob.hx;
      const qx = thin ? clamp(lx, -st.ob.hx + 2, st.ob.hx - 2) : side * (st.ob.hx + u.radius);
      const qz = thin ? side * (st.ob.hz + u.radius) : clamp(lz, -st.ob.hz + 2, st.ob.hz - 2);
      const wx = st.ob.cx + st.ob.cos * qx + st.ob.sin * qz;
      const wz = st.ob.cz - st.ob.sin * qx + st.ob.cos * qz;
      const dd = Math.hypot(wx - u.x, wz - u.z);
      if (dd > 0.6) move(u, (wx - u.x) / dd, (wz - u.z) / dd, sp);
      if (dd < 1.2 || u.blockedBy === st) {
        u.x = wx;
        u.z = wz;
        m.dockTower(u, st);
      }
    } else {
      const f = m.field('keep:' + order.team, u.alliance);
      if (m.nav.dirAt(f, u.x, u.z, tmpDir)) move(u, tmpDir.x, tmpDir.z, sp);
    }
    return;
  }
  // geschut: naderen tot binnen bereik, dan opstellen en vuren
  const w = u.weapons[0];
  const want = w.range * 0.75;
  if (d > want) {
    const f = m.field('keep:' + st.team, u.alliance);
    if (m.nav.dirAt(f, u.x, u.z, tmpDir)) move(u, tmpDir.x, tmpDir.z, sp);
    ai.deployT = 0;
  } else {
    ai.deployT = (ai.deployT || 0) + dt;
    u.yaw += clamp(angleDiff(u.yaw, Math.atan2(st.x - u.x, st.z - u.z)), -0.5 * dt, 0.5 * dt);
    if (ai.deployT > 3 && Math.abs(angleDiff(u.yaw, Math.atan2(st.x - u.x, st.z - u.z))) < 0.05) {
      m.shoot(u, st.x, st.h * (w.lob ? 0.4 : 0.35), st.z, 1);
    }
  }
}
