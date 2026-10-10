// Draait veel complete potjes parallel en vat duur, winnaars en problemen samen.
// Gebruik: node scripts/sweep.mjs [--set basic|all|n6] [--troops normal] [--length normal] [--seeds 3]
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const FACS = ['ottoman', 'byzantine', 'genoa', 'venice', 'serbia', 'hungary'];

if (process.argv[2] === '--child') {
  const { runMatch } = await import('./simulate.mjs');
  process.on('message', (job) => {
    try {
      const r = runMatch(job);
      process.send({ ok: true, job, r: { minutes: r.minutes, winner: r.winner, reason: r.reason, stuckNow: r.stuckNow, maxStuckS: r.maxStuckS, worstStuck: r.worstStuck, maxIdleS: r.maxIdleS, idleNowMax: r.idleNowMax, idleWhy: r.idleWhy, avgTickMs: r.avgTickMs, worstTickMs: r.worstTickMs, log: r.log.filter((l) => /phase|fortFallen|end/.test(l)), teams: r.summary.teams.map((t) => ({ id: t.id, alive: t.alive, k: t.kills, l: t.losses, fort: t.fortHp, el: t.eliminatedAt && Math.round(t.eliminatedAt / 60) })) } });
    } catch (e) {
      process.send({ ok: false, job, err: String(e.stack || e) });
    }
  });
} else {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
  const set = args.set || 'basic';
  const seeds = +(args.seeds || 2);
  const jobs = [];
  const add = (teams, mode) => {
    for (let s = 1; s <= seeds; s++) jobs.push({ teams, mode, troops: args.troops || 'normal', length: args.length || 'normal', difficulty: 'normal', seed: s * 101 + teams.length });
  };
  if (set === 'basic') {
    add(['ottoman', 'byzantine'], 'historical');
    add(['genoa', 'serbia'], 'ffa');
    add(['venice', 'hungary'], 'ffa');
  } else if (set === 'pairs') {
    for (let i = 0; i < FACS.length; i++) for (let j = i + 1; j < FACS.length; j++) add([FACS[i], FACS[j]], 'ffa');
  } else if (set === 'multi') {
    add(['ottoman', 'byzantine', 'genoa'], 'historical');
    add(['ottoman', 'serbia', 'byzantine', 'venice'], 'historical');
    add(FACS, 'historical');
    add(FACS, 'ffa');
    add(['hungary', 'venice', 'serbia'], 'ffa');
  }
  const N = Math.min(os.cpus().length, jobs.length);
  const results = [];
  let next = 0;
  const t0 = Date.now();
  await new Promise((resolve) => {
    let active = 0;
    const startWorker = () => {
      const w = fork(fileURLToPath(import.meta.url), ['--child']);
      const feed = () => {
        if (next >= jobs.length) {
          w.kill();
          if (--active === 0) resolve();
          return;
        }
        w.send(jobs[next++]);
      };
      w.on('message', (msg) => {
        results.push(msg);
        const j = msg.job;
        if (msg.ok) {
          const r = msg.r;
          console.log(`${j.teams.join('+').padEnd(48)} ${j.mode.padEnd(10)} s${j.seed}  ${String(r.minutes).padStart(5)} min  winnaar=${String(r.winner).padEnd(10)} (${r.reason})  vast=${r.stuckNow}/${r.maxStuckS}s  tick=${r.avgTickMs}ms  ` + r.teams.map((t) => `${t.id.slice(0, 3)}:${t.alive ? 'J' : 'x' + t.el}/k${t.k}/f${t.fort}`).join(' '));
          if (r.maxStuckS > 120) console.log('    langst vast:', r.worstStuck);
          console.log(`    doelloos: max ${r.maxIdleS}s, tegelijk max ${r.idleNowMax}`, JSON.stringify(r.idleWhy));
        } else console.log('FOUT', j.teams.join('+'), msg.err);
        feed();
      });
      active++;
      feed();
    };
    for (let i = 0; i < N; i++) startWorker();
  });
  const ok = results.filter((r) => r.ok);
  const mins = ok.map((r) => r.r.minutes);
  const conquest = ok.filter((r) => r.r.reason === 'conquest').length;
  const wins = {};
  for (const r of ok) wins[r.r.winner] = (wins[r.r.winner] || 0) + 1;
  console.log(`\n${ok.length}/${results.length} geslaagd in ${((Date.now() - t0) / 1000).toFixed(0)} s · gemiddeld ${(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)} min (min ${Math.min(...mins)}, max ${Math.max(...mins)}) · ${conquest} door verovering · winnaars ${JSON.stringify(wins)}`);
}
