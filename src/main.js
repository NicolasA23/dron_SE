/**
 * Punto de entrada: crea los ajustes, arranca el juego y conecta
 * los eventos globales (visibilidad, primer gesto del usuario, etc.).
 */
import { Settings, WIND_LEVELS } from './core/Settings.js';
import { Game } from './game/Game.js';

function ready(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

ready(async () => {
  const settings = new Settings();
  const game = new Game(settings);
  window.dronSE = game;   // util para depurar desde la consola

  // aplicar ajustes iniciales
  game.audio.setEnabled(settings.get('sound'));
  game.input.setPreset(settings.get('controlPreset'));
  game.engine.setQuality(settings.get('quality'));
  game.wind.setBase(WIND_LEVELS[settings.get('wind')]?.base ?? 3.6);
  game.sky.auto = settings.get('autoDayCycle');
  document.getElementById('panel-minimap').style.display = settings.get('showMinimap') ? '' : 'none';

  // primer gesto: desbloquear el audio del navegador
  const unlock = () => {
    game.audio.init();
    game.audio.setEnabled(settings.get('sound'));
    game.audio.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  // pausar si la pestana pierde el foco
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') game.pause();
  });

  // evitar el menu contextual y el zoom por doble toque
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  await game.boot();

  // si el navegador lo permite, ofrecer el modo AR
  game.menu.showARButton(game.mr.xrSupported);
  if (settings.get('mrCamera')) game._initCamera();
  if (settings.get('gyro')) game.mr.requestOrientationPermission();
  if (settings.get('voice') && game.input.voiceSupported) game.input.setVoice(true);
});
