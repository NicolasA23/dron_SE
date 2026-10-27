/**
 * ENTORNO GENERADO — biomas procedurales, objetos interactivos y respuesta
 * al viento, al clima y a la presencia del dron.
 *
 * Un Mundo se construye a partir de una semilla: cada mision genera un
 * escenario distinto (galpon, ciudad o valle) con obstaculos, puertas,
 * plataformas, cajas, personas y puntos de interes.
 *
 * Ademas el mundo "responde":
 *   · los aerogeneradores giran con la velocidad del viento
 *   · las banderas, los arboles y la hierba se inclinan con las rafagas
 *   · los pajaros salen volando cuando el dron se acerca
 *   · los vehiculos se detienen si el dron pasa por encima
 *   · los globos derivan con el viento
 */
import * as THREE from 'three';
import {
  clamp, lerp, TAU, DEG, makeRng, fbm, makeNoise2D, textSprite,
  gridFloorTexture, asphaltTexture, facadeTexture, terrainTexture,
} from '../core/Utils.js';

const SPAWN_CLEAR = 5.5;   // radio libre alrededor del punto de despegue

export class World {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.biome = opts.biome || 'galpon';
    this.seed = opts.seed || 1;
    this.mr = !!opts.mr;
    this.rng = makeRng(this.seed);

    this.group = new THREE.Group();
    scene.add(this.group);

    this.obstacles = [];
    this.gates = [];
    this.pads = [];
    this.crates = [];
    this.people = [];
    this.pois = [];
    this.balloons = [];
    this.birds = [];
    this.turbines = [];
    this.flags = [];
    this.cars = [];
    this.lamps = [];
    this.animated = [];        // objetos con callback de animacion
    this.terrainFn = null;

    this._t = 0;
    this._materials = this._makeMaterials();
  }

  /* ---------------------------------------------------------------- */
  /*  Materiales y geometrias compartidas                             */
  /* ---------------------------------------------------------------- */
  _makeMaterials() {
    return {
      concrete: new THREE.MeshStandardMaterial({ color: 0x6d7683, roughness: 0.9 }),
      concreteDark: new THREE.MeshStandardMaterial({ color: 0x3b424c, roughness: 0.92 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8d97a5, roughness: 0.35, metalness: 0.75 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x2c333d, roughness: 0.5, metalness: 0.6 }),
      rack: new THREE.MeshStandardMaterial({ color: 0x3f5a7a, roughness: 0.55, metalness: 0.4 }),
      crate: new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.85 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6b4f33, roughness: 0.9 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x2f5d33, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x9fd0ff, roughness: 0.15, metalness: 0.3,
        transparent: true, opacity: 0.55, emissive: 0x0a1a2a, emissiveIntensity: 0.4,
      }),
      emissive: new THREE.MeshStandardMaterial({
        color: 0x0b1a18, emissive: 0x7ef7c8, emissiveIntensity: 1.4, roughness: 0.4,
      }),
      emissiveWarm: new THREE.MeshStandardMaterial({
        color: 0x1a1206, emissive: 0xffb020, emissiveIntensity: 1.3, roughness: 0.4,
      }),
      emissiveRed: new THREE.MeshStandardMaterial({
        color: 0x1a0608, emissive: 0xff4d5e, emissiveIntensity: 1.3, roughness: 0.4,
      }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.6 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 0.95 }),
      black: new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.7 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff0cf }),
    };
  }

  _geo() {
    if (this._geoC) return this._geoC;
    this._geoC = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
      cone: new THREE.ConeGeometry(1, 1, 12),
      sphere: new THREE.SphereGeometry(1, 12, 10),
      plane: new THREE.PlaneGeometry(1, 1),
      torus: new THREE.TorusGeometry(1, 0.06, 8, 32),
    };
    return this._geoC;
  }

  /** Malla con geometria/material compartidos ya escalada. */
  mesh(geo, mat, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  boxAt(mat, x, y, z, sx, sy, sz, label) {
    const m = this.mesh(this._geo().box, mat, sx, sy, sz);
    m.position.set(x, y, z);
    this.group.add(m);
    this.obstacles.push({
      type: 'box', label: label || 'obstaculo',
      min: new THREE.Vector3(x - sx / 2, y - sy / 2, z - sz / 2),
      max: new THREE.Vector3(x + sx / 2, y + sy / 2, z + sz / 2),
    });
    return m;
  }

  cylAt(mat, x, y, z, r, h, label) {
    const m = this.mesh(this._geo().cyl, mat, r * 2, h, r * 2);
    m.position.set(x, y, z);
    this.group.add(m);
    this.obstacles.push({ type: 'cylinder', label: label || 'obstaculo', pos: new THREE.Vector3(x, y, z), radius: r, height: h });
    return m;
  }

  /* ---------------------------------------------------------------- */
  /*  Construccion                                                    */
  /* ---------------------------------------------------------------- */
  build() {
    const builders = { galpon: this._buildWarehouse, ciudad: this._buildCity, valle: this._buildValley };
    (builders[this.biome] || this._buildWarehouse).call(this);
    this._buildSpawn();
    return this;
  }

  /** Plataforma base, linea de suelo y suelo de sombras (modo MR). */
  _buildSpawn() {
    const G = this._geo();
    const M = this._materials;

    // recepcion de sombras (funciona tambien sobre el video real)
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: this.mr ? 0.45 : 0.3 })
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.receiveShadow = true;
    this.group.add(this.shadowCatcher);

    // rejilla holografica (solo visible en MR)
    const grid = new THREE.GridHelper(70, 70, 0x7ef7c8, 0x2b6f5c);
    grid.material.transparent = true;
    grid.material.opacity = this.mr ? 0.30 : 0.0;
    grid.position.y = 0.012;
    this.holoGrid = grid;
    this.group.add(grid);

    // plataforma de despegue
    this.homePad = this._makePad(new THREE.Vector3(0, 0, 0), 'BASE', 0x38bdf8);
  }

  /* ---------------------------- GALPON ---------------------------- */
  _buildWarehouse() {
    const M = this._materials, G = this._geo();
    const size = 68, wallH = 13;

    const floorTex = gridFloorTexture({ size: 512, tiles: 8 });
    floorTex.repeat.set(9, 9);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map: floorTex, color: this.mr ? 0x8fa4bd : 0xb9c3d0, roughness: 0.85, metalness: 0.1,
        transparent: this.mr, opacity: this.mr ? 0.55 : 1,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.floor = floor;

    // muros y techo
    for (const [x, z, w, d] of [[0, -size / 2, size, 0.6], [0, size / 2, size, 0.6], [-size / 2, 0, 0.6, size], [size / 2, 0, 0.6, size]]) {
      this.boxAt(M.concreteDark, x, wallH / 2, z, w, wallH, d, 'muro');
    }
    const roof = this.mesh(G.box, M.concreteDark, size, 0.5, size);
    roof.position.y = wallH;
    roof.receiveShadow = true;
    this.group.add(roof);

    // claraboyas / lamparas colgantes
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const x = i * 13, z = j * 13;
        if (Math.hypot(x, z) < SPAWN_CLEAR + 2) continue;
        const shade = this.mesh(G.cyl, M.darkMetal, 3.2, 0.25, 1.4);
        shade.position.set(x, wallH - 0.6, z);
        this.group.add(shade);
        const bulb = new THREE.Mesh(G.cyl, M.lamp);
        bulb.scale.set(3.0, 0.08, 0.6);
        bulb.position.set(x, wallH - 0.78, z);
        this.group.add(bulb);
        this.lamps.push(bulb);
      }
    }

    // estanterias (racks) en filas
    const rackMats = [M.rack, M.concrete, M.darkMetal];
    for (let row = -2; row <= 2; row++) {
      if (row === 0) continue;
      for (let col = -3; col <= 3; col++) {
        const x = col * 8.5 + (row % 2 ? 2 : 0);
        const z = row * 13;
        if (Math.hypot(x, z) < SPAWN_CLEAR + 3) continue;
        this._makeRack(x, z, rackMats[(col + row + 6) % 3], 3.4 + this.rng() * 2.2);
      }
    }

    // pilares
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const x = i * 13.5, z = j * 13.5;
        if (Math.hypot(x, z) < SPAWN_CLEAR + 2) continue;
        if (this.rng() < 0.45) continue;
        this.cylAt(M.concrete, x, wallH / 2, z, 0.55, wallH, 'pilar');
      }
    }

    // cajas y palets en el suelo
    for (let i = 0; i < 34; i++) {
      const a = this.rng() * TAU, r = SPAWN_CLEAR + 2 + this.rng() * 26;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) > 30 || Math.abs(z) > 30) continue;
      const s = 0.9 + this.rng() * 0.8;
      const b = this.boxAt(M.crate, x, s / 2, z, s, s, s, 'caja');
      b.material = this.rng() < 0.3 ? M.wood : M.crate;
      if (this.rng() < 0.5) this.boxAt(M.wood, x + 1.2, 0.1, z + 0.4, 1.4, 0.2, 1.2, 'palet');
    }

    // banderas colgantes del techo (reaccionan al viento)
    for (let i = 0; i < 4; i++) {
      const x = -18 + i * 12, z = -6;
      this._makeFlag(x, wallH - 2.2, z, 0x38bdf8);
    }

    // puerta de hangar
    const door = this.boxAt(M.darkMetal, 0, 6, -size / 2 + 0.4, 9, 12, 0.4, 'porton');
    door.material = M.darkMetal;

    this._spawnBirds(6);
  }

  _makeRack(x, z, mat, h) {
    const G = this._geo();
    const w = 6, d = 1.6;
    for (const sx of [-w / 2, w / 2]) {
      for (const sz of [-d / 2, d / 2]) {
        const post = this.mesh(G.box, this._materials.darkMetal, 0.12, h, 0.12);
        post.position.set(x + sx, h / 2, z + sz);
        this.group.add(post);
      }
    }
    const levels = Math.max(2, Math.round(h / 1.2));
    for (let i = 1; i <= levels; i++) {
      const y = (h / levels) * i;
      const shelf = this.mesh(G.box, mat, w, 0.08, d);
      shelf.position.set(x, y, z);
      this.group.add(shelf);
      // cajas en las estanterias
      if (this.rng() < 0.75) {
        const n = 1 + Math.floor(this.rng() * 3);
        for (let k = 0; k < n; k++) {
          const cs = 0.5 + this.rng() * 0.35;
          const c = this.mesh(G.box, this.rng() < 0.5 ? this._materials.crate : this._materials.wood, cs, cs, cs);
          c.position.set(x - w / 2 + 0.9 + k * 1.5 + this.rng() * 0.4, y + 0.3, z + (this.rng() - 0.5) * 0.6);
          this.group.add(c);
        }
      }
    }
    this.obstacles.push({
      type: 'box', label: 'estanteria',
      min: new THREE.Vector3(x - w / 2 - 0.1, 0, z - d / 2 - 0.1),
      max: new THREE.Vector3(x + w / 2 + 0.1, h, z + d / 2 + 0.1),
    });
  }

  /* ---------------------------- CIUDAD ---------------------------- */
  _buildCity() {
    const M = this._materials, G = this._geo();
    const size = 150;

    const tex = asphaltTexture();
    tex.repeat.set(24, 24);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map: tex, color: this.mr ? 0x9aa8bb : 0xffffff, roughness: 0.95,
        transparent: this.mr, opacity: this.mr ? 0.6 : 1,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.floor = floor;

    const block = 22, street = 9;
    const facade = facadeTexture({ cols: 6, rows: 16, lit: 0.28, seed: 31 });
    const facade2 = facadeTexture({ cols: 5, rows: 12, lit: 0.22, seed: 77 });

    for (let bx = -3; bx <= 3; bx++) {
      for (let bz = -3; bz <= 3; bz++) {
        const cx = bx * (block + street), cz = bz * (block + street);
        if (Math.hypot(cx, cz) < 12) continue;
        const n = 1 + Math.floor(this.rng() * 2);
        for (let k = 0; k < n; k++) {
          const w = 7 + this.rng() * 9, d = 7 + this.rng() * 9;
          const h = 7 + this.rng() * 24;
          const x = cx + (this.rng() - 0.5) * (block - w), z = cz + (this.rng() - 0.5) * (block - d);
          if (Math.hypot(x, z) < SPAWN_CLEAR + 4) continue;
          const mat = new THREE.MeshStandardMaterial({
            map: this.rng() < 0.5 ? facade : facade2, color: 0xffffff, roughness: 0.8, metalness: 0.1,
          });
          const b = this.boxAt(mat, x, h / 2, z, w, h, d, 'edificio');
          // azotea
          const roof = this.mesh(G.box, M.concreteDark, w * 0.6, 0.5, d * 0.6);
          roof.position.set(x, h + 0.25, z);
          this.group.add(roof);
          // antena
          if (this.rng() < 0.4) {
            const ant = this.mesh(G.cyl, M.darkMetal, 0.12, 3, 0.12);
            ant.position.set(x, h + 1.8, z);
            this.group.add(ant);
            const tip = new THREE.Mesh(G.sphere, M.emissiveRed);
            tip.scale.set(0.3, 0.3, 0.3);
            tip.position.set(x, h + 3.4, z);
            this.group.add(tip);
            this.animated.push((dt) => {
              tip.material = M.emissiveRed;
              tip.visible = Math.sin(this._t * 3) > 0;
            });
          }
        }
      }
    }

    // farolas
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const x = i * (block + street) + street / 2;
        const z = j * (block + street) + street / 2;
        if (Math.hypot(x, z) < SPAWN_CLEAR) continue;
        const pole = this.mesh(G.cyl, M.darkMetal, 0.16, 7, 0.16);
        pole.position.set(x, 3.5, z);
        this.group.add(pole);
        const arm = this.mesh(G.box, M.darkMetal, 2.4, 0.14, 0.14);
        arm.position.set(x + 1.1, 6.9, z);
        this.group.add(arm);
        const head = new THREE.Mesh(G.box, M.lamp);
        head.scale.set(1.0, 0.2, 0.5);
        head.position.set(x + 2.1, 6.78, z);
        this.group.add(head);
        this.lamps.push(head);
      }
    }

    // trafico: coches que se detienen si el dron pasa cerca
    for (let i = 0; i < 10; i++) {
      const axis = this.rng() < 0.5 ? 'x' : 'z';
      const lane = Math.round((this.rng() - 0.5) * 6) * (block + street) + street / 2;
      const dir = this.rng() < 0.5 ? 1 : -1;
      const car = this._makeCar(lane, dir, axis);
      this.cars.push(car);
    }

    // aerogeneradores en la periferia
    for (let i = 0; i < 3; i++) {
      const a = this.rng() * TAU, r = 52 + this.rng() * 20;
      this._makeTurbine(Math.cos(a) * r, Math.sin(a) * r, 20 + this.rng() * 8);
    }

    this._spawnBirds(10);
  }

  _makeCar(lane, dir, axis) {
    const G = this._geo();
    const g = new THREE.Group();
    const body = this.mesh(G.box, this.rng() < 0.5 ? this._materials.white : this._materials.rack, 1.9, 0.75, 4.2);
    body.position.y = 0.65;
    g.add(body);
    const cabin = this.mesh(G.box, this._materials.glass, 1.7, 0.6, 2.0);
    cabin.position.y = 1.3;
    g.add(cabin);
    for (const sx of [-0.95, 0.95]) {
      for (const sz of [-1.4, 1.4]) {
        const w = this.mesh(G.cyl, this._materials.black, 0.36, 0.24, 0.36);
        w.rotation.x = Math.PI / 2;
        w.position.set(sx, 0.36, sz);
        g.add(w);
      }
    }
    const lightL = new THREE.Mesh(G.box, this._materials.lamp);
    lightL.scale.set(0.35, 0.18, 0.1);
    lightL.position.set(-0.6, 0.7, 2.12);
    g.add(lightL);
    const lightR = lightL.clone();
    lightR.position.x = 0.6;
    g.add(lightR);

    g.position.set(axis === 'x' ? lane : -60 + this.rng() * 120, 0, axis === 'x' ? -60 + this.rng() * 120 : lane);
    if (axis === 'z') g.rotation.y = Math.PI / 2;
    this.group.add(g);
    this.obstacles.push({
      type: 'box', label: 'vehiculo',
      min: new THREE.Vector3(g.position.x - 1.1, 0, g.position.z - 2.2),
      max: new THREE.Vector3(g.position.x + 1.1, 1.6, g.position.z + 2.2),
    });
    const car = { g, dir, axis, speed: 5 + this.rng() * 4, stopped: 0, lights: [lightL, lightR] };
    this.animated.push((dt, ctx) => {
      // se detiene si el dron esta encima (respuesta al dron)
      const d = ctx?.drone;
      const dx = d ? g.position.x - d.position.x : 99;
      const dz = d ? d.position.z - d.position.z : 99;
      const near = d ? Math.hypot(dx, dz) < 7 && d.position.y < 12 : false;
      car.stopped = near ? Math.min(1, car.stopped + dt * 3) : Math.max(0, car.stopped - dt * 2);
      const v = car.speed * (1 - car.stopped) * dt * car.dir;
      if (axis === 'x') {
        g.position.x += v;
        if (g.position.x > 62 || g.position.x < -62) car.dir *= -1;
      } else {
        g.position.z += v;
        if (g.position.z > 62 || g.position.z < -62) car.dir *= -1;
      }
      // actualizar AABB del colisionador
      const hw = axis === 'x' ? 1.1 : 2.2, hd = axis === 'x' ? 2.2 : 1.1;
      car.col.min.set(g.position.x - hw, 0, g.position.z - hd);
      car.col.max.set(g.position.x + hw, 1.6, g.position.z + hd);
    });
    const o = this.obstacles[this.obstacles.length - 1];
    o.carRef = car;
    car.col = o;
    return car;
  }

  /* ----------------------------- VALLE ---------------------------- */
  _buildValley() {
    const M = this._materials, G = this._geo();
    const size = 170, seg = 96;
    const noise = makeNoise2D(this.seed * 17 + 3);
    const heightAt = (x, z) => {
      const d = Math.hypot(x, z);
      const n = fbm(noise, x / 42, z / 42, 4);
      const raw = Math.max(0, n * 11) - 1.2;
      // meseta de despegue lisa alrededor del origen
      const flat = clamp(1 - (d - SPAWN_CLEAR) / 8, 0, 1);
      return raw * (1 - flat);
    };
    this.terrainFn = heightAt;

    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
    }
    geo.computeVertexNormals();
    const tex = terrainTexture();
    tex.repeat.set(26, 26);
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, color: this.mr ? 0xa8b6a0 : 0xffffff, roughness: 0.95,
      transparent: this.mr, opacity: this.mr ? 0.6 : 1,
    }));
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.floor = terrain;

    // arboles
    for (let i = 0; i < 150; i++) {
      const x = (this.rng() - 0.5) * size * 0.92, z = (this.rng() - 0.5) * size * 0.92;
      if (Math.hypot(x, z) < SPAWN_CLEAR + 3) continue;
      const y = heightAt(x, z);
      if (y < -0.4) continue;
      this._makeTree(x, y, z);
    }
    // rocas
    for (let i = 0; i < 40; i++) {
      const x = (this.rng() - 0.5) * size * 0.9, z = (this.rng() - 0.5) * size * 0.9;
      if (Math.hypot(x, z) < SPAWN_CLEAR + 2) continue;
      const s = 0.8 + this.rng() * 2.4;
      const rock = this.mesh(G.sphere, M.concrete, s, s * 0.8, s * 1.1);
      rock.position.set(x, heightAt(x, z) + s * 0.3, z);
      rock.rotation.set(this.rng(), this.rng() * TAU, this.rng());
      this.group.add(rock);
      this.obstacles.push({
        type: 'cylinder', label: 'roca',
        pos: new THREE.Vector3(x, heightAt(x, z) + s * 0.4, z), radius: s * 0.85, height: s * 1.4,
      });
    }
    // aerogeneradores (giran con el viento)
    for (let i = 0; i < 5; i++) {
      const a = this.rng() * TAU, r = 24 + this.rng() * 55;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x, z) < SPAWN_CLEAR + 6) continue;
      this._makeTurbine(x, z, 16 + this.rng() * 10);
    }
    // globos
    for (let i = 0; i < 8; i++) this._makeBalloon();
    // banderas
    for (let i = 0; i < 5; i++) {
      const a = this.rng() * TAU, r = 8 + this.rng() * 22;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      this._makeFlag(x, heightAt(x, z) + 4.5, z, [0xff4d5e, 0x38bdf8, 0x7ef7c8][i % 3]);
    }
    this._spawnBirds(14);
  }

  _makeTree(x, y, z) {
    const G = this._geo();
    const h = 2.4 + this.rng() * 3.6;
    const trunk = this.mesh(G.cyl, this._materials.wood, 0.24, h, 0.24);
    trunk.position.set(x, y + h / 2, z);
    this.group.add(trunk);
    const crown = new THREE.Group();
    const leafMat = this._materials.leaf.clone();
    leafMat.color.setHSL(0.30 + this.rng() * 0.06, 0.42, 0.22 + this.rng() * 0.12);
    for (let i = 0; i < 3; i++) {
      const s = (2.4 - i * 0.5) * (0.85 + this.rng() * 0.3);
      const cone = this.mesh(G.cone, leafMat, s, s * 1.15, s);
      cone.position.y = h + i * 0.85 + s * 0.5;
      crown.add(cone);
    }
    crown.position.set(x, y, z);
    this.group.add(crown);
    this.obstacles.push({
      type: 'cylinder', label: 'arbol',
      pos: new THREE.Vector3(x, y + h * 0.6, z), radius: 0.45, height: h * 1.6,
    });
    this.animated.push((dt, ctx) => {
      const w = ctx?.wind?.speed;
      const m = w ? Math.min(1, w.length() / 9) : 0;
      const sway = Math.sin(this._t * (1.1 + m * 2.2) + x * 0.3) * 0.035 * (0.3 + m);
      crown.rotation.z = sway;
      crown.rotation.x = sway * 0.6;
    });
  }

  /* ------------------------- OBJETOS COMUNES ---------------------- */

  /** Plataforma de aterrizaje con anillo emisivo y etiqueta. */
  _makePad(pos, label, color = 0x7ef7c8) {
    const G = this._geo();
    const g = new THREE.Group();
    g.position.copy(pos);
    const disc = this.mesh(G.cyl, this._materials.darkMetal, 3.0, 0.14, 3.0);
    disc.position.y = 0.07;
    g.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.09, 10, 40), this._materials.emissive.clone());
    ring.material.color.setHex(color);
    ring.material.emissive.setHex(color);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.17;
    g.add(ring);
    const cross = new THREE.Mesh(G.box, this._materials.white, 2.2, 0.03, 0.16);
    cross.position.y = 0.16;
    g.add(cross);
    const spr = textSprite(label, { color: '#' + color.toString(16).padStart(6, '0') });
    spr.position.y = 1.5;
    g.add(spr);
    this.group.add(g);
    const pad = { group: g, ring, position: pos.clone(), label, active: true, isHome: label === 'BASE' };
    this.pads.push(pad);
    return pad;
  }

  /** Puerta de paso (checkpoint). */
  makeGate(pos, dirYaw, radius = 1.9, label = 'PUERTA') {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = dirYaw;
    const mat = this._materials.emissive.clone();
    const frame = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 10, 40, Math.PI), mat);
    frame.rotation.z = 0;
    g.add(frame);
    // patas
    for (const sx of [-1, 1]) {
      const leg = this.mesh(this._geo().box, this._materials.darkMetal, 0.16, radius, 0.16);
      leg.position.set(sx * radius, radius / 2, 0);
      g.add(leg);
    }
    const spr = textSprite(label, { color: '#7ef7c8' });
    spr.position.y = radius + 0.7;
    g.add(spr);
    this.group.add(g);

    const normal = new THREE.Vector3(Math.sin(dirYaw), 0, Math.cos(dirYaw));
    const gate = {
      group: g, position: pos.clone(), normal, radius, passed: false,
      ringMat: mat, label,
    };
    this.gates.push(gate);
    return gate;
  }

  /** Caja de carga recogible. */
  makeCrate(pos, label = 'PAQUETE') {
    const G = this._geo();
    const g = new THREE.Group();
    g.position.copy(pos);
    const s = 0.85;
    const box = this.mesh(G.box, this._materials.crate, s, s, s);
    box.position.y = s / 2;
    g.add(box);
    const strap = this.mesh(G.box, this._materials.emissiveWarm, s * 1.02, 0.08, s * 1.02);
    strap.position.y = s / 2;
    g.add(strap);
    const spr = textSprite(label, { color: '#ffb020' });
    spr.position.y = 1.6;
    g.add(spr);
    this.group.add(g);
    const crate = { group: g, position: pos.clone(), taken: false, delivered: false, label };
    this.crates.push(crate);
    this.animated.push((dt, ctx) => {
      g.rotation.y += dt * 0.6;
      spr.position.y = 1.6 + Math.sin(this._t * 2) * 0.12;
    });
    return crate;
  }

  /** Persona a rescatar. */
  makePerson(pos, label = 'HERIDO') {
    const G = this._geo();
    const g = new THREE.Group();
    g.position.copy(pos);
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8a37a, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.85 });
    const body = this.mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 10), cloth, 1, 1, 1);
    body.position.y = 0.72;
    g.add(body);
    const head = this.mesh(G.sphere, skin, 0.42, 0.44, 0.42);
    head.position.y = 1.22;
    g.add(head);
    const armR = this.mesh(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8), cloth, 1, 1, 1);
    armR.position.set(0.29, 0.78, 0);
    armR.rotation.z = -0.35;
    g.add(armR);
    for (const sx of [-1, 1]) {
      const arm = this.mesh(new THREE.CapsuleGeometry(0.075, 0.42, 3, 8), cloth, 1, 1, 1);
      arm.position.set(sx * 0.29, 0.78, 0);
      arm.rotation.z = sx * 0.35;
      g.add(arm);
      const leg = this.mesh(new THREE.CapsuleGeometry(0.09, 0.5, 3, 8), this._materials.darkMetal, 1, 1, 1);
      leg.position.set(sx * 0.12, 0.28, 0);
      g.add(leg);
    }
    const marker = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 26), this._materials.emissiveRed.clone());
    marker.rotation.x = Math.PI / 2;
    marker.position.y = 0.06;
    g.add(marker);
    const spr = textSprite(label, { color: '#ff4d5e' });
    spr.position.y = 2.1;
    g.add(spr);
    this.group.add(g);
    const person = { group: g, position: pos.clone(), rescued: false, label, marker, wave: this.rng() * TAU };
    this.people.push(person);
    person.armR = armR;
    this.animated.push((dt) => {
      person.wave += dt;
      // saluda con el brazo pidiendo ayuda
      armR.rotation.z = -0.9 + Math.sin(person.wave * 4) * 0.5;
      marker.rotation.z += dt * 1.2;
      const pulse = 0.6 + Math.sin(this._t * 3) * 0.25;
      marker.scale.set(pulse, pulse, pulse);
      spr.position.y = 2.1 + Math.sin(this._t * 1.6) * 0.1;
    });
    return person;
  }

  /** Punto de interes para misiones de reconocimiento. */
  makePoi(pos, label = 'OBJETIVO') {
    const G = this._geo();
    const g = new THREE.Group();
    g.position.copy(pos);
    const base = this.mesh(G.cyl, this._materials.concrete, 1.6, 0.4, 1.6);
    base.position.y = 0.2;
    g.add(base);
    const col = this.mesh(G.cyl, this._materials.rack, 0.35, 3.4, 0.35);
    col.position.y = 1.9;
    g.add(col);
    const orb = new THREE.Mesh(G.sphere, this._materials.emissiveWarm.clone());
    orb.scale.set(0.9, 0.9, 0.9);
    orb.position.y = 4.0;
    g.add(orb);
    const spr = textSprite(label, { color: '#ffb020' });
    spr.position.y = 4.9;
    g.add(spr);
    this.group.add(g);
    const poi = { group: g, position: pos.clone(), photographed: false, label, orb };
    this.pois.push(poi);
    this.animated.push((dt) => {
      orb.rotation.y += dt * 1.4;
      orb.position.y = 4.0 + Math.sin(this._t * 1.5) * 0.18;
      spr.position.y = 4.9 + Math.sin(this._t * 1.5) * 0.18;
    });
    return poi;
  }

  /** Aerogenerador: gira mas rapido cuanto mas viento hay. */
  _makeTurbine(x, z, h) {
    const G = this._geo();
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const tower = this.mesh(G.cyl, this._materials.white, 0.9, h, 1.4);
    tower.position.y = h / 2;
    g.add(tower);
    const nacelle = this.mesh(G.box, this._materials.white, 1.0, 1.0, 2.6);
    nacelle.position.y = h;
    g.add(nacelle);
    const rotor = new THREE.Group();
    rotor.position.set(0, h, 1.4);
    const hub = this.mesh(G.sphere, this._materials.metal, 0.7, 0.7, 0.7);
    rotor.add(hub);
    const bladeMat = this._materials.white;
    for (let i = 0; i < 3; i++) {
      const blade = this.mesh(G.box, bladeMat, 0.7, h * 0.42, 0.1);
      blade.position.y = h * 0.21;
      const holder = new THREE.Group();
      holder.rotation.z = (i / 3) * TAU;
      holder.add(blade);
      rotor.add(holder);
    }
    g.add(rotor);
    this.group.add(g);
    this.obstacles.push({
      type: 'cylinder', label: 'aerogenerador',
      pos: new THREE.Vector3(x, h / 2, z), radius: 1.2, height: h,
    });
    const t = { rotor, speed: 0, x, z };
    this.turbines.push(t);
    this.animated.push((dt, ctx) => {
      const w = ctx?.wind?.speed;
      const m = w ? Math.min(1.4, w.length() / 7) : 0.15;
      t.speed = lerp(t.speed, 0.6 + m * 4.2, 1 - Math.exp(-1.5 * dt));
      rotor.rotation.z += t.speed * dt;
    });
    return t;
  }

  /** Bandera que se agita con el viento. */
  _makeFlag(x, y, z, color) {
    const geo = new THREE.PlaneGeometry(2.6, 1.5, 12, 6);
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.85, side: THREE.DoubleSide,
    });
    const flag = new THREE.Mesh(geo, mat);
    flag.position.set(x, y, z);
    flag.castShadow = true;
    this.group.add(flag);
    const pole = this.mesh(this._geo().cyl, this._materials.darkMetal, 0.07, 4.4, 0.07);
    pole.position.set(x - 1.35, y - 2.2, z);
    this.group.add(pole);
    const base = flag.geometry.attributes.position.clone();
    const f = { flag, base, x, y, z };
    this.flags.push(f);
    this.animated.push((dt, ctx) => {
      const w = ctx?.wind?.speed;
      const m = w ? Math.min(1, w.length() / 8) : 0.05;
      const p = flag.geometry.attributes.position;
      const dir = w ? Math.atan2(w.z, w.x) : 0;
      flag.rotation.y = dir;
      for (let i = 0; i < p.count; i++) {
        const bx = base.getX(i), by = base.getY(i);
        const k = (bx + 1.3) / 2.6;
        const amp = (0.12 + m * 0.85) * k;
        p.setZ(i, Math.sin(this._t * (3 + m * 7) + bx * 2.4) * amp);
        p.setY(i, by + Math.sin(this._t * 2 + bx * 1.6) * 0.02 * k);
      }
      p.needsUpdate = true;
      flag.geometry.computeVertexNormals();
    });
    return f;
  }

  /** Globo que deriva con el viento. */
  _makeBalloon() {
    const G = this._geo();
    const g = new THREE.Group();
    const colors = [0xff4d5e, 0x38bdf8, 0xffb020, 0x7ef7c8];
    const col = colors[Math.floor(this.rng() * colors.length)];
    const env = this.mesh(G.sphere, new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }), 1.1, 1.3, 1.1);
    g.add(env);
    const basket = this.mesh(G.box, this._materials.wood, 0.5, 0.4, 0.5);
    basket.position.y = -1.5;
    g.add(basket);
    g.position.set((this.rng() - 0.5) * 70, 6 + this.rng() * 12, (this.rng() - 0.5) * 70);
    this.group.add(g);
    const b = { g, bob: this.rng() * TAU };
    this.balloons.push(b);
    this.animated.push((dt, ctx) => {
      const w = ctx?.wind?.speed;
      b.bob += dt;
      if (w) g.position.addScaledVector(w, dt * 0.55);
      g.position.y += Math.sin(b.bob) * dt * 0.35;
      if (Math.abs(g.position.x) > 80 || Math.abs(g.position.z) > 80) {
        g.position.set((this.rng() - 0.5) * 70, 8 + this.rng() * 10, (this.rng() - 0.5) * 70);
      }
    });
    return b;
  }

  /** Pajaros: bandada que huye cuando el dron se acerca. */
  _spawnBirds(n) {
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const body = this.mesh(this._geo().sphere, this._materials.black, 0.28, 0.22, 0.5);
      g.add(body);
      const wingL = this.mesh(this._geo().box, this._materials.black, 0.9, 0.05, 0.3);
      wingL.position.x = -0.55;
      const wingR = wingL.clone();
      wingR.position.x = 0.55;
      g.add(wingL, wingR);
      const a = this.rng() * TAU, r = 12 + this.rng() * 40;
      g.position.set(Math.cos(a) * r, 8 + this.rng() * 14, Math.sin(a) * r);
      this.group.add(g);
      const bird = { g, wingL, wingR, phase: this.rng() * TAU, vel: new THREE.Vector3(), scared: 0, home: g.position.clone() };
      this.birds.push(bird);
      this.animated.push((dt, ctx) => {
        bird.phase += dt * (6 + bird.scared * 14);
        const flap = Math.sin(bird.phase) * 0.7;
        wingL.rotation.z = flap;
        wingR.rotation.z = -flap;
        const d = ctx?.drone;
        if (d) {
          const dist = g.position.distanceTo(d.position);
          if (dist < 8) bird.scared = Math.min(1, bird.scared + dt * 4);
          else bird.scared = Math.max(0, bird.scared - dt * 1.2);
        }
        // vuelo: circular tranquilo o huida
        if (bird.scared > 0.05 && d) {
          const away = g.position.clone().sub(d.position).normalize().multiplyScalar(bird.scared * 16);
          bird.vel.lerp(away, 1 - Math.exp(-3 * dt));
        } else {
          const target = bird.home.clone();
          target.x += Math.cos(this._t * 0.3 + bird.phase) * 8;
          target.z += Math.sin(this._t * 0.3 + bird.phase) * 8;
          bird.vel.lerp(target.sub(g.position).multiplyScalar(0.5), 1 - Math.exp(-1.2 * dt));
        }
        g.position.addScaledVector(bird.vel, dt);
        g.lookAt(g.position.clone().add(bird.vel));
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Consultas del terreno                                            */
  /* ---------------------------------------------------------------- */
  groundHeight(x, z) {
    if (this.terrainFn) return this.terrainFn(x, z);
    return 0;
  }

  /* ---------------------------------------------------------------- */
  /*  Actualizacion                                                    */
  /* ---------------------------------------------------------------- */
  update(dt, ctx = {}) {
    this._t += dt;
    for (const fn of this.animated) fn(dt, ctx);

    // puertas: deteccion de paso
    const drone = ctx.drone;
    if (drone) {
      const prev = drone._prevPos || (drone._prevPos = drone.position.clone());
      for (const gate of this.gates) {
        if (gate.passed) continue;
        const a = prev.clone().sub(gate.position).dot(gate.normal);
        const b = drone.position.clone().sub(gate.position).dot(gate.normal);
        if (a * b < 0) {
          const mid = prev.clone().lerp(drone.position, 0.5);
          const lateral = mid.clone().sub(gate.position);
          lateral.y = 0;
          if (lateral.length() < gate.radius) {
            gate.passed = true;
            gate.ringMat.color.setHex(0x7ef7c8);
            gate.ringMat.emissive.setHex(0x7ef7c8);
            if (ctx.onGate) ctx.onGate(gate);
          }
        }
      }
      prev.copy(drone.position);
    }

    // lamparas: brillan de noche
    const night = ctx.sky ? ctx.sky.isNight : false;
    const lampMat = night ? this._materials.lamp : this._materials.darkMetal;
    for (const l of this.lamps) l.material = lampMat;
  }

  setMR(on) {
    this.mr = on;
    if (this.holoGrid) this.holoGrid.material.opacity = on ? 0.30 : 0.0;
    if (this.floor) {
      this.floor.material.transparent = on;
      this.floor.material.opacity = on ? 0.55 : 1;
      this.floor.material.needsUpdate = true;
    }
    if (this.shadowCatcher) this.shadowCatcher.material.opacity = on ? 0.45 : 0.3;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isSprite) {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m?.dispose?.();
      }
    });
    this.scene.remove(this.group);
    this.obstacles.length = 0;
    this.animated.length = 0;
    this.gates.length = 0;
    this.pads.length = 0;
    this.crates.length = 0;
    this.people.length = 0;
    this.pois.length = 0;
  }
}
