/**
 * GAME — orquestador del juego de realidad mixta.
 *
 * Une todas las piezas:
 *   Engine (render + camara) · World (entorno generado) · Sky (dia/noche)
 *   WindField (viento) · Drone (modelo + fisica) · Input (humano)
 *   MRCamera (passthrough + analisis del entorno real) · Audio · HUD · Menu
 *
 * Y genera las respuestas:
 *   · a la interaccion humana (mando, teclado, gyro, voz, gestos, tactil)
 *   · al entorno (viento, clima, hora del dia, brillo real de la habitacion,
 *     obstaculos, puertas, presencia de personas)
 */
import * as THREE from 'three';
import { Engine, VIEWS } from '../core/Engine.js';
import { Sky } from '../world/Sky.js';
import { World } from '../world/World.js';
import { WindField } from '../world/Wind.js';
import { Drone } from '../world/Drone.js';
import { Input } from '../core/Input.js';
import { GameAudio } from '../core/Audio.js';
import { MRCamera } from '../core/MRCamera.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { createMission, MISSIONS } from './Missions.js';
import { WIND_LEVELS } from '../core/Settings.js';
import { clamp, damp, lerp, hashSeed } from '../core/Utils.js';

const BEST_KEY = (id) => `dron-se-best-${id}`;

export class Game {
  constructor(settings) {
    this._settings = settings;
    this.state = 'boot';            // boot | menu | playing | paused | result
    this.score = 0;
    this.wantDrop = false;
    this.autopilot = false;
    this.time = 0;
    this.frame = 0;
    this._accum = 0;
    this._last = 0;
    this._mission = null;
    this._mrAnalysisAcc = 0;

    /* --- nucleo --- */
    this.engine = new Engine(document.getElementById('scene'));
    this.scene = this.engine.scene;
    this.sky = new Sky(this.scene, { timeOfDay: 10.5 });
    this.wind = new WindField(1);
    this.sky.setWind(this.wind.speed);
    this.drone = new Drone();
    this.scene.add(this.drone.root);
    this.scene.add(this.drone.model.blobShadow);
    this.audio = new GameAudio();
    this.mr = new MRCamera(document.getElementById('mr-video'));

    /* --- interfaz --- */
    this.hud = new HUD();
    this.menu = new Menu({
      settings: this.settings,
      onPlay: (id) => this.startMission(id),
      onStartAR: () => this.startAR(),
      onResume: () => this.resume(),
      onRestart: () => this.startMission(this._currentMissionId),
      onAbort: () => this.toMenu(),
      onResultAgain: () => this.startMission(this._currentMissionId),
      onResultNext: () => {
        const i = MISSIONS.findIndex((m) => m.id === this._currentMissionId);
        const next = MISSIONS[Math.min(i + 1, MISSIONS.length - 1)];
        this.startMission(next.id);
      },
      onResultMenu: () => this.toMenu(),
      onNoCamOk: () => this._continueWithoutCamera(),
      onNoCamRetry: () => this._initCamera(true),
      onSetting: (k, v) => this._onSetting(k, v),
      getBest: (id) => this.getBest(id),
    });

    /* --- entrada --- */
    this.input = new Input({
      domElement: document.getElementById('scene'),
      joystickL: document.getElementById('stick-l'),
      joystickR: document.getElementById('stick-r'),
      settings: this.settings,
      mr: this.mr,
      onAction: (a) => this._onAction(a),
    });

    this._bindDroneEvents();
    this._bindHUDButtons();
    this._detectTouch();
  }

  /* ================================================================== */
  /*  ARRANQUE                                                          */
  /* ================================================================== */
  async boot() {
    // mundo de fondo para los menus
    if (!this.world) {
      this.world = new World(this.scene, {
        biome: this.settings.get('biome'), seed: 20261027, mr: false,
      });
      this.world.build();
      this._applyMR(false);
    }
    const steps = [
      ['Compilando motor 3D…', () => { this.engine.resize(); }],
      ['Generando cielo y ciclo dia/noche…', () => { this.sky.update(0); }],
      ['Construyendo el dron SE…', () => { this.drone.reset(new THREE.Vector3(0, 0, 0)); }],
      ['Calibrando sensores…', () => { this.mr._checkXR(); }],
      ['Sistemas listos', () => { this.menu.showARButton(this.mr.xrSupported); }],
    ];
    for (let i = 0; i < steps.length; i++) {
      this.menu.setBoot(((i + 1) / steps.length) * 100, steps[i][0]);
      await new Promise((r) => setTimeout(r, 130));
      steps[i][1]();
    }
    this.menu.show('start');
    this.state = 'menu';
    this._last = performance.now();
    // setAnimationLoop funciona tanto con rAF como con una sesion WebXR
    this.engine.renderer.setAnimationLoop((t) => this._loop(t));
  }

  _detectTouch() {
    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.hud.setTouch(this.isTouch);
  }

  _bindDroneEvents() {
    this.drone.onImpact((speed, what) => {
      const s = clamp(speed / 12, 0.15, 1);
      this.audio.crash(s);
      this.hud.hit();
      this.hud.toast(`Impacto: ${what}`, 'bad');
      this.hud.log(`Impacto contra ${what} (${speed.toFixed(1)} m/s)`, 'bad');
      if (this.settings.get('haptics')) navigator.vibrate?.([40, 30, 60]);
      if (this.drone.crashed) this._onCrash();
    });
  }

  _bindHUDButtons() {
    const b = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = () => fn(); };
    b('btn-takeoff', () => this._onAction('takeoff'));
    b('btn-photo', () => this._onAction('photo'));
    b('btn-light', () => this._onAction('lights'));
    b('btn-view', () => this._onAction('view'));
    b('btn-home', () => this._onAction('home'));
    b('btn-pause', () => this._onAction('pause'));
  }

  _onSetting(k, v) {
    if (k === 'mrCamera' && v) this._initCamera();
    if (k === 'mrCamera' && !v) this._disableCamera();
    if (k === 'sound') this.audio.setEnabled(v);
    if (k === 'voice') this.input.setVoice(v);
    if (k === 'controlPreset') this.input.setPreset(v);
    if (k === 'quality') this.engine.setQuality(v);
    if (k === 'biome' && this.state === 'playing') this.startMission(this._currentMissionId);
    if (k === 'wind') this.wind.setBase(WIND_LEVELS[v]?.base ?? 3.6);
    if (k === 'autoDayCycle') this.sky.auto = v;
    if (k === 'timeOfDay') this.sky.timeOfDay = v;
    if (k === 'showMinimap') document.getElementById('panel-minimap').style.display = v ? '' : 'none';
    if (k === 'autoLights') this.drone._lightAuto = v;
    if (k === 'gyro' && v) this.mr.requestOrientationPermission();
  }

  /* ================================================================== */
  /*  CAMARA / REALIDAD MIXTA                                           */
  /* ================================================================== */
  async _initCamera(retry = false) {
    if (!this.settings.get('mrCamera')) return;
    if (this.mr.isLive) return;
    try {
      await this.mr.start('environment');
      this._applyMR(true);
      this.hud.setMR(true);
      this.hud.toast('Realidad mixta activa', 'good');
      this.hud.log('Camara conectada · passthrough activo', 'good');
    } catch (err) {
      console.warn('Camara no disponible:', err);
      if (retry) this.menu.show('nocam');
      else { this._applyMR(false); this.hud.setMR(false); }
    }
  }

  _continueWithoutCamera() {
    this.settings.set('mrCamera', false);
    this._applyMR(false);
    this.hud.setMR(false);
    this.menu.hide();
    this.hud.toast('Modo virtual completo', 'warn');
  }

  _disableCamera() {
    this.mr.stop();
    this._applyMR(false);
    this.hud.setMR(false);
  }

  _applyMR(on) {
    this.mrMode = on;
    this.sky.dome.visible = !on;
    this.sky.fog.near = on ? 18 : (this.sky.weather === 'clear' ? 60 : 35);
    this.sky.fog.far = on ? 120 : (this.sky.weather === 'clear' ? 340 : 190);
    this.world?.setMR(on);
    this.drone.model.blobShadow.visible = on;
    if (!on) this.drone.model.blobShadow.visible = false;
    document.getElementById('mr-video').style.opacity = on ? '1' : '0';
  }

  async startAR() {
    if (!this.mr.xrSupported) { this.hud.toast('WebXR AR no disponible en este navegador', 'warn'); return; }
    try {
      await this.mr.startAR(this.engine.renderer, () => this.hud.toast('Sesion AR finalizada', 'warn'));
      this.hud.toast('Modo AR inmersivo', 'good');
    } catch (e) {
      this.hud.toast('No se pudo iniciar AR: ' + e.message, 'bad');
    }
  }

  /* ================================================================== */
  /*  MISIONES                                                          */
  /* ================================================================== */
  getBest(id) {
    try {
      const v = localStorage.getItem(BEST_KEY(id));
      return v == null ? null : Number(v);
    } catch { return null; }
  }

  startMission(id) {
    this._currentMissionId = id;
    const def = MISSIONS.find((m) => m.id === id) || MISSIONS[0];

    // entorno
    if (this.world) this.world.dispose();
    const seed = hashSeed(id + '-' + Math.floor(Math.random() * 1e9));
    this.world = new World(this.scene, {
      biome: def.biome ?? this.settings.get('biome'),
      seed,
      mr: !!this.mrMode,
    });
    this.world.build();

    // viento y clima
    const wLevel = WIND_LEVELS[def.wind ?? this.settings.get('wind')] || WIND_LEVELS.medio;
    this.wind.setBase(wLevel.base);
    this.wind.dir = Math.random() * Math.PI * 2;
    this.sky.timeOfDay = this.settings.get('timeOfDay');
    this.sky.auto = this.settings.get('autoDayCycle');
    this.sky.setWeather('clear');
    this.sky.update(0);

    // dron
    this.drone.reset(new THREE.Vector3(0, 0, 0), 0);
    this.drone.battery = 100;
    this.drone._lightAuto = this.settings.get('autoLights');
    this.autopilot = false;
    this.score = 0;
    this.time = 0;

    // mision
    this._mission = createMission(id, this);
    this._mission.setup(this.world);
    this.hud.setMission(this._mission.name, this._mission.brief);
    this.hud.setSteps(this._mission.objectives);

    // camara
    this.engine.setView(1);
    this.engine.operatorPos.set(0, 1.55, 6.5);

    // audio
    this.audio.init();
    this.audio.setEnabled(this.settings.get('sound'));
    if (this.settings.get('voice') && this.input.voiceSupported) this.input.setVoice(true);

    this.hud.show(true);
    this.hud.setTouch(this.isTouch);
    this.menu.hide();
    this.state = 'playing';
    this._last = performance.now();

    this.hud.toast(`${this._mission.name} · ${this._mission.brief}`, 'good');
    this.hud.log('Mision iniciada: ' + this._mission.name);
    this.hud.log('Pulsa T para despegar', 'good');
    if (!this.mr.isLive) this._initCamera();
  }

  _onCrash() {
    if (!this._mission) return;
    this._mission.fail('El dron se ha estrellado');
    this._finishMission(false);
  }

  _finishMission(success) {
    if (this.state !== 'playing') return;
    const m = this._mission;
    const r = m.score();
    const prev = this.getBest(this._currentMissionId);
    const isBest = prev == null || r.score > prev;
    if (isBest) { try { localStorage.setItem(BEST_KEY(this._currentMissionId), String(r.score)); } catch { /* noop */ } }

    const detail = [
      `Objetivos: ${m.progress.done}/${m.progress.total}`,
      `Distancia: ${this.drone.distance.toFixed(0)} m · Altura max: ${this.drone.maxAltitude.toFixed(1)} m`,
      `Vuelo: ${this.drone.flightTime.toFixed(0)} s · Bateria: ${this.drone.battery.toFixed(0)}% · Integridad: ${this.drone.integrity.toFixed(0)}%`,
      `Puntuacion: ${r.score}${isBest ? ' · NUEVO RECORD' : ''}`,
    ].join('\n');
    this.state = 'result';
    this.hud.show(false);
    this.menu.showResult({
      success,
      title: success ? 'MISION COMPLETADA' : 'MISION FALLIDA',
      detail,
      grade: r.grade,
      score: r.score,
      hasNext: this._currentMissionId !== 'libre',
    });
    this.audio.melody(success ? [660, 880, 1180, 1480] : [400, 320, 240], 0.14, 0.14);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menu.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menu.hide();
    this._last = performance.now();
  }

  toMenu() {
    this.state = 'menu';
    this.hud.show(false);
    this.menu.buildMissions();
    this.menu.show('start');
  }

  /* ================================================================== */
  /*  PUENTE HACIA LA INTERFAZ (lo usan las misiones)                  */
  /* ================================================================== */
  toast(msg, kind) { this.hud.toast(msg, kind); }
  log(msg, kind) { this.hud.log(msg, kind); }
  haptics(pattern) {
    if (this.settings.get('haptics')) navigator.vibrate?.(pattern);
  }

  /* ================================================================== */
  /*  ACCIONES DEL HUMANO                                               */
  /* ================================================================== */
  _onAction(a) {
    if (this.state === 'menu') {
      if (a === 'pause') return;
    }
    switch (a) {
      case 'takeoff': this._toggleTakeoff(); break;
      case 'photo': this._takePhoto(); break;
      case 'lights': {
        const on = this.drone.toggleLights();
        this.hud.toast(on ? 'Luces encendidas' : 'Luces apagadas');
        this.audio.beep(on ? 900 : 500, 0.07, 0.1);
        break;
      }
      case 'view': {
        const v = this.engine.nextView();
        this.hud.toast('Vista: ' + v.name);
        this.audio.beep(700, 0.05, 0.08);
        break;
      }
      case 'view1': this.engine.setView(0); this.hud.toast('Vista: FPV'); break;
      case 'view2': this.engine.setView(1); this.hud.toast('Vista: Persecucion'); break;
      case 'view3': this.engine.setView(2); this.hud.toast('Vista: Operador (MR)'); break;
      case 'view4': this.engine.setView(3); this.hud.toast('Vista: Cinematica'); break;
      case 'home': this._toggleAutopilot(); break;
      case 'winch':
        if (this._mission && this._mission.carrying) this.wantDrop = true;
        else this._toggleWinch();
        break;
      case 'winch-down': this.drone.setWinch(1); break;
      case 'winch-up': this.drone.setWinch(0); break;
      case 'pause': this.state === 'paused' ? this.resume() : this.pause(); break;
      case 'restart': if (this.state === 'playing') this.startMission(this._currentMissionId); break;
      case 'minimap': {
        const p = document.getElementById('panel-minimap');
        p.style.display = p.style.display === 'none' ? '' : 'none';
        break;
      }
      case 'hover': this.drone.setInput({ throttle: 0, roll: 0, pitch: 0, yaw: 0 }); break;
      case 'wave': {
        this.hud.toast('El dron te saluda', 'good');
        this.audio.melody([620, 780, 980], 0.09, 0.1);
        if (this.settings.get('haptics')) navigator.vibrate?.(20);
        this._lightsBeforeWave = this.drone.lightsOn;
        this._waveTimer = 1.6;
        break;
      }
      default: break;
    }
  }

  _toggleTakeoff() {
    const d = this.drone;
    if (d.crashed) { this.hud.toast('El dron esta danado', 'bad'); return; }
    if (d.battery <= 0) { this.hud.toast('Bateria agotada', 'bad'); return; }
    if (d.isAirborne || d.flying) {
      d.land();
      this.autopilot = false;
      this.hud.toast('Aterrizando…');
      this.hud.log('Aterrizaje iniciado');
      this.audio.beep(520, 0.12, 0.1);
    } else {
      d.takeoff();
      this.hud.toast('Motores armados · despegando', 'good');
      this.hud.log('Despegue', 'good');
      this.audio.spinUp();
      if (this.settings.get('haptics')) navigator.vibrate?.(30);
    }
  }

  _toggleAutopilot() {
    const d = this.drone;
    if (!d.isAirborne) { this.hud.toast('Despega primero', 'warn'); return; }
    this.autopilot = !this.autopilot;
    this.hud.toast(this.autopilot ? 'Volviendo a la base…' : 'Piloto manual', this.autopilot ? 'good' : '');
    this.hud.log(this.autopilot ? 'Piloto automatico: regreso a base' : 'Control manual');
    this.audio.beep(this.autopilot ? 880 : 600, 0.09, 0.1);
  }

  _toggleWinch() {
    const d = this.drone;
    const next = d.winch.target > 0.5 ? 0 : 1;
    d.setWinch(next);
    this.hud.toast(next ? 'Giratorio desplegado' : 'Giratorio recogido');
    this.audio.beep(next ? 700 : 500, 0.08, 0.1);
  }

  _takePhoto() {
    const m = this._mission;
    this.audio.shutter();
    this.hud.flash();
    if (this.settings.get('haptics')) navigator.vibrate?.(15);
    // mision de reconocimiento
    if (m && typeof m.tryPhoto === 'function') m.tryPhoto({ drone: this.drone, world: this.world });
    this._saveSnapshot();
  }

  /** Compone video real + escena 3D y descarga la foto. */
  _saveSnapshot() {
    try {
      const gl = this.engine.canvas;
      const w = gl.width, h = gl.height;
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const ctx = out.getContext('2d');
      if (this.mr.isLive) {
        const v = this.mr.video;
        const vw = v.videoWidth, vh = v.videoHeight;
        const scale = Math.max(w / vw, h / vh);
        const dw = vw * scale, dh = vh * scale;
        ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = '#05070c';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(gl, 0, 0, w, h);
      const a = document.createElement('a');
      a.download = `dron-se-${Date.now()}.png`;
      a.href = out.toDataURL('image/png');
      a.click();
      this.hud.log('Foto guardada', 'good');
    } catch (e) {
      this.hud.log('No se pudo guardar la foto', 'warn');
    }
  }

  /* ================================================================== */
  /*  BUCLE PRINCIPAL                                                   */
  /* ================================================================== */
  _loop(t) {
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);
    this.frame++;

    if (this.state === 'playing') this._update(dt);
    else this._updateIdle(dt);

    this.engine.render();
  }

  /** Actualizacion cuando hay una mision activa. */
  _update(dt) {
    const d = this.drone;
    const m = this._mission;
    this.time += dt;

    /* --- entorno: viento, cielo, mundo --- */
    this.wind.update(dt);
    this.sky.setWind(this.wind.speed);
    this.sky.update(dt);
    const turb = this.wind.turbulence * (this.sky.weather === 'storm' ? 2.2 : 1);

    /* --- respuesta al entorno real (camara) --- */
    this._mrAnalysisAcc += dt;
    if (this._mrAnalysisAcc > 0.12) {
      const step = this._mrAnalysisAcc;
      this._mrAnalysisAcc = 0;
      const a = this.mr.analyze(step);
      if (a) this._respondToRealWorld(a);
    }

    /* --- entrada humana --- */
    const input = this.input.update(dt, d);
    if (this.autopilot) {
      const ap = this._autopilot(dt);
      if (ap) d.setInput(ap);
      else d.setInput(input);
    } else {
      d.setInput(input);
    }

    /* --- piloto automatico de emergencia --- */
    if (d.battery < 6 && !this.autopilot && d.isAirborne) {
      this.autopilot = true;
      this.hud.toast('Bateria critica · regreso automatico', 'bad');
      this.hud.log('Regreso automatico por bateria', 'bad');
    }

    /* --- mundo --- */
    const ctx = { drone: d, wind: this.wind, sky: this.sky, time: this.time };
    this.world.update(dt, ctx);

    /* --- fisica (subpasos fijos) --- */
    const env = {
      wind: this.wind.speed,
      turbulence: turb,
      groundHeight: (x, z) => this.world.groundHeight(x, z),
      obstacles: this.world.obstacles,
      recharging: this.world.pads[0].position.distanceTo(d.position) < 2.2 && d.landed,
      onBump: () => { this.hud.hit(); },
      updateWinch: (dr, len) => this._updateWinchPayload(dr, len),
    };
    this._accum += dt;
    const h = 1 / 120;
    let steps = 0;
    while (this._accum >= h && steps < 6) {
      d.update(h, env);
      this._accum -= h;
      steps++;
    }
    if (steps >= 6) this._accum = 0;

    /* --- sombra de contacto (MR) --- */
    if (this.mrMode) {
      const bs = d.model.blobShadow;
      const gy = this.world.groundHeight(d.position.x, d.position.z);
      bs.position.set(d.position.x, gy + 0.02, d.position.z);
      const alt = clamp(d.position.y - gy, 0, 12);
      const s = 1 + alt * 0.22;
      bs.scale.set(s, s, s);
      bs.material.opacity = clamp(0.42 - alt * 0.028, 0, 0.42);
    }

    /* --- mision --- */
    m.update(dt, { drone: d, world: this.world, wind: this.wind, sky: this.sky, input });
    if (m.state === 'complete') this._finishMission(true);
    else if (m.state === 'failed') this._finishMission(false);

    /* --- camara, hud, audio --- */
    this.engine.updateCamera(dt, d, input, { orientation: this.mr.orientation, mr: this.mrMode });
    this.hud.update(dt, {
      drone: d, mission: m, wind: this.wind, sky: this.sky, world: this.world, score: this.score,
    });
    this.audio.update(dt, {
      rpmAvg: d.rotorRpmAvg, throttle: d.input.throttle,
      airspeed: d.airspeed, flying: d.isAirborne, crashed: d.crashed,
      battery: d.batteryPct,
    });

    /* --- particulas de viento visibles segun intensidad --- */
    this.sky.showWindParticles(clamp((this.wind.magnitude - 2.2) / 6, 0, 0.55));

    /* --- efecto "saludo": el dron parpadea sus luces --- */
    if (this._waveTimer > 0) {
      this._waveTimer -= dt;
      const blink = Math.floor(this._waveTimer * 6) % 2 === 0;
      d.lightsOn = blink;
      this._waveActive = true;
    } else if (this._waveActive) {
      this._waveActive = false;
      d.lightsOn = this._lightsBeforeWave;
    }

    // limites del mundo
    const lim = 90;
    if (Math.abs(d.position.x) > lim || Math.abs(d.position.z) > lim) {
      d.position.x = clamp(d.position.x, -lim, lim);
      d.position.z = clamp(d.position.z, -lim, lim);
      this.hud.toast('Limite del area alcanzado', 'warn');
    }
  }

  /** Actualizacion en menus: el mundo sigue vivo de fondo. */
  _updateIdle(dt) {
    this.wind.update(dt);
    this.sky.update(dt);
    if (this.world) this.world.update(dt, { drone: this.drone, wind: this.wind, sky: this.sky });
    // camara orbital suave alrededor de la base
    this._orbitIdle = (this._orbitIdle || 0) + dt * 0.12;
    const r = 9;
    this.engine.camera.position.set(Math.sin(this._orbitIdle) * r, 4.2, Math.cos(this._orbitIdle) * r);
    this.engine.camera.lookAt(0, 1.2, 0);
    if (this.mrMode) {
      const bs = this.drone.model.blobShadow;
      bs.position.set(this.drone.position.x, 0.02, this.drone.position.z);
      bs.material.opacity = 0.3;
      bs.scale.setScalar(1);
    }
  }

  /* ================================================================== */
  /*  RESPUESTAS AL ENTORNO                                             */
  /* ================================================================== */

  /** Adapta iluminacion, exposicion y faros a lo que ve la camara. */
  _respondToRealWorld(a) {
    // adaptacion cromatica: el mundo virtual toma el tono de la habitacion
    const targetExp = lerp(1.18, 0.92, a.luma);
    this.engine.renderer.toneMappingExposure = damp(this.engine.renderer.toneMappingExposure, targetExp, 2, 0.12);
    // tinte de la rejilla holografica segun la luz real
    if (this.world?.holoGrid) {
      const c = this.world.holoGrid.material.color;
      c.setRGB(0.49 + a.warmth * 0.25, 0.97, 0.78 - a.warmth * 0.15);
    }
    // faro automatico si la habitacion esta oscura
    this.drone._lightAuto = this.settings.get('autoLights') && (a.luma < 0.22 || this.sky.isNight);
    // mensaje puntual al detectar presencia
    if (a.presence && !this._presenceAnnounced) {
      this._presenceAnnounced = true;
      this.hud.log('Movimiento detectado en la habitacion', 'good');
    } else if (!a.presence && this._presenceAnnounced) {
      this._presenceAnnounced = false;
    }
  }

  /** Piloto automatico de regreso a la base. */
  _autopilot(dt) {
    const d = this.drone;
    const home = this.world.pads[0].position;
    const dx = home.x - d.position.x, dz = home.z - d.position.z;
    const dist = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(dx, dz);
    let dy = desiredYaw - d.targetYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;

    const yaw = clamp(dy * 1.6, -1, 1);
    const align = Math.max(0, Math.cos(dy));
    const pitch = dist > 2.5 ? align * clamp(dist / 14, 0, 1) : 0;
    const roll = clamp(-Math.sin(dy) * 0.4, -0.4, 0.4);

    // control de altura: acercarse al suelo cuando esta cerca
    const targetAlt = dist < 6 ? 0.6 : 4.5;
    const alt = d.position.y - this.world.groundHeight(d.position.x, d.position.z);
    const throttle = clamp((targetAlt - alt) * 0.16, -0.55, 0.85);

    if (dist < 1.4 && alt < 0.8 && d.airspeed < 1.2) {
      this.autopilot = false;
      d.land();
      this.hud.toast('En la base', 'good');
      this.hud.log('Aterrizaje automatico completado', 'good');
      this.audio.melody([700, 980, 1260]);
      return null;
    }
    return { throttle, roll, pitch, yaw };
  }

  /** Logica del giratorio (enganchar personas). */
  _updateWinchPayload(d, len) {
    if (len > 0.05 && !this._winchLogged) {
      this._winchLogged = true;
      this.hud.log('Giratorio desplegado');
    } else if (len <= 0.05) {
      this._winchLogged = false;
    }
  }

  /* ================================================================== */
  /*  ACCESOS                                                           */
  /* ================================================================== */
  get settings() { return this._settings; }
  set settings(v) { this._settings = v; }
}
