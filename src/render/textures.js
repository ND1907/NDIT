import * as THREE from 'three';

// Procedurele textures (canvas): terrein, metselwerk, daken, vlaggen.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(w, h, draw, rep = [1, 1], srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep[0], rep[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function grassTexture() {
  return tex(512, 512, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#6d7a3c';
    g.fillRect(0, 0, w, h);
    // grote vlekken
    for (let i = 0; i < 90; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 20 + r() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const col = r() < 0.5 ? 'rgba(95,110,48,0.45)' : r() < 0.6 ? 'rgba(140,140,80,0.35)' : 'rgba(120,100,60,0.3)';
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // grassprietjes
    for (let i = 0; i < 9000; i++) {
      const v = r();
      g.fillStyle = v < 0.3 ? '#5c6a2e' : v < 0.6 ? '#7d8a45' : v < 0.85 ? '#8e9450' : '#a39d62';
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 3);
    }
  }, [60, 60]);
}

export function dirtTexture() {
  return tex(256, 256, (g, w, h) => {
    const r = rng(9);
    g.fillStyle = '#9a8460';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const v = r();
      g.fillStyle = v < 0.4 ? '#8a7452' : v < 0.7 ? '#a8936d' : '#7a6646';
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(110,100,90,0.6)';
      g.beginPath();
      g.arc(r() * w, r() * h, 1 + r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }, [1, 8]);
}

export function fieldTexture(kind) {
  return tex(256, 256, (g, w, h) => {
    const r = rng(kind === 0 ? 3 : 5);
    const base = kind === 0 ? '#b7a14e' : kind === 1 ? '#7d8a3a' : '#8a6e46';
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = kind === 2 ? 'rgba(80,60,40,0.5)' : 'rgba(80,70,30,0.35)';
      g.fillRect(0, y, w, 3);
    }
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = kind === 0 ? (r() < 0.5 ? '#c9b25c' : '#9e8a3e') : kind === 1 ? (r() < 0.5 ? '#6f7d34' : '#8e9a48') : '#7a5e3a';
      g.fillRect(r() * w, r() * h, 1, 2 + r() * 3);
    }
  }, [3, 3]);
}

// Metselwerk per fortstijl
export function masonryTexture(style, damaged = false) {
  const seed = { ottoman: 21, byzantine: 11, genoa: 31, venice: 41, serbia: 51, hungary: 61 }[style] || 11;
  return tex(512, 512, (g, w, h) => {
    const r = rng(seed);
    const pal = {
      ottoman: ['#8f8a7e', '#a39d90', '#7d786d', '#b2ab9c'], // grijze breuksteen (Rumelihisarı)
      byzantine: ['#c9b48e', '#bba680', '#d4c19c', '#ad9874'], // kalksteen met baksteenbanden
      genoa: ['#b9ad96', '#a89c84', '#c7bca6', '#9a8e78'],
      venice: ['#a8553e', '#9a4a36', '#b6624a', '#8a4030'], // baksteen
      serbia: ['#b8a888', '#a89878', '#c4b494', '#988868'],
      hungary: ['#d8d0bc', '#c8c0ac', '#e4dccb', '#b8b09c'], // witte steen
    }[style] || ['#b0a080'];
    g.fillStyle = '#6b6458';
    g.fillRect(0, 0, w, h);
    const brick = style === 'venice';
    const rowH = brick ? 16 : style === 'ottoman' ? 30 : 36;
    for (let y = 0, row = 0; y < h; y += rowH, row++) {
      let x = row % 2 ? -rowH : 0;
      while (x < w) {
        const bw = brick ? 34 + r() * 6 : rowH * (1.2 + r() * 1.2);
        g.fillStyle = pal[Math.floor(r() * pal.length)];
        if (style === 'ottoman') {
          // onregelmatige stenen
          g.beginPath();
          g.moveTo(x + 2 + r() * 3, y + 2);
          g.lineTo(x + bw - 2 - r() * 3, y + 2 + r() * 3);
          g.lineTo(x + bw - 2, y + rowH - 2 - r() * 3);
          g.lineTo(x + 2 + r() * 2, y + rowH - 2);
          g.fill();
        } else g.fillRect(x + 1.5, y + 1.5, bw - 3, rowH - 3);
        // verwering
        g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
        g.fillRect(x + 1.5, y + rowH - 6, bw - 3, 4);
        x += bw;
      }
    }
    // Byzantijnse en Servische baksteenbanden
    if (style === 'byzantine' || style === 'serbia') {
      const by = style === 'byzantine' ? [150, 400] : [260];
      for (const y0 of by) {
        g.fillStyle = '#5e3a2a';
        g.fillRect(0, y0, w, 52);
        for (let k = 0; k < 4; k++) {
          for (let x = (k % 2) * 14; x < w; x += 30) {
            g.fillStyle = r() < 0.5 ? '#9c4a32' : '#8a3e2a';
            g.fillRect(x + 1, y0 + 1 + k * 13, 27, 10);
          }
        }
      }
    }
    // vuil/korstmos
    for (let i = 0; i < 700; i++) {
      g.fillStyle = r() < 0.6 ? 'rgba(40,35,25,0.18)' : 'rgba(90,100,60,0.15)';
      g.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4);
    }
    // vocht onderaan
    const grd = g.createLinearGradient(0, h * 0.75, 0, h);
    grd.addColorStop(0, 'rgba(30,30,20,0)');
    grd.addColorStop(1, 'rgba(30,30,20,0.35)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    if (damaged) {
      g.strokeStyle = 'rgba(20,15,10,0.85)';
      for (let k = 0; k < 9; k++) {
        g.lineWidth = 2 + r() * 3;
        g.beginPath();
        let x = r() * w;
        let y = r() * h * 0.4;
        g.moveTo(x, y);
        for (let s = 0; s < 8; s++) {
          x += (r() - 0.5) * 60;
          y += 20 + r() * 30;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = 'rgba(20,15,10,0.25)';
      for (let k = 0; k < 30; k++) g.fillRect(r() * w, r() * h, 8 + r() * 20, 6 + r() * 14);
    }
  }, [1, 1]);
}

export function plasterTexture() {
  return tex(256, 256, (g, w, h) => {
    const r = rng(77);
    g.fillStyle = '#d9cdb2';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(160,140,110,0.25)' : 'rgba(255,250,235,0.25)';
      g.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 5);
    }
    g.fillStyle = 'rgba(90,70,50,0.25)';
    g.fillRect(0, h - 30, w, 30);
  });
}

export function roofTexture(color = '#9a4a32') {
  return tex(256, 256, (g, w, h) => {
    const r = rng(88);
    g.fillStyle = '#5a2a1a';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
        g.fillStyle = color;
        g.globalAlpha = 0.75 + r() * 0.25;
        g.beginPath();
        g.ellipse(x + 8, y + 9, 7.5, 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }, [2, 2]);
}

export function woodTexture() {
  return tex(256, 256, (g, w, h) => {
    const r = rng(99);
    g.fillStyle = '#6b4a2b';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      g.fillStyle = r() < 0.5 ? '#5e4024' : '#76532f';
      g.fillRect(x + 1, 0, 30, h);
      g.fillStyle = 'rgba(30,20,10,0.5)';
      g.fillRect(x, 0, 2, h);
      for (let k = 0; k < 20; k++) {
        g.fillStyle = 'rgba(40,25,10,0.25)';
        g.fillRect(x + 3 + r() * 26, r() * h, 1, 20 + r() * 50);
      }
    }
    // ijzeren beslag
    g.fillStyle = '#2e2e30';
    g.fillRect(0, 40, w, 12);
    g.fillRect(0, h - 52, w, 12);
    for (let x = 16; x < w; x += 32) {
      g.fillStyle = '#4a4a4e';
      g.beginPath();
      g.arc(x, 46, 4, 0, Math.PI * 2);
      g.arc(x, h - 46, 4, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function waterTexture() {
  return tex(256, 256, (g, w, h) => {
    const r = rng(5);
    g.fillStyle = '#3d5a5a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,150,150,0.25)' : 'rgba(20,40,40,0.25)';
      g.fillRect(r() * w, r() * h, 10 + r() * 30, 1 + r() * 2);
    }
  }, [4, 4]);
}

// ---------------------------------------------------------------------------
// Historische vlaggen
// ---------------------------------------------------------------------------
export function drawFlag(g, w, h, faction) {
  g.save();
  switch (faction) {
    case 'ottoman': {
      g.fillStyle = '#b3141f';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f2ece0';
      const cx = w * 0.42;
      const cy = h / 2;
      g.beginPath();
      g.arc(cx, cy, h * 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#b3141f';
      g.beginPath();
      g.arc(cx + h * 0.08, cy, h * 0.25, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f2ece0';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? h * 0.05 : h * 0.12;
        g.lineTo(cx + h * 0.36 + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.fill();
      break;
    }
    case 'byzantine': {
      // Palaiologos-vlag: gouden kruis met vier vuurstalen (B's)
      g.fillStyle = '#9b1020';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e3b23c';
      g.fillRect(w / 2 - h * 0.06, 0, h * 0.12, h);
      g.fillRect(0, h / 2 - h * 0.06, w, h * 0.12);
      g.font = `bold ${Math.round(h * 0.34)}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [x, y, f] of [[w / 4, h / 4, 1], [3 * w / 4, h / 4, -1], [w / 4, 3 * h / 4, 1], [3 * w / 4, 3 * h / 4, -1]]) {
        g.save();
        g.translate(x, y);
        g.scale(f, 1);
        g.fillText('B', 0, h * 0.02);
        g.restore();
      }
      break;
    }
    case 'genoa':
      g.fillStyle = '#f4f2ec';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#c8102e';
      g.fillRect(w / 2 - h * 0.1, 0, h * 0.2, h);
      g.fillRect(0, h / 2 - h * 0.1, w, h * 0.2);
      break;
    case 'venice': {
      g.fillStyle = '#8e1b1b';
      g.fillRect(0, 0, w, h);
      // gestileerde gevleugelde leeuw van San Marco
      g.fillStyle = '#e3b23c';
      const s = h / 100;
      g.save();
      g.translate(w * 0.5 - 50 * s, h * 0.18);
      g.scale(s, s);
      g.beginPath();
      g.ellipse(48, 52, 26, 14, 0, 0, Math.PI * 2); // lijf
      g.fill();
      g.beginPath();
      g.arc(76, 36, 12, 0, Math.PI * 2); // kop met manen
      g.fill();
      g.beginPath(); // vleugel
      g.moveTo(40, 44);
      g.quadraticCurveTo(30, 5, 70, 8);
      g.quadraticCurveTo(50, 22, 56, 44);
      g.fill();
      for (const x of [30, 40, 58, 68]) g.fillRect(x, 58, 5, 18); // poten
      g.beginPath(); // staart
      g.moveTo(22, 50);
      g.quadraticCurveTo(5, 40, 12, 26);
      g.lineWidth = 4;
      g.strokeStyle = '#e3b23c';
      g.stroke();
      g.fillStyle = '#f4f2ec'; // boek
      g.fillRect(80, 52, 14, 16);
      g.fillStyle = '#e3b23c';
      g.beginPath(); // aureool
      g.arc(76, 36, 17, Math.PI * 1.1, Math.PI * 1.9);
      g.lineWidth = 3;
      g.stroke();
      g.restore();
      break;
    }
    case 'serbia': {
      // witte dubbelkoppige adelaar op rood
      g.fillStyle = '#9b1c1c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f4f1ea';
      const cx = w / 2;
      const cy = h / 2;
      const s = h / 100;
      g.save();
      g.translate(cx, cy);
      g.scale(s, s);
      g.beginPath();
      g.ellipse(0, 6, 9, 22, 0, 0, Math.PI * 2);
      g.fill();
      for (const side of [-1, 1]) {
        g.beginPath(); // vleugel
        g.moveTo(side * 6, -4);
        g.lineTo(side * 40, -24);
        g.lineTo(side * 36, -6);
        g.lineTo(side * 42, 0);
        g.lineTo(side * 32, 10);
        g.lineTo(side * 8, 10);
        g.fill();
        g.beginPath(); // kop
        g.arc(side * 9, -24, 6, 0, Math.PI * 2);
        g.fill();
        g.fillRect(side * 12 - (side < 0 ? 6 : 0), -26, 6, 3);
      }
      g.beginPath(); // staart
      g.moveTo(-10, 26);
      g.lineTo(10, 26);
      g.lineTo(0, 40);
      g.fill();
      g.restore();
      break;
    }
    case 'hungary': {
      // Árpád-strepen + dubbelkruis op groene drieberg
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#f4f2ec' : '#c8102e';
        g.fillRect(0, (i * h) / 8, w / 2, h / 8 + 1);
      }
      g.fillStyle = '#c8102e';
      g.fillRect(w / 2, 0, w / 2, h);
      g.fillStyle = '#2f7a3a';
      const bx = w * 0.75;
      g.beginPath();
      g.arc(bx, h * 0.98, h * 0.14, Math.PI, 0);
      g.arc(bx - h * 0.18, h * 1.0, h * 0.11, Math.PI, 0);
      g.arc(bx + h * 0.18, h * 1.0, h * 0.11, Math.PI, 0);
      g.fill();
      g.fillStyle = '#f4f2ec';
      g.fillRect(bx - h * 0.03, h * 0.15, h * 0.06, h * 0.7);
      g.fillRect(bx - h * 0.15, h * 0.3, h * 0.3, h * 0.06);
      g.fillRect(bx - h * 0.11, h * 0.45, h * 0.22, h * 0.06);
      break;
    }
    default:
      g.fillStyle = '#777';
      g.fillRect(0, 0, w, h);
  }
  // stofstructuur
  g.globalAlpha = 0.08;
  for (let y = 0; y < h; y += 3) {
    g.fillStyle = y % 6 ? '#000' : '#fff';
    g.fillRect(0, y, w, 1);
  }
  g.restore();
}

const flagCache = new Map();
export function flagTexture(faction) {
  if (flagCache.has(faction)) return flagCache.get(faction);
  const t = tex(256, 160, (g, w, h) => drawFlag(g, w, h, faction), [1, 1]);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  flagCache.set(faction, t);
  return t;
}

export function flagDataURL(faction, w = 96, h = 60) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawFlag(c.getContext('2d'), w, h, faction);
  return c.toDataURL();
}

// zachte rondjes voor deeltjes
export function particleTexture() {
  return tex(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, [1, 1], false);
}
