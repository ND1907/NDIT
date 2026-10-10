// Simuleert complete potjes zonder scherm (Node) en rapporteert duur, winnaar,
// fases, vastgelopen eenheden en rekentijd.
// Gebruik: node scripts/simulate.mjs --teams ottoman,byzantine --troops normal --length normal --seed 1 [--max 3600] [--quiet]
import { Match } from '../src/sim/match.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);

export function runMatch(opts) {
  const dt = opts.dt || 1 / 30;
  const m = new Match({
    teams: opts.teams, mode: opts.mode || 'historical', difficulty: opts.difficulty || 'normal',
    length: opts.length || 'normal', troops: opts.troops || 'normal', seed: opts.seed || 1, withPlayer: false,
  });
  const maxT = opts.max || m.length.timeLimit + 10;
  const log = [];
  const counts = {};
  let tickMs = 0;
  let worst = 0;
  let ticks = 0;
  const stuck = new Map();
  let maxStuck = 0;
  const idle = new Map();
  const idleWhy = {};
  let maxIdle = 0;
  let idleNowMax = 0;
  let worstStuck = '';
  const t0 = Date.now();
  while (!m.over && m.time < maxT) {
    const a = performance.now();
    m.update(dt);
    const e = performance.now() - a;
    tickMs += e;
    worst = Math.max(worst, e);
    ticks++;
    for (const ev of m.events) {
      counts[ev.t] = (counts[ev.t] || 0) + 1;
      if (['phase', 'structDestroyed', 'fortFallen', 'leaderDown', 'attackWave', 'dock', 'cpTaken', 'end'].includes(ev.t)) {
        const what = ev.t === 'structDestroyed' ? `${ev.st.kind} van ${ev.st.team}` : ev.team || ev.n || ev.alliance || '';
        log.push(`${(m.time / 60).toFixed(1)}m ${ev.t} ${what}${ev.t === 'cpTaken' ? ' ' + ev.cp.name : ''}`);
      }
    }
    m.events.length = 0;
    // doelloze eenheden: geen voortgang, geen doelwit, geen geldige reden om stil te staan
    if (ticks % 30 === 0) {
      for (const u of m.units) {
        if (!u.alive || u.siege || u.isPlayer) continue;
        const a = (idle.get(u) || { x: u.x, z: u.z, t: m.time, why: '' });
        const o = u.squad?.order;
        const moved = Math.hypot(u.x - a.x, u.z - a.z) > 2.5;
        const busy = u.ai.target || u.ai.struct || u.ai.dockSt || u.attackT < 2 || u.post || u.climb || u.wall || moved;
        const holdOk = !o || ['defend', 'posts', 'keep', 'guard'].includes(o.kind) || (o.kind === 'rally' && !u.ai.wantMove) || (o.kind === 'attack' && !u.ai.wantMove && ['archer', 'crossbow', 'gunner', 'fire'].includes(u.role));
        if (busy || (holdOk && !u.ai.wantMove)) idle.set(u, { x: u.x, z: u.z, t: m.time });
        else {
          if (!idle.has(u)) idle.set(u, a);
          const dur = m.time - idle.get(u).t;
          if (dur > 15) {
            const key = `${o?.kind || '-'}${u.ai.wantMove ? '/wil' : '/staat'}${u.blockedBy ? '/blok' : ''}`;
            idleWhy[key] = Math.max(idleWhy[key] || 0, Math.round(dur));
            maxIdle = Math.max(maxIdle, dur);
          }
        }
      }
      let n = 0;
      for (const [u, a] of idle) if (u.alive && m.time - a.t > 15) n++;
      idleNowMax = Math.max(idleNowMax, n);
    }
    // vastgelopen eenheden: willen bewegen maar komen 20 s niet vooruit
    if (ticks % 30 === 0) {
      for (const u of m.units) {
        if (!u.alive || u.post || u.climb || u.siege) {
          stuck.delete(u);
          continue;
        }
        const prev = stuck.get(u);
        const want = u.ai.wantMove;
        if (!prev) stuck.set(u, { x: u.x, z: u.z, t: m.time });
        else if (Math.hypot(u.x - prev.x, u.z - prev.z) > 3 || !want) stuck.set(u, { x: u.x, z: u.z, t: m.time });
        else if (m.time - prev.t > maxStuck) {
          maxStuck = m.time - prev.t;
          const o = u.squad?.order;
          worstStuck = `${u.team}/${u.typeId} order=${o?.kind}${o?.team ? ':' + o.team : ''} pos=(${u.x.toFixed(0)},${u.z.toFixed(0)}) blk=${u.blockedBy?.kind || '-'} tgt=${u.ai.target ? u.ai.target.typeId : '-'} struct=${u.ai.struct?.kind || '-'} anchor=${u.squad?.members[0] === u} dock=${!!u.ai.dockSt} mounted=${!!u.mounted}`;
        }
      }
    }
    if (opts.progress && ticks % (30 * 60) === 0) {
      const alive = m.teams.map((t) => `${t.id}:${t.units}/${Math.round(t.morale)}m/${Math.round(t.manpower)}mp/f${Math.round(t.fort.capture * 100)}`).join(' ');
      console.log(`  t=${(m.time / 60).toFixed(0)}m ${alive}`);
    }
  }
  const stuckList = [...stuck.entries()].filter(([u, s]) => u.alive && m.time - s.t > 20);
  const stuckNow = stuckList.length;
  if (opts.showStuck) for (const [u, s] of stuckList) {
    const o = u.squad?.order;
    console.log(`  VAST ${Math.round(m.time - s.t)}s ${u.team}/${u.typeId} order=${o?.kind}${o?.team ? ':' + o.team : ''} pos=(${u.x.toFixed(1)},${u.z.toFixed(1)}) dv=(${(u.dvx || 0).toFixed(1)},${(u.dvz || 0).toFixed(1)}) blk=${u.blockedBy?.kind || '-'} tgt=${u.ai.target ? u.ai.target.typeId : '-'} struct=${u.ai.struct?.kind || '-'} anchor=${u.squad?.members[0] === u} dock=${!!u.ai.dockSt}`);
  }
  return {
    teams: opts.teams.join('+'), seed: opts.seed, minutes: +(m.time / 60).toFixed(1), winner: m.winner, reason: m.winReason,
    avgTickMs: +(tickMs / ticks).toFixed(2), worstTickMs: +worst.toFixed(1), units: m.units.filter((u) => u.alive).length,
    stuckNow, maxStuckS: Math.round(maxStuck), worstStuck, maxIdleS: Math.round(maxIdle), idleNowMax, idleWhy, wall: ((Date.now() - t0) / 1000).toFixed(0) + 's', log, counts, summary: m.summary(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runMatch({
    teams: (args.teams || 'ottoman,byzantine').split(','), troops: args.troops, length: args.length, mode: args.mode,
    seed: +(args.seed || 1), max: args.max ? +args.max : undefined, progress: !args.quiet, difficulty: args.difficulty, showStuck: true,
  });
  if (!args.quiet) for (const l of r.log) console.log('   ', l);
  const { log, counts, summary, ...rest } = r;
  console.log(JSON.stringify(rest));
  if (!args.quiet) console.log(JSON.stringify(counts));
  if (!args.quiet) console.log(JSON.stringify(summary.teams));
}
