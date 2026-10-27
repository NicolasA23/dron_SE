/**
 * MISIONES
 * --------
 * Cada mision define un objetivo, genera su propio escenario (puertas,
 * plataformas, cajas, personas, puntos de interes) y evalua el exito.
 *
 * Todas comparten la misma fisica y el mismo entorno reactivo; lo que cambia
 * es lo que el humano debe conseguir con el dron.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Utilidades                                                         */
/* ------------------------------------------------------------------ */
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

class Objective {
  constructor(text) {
    this.text = text;
    this.done = false;
    this.active = true;
  }
  complete() { this.done = true; }
}

/** Base comun a todas las misiones. */
class Mission {
  constructor(game) {
    this.game = game;
    this.objectives = [];
    this.time = 0;
    this.state = 'running';        // running | complete | failed
    this.failReason = '';
    this.events = [];
  }

  get name() { return 'Mision'; }
  get brief() { return ''; }
  get biome() { return 'galpon'; }
  get wind() { return 'medio'; }

  addObjective(text) { const o = new Objective(text); this.objectives.push(o); return o; }
  setup(/* world */) {}
  update(/* dt, ctx */) {}

  /** Limite de tiempo en segundos (null = sin limite). Las subclases lo sobreescriben. */
  get timeLimit() { return null; }

  get progress() {
    return { done: this.objectives.filter((o) => o.done).length, total: this.objectives.length };
  }

  complete() { if (this.state === 'running') this.state = 'complete'; }
  fail(reason) {
    if (this.state === 'running') { this.state = 'failed'; this.failReason = reason; }
  }

  /** Puntuacion final y nota. */
  score() {
    const drone = this.game.drone;
    const prog = this.progress;
    let s = prog.done * 600;
    s += Math.round(drone.distance * 1.2);
    s += Math.round(drone.battery * 4);
    s -= Math.round(drone.damage * 9);
    if (this.timeLimit) s += Math.max(0, Math.round((this.timeLimit - this.time) * 6));
    if (this.state === 'failed') s = Math.round(s * 0.25);
    if (s < 0) s = 0;
    let grade = 'D';
    if (s >= 3200) grade = 'S';
    else if (s >= 2400) grade = 'A';
    else if (s >= 1700) grade = 'B';
    else if (s >= 900) grade = 'C';
    return { score: s, grade };
  }
}

/* ------------------------------------------------------------------ */
/*  1 · PRIMER VUELO                                                   */
/* ------------------------------------------------------------------ */
class TutorialMission extends Mission {
  get name() { return 'Primer vuelo'; }
  get brief() { return 'Despega, gana altura, atraviesa las tres puertas y aterriza en la base.'; }
  get biome() { return 'galpon'; }
  get wind() { return 'flojo'; }

  setup(world) {
    const o1 = this.addObjective('Despega y sube por encima de 5 m');
    const o2 = this.addObjective('Atraviesa las 3 puertas de entrenamiento');
    const o3 = this.addObjective('Aterriza suavemente en la base');

    // tres puertas en linea, cada una mas alta
    const g1 = world.makeGate(new THREE.Vector3(0, 4.0, -12), 0, 2.2, 'PUERTA 1');
    const g2 = world.makeGate(new THREE.Vector3(0, 5.5, -26), 0, 2.0, 'PUERTA 2');
    const g3 = world.makeGate(new THREE.Vector3(0, 7.0, -40), 0, 1.8, 'PUERTA 3');
    this.gates = [g1, g2, g3];
    this.o = { o1, o2, o3 };
  }

  update(dt, ctx) {
    const { drone, world } = ctx;
    if (this.state !== 'running') return;
    this.time += dt;

    if (!this.o.o1.done && drone.altitude > 5) {
      this.o.o1.complete();
      this.game.toast('Altura de crucero alcanzada', 'good');
      this.game.log('Objetivo: 5 m de altura', 'good');
      this.game.audio.melody([720, 980]);
    }
    const passed = this.gates.filter((g) => g.passed).length;
    if (!this.o.o2.done && passed === this.gates.length) {
      this.o.o2.complete();
      this.game.toast('Las 3 puertas superadas', 'good');
      this.game.log('Slalon completado', 'good');
      this.game.audio.melody([880, 1100, 1320]);
    }
    if (!this.o.o3.done && this.o.o2.done) {
      const home = world.pads[0];
      if (drone.landed && dist2D(drone.position, home.position) < 1.8 && drone.airspeed < 1.0) {
        this.o.o3.complete();
        this.game.toast('Aterrizaje perfecto', 'good');
        this.game.audio.melody([660, 880, 1180, 1480]);
        this.complete();
      }
    }
    if (drone.crashed) this.fail('El dron se ha estrellado');
  }
}

/* ------------------------------------------------------------------ */
/*  2 · ENTREGA DE SUMINISTROS                                         */
/* ------------------------------------------------------------------ */
class DeliveryMission extends Mission {
  get name() { return 'Entrega de suministros'; }
  get brief() { return 'Recoge los 3 paquetes volando bajo y sueltalos en las plataformas de entrega.'; }
  get biome() { return 'ciudad'; }
  get wind() { return 'medio'; }
  get timeLimit() { return 260; }

  setup(world) {
    const rng = world.rng;
    this.crates = [];
    this.drops = [];
    this.carrying = null;
    this.o = this.addObjective('Entrega los 3 paquetes en sus plataformas');

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const r = 14 + rng() * 16;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const crate = world.makeCrate(new THREE.Vector3(x, 0, z), `PAQUETE ${i + 1}`);
      crate.index = i;
      this.crates.push(crate);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 2.0;
      const r = 12 + rng() * 18;
      const pad = world._makePad(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), `ENTREGA ${i + 1}`, 0xffb020);
      pad.isDrop = true;
      this.drops.push(pad);
    }
  }

  update(dt, ctx) {
    const { drone, world } = ctx;
    if (this.state !== 'running') return;
    this.time += dt;

    // recogida
    if (!this.carrying) {
      for (const c of this.crates) {
        if (c.taken) continue;
        if (drone.altitude < 2.8 && dist2D(drone.position, c.position) < 1.6) {
          c.taken = true;
          this.carrying = c;
          c.group.position.set(0, -0.62, 0.18);
          c.group.rotation.set(0, 0, 0);
          c.group.scale.setScalar(0.55);
          drone.root.add(c.group);
          this.game.toast(`Paquete ${c.index + 1} enganchado`, 'good');
          this.game.audio.beep(980, 0.09, 0.12);
          this.game.haptics(30);
          break;
        }
      }
    } else {
      // entrega
      for (const pad of this.drops) {
        if (pad.delivered) continue;
        if (drone.altitude < 3.2 && dist2D(drone.position, pad.position) < 1.9 && drone.airspeed < 3) {
          pad.delivered = true;
          this.carrying.delivered = true;
          drone.root.remove(this.carrying.group);
          this.carrying.group.position.copy(pad.position).setY(0.45);
          this.carrying.group.scale.setScalar(1);
          world.group.add(this.carrying.group);
          this.carrying = null;
          this.game.score += 600;
          this.game.toast('Paquete entregado', 'good');
          this.game.audio.melody([760, 1010, 1260]);
          this.game.haptics([25, 40, 25]);
          break;
        }
      }
      // soltar con la tecla G si vuela alto
      if (this.carrying && this.game.wantDrop) {
        this.game.wantDrop = false;
        drone.root.remove(this.carrying.group);
        this.carrying.group.position.copy(drone.position).setY(drone.altitude - 0.6);
        this.carrying.group.scale.setScalar(1);
        world.group.add(this.carrying.group);
        this.carrying = null;
        this.game.toast('Paquete soltado', 'warn');
      }
    }
    const done = this.crates.filter((c) => c.delivered).length;
    this.o.active = true;
    if (done === 3) {
      this.o.complete();
      this.complete();
    }
    if (this.time > this.timeLimit) this.fail('Tiempo agotado');
    if (drone.crashed) this.fail('El dron se ha estrellado');
  }
}

/* ------------------------------------------------------------------ */
/*  3 · RESCATE                                                        */
/* ------------------------------------------------------------------ */
class RescueMission extends Mission {
  get name() { return 'Rescate con giratorio'; }
  get brief() { return 'Baja el gancho (G) junto a cada herido, subelos y vuelve a la base.'; }
  get biome() { return 'valle'; }
  get wind() { return 'fuerte'; }
  get timeLimit() { return 320; }

  setup(world) {
    const rng = world.rng;
    this.people = [];
    this.rescued = 0;
    this.o = this.addObjective('Rescata a los 3 heridos y vuelve a la base');
    this.carrying = null;

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.9;
      const r = 16 + rng() * 22;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const p = world.makePerson(new THREE.Vector3(x, world.groundHeight(x, z), z), `HERIDO ${i + 1}`);
      p.index = i;
      this.people.push(p);
    }
    this.oHome = this.addObjective('Aterriza en la base con los rescatados');
    this.oHome.active = false;
  }

  update(dt, ctx) {
    const { drone, world } = ctx;
    if (this.state !== 'running') return;
    this.time += dt;

    if (!this.carrying) {
      // enganchar
      const hook = drone.hookWorldPosition();
      if (drone.winch.length > 1.2 && !Number.isNaN(hook.x)) {
        for (const p of this.people) {
          if (p.rescued) continue;
          if (dist2D(hook, p.position) < 1.6 && Math.abs(hook.y - (p.position.y + 1)) < 2.2) {
            p.rescued = true;
            this.carrying = p;
            p.group.position.set(0, -1.0, 0);
            p.group.rotation.set(0, 0, 0);
            drone.hookAnchor.add(p.group);
            this.game.toast(`Herido ${p.index + 1} en el gancho`, 'good');
            this.game.audio.beep(1200, 0.1, 0.14);
            this.game.haptics([20, 30, 20]);
            break;
          }
        }
      }
    } else {
      // entregar en la base
      const home = world.pads[0];
      if (drone.altitude < 3.0 && dist2D(drone.position, home.position) < 2.2 && drone.airspeed < 2.5) {
        drone.hookAnchor.remove(this.carrying.group);
        this.carrying.group.position.copy(home.position).setY(0);
        world.group.add(this.carrying.group);
        this.carrying = null;
        this.rescued++;
        this.game.score += 700;
        this.game.toast('Herido a salvo', 'good');
        this.game.audio.melody([700, 940, 1180]);
        this.game.haptics([30, 50, 30]);
        if (this.rescued === 3) {
          this.o.complete();
          this.oHome.active = true;
          this.game.toast('Vuelve a la base', 'good');
        }
      }
    }

    if (this.rescued === 3 && !this.oHome.done) {
      const home = world.pads[0];
      if (drone.landed && dist2D(drone.position, home.position) < 2.0) {
        this.oHome.complete();
        this.complete();
      }
    }
    if (this.time > this.timeLimit) this.fail('Tiempo agotado');
    if (drone.crashed) this.fail('El dron se ha estrellado');
  }
}

/* ------------------------------------------------------------------ */
/*  4 · RECONOCIMIENTO                                                 */
/* ------------------------------------------------------------------ */
class ReconMission extends Mission {
  get name() { return 'Reconocimiento'; }
  get brief() { return 'Situa cada objetivo en el encuadre y pulsa F para fotografiarlo.'; }
  get biome() { return 'ciudad'; }
  get wind() { return 'medio'; }
  get timeLimit() { return 200; }

  setup(world) {
    const rng = world.rng;
    this.pois = [];
    this.o = this.addObjective('Fotografia los 5 puntos de interes');
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const r = 15 + rng() * 22;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const poi = world.makePoi(new THREE.Vector3(x, world.groundHeight(x, z), z), `PUNTO ${i + 1}`);
      poi.index = i;
      this.pois.push(poi);
    }
    this._cooldown = 0;
  }

  /** Intenta fotografiar el POI mas cercano que este en el encuadre. */
  tryPhoto(ctx) {
    const { drone } = ctx;
    if (this._cooldown > 0) return false;
    const fwd = drone.basis().fwd;
    let best = null, bestScore = -1;
    for (const p of this.pois) {
      if (p.photographed) continue;
      const to = p.position.clone().sub(drone.position);
      const d = to.length();
      if (d > 26) continue;
      const dot = to.normalize().dot(fwd);
      if (dot < 0.86) continue;
      const score = dot * 2 - d * 0.02;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best) {
      this.game.toast('Ningun objetivo en el encuadre', 'warn');
      this._cooldown = 0.8;
      return false;
    }
    best.photographed = true;
    best.orb.material.emissive.setHex(0x7ef7c8);
    this.game.score += 500;
    this.game.toast(`Punto ${best.index + 1} fotografiado`, 'good');
    this.game.audio.shutter();
    this.game.haptics(20);
    this._cooldown = 0.6;
    if (this.pois.every((p) => p.photographed)) {
      this.o.complete();
      this.complete();
    }
    return true;
  }

  update(dt, ctx) {
    if (this.state !== 'running') return;
    this.time += dt;
    this._cooldown = Math.max(0, this._cooldown - dt);
    if (ctx.drone.crashed) this.fail('El dron se ha estrellado');
    if (this.time > this.timeLimit) this.fail('Tiempo agotado');
  }
}

/* ------------------------------------------------------------------ */
/*  5 · VUELO LIBRE                                                    */
/* ------------------------------------------------------------------ */
class FreeFlightMission extends Mission {
  get name() { return 'Vuelo libre'; }
  get brief() { return 'Sin objetivos: explora el entorno, prueba el viento y domina el dron.'; }
  get biome() { return 'valle'; }
  get wind() { return 'medio'; }

  setup(world) {
    this.o = this.addObjective('Vuela, explora y aterriza cuando quieras');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 20 + i * 6;
      world.makeGate(new THREE.Vector3(Math.cos(a) * r, 4 + i * 0.6, Math.sin(a) * r), a + Math.PI / 2, 2.1, `GATE ${i + 1}`);
    }
  }

  update(dt, ctx) {
    if (this.state !== 'running') return;
    this.time += dt;
    if (ctx.drone.crashed) this.fail('El dron se ha estrellado');
  }
}

/* ------------------------------------------------------------------ */
/*  CATALOGO                                                           */
/* ------------------------------------------------------------------ */
export const MISSIONS = [
  {
    id: 'tutorial', cls: TutorialMission, icon: '&#9992;',
    tags: ['Tutorial', 'Galpon'], tagClass: '',
    desc: 'Aprende a despegar, mantener altura y aterrizar. Viento flojo y sin limite de tiempo.',
  },
  {
    id: 'entrega', cls: DeliveryMission, icon: '&#128230;',
    tags: ['Ciudad', 'Logistica'], tagClass: 'b',
    desc: 'Recoge y entrega tres paquetos volando a baja altura. El viento moderado te empujara.',
  },
  {
    id: 'rescate', cls: RescueMission, icon: '&#128107;',
    tags: ['Valle', 'Rescate', 'Giratorio'], tagClass: 'b',
    desc: 'Usa el gancho para subir a tres heridos y devolverlos a la base. Viento fuerte.',
  },
  {
    id: 'recon', cls: ReconMission, icon: '&#128247;',
    tags: ['Ciudad', 'Contrarreloj'], tagClass: '',
    desc: 'Fotografia cinco puntos de interes antes de que se acabe el tiempo.',
  },
  {
    id: 'libre', cls: FreeFlightMission, icon: '&#127760;',
    tags: ['Valle', 'Sandbox'], tagClass: 'b',
    desc: 'Vuelo libre sin objetivos para practicar y disfrutar del entorno reactivo.',
  },
];

export function createMission(id, game) {
  const def = MISSIONS.find((m) => m.id === id) || MISSIONS[0];
  return new def.cls(game);
}
