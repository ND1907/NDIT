// De volledige spelsimulatie, los van rendering. Draait identiek in de browser en in Node.
import { ARMOR, STRUCT, SIEGE_VULN, WEAPONS, UNITS, FACTIONS, LEADERS, TROOP_SIZES, MATCH_LENGTHS, DIFFICULTIES } from './data.js';
import { makeRng, clamp, angleDiff, turnTowards, ballistic } from './math.js';
import { ObstacleGrid, UnitGrid, pushCircle, pointInside, toLocal } from './geom.js';
import { generateMap, regionOf } from './map.js';
import { NavGrid, NAV_INF } from './nav.js';
import { Commander, unitThink, unitSteer } from './ai.js';

export const GRAVITY = 9.8;
const CORPSE_TIME = 25;

// Afmetingen van eenheden voor botsing en treffers
function bodyOf(def) {
  if (def.role === 'siege') return def.weapons[0] === 'bombard' ? { r: 1.8, h: 1.8 } : { r: 2.4, h: 6 };
  if (def.role === 'ram') return { r: 2.0, h: 2.8 };
  if (def.role === 'tower') return { r: 3.0, h: 12 };
  if (def.mounted) return { r: 0.85, h: 2.75 };
  return { r: def.role === 'leader' ? 0.45 : 0.4, h: def.role === 'leader' ? 2.0 : 1.85 };
}


// schaal voor schade aan eenheden (niet aan bouwwerken)
const UNIT_DMG = 0.5;

export class Match {
  constructor(settings) {
    this.settings = { ...settings };
    this.uid = 1;
    const s = this.settings;
    this.rng = makeRng(s.seed ?? 1453);
    this.length = MATCH_LENGTHS[s.length || 'normal'];
    this.diff = DIFFICULTIES[s.difficulty || 'normal'];
    this.troops = TROOP_SIZES[s.troops || 'normal'];
    this.cap = s.capOverride || this.troops.perTeam;

    // allianties
    this.teams = s.teams.map((id, i) => ({
      id, index: i, faction: FACTIONS[id],
      alliance: s.mode === 'ffa' ? id : FACTIONS[id].side,
      alive: true, morale: 70,
      leader: null, leaderDeaths: 0, cryCd: 20,
      stats: { kills: 0, losses: 0, structDmg: 0, leaderKills: 0 },
      eliminatedAt: null, fort: null, units: 0,
    }));
    // als iedereen dezelfde kant heeft (bv. alleen christenen gekozen) → ieder voor zich
    const allis = new Set(this.teams.map((t) => t.alliance));
    if (allis.size < 2) for (const t of this.teams) t.alliance = t.id;
    this.teamById = Object.fromEntries(this.teams.map((t) => [t.id, t]));
    this.allianceOf = (teamId) => this.teamById[teamId].alliance;
    // vast leger: elk team begint met precies `cap` soldaten; gesneuvelden komen nooit terug
    for (const t of this.teams) {
      t.boost = 1;
      t.cap = this.cap;
      t.soldiers = 0;
      t.startSoldiers = this.cap;
    }

    this.map = generateMap(s.teams, { seed: s.seed ?? 1453, structHp: this.length.structHp });
    this.teams.forEach((t, i) => (t.fort = this.map.forts[i]));
    for (const st of this.map.structures) st.alliance = this.allianceOf(st.team);
    this.obGrid = new ObstacleGrid(this.map.half, 8);
    for (const o of this.map.obstacles) this.obGrid.insert(o);
    this.unitGrid = new UnitGrid(this.map.half, 4, 4096);
    this.nav = new NavGrid(this.map, 2);
    this.fieldJobs = new Map();

    this.units = [];
    this.freeHorses = [];
    this.projectiles = [];
    this.fires = [];
    this.events = [];
    this.squads = [];
    this.time = 0;
    this.over = false;
    this.winner = null;
    this.phase = 1;
    this.player = null;
    this.input = null;
    this.commanders = this.teams.map((t) => new Commander(this, t));
    this.tick = 0;
    this._precomputeFields();

    this._spawnInitial();
  }

  // ------------------------------------------------------------------ eenheden
  createUnit(typeId, team, x, z, opts = {}) {
    const def = UNITS[typeId];
    const body = bodyOf(def);
    const t = this.teamById[team];
    const u = {
      id: this.uid++, team, alliance: t.alliance, def, role: def.role, typeId,
      isLeader: def.role === 'leader', isPlayer: !!opts.isPlayer,
      x, z, y: 0, vx: 0, vz: 0, yaw: t.fort.rot, pitch: 0, speed: 0,
      radius: body.r, height: body.h,
      hp: def.hp * (FACTIONS[team].power || 1), maxHp: def.hp * (FACTIONS[team].power || 1), alive: true, deadT: 0,
      mounted: def.mounted, siege: ['siege', 'ram', 'tower'].includes(def.role),
      weapons: def.weapons.map((w) => WEAPONS[w]), wi: 0,
      ammo: def.weapons.map((w) => WEAPONS[w].ammo ?? Infinity),
      cd: this.rng() * 0.5, windup: 0, pending: null, sprayT: 0,
      anim: 'idle', animT: this.rng() * 10, attackT: 9, hitT: 9, gait: 0,
      squad: null, ai: { thinkT: this.rng() * 0.5, target: null, struct: null, mode: 'order', passT: 0, stuckT: 0, lx: x, lz: z, reactT: 0 },
      post: null, climb: null, wall: null, blockedBy: null, vy: 0, airT: 0, mountAnim: null, mountT: def.mounted ? 1 : 0,
      buff: { dmg: 0, def: 0, speed: 0, until: 0 }, aura: null, burnT: 0, burnBy: null,
      kills: 0, dmgDealt: 0, lastAttackT: -99, lastHurtT: -99, spawnT: this.time,
      variant: Math.floor(this.rng() * 1000),
    };
    this.units.push(u);
    t.units++;
    if (!u.siege) t.soldiers++;
    return u;
  }

  _spawnInitial() {
    for (const t of this.teams) {
      this.spawnLeader(t);
      this.recruit(t, t.cap - t.soldiers, true);
      // belegeringstuig staat vanaf het begin klaar (geen nieuwe bouw tijdens het potje)
      const kinds = t.faction.siege.slice(0, 3);
      kinds.forEach((type, i) => {
        const y = t.fort.siegeYard;
        const u = this.createUnit(type, t.id, y.x + (i - 1) * 7 * Math.cos(t.fort.rot), y.z - (i - 1) * 7 * Math.sin(t.fort.rot));
        u.yaw = t.fort.rot;
        this.makeSquad(t, [u], { kind: 'siege' });
      });
    }
    if (this.settings.withPlayer !== false && this.settings.playerTeam) this.spawnPlayer();
  }

  spawnPoint(t, k = 0) {
    const sp = t.fort.spawn[k % t.fort.spawn.length];
    return [sp.x + (this.rng() - 0.5) * 6, sp.z + (this.rng() - 0.5) * 6];
  }

  spawnLeader(t) {
    const L = LEADERS[t.id];
    const [x, z] = this.spawnPoint(t, 2);
    const leader = this.createUnit(L.unit, t.id, x, z);
    leader.cryCd = 15;
    t.leader = leader;
    // lijfwacht + vaandeldrager (een bestaande lijfwacht gaat mee met de nieuwe leider)
    let sq = this.squads.find((q) => q.team === t.id && q.order.kind === 'guard' && q.members.some((m) => m.alive));
    if (!sq) sq = this.makeSquad(t, [], { kind: 'guard', leader });
    sq.order.leader = leader;
    sq.members = sq.members.filter((m) => m.alive);
    while (sq.members.length < 4) {
      const [gx, gz] = this.spawnPoint(t, 3 + sq.members.length);
      const g = this.createUnit(L.guard, t.id, gx, gz);
      g.squad = sq;
      sq.members.push(g);
    }
    if (!sq.members.some((m) => m.banner)) sq.members[0].banner = true;
    sq.type = sq.members[0].def;
    if (this.player && this.player.team === t.id && this.player.isLeader) return leader;
    return leader;
  }

  // Speler aan het begin: neemt een bestaande soldaat van het gekozen type over (het leger groeit niet).
  spawnPlayer() {
    const s = this.settings;
    const t = this.teamById[s.playerTeam];
    if (!t || !t.alive) return null;
    const u = UNITS[s.playerUnit]?.role === 'leader' && t.leader?.alive ? t.leader : this.pickBot(t.id, s.playerUnit) || this.pickBot(t.id, null);
    return this.takeOver(u);
  }

  // Levende bots per eenheidstype (voor het keuzescherm na het sneuvelen)
  roleCounts(teamId) {
    const c = {};
    for (const u of this.units) if (u.alive && u.team === teamId && !u.siege && !u.isPlayer) c[u.typeId] = (c[u.typeId] || 0) + 1;
    return c;
  }

  // Dichtstbijzijnde levende bot van een type (of elk type) bij de vorige positie van de speler
  pickBot(teamId, typeId) {
    const t = this.teamById[teamId];
    const ref = this.player && this.player.team === teamId ? this.player : t.fort.keep;
    let best = null;
    let bd = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.team !== teamId || u.siege || u.isPlayer || u.climb) continue;
      if (typeId && u.typeId !== typeId) continue;
      const d = Math.hypot(u.x - ref.x, u.z - ref.z);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  // De speler neemt het lichaam van een levende bot over
  takeOver(u) {
    if (!u || !u.alive) return null;
    if (this.player && this.player !== u) this.player.isPlayer = false;
    if (u.squad) {
      const m = u.squad.members;
      const k = m.indexOf(u);
      if (k >= 0) m.splice(k, 1);
      u.squad = null;
    }
    if (u.ai) u.ai.target = null;
    u.isPlayer = true;
    if (u.isLeader) u.cryCd = Math.min(u.cryCd || 0, this.time);
    this.player = u;
    this.events.push({ t: 'takeover', u });
    return u;
  }

  // Kies eenheidstypes volgens de factiemix en vorm groepjes (squads).
  recruit(t, count, free = false) {
    const fac = t.faction;
    let spawned = 0;
    let guard = 0;
    while (spawned < count && guard++ < 200) {
      // type kiezen volgens de gewenste mix t.o.v. huidige aantallen
      const alive = {};
      for (const u of this.units) if (u.alive && u.team === t.id) alive[u.typeId] = (alive[u.typeId] || 0) + 1;
      let bestType = null;
      let bestScore = -Infinity;
      const total = Object.values(alive).reduce((a, b) => a + b, 0) + 1;
      for (const [type, share] of Object.entries(fac.mix)) {
        const score = share - (alive[type] || 0) / total + this.rng() * 0.08;
        if (score > bestScore) {
          bestScore = score;
          bestType = type;
        }
      }
      const def = UNITS[bestType];
      const size = Math.min(count - spawned, def.mounted ? 5 : 8);
      const affordable = free ? size : Math.min(size, Math.floor(t.manpower / def.cost));
      if (affordable < Math.min(size, free ? 1 : 3)) break;
      const members = [];
      for (let i = 0; i < affordable; i++) {
        const [x, z] = this.spawnPoint(t, spawned + i);
        members.push(this.createUnit(bestType, t.id, x, z));
      }
      if (!free) t.manpower -= affordable * def.cost;
      spawned += affordable;
      this.makeSquad(t, members, { kind: 'rally' });
    }
    return spawned;
  }

  makeSquad(t, members, order) {
    const sq = { id: this.squads.length + 1, team: t.id, members, order, type: members[0]?.def, formT: 0, anchor: null };
    for (const m of members) m.squad = sq;
    this.squads.push(sq);
    return sq;
  }

  // ------------------------------------------------------------------ velden
  // Geeft het (eventueel nog verouderde) veld terug; ontbrekende of verouderde velden
  // worden op de achtergrond (verdeeld over frames) berekend. Kan null geven.
  field(key, alliance) {
    const k = key + '|' + alliance;
    const f = this.nav.fields.get(k);
    if (f && f.version === this.nav.version) return f;
    if (!this.fieldJobs.has(k) || this.fieldJobs.get(k).version !== this.nav.version) {
      this.fieldJobs.set(k, this.nav.startJob(k, this._goals(key), alliance, this.allianceOf));
    }
    return f || null;
  }

  _computeField(key, alliance) {
    return this.nav.compute(key + '|' + alliance, this._goals(key), alliance, this.allianceOf);
  }

  // Velden die zeker nodig zijn alvast berekenen (tijdens het laden)
  _precomputeFields() {
    const allis = [...new Set(this.teams.map((t) => t.alliance))];
    for (const a of allis) {
      for (const t of this.teams) {
        if (t.alliance === a) {
          this._computeField('home:' + t.id, a);
          this._computeField('rally:' + t.id, a);
        } else this._computeField('keep:' + t.id, a);
      }
    }
  }

  _goals(key) {
    const [kind, arg] = key.split(':');
    let goals;
    if (kind === 'keep') {
      const f = this.teamById[arg].fort;
      goals = [[f.keep.x, f.keep.z, f.keep.r - 0.5]];
    } else if (kind === 'cp') {
      const c = this.map.capturePoints[+arg];
      goals = [[c.x, c.z, c.r * 0.8]];
    } else if (kind === 'home') {
      const f = this.teamById[arg].fort;
      goals = [[f.inside.x, f.inside.z, 7]];
    } else if (kind === 'rally') {
      const f = this.teamById[arg].fort;
      goals = [[f.rally.x, f.rally.z, 7]];
    } else if (kind === 'gate') {
      const f = this.teamById[arg].fort;
      const g = f.gates.find((gg) => !gg.destroyed) || f.gate;
      goals = [[g.x, g.z, 5]];
    }
    return goals;
  }

  // ------------------------------------------------------------------ hoofdlus
  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.tick++;
    // navigatievelden op de achtergrond bijwerken (max ±12k cellen per frame)
    for (const [k, job] of this.fieldJobs) {
      if (job.version !== this.nav.version) {
        this.fieldJobs.delete(k);
        continue;
      }
      if (this.nav.runJob(job, 12000)) this.fieldJobs.delete(k);
      break;
    }
    this.unitGrid.rebuild(this.units);

    for (const c of this.commanders) if (c.team.alive) c.update(dt);
    if (this.tick % 15 === 0) this._updateAuras();

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive) {
        u.deadT += dt;
        continue;
      }
      if (u.isPlayer) this._playerControl(u, dt);
      else {
        u.ai.thinkT -= dt;
        if (u.ai.thinkT <= 0) {
          u.ai.thinkT = 0.3 + this.rng() * 0.25;
          unitThink(this, u);
        }
        unitSteer(this, u, dt);
      }
      this._combatTick(u, dt);
      this._move(u, dt);
      this._animTick(u, dt);
    }
    this._updateHorses(dt);
    this._updateProjectiles(dt);
    if (this.tick % 6 === 0) this._updateCapture(dt * 6);
    this._morale(dt);
    if (this.tick % 60 === 0) this._cleanup();
    this._checkVictory();
  }

  // ------------------------------------------------------------------ speler
  _playerControl(u, dt) {
    const inp = this.input;
    if (!inp) return;
    if (u.mountAnim) {
      // tijdens op/afstijgen geen besturing
      u.dvx = u.dvz = 0;
      u.yaw = u.mountAnim.yaw;
      inp.climb = inp.jump = false;
      return;
    }
    if (u.post && !u.post.walk) {
      // op een toren/poortpost: draaien en schieten; bewegen of E = afdalen
      if (Math.hypot(inp.mx, inp.mz) > 0.5 || inp.climb) {
        inp.climb = false;
        this.leavePost(u);
      }
      u.yaw = inp.yaw;
      u.pitch = inp.pitch;
      u.dvx = 0;
      u.dvz = 0;
    } else if (u.wall) {
      // op de weergang: vrij lopen langs de muur
      if (u.post && Math.hypot(inp.mx, inp.mz) > 0.3) {
        u.post.occupant = null;
        u.post = null;
      }
      const sp = this.speedOf(u) * (inp.sprint ? 1.1 : 0.75);
      u.dvx = inp.mx * sp;
      u.dvz = inp.mz * sp;
      u.yaw = inp.yaw;
      u.pitch = inp.pitch;
      if (inp.climb) {
        inp.climb = false;
        const l = this.nearestLadder(u);
        if (l) this.climbDown(u, l);
      }
    } else if (u.mounted) {
      const mag = Math.min(1, Math.hypot(inp.mx, inp.mz));
      u.dvx = inp.mx;
      u.dvz = inp.mz;
      u.dmag = mag * (inp.sprint ? 1.15 : 1);
      u.lookYaw = inp.yaw;
      u.pitch = inp.pitch;
    } else {
      const sp = this.speedOf(u) * (inp.sprint ? 1.25 : 0.85);
      u.dvx = inp.mx * sp;
      u.dvz = inp.mz * sp;
      u.yaw = inp.yaw;
      u.pitch = inp.pitch;
    }
    if (inp.switchWeapon) {
      inp.switchWeapon = false;
      if (u.weapons.length > 1) u.wi = u.wi ? 0 : 1;
      this.events.push({ t: 'switch', u });
    }
    if (inp.selectWeapon != null) {
      if (u.weapons[inp.selectWeapon]) u.wi = inp.selectWeapon;
      inp.selectWeapon = null;
    }
    if (inp.cry) {
      inp.cry = false;
      if (u.isLeader) this.battleCry(u);
    }
    if (inp.jump) {
      inp.jump = false;
      this.jump(u);
    }
    if (inp.climb) {
      inp.climb = false;
      if (u.mounted && !u.mountAnim) this.dismount(u);
      else if (!u.post && !u.wall && !u.siege && !u.mountAnim) {
        // dichtstbijzijnde: een losse paard of een ladder
        const h = this.nearestFreeHorse(u, 2.8);
        const p = this.nearestFreePost(u, 3.5);
        if (h && (!p || Math.hypot(h.x - u.x, h.z - u.z) < Math.hypot(p.footX - u.x, p.footZ - u.z))) this.mount(u, h);
        else if (p) this.takePost(u, p);
      }
    }
    if (inp.attack) {
      const w = u.weapons[u.wi];
      if (!w) { /* geen wapen */ } else if (w.kind === 'melee') this.startMelee(u, null);
      else if (w.kind === 'spray') this.startSpray(u);
      else if (inp.aim) this.shoot(u, inp.aim.x, inp.aim.y, inp.aim.z, 1);
    }
  }

  // ------------------------------------------------------------------ beweging
  speedOf(u) {
    // ruiter te voet loopt als voetvolk; voetvolk op een paard rijdt als een lichte ruiter
    let s = u.mounted ? (u.def.mounted ? u.def.speed : 10.5) : u.def.mounted ? 4.3 : u.def.speed;
    const t = this.teamById[u.team];
    s *= 1 + (u.aura?.speed || 0) + (u.buff.until > this.time ? u.buff.speed : 0);
    s *= 0.9 + t.morale / 1000;
    if (u.burnT > 0) s *= 1.15;
    return s;
  }

  _move(u, dt) {
    if (u.climb) {
      // op of af de muur klimmen
      const c = u.climb;
      c.t += dt / c.dur;
      const k = Math.min(1, c.t);
      u.x = c.x0 + (c.x1 - c.x0) * k;
      u.z = c.z0 + (c.z1 - c.z0) * k;
      u.y = c.y0 + (c.y1 - c.y0) * k;
      u.speed = 1;
      if (k >= 1) {
        u.climb = null;
        if (c.toPost) {
          u.post = c.toPost;
          u.yaw = c.toPost.faceYaw;
          if (c.toPost.walk) u.wall = { walk: c.toPost.walk, a: c.toPost.along, o: -c.toPost.walk.out * 0.1 };
        }
      }
      return;
    }
    if (u.post) {
      u.x = u.post.x;
      u.z = u.post.z;
      u.y = u.post.y;
      u.vx = u.vz = 0;
      u.speed = 0;
      return;
    }
    if (u.wall) {
      this._moveOnWall(u, dt);
      return;
    }
    if (u.mountAnim) {
      u.vx = u.vz = 0;
      u.speed = 0;
      return;
    }

    let tx = u.dvx || 0;
    let tz = u.dvz || 0;
    if (u.mounted) {
      // paard: draait geleidelijk en kan niet zijwaarts
      const mag = u.dmag ?? Math.min(1, Math.hypot(tx, tz));
      let target = 0;
      if (mag > 0.08) {
        const want = Math.atan2(tx, tz);
        const d = angleDiff(u.yaw, want);
        u.yaw += clamp(d, -2.4 * dt, 2.4 * dt);
        target = this.speedOf(u) * mag * (Math.abs(d) > 1.8 ? 0.35 : 1);
      }
      u.speed += clamp(target - u.speed, -12 * dt, 5 * dt);
      tx = Math.sin(u.yaw) * u.speed;
      tz = Math.cos(u.yaw) * u.speed;
      u.vx = tx;
      u.vz = tz;
      u.dmag = undefined;
    } else {
      const acc = u.siege ? 2 : u.airT > 0 ? 1.2 : 12;
      u.vx += (tx - u.vx) * Math.min(1, acc * dt);
      u.vz += (tz - u.vz) * Math.min(1, acc * dt);
      u.speed = Math.hypot(u.vx, u.vz);
      if (u.siege && u.speed > 0.2) u.yaw = turnTowards(u.yaw, Math.atan2(u.vx, u.vz), 0.8 * dt);
    }
    // gracht vertraagt
    const f = this._fortNear(u.x, u.z);
    let slow = 1;
    if (f && f.byz) {
      for (const m of this.map.moats) if (pointInside(m, u.x, u.z)) slow = 0.4;
    }
    const px = u.x;
    const pz = u.z;
    u.x += u.vx * dt * slow;
    u.z += u.vz * dt * slow;

    // eenheden duwen elkaar weg
    const r = u.radius;
    const self = u;
    this.unitGrid.query(u.x, u.z, r + 3.1, (o) => {
      if (o === self || o.post || o.climb || Math.abs(o.y - self.y) > 1.5) return false;
      if (o.docked && o.alliance === self.alliance) return false;
      const dx = self.x - o.x;
      const dz = self.z - o.z;
      const rr = r + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-6) return false;
      if (Math.abs(self.y - o.y) > 2) return false;
      const d = Math.sqrt(d2);
      // zware eenheden wijken minder
      const wSelf = self.siege ? 0.1 : self.mounted ? 0.35 : 0.5;
      const wOther = o.siege ? 2 : 1;
      const push = (rr - d) * Math.min(1, wSelf * wOther);
      self.x += (dx / d) * push;
      self.z += (dz / d) * push;
      // ruiters in galop vertrappen vijandelijk voetvolk
      if (self.mounted && self.speed > 6.5 && o.alliance !== self.alliance && !o.mounted && !o.siege) this._trample(self, o);
      return false;
    });

    // obstakels
    u.blockedBy = null;
    const uy = u.y;
    const ally = u.alliance;
    this.obGrid.near(u.x, u.z, r + 1, (o) => {
      if (o.y0 > uy + 1.9 || o.y1 < uy + 0.3) return;
      const st = o.struct;
      if (st) {
        if (st.gate && st.alliance === ally) return; // eigen poort gaat open
        if (st.dock && st.dock.alliance === ally && this._inDockWindow(st, u)) return;
      }
      const p = pushCircle(o, u.x, u.z, r);
      if (p) {
        u.x = p[0];
        u.z = p[1];
        if (st && st.alliance !== ally) u.blockedBy = st;
      }
    });
    // muur beklimmen via een aangelegde belegeringstoren
    const airY = u.y;
    u.y = 0;
    if (u.ai.dockSt) {
      const st = u.ai.dockSt;
      if (st.destroyed || !st.dock) u.ai.dockSt = null;
      else if (this._inDockWindow(st, u)) {
        const [, lz] = toLocal(st.ob, u.x, u.z);
        const k = clamp(1 - (Math.abs(lz) - st.ob.hz) / 3, 0, 1);
        u.y = st.h * k;
        // bovenop de muur: de helft blijft op de weergang om de verdedigers daar te bevechten
        if (k > 0.98 && u.id % 2 === 0) {
          const walk = st.fort.walks.find((w) => w.pieces.some((q) => q.st === st));
          if (walk) {
            const c = Math.cos(walk.fort.rot);
            const sn = Math.sin(walk.fort.rot);
            const dx = u.x - walk.fort.cx;
            const dz = u.z - walk.fort.cz;
            const lu = c * dx - sn * dz;
            const lv = sn * dx + c * dz;
            u.wall = { walk, a: walk.axis === 'u' ? lu : lv, o: 0 };
            u.y = walk.h;
            u.ai.dockSt = null;
          }
        }
      }
    }
    // springen: zwaartekracht tot de grond
    if (u.airT > 0) {
      u.vy -= 14 * dt;
      const ny = airY + u.vy * dt;
      u.airT += dt;
      if (ny <= u.y) {
        u.vy = 0;
        u.airT = 0;
        this.events.push({ t: 'land', u });
      } else u.y = ny;
    }
    // binnen de kaart blijven
    const d = Math.hypot(u.x, u.z);
    const lim = this.map.radius - 2;
    if (d > lim) {
      u.x *= lim / d;
      u.z *= lim / d;
    }
    if (!u.mounted) {
      const moved = Math.hypot(u.x - px, u.z - pz) / Math.max(dt, 1e-4);
      u.speed = Math.min(u.speed, moved);
    }
  }

  _inDockWindow(st, u) {
    const [lx] = toLocal(st.ob, u.x, u.z);
    const [dlx] = toLocal(st.ob, st.dock.x, st.dock.z);
    return Math.abs(lx - dlx) < 2.6;
  }

  _fortNear(x, z) {
    for (const f of this.map.forts) if (Math.abs(x - f.cx) < f.extent + 4 && Math.abs(z - f.cz) < f.extent + 4) return f;
    return null;
  }

  _trample(rider, victim) {
    victim._trampleT = victim._trampleT || 0;
    if (this.time - victim._trampleT < 1.2) return;
    victim._trampleT = this.time;
    this.damageUnit(victim, 24, 'blunt', rider, { trample: true });
  }

  // ------------------------------------------------------------------ gevecht
  _combatTick(u, dt) {
    if (u.cd > 0) u.cd -= dt * (1 + (u.aura?.reload || 0));
    if (u.burnT > 0) {
      u.burnT -= dt;
      u._burnAcc = (u._burnAcc || 0) + dt;
      if (u._burnAcc > 0.5) {
        u._burnAcc = 0;
        this.damageUnit(u, 5, 'fire', u.burnBy, { dot: true });
      }
    }
    if (u.windup > 0) {
      u.windup -= dt;
      if (u.windup <= 0 && u.alive) this._resolveMelee(u);
    }
    if (u.sprayT > 0) {
      u.sprayT -= dt;
      u._sprayAcc = (u._sprayAcc || 0) + dt;
      if (u._sprayAcc >= 0.2) {
        u._sprayAcc = 0;
        this._sprayTick(u);
      }
    }
  }

  startMelee(u, target) {
    const w = u.weapons[u.wi];
    if (u.cd > 0 || u.windup > 0 || w.kind !== 'melee') return false;
    u.windup = w.windup;
    u.cd = w.cooldown;
    u.pending = target;
    u.attackT = 0;
    u.attackKind = w.anim;
    u.lastAttackT = this.time;
    this.events.push({ t: 'swing', u, w });
    return true;
  }

  _resolveMelee(u) {
    const w = u.weapons[u.wi];
    const tgt = u.pending;
    u.pending = null;
    // bouwwerk (poort/muur) of belegeringsdoel
    if (tgt && tgt.ob) {
      const st = tgt;
      if (st.destroyed) return;
      const [lx, lz] = toLocal(st.ob, u.x, u.z);
      const ox = Math.max(0, Math.abs(lx) - st.ob.hx);
      const oz = Math.max(0, Math.abs(lz) - st.ob.hz);
      if (Math.hypot(ox, oz) <= w.reach + u.radius) this.damageStruct(st, w.damage * (w.structMult || 1), w.dmg, u);
      return;
    }
    if (w.structOnly) return;
    const reach = w.reach + (u.mounted ? 0.6 : 0);
    const arc = w.anim === 'thrust' || w.anim === 'couch' ? 0.45 : 0.9;
    const maxHits = w.anim === 'thrust' || w.anim === 'couch' ? 1 : 2;
    const fx = Math.sin(u.yaw);
    const fz = Math.cos(u.yaw);
    const hits = [];
    this.unitGrid.query(u.x, u.z, reach + 3.2, (e) => {
      if (e.alliance === u.alliance || !e.alive) return false;
      const dx = e.x - u.x;
      const dz = e.z - u.z;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > reach) return false;
      if (Math.abs(e.y - u.y) > 2.2) return false;
      if (d > 0.7 && (dx * fx + dz * fz) / d < Math.cos(arc)) return false;
      hits.push([d, e]);
      return false;
    });
    hits.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, e] of hits) {
      if (n++ >= maxHits) break;
      let dmg = w.damage;
      const opts = { melee: true };
      if (w.antiCav && e.mounted) dmg *= w.antiCav;
      if (w.charge && u.mounted && u.speed > 6.5) {
        // charge met de lans — maar niet tegen gezette speren van voren
        const braced = (e.role === 'spear' || e.weapons[e.wi]?.antiCav) && this._facing(e, u) > 0.5;
        dmg *= braced ? 0.6 : w.charge;
        opts.charge = !braced;
        if (braced) this.damageUnit(u, 30 * (e.weapons[e.wi]?.antiCav || 2), 'pierce', e, { melee: true });
      }
      this.damageUnit(e, dmg, w.dmg, u, opts);
    }
  }

  // hoe recht kijkt a naar b (−1..1)
  _facing(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    return (Math.sin(a.yaw) * dx + Math.cos(a.yaw) * dz) / d;
  }

  startSpray(u) {
    const w = u.weapons[u.wi];
    if (u.cd > 0 || w.kind !== 'spray' || u.ammo[u.wi] <= 0) return false;
    u.cd = w.cooldown;
    u.sprayT = w.duration;
    u.ammo[u.wi]--;
    u.attackT = 0;
    u.attackKind = 'siphon';
    u.lastAttackT = this.time;
    this.events.push({ t: 'fire', u });
    return true;
  }

  _sprayTick(u) {
    const w = u.weapons[u.wi];
    const fx = Math.sin(u.yaw);
    const fz = Math.cos(u.yaw);
    this.unitGrid.query(u.x + fx * w.range * 0.5, u.z + fz * w.range * 0.5, w.range * 0.6 + 2, (e) => {
      if (e.alliance === u.alliance || !e.alive) return false;
      const dx = e.x - u.x;
      const dz = e.z - u.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + e.radius || d < 0.1) return false;
      if ((dx * fx + dz * fz) / d < Math.cos(w.cone)) return false;
      this.damageUnit(e, w.damage, 'fire', u, {});
      if (!e.siege) {
        e.burnT = w.burn;
        e.burnBy = u;
      }
      return false;
    });
    // ook houten poorten en belegeringstuig vatten vlam
    this.obGrid.near(u.x + fx * w.range * 0.6, u.z + fz * w.range * 0.6, w.range * 0.5, (o) => {
      if (o.struct && o.struct.material === 'wood' && o.struct.alliance !== u.alliance) this.damageStruct(o.struct, w.damage, 'fire', u);
    });
  }

  // Schiet met het actieve afstandswapen op een punt.
  shoot(u, tx, ty, tz, accuracyMult = 1) {
    const w = u.weapons[u.wi];
    if (u.cd > 0 || (w.kind !== 'ranged' && w.kind !== 'thrown' && w.kind !== 'siege')) return false;
    if (u.ammo[u.wi] <= 0) return false;
    const ox = u.x + Math.sin(u.yaw) * (u.siege ? 2.5 : 0.4);
    const oz = u.z + Math.cos(u.yaw) * (u.siege ? 2.5 : 0.4);
    const oy = u.y + (u.siege ? (w.lob ? 5 : 1.4) : u.mounted ? 2.4 : 1.45);
    const dir = ballistic(ox, oy, oz, tx, ty, tz, w.speed, GRAVITY, !!w.lob);
    let spread = w.spread * accuracyMult * (1 - (u.aura?.accuracy || 0));
    if (u.speed > 1.5 && !u.siege) spread *= 1.8;
    dir.x += (this.rng() - 0.5) * 2 * spread;
    dir.y += (this.rng() - 0.5) * 2 * spread;
    dir.z += (this.rng() - 0.5) * 2 * spread;
    const l = Math.hypot(dir.x, dir.y, dir.z);
    this.projectiles.push({
      kind: w.proj, x: ox, y: oy, z: oz,
      vx: (dir.x / l) * w.speed, vy: (dir.y / l) * w.speed, vz: (dir.z / l) * w.speed,
      owner: u, team: u.team, alliance: u.alliance, w, life: w.lob ? 12 : 6, alive: true,
    });
    u.ammo[u.wi]--;
    u.cd = w.cooldown;
    u.attackT = 0;
    u.attackKind = w.anim;
    u.lastAttackT = this.time;
    this.events.push({ t: 'shoot', u, w, x: ox, y: oy, z: oz });
    return true;
  }

  _updateProjectiles(dt) {
    const P = this.projectiles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      p.vy -= GRAVITY * dt;
      const sx = p.vx * dt;
      const sy = p.vy * dt;
      const sz = p.vz * dt;
      const len = Math.hypot(sx, sy, sz);
      const dx = sx / len;
      const dy = sy / len;
      const dz = sz / len;
      // eerste obstakel
      const ally = p.alliance;
      const siegeShot = p.w.kind === 'siege';
      const hitOb = this.obGrid.raycast(p.x, p.y, p.z, dx, dy, dz, len, (o) => {
        if (siegeShot) return !!o.struct || o.kind === 'keep' || o.kind === 'lintel';
        return !(o.struct && o.struct.alliance === ally && o.struct.gate && p.y > 4);
      });
      let tEnd = hitOb ? hitOb.t : len;
      let ground = false;
      if (dy < 0 && p.y + dy * tEnd <= 0) {
        tEnd = -p.y / dy;
        ground = true;
      }
      // eenheden
      let hitU = null;
      let hitT = tEnd;
      const mx = p.x + dx * len * 0.5;
      const mz = p.z + dz * len * 0.5;
      const owner = p.owner;
      this.unitGrid.query(mx, mz, len * 0.5 + 3.2, (u) => {
        if (u.alliance === ally || u === owner) return false;
        const ox = p.x - u.x;
        const oz = p.z - u.z;
        const a = dx * dx + dz * dz;
        if (a < 1e-9) return false;
        const b = 2 * (ox * dx + oz * dz);
        const c = ox * ox + oz * oz - u.radius * u.radius;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return false;
        const sq = Math.sqrt(disc);
        let t = (-b - sq) / (2 * a);
        if (t < 0) t = (-b + sq) / (2 * a);
        if (t < 0 || t >= hitT) return false;
        const y = p.y + dy * t - u.y;
        if (y < 0 || y > u.height) return false;
        hitU = u;
        hitT = t;
        return false;
      });
      const w = p.w;
      if (hitU) {
        const hx = p.x + dx * hitT;
        const hy = p.y + dy * hitT;
        const hz = p.z + dz * hitT;
        if (w.kind === 'siege') this._siegeImpact(p, hx, hy, hz, null);
        else {
          const head = !hitU.mounted && !hitU.siege && hy - hitU.y > hitU.height - 0.32;
          this.damageUnit(hitU, w.damage, w.dmg, p.owner, { head, proj: true, dirx: dx, dirz: dz });
          this.events.push({ t: 'phit', x: hx, y: hy, z: hz, u: hitU, kind: p.kind });
        }
        P.splice(i, 1);
        continue;
      }
      if (hitOb || ground) {
        const hx = p.x + dx * tEnd;
        const hy = Math.max(0, p.y + dy * tEnd);
        const hz = p.z + dz * tEnd;
        if (w.kind === 'siege') this._siegeImpact(p, hx, hy, hz, hitOb?.o?.struct || null);
        else {
          if (hitOb?.o?.struct && hitOb.o.struct.alliance !== ally) this.damageStruct(hitOb.o.struct, w.damage, w.dmg, p.owner);
          this.events.push({ t: 'stick', x: hx, y: hy, z: hz, dx, dy, dz, kind: p.kind, ground });
        }
        P.splice(i, 1);
        continue;
      }
      p.x += sx;
      p.y += sy;
      p.z += sz;
      if (p.life <= 0 || Math.abs(p.x) > this.map.half || Math.abs(p.z) > this.map.half) P.splice(i, 1);
    }
  }

  _siegeImpact(p, x, y, z, struct) {
    const w = p.w;
    if (struct && struct.alliance !== p.alliance) this.damageStruct(struct, w.damage, 'siege', p.owner);
    else {
      // ook een bijna-treffer beschadigt nabije muren een beetje
      this.obGrid.near(x, z, w.splash, (o) => {
        if (o.struct && o.struct.alliance !== p.alliance && !o.struct.destroyed) this.damageStruct(o.struct, w.damage * 0.35, 'siege', p.owner);
      });
    }
    this.unitGrid.query(x, z, w.splash + 1, (u) => {
      if (u.alliance === p.alliance || Math.abs(u.y - y) > 4) return false;
      const d = Math.hypot(u.x - x, u.z - z);
      const k = 1 - d / (w.splash + 1);
      if (k > 0) this.damageUnit(u, w.unitDamage * k, 'siege', p.owner, { splash: true });
      return false;
    });
    this.events.push({ t: 'impact', x, y, z, kind: p.kind, struct: !!struct });
  }

  // Schade aan een eenheid, met pantser, schild, aura's, moreel en moeilijkheid.
  damageUnit(e, base, type, attacker, opts = {}) {
    if (!e.alive) return 0;
    if (this.time - e.spawnT < 2 && !opts.dot) return 0; // korte bescherming na het verschijnen
    let mult;
    if (e.siege) mult = SIEGE_VULN[type] ?? 1;
    else mult = ARMOR[e.def.armor][type] ?? 1;
    if (attacker) {
      const at = this.teamById[attacker.team];
      mult *= 1 + (attacker.aura?.dmg || 0) + (attacker.buff.until > this.time ? attacker.buff.dmg : 0);
      mult *= 0.85 + (0.3 * at.morale) / 100;
    }
    mult *= 1 - Math.min(0.6, (e.aura?.def || 0) + (e.buff.until > this.time ? e.buff.def : 0));
    // verschanst: verdedigers in hun eigen fort of op de muur zijn beter beschermd
    if (!e.siege && (e.post || e.wall || regionOf(this.map, e.x, e.z) === e.team)) mult *= 0.78;
    // schild vangt aanvallen van voren op
    if (e.def.shield && attacker && !opts.dot && !opts.splash) {
      const facing = this._facing(e, attacker);
      if (facing > 0.35) {
        const ranged = opts.proj;
        if (e.def.shield === 'pavise') mult *= ranged ? (e.speed < 0.5 && e.weapons[e.wi].kind === 'ranged' ? 0.42 : 0.7) : 0.85;
        else mult *= ranged ? 0.5 : 0.78;
        opts.blocked = true;
      }
    }
    if (opts.head) mult *= 1.6;
    if (e.isPlayer && attacker && !attacker.isPlayer) mult *= this.diff.toPlayer;
    // vast leger: gevechten duren langer (eenheden halen meer klappen)
    const dmg = base * mult * UNIT_DMG;
    e.hp -= dmg;
    e.lastHurtT = this.time;
    e.hitT = 0;
    if (attacker) {
      attacker.dmgDealt += dmg;
      if (!e.isPlayer && e.ai && attacker.alive && attacker.alliance !== e.alliance) {
        if (!e.ai.target || this.rng() < 0.35) e.ai.target = attacker;
      }
    }
    this.events.push({ t: 'hurt', u: e, by: attacker, dmg, blocked: !!opts.blocked, head: !!opts.head, melee: !!opts.melee, charge: !!opts.charge, type });
    if (e.hp <= 0) this.kill(e, attacker, opts);
    return dmg;
  }

  kill(u, attacker, opts = {}) {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    u.deadT = 0;
    u.windup = 0;
    u.sprayT = 0;
    if (u.post) {
      u.post.occupant = null;
      u.post = null;
    }
    u.climb = null;
    u.wall = null;
    if (u.mountAnim) {
      u.mounted = u.mountAnim.dir < 0;
      u.mountAnim = null;
    }
    if (u.mounted && !opts.rout && !u.siege && this.rng() < 0.55) {
      // het paard overleeft en blijft zonder ruiter staan; de ruiter valt eraf
      this._freeHorse(u.x + Math.cos(u.yaw) * 0.6, u.z - Math.sin(u.yaw) * 0.6, u.yaw, u.def.faction, u.variant, u.isLeader);
      u.mounted = false;
      u.fellOff = true;
    }
    const t = this.teamById[u.team];
    t.units--;
    if (!u.siege) t.soldiers--;
    t.stats.losses++;
    t.morale -= u.isLeader ? 0 : 0.12;
    if (attacker && attacker.team !== u.team) {
      attacker.kills++;
      const at = this.teamById[attacker.team];
      at.stats.kills++;
      at.morale += 0.15;
      if (u.isLeader) at.stats.leaderKills++;
    }
    if (u.squad) {
      const m = u.squad.members;
      const k = m.indexOf(u);
      if (k >= 0) m.splice(k, 1);
      u.squad = null;
    }
    if (u.isLeader) {
      t.leaderDeaths++;
      t.morale -= 30;
      // schok: tijdelijk minder schade voor het hele team
      for (const o of this.units) if (o.alive && o.team === u.team) o.buff = { dmg: -0.15, def: -0.1, speed: 0, until: this.time + 30 };
      this.events.push({ t: 'leaderDown', team: u.team, u, by: attacker });
    }
    this.events.push({ t: 'kill', u, by: attacker, head: !!opts.head, rout: !!opts.rout });
  }

  damageStruct(st, base, type, attacker) {
    if (st.destroyed) return 0;
    const dmg = base * (STRUCT[st.material][type] ?? 0);
    if (dmg <= 0) return 0;
    st.hp -= dmg;
    st.lastHitT = this.time;
    if (attacker) {
      this.teamById[attacker.team].stats.structDmg += dmg;
      attacker.dmgDealt += dmg * 0.1;
    }
    this.events.push({ t: 'structHit', st, dmg, type });
    if (st.hp <= 0) this.destroyStruct(st, attacker);
    return dmg;
  }

  destroyStruct(st, attacker) {
    st.destroyed = true;
    st.hp = 0;
    st.ob.active = false;
    st.dock = null;
    this.nav.invalidate();
    const fort = st.fort;
    if (!fort.breached) fort.breachedAt = this.time;
    fort.breached = true;
    const owner = this.teamById[st.team];
    owner.morale -= st.gate ? 10 : 8;
    if (attacker) this.teamById[attacker.team].morale += 8;
    // verdedigers op dit stuk muur vallen naar beneden
    for (const p of fort.posts) {
      if (p.struct !== st || !p.occupant) continue;
      const u = p.occupant;
      p.occupant = null;
      u.post = null;
      u.x = p.footX;
      u.z = p.footZ;
      u.y = 0;
      this.damageUnit(u, 45, 'blunt', attacker, { dot: true });
    }
    if (this.phase < 2) {
      this.phase = 2;
      this.events.push({ t: 'phase', n: 2 });
    }
    this.events.push({ t: 'structDestroyed', st, by: attacker });
  }

  // ------------------------------------------------------------------ muurposten
  nearestFreePost(u, maxD = 60) {
    const f = this.teamById[u.team].fort;
    let best = null;
    let bd = maxD;
    for (const p of f.posts) {
      if (p.occupant || p.struct.destroyed) continue;
      if (!u.isPlayer && p.reserved && p.reserved !== u && p.reserved.alive && p.reserved.ai?.post === p) continue;
      const d = Math.hypot(p.footX - u.x, p.footZ - u.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  takePost(u, p) {
    if (p.occupant) return false;
    p.occupant = u;
    u.climb = { x0: u.x, z0: u.z, y0: 0, x1: p.x, z1: p.z, y1: p.y, t: 0, dur: 1.6, toPost: p };
    this.events.push({ t: 'climb', u });
    return true;
  }

  leavePost(u) {
    const p = u.post;
    if (!p) return;
    p.occupant = null;
    u.post = null;
    u.wall = null;
    u.climb = { x0: p.x, z0: p.z, y0: p.y, x1: p.footX, z1: p.footZ, y1: 0, t: 0, dur: 1.2, toPost: null };
  }

  // ------------------------------------------------------------------ springen en paarden
  jump(u) {
    if (u.airT > 0 || u.climb || u.post || u.wall || u.mountAnim || u.siege || u.y > 0.05) return false;
    u.vy = u.mounted ? 5.0 : 3.6;
    u.airT = 1e-3;
    if (u.mounted) u.speed = Math.min(u.speed + 1.6, this.speedOf(u) * 1.2); // paard springt verder
    this.events.push({ t: 'jump', u });
    return true;
  }

  nearestFreeHorse(u, range) {
    let best = null;
    let bd = range;
    for (const h of this.freeHorses) {
      const d = Math.hypot(h.x - u.x, h.z - u.z);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  _freeHorse(x, z, yaw, faction, variant, leader) {
    this.horseUid = (this.horseUid || 0) + 1;
    const h = { id: 'h' + this.horseUid, x, z, y: 0, yaw, alive: true, speed: 0, gait: 0, deadT: 0, variant, isLeader: leader, def: { faction }, free: true };
    this.freeHorses.push(h);
    if (this.freeHorses.length > 40) this.freeHorses.shift();
    return h;
  }

  // afstijgen: de ruiter stapt links af, het paard blijft staan
  dismount(u) {
    if (!u.mounted || u.airT > 0 || u.mountAnim) return false;
    u.mountAnim = { t: 0, dir: -1, x: u.x, z: u.z, yaw: u.yaw, faction: u.def.faction, variant: u.variant, leader: u.isLeader };
    u.mountAnim.horse = { x: u.x, z: u.z, y: 0, yaw: u.yaw, alive: true, speed: 0, gait: 0, deadT: 0, variant: u.variant, isLeader: u.isLeader, def: { faction: u.def.faction } };
    u.speed = 0;
    this.events.push({ t: 'dismount', u });
    return true;
  }

  mount(u, h) {
    if (u.mounted || u.mountAnim || !h) return false;
    const k = this.freeHorses.indexOf(h);
    if (k < 0) return false;
    this.freeHorses.splice(k, 1);
    // ruiter loopt naar de linkerkant van het paard
    u.x = h.x - Math.cos(h.yaw) * 0.9;
    u.z = h.z + Math.sin(h.yaw) * 0.9;
    u.mountAnim = { t: 0, dir: 1, x: h.x, z: h.z, yaw: h.yaw, faction: h.def.faction, variant: h.variant, leader: h.isLeader, horse: h };
    u.yaw = h.yaw;
    this.events.push({ t: 'mount', u });
    return true;
  }

  _updateHorses(dt) {
    for (const h of this.freeHorses) {
      h.gait += dt * 0.3;
    }
    for (const u of this.units) {
      const a = u.mountAnim;
      if (!a || !u.alive) continue;
      a.t += dt / 0.85;
      const k = Math.min(1, a.t);
      u.mountT = a.dir > 0 ? k : 1 - k;
      // zijwaarts van/naar de linkerflank
      const side = (1 - u.mountT) * 0.95;
      u.x = a.x - Math.cos(a.yaw) * side;
      u.z = a.z + Math.sin(a.yaw) * side;
      u.yaw = a.yaw;
      if (k >= 1) {
        u.mountAnim = null;
        if (a.dir > 0) {
          u.mounted = true;
          u.mountT = 1;
          u.x = a.x;
          u.z = a.z;
          u.radius = 0.85;
          u.height = 2.75;
          u.gait = 0;
        } else {
          u.mounted = false;
          u.mountT = 0;
          u.radius = 0.4;
          u.height = 1.85;
          this._freeHorse(a.x, a.z, a.yaw, a.faction, a.variant, a.leader);
        }
      }
    }
  }

  // ------------------------------------------------------------------ weergang
  // Positie op de weergang (along = langs de muur, off = dwars, positief = naar buiten)
  wallPoint(walk, along, off) {
    return walk.axis === 'u' ? walk.fort.toWorld(along, walk.fixed + off) : walk.fort.toWorld(walk.fixed + off, along);
  }

  // Ladder (post met voet) op dezelfde weergang binnen bereik
  nearestLadder(u, range = 2.6) {
    if (!u.wall) return null;
    let best = null;
    let bd = range;
    for (const p of u.wall.walk.fort.posts) {
      if (p.walk !== u.wall.walk || p.struct.destroyed) continue;
      const d = Math.abs(p.along - u.wall.a);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // Van de weergang via een ladder naar beneden
  climbDown(u, ladder) {
    const [x, z] = [u.x, u.z];
    u.wall = null;
    if (u.post) {
      u.post.occupant = null;
      u.post = null;
    }
    u.climb = { x0: x, z0: z, y0: u.y, x1: ladder.footX, z1: ladder.footZ, y1: 0, t: 0, dur: 1.2, toPost: null };
    this.events.push({ t: 'climb', u });
  }

  _moveOnWall(u, dt) {
    const W = u.wall;
    const wk = W.walk;
    const f = wk.fort;
    // staat de eenheid op een vernield stuk muur? → valt naar beneden
    const under = wk.pieces.find((p) => W.a >= p.a - 0.01 && W.a <= p.b + 0.01);
    if (!under || under.st.destroyed) {
      u.wall = null;
      u.y = 0;
      const [x, z] = this.wallPoint(wk, W.a, -wk.out * (wk.t / 2 + 1.2));
      u.x = x;
      u.z = z;
      this.damageUnit(u, 30, 'blunt', null, { dot: true });
      return;
    }
    const c = Math.cos(f.rot);
    const sn = Math.sin(f.rot);
    const vx = u.dvx || 0;
    const vz = u.dvz || 0;
    const lu = c * vx - sn * vz;
    const lv = sn * vx + c * vz;
    const along = wk.axis === 'u' ? lu : lv;
    const across = wk.axis === 'u' ? lv : lu;
    // aaneengesloten intact stuk rond de eenheid (torens en bressen houden je tegen)
    let lo = wk.from + 0.45;
    let hi = wk.to - 0.45;
    for (const p of wk.pieces) if (p.st.destroyed) {
      if (p.b <= W.a) lo = Math.max(lo, p.b + 0.45);
      else if (p.a >= W.a) hi = Math.min(hi, p.a - 0.45);
    }
    const na = clamp(W.a + along * dt, lo, hi);
    // binnenkant open, buitenkant kantelen: niet van de muur kunnen lopen of glijden
    const no = clamp((W.o + across * dt) * wk.out, -(wk.t / 2 - 0.3), wk.t / 2 - 0.85) * wk.out;
    W.a = na;
    W.o = no;
    const [x, z] = this.wallPoint(wk, na, no);
    u.vx = (x - u.x) / Math.max(1e-4, dt);
    u.vz = (z - u.z) / Math.max(1e-4, dt);
    u.speed = Math.hypot(u.vx, u.vz);
    u.x = x;
    u.z = z;
    u.y = wk.h;
    if (u.speed > 0.2 && !u.isPlayer) u.yaw = Math.atan2(u.vx, u.vz);
  }

  // ------------------------------------------------------------------ belegeringstoren
  dockTower(tower, st) {
    if (st.destroyed || st.gate) return;
    st.dock = { x: tower.x, z: tower.z, alliance: tower.alliance, tower };
    tower.docked = st;
    this.nav.invalidate();
    this.events.push({ t: 'dock', st, u: tower });
  }

  // ------------------------------------------------------------------ leiders
  _updateAuras() {
    for (const u of this.units) u.aura = null;
    for (const t of this.teams) {
      const L = t.leader;
      if (!L || !L.alive) continue;
      const a = LEADERS[t.id].aura;
      this.unitGrid.query(L.x, L.z, a.radius, (o) => {
        if (o.team === t.id) o.aura = a;
        return false;
      });
    }
  }

  battleCry(L) {
    const t = this.teamById[L.team];
    if (!L.alive || (L.cryCd || 0) > this.time) return false;
    const c = LEADERS[t.id].cry;
    L.cryCd = this.time + c.cooldown;
    this.unitGrid.query(L.x, L.z, c.radius, (o) => {
      if (o.team !== t.id) return false;
      o.buff = { dmg: c.dmg, def: c.def, speed: c.speed, until: this.time + c.duration };
      if (c.heal) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * c.heal);
      return false;
    });
    t.morale += c.morale;
    L.attackT = 0;
    L.attackKind = 'cry';
    this.events.push({ t: 'cry', u: L, name: c.name });
    return true;
  }

  _morale(dt) {
    for (const t of this.teams) {
      t.morale += (60 - t.morale) * 0.004 * dt;
      t.morale = clamp(t.morale, 5, 100);
    }
  }

  // ------------------------------------------------------------------ inname
  _updateCapture(dt) {
    // veroveringspunten
    for (const c of this.map.capturePoints) {
      const count = {};
      const teamCount = {};
      this.unitGrid.query(c.x, c.z, c.r, (u) => {
        if (u.siege || u.y > 1) return false;
        count[u.alliance] = (count[u.alliance] || 0) + 1;
        teamCount[u.team] = (teamCount[u.team] || 0) + 1;
        return false;
      });
      const allis = Object.keys(count);
      if (allis.length === 1) {
        const a = allis[0];
        const rate = (dt / 14) * Math.min(1.8, 0.6 + count[a] * 0.2);
        const ownerAlli = c.owner ? this.allianceOf(c.owner) : null;
        if (ownerAlli && ownerAlli !== a) {
          c.progress -= rate;
          if (c.progress <= 0) {
            this.events.push({ t: 'cpLost', cp: c, team: c.owner });
            this.teamById[c.owner].morale -= 4;
            c.owner = null;
            c.progress = 0;
          }
        } else if (!ownerAlli) {
          c.by = a;
          c.progress += rate;
          if (c.progress >= 1) {
            const team = Object.entries(teamCount).filter(([tm]) => this.allianceOf(tm) === a).sort((x, y) => y[1] - x[1])[0][0];
            c.owner = team;
            c.progress = 1;
            this.teamById[team].morale += 4;
            this.events.push({ t: 'cpTaken', cp: c, team });
          }
        } else c.progress = Math.min(1, c.progress + rate);
      }
    }
    // donjons
    for (const t of this.teams) {
      const f = t.fort;
      if (f.fallen) continue;
      let att = 0;
      let def = 0;
      let attAlli = null;
      let leaderHere = false;
      this.unitGrid.query(f.keep.x, f.keep.z, f.keep.r, (u) => {
        if (u.siege || u.y > 1) return false;
        if (u.alliance === t.alliance) {
          def++;
          if (u.isLeader && u.team === t.id) leaderHere = true;
        } else {
          att++;
          attAlli = u.alliance;
        }
        return false;
      });
      const late = this.time > this.length.timeLimit * 0.62 ? 0.6 : 1;
      // beslissende bestorming: een kleine meerderheid volstaat en de inname gaat sneller
      const finale = this.time > this.length.timeLimit * 0.75;
      const capTime = 140 * this.length.capture * late * (finale ? 0.7 : 1) * (t.leader?.alive ? 1.25 : 1);
      // de leider telt als vier verdedigers
      const defW = def + (leaderHere ? 3 : 0);
      const push = finale ? att - defW : att - defW * 2;
      if (att > 0 && push > 0) {
        if (!f.captureBy || f.captureBy !== attAlli) {
          if (f.capture > 0.02 && f.captureBy !== attAlli) f.capture = Math.max(0, f.capture - dt / capTime);
          else f.captureBy = attAlli;
        }
        if (f.captureBy === attAlli) {
          if (f.capture === 0) this.events.push({ t: 'keepContest', team: t.id });
          f.capture += (dt / capTime) * Math.min(1.5, 0.35 + push * 0.12);
          if (this.phase < 3) {
            this.phase = 3;
            this.events.push({ t: 'phase', n: 3 });
          }
        }
        if (f.capture >= 1) this.fortFalls(t, attAlli);
      } else if (defW >= att) f.capture = Math.max(0, f.capture - (dt / capTime) * (att === 0 ? (leaderHere ? 1.2 : 0.5) : 0.25));
    }
  }

  fortFalls(t, byAlliance) {
    const f = t.fort;
    f.fallen = true;
    f.capture = 1;
    f.captureBy = byAlliance;
    t.alive = false;
    t.eliminatedAt = this.time;
    // overgebleven troepen vluchten
    for (const u of this.units) {
      if (u.alive && u.team === t.id) {
        if (u.isPlayer) this.kill(u, null, { rout: true });
        else this.kill(u, null, { rout: true });
        u.fled = true;
      }
    }
    for (const c of this.map.capturePoints) if (c.owner === t.id) {
      c.owner = null;
      c.progress = 0;
    }
    for (const o of this.teams) if (o.alive && o.alliance === byAlliance) o.morale += 20;
    this.events.push({ t: 'fortFallen', team: t.id, by: byAlliance });
  }

  _checkVictory() {
    if (!this.finaleAnnounced && this.time > this.length.timeLimit * 0.75) {
      this.finaleAnnounced = true;
      this.events.push({ t: 'finale' });
    }
    // een leger dat vrijwel vernietigd is en tegenover een sterkere vijand staat, slaat op de vlucht
    for (const t of this.teams) {
      if (!t.alive || t.soldiers <= 0 || t.soldiers > t.startSoldiers * 0.12) continue;
      let enemy = 0;
      for (const o of this.teams) if (o.alive && o.alliance !== t.alliance) enemy += Math.max(0, o.soldiers);
      if (enemy > t.soldiers * 1.5 && enemy >= 4) {
        t.routed = true;
        this.events.push({ t: 'armyBroken', team: t.id });
        for (const u of this.units) if (u.alive && u.team === t.id) {
          this.kill(u, null, { rout: true });
          u.fled = true;
        }
      }
    }
    // een team zonder soldaten ligt uit het spel
    for (const t of this.teams) {
      if (t.alive && t.soldiers <= 0) {
        t.alive = false;
        t.eliminatedAt = this.time;
        for (const u of this.units) if (u.alive && u.team === t.id) this.kill(u, null, { rout: true });
        this.events.push({ t: 'teamWiped', team: t.id });
      }
    }
    const aliveAllis = new Set(this.teams.filter((t) => t.alive).map((t) => t.alliance));
    if (aliveAllis.size <= 1) {
      this.endMatch([...aliveAllis][0] || null, 'conquest');
      return;
    }
    if (this.time >= this.length.timeLimit) {
      // tijd op: punten per alliantie
      const score = {};
      for (const t of this.teams) {
        let s = t.stats.kills;
        if (t.alive) s += 300;
        for (const st of t.fort.structures) s += (st.hp / st.maxHp) * 15;
        s += this.map.capturePoints.filter((c) => c.owner === t.id).length * 40;
        score[t.alliance] = (score[t.alliance] || 0) + s;
      }
      const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
      this.endMatch(best, 'time');
    }
  }

  endMatch(alliance, reason) {
    if (this.over) return;
    this.over = true;
    this.winner = alliance;
    this.winReason = reason;
    this.events.push({ t: 'end', alliance, reason });
  }

  // ------------------------------------------------------------------ animatie
  _animTick(u, dt) {
    u.animT += dt;
    u.attackT += dt;
    u.hitT += dt;
    if (u.mounted) u.gait += dt * (u.speed > 0.3 ? 2.2 + u.speed * 0.55 : 0);
    else u.gait += dt * u.speed * 1.35;
  }

  _cleanup() {
    // lijken opruimen en dode squads verwijderen
    this.units = this.units.filter((u) => u.alive || u.deadT < (u.fled ? 2 : CORPSE_TIME) || u === this.player);
    this.squads = this.squads.filter((s) => s.members.length > 0);
  }

  // Statistieken voor het eindscherm
  summary() {
    return {
      time: this.time, winner: this.winner, reason: this.winReason,
      teams: this.teams.map((t) => ({
        id: t.id, alliance: t.alliance, alive: t.alive, ...t.stats, morale: Math.round(t.morale),
        fortHp: Math.round((t.fort.structures.reduce((a, s) => a + s.hp, 0) / t.fort.structures.reduce((a, s) => a + s.maxHp, 0)) * 100),
        eliminatedAt: t.eliminatedAt, leaderDeaths: t.leaderDeaths, soldiers: Math.max(0, t.soldiers), startSoldiers: t.startSoldiers,
      })),
    };
  }
}

export { NAV_INF };
