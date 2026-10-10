import { Capacitor } from '@capacitor/core';
import { Match } from './sim/match.js';
import { FACTIONS, FACTION_IDS, UNITS, WEAPONS, LEADERS, MODES, DIFFICULTIES, MATCH_LENGTHS, TROOP_SIZES, DEFAULT_SETTINGS } from './sim/data.js';
import { GameView } from './render/view.js';
import { flagDataURL } from './render/textures.js';
import { Hud, unitBlurb } from './ui/hud.js';
import { Controls } from './controls.js';
import { initAudio, sfx, setVolumes, startMusic, stopMusic, setBattleIntensity } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- native (Capacitor)
(async () => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.hide();
  } catch (e) { /* niet beschikbaar */ }
  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    await ScreenOrientation.lock({ orientation: 'landscape' });
  } catch (e) { /* niet beschikbaar */ }
})();

// ---------------------------------------------------------------- instellingen
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('fetih.' + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('fetih.' + k, JSON.stringify(v));
    } catch (e) { /* privévenster */ }
  },
};
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const prefs = store.get('prefs', {
  master: 80, music: 45, sfx: 90, sens: 100,
  quality: isTouch ? (window.devicePixelRatio > 2.5 ? 'low' : 'medium') : 'high',
  fps: false, invert: false,
});
const setup = { ...DEFAULT_SETTINGS, ...store.get('setup', {}) };
if (isTouch && !store.get('setup', null)) setup.troops = 'small';

// ---------------------------------------------------------------- kernobjecten
const controls = new Controls($('touch-zone'));
controls.sensitivity = prefs.sens / 100;
const hud = new Hud();
let view = new GameView($('game'), prefs.quality);
let match = null;
let state = 'menu'; // menu | loading | playing | paused | over
let screenStack = ['menu'];
let camYaw = 0;
let camPitch = -0.08;
setVolumes({ master: prefs.master / 100, music: prefs.music / 100, sfx: prefs.sfx / 100 });
$('fps').classList.toggle('hidden', !prefs.fps);

// ---------------------------------------------------------------- schermen
const SCREENS = ['menu', 'setup', 'role', 'loading', 'pause', 'settings', 'help', 'results'];
function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  const inGame = id === null;
  $('hud').classList.toggle('hidden', !(inGame || id === 'pause' || id === 'settings' || id === 'help' || id === 'role') || !match || state === 'menu');
  document.body.classList.toggle('in-game', inGame);
  if (id) screenStack.push(id);
}
function back() {
  screenStack.pop();
  const prev = screenStack.pop() || 'menu';
  if (prev === 'game') {
    show(null);
    return;
  }
  show(prev);
}

// Achtergrondslag in het hoofdmenu
function startAttract() {
  const picks = [['ottoman', 'byzantine'], ['ottoman', 'genoa', 'byzantine'], ['hungary', 'ottoman'], ['venice', 'serbia', 'ottoman', 'byzantine']];
  const teams = picks[Math.floor(Math.random() * picks.length)];
  match = new Match({ teams, mode: 'historical', difficulty: 'normal', length: 'short', troops: 'small', seed: Math.floor(Math.random() * 1e6), withPlayer: false });
  // een beetje vooruitspoelen zodat er al gevochten wordt
  for (let i = 0; i < 60 * 25; i++) match.update(1 / 30);
  match.events.length = 0;
  view.setMatch(match);
  view.camState.mode = 'menu';
  hud.reset(match);
  state = 'menu';
}

// ---------------------------------------------------------------- potje instellen
function seg(id, options, cur, onPick, render = (o) => o.label) {
  const el = $(id);
  el.innerHTML = '';
  for (const [k, o] of Object.entries(options)) {
    const b = document.createElement('button');
    b.innerHTML = render(o, k);
    b.className = k === cur ? 'on' : '';
    b.onclick = () => {
      sfx.ui();
      onPick(k);
    };
    el.appendChild(b);
  }
}

function renderSetup() {
  const grid = $('faction-grid');
  grid.innerHTML = '';
  for (const id of FACTION_IDS) {
    const f = FACTIONS[id];
    const on = setup.teams.includes(id);
    const b = document.createElement('button');
    b.className = 'fac' + (on ? ' on' : '');
    b.innerHTML = `<img alt="" src="${flagDataURL(id, 128, 80)}"><div><div class="fn">${f.name}</div><div class="fl">${UNITS[LEADERS[id].unit].name}</div><div class="fs">${f.style}</div></div><span class="tick">✔</span>`;
    b.onclick = () => {
      sfx.ui();
      if (on && setup.teams.length > 2) setup.teams = setup.teams.filter((t) => t !== id);
      else if (!on && setup.teams.length < 6) setup.teams = FACTION_IDS.filter((t) => t === id || setup.teams.includes(t));
      if (!setup.teams.includes(setup.playerTeam)) setup.playerTeam = setup.teams[0];
      renderSetup();
    };
    grid.appendChild(b);
  }
  seg('seg-mode', MODES, setup.mode, (k) => {
    setup.mode = k;
    renderSetup();
  });
  // bondgenootschappen tonen
  let hint = MODES[setup.mode].desc;
  if (setup.mode === 'historical') {
    const sides = {};
    for (const t of setup.teams) (sides[FACTIONS[t].side] = sides[FACTIONS[t].side] || []).push(FACTIONS[t].short);
    if (Object.keys(sides).length < 2) hint = 'Alle gekozen rijken stonden aan dezelfde kant — er wordt ieder voor zich gevochten.';
    else hint = 'Deze verdeling: ' + Object.values(sides).map((s) => s.join(' + ')).join('  tegen  ');
  }
  $('mode-hint').textContent = hint;
  const teamOpts = Object.fromEntries(setup.teams.map((t) => [t, { label: FACTIONS[t].short }]));
  seg('seg-team', teamOpts, setup.playerTeam, (k) => {
    setup.playerTeam = k;
    renderSetup();
  }, (o, k) => `<img alt="" src="${flagDataURL(k, 44, 28)}">${o.label}`);
  seg('seg-diff', DIFFICULTIES, setup.difficulty, (k) => {
    setup.difficulty = k;
    renderSetup();
  });
  seg('seg-length', MATCH_LENGTHS, setup.length, (k) => {
    setup.length = k;
    renderSetup();
  });
  seg('seg-troops', TROOP_SIZES, setup.troops, (k) => {
    setup.troops = k;
    renderSetup();
  });
  const total = TROOP_SIZES[setup.troops].perTeam * setup.teams.length;
  $('perf-hint').textContent = `Totaal ±${total} soldaten tegelijk op het slagveld.` + (total > 300 && isTouch ? ' Dat is veel voor een telefoon — kies bij haperingen "Klein" of grafische kwaliteit "Laag".' : '');
  store.set('setup', setup);
}

let roleMode = 'start';
function renderRoles() {
  const t = setup.playerTeam;
  const f = FACTIONS[t];
  $('role-title').textContent = `Wat wil je worden in het leger van de ${f.short}?`;
  const ids = [...f.roster, LEADERS[t].unit];
  if (!ids.includes(setup.playerUnit)) setup.playerUnit = f.roster[0];
  const grid = $('role-grid');
  grid.innerHTML = '';
  for (const id of ids) {
    const d = UNITS[id];
    const w = d.weapons.map((x) => (x === 'arquebus' && d.weaponName ? d.weaponName : WEAPONS[x].name)).join(' + ');
    const b = document.createElement('button');
    b.className = 'role' + (id === setup.playerUnit ? ' on' : '') + (d.role === 'leader' ? ' leader' : '');
    const armor = { none: 'geen', light: 'licht', medium: 'middel', heavy: 'zwaar' }[d.armor];
    b.innerHTML = `<div class="rn">${d.role === 'leader' ? '👑 ' : ''}${d.name}</div><div class="rw">${w}${d.shield ? ' + schild' : ''}${d.mounted ? ' · te paard' : ''}</div><div class="rd">${unitBlurb(d)}${d.role === 'leader' ? ' ' + LEADERS[t].bio : ''}</div><div class="stats"><span>Leven <b>${d.hp}</b></span><span>Pantser <b>${armor}</b></span><span>Snelheid <b>${d.speed}</b></span></div>`;
    b.onclick = () => {
      sfx.ui();
      setup.playerUnit = id;
      store.set('setup', setup);
      renderRoles();
    };
    grid.appendChild(b);
  }
  $('btn-start').textContent = roleMode === 'respawn' ? 'Kiezen' : 'Ten strijde!';
}

// ---------------------------------------------------------------- potje starten
function startMatch() {
  if (deathMode) leaveDeathMode();
  initAudio();
  show('loading');
  state = 'loading';
  setTimeout(() => {
    view.setMatch(null);
    match = new Match({ ...setup, seed: Math.floor(Math.random() * 1e9), withPlayer: true });
    view.setMatch(match);
    match.controlsTouch = controls.isTouch;
    view.camState.mode = 'follow';
    camYaw = match.player ? match.player.yaw : 0;
    camPitch = -0.08;
    hud.reset(match);
    controls.reset();
    controls.enabled = true;
    state = 'playing';
    screenStack = ['game'];
    show(null);
    controls.lock();
    sfx.horn();
    startMusic(FACTIONS[setup.playerTeam].side === 'ottoman' ? 'mehter' : 'chant');
    hud.announce(FACTIONS[setup.playerTeam].name, `Je bent ${UNITS[setup.playerUnit].name}. Neem de donjon van de vijand in!`, false, 2);
  }, 40);
}

function pause(on) {
  if (on && state === 'playing') {
    state = 'paused';
    controls.enabled = false;
    controls.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    screenStack = ['game'];
    show('pause');
  } else if (!on && state === 'paused') {
    state = 'playing';
    controls.enabled = true;
    screenStack = ['game'];
    show(null);
    controls.lock();
    last = performance.now();
  }
}

function toMenu() {
  if (deathMode) leaveDeathMode();
  stopMusic();
  setBattleIntensity(0);
  controls.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  screenStack = [];
  show('menu');
  startAttract();
}

function showResults() {
  if (deathMode) leaveDeathMode();
  state = 'over';
  controls.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const s = match.summary();
  const p = match.player;
  const myAlli = match.teamById[setup.playerTeam].alliance;
  const won = s.winner === myAlli;
  $('res-title').textContent = won ? 'OVERWINNING' : 'NEDERLAAG';
  $('res-title').className = won ? 'win' : 'lose';
  const winners = match.teams.filter((t) => t.alliance === s.winner).map((t) => FACTIONS[t.id].name).join(' en ');
  const how = s.reason === 'time' ? 'De tijd is om — de sterkste partij wint op punten.' : 'De laatste donjon is ingenomen.';
  $('res-sub').textContent = `${winners || 'Niemand'} ${match.teams.filter((t) => t.alliance === s.winner).length > 1 ? 'winnen' : 'wint'} na ${Math.floor(s.time / 60)} min ${Math.floor(s.time % 60)} s. ${how}`;
  let html = '<table class="res-table"><tr><th>Rijk</th><th>Kills</th><th>Verliezen</th><th>Over</th><th>Fort</th><th>Leider gesneuveld</th><th>Status</th></tr>';
  for (const t of s.teams) {
    html += `<tr class="${t.alive ? '' : 'fallen'}"><td><img alt="" src="${flagDataURL(t.id, 48, 30)}">${FACTIONS[t.id].name}</td><td>${t.kills}</td><td>${t.losses}</td><td>${t.soldiers}/${t.startSoldiers}</td><td>${t.fortHp}%</td><td>${t.leaderDeaths ? 'ja' : 'nee'}</td><td>${t.alive ? 'staat' : `gevallen (${Math.floor(t.eliminatedAt / 60)} min)`}</td></tr>`;
  }
  html += '</table>';
  $('res-table').innerHTML = html;
  const pk = match.units.filter((u) => u.isPlayer || u === p).reduce((a, u) => a + u.kills, 0);
  $('res-player').textContent = p ? `Jouw strijd als ${p.def.name}: ${match.playerStats.kills} vijanden verslagen, ${match.playerStats.deaths}× gesneuveld, ${Math.round(match.playerStats.dmg)} schade aangericht.` : '';
  void pk;
  stopMusic();
  sfx.announce(!won);
  screenStack = [];
  show('results');
}

// ---------------------------------------------------------------- knoppen
$('btn-new').onclick = () => {
  initAudio();
  sfx.ui();
  renderSetup();
  show('setup');
};
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => back()));
$('btn-to-role').onclick = () => {
  sfx.ui();
  roleMode = 'start';
  renderRoles();
  show('role');
};
$('role-back').onclick = () => {
  if (roleMode === 'respawn') {
    screenStack = ['game'];
    show(null);
  } else back();
};
$('btn-start').onclick = () => {
  if (roleMode === 'respawn') {
    match.settings.playerUnit = setup.playerUnit;
    screenStack = ['game'];
    show(null);
    return;
  }
  startMatch();
};
// ---------------------------------------------------------------- na het sneuvelen: een bot overnemen
let deathMode = false;
let deathRenderT = 0;
let deathPick = null; // gekozen type, of null = gevolgde soldaat
function teamBots() {
  const p = match.player;
  return match.units.filter((u) => u.alive && u.team === p.team && !u.siege && !u.isPlayer);
}
function setSpectate(u) {
  view.spectate = u;
  if (u) {
    camYaw = u.yaw;
    $('death-spec').textContent = `${u.def.name}${u.isLeader ? ' 👑' : ''} · ${Math.round(u.hp)}/${u.maxHp} leven`;
  } else $('death-spec').textContent = '—';
}
function cycleSpectate(dir) {
  const list = teamBots().filter((u) => !deathPick || u.typeId === deathPick);
  if (!list.length) return setSpectate(null);
  const ref = match.player;
  list.sort((a, b) => Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z));
  const i = list.indexOf(view.spectate);
  setSpectate(list[(i + dir + list.length) % list.length] || list[0]);
}
function enterDeathMode() {
  deathMode = true;
  deathPick = null;
  controls.freeDrag = true;
  controls.firing = false;
  document.body.classList.add('dead-mode');
  if (document.pointerLockElement) document.exitPointerLock();
  cycleSpectate(0);
  renderDeathPanel();
}
function leaveDeathMode() {
  deathMode = false;
  controls.freeDrag = false;
  document.body.classList.remove('dead-mode');
  view.spectate = null;
}
function renderDeathPanel() {
  const p = match.player;
  const t = match.teamById[p.team];
  const counts = match.roleCounts(p.team);
  $('death-left').textContent = Math.max(0, t.soldiers);
  const ids = [...t.faction.roster, LEADERS[t.id].unit];
  const box = $('death-roles');
  box.innerHTML = '';
  for (const id of ids) {
    const n = counts[id] || 0;
    const b = document.createElement('button');
    b.className = deathPick === id ? 'on' : '';
    b.disabled = n === 0;
    b.innerHTML = `${UNITS[id].role === 'leader' ? '👑 ' : ''}${UNITS[id].name}<b>${n}</b>`;
    b.onclick = (e) => {
      e.stopPropagation();
      sfx.ui();
      deathPick = id;
      setSpectate(match.pickBot(p.team, id));
      renderDeathPanel();
    };
    box.appendChild(b);
  }
}
function doTakeOver(u) {
  if (!u || !u.alive || u.team !== match.player.team) return;
  match.takeOver(u);
  camYaw = u.yaw;
  leaveDeathMode();
  controls.lock();
}
$('btn-spec-prev').onclick = (e) => {
  e.stopPropagation();
  cycleSpectate(-1);
};
$('btn-spec-next').onclick = (e) => {
  e.stopPropagation();
  cycleSpectate(1);
};
$('btn-takeover').onclick = (e) => {
  e.stopPropagation();
  sfx.ui();
  doTakeOver(view.spectate && view.spectate.alive ? view.spectate : match.pickBot(match.player.team, deathPick));
};
// soldaat aanklikken op de minimap
$('minimap').addEventListener('pointerdown', (e) => {
  if (!deathMode) return;
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  const S = e.currentTarget.width;
  const k = hud.mmScale * (r.width / S);
  const x = (e.clientX - r.left - r.width / 2) / k;
  const z = (e.clientY - r.top - r.height / 2) / k;
  let best = null;
  let bd = 25;
  for (const u of teamBots()) {
    const d = Math.hypot(u.x - x, u.z - z);
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  if (best) {
    setSpectate(best);
    deathPick = null;
    renderDeathPanel();
  }
});
$('btn-help').onclick = () => show('help');
$('btn-settings').onclick = () => {
  renderSettings();
  show('settings');
};
$('btn-pause').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  pause(true);
});
$('btn-resume').onclick = () => pause(false);
$('btn-pause-help').onclick = () => show('help');
$('btn-pause-settings').onclick = () => {
  renderSettings();
  show('settings');
};
$('btn-restart').onclick = () => startMatch();
$('btn-quit').onclick = () => toMenu();
$('btn-again').onclick = () => startMatch();
$('btn-res-menu').onclick = () => toMenu();
$('help-back').onclick = () => back();
$('settings-back').onclick = () => back();

function renderSettings() {
  for (const k of ['master', 'music', 'sfx']) {
    const el = $('vol-' + k);
    el.value = prefs[k];
    el.oninput = () => {
      prefs[k] = +el.value;
      setVolumes({ [k]: prefs[k] / 100 });
      store.set('prefs', prefs);
    };
  }
  $('sens').value = prefs.sens;
  $('sens').oninput = () => {
    prefs.sens = +$('sens').value;
    controls.sensitivity = prefs.sens / 100;
    store.set('prefs', prefs);
  };
  seg('seg-quality', { low: { label: 'Laag' }, medium: { label: 'Middel' }, high: { label: 'Hoog' } }, prefs.quality, (k) => {
    prefs.quality = k;
    store.set('prefs', prefs);
    renderSettings();
    rebuildView();
  });
  $('chk-fps').checked = prefs.fps;
  $('chk-fps').onchange = () => {
    prefs.fps = $('chk-fps').checked;
    $('fps').classList.toggle('hidden', !prefs.fps);
    store.set('prefs', prefs);
  };
  $('chk-invert').checked = prefs.invert;
  $('chk-invert').onchange = () => {
    prefs.invert = $('chk-invert').checked;
    store.set('prefs', prefs);
  };
}

function rebuildView() {
  const old = view;
  const cam = old.camState;
  old.disposeMatch();
  old.renderer.dispose();
  old.renderer.domElement.remove();
  view = new GameView($('game'), prefs.quality);
  view.camState = cam;
  if (match) view.setMatch(match);
}

// pauze bij Esc / verlies van muisvergrendeling / app naar achtergrond
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing' && !controls.isTouch && !controls.noLock && !deathMode) pause(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pause(true);
});
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'playing' && !document.pointerLockElement) pause(true);
  else if (deathMode && state === 'playing') {
    if (e.code === 'KeyQ' || e.code === 'ArrowLeft') cycleSpectate(-1);
    if (e.code === 'KeyE' || e.code === 'ArrowRight') cycleSpectate(1);
    if (e.code === 'Enter' || e.code === 'Space') $('btn-takeover').click();
  }
  else if (e.code === 'KeyP' && state === 'paused') pause(false);
});
document.addEventListener('pointerdown', () => initAudio(), { once: true });

// ---------------------------------------------------------------- spelerinvoer
function playerInput(dt) {
  const p = match.player;
  controls.update();
  const look = controls.consumeLook();
  camYaw -= look.x * 0.0052;
  camPitch -= look.y * 0.0042 * (prefs.invert ? -1 : 1);
  camPitch = Math.max(-0.85, Math.min(0.75, camPitch));
  view.camState.yaw = camYaw;
  view.camState.pitch = camPitch;
  match.camYaw = camYaw;
  const fx = Math.sin(camYaw);
  const fz = Math.cos(camYaw);
  const mv = controls.move;
  const inp = match.input || (match.input = {});
  inp.mx = fx * mv.y - fz * mv.x;
  inp.mz = fz * mv.y + fx * mv.x;
  inp.yaw = camYaw;
  inp.pitch = camPitch;
  inp.sprint = controls.sprint;
  inp.attack = controls.firing && p?.alive;
  const A = controls.actions;
  if (A.switch) inp.switchWeapon = true;
  if (A.select != null) inp.selectWeapon = A.select;
  if (A.cry) inp.cry = true;
  if (A.climb) inp.climb = true;
  if (A.jump) inp.jump = true;
  if (A.ordersMenu) hud.toggleOrders();
  if (A.order) {
    inp.order = A.order;
    hud.toggleOrders(false);
  }
  controls.ordersOpen = hud.ordersOpen;
  controls.actions = { switch: false, climb: false, cry: false, jump: false, select: null, order: null };
  inp.aim = null;
  if (inp.attack && p) {
    const w = p.weapons[p.wi];
    if (w && w.kind !== 'melee' && w.kind !== 'spray') inp.aim = view.aimPoint();
  }
  void dt;
}

// spelerstatistieken
function trackPlayer(events) {
  const ps = match.playerStats || (match.playerStats = { kills: 0, deaths: 0, dmg: 0 });
  for (const e of events) {
    if (e.t === 'kill') {
      if (e.by?.isPlayer) ps.kills++;
      if (e.u.isPlayer) ps.deaths++;
    } else if (e.t === 'hurt' && e.by?.isPlayer) ps.dmg += e.dmg;
  }
}

// ---------------------------------------------------------------- hoofdlus
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
let fpsShow = 60;
let elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  elapsed += dt;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    fpsShow = Math.round(fpsN / fpsAcc);
    fpsAcc = 0;
    fpsN = 0;
  }
  if (match && (state === 'playing' || state === 'menu')) {
    if (state === 'playing') playerInput(dt);
    // vaste stapjes voor een stabiele simulatie
    const steps = dt > 1 / 30 ? 2 : 1;
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) match.update(dt / steps);
    perf.sim = perf.sim * 0.9 + (performance.now() - t0) * 0.1;
    const ev = match.events;
    view.events(ev, state === 'playing' ? sfx : silentSfx);
    if (state === 'playing') {
      hud.events(ev, match, sfx);
      trackPlayer(ev);
      // intensiteit van het slaggeruis
      if (match.tick % 20 === 0) {
        let n = 0;
        const p = match.player;
        if (p) match.unitGrid.query(p.x, p.z, 45, () => { n++; return false; });
        setBattleIntensity(Math.min(1, n / 60));
      }
    }
    ev.length = 0;
    if (state === 'playing' && (match.over || (match.player && !match.teamById[match.player.team].alive))) showResults();
    // gesneuveld: overnamescherm
    if (state === 'playing' && match.player) {
      const dead = !match.player.alive && match.teamById[match.player.team].alive;
      if (dead && !deathMode) enterDeathMode();
      else if (!dead && deathMode) leaveDeathMode();
      if (deathMode) {
        if (!view.spectate || !view.spectate.alive) cycleSpectate(0);
        deathRenderT -= dt;
        if (deathRenderT <= 0) {
          deathRenderT = 0.5;
          renderDeathPanel();
          if (view.spectate) setSpectate(view.spectate);
        }
      }
    }
    if (state === 'menu' && match.over) startAttract();
  }
  if (match) {
    const t1 = performance.now();
    view.render(dt, elapsed);
    perf.render = perf.render * 0.9 + (performance.now() - t1) * 0.1;
    perf.pose = perf.pose * 0.9 + view.poseMs * 0.1;
    if (state !== 'menu') hud.update(match, view, dt, prefs.fps ? fpsShow : null);
  }
}

const perf = { sim: 0, render: 0, pose: 0 };
window.__perf = perf;
const silentSfx = new Proxy({}, { get: () => () => {} });

// ---------------------------------------------------------------- start
startAttract();
show('menu');
screenStack = ['menu'];
requestAnimationFrame(frame);
window.__UNITS_ALL = UNITS;
window.__app = { get match() { return match; }, get view() { return view; }, get state() { return state; }, startMatch, setup, pause, controls, hud };
