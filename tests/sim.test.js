import { describe, it, expect } from 'vitest';
import { Match } from '../src/sim/match.js';
import { UNITS, WEAPONS, ARMOR, FACTIONS, LEADERS, FACTION_IDS, TROOP_SIZES } from '../src/sim/data.js';
import { generateMap } from '../src/sim/map.js';
import { makeObstacle, pushCircle, rayObstacle, pointInside } from '../src/sim/geom.js';
import { ballistic } from '../src/sim/math.js';

const mk = (o = {}) => new Match({ teams: ['ottoman', 'byzantine'], mode: 'historical', troops: 'small', length: 'normal', difficulty: 'normal', seed: 7, withPlayer: false, ...o });

// eenheid buiten het gewoel neerzetten zonder spawnbescherming
function place(m, type, team, x, z, yaw = 0) {
  const u = m.createUnit(type, team, x, z);
  u.spawnT = -100;
  u.yaw = yaw;
  return u;
}

describe('gegevens', () => {
  it('elke eenheid verwijst naar bestaande wapens en een factie', () => {
    for (const [id, u] of Object.entries(UNITS)) {
      expect(FACTIONS[u.faction], id).toBeTruthy();
      for (const w of u.weapons) expect(WEAPONS[w], `${id}:${w}`).toBeTruthy();
    }
  });
  it('elke factie heeft een leider, lijfwacht, mix die optelt tot 1 en belegeringstuig', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      expect(UNITS[LEADERS[id].unit].role).toBe('leader');
      expect(UNITS[LEADERS[id].guard].role).toBe('guard');
      const sum = Object.values(f.mix).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
      for (const s of f.siege) expect(UNITS[s].faction).toBe(id);
    }
  });
  it('pantser vermindert schade monotoon (geen < licht < middel < zwaar)', () => {
    for (const t of ['slash', 'pierce', 'arrow', 'bolt']) {
      expect(ARMOR.none[t]).toBeGreaterThanOrEqual(ARMOR.light[t]);
      expect(ARMOR.light[t]).toBeGreaterThanOrEqual(ARMOR.medium[t]);
      expect(ARMOR.medium[t]).toBeGreaterThanOrEqual(ARMOR.heavy[t]);
    }
    // kruisboog doorboort pantser beter dan een boog
    expect(ARMOR.heavy.bolt).toBeGreaterThan(ARMOR.heavy.arrow * 2);
  });
});

describe('geometrie', () => {
  it('duwt een cirkel uit een gedraaide doos', () => {
    const o = makeObstacle({ cx: 0, cz: 0, hx: 2, hz: 1, rot: 0.7, y0: 0, y1: 3 });
    const p = pushCircle(o, 0.1, 0.1, 0.5);
    expect(p).not.toBeNull();
    expect(pointInside(o, p[0], p[1], 0.49)).toBe(false);
  });
  it('raakt een doos met een straal en mist erboven', () => {
    const o = makeObstacle({ cx: 10, cz: 0, hx: 1, hz: 5, y0: 0, y1: 4 });
    expect(rayObstacle(o, 0, 1, 0, 1, 0, 0, 100)).toBeCloseTo(9, 3);
    expect(rayObstacle(o, 0, 6, 0, 1, 0, 0, 100)).toBe(Infinity);
  });
  it('ballistische richting bereikt het doel', () => {
    const d = ballistic(0, 1.5, 0, 50, 1.5, 0, 70, 9.8);
    // simuleer de baan
    let x = 0;
    let y = 1.5;
    let vx = d.x * 70;
    let vy = d.y * 70;
    while (x < 50) {
      const dt = 0.001;
      x += vx * dt;
      y += vy * dt;
      vy -= 9.8 * dt;
    }
    expect(Math.abs(y - 1.5)).toBeLessThan(0.3);
  });
});

describe('kaart', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`${n} forten overlappen niet en liggen binnen de kaart`, () => {
      const teams = FACTION_IDS.slice(0, n);
      const map = generateMap(teams, { seed: 3 });
      expect(map.forts.length).toBe(n);
      for (const f of map.forts) expect(Math.hypot(f.cx, f.cz) + f.extent).toBeLessThan(map.radius);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = map.forts[i];
        const b = map.forts[j];
        expect(Math.hypot(a.cx - b.cx, a.cz - b.cz)).toBeGreaterThan(a.extent + b.extent + 20);
      }
    });
  }
  it('Byzantium heeft een dubbele muur met twee poorten en een gracht', () => {
    const map = generateMap(['ottoman', 'byzantine'], { seed: 3 });
    const byz = map.forts[1];
    expect(byz.gates.length).toBe(2);
    expect(map.moats.length).toBeGreaterThan(0);
  });
});

describe('gevecht', () => {
  it('zwaard doet minder schade aan plaatharnas dan aan een ongepantserde', () => {
    const m = mk();
    const a = place(m, 'ott_janissary', 'ottoman', 0, 0);
    const naked = place(m, 'ott_azap', 'byzantine', 1, 1);
    naked.alliance = 'christian';
    const knight = place(m, 'gen_armigero', 'byzantine', 2, 2);
    knight.alliance = 'christian';
    const d1 = m.damageUnit(naked, 30, 'slash', a, {});
    const d2 = m.damageUnit(knight, 30, 'slash', a, {});
    expect(d2).toBeLessThan(d1 * 0.5);
  });
  it('schild van voren vangt pijlen deels op, van achteren niet', () => {
    const m = mk();
    const archer = place(m, 'ott_janissary', 'ottoman', 0, 0);
    const def = place(m, 'byz_skoutatos', 'byzantine', 0, 10, Math.PI); // kijkt naar de schutter
    const front = m.damageUnit(def, 25, 'arrow', archer, { proj: true });
    def.hp = def.maxHp;
    def.yaw = 0; // rug naar de schutter
    const back = m.damageUnit(def, 25, 'arrow', archer, { proj: true });
    expect(front).toBeLessThan(back * 0.7);
  });
  it('speren doen extra schade aan ruiters en breken een charge van voren', () => {
    const m = mk();
    const spear = place(m, 'byz_skoutatos', 'byzantine', 0, 2, Math.PI);
    const cav = place(m, 'ott_sipahi', 'ottoman', 0, 0, 0);
    cav.speed = 9;
    const hpCav = cav.hp;
    // lans-charge op een speer die de ruiter aankijkt
    cav.wi = 0;
    m.startMelee(cav, null);
    cav.windup = 0.0001;
    m.unitGrid.rebuild(m.units);
    m._combatTick(cav, 0.01);
    expect(cav.hp).toBeLessThan(hpCav); // de ruiter liep zich vast op de speer
  });
  it('doden telt mee voor kills, verliezen en moreel', () => {
    const m = mk();
    const a = place(m, 'ott_janissary', 'ottoman', 0, 0);
    const b = place(m, 'byz_toxotes', 'byzantine', 3, 0);
    const t = m.teamById.ottoman;
    const before = t.stats.kills;
    m.damageUnit(b, 9999, 'slash', a, {});
    expect(b.alive).toBe(false);
    expect(t.stats.kills).toBe(before + 1);
    expect(m.teamById.byzantine.stats.losses).toBeGreaterThan(0);
  });
  it('geen eigen vuur: projectiel raakt geen bondgenoten', () => {
    const m = mk();
    const a = place(m, 'ott_janissary', 'ottoman', 0, 0, 0);
    const ally = place(m, 'ott_azap', 'ottoman', 0, 6, 0);
    const hp = ally.hp;
    a.cd = 0;
    m.unitGrid.rebuild(m.units);
    m.shoot(a, 0, 1.2, 12, 0);
    for (let i = 0; i < 30; i++) m._updateProjectiles(1 / 30);
    expect(ally.hp).toBe(hp);
  });
});

describe('bouwwerken en navigatie', () => {
  it('belegeringsschade vernielt een poort en maakt die begaanbaar', () => {
    const m = mk();
    const fort = m.teamById.byzantine.fort;
    const gate = fort.gates[0];
    const field0 = m._computeField('keep:byzantine', 'ottoman');
    const before = m.nav.distAt(field0, fort.rally.x, fort.rally.z);
    m.damageStruct(gate, 1e9, 'siege', null);
    expect(gate.destroyed).toBe(true);
    expect(gate.ob.active).toBe(false);
    const field1 = m._computeField('keep:byzantine', 'ottoman');
    expect(m.nav.distAt(field1, fort.rally.x, fort.rally.z)).toBeLessThan(before);
  });
  it('pijlen en zwaarden beschadigen stenen muren niet', () => {
    const m = mk();
    const wall = m.teamById.byzantine.fort.structures.find((s) => s.kind === 'wall');
    expect(m.damageStruct(wall, 100, 'arrow', null)).toBe(0);
    expect(m.damageStruct(wall, 100, 'slash', null)).toBe(0);
    expect(m.damageStruct(wall, 100, 'siege', null)).toBeGreaterThan(0);
  });
  it('eigen poort is open voor bondgenoten, dicht voor vijanden', () => {
    const m = mk();
    const fort = m.teamById.ottoman.fort;
    const g = fort.gate;
    const i = m.nav.idx(g.x, g.z);
    expect(m.nav.cost(i, 'ottoman', m.allianceOf)).toBe(1);
    expect(m.nav.cost(i, 'christian', m.allianceOf)).toBeGreaterThan(10);
  });
});

describe('leiders, inname en overwinning', () => {
  it('leider sneuvelt: moreel daalt en hij komt niet terug', () => {
    const m = mk();
    const t = m.teamById.ottoman;
    const L = t.leader;
    const morale = t.morale;
    L.spawnT = -100;
    m.damageUnit(L, 1e6, 'slash', null, {});
    expect(L.alive).toBe(false);
    expect(t.morale).toBeLessThan(morale - 20);
    for (let i = 0; i < 30 * 200; i++) {
      m.update(1 / 30);
      m.events.length = 0;
    }
    expect(t.leader).toBe(L);
    expect(t.leader.alive).toBe(false);
  });
  it('aura van de leider verhoogt schade van nabije soldaten', () => {
    const m = mk();
    const t = m.teamById.ottoman;
    const L = t.leader;
    const s = place(m, 'ott_janissary', 'ottoman', L.x + 2, L.z);
    const far = place(m, 'ott_janissary', 'ottoman', L.x + 60, L.z);
    m.unitGrid.rebuild(m.units);
    m._updateAuras();
    expect(s.aura).toBeTruthy();
    expect(far.aura).toBeFalsy();
  });
  it('donjon wordt ingenomen als alleen aanvallers in de cirkel staan → team uitgeschakeld → overwinning', () => {
    const m = mk();
    // alle verdedigers weg
    for (const u of m.units) if (u.team === 'byzantine') u.alive = false;
    const k = m.teamById.byzantine.fort.keep;
    for (let i = 0; i < 8; i++) place(m, 'ott_azap', 'ottoman', k.x + k.r - 1, k.z + (i - 4) * 0.6);
    for (let i = 0; i < 30 * 200 && !m.over; i++) {
      m.unitGrid.rebuild(m.units);
      m._updateCapture(1 / 30);
      m._checkVictory();
    }
    expect(m.teamById.byzantine.alive).toBe(false);
    expect(m.over).toBe(true);
    expect(m.winner).toBe('ottoman');
  });
  it('verdedigers in de cirkel stoppen de inname', () => {
    const m = mk();
    const k = m.teamById.byzantine.fort.keep;
    for (let i = 0; i < 6; i++) place(m, 'ott_azap', 'ottoman', k.x + k.r - 1, k.z + i * 0.6);
    place(m, 'byz_skoutatos', 'byzantine', k.x - k.r + 1, k.z);
    for (let i = 0; i < 30 * 60; i++) {
      m.unitGrid.rebuild(m.units);
      m._updateCapture(1 / 30);
    }
    expect(m.teamById.byzantine.fort.capture).toBe(0);
  });
  it('tijdslimiet beslist op punten', () => {
    const m = mk({ length: 'short' });
    m.time = m.length.timeLimit + 1;
    m._checkVictory();
    expect(m.over).toBe(true);
    expect(m.winReason).toBe('time');
  });
});

describe('rekrutering', () => {
  it('nooit meer eenheden dan het plafond per team (plus leider en lijfwacht)', () => {
    const m = mk();
    for (let i = 0; i < 30 * 120; i++) {
      m.update(1 / 30);
      m.events.length = 0;
    }
    for (const t of m.teams) {
      const alive = m.units.filter((u) => u.alive && u.team === t.id && !u.siege).length;
      expect(alive).toBeLessThanOrEqual(m.cap + 5 + 16);
    }
  });
  it('alle teamcombinaties starten en draaien zonder fouten', () => {
    for (let n = 2; n <= 6; n++) {
      const teams = FACTION_IDS.slice(0, n);
      for (const mode of ['historical', 'ffa']) {
        const m = new Match({ teams, mode, troops: 'small', length: 'short', seed: n, withPlayer: true, playerTeam: teams[0], playerUnit: FACTIONS[teams[0]].roster[0] });
        for (let i = 0; i < 30 * 20; i++) {
          m.input = { mx: 0, mz: 1, yaw: 0, pitch: 0, attack: i % 10 === 0, aim: { x: 0, y: 1, z: 0 } };
          m.update(1 / 30);
          m.events.length = 0;
        }
        expect(m.player).toBeTruthy();
      }
    }
  }, 30000);
});

describe('vast leger: dood is dood', () => {
  it('elk team begint met precies het gekozen aantal soldaten', () => {
    for (const troops of ['small', 'normal']) {
      const m = new Match({ teams: ['ottoman', 'byzantine', 'genoa'], mode: 'historical', troops, length: 'short', seed: 3, withPlayer: false });
      for (const t of m.teams) {
        const n = m.units.filter((u) => u.team === t.id && !u.siege && u.alive).length;
        expect(n).toBe(TROOP_SIZES[troops].perTeam);
        expect(t.soldiers).toBe(n);
        expect(t.startSoldiers).toBe(n);
      }
    }
  });
  it('het aantal soldaten daalt alleen, nooit omhoog (hele simulatie)', () => {
    const m = new Match({ teams: ['ottoman', 'byzantine'], mode: 'ffa', troops: 'small', length: 'short', seed: 9, withPlayer: false });
    const prev = m.teams.map((t) => t.soldiers);
    let maxUid = m.uid;
    for (let i = 0; i < 30 * 60 * 6 && !m.over; i++) {
      m.update(1 / 30);
      m.events.length = 0;
      if (i % 30 === 0) {
        m.teams.forEach((t, k) => {
          const real = m.units.filter((u) => u.team === t.id && !u.siege && u.alive).length;
          expect(Math.max(0, t.soldiers)).toBe(real);
          expect(real).toBeLessThanOrEqual(prev[k]);
          prev[k] = real;
        });
        expect(m.uid).toBe(maxUid); // er worden geen nieuwe eenheden gemaakt
        maxUid = m.uid;
      }
    }
  }, 60000);
  it('speler sneuvelt en neemt een bestaande bot over; het leger groeit niet', () => {
    const m = new Match({ teams: ['ottoman', 'byzantine'], mode: 'ffa', troops: 'small', length: 'short', seed: 4, withPlayer: true, playerTeam: 'ottoman', playerUnit: 'ott_janissary' });
    const t = m.teamById.ottoman;
    const p = m.player;
    expect(p.typeId).toBe('ott_janissary');
    expect(t.soldiers).toBe(60);
    p.spawnT = -100;
    m.damageUnit(p, 1e6, 'slash', null, {});
    expect(t.soldiers).toBe(59);
    for (let i = 0; i < 30 * 20; i++) m.update(1 / 30);
    expect(m.player).toBe(p); // geen automatische respawn
    const counts = m.roleCounts('ottoman');
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(t.soldiers);
    const before = t.soldiers;
    const bot = m.pickBot('ottoman', 'ott_azap');
    m.takeOver(bot);
    expect(m.player).toBe(bot);
    expect(bot.isPlayer).toBe(true);
    expect(t.soldiers).toBe(before);
  });
  it('een team zonder soldaten ligt uit het spel', () => {
    const m = new Match({ teams: ['ottoman', 'byzantine'], mode: 'ffa', troops: 'small', length: 'short', seed: 5, withPlayer: false });
    for (const u of m.units) if (u.team === 'byzantine' && !u.siege) {
      u.spawnT = -100;
      m.damageUnit(u, 1e6, 'siege', null, {});
    }
    m.update(1 / 30);
    expect(m.teamById.byzantine.alive).toBe(false);
    expect(m.over).toBe(true);
    expect(m.winner).toBe('ottoman');
  });
});

describe('allianties', () => {
  it('alle teams even groot, ook in een ongelijke alliantie', () => {
    const m = new Match({ teams: ['ottoman', 'byzantine', 'genoa'], mode: 'historical', troops: 'small', length: 'short', seed: 3, withPlayer: false });
    const ott = m.teamById.ottoman;
    const byz = m.teamById.byzantine;
    expect(ott.alliance).not.toBe(byz.alliance);
    expect(ott.cap).toBe(byz.cap);
  });
  it('vrij-voor-allen geeft iedereen dezelfde omvang', () => {
    const m = new Match({ teams: ['ottoman', 'byzantine', 'genoa'], mode: 'ffa', troops: 'small', length: 'short', seed: 3, withPlayer: false });
    expect(new Set(m.teams.map((t) => t.cap)).size).toBe(1);
  });
});

describe('weergang', () => {
  it('na de ladder kun je over de muur lopen zonder eraf te vallen; E bij een ladder = afdalen', () => {
    const m = new Match({ teams: ['ottoman', 'byzantine'], mode: 'ffa', troops: 'small', length: 'short', seed: 2, withPlayer: true, playerTeam: 'ottoman', playerUnit: 'ott_janissary' });
    const p = m.player;
    const f = m.teamById.ottoman.fort;
    const post = f.posts.find((q) => q.walk);
    p.x = post.footX;
    p.z = post.footZ;
    p.spawnT = -100;
    const step = (inp, n) => {
      for (let i = 0; i < n; i++) {
        m.input = { mx: 0, mz: 0, yaw: 0, pitch: 0, ...inp };
        m.update(1 / 30);
        m.events.length = 0;
      }
    };
    step({ climb: true }, 1);
    step({}, 60);
    expect(p.wall).toBeTruthy();
    expect(p.y).toBeGreaterThan(5);
    const wk = p.wall.walk;
    // in alle richtingen lopen: blijft op de muur, binnen de weergang
    for (const [mx, mz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7]]) {
      step({ mx, mz }, 90);
      expect(p.wall).toBeTruthy();
      expect(p.y).toBeCloseTo(wk.h, 3);
      expect(p.wall.a).toBeGreaterThanOrEqual(wk.from);
      expect(p.wall.a).toBeLessThanOrEqual(wk.to);
      expect(Math.abs(p.wall.o)).toBeLessThan(wk.t / 2);
    }
    // terug naar een ladder en afdalen
    const l = f.posts.find((q) => q.walk === wk);
    p.wall.a = l.along;
    step({ climb: true }, 1);
    step({}, 50);
    expect(p.wall).toBeFalsy();
    expect(p.y).toBeCloseTo(0, 3);
  });
  it('een vernield muurstuk onder je voeten: je valt naar beneden', () => {
    const m = new Match({ teams: ['ottoman', 'byzantine'], mode: 'ffa', troops: 'small', length: 'short', seed: 2, withPlayer: true, playerTeam: 'ottoman', playerUnit: 'ott_janissary' });
    const p = m.player;
    const post = m.teamById.ottoman.fort.posts.find((q) => q.walk);
    p.post = null;
    p.wall = { walk: post.walk, a: post.along, o: 0 };
    p.y = post.walk.h;
    const piece = post.walk.pieces.find((q) => post.along >= q.a && post.along <= q.b);
    m.destroyStruct(piece.st, null);
    m.input = { mx: 0, mz: 0, yaw: 0, pitch: 0 };
    m.update(1 / 30);
    expect(p.wall).toBeFalsy();
    expect(p.y).toBe(0);
  });
});

describe('paard en springen', () => {
  const mkP = (unit) => new Match({ teams: ['hungary', 'ottoman'], mode: 'ffa', troops: 'small', length: 'short', seed: 6, withPlayer: true, playerTeam: 'hungary', playerUnit: unit });
  const step = (m, inp, n) => {
    for (let i = 0; i < n; i++) {
      m.input = { mx: 0, mz: 0, yaw: 0, pitch: 0, ...inp };
      m.update(1 / 30);
      m.events.length = 0;
    }
  };
  it('afstijgen laat het paard staan; opnieuw bestijgen kan', () => {
    const m = mkP('hun_knight');
    const p = m.player;
    expect(p.mounted).toBe(true);
    step(m, { climb: true }, 1);
    step(m, {}, 40);
    expect(p.mounted).toBe(false);
    expect(m.freeHorses.length).toBeGreaterThan(0);
    const h = m.freeHorses[m.freeHorses.length - 1];
    const hx = h.x;
    step(m, {}, 60);
    expect(h.x).toBe(hx); // paard blijft staan
    step(m, { climb: true }, 1);
    step(m, {}, 40);
    expect(p.mounted).toBe(true);
    expect(m.freeHorses.includes(h)).toBe(false);
  });
  it('springen te voet en te paard; het paard springt hoger', () => {
    const m = mkP('hun_knight');
    const p = m.player;
    let maxMounted = 0;
    step(m, { jump: true }, 1);
    for (let i = 0; i < 40; i++) {
      step(m, {}, 1);
      maxMounted = Math.max(maxMounted, p.y);
    }
    expect(p.y).toBe(0);
    step(m, { climb: true }, 1);
    step(m, {}, 40);
    let maxFoot = 0;
    step(m, { jump: true }, 1);
    for (let i = 0; i < 40; i++) {
      step(m, {}, 1);
      maxFoot = Math.max(maxFoot, p.y);
    }
    expect(maxFoot).toBeGreaterThan(0.3);
    expect(maxMounted).toBeGreaterThan(maxFoot * 1.5);
    expect(p.y).toBe(0);
  });
});
