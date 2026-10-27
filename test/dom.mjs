/**
 * DOM simulado suficiente para ejecutar el juego completo en Node.
 * Se construye a partir de los ids reales de index.html.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------------- contexto 2D ---------------- */
function makeCtx2D() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    canvas: null,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    textAlign: '', textBaseline: '', lineJoin: '', lineCap: '', filter: '',
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop, createLinearGradient: () => grad, createRadialGradient: () => grad,
    createPattern: () => null,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setTransform: noop, transform: noop, resetTransform: noop,
    setLineDash: noop, getLineDash: () => [],
    fillText: noop, strokeText: noop,
    measureText: (t) => ({ width: (t || '').length * 8 }),
    drawImage: noop,
  };
}

/* ---------------- elementos ---------------- */
let elCount = 0;

function makeCanvas() {
  const c = {
    width: 300, height: 150, style: {},
    getContext: () => { const x = makeCtx2D(); x.canvas = c; return x; },
    addEventListener: () => {}, removeEventListener: () => {},
    toDataURL: () => 'data:image/png;base64,AAAA',
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    click: () => {},
  };
  return c;
}

function makeEl(id = '', tag = 'DIV') {
  const el = {
    id, tagName: tag, style: {}, dataset: {}, children: [], childNodes: [],
    className: '', textContent: '', value: '', checked: false,
    _html: '',
    width: 0, height: 0, offsetWidth: 0, offsetHeight: 0,
    _classes: new Set(),
    classList: null,
    attributes: {},
    firstChild: null, lastChild: null, firstElementChild: null, nextElementSibling: null,
    onclick: null, onchange: null, oninput: null,
    _listeners: {},
    appendChild(c) {
      this.children.push(c); this.childNodes.push(c);
      this.firstChild = this.children[0]; this.lastChild = c;
      if (c && typeof c === 'object') c._parent = this;
      return c;
    },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    prepend(c) { this.children.unshift(c); this.firstChild = c; if (c) c._parent = this; return c; },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      this.childNodes = this.childNodes.filter((x) => x !== c);
      this.firstChild = this.children[0] || null;
      this.lastChild = this.children[this.children.length - 1] || null;
      if (c) c._parent = null;
      return c;
    },
    remove() {
      const p = this._parent;
      if (p) p.removeChild(this);
      this._parent = null;
    },
    querySelector: (sel) => matchAll(el, sel)[0] || null,
    querySelectorAll: (sel) => matchAll(el, sel),
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    setPointerCapture() {}, releasePointerCapture() {},
    closest: () => null,
    contains: () => false,
    focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    getContext: () => makeCtx2D(),
  };
  // mantener className y classList sincronizados
  let _className = '';
  Object.defineProperty(el, 'className', {
    get() { return _className; },
    set(v) {
      _className = String(v);
      el._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    configurable: true,
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) {
      el._html = String(v);
      // el stub no analiza HTML: solo sabe vaciar el arbol
      if (String(v).trim() === '') {
        el.children = []; el.childNodes = [];
        el.firstChild = null; el.lastChild = null;
        for (const c of el.children) c._parent = null;
      }
    },
    configurable: true,
  });
  el.classList = {
    add: (...cs) => cs.forEach((c) => el._classes.add(c)),
    remove: (...cs) => cs.forEach((c) => el._classes.delete(c)),
    toggle: (c, f) => { if (f === undefined) f = !el._classes.has(c); f ? el._classes.add(c) : el._classes.delete(c); return f; },
    contains: (c) => el._classes.has(c),
  };
  return el;
}

/** Busqueda muy simple por etiqueta, .clase o #id dentro del subarbol. */
function matchAll(root, selector) {
  const out = [];
  const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  const walk = (node) => {
    for (const c of node.children || []) {
      if (!c || typeof c !== 'object') continue;
      for (const sel of parts) {
        if (sel.startsWith('.')) { if (c._classes?.has(sel.slice(1))) out.push(c); }
        else if (sel.startsWith('#')) { if (c.id === sel.slice(1)) out.push(c); }
        else if (c.tagName === sel.toUpperCase()) out.push(c);
      }
      walk(c);
    }
  };
  walk(root);
  return out;
}

export function installDOM() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);

  const byId = new Map();
  for (const id of ids) {
    const tag = /<canvas[^>]*id="/.test(html.slice(html.indexOf(`id="${id}"`) - 60, html.indexOf(`id="${id}"`)))
      ? 'CANVAS' : (id === 'mr-video' ? 'VIDEO' : 'DIV');
    byId.set(id, makeEl(id, tag));
  }
  // video necesita srcObject/play
  const video = byId.get('mr-video');
  Object.assign(video, {
    srcObject: null, readyState: 0, videoWidth: 0, videoHeight: 0,
    play: async () => {}, pause() {}, load() {},
  });

  const screens = [...byId.values()].filter((e) => e.id.startsWith('screen-'));

  const doc = {
    byId,
    createElement: (t) => (t === 'canvas' ? makeCanvas() : makeEl('', t.toUpperCase())),
    createElementNS: () => makeCanvas(),
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeEl(id));
      return byId.get(id);
    },
    querySelector: (sel) => {
      if (sel === '.screen') return screens[0] || makeEl();
      return makeEl();
    },
    querySelectorAll: (sel) => {
      if (sel === '.screen') return screens;
      if (sel === '[data-back]') return [makeEl()];
      return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    body: makeEl('body', 'BODY'),
    documentElement: makeEl('html', 'HTML'),
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
  };

  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.devicePixelRatio = 1;
  globalThis.localStorage = {
    _d: new Map(),
    getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
    setItem(k, v) { this._d.set(k, String(v)); },
    removeItem(k) { this._d.delete(k); },
    clear() { this._d.clear(); },
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, addListener: () => {} });
  globalThis.screen = { orientation: { angle: 0 } };
  globalThis.HTMLCanvasElement = function () {};
  globalThis.Image = class { constructor() { this.onload = null; } };
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'node-smoke',
        mediaDevices: null,
        vibrate: () => true,
        getGamepads: () => [],
        xr: null,
      },
      configurable: true, writable: true,
    });
  } catch { /* ya definido */ }
  return doc;
}
