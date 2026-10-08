import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Soldier } from './soldier.js';
import { Horse } from './horse.js';
import { buildWorld, rayAABB, regionOf, fortGates, MAP_X, MAP_Z } from './world.js';
import { TEAMS, DIFFICULTY, ROLES, ARROWS_MAX, enemyOf } from './teams.js';
import * as sfx from './audio.js';

const TEAM_SIZE = ROLES.length;
const SCORE_LIMIT = 30;
const RESPAWN_TIME = 3.5;
const GRAVITY = 9.8;
const RIDER_Y = 0.85; // hoogte van de ruiter boven de grond van het paard
const HORSE_SPEED = 11;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const angleDiff = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const dirFromAngles = (yaw, pitch, out = new THREE.Vector3()) =>
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

// Richting om met snelheid v een punt te raken, rekening houdend met de zwaartekracht (lage boog).
function ballisticDir(o, t, v, out = new THREE.Vector3()) {
  const dx = t.x - o.x;
  const dz = t.z - o.z;
  const d = Math.hypot(dx, dz) || 0.001;
  const h = t.y - o.y;
  const v2 = v * v;
  const disc = v2 * v2 - GRAVITY * (GRAVITY * d * d + 2 * h * v2);
  const ang = disc < 0 ? Math.PI / 4 : Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * d));
  return out.set((dx / d) * Math.cos(ang), Math.sin(ang), (dz / d) * Math.cos(ang));
}

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
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 450);
    this.world = buildWorld(this.scene, { shadows: !lowQuality });
    this.obstacles = this.world.obstacles;

    this.soldiers = [];
    this.horses = [];
    this.arrows = [];
    this.stuck = [];
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
    for (const h of this.horses) this.scene.remove(h.root);
    for (const a of [...this.arrows, ...this.stuck, ...this.particles]) this.scene.remove(a.mesh);
    this.soldiers = [];
    this.horses = [];
    this.arrows = [];
    this.stuck = [];
    this.particles = [];
    this.score = { ottoman: 0, byzantine: 0 };
    this.diff = DIFFICULTY[difficulty];
    this.player = null;
    this.time = 0;
    this.pendingRestart = false;

    for (const t of ['ottoman', 'byzantine']) {
      // paarden in de stal: eerst voor de ruiters, de rest is vrij te gebruiken
      const spots = this.world.horseSpots[t];
      const teamHorses = spots.map((spot, i) => {
        const h = new Horse(t, i + (t === 'byzantine' ? 2 : 0));
        h.home.copy(spot.pos);
        h.homeYaw = spot.yaw;
        h.sendHome();
        this.scene.add(h.root);
        this.horses.push(h);
        return h;
      });
      let horseIdx = 0;
      const names = [...TEAMS[t].names].sort(() => Math.random() - 0.5);
      for (let i = 0; i < TEAM_SIZE; i++) {
        const isPlayer = withPlayer && t === team && i === 0;
        const role = ROLES[i];
        const s = new Soldier({ team: t, name: isPlayer ? 'Jij' : names[i], isPlayer, role: isPlayer ? 'player' : role });
        s.ai = { thinkT: Math.random() * 0.3, target: null, reactT: 0, strafe: 1, strafeT: 0, path: [], chase: [], stuckT: 0, lastPos: new THREE.Vector3(), passT: 0 };
        if (role === 'cavalry' && !isPlayer) s.ownHorse = teamHorses[horseIdx++];
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
    if (s.mounted) this.dismount(s, true);
    const pts = this.world.spawns[s.team];
    const p = pts[idx % pts.length];
    s.reset();
    s.pos.set(p.x + (Math.random() - 0.5) * 2, 0, p.z + (Math.random() - 0.5) * 2);
    s.yaw = s.team === 'ottoman' ? 0 : Math.PI;
    s.pitch = 0;
    s.spawnShield = 2;
    if (s.ai) {
      s.ai.path = [];
      s.ai.chase = [];
      s.ai.target = null;
      s.ai.lastPos.copy(s.pos);
    }
    // ruiters stappen meteen weer op hun eigen paard
    const h = s.ownHorse;
    if (h && !h.rider) {
      h.sendHome();
      this.mount(s, h);
    }
  }

  mount(s, h) {
    s.mounted = h;
    h.rider = s;
    s.vel.set(0, 0, 0);
    s.yaw = h.yaw;
    s.pos.set(h.pos.x, h.pos.y + RIDER_Y, h.pos.z);
    if (s.isPlayer) this.hud.announce('Te paard!');
  }

  dismount(s, silent = false) {
    const h = s.mounted;
    if (!h) return;
    h.rider = null;
    h.speed = Math.min(h.speed, 3);
    s.mounted = null;
    // naast het paard neerzetten (rechterkant)
    s.pos.set(h.pos.x - Math.cos(h.yaw) * 1.3, 0, h.pos.z + Math.sin(h.yaw) * 1.3);
    s.vel.set(0, 0, 0);
    if (s.isPlayer && !silent) this.hud.announce('Afgestegen');
  }

  nearestFreeHorse(s, maxD = 3.4) {
    let best = null;
    let bd = maxD;
    for (const h of this.horses) {
      if (h.rider) continue;
      const d = Math.hypot(h.pos.x - s.pos.x, h.pos.z - s.pos.z);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
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
    for (const h of this.horses) {
      if (!h.rider) {
        // rijderloos paard loopt uit en blijft staan
        h.speed = Math.max(0, h.speed - 6 * dt);
        if (h.speed > 0) {
          h.vel.set(Math.sin(h.yaw) * h.speed, 0, Math.cos(h.yaw) * h.speed);
          this.moveBody(h, dt);
        }
      }
      h.updateAnim(dt);
    }
    this.updateArrows(dt);
    for (const s of this.soldiers) {
      this.tickCombat(s, dt);
      s.updateAnim(dt, Math.hypot(s.vel.x, s.vel.z));
      if (s.spawnShield > 0) s.spawnShield -= dt;
      if (!s.alive) continue;
      // gezondheid herstelt na 7 s zonder schade; pijlen bijvullen in het eigen fort
      if (this.time - s.lastHurtT > 7 && s.hp < 100) s.hp = Math.min(100, s.hp + 10 * dt);
      if (s.arrows < ARROWS_MAX && regionOf(s.pos.x, s.pos.z) === s.team) s.arrows = Math.min(ARROWS_MAX, s.arrows + 4 * dt);
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
      c.jumpPressed = c.switchPressed = c.mountPressed = false;
      return;
    }

    const look = c.consumeLook();
    p.yaw -= look.x * 0.0052;
    p.pitch = THREE.MathUtils.clamp(p.pitch - look.y * 0.0042, -0.75, 0.85);

    if (c.mountPressed) {
      if (p.mounted) this.dismount(p);
      else {
        const h = this.nearestFreeHorse(p);
        if (h) this.mount(p, h);
      }
    }
    c.mountPressed = false;
    const want = c.switchPressed ? (p.weapon === 'bow' ? 'sword' : 'bow') : c.selectWeapon;
    if (want && want !== p.weapon) {
      p.setWeapon(want);
      sfx.playSwitch();
    }
    c.switchPressed = false;
    c.selectWeapon = null;

    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    // rechts = (-cos, 0, sin) bij deze yaw-conventie
    const mx = fx * c.move.y - fz * c.move.x;
    const mz = fz * c.move.y + fx * c.move.x;
    const mag = Math.min(1, Math.hypot(c.move.x, c.move.y));

    if (p.mounted) {
      this.ride(p, mx, mz, mag, dt, c.sprint ? 1.25 : 1);
      c.jumpPressed = false;
    } else {
      const speed = c.sprint && c.move.y > 0.3 ? 7 : 4.6;
      p.vel.x = mx * speed;
      p.vel.z = mz * speed;
      if (c.jumpPressed && p.onGround) {
        p.vel.y = 6;
        p.onGround = false;
      }
      c.jumpPressed = false;
      this.moveBody(p, dt);
    }

    if (c.firing) this.attack(p);
  }

  // ------------------------------------------------------------------ combat
  attack(s, target = null) {
    if (s.attackCd > 0 || !s.alive) return;
    if (s.weapon === 'sword') {
      s.swingT = 0;
      s.attackCd = s.cfg.sword.delay;
      s.pendingHit = 0.13;
      s.lastAttackT = this.time;
      sfx.playSwing(this.volumeAt(s.pos, 25));
      return;
    }
    if (s.arrows < 1) {
      if (s.isPlayer) this.hud.announce('Pijlkoker leeg — terug naar je fort of pak je zwaard (Q)');
      s.attackCd = 0.6;
      return;
    }
    if (s.drawT < 1) return;

    const origin = s.bowWorld(new THREE.Vector3());
    let aimPoint;
    if (s.isPlayer) {
      // richt op wat midden in beeld staat
      const camPos = this.camera.position;
      const dir = dirFromAngles(s.yaw, s.pitch, _v1);
      const minT = camPos.distanceTo(s.eye(_v2)) + 0.3;
      const tObs = this.rayObstacles(camPos, dir, 160);
      const hit = this.raySoldiers(camPos, dir, Math.min(tObs, 160), s, minT);
      const t = hit ? hit.t : Math.min(tObs, 160);
      aimPoint = camPos.clone().addScaledVector(dir, Math.max(t, minT + 2));
    } else {
      // vijand + voorsprong voor zijn beweging
      const tt = target.pos.distanceTo(s.pos) / s.cfg.bow.speed;
      aimPoint = new THREE.Vector3(target.pos.x + target.vel.x * tt, target.pos.y + 1.25, target.pos.z + target.vel.z * tt);
    }
    const dir = ballisticDir(origin, aimPoint, s.cfg.bow.speed);
    const spread = s.isPlayer ? (Math.hypot(s.vel.x, s.vel.z) > 1 ? 0.012 : 0.004) : this.botDiff().spread;
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();
    this.launchArrow(s, origin, dir);
    s.arrows -= 1;
    s.drawT = 0;
    s.attackCd = s.cfg.bow.delay;
    s.lastAttackT = this.time;
    sfx.playBow(this.volumeAt(origin, 60));
  }

  tickCombat(s, dt) {
    s.attackCd -= dt;
    if (s.pendingHit >= 0) {
      s.pendingHit -= dt;
      if (s.pendingHit < 0 && s.alive) this.resolveMelee(s);
    }
  }

  resolveMelee(s) {
    const sw = s.cfg.sword;
    const range = sw.range + (s.mounted ? 0.9 : 0);
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    let hits = 0;
    for (const e of this.soldiers) {
      if (e.team === s.team || !e.alive) continue;
      const dx = e.pos.x - s.pos.x;
      const dz = e.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > range) continue;
      if (d > 0.6 && (dx * fx + dz * fz) / d < 0.45) continue;
      if (Math.abs(e.pos.y - s.pos.y) > 2.2) continue;
      let dmg = sw.damage;
      if (s.mounted && s.mounted.speed > 6) dmg *= 1.3; // charge te paard
      // schild vangt een deel op als de verdediger de aanvaller aankijkt
      let blocked = false;
      if (e.shield && e.weapon === 'sword') {
        const facing = (-dx * Math.sin(e.yaw) - dz * Math.cos(e.yaw)) / (d || 1);
        if (facing > 0.5) {
          dmg *= 0.55;
          blocked = true;
        }
      }
      this.damage(e, dmg, s, false);
      const at = _v1.set(e.pos.x, e.pos.y + 1.3, e.pos.z);
      if (blocked) {
        sfx.playClash(this.volumeAt(at, 30));
        this.spawnPuff(at, '#ffe08a', 0.06, 5);
      } else {
        sfx.playFlesh(this.volumeAt(at, 30));
        this.spawnPuff(at, '#8b1a1a', 0.1, 6);
      }
      if (++hits >= 2) break;
    }
  }

  damage(target, amount, attacker, head) {
    if (!target.alive || target.spawnShield > 0) return;
    let dmg = amount * (head ? 2 : 1);
    if (target.isPlayer && !attacker.isPlayer) dmg *= this.diff.damageToPlayer;
    target.hp -= dmg;
    target.lastHurtT = this.time;
    if (!target.isPlayer && target.ai && (!target.ai.target || Math.random() < 0.5)) {
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
    target.pendingHit = -1;
    if (target.mounted) this.dismount(target, true);
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

  volumeAt(pos, range) {
    if (!this.player) return 0;
    return Math.max(0, 1 - pos.distanceTo(this.camera.position) / range);
  }

  botDiff() {
    return this.state === 'attract' ? DIFFICULTY.normal : this.diff;
  }

  // ------------------------------------------------------------------ riding
  // Paard sturen: draait geleidelijk naar de gewenste richting, kan niet zijwaarts.
  ride(s, dx, dz, mag, dt, boost = 1) {
    const h = s.mounted;
    let targetSpeed = 0;
    if (mag > 0.1) {
      const want = Math.atan2(dx, dz);
      const diff = angleDiff(h.yaw, want);
      h.yaw += THREE.MathUtils.clamp(diff, -2.6 * dt, 2.6 * dt);
      targetSpeed = HORSE_SPEED * boost * mag * (Math.abs(diff) > 2 ? 0.35 : 1);
    }
    h.speed += THREE.MathUtils.clamp(targetSpeed - h.speed, -14 * dt, 6 * dt);
    h.vel.set(Math.sin(h.yaw) * h.speed, 0, Math.cos(h.yaw) * h.speed);
    const bx = h.pos.x;
    const bz = h.pos.z;
    this.moveBody(h, dt);
    if (dt > 0) h.speed = Math.min(h.speed, Math.hypot(h.pos.x - bx, h.pos.z - bz) / dt + 1.5); // remmen tegen muren
    s.pos.set(h.pos.x, h.pos.y + RIDER_Y, h.pos.z);
    s.vel.copy(h.vel);
    s.onGround = true;

    // hoefgetrappel voor de speler
    if (s.isPlayer && h.speed > 3) {
      const beat = Math.floor(h.gallopPhase / Math.PI);
      if (beat !== h.lastBeat) sfx.playHoof(Math.min(1, h.speed / 10));
      h.lastBeat = beat;
    }

    // vertrappen: vijanden voor een galopperend paard lopen schade op
    if (h.speed > 6) {
      const px = h.pos.x + Math.sin(h.yaw) * 0.9;
      const pz = h.pos.z + Math.cos(h.yaw) * 0.9;
      for (const e of this.soldiers) {
        if (e.team === s.team || !e.alive || e.mounted) continue;
        if (Math.hypot(e.pos.x - px, e.pos.z - pz) > 1.2) continue;
        const last = h.trampleCd.get(e) || -9;
        if (this.time - last < 1) continue;
        h.trampleCd.set(e, this.time);
        e.pos.x += Math.sin(h.yaw) * 1.2 + Math.cos(h.yaw) * 0.6;
        e.pos.z += Math.cos(h.yaw) * 1.2 - Math.sin(h.yaw) * 0.6;
        this.damage(e, 28, s, false);
      }
    }
  }

  // ------------------------------------------------------------------ AI
  updateBot(b, dt) {
    const ai = b.ai;
    const d = this.botDiff();
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.25 + Math.random() * 0.2;
      const t = this.findTarget(b);
      if (t !== ai.target) {
        ai.target = t;
        ai.reactT = d.reaction * (0.7 + Math.random() * 0.6);
      }
      ai.chase = ai.target && regionOf(b.pos.x, b.pos.z) !== regionOf(ai.target.pos.x, ai.target.pos.z)
        ? this.gatePath(b.pos, ai.target.pos)
        : [];
      ai.stuckT += 0.35;
      if (ai.stuckT > 1.5) {
        if (ai.lastPos.distanceTo(b.pos) < 0.8) {
          ai.path = [];
          ai.unstickT = 0.8; // even een willekeurige kant op
          ai.unstickDir = Math.random() * Math.PI * 2;
        }
        ai.lastPos.copy(b.pos);
        ai.stuckT = 0;
      }
    }

    let moveX = 0;
    let moveZ = 0;
    let mag = 1;
    let speed = 4.3;
    const tgt = ai.target && ai.target.alive ? ai.target : null;
    let faceYaw = null;

    if (tgt) {
      const dx = tgt.pos.x - b.pos.x;
      const dz = tgt.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz) || 0.01;
      const fx = dx / dist;
      const fz = dz / dist;
      faceYaw = Math.atan2(dx, dz);

      // wapenkeuze: boogschutters schieten, maar trekken het zwaard van dichtbij
      const ranged = b.role === 'archer' && b.arrows >= 1 && dist > 5;
      if (ranged && b.weapon !== 'bow') b.setWeapon('bow');
      if (!ranged && b.weapon !== 'sword') b.setWeapon('sword');

      if (ai.chase.length) {
        const wp = ai.chase[0];
        const wx = wp.x - b.pos.x;
        const wz = wp.z - b.pos.z;
        const wd = Math.hypot(wx, wz);
        if (wd < 2 && ai.chase.length > 1) ai.chase.shift();
        moveX = wx / (wd || 1);
        moveZ = wz / (wd || 1);
        if (b.weapon === 'sword') faceYaw = Math.atan2(moveX, moveZ);
      } else if (b.weapon === 'bow') {
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) {
          ai.strafeT = 0.8 + Math.random() * 1.6;
          ai.strafe = Math.random() < 0.5 ? -1 : Math.random() < 0.3 ? 0 : 1;
        }
        const fwd = dist > 42 ? 1 : dist < 14 ? -0.7 : 0;
        moveX = fx * fwd + fz * ai.strafe * 0.7;
        moveZ = fz * fwd - fx * ai.strafe * 0.7;
        speed = 3.4;
      } else if (b.mounted) {
        // charge: recht op het doel af, na het passeren even doorrijden en omkeren
        if (ai.passT > 0) {
          ai.passT -= dt;
          moveX = Math.sin(b.mounted.yaw);
          moveZ = Math.cos(b.mounted.yaw);
        } else {
          moveX = fx;
          moveZ = fz;
          if (dist < 2.5) ai.passT = 0.9;
        }
      } else {
        const reach = b.cfg.sword.range * 0.75;
        if (dist > reach) {
          moveX = fx;
          moveZ = fz;
          speed = dist > 12 ? 5.2 : 4.4;
        } else {
          ai.strafeT -= dt;
          if (ai.strafeT <= 0) {
            ai.strafeT = 0.5 + Math.random();
            ai.strafe = Math.random() < 0.5 ? -1 : 1;
          }
          moveX = fz * ai.strafe * 0.5;
          moveZ = -fx * ai.strafe * 0.5;
          speed = 2.5;
        }
      }

      // aanvallen
      ai.reactT -= dt;
      if (ai.reactT <= 0) {
        const aimErr = Math.abs(angleDiff(b.yaw, Math.atan2(dx, dz)));
        if (b.weapon === 'bow') {
          if (aimErr < 0.15 && dist < 85 && !ai.chase.length) this.attack(b, tgt);
        } else {
          const reach = b.cfg.sword.range + (b.mounted ? 0.9 : 0) + 0.3;
          if (aimErr < 0.7 && dist < reach && Math.abs(tgt.pos.y - b.pos.y) < 2) this.attack(b, tgt);
        }
      }
      // pitch voor de boog
      if (b.weapon === 'bow') {
        const dir = ballisticDir(b.eye(_v1), _v2.set(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z), b.cfg.bow.speed, _v3);
        b.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      } else b.pitch *= 0.9;
    } else {
      // patrouilleren (via de poorten van de forten)
      if (b.role === 'archer' && b.arrows >= 1 && b.weapon !== 'bow') b.setWeapon('bow');
      if (!ai.path.length) ai.path = this.planPath(b);
      const wp = ai.path[0];
      const dx = wp.x - b.pos.x;
      const dz = wp.z - b.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < (b.mounted ? 2.5 : 1.5)) ai.path.shift();
      else {
        moveX = dx / dist;
        moveZ = dz / dist;
      }
      b.pitch *= 0.9;
    }

    if (ai.unstickT > 0) {
      ai.unstickT -= dt;
      moveX = Math.sin(ai.unstickDir);
      moveZ = Math.cos(ai.unstickDir);
    }

    // obstakels ontwijken
    if (moveX || moveZ) {
      const len = Math.hypot(moveX, moveZ);
      mag = Math.min(1, len);
      moveX /= len;
      moveZ /= len;
      const o = _v1.set(b.pos.x, (b.mounted ? b.mounted.pos.y : b.pos.y) + 0.6, b.pos.z);
      const look = b.mounted ? 3 : 1.6;
      for (const rot of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const rx = moveX * c - moveZ * s;
        const rz = moveX * s + moveZ * c;
        if (this.rayObstacles(o, _v2.set(rx, 0, rz), look) === Infinity) {
          moveX = rx;
          moveZ = rz;
          break;
        }
      }
    } else mag = 0;

    // kijkrichting
    const want = faceYaw !== null ? faceYaw : moveX || moveZ ? Math.atan2(moveX, moveZ) : b.yaw;
    const turn = (faceYaw !== null ? d.turnRate : 3) * dt;
    b.yaw += THREE.MathUtils.clamp(angleDiff(b.yaw, want), -turn, turn);

    if (b.mounted) this.ride(b, moveX, moveZ, mag, dt);
    else {
      b.vel.x = moveX * speed * mag;
      b.vel.z = moveZ * speed * mag;
      this.moveBody(b, dt);
    }
  }

  findTarget(b) {
    let best = null;
    const maxRange = b.role === 'archer' ? 85 : 70;
    let bestD = maxRange;
    const eye = b.eye(_v1);
    const cur = b.ai.target;
    const fwd = dirFromAngles(b.yaw, 0, _v3);
    for (const s of this.soldiers) {
      if (s.team === b.team || !s.alive) continue;
      const dd = s.pos.distanceTo(b.pos) - (s === cur ? 8 : 0);
      if (dd >= bestD) continue;
      const to = s.eye(_v2).sub(eye);
      const len = to.length();
      const dot = (to.x * fwd.x + to.z * fwd.z) / len;
      if (dot < -0.2 && len > 12 && this.time - b.lastHurtT > 1.5) continue;
      if (this.rayObstacles(eye, to.divideScalar(len), len) < len) continue;
      best = s;
      bestD = dd;
    }
    return best;
  }

  // Route van A naar B via de poorten als een van beide in een fort ligt.
  gatePath(from, to) {
    const path = [];
    let cur = from;
    const r1 = regionOf(from.x, from.z);
    const r2 = regionOf(to.x, to.z);
    const pick = (team, a, b) => {
      let best = null;
      let bd = Infinity;
      for (const g of fortGates(team)) {
        const d = Math.hypot(g.x - a.x, g.z - a.z) + Math.hypot(g.x - b.x, g.z - b.z);
        if (d < bd) {
          bd = d;
          best = g;
        }
      }
      return best;
    };
    if (r1 !== 'field' && r1 !== r2) {
      const g = pick(r1, cur, to);
      path.push(new THREE.Vector3(g.x + g.nx * 3, 0, g.z + g.nz * 3));
      const out = new THREE.Vector3(g.x - g.nx * 4, 0, g.z - g.nz * 4);
      path.push(out);
      cur = out;
    }
    if (r2 !== 'field' && r2 !== r1) {
      const g = pick(r2, cur, to);
      path.push(new THREE.Vector3(g.x - g.nx * 4, 0, g.z - g.nz * 4));
      path.push(new THREE.Vector3(g.x + g.nx * 3, 0, g.z + g.nz * 3));
    }
    path.push(new THREE.Vector3(to.x, 0, to.z));
    return path;
  }

  planPath(b) {
    const enemySide = b.team === 'ottoman' ? 1 : -1;
    let goal;
    if (b.role === 'archer' || Math.random() < 0.55) {
      goal = new THREE.Vector3((Math.random() * 2 - 1) * 45, 0, (Math.random() * 2 - 1) * 36 + enemySide * 4);
    } else {
      // aanval op het vijandelijke fort
      goal = new THREE.Vector3((Math.random() * 2 - 1) * 16, 0, enemySide * (54 + Math.random() * 18));
    }
    return this.gatePath(b.pos, goal);
  }

  // ------------------------------------------------------------------ physics
  moveBody(s, dt) {
    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;
    s.vel.y -= 16 * dt;
    s.pos.y += s.vel.y * dt;

    let floor = 0;
    const r = s.radius;
    for (const o of this.obstacles) {
      if (o.min.y > s.pos.y + 1.9) continue; // poortdorpel: eronder door
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
        const ex = [o.min.x - r - s.pos.x, o.max.x + r - s.pos.x];
        const ez = [o.min.z - r - s.pos.z, o.max.z + r - s.pos.z];
        const mx = Math.abs(ex[0]) < Math.abs(ex[1]) ? ex[0] : ex[1];
        const mz = Math.abs(ez[0]) < Math.abs(ez[1]) ? ez[0] : ez[1];
        if (Math.abs(mx) < Math.abs(mz)) s.pos.x += mx;
        else s.pos.z += mz;
      }
    }
    // soldaten en paarden duwen elkaar weg
    const isHorse = s instanceof Horse;
    const pushFrom = (ox, oz, rr) => {
      const dx = s.pos.x - ox;
      const dz = s.pos.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        s.pos.x += (dx / d) * push;
        s.pos.z += (dz / d) * push;
      }
    };
    for (const o of this.soldiers) {
      if (o === s || !o.alive || o.mounted || (isHorse && o === s.rider)) continue;
      if (isHorse && s.rider && o.team !== s.rider.team) continue; // vijanden worden vertrapt
      pushFrom(o.pos.x, o.pos.z, r + o.radius - 0.05);
    }
    for (const h of this.horses) {
      if (h === s || h === s.mounted) continue;
      pushFrom(h.pos.x, h.pos.z, r + h.radius);
    }
    s.pos.x = THREE.MathUtils.clamp(s.pos.x, -MAP_X, MAP_X);
    s.pos.z = THREE.MathUtils.clamp(s.pos.z, -MAP_Z, MAP_Z);

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

  // ray tegen staande cilinders (vijandelijke soldaten, optioneel paarden)
  raySoldiers(o, d, maxT, shooter, minT, withHorses = false) {
    let hit = null;
    let best = maxT;
    const test = (px, py, pz, radius, height, obj) => {
      const ox = o.x - px;
      const oz = o.z - pz;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-8) return;
      const bq = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - radius * radius;
      const disc = bq * bq - 4 * a * c;
      if (disc < 0) return;
      const sq = Math.sqrt(disc);
      for (const t of [(-bq - sq) / (2 * a), (-bq + sq) / (2 * a)]) {
        if (t < minT || t >= best) continue;
        const y = o.y + d.y * t - py;
        if (y >= 0 && y <= height) {
          best = t;
          hit = { obj, soldier: obj instanceof Soldier ? obj : null, t, head: y > 1.62 && obj instanceof Soldier };
          return;
        }
      }
    };
    for (const s of this.soldiers) {
      if (s === shooter || !s.alive || s.team === shooter.team) continue;
      test(s.pos.x, s.pos.y, s.pos.z, s.radius, s.height, s);
    }
    if (withHorses) for (const h of this.horses) if (h !== shooter.mounted) test(h.pos.x, h.pos.y, h.pos.z, 0.55, 1.65, h);
    return hit;
  }

  // ------------------------------------------------------------------ arrows & fx
  _initFx() {
    const shaft = new THREE.BoxGeometry(0.025, 0.8, 0.025);
    const tip = new THREE.ConeGeometry(0.03, 0.09, 4).translate(0, 0.44, 0);
    const f1 = new THREE.BoxGeometry(0.06, 0.14, 0.004).translate(0, -0.33, 0);
    const f2 = new THREE.BoxGeometry(0.004, 0.14, 0.06).translate(0, -0.33, 0);
    const parts = [shaft, tip, f1, f2].map((g) => (g.index ? g.toNonIndexed() : g));
    this.arrowGeo = mergeGeometries(parts.slice(0, 2));
    this.fletchGeo = mergeGeometries(parts.slice(2));
    this.arrowMat = new THREE.MeshLambertMaterial({ color: '#b89a64' });
    this.fletchMat = {
      ottoman: new THREE.MeshLambertMaterial({ color: '#d0202e' }),
      byzantine: new THREE.MeshLambertMaterial({ color: '#f1efe6' }),
    };
    this.puffGeo = new THREE.SphereGeometry(1, 8, 6);
  }

  launchArrow(shooter, origin, dir) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.arrowGeo, this.arrowMat));
    g.add(new THREE.Mesh(this.fletchGeo, this.fletchMat[shooter.team]));
    g.position.copy(origin);
    g.quaternion.setFromUnitVectors(UP, dir);
    this.scene.add(g);
    this.arrows.push({
      mesh: g,
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(shooter.cfg.bow.speed),
      shooter,
      damage: shooter.cfg.bow.damage,
      life: 6,
    });
  }

  updateArrows(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      a.vel.y -= GRAVITY * dt;
      const step = _v1.copy(a.vel).multiplyScalar(dt);
      const len = step.length();
      const dir = _v2.copy(step).divideScalar(len);
      const tObs = this.rayObstacles(a.pos, dir, len);
      const hit = this.raySoldiers(a.pos, dir, Math.min(tObs, len), a.shooter, 0, true);
      let done = false;
      if (hit) {
        const at = a.pos.clone().addScaledVector(dir, hit.t);
        if (hit.soldier) {
          this.damage(hit.soldier, a.damage, a.shooter, hit.head);
          this.spawnPuff(at, '#8b1a1a', 0.1, 6);
          this.scene.remove(a.mesh);
        } else this.stick(a, at, dir); // in een paardenlijf: geen schade aan de ruiter
        done = true;
      } else if (tObs <= len) {
        const at = a.pos.clone().addScaledVector(dir, tObs);
        this.stick(a, at, dir);
        this.spawnPuff(at, '#b8a888', 0.1, 3);
        sfx.playThunk(this.volumeAt(at, 25));
        done = true;
      } else {
        a.pos.add(step);
        a.mesh.position.copy(a.pos);
        a.mesh.quaternion.setFromUnitVectors(UP, dir);
      }
      if (done || a.life <= 0) {
        if (!done) this.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
      }
    }
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.stuck.splice(i, 1);
      }
    }
  }

  stick(a, at, dir) {
    a.mesh.position.copy(at).addScaledVector(dir, -0.25);
    a.mesh.quaternion.setFromUnitVectors(UP, dir);
    this.stuck.push({ mesh: a.mesh, life: 10 });
    if (this.stuck.length > 70) this.scene.remove(this.stuck.shift().mesh);
  }

  spawnPuff(at, color, size, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
      m.position.copy(at);
      m.scale.setScalar(size * (0.5 + Math.random() * 0.5));
      this.scene.add(m);
      this.particles.push({
        mesh: m, life: 0.4, max: 0.4,
        v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3),
      });
    }
  }

  updateFx(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.v, dt);
      p.v.y -= 9 * dt;
      p.mesh.material.opacity = 0.8 * Math.max(0, p.life / p.max);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
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
  updateCamera() {
    const p = this.player;
    if (!p || this.state === 'attract' || this.state === 'idle') {
      // filmische rondvlucht voor het hoofdmenu
      const t = (performance.now() / 1000) * 0.05;
      this.camera.position.set(Math.sin(t) * 62, 26 + Math.sin(t * 2) * 5, Math.cos(t) * 80);
      this.camera.lookAt(0, 2, 0);
      return;
    }
    const yaw = p.yaw;
    const pitch = p.alive ? p.pitch : -0.4;
    const dir = dirFromAngles(yaw, pitch, _v1);
    const side = p.mounted ? 0.6 : 0.85;
    const pivot = _v2.set(
      p.pos.x - Math.cos(yaw) * side,
      p.pos.y + (p.alive ? 1.85 : 0.8),
      p.pos.z + Math.sin(yaw) * side,
    );
    const back = _v3.copy(dir).negate();
    const dist = !p.alive ? 6 : p.mounted ? 4.8 : 3.4;
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
