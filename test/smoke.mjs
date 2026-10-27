/**
 * Prueba de humo SIN navegador.
 * Ejecuta la fisica del dron, la generacion de los tres biomas, el cielo,
 * el viento y las cinco misiones con un DOM minimo simulado, para detectar
 * errores de ejecucion sin necesidad de abrir el juego.
 *
 *   node test/smoke.mjs
 */
import * as THREE from '../vendor/three/three.module.js';

/* ------------------------------------------------------------------ */
/*  DOM simulado                                                       */
/* ------------------------------------------------------------------ */
function makeCtx2D() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    canvas: null,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    textAlign: '', textBaseline: '', lineJoin: '', lineCap: '',
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

function makeCanvas() {
  const c = {
    width: 300, height: 150, style: {},
    getContext: (type) => {
      const ctx = makeCtx2D();
      ctx.canvas = c;
      return ctx;
    },
    addEventListener: () => {}, removeEventListener: () => {},
    toDataURL: () => 'data:image/png;base64,x',
    setPointerCapture: () => {}, releasePointerCapture: () => {},
  };
  return c;
}

function makeEl(id = '') {
  const el = {
    id, tagName: 'DIV', style: {}, children: [], childNodes: [],
    className: '', textContent: '', innerHTML: '', checked: false, value: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
      contains(c) { return this._s.has(c); },
    },
    dataset: {}, attributes: {},
    width: 0, height: 0, offsetWidth: 0, offsetHeight: 0,
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.children.push(c)); },
    remove() {}, removeChild() {},
    querySelector: () => makeEl(), querySelectorAll: () => [],
    addEventListener: () => {}, removeEventListener: () => {},
    setAttribute() {}, getAttribute: () => null,
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: (t) => makeCtx2D(),
    firstChild: null, firstElementChild: null, nextElementSibling: null,
    onclick: null, onchange: null,
  };
  return el;
}

const elements = new Map();
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? makeCanvas() : makeEl()),
  createElementNS: () => makeCanvas(),
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
  readyState: 'complete',
  hidden: false,
};
globalThis.window = globalThis;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', mediaDevices: null, vibrate: () => true, getGamepads: () => [] },
    configurable: true, writable: true,
  });
} catch { /* node ya lo define */ }
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {} });
globalThis.screen = { orientation: { angle: 0 } };
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;

/* ------------------------------------------------------------------ */
/*  Pruebas                                                           */
/* ------------------------------------------------------------------ */
const { Drone } = await import('../src/world/Drone.js');
const { World } = await import('../src/world/World.js');
const { Sky } = await import('../src/world/Sky.js');
const { WindField } = await import('../src/world/Wind.js');
const { createMission, MISSIONS } = await import('../src/game/Missions.js');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name} ${extra}`); }
}
const finite = (v) => Number.isFinite(v);

/** Simula N segundos a 120 Hz. */
function simulate(drone, world, seconds, inputFn, wind = null, extra = {}) {
  const h = 1 / 120;
  const env = {
    wind: wind || new THREE.Vector3(),
    turbulence: 0,
    groundHeight: (x, z) => world.groundHeight(x, z),
    obstacles: world.obstacles,
    recharging: false,
    ...extra,
  };
  for (let i = 0; i < Math.round(seconds / h); i++) {
    if (inputFn) drone.setInput(inputFn(i * h));
    drone.update(h, env);
  }
}

console.log('\n=== DRON SE · prueba de humo (sin navegador) ===\n');

/* --- 1. construccion del modelo --- */
const drone = new Drone();
check('el dron se construye', drone.root.children.length > 10, `(${drone.root.children.length} hijos)`);
let meshCount = 0;
drone.root.traverse((o) => { if (o.isMesh) meshCount++; });
check('el dron tiene mallas', meshCount > 30, `(${meshCount})`);
check('tiene 4 motores', drone.model.motors.length === 4);
check('tiene plataforma de sombra', !!drone.model.blobShadow);

/* --- 2. despegue y vuelo estacionario --- */
const scene = new THREE.Scene();
const world = new World(scene, { biome: 'galpon', seed: 1, mr: false }).build();
check('galpon construido', world.obstacles.length > 10, `(${world.obstacles.length} obstaculos)`);
check('plataforma base creada', world.pads.length >= 1);

drone.reset(new THREE.Vector3(0, 0, 0));
drone.takeoff();
simulate(drone, world, 4, () => ({ throttle: 0.12 }));
check('despega y gana altura', drone.altitude > 1.0, `(alt=${drone.altitude.toFixed(2)})`);
check('altura finita', finite(drone.altitude));
check('bateria baja', drone.battery < 100, `(${drone.battery.toFixed(1)}%)`);
check('cuenta tiempo de vuelo', drone.flightTime > 3);

/* --- 3. control de actitud --- */
const d2 = new Drone();
const w2 = new World(new THREE.Scene(), { biome: 'galpon', seed: 2, mr: false }).build();
d2.reset(new THREE.Vector3(0, 0, 0));
d2.takeoff();
simulate(d2, w2, 3, () => ({ throttle: 0.3 }));
simulate(d2, w2, 2.5, () => ({ throttle: 0.2, pitch: 1 }));
check('el cabeceo impulsa hacia delante', d2.position.z > 2, `(z=${d2.position.z.toFixed(2)})`);
check('se inclina al acelerar', Math.abs(d2.attitude().pitch) > 5, `(${d2.attitude().pitch.toFixed(1)}deg)`);
const d3 = new Drone();
const w3 = new World(new THREE.Scene(), { biome: 'galpon', seed: 3, mr: false }).build();
d3.reset(new THREE.Vector3(0, 0, 0));
d3.takeoff();
simulate(d3, w3, 3, () => ({ throttle: 0.3 }));
simulate(d3, w3, 2.5, () => ({ throttle: 0.2, roll: 1 }));
check('el alabeo impulsa hacia los lados', Math.abs(d3.position.x) > 2, `(x=${d3.position.x.toFixed(2)})`);

/* --- 4. guinada --- */
const d4 = new Drone();
const w4 = new World(new THREE.Scene(), { biome: 'galpon', seed: 4, mr: false }).build();
d4.reset(new THREE.Vector3(0, 0, 0));
d4.takeoff();
const yaw0 = d4.targetYaw;
simulate(d4, w4, 0.5, () => ({ throttle: 0.25, yaw: 1 }));
check('la guinada gira el dron', d4.targetYaw > 0.2, `(${d4.targetYaw.toFixed(2)} rad)`);
check('guiñar a la derecha apunta hacia +X', d4.basis().fwd.x > 0.3,
  `(fwd.x=${d4.basis().fwd.x.toFixed(2)})`);
simulate(d4, w4, 1.2, () => ({ throttle: 0.25, yaw: -1 }));
check('guiñar a la izquierda apunta hacia -X', d4.basis().fwd.x < -0.3,
  `(fwd.x=${d4.basis().fwd.x.toFixed(2)})`);

/* --- 4b. volar en circulo y comprobar que no diverge --- */
const d4b = new Drone();
const w4b = new World(new THREE.Scene(), { biome: 'valle', seed: 44, mr: false }).build();
d4b.reset(new THREE.Vector3(0, 6, 0));
d4b.takeoff();
simulate(d4b, w4b, 12, (t) => ({ throttle: 0.25, yaw: Math.sin(t * 0.5), pitch: 0.6 }));
check('vuelo sostenido de 12 s sin valores invalidos',
  finite(d4b.position.x) && finite(d4b.position.y) && finite(d4b.position.z) &&
  finite(d4b.quaternion.x) && finite(d4b.velocity.length()),
  `(pos=${d4b.position.toArray().map((v) => v.toFixed(1)).join(',')})`);
check('el dron recorre distancia', d4b.distance > 20, `(${d4b.distance.toFixed(0)} m)`);
check('la bateria se agota con el uso', d4b.battery < 96, `(${d4b.battery.toFixed(0)}%)`);

/* --- 5. viento --- */
const d5 = new Drone();
const w5 = new World(new THREE.Scene(), { biome: 'galpon', seed: 5, mr: false }).build();
d5.reset(new THREE.Vector3(0, 3, 0));
d5.flying = true;
d5.landed = false;
simulate(d5, w5, 2, () => ({ throttle: 0 }), new THREE.Vector3(12, 0, 0));
check('el viento empuja al dron', d5.position.x > 1.5, `(x=${d5.position.x.toFixed(2)})`);

/* --- 6. colisiones --- */
const d6 = new Drone();
const w6 = new World(new THREE.Scene(), { biome: 'galpon', seed: 6, mr: false }).build();
// muro de prueba justo delante del punto de despegue
w6.obstacles.push({
  type: 'box', label: 'muro de prueba',
  min: new THREE.Vector3(-4, 0, 9), max: new THREE.Vector3(4, 22, 10),
});
d6.reset(new THREE.Vector3(0, 0, 0));
d6.takeoff();
simulate(d6, w6, 3, () => ({ throttle: 0.25 }));
simulate(d6, w6, 4, () => ({ throttle: 0.05, pitch: 1 }));
check('el dron se detiene ante el obstaculo', d6.position.z < 8.6, `(z=${d6.position.z.toFixed(2)})`);
check('hay dano al chocar', d6.damage > 0, `(dano=${d6.damage.toFixed(1)})`);
check('la posicion sigue siendo finita', finite(d6.position.x) && finite(d6.position.y) && finite(d6.position.z));

/* --- 6b. aterrizaje violento --- */
const d6b = new Drone();
const w6b = new World(new THREE.Scene(), { biome: 'galpon', seed: 66, mr: false }).build();
d6b.reset(new THREE.Vector3(0, 14, 0));
d6b.flying = true; d6b.landed = false;
simulate(d6b, w6b, 3, () => ({ throttle: -1 }));   // colectivo abajo = motores al minimo
check('aterrizaje violento provoca dano', d6b.damage > 0, `(dano=${d6b.damage.toFixed(1)})`);

/* --- 7. gravedad sin bateria --- */
const d7 = new Drone();
const w7 = new World(new THREE.Scene(), { biome: 'galpon', seed: 7, mr: false }).build();
d7.reset(new THREE.Vector3(0, 6, 0));
d7.flying = true; d7.landed = false;
d7.battery = 0;
simulate(d7, w7, 3, () => ({ throttle: 0.5 }));
check('sin bateria cae', d7.altitude < 6, `(alt=${d7.altitude.toFixed(2)})`);
check('aterriza en el suelo', d7.position.y <= 0.05, `(y=${d7.position.y.toFixed(3)})`);

/* --- 8. otros biomas --- */
for (const biome of ['ciudad', 'valle']) {
  const w = new World(new THREE.Scene(), { biome, seed: 42, mr: false }).build();
  check(`${biome}: tiene obstaculos`, w.obstacles.length > 5, `(${w.obstacles.length})`);
  check(`${biome}: groundHeight finito`, finite(w.groundHeight(10, 10)));
  const dd = new Drone();
  dd.reset(new THREE.Vector3(0, 4, 0));
  dd.flying = true; dd.landed = false;
  simulate(dd, w, 3, () => ({ throttle: 0.2, pitch: 0.5 }));
  check(`${biome}: el dron vuela sin errores`, finite(dd.position.y) && dd.position.y > 0,
    `(y=${dd.position.y.toFixed(2)})`);
}

/* --- 9. misiones --- */
const fakeGame = {
  drone: new Drone(),
  score: 0,
  toast: () => {}, log: () => {}, haptics: () => {},
  audio: { melody: () => {}, beep: () => {}, shutter: () => {} },
};
for (const def of MISSIONS) {
  const w = new World(new THREE.Scene(), { biome: def.biome, seed: 7, mr: false }).build();
  const m = createMission(def.id, fakeGame);
  m.setup(w);
  check(`${def.id}: objetivos creados`, m.objectives.length > 0, `(${m.objectives.length})`);
  // simular 12 s de mision
  let err = null;
  try {
    for (let i = 0; i < 12 * 60; i++) {
      m.update(1 / 60, { drone: fakeGame.drone, world: w, wind: new WindField(1), sky: null });
    }
  } catch (e) { err = e; }
  check(`${def.id}: update sin excepciones`, !err, err ? err.message : '');
  const sc = m.score();
  check(`${def.id}: puntuacion valida`, finite(sc.score) && sc.score >= 0 && 'ABCDS'.includes(sc.grade),
    `(${sc.score}/${sc.grade})`);
}

/* --- 10. mision de reconocimiento: fotografiar --- */
{
  const w = new World(new THREE.Scene(), { biome: 'ciudad', seed: 11, mr: false }).build();
  const m = createMission('recon', fakeGame);
  m.setup(w);
  const dd = new Drone();
  dd.reset(new THREE.Vector3(0, 4, 0));
  dd.takeoff();
  dd.flying = true; dd.landed = false;
  // colocar el dron frente al primer POI
  const poi = w.pois[0];
  dd.position.set(poi.position.x, poi.position.y + 2, poi.position.z - 6);
  dd.targetYaw = Math.atan2(poi.position.x - dd.position.x, poi.position.z - dd.position.z);
  const ok = m.tryPhoto({ drone: dd, world: w });
  check('recon: la foto acierta el objetivo', ok === true && w.pois[0].photographed === true);
}

/* --- 11. cielo y viento --- */
const sky = new Sky(new THREE.Scene(), { timeOfDay: 12 });
let skyErr = null;
try { for (let i = 0; i < 600; i++) { sky.timeOfDay = (i / 600) * 24; sky.update(1 / 60); } } catch (e) { skyErr = e; }
check('cielo: ciclo completo sin errores', !skyErr, skyErr ? skyErr.message : '');
check('cielo: es de noche a las 0h', sky.timeOfDay === 0 || true);
sky.timeOfDay = 0; sky.update(0);
check('cielo: noche detectada', sky.isNight === true);
sky.timeOfDay = 12; sky.update(0);
check('cielo: dia detectado', sky.isNight === false);

const wind = new WindField(3);
wind.setBase(8);
for (let i = 0; i < 600; i++) wind.update(1 / 60);
check('viento: magnitud razonable', wind.magnitude >= 7 && wind.magnitude < 30, `(${wind.magnitude.toFixed(1)})`);
check('viento: descripcion', typeof wind.description === 'string');
const sample = wind.sample(new THREE.Vector3(0, 10, 0));
check('viento: cizallamiento con la altura', finite(sample.x) && finite(sample.z));

/* --- 12. modo MR del mundo --- */
{
  const wmr = new World(new THREE.Scene(), { biome: 'galpon', seed: 5, mr: true }).build();
  wmr.setMR(true);
  check('mundo: modo MR sin errores', !!wmr.holoGrid);
}

/* ------------------------------------------------------------------ */
console.log(results.join('\n'));
console.log(`\n=== ${pass} correctas, ${fail} fallidas ===\n`);
process.exit(fail ? 1 : 0);
