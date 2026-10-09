import { FACTIONS, LEADERS, UNITS } from '../sim/data.js';
import { flagDataURL } from '../render/textures.js';

const $ = (id) => document.getElementById(id);
const PHASES = { 1: 'Fase 1 · Opmars & belegering', 2: 'Fase 2 · Bres in de muren', 3: 'Fase 3 · Strijd om de donjon' };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['phase-name', 'clock', 'teams', 'feed', 'leaderbars', 'hitmarker', 'dmg-dir', 'announce', 'announce-title', 'announce-sub', 'prompt', 'unit-name', 'hp-fill', 'hp-text', 'morale-fill', 'weapon-name', 'ammo', 'reload-fill', 'ability', 'ability-name', 'ability-cd', 'fps', 'death', 'death-text', 'death-timer', 'btn-climb', 'btn-cry', 'vignette']) this.el[id] = $(id);
    this.mm = $('minimap');
    this.mctx = this.mm.getContext('2d');
    this.prev = {};
    this.hurtT = 0;
    this.leaderEls = new Map();
    this.annQueue = [];
    this.annT = 0;
  }

  set(k, v, fn) {
    if (this.prev[k] === v) return;
    this.prev[k] = v;
    fn(v);
  }

  reset(match) {
    this.m = match;
    this.prev = {};
    this.el.feed.innerHTML = '';
    this.el.leaderbars.innerHTML = '';
    this.leaderEls.clear();
    this.annQueue = [];
    this.annT = 0;
    this.hurtT = 0;
    this.el.vignette.style.opacity = 0;
    // teambalk
    const T = this.el.teams;
    T.innerHTML = '';
    T.classList.toggle('many', match.teams.length >= 5);
    this.teamEls = match.teams.map((t) => {
      const d = document.createElement('div');
      d.className = 'tm';
      d.title = FACTIONS[t.id].name;
      d.innerHTML = `<div class="tn"><img alt="" src="${flagDataURL(t.id, 44, 28)}"><span class="tname">${FACTIONS[t.id].short}</span></div><span class="tl" title="Leider">👑</span><div class="bars"><div class="bar" title="Fort"><i></i></div><div class="bar cap hidden" title="Inname donjon"><i></i></div></div><span class="cnt" style="grid-column:1/3"></span>`;
      T.appendChild(d);
      return { d, fort: d.querySelector('.bar i'), cap: d.querySelector('.bar.cap'), capI: d.querySelector('.bar.cap i'), cnt: d.querySelector('.cnt'), lead: d.querySelector('.tl') };
    });
    this._mapBg();
  }

  // ------------------------------------------------------------- per frame
  update(match, view, dt, fps) {
    const p = match.player;
    this.set('phase', match.phase, (v) => (this.el['phase-name'].textContent = PHASES[v]));
    const left = Math.max(0, match.length.timeLimit - match.time);
    this.set('clock', Math.floor(match.time), () => (this.el.clock.textContent = `${fmtTime(match.time)} · nog ${fmtTime(left)}`));
    // teams
    match.teams.forEach((t, i) => {
      const e = this.teamEls[i];
      const st = t.fort.structures;
      const hp = st.reduce((a, s) => a + s.hp, 0) / st.reduce((a, s) => a + s.maxHp, 0);
      this.set('f' + i, Math.round(hp * 50), () => (e.fort.style.width = Math.round(hp * 100) + '%'));
      const cap = t.fort.capture;
      this.set('c' + i, Math.round(cap * 50), () => {
        e.cap.classList.toggle('hidden', cap <= 0.01);
        e.capI.style.width = Math.round(cap * 100) + '%';
      });
      this.set('n' + i, t.units + '|' + t.alive, () => (e.cnt.textContent = t.alive ? `⚔ ${t.units}` : 'gevallen'));
      const la = t.leader?.alive;
      this.set('l' + i, la + '|' + (la ? 0 : Math.ceil(t.leaderRespawnT / 10)), () => {
        e.lead.classList.toggle('down', !la);
        e.lead.textContent = la ? '👑' : `👑 ${Math.ceil(Math.max(0, t.leaderRespawnT))}s`;
      });
      this.set('d' + i, t.alive, () => e.d.classList.toggle('dead', !t.alive));
      this.set('me' + i, p?.team === t.id, (v) => e.d.classList.toggle('me', v));
    });

    if (p) this._player(match, p, dt);
    this._leaderBars(view);
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) {
      this.mmT = 0.12;
      this._minimap(match);
    }
    if (fps != null) this.set('fps', fps, (v) => (this.el.fps.textContent = `${v} FPS`));
    this._announceTick(dt);
  }

  _player(match, p, dt) {
    const t = match.teamById[p.team];
    this.set('uname', p.def.name, (v) => (this.el['unit-name'].textContent = v));
    const hp = Math.max(0, Math.ceil((p.hp / p.maxHp) * 100));
    this.set('hp', hp + '|' + Math.ceil(p.hp), () => {
      this.el['hp-fill'].style.width = hp + '%';
      this.el['hp-fill'].style.background = hp > 60 ? '#6fbf5a' : hp > 30 ? '#e0a43a' : '#e0553d';
      this.el['hp-text'].textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
    });
    this.set('mor', Math.round(t.morale), (v) => (this.el['morale-fill'].style.width = v + '%'));
    const w = p.weapons[p.wi];
    if (w) {
      const melee = w.kind === 'melee';
      this.set('w', w.name + p.wi, () => {
        this.el['weapon-name'].textContent = (melee ? '⚔ ' : w.kind === 'spray' ? '🔥 ' : '➶ ') + (p.def.weaponName && w.kind === 'ranged' ? p.def.weaponName : w.name);
        document.body.dataset.w = melee ? 'melee' : 'ranged';
      });
      const ammo = p.ammo[p.wi];
      this.set('a', melee ? '' : String(ammo), () => (this.el.ammo.textContent = melee ? `bereik ${w.reach} m` : ammo === Infinity ? '' : `${ammo} over`));
      const cd = Math.max(0, p.cd) / w.cooldown;
      this.el['reload-fill'].style.width = Math.round((1 - cd) * 100) + '%';
    }
    // strijdkreet
    this.set('lead', p.isLeader, (v) => {
      this.el.ability.classList.toggle('hidden', !v);
      this.el['btn-cry'].classList.toggle('hidden', !v);
      if (v) this.el['ability-name'].textContent = LEADERS[p.team].cry.name;
    });
    if (p.isLeader) {
      const c = LEADERS[p.team].cry;
      const k = Math.max(0, (p.cryCd || 0) - match.time) / c.cooldown;
      this.el['ability-cd'].style.transform = `scaleX(${k})`;
    }
    // ladder
    let prompt = '';
    const nearPost = !p.post && !p.mounted && !p.siege && p.alive && match.nearestFreePost(p, 3.5);
    if (p.post) prompt = match.controlsTouch ? '⇅ = muur af' : 'E = muur af';
    else if (nearPost) prompt = match.controlsTouch ? '⇅ = ladder op' : 'E = de muur op';
    this.set('prompt', prompt, (v) => {
      this.el.prompt.textContent = v;
      this.el['btn-climb'].classList.toggle('hidden', !v);
    });
    // schade-indicatie
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.el.vignette.style.opacity = Math.min(1, this.hurtT * 2 + (p.alive && p.hp < p.maxHp * 0.3 ? 0.35 : 0));
    this.el['dmg-dir'].style.opacity = Math.min(1, this.hurtT * 2);
    if (this.hurtSrc && this.hurtT > 0) {
      const ang = Math.atan2(this.hurtSrc.x - p.x, this.hurtSrc.z - p.z) - (match.camYaw ?? p.yaw);
      this.el['dmg-dir'].style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    }
    // doodscherm
    const t2 = match.teamById[p.team];
    this.set('dead', p.alive || !t2.alive, (alive) => this.el.death.classList.toggle('hidden', alive));
    if (!p.alive && t2.alive) {
      const wait = p.isLeader ? t2.leaderRespawnT : match.playerRespawnT;
      this.el['death-timer'].textContent = `Terug in de strijd over ${Math.max(0, wait).toFixed(0)} s`;
    }
  }

  _leaderBars(view) {
    const list = view.leaderScreens();
    const seen = new Set();
    for (const s of list) {
      let el = this.leaderEls.get(s.L);
      if (!el) {
        el = document.createElement('div');
        el.className = 'lb';
        el.innerHTML = `<div class="lbn"></div><div class="lbb"><i></i></div>`;
        el.querySelector('.lbn').textContent = s.L.def.name;
        el.querySelector('i').style.background = FACTIONS[s.team.id].ui;
        this.el.leaderbars.appendChild(el);
        this.leaderEls.set(s.L, el);
      }
      seen.add(s.L);
      el.style.left = s.x + 'px';
      el.style.top = s.y + 'px';
      el.style.opacity = s.d > 80 ? 0.6 : 1;
      el.querySelector('i').style.width = Math.max(0, (s.L.hp / s.L.maxHp) * 100) + '%';
    }
    for (const [L, el] of this.leaderEls) if (!seen.has(L)) {
      el.remove();
      this.leaderEls.delete(L);
    }
  }

  // ------------------------------------------------------------- minimap
  _mapBg() {
    const m = this.m;
    const S = this.mm.width;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const k = S / (m.map.radius * 2 + 10);
    this.mmScale = k;
    const tx = (x) => S / 2 + x * k;
    g.fillStyle = '#4a5530';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(160,140,100,0.6)';
    g.lineWidth = Math.max(2, 6 * k);
    for (const r of m.map.roads) {
      g.beginPath();
      g.moveTo(tx(r.x0), tx(r.z0));
      g.lineTo(tx(r.x1), tx(r.z1));
      g.stroke();
    }
    for (const o of m.map.obstacles) {
      if (o.kind === 'tree' || o.kind === 'rock') continue;
      g.save();
      g.translate(tx(o.cx), tx(o.cz));
      g.rotate(-o.rot);
      g.fillStyle = o.struct ? '#d8ccb0' : o.kind === 'keep' ? '#efe3c4' : 'rgba(210,190,150,0.6)';
      g.fillRect(-o.hx * k, -o.hz * k, Math.max(1, o.hx * 2 * k), Math.max(1, o.hz * 2 * k));
      g.restore();
    }
    this.mmBg = c;
  }

  _minimap(m) {
    const g = this.mctx;
    const S = this.mm.width;
    const k = this.mmScale;
    const tx = (x) => S / 2 + x * k;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.clip();
    g.drawImage(this.mmBg, 0, 0);
    // vernielde bouwwerken
    g.fillStyle = 'rgba(40,30,20,0.9)';
    for (const st of m.map.structures) if (st.destroyed) g.fillRect(tx(st.x) - 2, tx(st.z) - 2, 4, 4);
    // forten in teamkleur
    for (const t of m.teams) {
      g.fillStyle = t.alive ? FACTIONS[t.id].ui : '#555';
      g.beginPath();
      g.arc(tx(t.fort.keep.x), tx(t.fort.keep.z), 5, 0, Math.PI * 2);
      g.fill();
    }
    for (const c of m.map.capturePoints) {
      g.strokeStyle = c.owner ? FACTIONS[c.owner].ui : '#ddd';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(tx(c.x), tx(c.z), 4, 0, Math.PI * 2);
      g.stroke();
    }
    const p = m.player;
    const ally = p ? p.alliance : null;
    for (const u of m.units) {
      if (!u.alive || u === p) continue;
      const friendly = u.alliance === ally;
      if (!friendly && p && m.time - u.lastAttackT > 3 && !u.siege) continue;
      g.fillStyle = u.team === p?.team ? '#7fd3ff' : friendly ? '#b8e3a0' : FACTIONS[u.team].ui;
      const s = u.siege ? 3 : u.isLeader ? 3 : 1.6;
      g.fillRect(tx(u.x) - s / 2, tx(u.z) - s / 2, s, s);
    }
    if (p) {
      g.save();
      g.translate(tx(p.x), tx(p.z));
      g.rotate(-(m.camYaw ?? p.yaw) + Math.PI);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(4.5, 5);
      g.lineTo(-4.5, 5);
      g.fill();
      g.restore();
    }
    g.restore();
  }

  // ------------------------------------------------------------- meldingen
  announce(title, sub = '', bad = false, prio = 1) {
    if (prio >= 2) this.annQueue.unshift({ title, sub, bad });
    else if (this.annQueue.length < 3) this.annQueue.push({ title, sub, bad });
  }

  _announceTick(dt) {
    this.annT -= dt;
    if (this.annT > 0 || !this.annQueue.length) return;
    const a = this.annQueue.shift();
    const el = this.el.announce;
    this.el['announce-title'].textContent = a.title;
    this.el['announce-sub'].textContent = a.sub;
    el.classList.toggle('bad', a.bad);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.annT = 2.6;
  }

  feed(html, cls = '') {
    const r = document.createElement('div');
    r.className = 'fr ' + cls;
    r.innerHTML = html;
    this.el.feed.prepend(r);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => r.classList.add('fade'), 5000);
    setTimeout(() => r.remove(), 6000);
  }

  hitMarker(head) {
    const h = this.el.hitmarker;
    h.classList.toggle('head', !!head);
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
  }

  hurt(by) {
    this.hurtT = 0.6;
    if (by) this.hurtSrc = { x: by.x, z: by.z };
    if (navigator.vibrate) try { navigator.vibrate(25); } catch (e) { /* niet ondersteund */ }
  }

  // Wedstrijdgebeurtenissen vertalen naar meldingen
  events(list, m, sfx) {
    const p = m.player;
    const myAlli = p?.alliance;
    const name = (tid) => `<b style="color:${FACTIONS[tid].ui}">${FACTIONS[tid].short}</b>`;
    const uname = (u) => `<span style="color:${FACTIONS[u.team].ui}">${u.isPlayer ? 'Jij' : u.def.name}</span>`;
    for (const e of list) {
      switch (e.t) {
        case 'kill': {
          if (e.rout) break;
          const by = e.by;
          if (e.u.isLeader) {
            this.feed(`${by ? uname(by) + ' ⚔ ' : ''}${uname(e.u)} is gevallen!`, 'big');
          } else if (by && (by.isPlayer || e.u.isPlayer)) {
            this.feed(`${uname(by)} ${by.weapons[by.wi]?.kind === 'melee' ? '⚔' : '➶'} ${uname(e.u)}${e.head ? ' 🎯' : ''}`, 'me');
            if (by.isPlayer) sfx.kill();
          }
          if (e.u.isPlayer) {
            this.el['death-text'].innerHTML = by ? `Uitgeschakeld door ${uname(by)}${e.head ? ' (kopschot)' : ''}` : '';
          }
          break;
        }
        case 'hurt':
          if (e.u.isPlayer) this.hurt(e.by);
          if (e.by?.isPlayer && e.u.alliance !== e.by.alliance) this.hitMarker(e.head);
          break;
        case 'leaderDown': {
          const mine = m.teamById[e.team].alliance === myAlli;
          this.announce(`${LEADERS[e.team] ? m.teamById[e.team].leader?.def.name || '' : ''} is gesneuveld!`, mine ? 'Het moreel van je leger daalt' : 'Het vijandelijke leger wankelt', mine, 2);
          sfx.announce(mine);
          break;
        }
        case 'leaderBack':
          if (m.teamById[e.team].alliance === myAlli) this.announce(`${e.u.def.name} keert terug`, 'Het moreel stijgt');
          break;
        case 'structDestroyed': {
          const own = e.st.team === p?.team;
          const what = e.st.gate ? 'De poort' : e.st.kind.toLowerCase().includes('tower') ? 'Een toren' : 'Een muur';
          this.feed(`${what} van ${name(e.st.team)} is gevallen`, own ? 'big' : '');
          if (own) {
            this.announce(`${what} is doorbroken!`, 'Verdedig de bres', true, 2);
            sfx.announce(true);
          } else if (m.teamById[e.st.team].alliance !== myAlli && e.st.gate) this.announce(`De poort van de ${FACTIONS[e.st.team].short} is gebroken!`, 'Stormen!');
          break;
        }
        case 'phase':
          this.announce(PHASES[e.n], e.n === 2 ? 'De eerste muren zijn gevallen' : 'De donjon wordt bestormd', false, 2);
          sfx.horn();
          break;
        case 'finale':
          this.announce('De beslissende bestorming!', 'Elke donjon kan nu sneller vallen — alles op alles', false, 3);
          sfx.horn();
          break;
        case 'keepContest':
          if (e.team === p?.team) {
            this.announce('De vijand is in je donjon!', 'Verjaag ze uit de cirkel', true, 2);
            sfx.announce(true);
          }
          break;
        case 'fortFallen': {
          const t = m.teamById[e.team];
          this.feed(`${name(e.team)} is verslagen!`, 'big');
          this.announce(`${FACTIONS[e.team].name} is gevallen`, t.alliance === myAlli ? 'Een zware slag voor je bondgenootschap' : 'Een vijand minder', t.alliance === myAlli, 3);
          sfx.announce(t.alliance === myAlli);
          break;
        }
        case 'cpTaken':
          this.feed(`${name(e.team)} verovert ${e.cp.name}`);
          break;
        case 'attackWave':
          if (m.teamById[e.team].alliance === myAlli && e.team === p?.team) this.announce('Aanval!', `Ons leger trekt op naar de ${FACTIONS[e.target].short}`);
          else if (m.teamById[e.target]?.alliance === myAlli && e.target === p?.team) this.announce('Een vijandelijk leger nadert!', `De ${FACTIONS[e.team].short} vallen aan`, true);
          break;
        case 'siegeBuilt':
          if (e.team === p?.team) this.feed(`Nieuw belegeringstuig: ${e.u.def.name}`);
          break;
        case 'cry':
          this.feed(`${uname(e.u)}: “${e.name}”`, 'big');
          break;
        case 'dock':
          this.feed(`Belegeringstoren aangelegd tegen de muur van ${name(e.st.team)}`, e.st.team === p?.team ? 'big' : '');
          break;
        default:
          break;
      }
    }
  }
}

export function unitBlurb(def) {
  const W = def.weapons;
  const roles = {
    archer: 'Schutter: houdt afstand, sterk tegen licht gepantserden.',
    crossbow: 'Kruisboog: traag herladen, doorboort pantser. Pavese-schild als dekking.',
    gunner: 'Haakbus: enorme schade, rook en heel traag herladen.',
    spear: 'Voetvolk met stokwapen: breekt ruiterscharges.',
    heavy: 'Zwaar gepantserd voetvolk voor het gevecht van man tot man.',
    cavalry: 'Ruiter: snel, charge met de lans; kwetsbaar voor speren.',
    fire: 'Grieks vuur op korte afstand: steekt vijanden, poorten en belegeringstuig in brand.',
    sapper: 'Mijnwerker: ondergraaft vijandelijke muren met het houweel.',
    leader: 'Leider: veel sterker, aura voor nabije troepen en een strijdkreet (R).',
  };
  return roles[def.role] || '';
}

export { UNITS };
