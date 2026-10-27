/**
 * Cielo, iluminacion y ciclo dia/noche.
 * El sol, la luna, las estrellas y la niebla reaccionan a la hora del dia
 * y a las condiciones meteorologicas del entorno generado.
 */
import * as THREE from 'three';
import { clamp, lerp, TAU, makeRng, cloudTexture, skyTexture, radialGlowTexture } from '../core/Utils.js';

export class Sky {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.timeOfDay = opts.timeOfDay ?? 10.5;      // horas (0..24)
    this.dayLength = opts.dayLength ?? 480;       // segundos reales por dia completo
    this.weather = 'clear';
    this.auto = true;

    /* --- luz solar --- */
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 260;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    /* --- luces de relleno --- */
    this.hemi = new THREE.HemisphereLight(0xbdd6ff, 0x2a2f26, 0.85);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(this.ambient);

    /* --- boveda celeste --- */
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), skyMat);
    scene.add(this.dome);

    /* --- luna --- */
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(9, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
    );
    scene.add(this.moon);

    /* --- sol visible --- */
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialGlowTexture('rgba(255,244,214,1)', 'rgba(255,200,120,0)'),
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true,
    }));
    this.sunDisc.scale.set(90, 90, 1);
    scene.add(this.sunDisc);

    /* --- estrellas --- */
    const starCount = 900;
    const pos = new Float32Array(starCount * 3);
    const rng = makeRng(4242);
    for (let i = 0; i < starCount; i++) {
      const u = rng() * TAU, v = rng() * 0.55 + 0.02;
      const r = 360;
      pos[i * 3] = Math.cos(u) * Math.cos(v) * r;
      pos[i * 3 + 1] = Math.sin(v) * r;
      pos[i * 3 + 2] = Math.sin(u) * Math.cos(v) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false,
    }));
    scene.add(this.stars);

    /* --- nubes --- */
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.SpriteMaterial({
      map: cloudTexture(11), transparent: true, opacity: 0.55, depthWrite: false, fog: false,
    });
    for (let i = 0; i < 22; i++) {
      const s = new THREE.Sprite(cloudMat);
      const a = rng() * TAU, r = 90 + rng() * 170;
      s.position.set(Math.cos(a) * r, 55 + rng() * 55, Math.sin(a) * r);
      const sc2 = 60 + rng() * 90;
      s.scale.set(sc2, sc2 * 0.42, 1);
      this.clouds.add(s);
    }
    scene.add(this.clouds);

    /* --- lluvia --- */
    const rainCount = 2600;
    const rpos = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rpos[i * 3] = (rng() - 0.5) * 90;
      rpos[i * 3 + 1] = rng() * 40;
      rpos[i * 3 + 2] = (rng() - 0.5) * 90;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
    this.rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
      color: 0x9fc4e8, size: 0.14, transparent: true, opacity: 0, depthWrite: false,
    }));
    scene.add(this.rain);

    /* --- particulas de viento (visualizan el campo de viento) --- */
    const wCount = 420;
    const wpos = new Float32Array(wCount * 3);
    for (let i = 0; i < wCount; i++) {
      wpos[i * 3] = (rng() - 0.5) * 80;
      wpos[i * 3 + 1] = 0.6 + rng() * 16;
      wpos[i * 3 + 2] = (rng() - 0.5) * 80;
    }
    const windGeo = new THREE.BufferGeometry();
    windGeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    this.windParticles = new THREE.Points(windGeo, new THREE.PointsMaterial({
      color: 0xdff0ff, size: 0.10, transparent: true, opacity: 0.0, depthWrite: false,
    }));
    scene.add(this.windParticles);

    this._rng = makeRng(7);
    // colores reutilizados (evita allocar en cada fotograma)
    this._cNoon = new THREE.Color(0xfff4e0);
    this._cWarm = new THREE.Color(0xff9a4a);
    this._cNight = new THREE.Color(0x9db8ff);
    this._cDay = new THREE.Color(0x2b4a72);
    this._cDusk = new THREE.Color(0xc96a3a);
    this._cSkyNight = new THREE.Color(0x05070f);
    this._cRain = new THREE.Color(0x55636f);
    this.fog = new THREE.Fog(0x9fb6cc, 40, 320);
    scene.fog = this.fog;
    this.update(0);
  }

  /** 0 = noche cerrada, 1 = mediodia. */
  sunIntensity() {
    const h = this.timeOfDay;
    const x = Math.sin(((h - 6) / 12) * Math.PI);
    return clamp(x, 0, 1);
  }

  setWeather(type) {
    this.weather = type;
    const rainy = type === 'rain' || type === 'storm';
    this.rain.material.opacity = rainy ? (type === 'storm' ? 0.75 : 0.5) : 0;
    this.rain.visible = rainy;
    this.clouds.children.forEach((c) => {
      c.material.opacity = type === 'clear' ? 0.35 : type === 'cloudy' ? 0.6 : 0.85;
    });
    this.fog.near = type === 'clear' ? 60 : type === 'cloudy' ? 35 : 16;
    this.fog.far = type === 'clear' ? 340 : type === 'cloudy' ? 190 : 95;
  }

  update(dt) {
    if (this.auto) this.timeOfDay = (this.timeOfDay + (dt / this.dayLength) * 24) % 24;

    const h = this.timeOfDay;
    const day = this.sunIntensity();
    const dusk = clamp(1 - Math.abs(day - 0.28) / 0.30, 0, 1);

    const sunAngle = ((h - 6) / 12) * Math.PI;
    const sx = Math.cos(sunAngle) * 180;
    const sy = Math.sin(sunAngle) * 180;
    this.sun.position.set(sx, Math.max(sy, -40), 70);
    this.sun.target.position.set(0, 0, 0);
    this.sunDisc.position.set(sx * 2.1, Math.max(sy * 2.1, 20), 150);
    this.moon.position.set(-sx * 1.8, Math.max(-sy * 1.8, 30), -140);

    const c = this._cNoon.set(0xfff4e0).lerp(this._cWarm, dusk * 0.85).lerp(this._cNight, 1 - day);
    this.sun.color.copy(c);
    this.sun.intensity = lerp(0.06, 2.9, day) *
      (this.weather === 'storm' ? 0.45 : this.weather === 'rain' ? 0.6 : 1);
    this.hemi.intensity = lerp(0.16, 0.95, day);
    this.hemi.color.setHex(this.weather === 'clear' ? 0xbdd6ff : 0x8fa4bd);
    this.ambient.intensity = lerp(0.10, 0.20, day);

    const fogCol = this._cDay.set(0x2b4a72).lerp(this._cDusk, dusk * 0.7).lerp(this._cSkyNight, 1 - day);
    if (this.weather === 'rain' || this.weather === 'storm') fogCol.lerp(this._cRain, 0.6);
    this.fog.color.copy(fogCol);
    this.dome.material.color.copy(fogCol).multiplyScalar(lerp(0.55, 1.25, day));
    this.stars.material.opacity = clamp(1 - day * 2.2, 0, 1) * (this.weather === 'clear' ? 1 : 0.25);
    this.moon.visible = day < 0.35;
    this.sunDisc.material.opacity = clamp(day * 1.4, 0, 1);

    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position;
      const fall = (this.weather === 'storm' ? 34 : 20) * dt;
      const drift = this._wind ? this._wind.x * dt : 0;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - fall;
        let x = p.getX(i) + drift;
        if (y < 0) { y = 38; x = (this._rng() - 0.5) * 90; }
        p.setXY(i, x, y);
      }
      p.needsUpdate = true;
    }

    if (this._wind && this.windParticles.material.opacity > 0.01) {
      const p = this.windParticles.geometry.attributes.position;
      const w = this._wind;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) + w.x * dt * 1.6;
        let z = p.getZ(i) + w.z * dt * 1.6;
        const y = p.getY(i) + w.y * dt * 0.5;
        if (Math.abs(x) > 42) x = -Math.sign(x) * 42;
        if (Math.abs(z) > 42) z = -Math.sign(z) * 42;
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
    }
    this.clouds.rotation.y += dt * 0.004;
  }

  setWind(v) { this._wind = v; }
  showWindParticles(v) { this.windParticles.material.opacity = v; }

  /** true si es de noche (para encender las luces del dron). */
  get isNight() { return this.sunIntensity() < 0.16; }
}
