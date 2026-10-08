import { TEAMS } from './teams.js';
import { MAP_X, MAP_Z, FORT } from './world.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      hp: $('hp-fill'),
      hpText: $('hp-text'),
      ammo: $('ammo'),
      weapon: $('weapon-name'),
      prompt: $('prompt'),
      btnMount: $('btn-mount'),
      scoreO: $('score-o'),
      scoreB: $('score-b'),
      feed: $('killfeed'),
      hit: $('hitmarker'),
      vignette: $('vignette'),
      death: $('death'),
      deathText: $('death-text'),
      deathTimer: $('death-timer'),
      over: $('gameover'),
      overTitle: $('over-title'),
      overStats: $('over-stats'),
      kills: $('kd'),
      announce: $('announce'),
      dmgDir: $('dmg-dir'),
    };
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.mapBg = null;
    this.prev = {};
    this.hurtT = 0;
    this.announceT = 0;
  }

  reset(game) {
    this.el.feed.innerHTML = '';
    this.el.death.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.prev = {};
    this.hurtT = 0;
    this.el.vignette.style.opacity = 0;
    this.el.dmgDir.style.opacity = 0;
    const p = game.player;
    if (p) {
      document.body.dataset.team = p.team;
      this.announce(p.team === 'ottoman' ? 'Ileri! Verover Constantinopel!' : 'Verdedig de stad!');
    }
    // kaart draaien zodat je eigen basis altijd onderaan ligt
    this.flip = !!p && p.team === 'byzantine';
    this.mapBg = this.drawMapBg(game);
  }

  announce(text) {
    this.el.announce.textContent = text;
    this.el.announce.classList.remove('show');
    void this.el.announce.offsetWidth;
    this.el.announce.classList.add('show');
  }

  set(key, value, fn) {
    if (this.prev[key] === value) return;
    this.prev[key] = value;
    fn(value);
  }

  update(game, dt) {
    const p = game.player;
    this.set('so', game.score.ottoman, (v) => (this.el.scoreO.textContent = v));
    this.set('sb', game.score.byzantine, (v) => (this.el.scoreB.textContent = v));
    this.drawMinimap(game);
    if (!p) return;

    const hp = Math.max(0, Math.ceil(p.hp));
    this.set('hp', hp, (v) => {
      this.el.hp.style.width = v + '%';
      this.el.hp.style.background = v > 60 ? '#5fbf4a' : v > 30 ? '#e0a43a' : '#d8392f';
      this.el.hpText.textContent = v;
    });
    const bow = p.weapon === 'bow';
    this.set('wpn', p.weapon, () => {
      this.el.weapon.textContent = bow ? '🏹 ' + p.cfg.bow.name : '⚔ ' + p.cfg.sword.name;
      document.body.dataset.weapon = p.weapon;
    });
    this.set('ammo', bow ? Math.floor(p.arrows) + ' pijlen' : '', (v) => (this.el.ammo.textContent = v));

    // hint om op een paard te stappen
    const horse = p.alive && !p.mounted ? game.nearestFreeHorse(p) : null;
    const canMount = !!horse || p.mounted;
    this.set('mnt', canMount + '|' + !!p.mounted, () => {
      this.el.btnMount.classList.toggle('hidden', !canMount);
      this.el.btnMount.textContent = p.mounted ? '⤓' : '🐎';
      this.el.prompt.textContent = p.mounted ? '' : horse ? (game.controls.isTouch ? 'Tik 🐎 om op te stijgen' : 'Druk E om op te stijgen') : '';
    });
    this.set('kd', p.kills + '/' + p.deaths, () => (this.el.kills.textContent = `⚔ ${p.kills}   ☠ ${p.deaths}`));

    this.hurtT = Math.max(0, this.hurtT - dt);
    this.el.vignette.style.opacity = Math.min(1, this.hurtT * 2.2 + (p.alive && p.hp < 35 ? 0.35 : 0));
    this.el.dmgDir.style.opacity = Math.min(1, this.hurtT * 2);
    if (this.hurtSrc && this.hurtT > 0) {
      const dx = this.hurtSrc.x - p.pos.x;
      const dz = this.hurtSrc.z - p.pos.z;
      const ang = Math.atan2(dx, dz) - p.yaw;
      this.el.dmgDir.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    }

    // doodscherm
    this.set('dead', p.alive, (alive) => this.el.death.classList.toggle('hidden', alive));
    if (!p.alive) {
      const left = Math.max(0, 3 - p.deadT);
      this.el.deathTimer.textContent = `Terug in de strijd over ${left.toFixed(1)} s`;
    }
  }

  hurt(attacker, player) {
    this.hurtT = 0.6;
    this.hurtSrc = { x: attacker.pos.x, z: attacker.pos.z };
    if (navigator.vibrate) navigator.vibrate(30);
  }

  hitMarker(head) {
    const h = this.el.hit;
    h.classList.toggle('head', head);
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
  }

  killFeed(killer, victim, head, game) {
    const row = document.createElement('div');
    row.className = 'feed-row' + (killer.isPlayer || victim.isPlayer ? ' me' : '');
    const k = document.createElement('span');
    k.style.color = TEAMS[killer.team].uiColor;
    k.textContent = killer.name;
    const v = document.createElement('span');
    v.style.color = TEAMS[victim.team].uiColor;
    v.textContent = victim.name;
    const icon = document.createElement('i');
    icon.textContent = killer.weapon === 'bow' ? ' ➶ ' : killer.mounted ? ' 🐎 ' : ' ⚔ ';
    row.append(k, icon, v);
    if (head) row.append(' 🎯');
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 4000);
    setTimeout(() => row.remove(), 5000);

    if (victim.isPlayer) {
      this.el.deathText.innerHTML = '';
      const s = document.createElement('span');
      s.style.color = TEAMS[killer.team].uiColor;
      s.textContent = killer.name;
      this.el.deathText.append('Uitgeschakeld door ', s, head ? ' (kopschot)' : '');
    }
    if (killer.isPlayer) {
      const left = 30 - game.score[killer.team];
      if (left === 10 || left === 5 || left === 1) this.announce(`Nog ${left} ${left === 1 ? 'kill' : 'kills'} tot de overwinning!`);
    }
  }

  gameOver(game, winner) {
    const won = game.player && winner === game.player.team;
    this.el.overTitle.textContent = won ? 'OVERWINNING!' : 'NEDERLAAG';
    this.el.overTitle.className = won ? 'win' : 'lose';
    const p = game.player;
    const best = [...game.soldiers].sort((a, b) => b.kills - a.kills)[0];
    this.el.overStats.innerHTML = '';
    const lines = [
      `${TEAMS[winner].name} wint met ${game.score[winner]} – ${game.score[winner === 'ottoman' ? 'byzantine' : 'ottoman']}`,
      p ? `Jouw score: ${p.kills} kills, ${p.deaths} keer gesneuveld` : '',
      `Beste strijder: ${best.name} (${best.kills} kills)`,
    ];
    for (const l of lines) {
      if (!l) continue;
      const d = document.createElement('div');
      d.textContent = l;
      this.el.overStats.append(d);
    }
    this.el.over.classList.remove('hidden');
  }

  // ------------------------------------------------------------- minimap
  drawMapBg(game) {
    const size = this.minimap.width;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(12,10,6,0.6)';
    g.fillRect(0, 0, size, size);
    const [ax, ay] = this.toMap(MAP_X, MAP_Z, size);
    const [bx, by] = this.toMap(-MAP_X, -MAP_Z, size);
    g.fillStyle = 'rgba(52,62,30,0.92)';
    g.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    // forten in teamkleur
    for (const [team, sgn] of [['ottoman', -1], ['byzantine', 1]]) {
      const [x1, y1] = this.toMap(FORT.halfW, sgn * FORT.front, size);
      const [x2, y2] = this.toMap(-FORT.halfW, sgn * FORT.back, size);
      g.fillStyle = team === 'ottoman' ? 'rgba(208,32,46,0.35)' : 'rgba(138,63,184,0.4)';
      g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    g.fillStyle = 'rgba(210,195,160,0.85)';
    for (const o of game.obstacles) {
      const [x1, y1] = this.toMap(o.min.x, o.min.z, size);
      const [x2, y2] = this.toMap(o.max.x, o.max.z, size);
      g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.max(1, Math.abs(x2 - x1)), Math.max(1, Math.abs(y2 - y1)));
    }
    return c;
  }

  // noorden (boven) = Byzantijnse kant (+z); x gespiegeld zodat links/rechts klopt vanaf Ottomaanse kant
  toMap(x, z, size) {
    const s = (size / (MAP_Z * 2 + 4)) * (this.flip ? -1 : 1);
    return [size / 2 - x * s, size / 2 - z * s];
  }

  drawMinimap(game) {
    this._mmT = (this._mmT || 0) + 1;
    if (this._mmT % 3) return; // niet elk frame nodig
    const g = this.mctx;
    const size = this.minimap.width;
    g.clearRect(0, 0, size, size);
    if (this.mapBg) g.drawImage(this.mapBg, 0, 0);
    const p = game.player;
    const myTeam = p ? p.team : 'ottoman';
    for (const s of game.soldiers) {
      if (!s.alive) continue;
      const friendly = s.team === myTeam;
      // vijanden alleen zichtbaar als ze net geschoten hebben
      if (!friendly && game.time - s.lastAttackT > 2.5 && p) continue;
      const [x, y] = this.toMap(s.pos.x, s.pos.z, size);
      if (s.isPlayer) {
        g.save();
        g.translate(x, y);
        g.rotate(-s.yaw + (this.flip ? Math.PI : 0));
        g.fillStyle = '#fff';
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(4.5, 5);
        g.lineTo(-4.5, 5);
        g.closePath();
        g.fill();
        g.restore();
      } else {
        g.fillStyle = friendly ? '#5fd0ff' : '#ff4d4d';
        g.beginPath();
        g.arc(x, y, s.mounted ? 4 : 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
