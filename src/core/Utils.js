/**
 * Utilidades matematicas, generacion procedural de texturas y helpers de DOM.
 * Todo se genera en tiempo de ejecucion: el proyecto no necesita assets externos.
 */
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const moveTowards = (cur, target, maxDelta) => {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
};

/** Interpolacion con suavizado independiente del framerate. */
export const damp = (cur, target, lambda, dt) =>
  lerp(cur, target, 1 - Math.exp(-lambda * dt));

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Formatea segundos como mm:ss. */
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ------------------------------------------------------------------ */
/* Generador de numeros aleatorios con semilla (mulberry32)            */
/* ------------------------------------------------------------------ */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Ruido valor 2D con semilla (para terreno y texturas)                */
/* ------------------------------------------------------------------ */
export function makeNoise2D(seed = 1) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  return function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

/** Suma de octavas de ruido -> valor aproximadamente en [-1,1]. */
export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ */
/* Texturas generadas por canvas                                       */
/* ------------------------------------------------------------------ */
function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d') };
}

/** Textura de suelo tipo almacen: losa con juntas y suciedad. */
export function gridFloorTexture({ size = 512, tiles = 8, base = '#20262e', line = '#3d4753', accent = '#7ef7c8' } = {}) {
  const { c, ctx } = canvas2d(size, size);
  const noise = makeNoise2D(7);
  // losa base con manchas
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(noise, x / 26, y / 26, 4) * 0.5 + 0.5;
      const v = 26 + n * 26;
      const i = (y * size + x) * 4;
      img.data[i] = v * 0.95; img.data[i + 1] = v; img.data[i + 2] = v * 1.12; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // juntas
  const step = size / tiles;
  ctx.strokeStyle = line; ctx.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
  }
  // linea de seguridad
  ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 6;
  ctx.setLineDash([26, 18]);
  ctx.strokeRect(step * 0.5, step * 0.5, size - step, size - step);
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Textura de asfalto con marcas de calle. */
export function asphaltTexture({ size = 512, road = '#191d24', mark = '#c9d4e2' } = {}) {
  const { c, ctx } = canvas2d(size, size);
  const noise = makeNoise2D(21);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(noise, x / 9, y / 9, 5) * 0.5 + 0.5;
      const v = 20 + n * 30;
      const i = (y * size + x) * 4;
      img.data[i] = v * 0.95; img.data[i + 1] = v; img.data[i + 2] = v * 1.1; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = mark; ctx.globalAlpha = 0.75;
  ctx.fillRect(size / 2 - 4, 0, 8, size * 0.42);
  ctx.fillRect(size / 2 - 4, size * 0.58, 8, size * 0.42);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Textura de fachada con ventanas iluminadas. */
export function facadeTexture({ w = 256, h = 512, cols = 6, rows = 14, lit = 0.35, seed = 5 } = {}) {
  const { c, ctx } = canvas2d(w, h);
  const rng = makeRng(seed);
  ctx.fillStyle = '#141a22'; ctx.fillRect(0, 0, w, h);
  const bw = w / cols, bh = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * bw + bw * 0.18, y = r * bh + bh * 0.2;
      const ww = bw * 0.64, wh = bh * 0.56;
      const on = rng() < lit;
      ctx.fillStyle = on ? `rgba(${180 + rng() * 60 | 0},${200 + rng() * 40 | 0},255,.92)`
        : 'rgba(30,40,55,.9)';
      ctx.fillRect(x, y, ww, wh);
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, ww, wh);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Textura de hierba/tierra para el valle. */
export function terrainTexture({ size = 512, low = '#2c3a2a', high = '#54613f' } = {}) {
  const { c, ctx } = canvas2d(size, size);
  const noise = makeNoise2D(99);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(noise, x / 18, y / 18, 5) * 0.5 + 0.5;
      const t = clamp(n, 0, 1);
      const i = (y * size + x) * 4;
      img.data[i] = lerp(44, 84, t);
      img.data[i + 1] = lerp(58, 97, t);
      img.data[i + 2] = lerp(42, 63, t);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Textura radial suave (usada en brillos y destellos). */
export function radialGlowTexture(inner = 'rgba(255,255,255,.95)', outer = 'rgba(255,255,255,0)') {
  const { c, ctx } = canvas2d(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '.35)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Sprite con texto (etiquetas 3D flotantes). */
export function textSprite(text, { color = '#7ef7c8', bg = 'rgba(4,10,18,.78)', font = 26, pad = 18 } = {}) {
  const { c, ctx } = canvas2d(512, 128);
  ctx.font = `600 ${font}px "Segoe UI",Roboto,sans-serif`;
  const w = Math.min(500, ctx.measureText(text).width + pad * 2);
  c.width = Math.ceil(w); c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  roundRect(g, 2, 30, c.width - 4, 68, 14); g.fill();
  g.strokeStyle = color; g.lineWidth = 2; g.globalAlpha = .8;
  roundRect(g, 2, 30, c.width - 4, 68, 14); g.stroke();
  g.globalAlpha = 1;
  g.font = `600 ${font}px "Segoe UI",Roboto,sans-serif`;
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, 65);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  const s = 0.55;
  sp.scale.set((c.width / 128) * s, s, 1);
  return sp;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Cielo: gradiente vertical como textura de fondo esferico. */
export function skyTexture(top = '#0a1a33', mid = '#2b4a72', bottom = '#e8b98a') {
  const { c, ctx } = canvas2d(4, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Nube procedural simple (sprite con varios blob). */
export function cloudTexture(seed = 3) {
  const { c, ctx } = canvas2d(256, 128);
  const rng = makeRng(seed);
  ctx.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    const x = 40 + rng() * 176, y = 60 + rng() * 34, r = 12 + rng() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

/** Disco de helice con blur (motion blur). */
export function propDiscTexture() {
  const { c, ctx } = canvas2d(256, 256);
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(200,220,255,.16)');
  g.addColorStop(0.7, 'rgba(180,205,255,.09)');
  g.addColorStop(1, 'rgba(160,190,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(220,235,255,.20)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(128, 128, 120, 0, TAU); ctx.stroke();
  return new THREE.CanvasTexture(c);
}

export { roundRect };
