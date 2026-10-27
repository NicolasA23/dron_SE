/**
 * Campo de viento procedural.
 * El viento es el principal "actor" del entorno que empuja al dron:
 * direccion variable, rafagas periodicas, cizallamiento con la altura
 * y turbulencia. Todo se puede leer desde el HUD (rosa de los vientos).
 */
import * as THREE from 'three';
import { clamp, lerp, makeRng, TAU } from '../core/Utils.js';

export class WindField {
  constructor(seed = 1) {
    this.rng = makeRng(seed * 7919 + 13);
    this.dir = this.rng() * TAU;         // direccion base (rad)
    this.base = 1.6;                     // intensidad media m/s
    this.target = 1.6;
    this.gust = 0;                       // rafaga actual
    this.gustTimer = 2 + this.rng() * 4;
    this.gustStrength = 0;
    this.turbulence = 0.05;
    this.speed = new THREE.Vector3();
    this.gustSpeed = new THREE.Vector3();
    this.history = [];
    this._t = 0;
    this.magnitude = 0;
  }

  /** Configura el viento medio del entorno (0 = calma). */
  setBase(v) { this.target = v; }

  update(dt) {
    this._t += dt;
    this.base = lerp(this.base, this.target, 1 - Math.exp(-0.5 * dt));

    // rafagas: suben rapido y caen lentamente
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 1.6 + this.rng() * 5.5;
      this.gustStrength = 0.35 + this.rng() * 1.0;
      this.dir += (this.rng() - 0.5) * 0.7;
    }
    const target = this.gustStrength;
    this.gust = lerp(this.gust, target, 1 - Math.exp(-(this.gust > target ? 0.8 : 3.2) * dt));
    this.gustStrength = Math.max(0, this.gustStrength - dt * 0.12);

    const mag = this.base + this.gust;
    this.magnitude = mag;
    this.turbulence = clamp(mag / 16, 0.02, 0.5);

    // componente horizontal
    const hx = Math.cos(this.dir) * mag;
    const hz = Math.sin(this.dir) * mag;
    this.speed.set(hx, 0, hz);
    this.gustSpeed.set(hx, 0, hz);

    // histograma para la rosa de los vientos
    this.history.push({ x: hx, z: hz, m: mag });
    if (this.history.length > 90) this.history.shift();
  }

  /** Viento en un punto (cizallamiento: mas fuerte en altura). */
  sample(point, out = new THREE.Vector3()) {
    const h = Math.max(0, point.y);
    const shear = 1 + clamp(h / 26, 0, 1) * 0.45;
    return out.copy(this.speed).multiplyScalar(shear);
  }

  /** Direccion de procedencia en grados (para la rosa). */
  get directionDeg() {
    return ((-Math.atan2(this.speed.z, this.speed.x) / TAU) * 360 + 360) % 360;
  }

  get description() {
    const m = this.magnitude;
    if (m < 0.6) return 'CALMA';
    if (m < 3.4) return 'FLOJO';
    if (m < 6.5) return 'MODERADO';
    if (m < 10) return 'FUERTE';
    if (m < 14) return 'MUY FUERTE';
    return 'TORMENTA';
  }
}
