/**
 * Envoltorio de three.js para las pruebas: reexporta todo three.js real
 * excepto WebGLRenderer, que se sustituye por un doble de pruebas.
 * Asi se puede ejecutar el juego completo (Game, HUD, Menu, Input, misiones)
 * en Node sin necesidad de un contexto WebGL real.
 */
import * as REAL from '../vendor/three/three.module.js';

class StubRenderer {
  constructor() {
    this.domElement = { width: 1280, height: 720, style: {}, addEventListener() {}, getContext: () => null };
    this.shadowMap = { enabled: false, type: 0, needsUpdate: false };
    this.xr = {
      enabled: false,
      isPresenting: false,
      setSession: async () => {},
      getSession: () => null,
    };
    this.outputColorSpace = '';
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this._loop = null;
    this._pixelRatio = 1;
  }
  setPixelRatio(v) { this._pixelRatio = v; }
  setSize(w, h) { this.domElement.width = w; this.domElement.height = h; }
  setClearColor() {}
  setAnimationLoop(cb) { this._loop = cb; }
  render() { this._renderCount = (this._renderCount || 0) + 1; }
  dispose() {}
  compile() {}
}

export const WebGLRenderer = StubRenderer;
export * from '../vendor/three/three.module.js';
export { REAL as __REAL_THREE__ };
