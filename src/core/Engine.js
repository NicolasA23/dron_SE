/**
 * Motor de render (three.js) y rig de camara.
 *
 * Vistas disponibles:
 *   1 · FPV      — camara de a bordo del dron
 *   2 · PERSECUCION — camara que sigue al dron
 *   3 · OPERADOR — tu punto de vista dentro de la habitacion (MR)
 *   4 · CINEMATICA — orbita automatica alrededor del dron
 */
import * as THREE from 'three';
import { clamp, damp, lerp } from './Utils.js';

export const VIEWS = [
  { id: 'fpv', name: 'FPV' },
  { id: 'chase', name: 'Persecucion' },
  { id: 'operator', name: 'Operador (MR)' },
  { id: 'orbit', name: 'Cinematica' },
];

const QUALITY = {
  baja: { pixelRatio: 0.7, shadows: false, shadowMap: 1024 },
  media: { pixelRatio: 1.0, shadows: true, shadowMap: 1024 },
  alta: { pixelRatio: 1.5, shadows: true, shadowMap: 2048 },
};

export class Engine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.05, 900);

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,     // permite capturar la foto compuesta
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;

    this.viewIndex = 1;               // arranca en persecucion
    this.operatorPos = new THREE.Vector3(0, 1.55, 5.5);
    this.operatorYaw = 0;
    this.operatorPitch = -0.05;
    this._orbit = 0;
    this._shake = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._tmp = {
      pos: new THREE.Vector3(), look: new THREE.Vector3(), q: new THREE.Quaternion(),
      off: new THREE.Vector3(),
    };

    this.setQuality(opts.quality || 'alta');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    const cfg = QUALITY[q] || QUALITY.alta;
    this.quality = q;
    this.renderer.shadowMap.enabled = cfg.shadows;
    this._pixelRatio = cfg.pixelRatio;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (this._pixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get view() { return VIEWS[this.viewIndex]; }
  nextView() { this.viewIndex = (this.viewIndex + 1) % VIEWS.length; return this.view; }
  setView(i) { this.viewIndex = clamp(i, 0, VIEWS.length - 1); return this.view; }

  /**
   * Coloca la camara segun la vista activa.
   * @param {number} dt
   * @param {Drone} drone
   * @param {object} input estado de entrada
   * @param {object} extra { orientation:Quaternion|null, mr:boolean }
   */
  updateCamera(dt, drone, input, extra = {}) {
    const T = this._tmp;
    const cam = this.camera;
    const v = this.view.id;
    const shake = drone.shakeAmount();

    if (v === 'fpv') {
      drone.fpvPose(T.pos, T.q);
      cam.position.copy(T.pos);
      cam.quaternion.copy(T.q);
      // la camara mira hacia delante: el modelo apunta +Z
      cam.rotateY(Math.PI);
      // cabeceo suave de la camara con el mando
      cam.rotateX(clamp(-input.pitch * 0.25, -0.5, 0.5));
    } else if (v === 'chase') {
      const back = 5.2 + clamp(drone.airspeed * 0.16, 0, 3);
      const height = 1.9;
      const yaw = drone.targetYaw;
      // detras del dron: su vector adelante es (sin yaw, 0, cos yaw)
      T.off.set(-Math.sin(yaw) * back, height, -Math.cos(yaw) * back);
      T.pos.copy(drone.position).add(T.off);
      cam.position.x = damp(cam.position.x, T.pos.x, 5, dt);
      cam.position.y = damp(cam.position.y, T.pos.y, 4, dt);
      cam.position.z = damp(cam.position.z, T.pos.z, 5, dt);
      T.look.copy(drone.position);
      T.look.y += 0.4;
      cam.lookAt(T.look);
      cam.fov = damp(cam.fov, 68 + clamp(drone.airspeed * 0.8, 0, 14), 3, dt);
    } else if (v === 'operator') {
      // el observador esta en la habitacion; el dron vuela alrededor
      cam.position.copy(this.operatorPos);
      if (extra.orientation) {
        // anclar el mundo virtual a la habitacion con el giroscopio
        const e = this._euler.setFromQuaternion(extra.orientation, 'YXZ');
        this.operatorYaw = -e.y;
        this.operatorPitch = clamp(-e.x, -1.2, 1.2);
      } else {
        // arrastrar el raton / dedo para mirar alrededor
        this.operatorYaw -= (input.lookDX || 0) * 1.4;
        this.operatorPitch = clamp(this.operatorPitch - (input.lookDY || 0) * 1.4, -1.2, 1.2);
      }
      cam.quaternion.setFromEuler(
        this._euler.set(this.operatorPitch, this.operatorYaw, 0, 'YXZ')
      );
      cam.fov = damp(cam.fov, 70, 3, dt);
    } else {
      // cinematica: orbita lenta
      this._orbit += dt * 0.22;
      const r = 7.5;
      T.off.set(Math.sin(this._orbit) * r, 3.4 + Math.sin(this._orbit * 0.7) * 1.2, Math.cos(this._orbit) * r);
      cam.position.copy(drone.position).add(T.off);
      T.look.copy(drone.position);
      cam.lookAt(T.look);
      cam.fov = damp(cam.fov, 60, 3, dt);
    }

    // sacudida
    if (shake > 0.001) {
      const s = shake * 0.12;
      this._shake.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      cam.position.add(this._shake);
      cam.rotateZ((Math.random() - 0.5) * shake * 0.02);
    }
    cam.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  get isXR() { return this.renderer.xr.isPresenting; }
}
