/**
 * HUD: telemetria, objetivos, minimapa, rosa de los vientos, avisos y log.
 * Todo el HUD son elementos DOM sobre el canvas 3D.
 */
import { clamp, fmtTime } from '../core/Utils.js';
import { VIEWS } from '../core/Engine.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      missionName: $('mission-name'),
      missionObjective: $('mission-objective'),
      missionTimer: $('mission-timer'),
      missionProgress: $('mission-progress'),
      missionSteps: $('mission-steps'),
      battery: $('t-battery'), barBattery: $('bar-battery'),
      alt: $('t-alt'), spd: $('t-spd'), wind: $('t-wind'),
      state: $('t-state'), hull: $('t-hull'), barHull: $('bar-hull'),
      reticle: $('reticle'), horizon: $('horizon-group'),
      toasts: $('toasts'), log: $('log'),
      vignette: $('damage-vignette'), flash: $('photo-flash'),
      minimap: $('minimap'), windCanvas: $('wind-canvas'),
      mrBadge: $('mr-badge'),
      stickL: $('stick-l'), stickR: $('stick-r'),
      panelMinimap: $('panel-minimap'),
      btnTakeoff: $('btn-takeoff'),
    };
    this.minimap = this.el.minimap.getContext('2d');
    this.windCtx = this.el.windCanvas.getContext('2d');
    this._toastTimers = [];
    this._logLines = 0;
    this._acc = 0;
    this._hitTimer = 0;
    this._viewName = '';
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  setTouch(on) {
    this.el.stickL.classList.toggle('hidden', !on);
    this.el.stickR.classList.toggle('hidden', !on);
  }

  setMR(on) { this.el.mrBadge.classList.toggle('show', on); }

  setView(name) { this._viewName = name; }

  /* ------------------------------ mision ------------------------------ */
  setMission(name, brief) {
    this.el.missionName.textContent = name;
    this.el.missionObjective.textContent = brief;
  }

  setSteps(objectives) {
    const wrap = this.el.missionSteps;
    wrap.innerHTML = '';
    for (const o of objectives) {
      const d = document.createElement('div');
      d.className = 'step' + (o.done ? ' done' : o.active ? ' active' : '');
      const mark = document.createElement('i');
      mark.textContent = o.done ? '\u2713' : '';
      const label = document.createElement('span');
      label.textContent = o.text;
      d.append(mark, label);
      wrap.appendChild(d);
    }
  }

  /* ------------------------------ avisos ------------------------------ */
  toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.remove(), 2700);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  log(msg, kind = '') {
    const d = document.createElement('div');
    d.className = 'logline ' + kind;
    d.textContent = '› ' + msg;
    this.el.log.appendChild(d);
    while (this.el.log.children.length > 5) this.el.log.firstChild.remove();
    setTimeout(() => d.remove(), 6000);
  }

  hit() {
    this.el.vignette.classList.add('hit');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.el.vignette.classList.remove('hit'), 220);
  }

  flash() {
    const f = this.el.flash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  /* ------------------------------ bucle ------------------------------ */
  update(dt, s) {
    const { drone, mission, wind, sky, world, score } = s;

    // --- telemetria ---
    const bat = drone.batteryPct;
    this.el.battery.textContent = bat.toFixed(0) + '%';
    this.el.barBattery.style.width = bat + '%';
    this.el.barBattery.style.background = bat < 15 ? 'var(--bad)' : bat < 35 ? 'var(--warn)' : 'var(--acc)';
    this.el.alt.textContent = drone.altitude.toFixed(1) + ' m';
    this.el.spd.textContent = drone.airspeed.toFixed(1) + ' m/s';
    this.el.wind.textContent = wind.magnitude.toFixed(1) + ' m/s';
    this.el.hull.textContent = drone.integrity.toFixed(0) + '%';
    this.el.hull.style.color = drone.integrity < 40 ? 'var(--bad)' : drone.integrity < 70 ? 'var(--warn)' : '';
    this.el.barHull.style.width = drone.integrity + '%';
    this.el.barHull.style.background = drone.integrity < 40 ? 'var(--bad)' : 'var(--acc2)';

    let st = 'EN TIERRA';
    if (drone.crashed) st = 'ESTRELLADO';
    else if (drone.battery <= 0) st = 'SIN BATERIA';
    else if (drone.isAirborne) st = drone.airspeed > 8 ? 'EN VUELO · RAPIDO' : 'EN VUELO';
    else if (drone.landed && drone.battery > 0) st = 'EN TIERRA · LISTO';
    this.el.state.textContent = st;
    const btn = this.el.btnTakeoff;
    btn.classList.toggle('on', drone.isAirborne);
    const ico = btn.querySelector('.ico');
    const lbl = btn.querySelector('span');
    if (ico) ico.textContent = drone.isAirborne ? '\u25BC' : '\u25B2';
    if (lbl) lbl.textContent = drone.isAirborne ? 'ATERRIZAR' : 'DESPEGAR';

    // --- mision ---
    if (mission) {
      const p = mission.progress;
      this.el.missionProgress.textContent = `${p.done}/${p.total}`;
      if (mission.timeLimit) {
        const left = Math.max(0, mission.timeLimit - mission.time);
        this.el.missionTimer.textContent = fmtTime(left);
        this.el.missionTimer.style.color = left < 30 ? 'var(--bad)' : '';
      } else {
        this.el.missionTimer.textContent = fmtTime(mission.time);
      }
      this._acc += dt;
      if (this._acc > 0.25) { this._acc = 0; this.setSteps(mission.objectives); }
    }

    // --- horizonte artificial ---
    const att = drone.attitude();
    const g = this.el.horizon;
    // morro abajo -> el horizonte sube; alabeo a la derecha -> gira en antihorario
    g.setAttribute('transform', `translate(0 ${clamp(-att.pitch * 1.6, -60, 60)}) rotate(${att.roll} 100 100)`);

    // --- minimapa y rosa de vientos (a menor frecuencia que el render) ---
    this._mmAcc = (this._mmAcc || 0) + dt;
    if (this._mmAcc > 0.06) { this._mmAcc = 0; this._drawMinimap(drone, world, mission); }
    this._wrAcc = (this._wrAcc || 0) + dt;
    if (this._wrAcc > 0.1) { this._wrAcc = 0; this._drawWindRose(wind); }
  }

  _drawMinimap(drone, world) {
    const c = this.minimap;
    const W = 220, H = 220, cx = W / 2, cy = H / 2;
    const scale = 0.42;   // px por metro -> 220px = 520 m... ajustado abajo
    const mPerPx = 1 / scale;
    c.clearRect(0, 0, W, H);

    // fondo
    c.fillStyle = 'rgba(4,10,18,.55)';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(126,247,200,.14)';
    c.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      c.beginPath(); c.arc(cx, cy, i * 22, 0, Math.PI * 2); c.stroke();
    }
    c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, H);
    c.moveTo(0, cy); c.lineTo(W, cy); c.stroke();

    const yaw = drone.targetYaw;
    const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
    const toMap = (x, z) => {
      const dx = (x - drone.position.x) * scale;
      const dz = (z - drone.position.z) * scale;
      // rotar para que el rumbo del dron apunte arriba
      return [cx + dx * cos - dz * sin, cy + dx * sin + dz * cos];
    };

    // obstaculos (solo los cercanos)
    c.fillStyle = 'rgba(150,170,195,.35)';
    for (const o of world.obstacles) {
      if (o.type !== 'box') continue;
      const d = Math.hypot((o.min.x + o.max.x) / 2 - drone.position.x, (o.min.z + o.max.z) / 2 - drone.position.z);
      if (d > 90) continue;
      const [x1, y1] = toMap(o.min.x, o.min.z);
      const [x2, y2] = toMap(o.max.x, o.max.z);
      c.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) || 2, Math.abs(y2 - y1) || 2);
    }

    // plataformas
    for (const p of world.pads) {
      const [x, y] = toMap(p.position.x, p.position.z);
      c.fillStyle = p.isHome ? '#38bdf8' : '#ffb020';
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
    }
    // puertas
    for (const g of world.gates) {
      const [x, y] = toMap(g.position.x, g.position.z);
      c.fillStyle = g.passed ? '#7ef7c8' : 'rgba(126,247,200,.5)';
      c.fillRect(x - 3, y - 3, 6, 6);
    }
    // cajas / personas / pois
    for (const cr of world.crates) {
      if (cr.delivered) continue;
      const [x, y] = toMap(cr.position.x, cr.position.z);
      c.fillStyle = cr.taken ? '#7ef7c8' : '#c98a4b';
      c.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const p of world.people) {
      if (p.rescued) continue;
      const [x, y] = toMap(p.position.x, p.position.z);
      c.fillStyle = '#ff4d5e';
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
    }
    for (const p of world.pois) {
      const [x, y] = toMap(p.position.x, p.position.z);
      c.fillStyle = p.photographed ? '#7ef7c8' : '#ffb020';
      c.beginPath();
      c.moveTo(x, y - 5); c.lineTo(x + 4, y + 4); c.lineTo(x - 4, y + 4);
      c.closePath(); c.fill();
    }

    // dron (flecha)
    c.save();
    c.translate(cx, cy);
    c.fillStyle = '#7ef7c8';
    c.beginPath();
    c.moveTo(0, -9); c.lineTo(6, 8); c.lineTo(0, 4); c.lineTo(-6, 8);
    c.closePath(); c.fill();
    c.restore();

    // norte
    c.fillStyle = 'rgba(234,242,255,.6)';
    c.font = '10px monospace';
    c.fillText('N', cx - 3, 12);
    const [nx, ny] = toMap(drone.position.x, drone.position.z - 40);
    c.strokeStyle = 'rgba(234,242,255,.35)';
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(nx, ny); c.stroke();
  }

  _drawWindRose(wind) {
    const c = this.windCtx;
    const W = 120, H = 120, cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);
    // circulo
    c.strokeStyle = 'rgba(126,247,200,.25)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, 44, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, 26, 0, Math.PI * 2); c.stroke();
    // marcas
    c.fillStyle = 'rgba(142,163,189,.8)';
    c.font = '9px monospace';
    c.fillText('N', cx - 3, cy - 48);
    c.fillText('S', cx - 3, cy + 54);
    c.fillText('E', cx + 48, cy + 3);
    c.fillText('O', cx - 52, cy + 3);

    if (!wind) return;
    // flecha: direccion hacia donde sopla
    const mag = clamp(wind.magnitude / 12, 0.08, 1);
    const ang = Math.atan2(wind.speed.z, wind.speed.x);
    c.save();
    c.translate(cx, cy);
    c.rotate(ang);
    c.strokeStyle = '#7ef7c8';
    c.fillStyle = '#7ef7c8';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(-40 * mag, 0); c.lineTo(34 * mag, 0); c.stroke();
    c.beginPath();
    c.moveTo(44 * mag, 0); c.lineTo(30 * mag, -7); c.lineTo(30 * mag, 7);
    c.closePath(); c.fill();
    c.restore();
    // texto
    c.fillStyle = '#7ef7c8';
    c.font = 'bold 11px monospace';
    c.fillText(wind.magnitude.toFixed(1) + ' m/s', 24, 112);
    c.fillStyle = 'rgba(142,163,189,.9)';
    c.font = '8px monospace';
    c.fillText(wind.description, 24, 8);
  }
}
