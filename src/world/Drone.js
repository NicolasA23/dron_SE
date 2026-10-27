/**
 * DRON SE — modelo 3D procedural + fisica de cuadricoptero.
 *
 * El modelo replica el plano de referencia (assets/vista_general_2.webp):
 * cuerpo octogonal con lomo, 4 brazos en X, pods de motor con helices de 2 palas,
 * tren de aterrizaje de patines y camara estabilizada de 2 ejes.
 *
 * La fisica es un cuadricoptero simplificado pero creible:
 *   · empuje a lo largo del "up" del cuerpo (con efecto suelo)
 *   · control de actitud por par PD sobre un quaternion objetivo
 *   · resistencia aerodinamica cuadratica + campo de viento
 *   · bateria, dano estructural, vibracion y desequilibrio de motores
 */
import * as THREE from 'three';
import { clamp, damp, TAU, DEG, makeRng } from '../core/Utils.js';

/* ================================================================== */
/*  CONSTANTES DE VUELO                                               */
/* ================================================================== */
const PHYS = {
  mass: 1.35,              // kg
  g: 9.81,
  thrustToWeight: 2.15,    // relacion empuje/peso maxima
  hoverRatio: 1 / 2.15,    // colectivo que sostiene el vuelo estacionario
  maxTilt: 38 * DEG,       // angulo maximo de inclinacion
  maxYawRate: 165 * DEG,   // rad/s de guinada
  // Par de actitud (PD sobre el quaternion objetivo).
  // Con inercia ~0.02-0.03 kg m2: wn = sqrt(Kp/I) ~ 10 rad/s, zeta ~ 1.
  attitudeKp: 2.4,
  attitudeKd: 0.55,
  inertia: new THREE.Vector3(0.019, 0.030, 0.022), // Ixx, Iyy, Izz (aprox)
  dragArea: 0.085,         // Cd*A
  rho: 1.225,
  thrustLag: 0.10,         // s
  rpmMax: 11800,
  batteryDrainHover: 0.34, // %/s
  maxAngularRate: 9,       // rad/s (limite de velocidad angular)
};

const MOTOR_LAYOUT = [
  { pos: new THREE.Vector3(-0.60, 0.0, 0.60), dir: 1 },   // delantero-izq (CW)
  { pos: new THREE.Vector3(0.60, 0.0, 0.60), dir: -1 },   // delantero-der (CCW)
  { pos: new THREE.Vector3(-0.60, 0.0, -0.60), dir: -1 }, // trasero-izq   (CCW)
  { pos: new THREE.Vector3(0.60, 0.0, -0.60), dir: 1 },   // trasero-der   (CW)
];

/* ================================================================== */
/*  MATERIALES                                                         */
/* ================================================================== */
function buildMaterials() {
  return {
    shell: new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.42, metalness: 0.16 }),
    shellDark: new THREE.MeshStandardMaterial({ color: 0x9aa6b6, roughness: 0.5, metalness: 0.3 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x2b323d, roughness: 0.62, metalness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: 0x12151b, roughness: 0.75, metalness: 0.1 }),
    prop: new THREE.MeshStandardMaterial({
      color: 0x1a1f27, roughness: 0.55, metalness: 0.05,
      transparent: true, opacity: 0.94, side: THREE.DoubleSide,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0xff7a1a, roughness: 0.4, metalness: 0.2,
      emissive: 0x2a0d00, emissiveIntensity: 0.7,
    }),
    lensGlass: new THREE.MeshPhysicalMaterial({
      color: 0x05080d, roughness: 0.08, metalness: 0.9, clearcoat: 1, clearcoatRoughness: 0.05,
    }),
  };
}

/* ================================================================== */
/*  GEOMETRIA PROCEDURAL DEL DRON                                     */
/* ================================================================== */

/** Prisma octogonal con bordes achaflanados (look del plano). */
function octagonPrism(radius, depth, bevel) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);      // extrusion -> eje Y
  geo.computeVertexNormals();
  return geo;
}

/** Caja con bordes redondeados. */
function roundedBox(w, h, d, r = 0.01) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: d - r * 2, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2,
  });
  geo.translate(0, 0, -(d - r * 2) / 2);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Pala de helice: perfil aerodinamico alargado. */
function bladeGeometry(length = 0.295, chord = 0.082) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(chord * 0.42, length * 0.16, chord * 0.52, length * 0.62, chord * 0.20, length * 0.94);
  s.quadraticCurveTo(0, length, -chord * 0.05, length * 0.94);
  s.bezierCurveTo(-chord * 0.34, length * 0.60, -chord * 0.30, length * 0.14, 0, 0);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.007, bevelEnabled: true, bevelThickness: 0.0022, bevelSize: 0.0022, bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);           // plano XZ, espesor en Y
  geo.computeVertexNormals();
  return geo;
}

/** Construye la malla completa del dron. Devuelve referencias animables. */
function buildDroneModel(M) {
  const root = new THREE.Group();

  /* ---------- cuerpo central ---------- */
  const body = new THREE.Mesh(octagonPrism(0.255, 0.13, 0.028), M.shell);
  body.castShadow = true;
  root.add(body);

  const hump = new THREE.Mesh(octagonPrism(0.185, 0.055, 0.022), M.shell);
  hump.position.y = 0.088;
  hump.rotation.x = -7 * DEG;
  hump.castShadow = true;
  root.add(hump);

  const topPlate = new THREE.Mesh(octagonPrism(0.165, 0.014, 0.005), M.graphite);
  topPlate.position.y = 0.128;
  topPlate.rotation.x = -7 * DEG;
  topPlate.castShadow = true;
  root.add(topPlate);

  // franja de identidad naranja
  const stripe = new THREE.Mesh(roundedBox(0.10, 0.012, 0.02), M.accent);
  stripe.position.set(0, 0.045, 0.243);
  root.add(stripe);

  // visor frontal
  const visor = new THREE.Mesh(roundedBox(0.30, 0.055, 0.03, 0.012), M.graphite);
  visor.position.set(0, 0.012, 0.228);
  visor.castShadow = true;
  root.add(visor);

  // respiraderos laterales
  for (const sx of [-1, 1]) {
    const vent = new THREE.Mesh(roundedBox(0.02, 0.06, 0.16, 0.006), M.black);
    vent.position.set(sx * 0.243, -0.01, 0.02);
    root.add(vent);
  }

  // LED frontal de estado
  const frontLed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xdff0ff }));
  frontLed.position.set(0, 0.055, 0.245);
  root.add(frontLed);

  /* ---------- brazos + motores + helices ---------- */
  const motors = [];
  const bladeGeo = bladeGeometry();
  const discMat = new THREE.MeshBasicMaterial({
    map: null, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const discTex = propDiscTexture();
  discMat.map = discTex;

  MOTOR_LAYOUT.forEach((m, i) => {
    const armDir = m.pos.clone().setY(0).normalize();
    const armLen = m.pos.length();
    const isFront = m.pos.z > 0;

    // brazo (cilindro ahusado)
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.040, armLen, 12), M.shell);
    arm.position.copy(m.pos).multiplyScalar(0.5).setY(-0.005);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir);
    arm.castShadow = true;
    root.add(arm);

    // refuerzo del brazo contra el cuerpo
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 8), M.graphite);
    brace.position.copy(armDir).multiplyScalar(0.13).setY(-0.03);
    brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.clone().setY(-0.35).normalize());
    root.add(brace);

    // pod del motor (capsula + anillo + morro)
    const pod = new THREE.Group();
    pod.position.copy(m.pos).setY(-0.005);
    const podBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.075, 4, 14), M.shellDark);
    podBody.castShadow = true;
    pod.add(podBody);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.010, 8, 20), M.graphite);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.055;
    pod.add(collar);
    const podNose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10, 0, TAU, 0, Math.PI / 2), M.graphite);
    podNose.rotation.x = Math.PI;
    podNose.position.y = -0.062;
    pod.add(podNose);
    root.add(pod);

    // buje
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.026, 12), M.graphite);
    hub.position.y = 0.088;
    pod.add(hub);

    // helice: 2 palas con angulo de paso
    const prop = new THREE.Group();
    prop.position.y = 0.104;
    const b1 = new THREE.Mesh(bladeGeo, M.prop);
    const b2 = new THREE.Mesh(bladeGeo, M.prop);
    b2.rotation.y = Math.PI;
    b1.rotation.z = 12 * DEG;
    b2.rotation.z = 12 * DEG;
    prop.add(b1, b2);
    pod.add(prop);

    // disco de blur (giro rapido)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.30, 40), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.104;
    pod.add(disc);

    // luz de navegacion en la punta
    const navColor = isFront ? (m.pos.x < 0 ? 0xff2d4a : 0x2dff8a) : 0xdff0ff;
    const navMat = new THREE.MeshBasicMaterial({ color: navColor, transparent: true });
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), navMat);
    nav.position.set(m.pos.x * 1.02, -0.03, m.pos.z * 1.02);
    root.add(nav);

    motors.push({ pod, prop, disc, nav, navMat, dir: m.dir, rpm: 0, health: 1, phase: i * 1.7 });
  });

  /* ---------- tren de aterrizaje (patines) ---------- */
  const gear = new THREE.Group();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.36, 8), M.graphite);
      strut.position.set(sx * 0.175, -0.22, sz * 0.185);
      strut.castShadow = true;
      gear.add(strut);
    }
    const skid = new THREE.Mesh(roundedBox(0.042, 0.042, 0.60, 0.019), M.graphite);
    skid.position.set(sx * 0.175, -0.40, 0);
    skid.castShadow = true;
    gear.add(skid);
    for (const sz of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.008, 0.10, 8), M.graphite);
      tip.position.set(sx * 0.175, -0.365, sz * 0.30);
      tip.rotation.x = sz * 28 * DEG;
      gear.add(tip);
    }
  }
  const crossBar = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.34, 6), M.graphite);
  crossBar.rotation.z = Math.PI / 2;
  crossBar.position.y = -0.36;
  gear.add(crossBar);
  root.add(gear);

  /* ---------- camara estabilizada (gimbal 2 ejes) ---------- */
  const gimbal = new THREE.Group();
  gimbal.position.set(0, -0.10, 0.085);
  root.add(gimbal);

  const yawRing = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.011, 8, 26), M.graphite);
  yawRing.rotation.x = Math.PI / 2;
  yawRing.castShadow = true;
  gimbal.add(yawRing);

  const yawYoke = new THREE.Mesh(roundedBox(0.02, 0.05, 0.05, 0.008), M.graphite);
  yawYoke.position.set(0, 0.075, 0);
  gimbal.add(yawYoke);

  const pitchGroup = new THREE.Group();
  pitchGroup.position.y = -0.055;
  gimbal.add(pitchGroup);

  for (const sx of [-1, 1]) {
    const bracket = new THREE.Mesh(roundedBox(0.014, 0.06, 0.05, 0.006), M.graphite);
    bracket.position.set(sx * 0.062, 0, 0);
    pitchGroup.add(bracket);
  }

  const camBody = new THREE.Mesh(roundedBox(0.145, 0.105, 0.115, 0.022), M.shell);
  camBody.position.y = -0.055;
  camBody.castShadow = true;
  pitchGroup.add(camBody);

  const camBack = new THREE.Mesh(roundedBox(0.11, 0.07, 0.03, 0.012), M.graphite);
  camBack.position.set(0, -0.055, -0.065);
  pitchGroup.add(camBack);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.046, 0.05, 20), M.graphite);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.055, 0.075);
  pitchGroup.add(lens);

  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.006, 8, 22), M.accent);
  lensRing.position.set(0, -0.055, 0.096);
  pitchGroup.add(lensRing);

  const lensGlass = new THREE.Mesh(new THREE.CircleGeometry(0.038, 22), M.lensGlass);
  lensGlass.position.set(0, -0.055, 0.101);
  pitchGroup.add(lensGlass);

  const camLedMat = new THREE.MeshBasicMaterial({ color: 0xdff0ff });
  const camLed = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), camLedMat);
  camLed.position.set(0.052, -0.03, 0.058);
  pitchGroup.add(camLed);

  // foco de aterrizaje (se activa de noche o con el boton de luces)
  const headlight = new THREE.SpotLight(0xfff2d8, 0, 10, 26 * DEG, 0.45, 1.2);
  headlight.position.set(0, -0.16, 0.14);
  const hlTarget = new THREE.Object3D();
  hlTarget.position.set(0, -3.4, 1.6);
  gimbal.add(headlight, hlTarget);
  headlight.target = hlTarget;

  /* ---------- sombra de contacto (anclaje visual en MR) ---------- */
  const blobShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 28),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false })
  );
  blobShadow.rotation.x = -Math.PI / 2;

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  return { root, motors, gear, gimbal, pitchGroup, yawRing, headlight, blobShadow, frontLed, camLed, camLedMat };
}

/* ================================================================== */
/*  CLASE DRON                                                        */
/* ================================================================== */
export class Drone {
  constructor(opts = {}) {
    const M = buildMaterials();
    this.materials = M;
    const model = buildDroneModel(M);
    this.root = model.root;
    this.model = model;

    /* --- estado de vuelo --- */
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.angularVel = new THREE.Vector3();      // ejes cuerpo (x=alabeo, y=guinada, z=cabeceo)
    this.thrust = 0;
    this.armed = false;
    this.flying = false;
    this.landed = true;
    this.crashed = false;

    /* --- mando --- */
    this.input = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    this.targetYaw = 0;
    this.rpm = [0, 0, 0, 0];

    /* --- energia / dano --- */
    this.battery = 100;
    this.damage = 0;
    this.motorHealth = [1, 1, 1, 1];
    this.flightTime = 0;
    this.maxAltitude = 0;
    this.distance = 0;
    this.topSpeed = 0;

    /* --- accesorios --- */
    this.lightsOn = false;
    this.headlight = model.headlight;
    this.winch = { deployed: false, length: 0, target: 0, payload: null };
    this._hookMesh = null;

    /* --- scratch --- */
    this._tmp = {
      forces: new THREE.Vector3(), rel: new THREE.Vector3(), torque: new THREE.Vector3(),
      up: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(),
      n: new THREE.Vector3(), axis: new THREE.Vector3(), prev: new THREE.Vector3(),
      q: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(),
      e: new THREE.Euler(),
    };
    this._rng = makeRng(1337);
    this._shake = 0;
    this._blink = 0;
    this._lightAuto = true;
    this._onImpact = null;
  }

  /* -------------- getters -------------- */
  get mass() { return PHYS.mass; }
  get altitude() { return this.position.y; }
  get airspeed() { return this.velocity.length(); }
  get batteryPct() { return clamp(this.battery, 0, 100); }
  get integrity() { return clamp(100 - this.damage, 0, 100); }
  get isAirborne() { return this.flying && !this.landed && !this.crashed; }
  get headingDeg() { return ((-this.targetYaw / DEG) % 360 + 360) % 360; }
  get rotorRpmAvg() { return (this.rpm[0] + this.rpm[1] + this.rpm[2] + this.rpm[3]) / 4; }

  /** Angulos de actitud para el HUD (grados). */
  attitude() {
    this._tmp.e.setFromQuaternion(this.quaternion, 'YXZ');
    return { roll: this._tmp.e.z / DEG, pitch: this._tmp.e.x / DEG, yaw: this._tmp.e.y / DEG };
  }

  /** Vectores base en mundo (up, fwd, right). Son referencias reutilizables. */
  basis() {
    const t = this._tmp;
    t.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    t.fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    t.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    return { up: t.up, fwd: t.fwd, right: t.right };
  }

  /* -------------- ciclo -------------- */
  reset(position = new THREE.Vector3(0, 0, 0), yaw = 0) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    this.angularVel.set(0, 0, 0);
    this.targetYaw = yaw;
    this.thrust = 0;
    this.battery = 100;
    this.damage = 0;
    this.motorHealth = [1, 1, 1, 1];
    this.crashed = false;
    this.flying = false;
    this.landed = true;
    this.armed = false;
    this.flightTime = 0;
    this.maxAltitude = 0;
    this.distance = 0;
    this.topSpeed = 0;
    this.rpm = [0, 0, 0, 0];
    this._shake = 0;
    this.winch.length = 0;
    this.winch.target = 0;
    this.winch.payload = null;
    if (this._hookMesh) this._hookMesh.visible = false;
    this.syncTransform();
  }

  syncTransform() {
    this.root.position.copy(this.position);
    this.root.quaternion.copy(this.quaternion);
  }

  /* -------------- mando -------------- */
  setInput({ throttle = 0, roll = 0, pitch = 0, yaw = 0 } = {}) {
    this.input.throttle = clamp(throttle, -1, 1);
    this.input.roll = clamp(roll, -1, 1);
    this.input.pitch = clamp(pitch, -1, 1);
    this.input.yaw = clamp(yaw, -1, 1);
  }

  arm() { this.armed = true; }
  disarm() { this.armed = false; this.input.throttle = 0; }

  takeoff() {
    if (this.crashed) return false;
    this.armed = true;
    this.flying = true;
    this.landed = false;
    this.input.throttle = Math.max(this.input.throttle, 0.15);
    return true;
  }

  land() { this.flying = false; this.input.throttle = 0; }
  toggleLights() { this.lightsOn = !this.lightsOn; return this.lightsOn; }
  onImpact(fn) { this._onImpact = fn; }

  /* -------------- fisica -------------- */
  /**
   * Avanza la simulacion.
   * @param {number} dt segundos
   * @param {object} env { wind, turbulence, groundHeight, obstacles, recharging, onBump }
   */
  update(dt, env = {}) {
    const T = this._tmp;
    const wind = env.wind || T.rel.set(0, 0, 0);
    const groundY = env.groundHeight ? env.groundHeight(this.position.x, this.position.z) : 0;

    if (this.crashed) {
      this._updateRotorVisuals(dt, 0);
      this._updateLights(dt);
      this._fallApart(dt, groundY);
      this.syncTransform();
      return;
    }

    /* ---- colectivo -> empuje ---- */
    const thrustRatio = clamp(PHYS.hoverRatio + this.input.throttle * (1 - PHYS.hoverRatio), 0, 1.06);
    let motorSum = 0;
    for (let i = 0; i < 4; i++) motorSum += this.motorHealth[i];
    const healthFactor = clamp(motorSum / 4, 0.45, 1);
    const hAbove = Math.max(0, this.position.y - groundY);
    const groundEffect = 1 + 0.14 * clamp(1 - hAbove / 1.3, 0, 1);
    const targetThrust = PHYS.mass * PHYS.g * PHYS.thrustToWeight * thrustRatio * healthFactor * groundEffect;
    this.thrust = damp(this.thrust, this.flying ? targetThrust : 0, 1 / PHYS.thrustLag, dt);
    if (this.battery <= 0) this.thrust = 0;

    /* ---- actitud objetivo (modo angulo) ---- */
    this.targetYaw += this.input.yaw * PHYS.maxYawRate * dt;
    const tilt = PHYS.maxTilt * (1 - 0.18 * clamp(this.airspeed / 18, 0, 1));
    // Convencion: alabeo +1 -> inclina a la derecha; cabeceo +1 -> morro abajo (avanza)
    const tRoll = -this.input.roll * tilt;
    const tPitch = this.input.pitch * tilt;

    // quaternion objetivo y error de actitud
    T.q.setFromEuler(T.e.set(tPitch, this.targetYaw, tRoll, 'YXZ'));
    const qInv = T.q2.copy(this.quaternion).invert();     // qCur^-1
    const qErr = T.q3.copy(T.q).multiply(qInv);           // qTarget * qCur^-1
    if (qErr.w < 0) qErr.set(-qErr.x, -qErr.y, -qErr.z, -qErr.w);
    const angle = 2 * Math.acos(clamp(qErr.w, -1, 1));
    const s = Math.sqrt(Math.max(0, 1 - qErr.w * qErr.w));

    // eje del error llevado a los ejes del cuerpo
    const torque = T.torque.set(0, 0, 0);
    if (s > 1e-6) {
      torque.set(qErr.x / s, qErr.y / s, qErr.z / s).multiplyScalar(angle);
      torque.applyQuaternion(qInv);
    }
    // PD
    torque.multiplyScalar(PHYS.attitudeKp);
    torque.x -= this.angularVel.x * PHYS.attitudeKd;
    torque.y -= this.angularVel.y * PHYS.attitudeKd;
    torque.z -= this.angularVel.z * PHYS.attitudeKd;

    // desequilibrio por motores danados
    const imbalance = (this.motorHealth[0] + this.motorHealth[2] - this.motorHealth[1] - this.motorHealth[3]) * 0.5;
    torque.z += imbalance * 1.5 * (this.thrust / (PHYS.mass * PHYS.g));

    // vibracion estructural
    const vib = clamp(this.damage / 100, 0, 1) * 0.6;
    torque.x += (this._rng() - 0.5) * vib * 2.4;
    torque.z += (this._rng() - 0.5) * vib * 2.4;

    // integracion angular
    this.angularVel.x += (torque.x / PHYS.inertia.x) * dt;
    this.angularVel.y += (torque.y / PHYS.inertia.y) * dt;
    this.angularVel.z += (torque.z / PHYS.inertia.z) * dt;
    this.angularVel.clampLength(0, PHYS.maxAngularRate);

    const avLen = this.angularVel.length();
    if (avLen > 1e-5) {
      T.q.setFromAxisAngle(T.axis.copy(this.angularVel).divideScalar(avLen), avLen * dt);
      this.quaternion.multiply(T.q).normalize();
    }

    /* ---- fuerzas lineales ---- */
    const forces = T.forces.set(0, 0, 0);
    forces.y -= PHYS.mass * PHYS.g;                      // gravedad
    const up = T.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    forces.addScaledVector(up, this.thrust);             // empuje a lo largo del "up" del cuerpo

    // velocidad relativa al aire -> resistencia aerodinamica
    const rel = T.rel.copy(this.velocity).sub(wind);
    const relSpeed = rel.length();
    if (relSpeed > 1e-4) {
      const k = 0.5 * PHYS.rho * PHYS.dragArea * relSpeed;
      forces.addScaledVector(rel, -k);
    }
    // turbulencia: respuesta directa al entorno
    const turb = env.turbulence || 0;
    if (turb > 0) {
      forces.x += (this._rng() - 0.5) * turb * PHYS.mass * 2.6;
      forces.y += (this._rng() - 0.5) * turb * PHYS.mass * 1.8;
      forces.z += (this._rng() - 0.5) * turb * PHYS.mass * 2.6;
    }

    this.velocity.addScaledVector(forces, dt / PHYS.mass);

    T.prev.copy(this.position);
    this.position.addScaledVector(this.velocity, dt);

    /* ---- colisiones ---- */
    this._resolveCollisions(env);

    /* ---- suelo ---- */
    const gy = env.groundHeight ? env.groundHeight(this.position.x, this.position.z) : 0;
    if (this.position.y <= gy) {
      this.position.y = gy;
      const vDown = -this.velocity.y;          // velocidad de descenso
      if (vDown > 0.02) {
        if (vDown > 3.2) this._crashImpact(vDown, 'aterrizaje');
        else if (vDown > 0.9) {
          this.damage = clamp(this.damage + vDown * 1.1, 0, 100);
          this._shake = Math.max(this._shake, vDown * 0.05);
          this.velocity.y = Math.max(0, -this.velocity.y * 0.18);
        } else {
          this.velocity.y = 0;
        }
        if (vDown > 1.5 || !this.flying) this.landed = true;
      } else {
        // contacto en reposo: el empuje hacia arriba puede despegarnos
        this.velocity.y = Math.max(0, this.velocity.y);
      }
      const f = Math.exp(-6 * dt);
      this.velocity.x *= f; this.velocity.z *= f;
    } else if (this.position.y > gy + 0.12) {
      this.landed = false;
    }

    /* ---- energia ---- */
    if (this.isAirborne) {
      this.flightTime += dt;
      const load = Math.max(0, this.input.throttle);
      const drain = PHYS.batteryDrainHover * (1 + 1.55 * load + 0.55 * Math.abs(this.input.roll) +
        0.55 * Math.abs(this.input.pitch) + 0.30 * (this.airspeed / 12));
      this.battery = clamp(this.battery - drain * dt, 0, 100);
      this.maxAltitude = Math.max(this.maxAltitude, this.altitude - gy);
      this.topSpeed = Math.max(this.topSpeed, this.airspeed);
      this.distance += this.velocity.length() * dt;
      if (this.battery <= 0) { this.flying = false; this.input.throttle = 0; }
    } else if (this.landed && env.recharging) {
      this.battery = clamp(this.battery + 9 * dt, 0, 100);
    }

    if (this.damage >= 100) this._crashImpact(0, 'estructura');

    /* ---- visual ---- */
    this._updateRotorVisuals(dt, healthFactor);
    this._updateLights(dt);
    this._updateWinch(dt, env);
    this.syncTransform();
  }

  _fallApart(dt, groundY) {
    this.velocity.y -= PHYS.g * dt;
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocity.multiplyScalar(0.25);
    }
  }

  /** Colision con obstaculos (cajas AABB y cilindros). */
  _resolveCollisions(env) {
    const obs = env.obstacles;
    if (!obs || !obs.length) return;
    const r = 0.40;                                  // radio de colision (incluye helices)
    const p = this.position;
    const n = this._tmp.n;

    for (const o of obs) {
      if (o.dead) continue;
      let depth = 0, hit = false;
      if (o.type === 'box') {
        const cx = clamp(p.x, o.min.x, o.max.x);
        const cy = clamp(p.y, o.min.y, o.max.y);
        const cz = clamp(p.z, o.min.z, o.max.z);
        const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r) {
          const d = Math.sqrt(d2);
          hit = true;
          if (d > 1e-6) { n.set(dx / d, dy / d, dz / d); depth = r - d; }
          else { n.set(0, 1, 0); depth = r; }
        }
      } else if (o.type === 'cylinder') {
        const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
        const hd = Math.hypot(dx, dz);
        const within = p.y > o.pos.y - o.height / 2 - r && p.y < o.pos.y + o.height / 2 + r;
        if (hd < o.radius + r && within) {
          const d = hd || 1e-6;
          n.set(dx / d, 0, dz / d);
          depth = o.radius + r - hd;
          hit = true;
        }
      }
      if (!hit) continue;

      p.addScaledVector(n, depth + 0.002);
      const vn = this.velocity.dot(n);
      if (vn < 0) {
        const impact = -vn;
        this.velocity.addScaledVector(n, -vn * 1.35);
        this.velocity.multiplyScalar(0.72);
        this.angularVel.x += (this._rng() - 0.5) * impact * 0.6;
        this.angularVel.z += (this._rng() - 0.5) * impact * 0.6;
        if (impact > 2.0) this._crashImpact(impact, o.label || 'obstaculo');
        else if (impact > 0.5) {
          this.damage = clamp(this.damage + impact * 1.6, 0, 100);
          this._shake = Math.max(this._shake, impact * 0.09);
          if (env.onBump) env.onBump(impact, o);
        }
      }
    }
  }

  _crashImpact(speed, what) {
    const dmg = clamp((speed - 2) * 4.2, 5, 65);
    this.damage = clamp(this.damage + dmg, 0, 100);
    this._shake = 1;
    this.motorHealth[Math.floor(this._rng() * 4)] = clamp(0.35 + this._rng() * 0.5, 0, 1);
    if (this._onImpact) this._onImpact(speed, what);
  }

  /* -------------- visual -------------- */
  _updateRotorVisuals(dt, healthFactor) {
    const thrustRatio = clamp(this.thrust / (PHYS.mass * PHYS.g * PHYS.thrustToWeight), 0, 1);
    const baseRpm = thrustRatio * PHYS.rpmMax;
    for (let i = 0; i < 4; i++) {
      const target = this.crashed ? 0 : baseRpm * (0.55 + 0.45 * this.motorHealth[i]);
      this.rpm[i] = damp(this.rpm[i], target, 9, dt);
      const m = this.model.motors[i];
      m.prop.rotation.y += (this.rpm[i] / 60) * TAU * dt * m.dir;
      const blur = clamp((this.rpm[i] - 2600) / 6000, 0, 1);
      m.disc.material.opacity = blur * 0.8;
      m.disc.visible = blur > 0.02;
    }
    // flexion de los pods con el empuje
    const flex = clamp(this.thrust / (PHYS.mass * PHYS.g * 2), 0, 1) * 0.012;
    for (const m of this.model.motors) m.pod.position.y = -0.005 + flex;
  }

  _updateLights(dt) {
    this._blink += dt;
    for (const m of this.model.motors) {
      const isRear = m.nav.position.z < 0;
      const on = isRear ? (Math.floor(this._blink * 2.2) % 2 === 0) : (this._blink % 1.6 < 1.1);
      m.navMat.opacity = on ? 1 : 0.12;
    }
    const want = (this.lightsOn || this._lightAuto) && !this.crashed ? 2.8 : 0;
    this.headlight.intensity = damp(this.headlight.intensity, want, 6, dt);
    this.model.camLedMat.color.setHex(this.lightsOn ? 0x7ef7c8 : 0xdff0ff);
  }

  /** Giratorio: baja/sube el cable de rescate. */
  setWinch(target) { this.winch.target = clamp(target, 0, 1); }

  _updateWinch(dt, env) {
    const w = this.winch;
    w.deployed = w.target > 0.01;
    w.length = damp(w.length, w.target * 2.6, 3.5, dt);
    if (!this._hookMesh) {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), this.materials.graphite);
      g.add(bar);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16), this.materials.accent);
      ring.rotation.x = Math.PI / 2; ring.position.y = -0.07;
      g.add(ring);
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 1, 5),
        new THREE.MeshBasicMaterial({ color: 0xcfd8e6 })
      );
      cable.name = 'cable';
      cable.position.y = -0.5;
      cable.scale.y = 1;
      g.add(cable);
      this.root.add(g);
      this._hookMesh = g;
      this._cableMesh = cable;
    }
    this._hookMesh.visible = w.length > 0.05;
    this._hookMesh.position.set(0, -0.24 - w.length, 0.16);
    if (this._cableMesh) {
      this._cableMesh.visible = w.length > 0.05;
      this._cableMesh.scale.y = Math.max(0.001, w.length + 0.3);
      this._cableMesh.position.y = -w.length / 2 - 0.06;
    }
    if (env.updateWinch) env.updateWinch(this, w.length);
  }

  /** Posicion mundial del gancho del giratorio (NaN si esta recogido). */
  hookWorldPosition(target = new THREE.Vector3()) {
    if (this.winch.length <= 0.02) return target.set(NaN, NaN, NaN);
    return target.set(0, -0.24 - this.winch.length, 0.16)
      .applyQuaternion(this.quaternion).add(this.position);
  }

  /** Grupo del gancho del giratorio (para enganchar personas/objetos). */
  get hookAnchor() { return this._hookMesh; }

  /** Pose de la camara de a bordo (FPV). */
  fpvPose(pos = new THREE.Vector3(), quat = new THREE.Quaternion()) {
    pos.set(0, -0.06, 0.09).applyQuaternion(this.quaternion).add(this.position);
    quat.copy(this.quaternion);
    return { pos, quat };
  }

  /** Nivel de sacudida de camara (impacto + vibracion estructural). */
  shakeAmount() {
    this._shake = Math.max(0, this._shake - 0.02);
    const structural = clamp(this.damage / 100, 0, 1) * 0.4;
    const rpmVib = clamp(this.rpm[0] / PHYS.rpmMax, 0, 1) * 0.06;
    return this._shake + structural + rpmVib;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m?.dispose?.();
      }
    });
  }
}

/** Textura de disco de helice (motion blur). */
function propDiscTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, 'rgba(205,225,255,.18)');
  g.addColorStop(0.65, 'rgba(180,205,255,.09)');
  g.addColorStop(1, 'rgba(160,190,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(220,235,255,.22)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(128, 128, 118, 0, TAU); ctx.stroke();
  return new THREE.CanvasTexture(c);
}

export { PHYS as DRONE_PHYS, MOTOR_LAYOUT, bladeGeometry, roundedBox, octagonPrism };
