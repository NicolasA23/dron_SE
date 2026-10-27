/**
 * PRUEBA DE INTEGRACION DEL JUEGO COMPLETO
 * ----------------------------------------
 * Arranca el Game real (con un WebGLRenderer sustituido por un doble) y
 * ejecuta el bucle de fotogramas, misiones, HUD, menus y entrada, para
 * detectar errores de ejecucion que la prueba de humo no cubre.
 *
 *   node --import ./test/register.mjs test/game-test.mjs
 */
import { installDOM } from './dom.mjs';

installDOM();

const { Settings } = await import('../src/core/Settings.js');
const { Game } = await import('../src/game/Game.js');
const { MISSIONS } = await import('../src/game/Missions.js');

let pass = 0, fail = 0;
const out = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name} ${extra}`); }
};

/** Espera a que terminen los temporizadores pendientes. */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

console.log('\n=== DRON SE · prueba de integracion (juego completo) ===\n');

const settings = new Settings();
settings.reset();
const game = new Game(settings);

/* ---------------- arranque ---------------- */
await game.boot();
await tick(50);
check('el juego arranca y muestra la portada', game.state === 'menu', `(${game.state})`);
check('el mundo de fondo se ha generado', game.world.obstacles.length > 0);
check('el menu tiene la portada activa', document.getElementById('screen-start').classList.contains('active'));

/* ---------------- ajustes ---------------- */
game.menu.buildSettings();
check('la pantalla de ajustes se construye', document.getElementById('settings-grid').children.length > 5,
  `(${document.getElementById('settings-grid').children.length})`);
game.menu.buildMissions();
check('la lista de misiones se construye', document.getElementById('mission-list').children.length === MISSIONS.length,
  `(${document.getElementById('mission-list').children.length})`);
game.menu.buildHelp();
check('la pantalla de controles se construye', document.getElementById('help-grid').children.length > 3);

/* ---------------- misiones ---------------- */
let rendered = 0;
const origRender = game.engine.renderer.render.bind(game.engine.renderer);
game.engine.renderer.render = (...a) => { rendered++; return origRender(...a); };

for (const def of MISSIONS) {
  let err = null;
  try {
    game.startMission(def.id);
    // simular 90 fotogramas a 60 fps
    for (let i = 0; i < 90; i++) {
      game._last = performance.now() - 1000 / 60;
      game._loop(performance.now());
    }
  } catch (e) { err = e; }
  check(`${def.id}: 90 fotogramas sin excepciones`, !err, err ? `\n      ${err.stack?.split('\n').slice(0, 3).join('\n      ')}` : '');
  check(`${def.id}: el dron existe en la escena`, game.state === 'playing' || game.state === 'result', `(${game.state})`);
  check(`${def.id}: el HUD tiene objetivos`, document.getElementById('mission-steps').children.length > 0);
}

/* ---------------- acciones del humano ---------------- */
game.startMission('tutorial');
for (let i = 0; i < 30; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
check('mision tutorial activa', game.state === 'playing');

let actionErr = null;
try {
  for (const a of ['takeoff', 'view', 'view1', 'view2', 'view3', 'view4', 'lights', 'photo',
    'home', 'winch', 'winch-down', 'winch-up', 'hover', 'minimap', 'wave', 'takeoff', 'pause']) {
    game._onAction(a);
  }
} catch (e) { actionErr = e; }
check('todas las acciones del HUD funcionan', !actionErr, actionErr ? actionErr.message : '');
check('la pausa se activa', game.state === 'paused');
game.resume();
check('se reanuda', game.state === 'playing');

/* ---------------- entrada ---------------- */
const input = game.input;
input.keys.add('KeyW');
input.keys.add('ArrowUp');
const st = input.update(0.016, game.drone);
check('la entrada de teclado produce mando', st.throttle !== 0 || st.pitch !== 0, JSON.stringify(st));
input.keys.clear();
const st2 = input.update(0.016, game.drone);
check('sin teclas el mando vuelve a cero', st2.throttle === 0 && st2.pitch === 0);

/* --- direcciones del teclado (perfil RC modo 2) --- */
const press = (code) => {
  input.keys.clear();
  input.keys.add(code);
  return input.update(0.016, game.drone);
};
check('W sube el acelerador', press('KeyW').throttle > 0, `(${press('KeyW').throttle})`);
check('S baja el acelerador', press('KeyS').throttle < 0);
check('flecha arriba = cabeceo adelante', press('ArrowUp').pitch > 0);
check('flecha abajo = cabeceo atras', press('ArrowDown').pitch < 0);
check('flecha derecha = alabeo a la derecha', press('ArrowRight').roll > 0);
check('D = giro a la derecha', press('KeyD').yaw > 0);
check('A = giro a la izquierda', press('KeyA').yaw < 0);
input.keys.clear();

/* --- otros perfiles de control --- */
input.setPreset('gamer');
check('perfil gamer: W cabecea', press('KeyW').pitch > 0);
check('perfil gamer: D alabea', press('KeyD').roll > 0);
input.setPreset('arcade');
check('perfil arcade: E gira', press('KeyE').yaw > 0);
input.setPreset('rc2');
input.keys.clear();

/* --- joysticks tactiles --- */
const joyL = input.joystickL;
if (joyL) {
  joyL.active = true;
  joyL.vector.y = 1; joyL.vector.x = 0.5;
  const stj = input.update(0.016, game.drone);
  check('el joystick izquierdo manda acelerador y giro', stj.throttle > 0 && stj.yaw > 0);
  joyL.active = false;
  joyL.vector.y = 0; joyL.vector.x = 0;
}

/* --- realidad mixta con camara simulada --- */
{
  globalThis.navigator.mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
  };
  const video = document.getElementById('mr-video');
  Object.assign(video, { readyState: 2, videoWidth: 64, videoHeight: 48 });
  await game.mr.start('environment');
  check('la camara MR se activa', game.mr.isLive === true);
  game._applyMR(true);
  check('el modo MR oculta el cielo', game.sky.dome.visible === false);
  check('la rejilla holografica es visible', game.world.holoGrid.material.opacity > 0);
  let mrErr = null;
  try {
    for (let i = 0; i < 40; i++) {
      game._last = performance.now() - 16;
      game._loop(performance.now());
    }
  } catch (e) { mrErr = e; }
  check('el bucle con MR activo no falla', !mrErr, mrErr ? mrErr.message : '');
  check('el analisis del entorno real devuelve datos', game.mr.analysis.luma >= 0);
  game._disableCamera();
  check('al desactivar la camara vuelve el cielo', game.sky.dome.visible === true);
  delete globalThis.navigator.mediaDevices;
}

/* ---------------- piloto automatico ---------------- */
game.startMission('tutorial');
for (let i = 0; i < 120; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
game.drone.takeoff();
for (let i = 0; i < 240; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
check('el dron ha despegado en la mision', game.drone.altitude > 0.5, `(alt=${game.drone.altitude.toFixed(2)})`);
game.autopilot = true;
for (let i = 0; i < 900; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
check('el piloto automatico regresa a la base', game.drone.position.length() < 6,
  `(dist=${game.drone.position.length().toFixed(2)})`);

/* ---------------- el HUD refleja el estado ---------------- */
{
  // estado conocido: dron en tierra
  game.autopilot = false;
  game.drone.land();
  for (let i = 0; i < 240; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
  check('el dron esta en tierra', game.drone.landed === true && !game.drone.isAirborne);

  // reproducir la estructura real del boton (el stub no analiza HTML)
  const btn = document.getElementById('btn-takeoff');
  btn.innerHTML = '';
  const ico = document.createElement('i');
  ico.className = 'ico';
  ico.textContent = '\u25B2';
  const lbl = document.createElement('span');
  lbl.textContent = 'DESPEGAR';
  btn.append(ico, lbl);

  game._onAction('takeoff');
  for (let i = 0; i < 60; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
  check('el boton pasa a ATERRIZAR', btn.querySelector('span')?.textContent === 'ATERRIZAR',
    `(${btn.querySelector('span')?.textContent})`);
  check('el icono del boton cambia', btn.querySelector('.ico')?.textContent === '\u25BC',
    `(${btn.querySelector('.ico')?.textContent})`);

  const steps = document.getElementById('mission-steps');
  check('los objetivos se pintan en el HUD', steps.children.length === game._mission.objectives.length,
    `(${steps.children.length} de ${game._mission.objectives.length})`);
  check('el texto del objetivo es correcto',
    steps.children[0]?.querySelector('span')?.textContent === game._mission.objectives[0].text);
  check('la telemetria se actualiza', document.getElementById('t-alt').textContent.includes('m'),
    `(${document.getElementById('t-alt').textContent})`);
  check('el viento se muestra en el HUD', document.getElementById('t-wind').textContent.includes('m/s'));

  game._onAction('takeoff');
  for (let i = 0; i < 60; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
  check('el boton vuelve a DESPEGAR', btn.querySelector('span')?.textContent === 'DESPEGAR');
}


/* ---------------- mision completa ---------------- */
game.startMission('tutorial');
const m = game._mission;
m.o.o1.complete(); m.o.o2.complete();
for (let i = 0; i < 30; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
game.drone.landed = true;
game.drone.flying = false;
game.drone.position.set(0, 0, 0);
game.drone.velocity.set(0, 0, 0);
for (let i = 0; i < 30; i++) { game._last = performance.now() - 16; game._loop(performance.now()); }
check('la mision se completa al aterrizar', game.state === 'result', `(${game.state})`);
check('la pantalla de resultado se muestra', document.getElementById('screen-result').classList.contains('active'));

/* ---------------- render ---------------- */
check('se han renderizado fotogramas', rendered > 200, `(${rendered})`);

/* ---------------- registro de mejor puntuacion ---------------- */
check('se guarda la mejor puntuacion', game.getBest('tutorial') != null, `(${game.getBest('tutorial')})`);

/* ---------------- volver al menu ---------------- */
game.toMenu();
check('se vuelve al menu', game.state === 'menu');
game.startMission('libre');
check('el vuelo libre arranca', game._mission.name === 'Vuelo libre');

console.log(out.join('\n'));
console.log(`\n=== ${pass} correctas, ${fail} fallidas ===\n`);
process.exit(fail ? 1 : 0);
