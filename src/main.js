import { Capacitor } from '@capacitor/core';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Controls } from './controls.js';
import { initAudio, setMuted, muted } from './audio.js';

const $ = (id) => document.getElementById(id);

async function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.hide();
  } catch (e) { /* plugin niet beschikbaar */ }
  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    await ScreenOrientation.lock({ orientation: 'landscape' });
  } catch (e) { /* ignore */ }
}
setupNative();

const isMobile = matchMedia('(pointer: coarse)').matches;
const controls = new Controls($('touch-zone'));
const hud = new Hud();
const game = new Game($('game'), hud, controls, { lowQuality: isMobile && window.devicePixelRatio > 2.5 });

// Op de achtergrond van het menu vechten de bots al tegen elkaar.
game.start({ withPlayer: false });

let choice = { team: 'ottoman', difficulty: 'normal' };

document.querySelectorAll('.team-card').forEach((card) =>
  card.addEventListener('click', () => {
    document.querySelectorAll('.team-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    choice.team = card.dataset.team;
  }),
);
document.querySelectorAll('.diff button').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff button').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    choice.difficulty = btn.dataset.diff;
  }),
);

function show(screen) {
  for (const id of ['menu', 'pause', 'gameover']) $(id).classList.toggle('hidden', id !== screen);
  const inGame = screen === null || screen === 'pause';
  $('hud').classList.toggle('hidden', !inGame && screen !== 'gameover');
  document.body.classList.toggle('in-game', inGame);
}

function play() {
  initAudio();
  show(null);
  game.start({ ...choice, withPlayer: true });
  controls.lock();
}

$('btn-play').addEventListener('click', play);
$('btn-again').addEventListener('click', play);
$('btn-menu').addEventListener('click', () => {
  show('menu');
  game.start({ withPlayer: false });
});
$('btn-pause').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  game.pause(true);
  show('pause');
});
$('btn-resume').addEventListener('click', () => {
  show(null);
  game.pause(false);
  controls.lock();
});
$('btn-quit').addEventListener('click', () => {
  show('menu');
  game.start({ withPlayer: false });
});
$('btn-sound').addEventListener('click', () => {
  setMuted(!muted);
  $('btn-sound').textContent = 'Geluid: ' + (muted ? 'uit' : 'aan');
});
const sens = [
  ['laag', 0.6],
  ['normaal', 1],
  ['hoog', 1.5],
  ['zeer hoog', 2.1],
];
let sensIdx = 1;
$('btn-sens').addEventListener('click', () => {
  sensIdx = (sensIdx + 1) % sens.length;
  controls.sensitivity = sens[sensIdx][1];
  $('btn-sens').textContent = 'Gevoeligheid: ' + sens[sensIdx][0];
});

// Esc / pointer-lock kwijt => pauze (desktop)
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game.state === 'playing' && !controls.isTouch) {
    game.pause(true);
    show('pause');
  }
});
// App naar achtergrond => pauze
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    game.pause(true);
    show('pause');
  }
});
// Einde van de wedstrijd tonen
const overObserver = new MutationObserver(() => {
  if (!$('gameover').classList.contains('hidden')) show('gameover');
});
overObserver.observe($('gameover'), { attributes: true, attributeFilter: ['class'] });

document.addEventListener('pointerdown', initAudio, { once: true });
window.__game = game; // handig voor debuggen

// Esc/P pauzeert ook als de muis niet vastgezet kon worden
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && game.state === 'playing' && !document.pointerLockElement) {
    game.pause(true);
    show('pause');
  }
});
