/**
 * Ajustes persistentes (localStorage) + valores por defecto.
 */
const KEY = 'dron-se-settings-v1';

export const DEFAULT_SETTINGS = {
  mrCamera: true,          // usar la camara como passthrough
  biome: 'galpon',         // galpon | ciudad | valle
  quality: 'alta',         // baja | media | alta
  controlPreset: 'rc2',    // rc2 | gamer | arcade
  gyro: false,             // volar inclinando el telefono
  mouseFlight: false,      // volar con el raton
  sound: true,
  voice: false,
  wind: 'medio',           // calma | flojo | medio | fuerte | tormenta
  autoDayCycle: true,
  timeOfDay: 10.5,
  showMinimap: true,
  haptics: true,
  autoLights: true,        // faro automatico de noche
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* almacenamiento no disponible */ }
    return this.data;
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* noop */ }
  }

  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); }
  reset() { this.data = { ...DEFAULT_SETTINGS }; this.save(); }

  /** Definiciones para construir la pantalla de ajustes. */
  static schema() {
    return [
      { key: 'mrCamera', label: 'Camara (realidad mixta)', desc: 'Usa la imagen de tu camara como mundo real.', type: 'bool' },
      { key: 'autoLights', label: 'Faro automatico', desc: 'El dron enciende su luz cuando el entorno esta oscuro.', type: 'bool' },
      { key: 'biome', label: 'Entorno generado', desc: 'Escenario que se genera alrededor del dron.', type: 'select',
        options: [['galpon', 'Galpon industrial'], ['ciudad', 'Ciudad'], ['valle', 'Valle']] },
      { key: 'wind', label: 'Viento', desc: 'Intensidad media del viento que empuja al dron.', type: 'select',
        options: [['calma', 'Calma'], ['flojo', 'Flojo'], ['medio', 'Moderado'], ['fuerte', 'Fuerte'], ['tormenta', 'Tormenta']] },
      { key: 'controlPreset', label: 'Perfil de control', desc: 'Como se mapean el teclado y los joysticks.', type: 'select',
        options: [['rc2', 'Mando RC modo 2'], ['gamer', 'Gamer (WASD)'], ['arcade', 'Arcade']] },
      { key: 'gyro', label: 'Giroscopio', desc: 'Inclina el telefono para dirigir el dron (móvil).', type: 'bool' },
      { key: 'mouseFlight', label: 'Vuelo con raton', desc: 'El raton dirige la inclinacion del dron.', type: 'bool' },
      { key: 'showMinimap', label: 'Minimapa', desc: 'Mapa tactico en el HUD.', type: 'bool' },
      { key: 'autoDayCycle', label: 'Ciclo dia/noche', desc: 'El sol avanza con el tiempo.', type: 'bool' },
      { key: 'sound', label: 'Sonido', desc: 'Rotor, viento y avisos (se genera en directo).', type: 'bool' },
      { key: 'voice', label: 'Control por voz', desc: 'Ordenes en espanol: despegar, aterrizar, foto...', type: 'bool' },
      { key: 'haptics', label: 'Vibracion', desc: 'Respuesta haptica en impactos (móvil).', type: 'bool' },
      { key: 'quality', label: 'Calidad grafica', desc: 'Sombras y resolucion.', type: 'select',
        options: [['baja', 'Baja'], ['media', 'Media'], ['alta', 'Alta']] },
    ];
  }
}

export const WIND_LEVELS = {
  calma: { base: 0.3, label: 'CALMA' },
  flojo: { base: 1.6, label: 'FLOJO' },
  medio: { base: 3.6, label: 'MODERADO' },
  fuerte: { base: 7.0, label: 'FUERTE' },
  tormenta: { base: 11.5, label: 'TORMENTA' },
};
