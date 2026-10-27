/**
 * CAPA DE REALIDAD MIXTA
 * ----------------------
 * 1. Passthrough: la imagen de la camara trasera se usa como "mundo real"
 *    sobre el que se compone la escena 3D.
 * 2. Analisis del entorno real: se mide el brillo, el color y el movimiento
 *    del video para que el juego responda a la habitacion del usuario
 *    (luz, adaptacion cromatica y deteccion de gestos con la mano).
 * 3. Orientacion del dispositivo: ancla el mundo virtual a la habitacion.
 * 4. WebXR (immersive-ar) cuando el navegador lo soporta.
 */
import * as THREE from 'three';
import { clamp } from './Utils.js';

const ANALYSIS_W = 48;
const ANALYSIS_H = 36;

export class MRCamera {
  constructor(video) {
    this.video = video;
    // canvas fuera de pantalla para el analisis del entorno real
    this.canvas = document.createElement('canvas');
    this.canvas.width = ANALYSIS_W;
    this.canvas.height = ANALYSIS_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.stream = null;
    this.enabled = false;
    this.facing = 'environment';

    /** Estado analizado del entorno real. */
    this.analysis = {
      luma: 0.5,          // 0 oscuro .. 1 brillante
      warmth: 0,          // -1 frio .. +1 calido
      motion: 0,          // 0..1 energia de movimiento
      presence: false,    // hay alguien moviendose delante
      idleTime: 99,
    };
    this.gesture = null;               // 'wave' cuando se detecta
    this.onGesture = null;

    this._prev = new Float32Array(ANALYSIS_W * ANALYSIS_H);
    this._hasPrev = false;
    this._acc = 0;
    this._cols = new Float32Array(4);
    this._colHistory = [];
    this._lastOrientation = new THREE.Quaternion();
    this._orientationReady = false;
    this._screenOrient = 0;
    this._deviceQuat = new THREE.Quaternion();
    this.xrSession = null;
    this.xrSupported = false;
    this._checkXR();
  }

  /* ---------------------- camara de video ---------------------- */

  async start(facing = 'environment') {
    this.facing = facing;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia no disponible');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.classList.toggle('mirror', facing === 'user');
    try { await this.video.play(); } catch { /* autoplay silenciado */ }
    this.enabled = true;
    return true;
  }

  stop() {
    this.stream?.getTracks?.().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.enabled = false;
  }

  get isLive() {
    return this.enabled && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  /* ---------------------- analisis del entorno ---------------------- */

  /** Muestra el video en el canvas de analisis y devuelve los datos. */
  sample() {
    if (!this.isLive) return null;
    const { ctx } = this;
    ctx.drawImage(this.video, 0, 0, ANALYSIS_W, ANALYSIS_H);
    return ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H);
  }

  /**
   * Analiza un frame: brillo, temperatura de color y movimiento.
   * Devuelve null si no hay video.
   */
  analyze(dt) {
    const data = this.sample();
    if (!data) {
      this.analysis.presence = false;
      return null;
    }
    const px = data.data;
    const n = ANALYSIS_W * ANALYSIS_H;
    let sum = 0, r = 0, b = 0, diff = 0;
    this._cols.fill(0);
    const colCount = new Float32Array(4);

    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const R = px[o], G = px[o + 1], B = px[o + 2];
      const y = 0.299 * R + 0.587 * G + 0.114 * B;
      sum += y; r += R; b += B;
      if (this._hasPrev) {
        const d = Math.abs(y - this._prev[i]);
        diff += d;
        const col = Math.min(3, Math.floor((i % ANALYSIS_W) / (ANALYSIS_W / 4)));
        this._cols[col] += d;
        colCount[col]++;
      }
      this._prev[i] = y;
    }
    this._hasPrev = true;

    const luma = sum / n / 255;
    const warmth = clamp((r - b) / (n * 90), -1, 1);
    const motion = clamp(diff / n / 14, 0, 1);
    this.analysis.luma = luma;
    this.analysis.warmth = warmth;
    this.analysis.motion = motion;

    // presencia / inactividad
    if (motion > 0.035) {
      this.analysis.presence = true;
      this.analysis.idleTime = 0;
    } else {
      this.analysis.idleTime += dt;
      if (this.analysis.idleTime > 4) this.analysis.presence = false;
    }

    this._detectGesture(dt);
    return this.analysis;
  }

  /** Detecta un saludo: el centro de masa del movimiento oscila izq/der. */
  _detectGesture(dt) {
    if (this._cols.some((c) => c <= 0)) return;
    let best = 0, bestV = -1;
    for (let i = 1; i < 4; i++) if (this._cols[i] > bestV) { bestV = this._cols[i]; best = i; }
    this._colHistory.push({ col: best, t: 0 });
    for (const h of this._colHistory) h.t += dt;
    while (this._colHistory.length && this._colHistory[0].t > 2.0) this._colHistory.shift();
    if (this._colHistory.length < 5) return;

    let reversals = 0;
    for (let i = 2; i < this._colHistory.length; i++) {
      const a = this._colHistory[i - 2].col, b = this._colHistory[i - 1].col, c = this._colHistory[i].col;
      if ((b > a && b >= c) || (b < a && b <= c)) reversals++;
    }
    if (reversals >= 3) {
      this._colHistory.length = 0;
      this.gesture = 'wave';
      this.onGesture?.('wave');
    }
  }

  /* ---------------------- orientacion del movil ---------------------- */

  /** Convierte alpha/beta/gamma en un quaternion de mundo. */
  static quaternionFromOrientation(alpha, beta, gamma, screenOrientation, target = new THREE.Quaternion()) {
    const zee = new THREE.Vector3(0, 0, 1);
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    euler.set(beta, alpha, -gamma, 'YXZ');
    target.setFromEuler(euler);
    target.multiply(q1);
    target.multiply(q0.setFromAxisAngle(zee, -screenOrientation));
    return target;
  }

  enableOrientation() {
    if (this._orientationReady) return;
    const handler = (e) => {
      if (e.alpha == null) return;
      const deg = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      this._screenOrient = deg * Math.PI / 180;
      MRCamera.quaternionFromOrientation(
        e.alpha * Math.PI / 180, e.beta * Math.PI / 180, e.gamma * Math.PI / 180,
        this._screenOrient, this._deviceQuat
      );
      this._orientationReady = true;
    };
    window.addEventListener('deviceorientation', handler, true);
    this._orientationReady = true;
  }

  /** iOS: pedir permiso explicito. */
  async requestOrientationPermission() {
    const D = window.DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === 'function') {
      try {
        const res = await D.requestPermission();
        if (res === 'granted') { this.enableOrientation(); return true; }
        return false;
      } catch { return false; }
    }
    this.enableOrientation();
    return true;
  }

  get orientation() {
    return this._orientationReady ? this._deviceQuat : null;
  }

  /* ---------------------- WebXR / AR ---------------------- */

  async _checkXR() {
    if (!navigator.xr?.isSessionSupported) return;
    try { this.xrSupported = await navigator.xr.isSessionSupported('immersive-ar'); } catch { /* noop */ }
  }

  async startAR(renderer, onEnd) {
    if (!this.xrSupported) throw new Error('WebXR AR no disponible');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hit-test', 'dom-overlay'],
      domOverlay: { root: document.body },
    });
    this.xrSession = session;
    await renderer.xr.setSession(session);
    session.addEventListener('end', () => { this.xrSession = null; onEnd?.(); });
    return session;
  }

  endAR(renderer) { return renderer?.xr?.getSession?.()?.end?.(); }
}
