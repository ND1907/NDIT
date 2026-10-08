import * as THREE from 'three';
import { Soldier } from './soldier.js';
import { buildWorld, rayAABB, MAP_HALF, WALL_Z, GAPS } from './world.js';
import { TEAMS, DIFFICULTY, enemyOf } from './teams.js';
import * as sfx from './audio.js';

const TEAM_SIZE = 6;
const SCORE_LIMIT = 30;
const RESPAWN_TIME = 3;
const CAM_DIST = 3.4;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const angleDiff = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const dirFromAngles = (yaw, pitch, out = new THREE.Vector3()) =>
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

export class Game {
  constructor(host, hud, controls, { lowQuality = false } = {}) {
    this.hud = hud;
    this.controls = controls;
    this.lowQuality = lowQuality;

    this.renderer = new THREE.WebGLRenderer({ antialias: !lowQuality, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowQuality ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !lowQuality;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
    this.world = buildWorld(this.scene, { shadows: !lowQuality });
    this.obstacles = this.world.obstacles;

    this.soldiers = [];
    this.projectiles = [];
    this.particles = [];
    this.state = 'idle'; // idle | attract | playing | paused | over
    this.time = 0;
    this.clock = new THREE.Clock();

    this._initFx();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------ setup
  start({ team = 'ottoman', difficulty = 'normal', withPlayer = true } = {}) {
    for (const s of this.soldiers) this.scene.remove(s.root);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.soldiers = [];
    this.projectiles = [];
    this.particles = [];
    this.score = { ottoman: 0, byzantine: 0 };
    this.diff = DIFFICULTY[difficulty];
    this.playerTeam = team;
    this.player = null;
    this.time = 0;
    this.pendingRestart = false;

    for (const t of ['ottoman', 'byzantine']) {
      const names = [...TEAMS[t].names].sort(() => Math.random() - 0.5);
      for (let i = 0; i < TEAM_SIZE; i++) {
        const isPlayer = withPlayer && t === team && i === 0;
        const s = new Soldier({ team: t, name: isPlayer ? 'Jij' : names[i], isPlayer });
        s.ai = { thinkT: Math.random() * 0.3, target: null, reactT: 0, strafe: 1, strafeT: 0, path: [], stuckT: 0, lastPos: new THREE.Vector3() };
        this.scene.add(s.root);
        this.soldiers.push(s);
        this.spawn(s, i);
        if (isPlayer) this.player = s;
      }
    }

    this.state = withPlayer ? 'playing' : 'attract';
    this.controls.reset();
    this.controls.enabled = withPlayer;
    this.hud.reset(this);
    if (withPlayer) sfx.playHorn();
  }

  spawn(s, idx = Math.floor(Math.random() * 10)) {
    const pts = this.world.spawns[s.team];
    const p = pts[idx % pts.length];
    s.reset();
    s.pos.set(p.x + (Math.random() - 0.5) * 2, 0, p.z + (Math.random() - 0.5) * 2);
    s.yaw = s.team === 'ottoman' ? 0 : Math.PI;
    s.pitch = 0;
    s.spawnShield = 1.5;
    if (s.ai) {
      s.ai.path = [];
      s.ai.target = null;
      s.ai.lastPos.copy(s.pos);
    }
  }

  // ------------------------------------------------------------------ loop
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === 'playing' || this.state === 'attract') {
      this.time += dt;
      this.update(dt);
    }
    this.updateFx(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    if (this.player) this.updatePlayer(dt);
    for (const s of this.soldiers) {
      if (s.isPlayer) continue;
      if (s.alive) this.updateBot(s, dt);
      else this.updateDead(s, dt);
    }
    this.updateProjectiles(dt);
    for (const s of this.soldiers) {
      const gs = Math.hypot(s.vel.x, s.vel.z);
      s.updateAnim(dt, gs);
      if (s.spawnShield > 0) s.spawnShield -= dt;
      // gezondheid herstelt na 7 s zonder schade
      if (s.alive && this.time - s.lastHurtT > 7 && s.hp < 100) s.hp = Math.min(100, s.hp + 10 * dt);
    }
    this.hud.update(this, dt);
    if (this.pendingRestart) {
      this.pendingRestart = false;
      this.start({ withPlayer: false });
    }
  }

  updateDead(s, dt) {
    s.vel.set(0, 0, 0);
    if (s.deadT > RESPAWN_TIME) this.spawn(s);
  }

  // ------------------------------------------------------------------ player
  updatePlayer(dt) {
    const p = this.player;
    const c = this.controls;
    c.update();
    if (!p.alive) {
      this.updateDead(p, dt);
      c.consumeLook();
      return;
    }

    const look = c.consumeLook();
    p.yaw -= look.x * 0.0052;
    p.pitch = THREE.MathUtils.clamp(p.pitch - look.y * 0.0042, -0.75, 0.85);

    const speed = c.sprint && c.move.y > 0.3 ? 7.2 : 4.8;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    // rechts = (-cos, 0, sin) bij deze yaw-conventie
    const wx = (fx * c.move.y - fz * c.move.x) * speed;
    const wz = (fz * c.move.y + fx * c.move.x) * speed;
    p.vel.x = wx;
    p.vel.z = wz;

    if (c.jumpPressed && p.onGround) {
      p.vel.y = 6;
      p.onGround = false;
    }
    c.jumpPressed = false;
    this.moveSoldier(p, dt);

    this.handleWeapon(p, dt, c.firing, c.reloadPressed);
    c.reloadPressed = false;
  }

  handleWeapon(s, dt, wantFire, wantReload) {
    s.fireCd -= dt;
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) s.ammo = s.cfg.magazine;
      return;
    }
    if ((wantReload && s.ammo < s.cfg.magazine) || s.ammo <= 0) {
      s.reloadT = s.cfg.reloadTime;
      if (s.isPlayer) sfx.playReload();
      return;
    }
    if (wantFire && s.fireCd <= 0) {
      s.fireCd = s.cfg.fireDelay;
      s.ammo--;
      if (s.isPlayer) {
        const moving = Math.hypot(s.vel.x, s.vel.z) > 1;
        const spread = (moving ? 0.022 : 0.006) + (s.onGround ? 0 : 0.03);
        const dir = this.spreadDir(dirFromAngles(s.yaw, s.pitch), spread);
        const origin = this.camera.position.clone();
        // alles tussen camera en speler negeren
        const minT = origin.distanceTo(s.eye(_v1)) + 0.2;
        this.fire(s, origin, dir, minT);
        s.pitch += 0.02; // terugslag
      }
    }
  }

  spreadDir(dir, spread) {
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    return dir.normalize();
  }

  // ------------------------------------------------------------------ AI
  updateBot(b, dt) {
    const ai = b.ai;
    const d = this.state === 'attract' ? DIFFICULTY.normal : this.diff;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.25 + Math.random() * 0.2;
      const t = this.findTarget(b);
      if (t !== ai.target) {
        ai.target = t;
        ai.reactT = d.reaction * (0.7 + Math.random() * 0.6);
      }
      // vastgelopen? nieuw doel kiezen
      ai.stuckT += 0.35;
      if (ai.stuckT > 1.5) {
        if (ai.lastPos.distanceTo(b.pos) < 0.8 && !ai.target) ai.path = [];
        ai.lastPos.copy(b.pos);
        ai.stuckT = 0;
      }
    }

    let moveX = 0;
    let moveZ = 0;
    let speed = 4.2;
    const tgt = ai.target;
    if (tgt && tgt.alive) {
      const dx = tgt.pos.x - b.pos.x;
      const dz = tgt.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(dx, dz);
      const wantPitch = Math.atan2(tgt.pos.y + 1.2 - (b.pos.y + 1.45), dist);
      const turn = d.turnRate * dt;
      b.yaw += THREE.MathUtils.clamp(angleDiff(b.yaw, wantYaw), -turn, turn);
      b.pitch += THREE.MathUtils.clamp(wantPitch - b.pitch, -turn, turn);

      ai.strafeT -= dt;
      if (ai.strafeT <= 0) {
        ai.strafeT = 0.8 + Math.random() * 1.6;
        ai.strafe = Math.random() < 0.5 ? -1 : Math.random() < 0.3 ? 0 : 1;
      }
      const fx = dx / dist;
      const fz = dz / dist;
      const fwd = dist > 22 ? 1 : dist < 10 ? -0.6 : 0;
      moveX = fx * fwd + fz * ai.strafe * 0.8;
      moveZ = fz * fwd - fx * ai.strafe * 0.8;
      speed = 3.6;

      ai.reactT -= dt;
      const aimed = Math.abs(angleDiff(b.yaw, wantYaw)) < 0.12;
      const shoot = ai.reactT <= 0 && aimed && dist < 75;
      if (shoot && b.fireCd <= 0 && b.reloadT <= 0 && b.ammo > 0) {
        const origin = b.muzzleWorld(_v3);
        const aim = _v1.set(tgt.pos.x, tgt.pos.y + 1.15 + Math.random() * 0.5, tgt.pos.z).sub(origin).normalize();
        this.fire(b, origin.clone(), this.spreadDir(aim.clone(), d.spread), 0);
        b.ammo--;
        b.fireCd = b.cfg.fireDelay * (1.2 + Math.random() * 0.9);
      }
      b.fireCd -= dt;
      if (b.reloadT > 0) {
        b.reloadT -= dt;
        if (b.reloadT <= 0) b.ammo = b.cfg.magazine;
      } else if (b.ammo <= 0) b.reloadT = b.cfg.reloadTime;
    } else {
      // patrouilleren naar een doel (via bressen in de muur)
      b.fireCd -= dt;
      if (b.ammo < b.cfg.magazine && b.reloadT <= 0) b.reloadT = b.cfg.reloadTime;
      if (b.reloadT > 0) {
        b.reloadT -= dt;
        if (b.reloadT <= 0) b.ammo = b.cfg.magazine;
      }
      if (!ai.path.length) ai.path = this.planPath(b);
      const wp = ai.path[0];
      const dx = wp.x - b.pos.x;
      const dz = wp.z - b.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.5) ai.path.shift();
      else {
        moveX = dx / dist;
        moveZ = dz / dist;
      }
      const wantYaw = Math.atan2(moveX, moveZ);
      if (moveX || moveZ) b.yaw += THREE.MathUtils.clamp(angleDiff(b.yaw, wantYaw), -3 * dt, 3 * dt);
      b.pitch *= 0.9;
    }

    // simpele obstakelontwijking
    if (moveX || moveZ) {
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;
      const o = _v1.set(b.pos.x, b.pos.y + 0.5, b.pos.z);
      for (const rot of [0, 0.8, -0.8, 1.6, -1.6]) {
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const rx = moveX * c - moveZ * s;
        const rz = moveX * s + moveZ * c;
        if (this.rayObstacles(o, _v2.set(rx, 0, rz), 1.6) === Infinity) {
          moveX = rx;
          moveZ = rz;
          break;
        }
      }
    }
    b.vel.x = moveX * speed;
    b.vel.z = moveZ * speed;
    this.moveSoldier(b, dt);
  }

  findTarget(b) {
    let best = null;
    let bestD = 70;
    const eye = b.eye(_v1);
    const cur = b.ai.target;
    for (const s of this.soldiers) {
      if (s.team === b.team || !s.alive) continue;
      const dd = s.pos.distanceTo(b.pos) - (s === cur ? 8 : 0); // huidig doel licht voorkeur
      if (dd >= bestD) continue;
      const to = s.eye(_v2).sub(eye);
      const len = to.length();
      // gezichtsveld: niet achter je kijken tenzij dichtbij of net beschoten
      const fwd = dirFromAngles(b.yaw, 0, _v3);
      const dot = (to.x * fwd.x + to.z * fwd.z) / len;
      if (dot < -0.2 && len > 12 && this.time - b.lastHurtT > 1.5) continue;
      if (this.rayObstacles(eye, to.divideScalar(len), len) < len) continue;
      best = s;
      bestD = dd;
    }
    return best;
  }

  planPath(b) {
    const enemySide = b.team === 'ottoman' ? 1 : -1;
    const r = Math.random();
    let gx;
    let gz;
    if (r < 0.6) {
      gx = (Math.random() * 2 - 1) * 45;
      gz = -28 + Math.random() * 58; // middenveld
    } else {
      gx = (Math.random() * 2 - 1) * 45;
      gz = enemySide > 0 ? 42 + Math.random() * 12 : -45 + Math.random() * 12;
    }
    const goal = new THREE.Vector3(gx, 0, gz);
    const path = [];
    const sideA = b.pos.z < WALL_Z;
    const sideB = gz < WALL_Z;
    if (sideA !== sideB) {
      // door de dichtstbijzijnde bres
      let gap = GAPS[0];
      for (const g of GAPS) if (Math.abs(g - b.pos.x) + Math.abs(g - gx) < Math.abs(gap - b.pos.x) + Math.abs(gap - gx)) gap = g;
      path.push(new THREE.Vector3(gap, 0, sideA ? WALL_Z - 5 : WALL_Z + 5));
      path.push(new THREE.Vector3(gap, 0, sideA ? WALL_Z + 5 : WALL_Z - 5));
    }
    path.push(goal);
    return path;
  }

  // ------------------------------------------------------------------ physics
  moveSoldier(s, dt) {
    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    s.vel.y -= 16 * dt;
    s.pos.y += s.vel.y * dt;

    let floor = 0;
    const r = s.radius;
    for (const o of this.obstacles) {
      const cx = THREE.MathUtils.clamp(s.pos.x, o.min.x, o.max.x);
      const cz = THREE.MathUtils.clamp(s.pos.z, o.min.z, o.max.z);
      const dx = s.pos.x - cx;
      const dz = s.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (s.pos.y >= o.max.y - 0.25) {
        floor = Math.max(floor, o.max.y); // er bovenop staan
        continue;
      }
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        s.pos.x = cx + (dx / d) * r;
        s.pos.z = cz + (dz / d) * r;
      } else {
        // middelpunt in de doos: duw naar de dichtstbijzijnde zijkant
        const ex = [o.min.x - r - s.pos.x, o.max.x + r - s.pos.x];
        const ez = [o.min.z - r - s.pos.z, o.max.z + r - s.pos.z];
        const mx = Math.abs(ex[0]) < Math.abs(ex[1]) ? ex[0] : ex[1];
        const mz = Math.abs(ez[0]) < Math.abs(ez[1]) ? ez[0] : ez[1];
        if (Math.abs(mx) < Math.abs(mz)) s.pos.x += mx;
        else s.pos.z += mz;
      }
    }
    // soldaten duwen elkaar zachtjes weg
    for (const o of this.soldiers) {
      if (o === s || !o.alive) continue;
      const dx = s.pos.x - o.pos.x;
      const dz = s.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.5 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (0.71 - d) * 0.5;
        s.pos.x += (dx / d) * push;
        s.pos.z += (dz / d) * push;
      }
    }
    s.pos.x = THREE.MathUtils.clamp(s.pos.x, -MAP_HALF, MAP_HALF);
    s.pos.z = THREE.MathUtils.clamp(s.pos.z, -MAP_HALF, MAP_HALF);

    if (s.pos.y <= floor) {
      s.pos.y = floor;
      s.vel.y = 0;
      s.onGround = true;
    } else s.onGround = s.pos.y - floor < 0.05;
  }

  rayObstacles(o, d, maxT) {
    let best = Infinity;
    for (const box of this.obstacles) {
      const t = rayAABB(o, d, box, Math.min(maxT, best));
      if (t < best) best = t;
    }
    if (d.y < 0) {
      const tg = -o.y / d.y; // grond
      if (tg < best && tg <= maxT) best = tg;
    }
    return best <= maxT ? best : Infinity;
  }

  // ray tegen staande cilinders van soldaten
  raySoldiers(o, d, maxT, shooter, minT) {
    let hit = null;
    let best = maxT;
    for (const s of this.soldiers) {
      if (s === shooter || !s.alive || s.team === shooter.team) continue;
      const ox = o.x - s.pos.x;
      const oz = o.z - s.pos.z;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-8) continue;
      const bq = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - s.radius * s.radius;
      const disc = bq * bq - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const t of [(-bq - sq) / (2 * a), (-bq + sq) / (2 * a)]) {
        if (t < minT || t >= best) continue;
        const y = o.y + d.y * t - s.pos.y;
        if (y >= 0 && y <= s.height) {
          best = t;
          hit = { soldier: s, t, head: y > 1.62 };
          break;
        }
      }
    }
    return hit;
  }

  // ------------------------------------------------------------------ combat
  fire(shooter, origin, dir, minT) {
    shooter.showFlash();
    shooter.lastFireT = this.time;
    const range = 140;
    const tObs = this.rayObstacles(origin, dir, range);
    const hit = this.raySoldiers(origin, dir, Math.min(tObs, range), shooter, minT);
    const endT = hit ? hit.t : Math.min(tObs, range);
    const end = origin.clone().addScaledVector(dir, endT);

    const muzzle = shooter.muzzleWorld(new THREE.Vector3());
    this.spawnProjectile(shooter, muzzle, end, hit, tObs < range && !hit);

    const dist = this.player ? muzzle.distanceTo(this.camera.position) : 30;
    sfx.playShot(shooter.cfg.weapon, shooter.isPlayer ? 1 : Math.max(0, 1 - dist / 90) * 0.7);
    if (shooter.cfg.weapon === 'musket') this.spawnSmoke(muzzle, dir);
  }

  damage(target, amount, attacker, head) {
    if (!target.alive || target.spawnShield > 0) return;
    let dmg = amount * (head ? 2 : 1);
    if (target.isPlayer && !attacker.isPlayer) dmg *= this.diff.damageToPlayer;
    target.hp -= dmg;
    target.lastHurtT = this.time;
    if (!target.isPlayer && target.ai && !target.ai.target) {
      target.ai.target = attacker;
      target.ai.reactT = 0.25;
    }
    if (target.isPlayer) {
      this.hud.hurt(attacker, this.player);
      sfx.playHurt();
    }
    if (attacker.isPlayer) {
      this.hud.hitMarker(head);
      sfx.playHit();
    }
    if (target.hp <= 0) this.kill(target, attacker, head);
  }

  kill(target, attacker, head) {
    target.hp = 0;
    target.alive = false;
    target.deadT = 0;
    target.deaths++;
    target.reloadT = 0;
    attacker.kills++;
    this.score[attacker.team]++;
    this.hud.killFeed(attacker, target, head, this);
    if (attacker.isPlayer) sfx.playKill();
    if (this.state === 'playing' && this.score[attacker.team] >= SCORE_LIMIT) this.gameOver(attacker.team);
    if (this.state === 'attract' && this.score[attacker.team] >= SCORE_LIMIT) this.pendingRestart = true;
  }

  gameOver(winner) {
    this.state = 'over';
    this.controls.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.gameOver(this, winner);
  }

  // ------------------------------------------------------------------ fx
  _initFx() {
    this.fxGeo = {
      ball: new THREE.SphereGeometry(0.05, 6, 4),
      bolt: new THREE.CylinderGeometry(0.015, 0.015, 0.7, 5),
      puff: new THREE.SphereGeometry(1, 8, 6),
      tracer: new THREE.CylinderGeometry(0.012, 0.012, 1, 4),
    };
    this.fxMat = {
      ball: new THREE.MeshBasicMaterial({ color: '#ffd27a' }),
      bolt: new THREE.MeshBasicMaterial({ color: '#4a3520' }),
      tracer: new THREE.MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: 0.55 }),
    };
  }

  spawnProjectile(shooter, from, to, hit, impact) {
    const isBolt = shooter.cfg.weapon === 'crossbow';
    const mesh = new THREE.Mesh(isBolt ? this.fxGeo.bolt : this.fxGeo.ball, isBolt ? this.fxMat.bolt : this.fxMat.ball);
    mesh.position.copy(from);
    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.normalize();
    if (isBolt) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, from: from.clone(), dir, len, t: 0,
      speed: shooter.cfg.projectileSpeed, shooter, hit, impact,
      damage: shooter.cfg.damage,
    });
    if (!isBolt) {
      // korte rooksliert/tracer van de musketkogel
      const tr = new THREE.Mesh(this.fxGeo.tracer, this.fxMat.tracer.clone());
      tr.position.copy(from).addScaledVector(dir, len / 2);
      tr.scale.set(1, len, 1);
      tr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.scene.add(tr);
      this.particles.push({ mesh: tr, life: 0.08, max: 0.08, kind: 'tracer' });
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += p.speed * dt;
      if (p.t >= p.len) {
        const end = p.from.clone().addScaledVector(p.dir, p.len);
        if (p.hit) {
          this.damage(p.hit.soldier, p.damage, p.shooter, p.hit.head);
          this.spawnPuff(end, '#8b1a1a', 0.12, 6);
        } else if (p.impact) {
          this.spawnPuff(end, '#b8a888', 0.18, 5);
          if (this.player) sfx.playImpact(Math.max(0, 1 - end.distanceTo(this.camera.position) / 30));
        }
        if (p.hit || !p.impact || p.shooter.cfg.weapon !== 'crossbow') {
          this.scene.remove(p.mesh);
        } else {
          // kruisboogpijl blijft even steken
          p.mesh.position.copy(end).addScaledVector(p.dir, 0.2);
          this.particles.push({ mesh: p.mesh, life: 6, max: 6, kind: 'stuck' });
        }
        this.projectiles.splice(i, 1);
      } else {
        p.mesh.position.copy(p.from).addScaledVector(p.dir, p.t);
      }
    }
  }

  spawnSmoke(at, dir) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(this.fxGeo.puff, new THREE.MeshLambertMaterial({ color: '#d8d4cc', transparent: true, opacity: 0.5, depthWrite: false }));
      m.position.copy(at).addScaledVector(dir, 0.3 + i * 0.35);
      m.scale.setScalar(0.12);
      this.scene.add(m);
      this.particles.push({ mesh: m, life: 1.4, max: 1.4, kind: 'smoke', grow: 0.5 + i * 0.15, vy: 0.4 });
    }
  }

  spawnPuff(at, color, size, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.fxGeo.puff, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
      m.position.copy(at);
      m.scale.setScalar(size * (0.5 + Math.random() * 0.5));
      this.scene.add(m);
      this.particles.push({
        mesh: m, life: 0.4, max: 0.4, kind: 'puff',
        v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3),
      });
    }
  }

  updateFx(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      if (p.kind === 'smoke') {
        p.mesh.scale.addScalar(p.grow * dt);
        p.mesh.position.y += p.vy * dt;
        p.mesh.material.opacity = 0.5 * k;
      } else if (p.kind === 'puff') {
        p.mesh.position.addScaledVector(p.v, dt);
        p.v.y -= 9 * dt;
        p.mesh.material.opacity = 0.8 * k;
      } else if (p.kind === 'tracer') {
        p.mesh.material.opacity = 0.55 * k;
      }
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        if (p.kind !== 'stuck' && p.kind !== 'tracer') p.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }
    // vlaggen wapperen
    const t = performance.now() / 1000;
    for (const f of this.world.flags) {
      const pos = f.geometry.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const x = pos.getX(j) + 1.6;
        pos.setZ(j, Math.sin(x * 2.2 - t * 5 + f.position.x) * 0.12 * x);
      }
      pos.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt) {
    const p = this.player;
    if (!p || this.state === 'attract' || this.state === 'idle') {
      // filmische rondvlucht voor het hoofdmenu
      const t = performance.now() / 1000 * 0.06;
      this.camera.position.set(Math.sin(t) * 55, 22 + Math.sin(t * 2) * 4, Math.cos(t) * 55 - 5);
      this.camera.lookAt(0, 3, 5);
      return;
    }
    const yaw = p.yaw;
    const pitch = p.alive ? p.pitch : -0.4;
    const dir = dirFromAngles(yaw, pitch, _v1);
    // schouder-camera: iets rechts van de speler
    const pivot = _v2.set(
      p.pos.x - Math.cos(yaw) * 0.85,
      p.pos.y + (p.alive ? 1.85 : 0.8),
      p.pos.z + Math.sin(yaw) * 0.85,
    );
    const back = _v3.copy(dir).negate();
    const dist = p.alive ? CAM_DIST : 6;
    let t = this.rayObstacles(pivot, back, dist + 0.3);
    t = Math.min(dist, t === Infinity ? dist : t - 0.3);
    this.camera.position.copy(pivot).addScaledVector(back, Math.max(0.3, t));
    this.camera.lookAt(pivot.addScaledVector(dir, 20));
  }

  pause(on) {
    if (on && this.state === 'playing') {
      this.state = 'paused';
      this.controls.enabled = false;
      this.controls.reset();
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (!on && this.state === 'paused') {
      this.state = 'playing';
      this.controls.enabled = true;
      this.clock.getDelta();
    }
  }
}

export { SCORE_LIMIT, RESPAWN_TIME, enemyOf };
