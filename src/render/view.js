import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CrowdRenderer } from './crowd.js';
import { HUMAN_NB, HORSE_NB, SIEGE_NB, makePose, poseHuman, poseHorse, poseSiege, setRoot, writeBones, HUMAN_SKEL, HORSE_SKEL, SIEGE_SKEL, HUMAN_BIND } from './rig.js';
import { buildUnitModel, buildHorseModel, buildSiegeModel, buildBanner, unitTextures, neutralTextures } from './models.js';
import { WorldView } from './world.js';
import { FxView } from './fx.js';
import { UNITS, WEAPONS, FACTIONS } from '../sim/data.js';

const SKY_TOP = new THREE.Color('#6f9ccc');
const SKY_HOR = new THREE.Color('#e8dcc4');

const COATS = [[0.42, 0.25, 0.14], [0.1, 0.08, 0.07], [0.55, 0.32, 0.16], [0.72, 0.7, 0.66], [0.3, 0.2, 0.13], [0.86, 0.84, 0.8]];
const SKIN = [[1, 1, 1], [0.93, 0.89, 0.86], [1.06, 1.0, 0.95], [0.86, 0.79, 0.74], [0.98, 0.94, 0.9]];

const _proj = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

export class GameView {
  constructor(host, quality = 'high') {
    this.quality = quality;
    const low = quality === 'low';
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1 : quality === 'medium' ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.15, 900);
    this.scene.fog = new THREE.Fog(SKY_HOR.clone(), 120, 520);
    this._sky();
    this._lights();
    if (!low) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.35;
    }
    this.camState = { mode: 'menu', yaw: 0, pitch: -0.1, dist: 3.4, t: 0, x: 0, y: 0, z: 0 };
    this.models = new Map();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _sky() {
    const geo = new THREE.SphereGeometry(800, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, hor: { value: SKY_HOR }, sunDir: { value: new THREE.Vector3(-0.45, 0.55, -0.7).normalize() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.85,0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.18);
          if (vDir.y < 0.0) c = hor; gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight('#dfe8f5', '#7a6a48', 1.3);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d8', 2.6);
    this.sunDir = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
    if (this.quality !== 'low') {
      this.sun.castShadow = true;
      const size = this.quality === 'high' ? 2048 : 1024;
      this.sun.shadow.mapSize.set(size, size);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -70;
      c.right = c.top = 70;
      c.near = 1;
      c.far = 400;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.06;
    }
    this.scene.add(this.sun, this.sun.target);
  }

  // ------------------------------------------------------------------ potje opbouwen
  setMatch(match) {
    this.disposeMatch();
    if (!match) return;
    this.match = match;
    this.world = new WorldView(this.scene, match.map, match, this.quality);
    this.fx = new FxView(this.scene, this.quality);
    this.fx.syncFog(this.scene.fog);
    const cap = Math.max(400, match.teams.reduce((a, t) => a + (t.cap || match.cap), 0) * 1.6 + 120);
    this.humans = new CrowdRenderer(this.scene, { nb: HUMAN_NB, capacity: Math.round(cap), quality: this.quality, name: 'mens', bind: HUMAN_BIND });
    this.horses = new CrowdRenderer(this.scene, { nb: HORSE_NB, capacity: Math.round(cap * 0.5), quality: this.quality, name: 'paard' });
    this.siege = new CrowdRenderer(this.scene, { nb: SIEGE_NB, capacity: 64, quality: this.quality, name: 'tuig' });
    this.hPose = makePose(HUMAN_SKEL);
    this.pPose = makePose(HORSE_SKEL);
    this.sPose = makePose(SIEGE_SKEL);
    this.info = new Map();
    // modellen voor alle eenheden van de facties in dit potje
    for (const t of match.teams) {
      for (const def of Object.values(UNITS)) {
        if (def.faction !== t.id) continue;
        if (['siege', 'ram', 'tower'].includes(def.role)) this._siegeType(def);
        else {
          this._humanType(def, false);
          if (def.role === 'guard') this._humanType(def, true);
        }
      }
      this._horseType(t.id);
    }
  }

  _humanType(def, banner) {
    const key = def.id + (banner ? '+vaandel' : '');
    if (this.humans.types.has(key)) return;
    const weapons = def.weapons.map((w) => WEAPONS[w]);
    const models = [0, 1, 2].map((l) => buildUnitModel(def, weapons, l));
    const geos = models.map((m, l) => {
      if (!banner) return m.geo;
      const f = FACTIONS[def.faction];
      return mergeGeometries([m.geo, buildBanner(f.color, f.color2, Math.min(1, l))]);
    });
    const q = this.quality;
    // dichtbij het volle lichaam (met schaduw), daarna steeds eenvoudiger
    this.humans.addType(
      key,
      [
        { geo: geos[0], maxDist: q === 'low' ? 8 : 16, shadow: q !== 'low' },
        { geo: geos[1], maxDist: q === 'low' ? 30 : 55, shadow: q === 'high' },
        { geo: geos[2], maxDist: Infinity, shadow: false },
      ],
      unitTextures(def, q),
    );
    this.info.set(key, models[0].info);
  }

  _horseType(faction) {
    const key = 'paard:' + faction;
    if (this.horses.types.has(key)) return;
    this.horses.addType(key, [
      { geo: buildHorseModel(faction, 0), maxDist: this.quality === 'high' ? 70 : 40, shadow: true },
      { geo: buildHorseModel(faction, 1), maxDist: Infinity, shadow: false },
    ], neutralTextures());
  }

  _siegeType(def) {
    const kind = def.role === 'siege' ? def.weapons[0] : def.role;
    const key = 'tuig:' + kind;
    if (this.siege.types.has(key)) return;
    this.siege.addType(key, [{ geo: buildSiegeModel(kind, 0), maxDist: Infinity, shadow: true }], neutralTextures());
  }

  disposeMatch() {
    if (!this.match) return;
    this.scene.remove(this.world.group);
    this.world.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const c of [this.humans, this.horses, this.siege]) c.dispose();
    for (const s of [this.fx.normal, this.fx.additive]) this.scene.remove(s.mesh);
    for (const m of Object.values(this.fx.proj)) this.scene.remove(m);
    this.scene.remove(this.fx.stuck);
    this.match = null;
  }

  // ------------------------------------------------------------------ per frame
  render(dt, time) {
    const m = this.match;
    // ook draaien van het toestel opvangen als er geen resize-event komt
    const c = this.renderer.domElement;
    if (c.width !== Math.floor(window.innerWidth * this.renderer.getPixelRatio()) || c.height !== Math.floor(window.innerHeight * this.renderer.getPixelRatio())) this.resize();
    if (!m) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this._camera(dt, time);
    // schaduwcamera volgt het brandpunt
    const f = this.focus || new THREE.Vector3();
    this.sun.position.set(f.x + this.sunDir.x * 160, f.y + this.sunDir.y * 160, f.z + this.sunDir.z * 160);
    this.sun.target.position.copy(f);
    this.sky.position.copy(this.camera.position);

    this.world.update(time);
    const tp = performance.now();
    this._units(time);
    this.poseMs = performance.now() - tp;
    this.fx.update(dt, m.projectiles);
    this.renderer.render(this.scene, this.camera);
  }

  _units(time) {
    const m = this.match;
    const cam = this.camera.position;
    _pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const H = this.humans;
    const P = this.horses;
    const S = this.siege;
    H.begin();
    P.begin();
    S.begin();
    const maxD = this.quality === 'low' ? 170 : 260;
    for (const u of m.units) {
      const dx = u.x - cam.x;
      const dz = u.z - cam.z;
      const d = Math.hypot(dx, dz);
      if (d > maxD) continue;
      _sphere.center.set(u.x, u.y + 1.2, u.z);
      _sphere.radius = u.siege ? 8 : u.mounted ? 2.5 : 1.6;
      if (!_frustum.intersectsSphere(_sphere)) continue;
      if (u.siege) {
        const kind = u.role === 'siege' ? u.def.weapons[0] : u.role;
        S.add('tuig:' + kind, d, u);
        continue;
      }
      const key = u.def.id + (u.banner ? '+vaandel' : '');
      // camera tegen een muur gedrukt: eigen poppetje niet tekenen, anders zie je alleen de binnenkant van het hoofd
      if (u.isPlayer && u.alive && this.hidePlayer) continue;
      H.add(key, d, u);
      if (u.mounted) P.add('paard:' + u.def.faction, d, u);
    }
    const hPose = this.hPose;
    const info = this.info;
    H.end((u, data, o, to) => {
      const key = u.def.id + (u.banner ? '+vaandel' : '');
      const inf = info.get(key);
      poseHuman(hPose, u, inf, time, u.isPlayer && u.mounted && u.lookYaw != null ? clampAngle(u.lookYaw - u.yaw, 1.2) : 0);
      const tilt = inf.deathTilt || 0;
      let x = u.x;
      let y = u.y;
      let z = u.z;
      if (u.mounted) {
        if (u.alive) y += 0.8 + Math.sin(u.gait * 2) * 0.04 * Math.min(1, u.speed / 6);
        else {
          // van het paard gevallen
          const k = Math.min(1, u.deadT / 0.6);
          y += 0.8 * (1 - k);
          x += Math.cos(u.yaw) * 1.1 * k;
          z -= Math.sin(u.yaw) * 1.1 * k;
        }
      }
      if (!u.alive && u.deadT > 21) y -= (u.deadT - 21) * 0.25;
      const root = setRoot(x, y + Math.abs(tilt) * 0.06, z, u.yaw, tilt, inf.deathRoll || 0, inf.scale);
      writeBones(data, o, root, hPose, HUMAN_NB);
      const s = SKIN[u.variant % SKIN.length];
      data[to] = s[0];
      data[to + 1] = s[1];
      data[to + 2] = s[2];
    });
    const pPose = this.pPose;
    P.end((u, data, o, to) => {
      const r = poseHorse(pPose, u, time);
      let y = u.y - (r.drop || 0) * 0.5;
      if (!u.alive && u.deadT > 21) y -= (u.deadT - 21) * 0.3;
      const root = setRoot(u.x, y, u.z, u.yaw, 0, r.tilt || 0, 1);
      writeBones(data, o, root, pPose, HORSE_NB);
      const c = u.isLeader ? (u.def.faction === 'ottoman' ? COATS[5] : COATS[1]) : COATS[u.variant % COATS.length];
      data[to] = c[0];
      data[to + 1] = c[1];
      data[to + 2] = c[2];
    });
    const sPose = this.sPose;
    S.end((u, data, o, to) => {
      const kind = u.role === 'siege' ? u.def.weapons[0] : u.role;
      const r = poseSiege(sPose, u, kind, time);
      const root = setRoot(u.x, u.y - (r.drop || 0), u.z, u.yaw, 0, r.tilt || 0, 1);
      writeBones(data, o, root, sPose, SIEGE_NB);
      const c = new THREE.Color(FACTIONS[u.def.faction].color);
      data[to] = c.r;
      data[to + 1] = c.g;
      data[to + 2] = c.b;
    });
  }

  // ------------------------------------------------------------------ camera
  _camera(dt, time) {
    const m = this.match;
    const cs = this.camState;
    const cam = this.camera;
    const p = m.player;
    if (cs.mode === 'menu' || !p) {
      // filmische rondvlucht over het slagveld
      const t = time * 0.035;
      const R = m.map.R * 0.9;
      cam.position.set(Math.sin(t) * R, 34 + Math.sin(t * 1.7) * 8, Math.cos(t) * R);
      this.focus = (this.focus || new THREE.Vector3()).set(0, 2, 0);
      cam.lookAt(this.focus);
      return;
    }
    let tx = p.x;
    let ty = p.y;
    let tz = p.z;
    let yaw = cs.yaw;
    let pitch = cs.pitch;
    let dist = p.mounted ? 4.9 : 3.3;
    let side = p.mounted ? 0.55 : 0.75;
    let height = p.mounted ? 2.55 : 1.75;
    if (!p.alive) {
      // langzaam rond het gevallen lichaam draaien
      yaw = cs.yaw + time * 0.15;
      pitch = -0.45;
      dist = 7;
      side = 0;
      height = 0.8;
    }
    const cp = Math.cos(pitch);
    const dir = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    const pivot = new THREE.Vector3(tx - Math.cos(yaw) * side, ty + height, tz + Math.sin(yaw) * side);
    // camera niet door muren
    const back = dir.clone().negate();
    const hit = m.obGrid.raycast(pivot.x, pivot.y, pivot.z, back.x, back.y, back.z, dist + 0.4, (o) => o.kind !== 'tree');
    let d = hit ? Math.max(0.4, hit.t - 0.35) : dist;
    if (pivot.y + back.y * d < 0.3) d = Math.max(0.4, (pivot.y - 0.3) / Math.max(0.01, -back.y));
    cam.position.copy(pivot).addScaledVector(back, d);
    this.hidePlayer = d < (p.mounted ? 2.2 : 1.5);
    cam.lookAt(pivot.clone().addScaledVector(dir, 30));
    this.focus = (this.focus || new THREE.Vector3()).set(tx, 0, tz);
    this.camDir = dir;
  }

  // Punt in de wereld onder het vizier (voor schieten)
  aimPoint() {
    const m = this.match;
    const p = m.player;
    const o = this.camera.position;
    const d = this.camDir || new THREE.Vector3(0, 0, 1);
    const minT = o.distanceTo(new THREE.Vector3(p.x, p.y + 1.6, p.z)) + 0.5;
    const hit = m.obGrid.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 250, (ob) => ob.kind !== 'tree' || true);
    let best = hit ? hit.t : 250;
    if (d.y < 0) best = Math.min(best, -o.y / d.y);
    for (const u of m.units) {
      if (!u.alive || u.alliance === p.alliance) continue;
      const vx = u.x - o.x;
      const vz = u.z - o.z;
      const t = vx * d.x + vz * d.z;
      if (t < minT || t > best) continue;
      const px = o.x + d.x * t;
      const pz = o.z + d.z * t;
      if (Math.hypot(px - u.x, pz - u.z) > u.radius + 0.15) continue;
      const py = o.y + d.y * t - u.y;
      if (py < 0 || py > u.height) continue;
      best = t;
    }
    best = Math.max(best, minT + 1);
    return { x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best };
  }

  // Schermposities van leiders (voor de zwevende levensbalken)
  leaderScreens() {
    const out = [];
    const m = this.match;
    if (!m) return out;
    for (const t of m.teams) {
      const L = t.leader;
      if (!L || !L.alive || L.isPlayer) continue;
      const d = this.camera.position.distanceTo(_proj.set(L.x, L.y, L.z));
      if (d > 110) continue;
      _proj.set(L.x, L.y + (L.mounted ? 3.4 : 2.6), L.z).project(this.camera);
      if (_proj.z > 1 || Math.abs(_proj.x) > 1.05 || Math.abs(_proj.y) > 1.05) continue;
      out.push({ L, team: t, x: (_proj.x * 0.5 + 0.5) * window.innerWidth, y: (-_proj.y * 0.5 + 0.5) * window.innerHeight, d });
    }
    return out;
  }

  // ------------------------------------------------------------------ gebeurtenissen → effecten
  events(list, sfx) {
    const fx = this.fx;
    const m = this.match;
    const cam = this.camera.position;
    const near = (x, z, r = 90) => Math.hypot(x - cam.x, z - cam.z) < r;
    const vol = (x, y, z, r) => Math.max(0, 1 - Math.hypot(x - cam.x, y - cam.y, z - cam.z) / r);
    for (const e of list) {
      switch (e.t) {
        case 'shoot': {
          const w = e.w;
          if (w.smoke && near(e.x, e.z, 160)) {
            const dx = Math.sin(e.u.yaw);
            const dz = Math.cos(e.u.yaw);
            const sx = e.x + dx * (w.kind === 'siege' ? 2.4 : 0.9);
            const sz = e.z + dz * (w.kind === 'siege' ? 2.4 : 0.9);
            fx.emit('flash', sx, e.y + 0.1, sz, 1, { size: w.kind === 'siege' ? 4 : 1 });
            fx.emit('smoke', sx, e.y, sz, w.kind === 'siege' ? 22 : 7, { dir: [dx, 0, dz], speed: 1.5, size: w.kind === 'siege' ? 3 : 1, spread: w.kind === 'siege' ? 1.5 : 0.3 });
          }
          if (w.proj === 'cannonball') {
            fx.emit('flash', e.x, e.y, e.z, 1, { size: 5 });
            fx.emit('smoke', e.x, e.y, e.z, 26, { size: 3.2, spread: 2, speed: 2, dir: [Math.sin(e.u.yaw), 0, Math.cos(e.u.yaw)] });
          }
          sfx.shot(w, vol(e.x, e.y, e.z, w.kind === 'siege' ? 600 : w.smoke ? 220 : 90), e.u.isPlayer);
          break;
        }
        case 'swing':
          if (near(e.u.x, e.u.z, 40)) sfx.swing(e.w, vol(e.u.x, 1, e.u.z, 35));
          break;
        case 'hurt': {
          const u = e.u;
          if (!near(u.x, u.z, 120)) break;
          const y = u.y + (u.mounted ? 2.1 : 1.3);
          if (e.blocked) {
            fx.emit('spark', u.x, y, u.z, 6);
            sfx.clash(vol(u.x, y, u.z, 45));
          } else if (e.type !== 'fire' && e.type !== 'siege') {
            fx.emit('blood', u.x, y, u.z, e.melee ? 6 : 4, { spread: 0.2 });
            if (e.melee) sfx.flesh(vol(u.x, y, u.z, 40));
          }
          if (u.isPlayer) sfx.hurt();
          if (e.by && e.by.isPlayer) sfx.hit(e.head);
          if (e.charge) sfx.charge(vol(u.x, y, u.z, 60));
          break;
        }
        case 'phit':
          if (e.u.siege && near(e.x, e.z)) fx.emit('debris', e.x, e.y, e.z, 3, { speed: 0.4 });
          break;
        case 'stick':
          if (e.kind === 'arrow' || e.kind === 'bolt' || e.kind === 'javelin') fx.addStuck(e.x, e.y, e.z, e.dx, e.dy, e.dz);
          if (near(e.x, e.z, 70)) {
            fx.emit('dust', e.x, e.y, e.z, e.kind === 'bullet' ? 4 : 2, { size: 0.3, speed: 0.3 });
            if (e.kind === 'bullet') fx.emit('spark', e.x, e.y, e.z, 4);
            sfx.thunk(vol(e.x, e.y, e.z, 35));
          }
          break;
        case 'impact': {
          const big = e.kind === 'cannonball';
          fx.emit('dust', e.x, e.y + 0.5, e.z, big ? 30 : 22, { size: big ? 3.2 : 2.6, spread: 2.5, speed: 2.5 });
          fx.emit('debris', e.x, e.y + 0.5, e.z, big ? 18 : 12, { speed: 1 });
          sfx.impact(vol(e.x, e.y, e.z, 400), big);
          if (m.player) this.shake = Math.max(this.shake || 0, vol(e.x, e.y, e.z, 90) * 0.5);
          break;
        }
        case 'structHit':
          if (e.type === 'siege' || e.type === 'fire') break;
          if (e.st.gate && near(e.st.x, e.st.z, 60)) {
            fx.emit('debris', e.st.x, 2.5, e.st.z, 2, { speed: 0.3 });
            sfx.gateHit(vol(e.st.x, 3, e.st.z, 120));
          }
          break;
        case 'structDestroyed': {
          const st = e.st;
          fx.emit('dust', st.x, st.h * 0.5, st.z, 70, { size: 5, spread: Math.max(st.ob.hx, st.ob.hz) * 1.5, speed: 3 });
          fx.emit('debris', st.x, st.h * 0.6, st.z, 30, { speed: 1.6 });
          sfx.collapse(vol(st.x, 5, st.z, 600));
          if (m.player) this.shake = Math.max(this.shake || 0, vol(st.x, 5, st.z, 160));
          break;
        }
        case 'fire': {
          const u = e.u;
          const dx = Math.sin(u.yaw);
          const dz = Math.cos(u.yaw);
          for (let k = 1; k < 10; k++) fx.emit('fire', u.x + dx * k * 1.05, 1.3, u.z + dz * k * 1.05, 3, { dir: [dx, 0, dz], speed: 3, size: 0.6 + k * 0.12, spread: 0.3 + k * 0.08 });
          sfx.greekFire(vol(u.x, 1, u.z, 90));
          break;
        }
        case 'kill':
          if (e.u.siege && near(e.u.x, e.u.z, 200)) {
            fx.emit('dust', e.u.x, 2, e.u.z, 25, { size: 2.5, spread: 2 });
            fx.emit('fire', e.u.x, 2, e.u.z, 20, { size: 1.6, spread: 2 });
          } else if (!e.rout && near(e.u.x, e.u.z, 60)) sfx.death(vol(e.u.x, 1, e.u.z, 45));
          break;
        case 'cry':
          fx.emit('dust', e.u.x, 0.3, e.u.z, 16, { size: 1.2, spread: 6 });
          sfx.warCry(e.u.def.faction, vol(e.u.x, 2, e.u.z, 200));
          break;
        case 'climb':
          break;
        default:
          break;
      }
    }
    // brandende eenheden
    if (m.tick % 4 === 0) for (const u of m.units) if (u.alive && u.burnT > 0 && near(u.x, u.z, 80)) fx.emit('fire', u.x, u.y + 1.1, u.z, 1, { size: 0.5, spread: 0.3 });
  }
}

function clampAngle(a, lim) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.max(-lim, Math.min(lim, a));
}
