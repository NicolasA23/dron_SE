/**
 * ENTRADA MULTIMODAL
 * ------------------
 * Une todas las formas en que el humano puede interactuar con el dron:
 *   · teclado (3 perfiles: mando RC modo 2, gamer, arcade)
 *   · mando / gamepad
 *   · joysticks tactiles en pantalla
 *   · giroscopio del movil (inclinar para volar)
 *   · raton (mirar alrededor / modo vuelo por raton)
 *   · voz (Web Speech API)
 *   · gestos captados por la camara (saludo)
 */
import { clamp } from './Utils.js';

const PRESETS = {
  rc2: {
    name: 'Mando RC \u00b7 Modo 2',
    axes: {
      throttle: { up: 'KeyW', down: 'KeyS' },
      yaw: { left: 'KeyA', right: 'KeyD' },
      pitch: { fwd: 'ArrowUp', back: 'ArrowDown' },
      roll: { left: 'ArrowLeft', right: 'ArrowRight' },
    },
  },
  gamer: {
    name: 'Gamer (WASD)',
    axes: {
      pitch: { fwd: 'KeyW', back: 'KeyS' },
      roll: { left: 'KeyA', right: 'KeyD' },
      yaw: { left: 'ArrowLeft', right: 'ArrowRight' },
      throttle: { up: 'ShiftLeft', down: 'ControlLeft' },
    },
  },
  arcade: {
    name: 'Arcade',
    axes: {
      throttle: { up: 'KeyW', down: 'KeyS' },
      roll: { left: 'KeyA', right: 'KeyD' },
      pitch: { fwd: 'ArrowUp', back: 'ArrowDown' },
      yaw: { left: 'KeyQ', right: 'KeyE' },
    },
  },
};

/** Etiquetas legibles de cada eje para la pantalla de controles. */
export function axisLabels(P) {
  const pos = (a) => [a.up || a.fwd || a.right, a.down || a.back || a.left];
  return {
    throttle: pos(P.axes.throttle),
    yaw: pos(P.axes.yaw),
    pitch: pos(P.axes.pitch),
    roll: pos(P.axes.roll),
  };
}

/** Nombre corto de una tecla para el HUD. */
export function keyName(code) {
  const arrows = { ArrowUp: '\u2191', ArrowDown: '\u2193', ArrowLeft: '\u2190', ArrowRight: '\u2192' };
  if (arrows[code]) return arrows[code];
  return code
    .replace('Key', '')
    .replace('Digit', '')
    .replace('ShiftLeft', 'Shift')
    .replace('ControlLeft', 'Ctrl')
    .replace('Left', '');
}

export { PRESETS };

/** Joystick tactil reutilizable. */
export class Joystick {
  constructor(el) {
    this.el = el;
    this.active = false;
    this.x = 0; this.y = 0;
    this.vector = { x: 0, y: 0 };
    this._id = null;
    this._cx = 0; this._cy = 0; this._r = 52;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('lostpointercapture', () => this._up());
  }
  _down(e) {
    this.active = true;
    this._id = e.pointerId;
    const r = this.el.getBoundingClientRect();
    this._cx = r.left + r.width / 2;
    this._cy = r.top + r.height / 2;
    this._r = r.width * 0.36;
    this.el.setPointerCapture?.(e.pointerId);
    this._move(e);
  }
  _move(e) {
    if (!this.active || (this._id !== null && e.pointerId !== this._id)) return;
    let dx = e.clientX - this._cx, dy = e.clientY - this._cy;
    const d = Math.hypot(dx, dy);
    if (d > this._r) { dx = (dx / d) * this._r; dy = (dy / d) * this._r; }
    this.vector.x = clamp(dx / this._r, -1, 1);
    this.vector.y = clamp(-dy / this._r, -1, 1);   // arriba = +
    const knob = this.el.querySelector('.stick-knob');
    if (knob) knob.style.transform = `translate(${dx}px,${dy}px)`;
  }
  _up() {
    if (!this.active) return;
    this.active = false;
    this._id = null;
    this.vector.x = 0; this.vector.y = 0;
    const knob = this.el.querySelector('.stick-knob');
    if (knob) knob.style.transform = '';
  }
}

export class Input {
  constructor(opts = {}) {
    this.dom = opts.domElement || document.body;
    this.joystickL = opts.joystickL ? new Joystick(opts.joystickL) : null;
    this.joystickR = opts.joystickR ? new Joystick(opts.joystickR) : null;
    this.settings = opts.settings || {};
    this.onAction = opts.onAction || (() => {});
    this.mr = opts.mr || null;             // MRCamera (para orientacion/gestos)

    this.keys = new Set();
    this.state = { throttle: 0, roll: 0, pitch: 0, yaw: 0, lookX: 0, lookY: 0, gyro: false };
    this.preset = this.settings.controlPreset || 'rc2';
    this.touchMode = false;
    this._mouseLook = { x: 0, y: 0, dx: 0, dy: 0, active: false, lx: 0, ly: 0 };
    this._voiceHold = { cmd: null, t: 0 };
    this._gestureCooldown = 0;

    this._bindKeyboard();
    this._bindPointer();
    this._bindVoice();
  }

  /* ------------------------------ teclado ------------------------------ */
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { e.preventDefault?.(); return; }
      this.keys.add(e.code);
      this.touchMode = false;
      const a = this._actionFor(e.code);
      if (a) { this.onAction(a); e.preventDefault(); }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _actionFor(code) {
    const map = {
      KeyT: 'takeoff', Space: 'takeoff',
      KeyF: 'photo', KeyL: 'lights', KeyC: 'view', KeyH: 'home',
      KeyG: 'winch', Escape: 'pause', KeyM: 'minimap', KeyV: 'voice',
      Digit1: 'view1', Digit2: 'view2', Digit3: 'view3', Digit4: 'view4',
      KeyR: 'restart',
    };
    return map[code] || null;
  }

  /** ¿Esta pulsada la tecla (o alguna de la lista)? */
  isDown(codes) {
    if (typeof codes === 'string') return this.keys.has(codes);
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /* ------------------------------ puntero ------------------------------ */
  _bindPointer() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('#actionbar, .stick, #hud > *')) return;
      this._mouseLook.active = true;
      this._mouseLook.lx = e.clientX; this._mouseLook.ly = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this._mouseLook.active) return;
      const dx = e.clientX - this._mouseLook.lx, dy = e.clientY - this._mouseLook.ly;
      this._mouseLook.lx = e.clientX; this._mouseLook.ly = e.clientY;
      this._mouseLook.x -= dx * 0.0032;
      this._mouseLook.y = clamp(this._mouseLook.y - dy * 0.0032, -1.1, 1.1);
      this._mouseLook.dx += dx * 0.0032;
      this._mouseLook.dy += dy * 0.0032;
    });
    const up = () => { this._mouseLook.active = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      this._mouseLook.y = clamp(this._mouseLook.y + Math.sign(e.deltaY) * 0.08, -1.1, 1.1);
    }, { passive: true });
  }

  /* ------------------------------ gamepad ------------------------------ */
  _pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dead = (v) => (Math.abs(v) < 0.09 ? 0 : v);
      return {
        roll: dead(p.axes[0] || 0),
        pitch: dead(-(p.axes[1] || 0)),
        yaw: dead(p.axes[2] || 0),
        throttle: dead(-(p.axes[3] || 0)),
        buttons: p.buttons.map((b) => b.pressed),
      };
    }
    return null;
  }

  /* ------------------------------ voz ------------------------------ */
  _bindVoice() {
    this.voiceEnabled = false;
    this._recognition = null;
    this._lastVoice = 0;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'es-ES';
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const txt = e.results[i][0].transcript.toLowerCase().trim();
          if (!txt) continue;
          this._handleVoice(txt, e.results[i].isFinal);
        }
      };
      rec.onend = () => { if (this.voiceEnabled) { try { rec.start(); } catch { /* noop */ } } };
      rec.onerror = () => { /* se reintenta solo */ };
      this._recognition = rec;
    } catch { /* noop */ }
  }

  get voiceSupported() { return !!this._recognition; }

  setVoice(on) {
    if (!this._recognition) return false;
    this.voiceEnabled = on;
    try {
      if (on) this._recognition.start(); else this._recognition.stop();
    } catch { /* ya iniciado */ }
    return true;
  }

  _handleVoice(txt, isFinal) {
    const now = performance.now();
    if (now - this._lastVoice < 700) return;
    const has = (...ws) => ws.some((w) => txt.includes(w));
    if (has('despega', 'vuela', 'take off', 'takeoff', 'arranca')) { this._lastVoice = now; this.onAction('takeoff'); }
    else if (has('aterriza', 'land', 'baja a tierra')) { this._lastVoice = now; this.onAction('takeoff'); }
    else if (has('foto', 'captura', 'photo')) { this._lastVoice = now; this.onAction('photo'); }
    else if (has('luz', 'farol')) { this._lastVoice = now; this.onAction('lights'); }
    else if (has('casa', 'base', 'hogar', 'vuelve')) { this._lastVoice = now; this.onAction('home'); }
    else if (has('para', 'deten', 'alto', 'stop')) { this._lastVoice = now; this._voiceHold = { cmd: null, t: 0 }; this.onAction('hover'); }
    else if (has('sube', 'arriba', 'up')) { this._lastVoice = now; this._voiceHold = { cmd: 'up', t: 0.8 }; }
    else if (has('baja', 'abajo', 'down')) { this._lastVoice = now; this._voiceHold = { cmd: 'down', t: 0.8 }; }
    else if (has('izquierda', 'left')) { this._lastVoice = now; this._voiceHold = { cmd: 'left', t: 0.6 }; }
    else if (has('derecha', 'right')) { this._lastVoice = now; this._voiceHold = { cmd: 'right', t: 0.6 }; }
    else if (has('adelante', 'frente', 'forward')) { this._lastVoice = now; this._voiceHold = { cmd: 'fwd', t: 0.6 }; }
    else if (has('atras', 'atrás', 'back')) { this._lastVoice = now; this._voiceHold = { cmd: 'back', t: 0.6 }; }
    else if (has('gira', 'rota')) { this._lastVoice = now; this._voiceHold = { cmd: 'yaw', t: 0.6 }; }
  }

  /* ------------------------------ bucle ------------------------------ */
  update(dt, drone) {
    const P = PRESETS[this.preset] || PRESETS.rc2;
    let throttle = 0, roll = 0, pitch = 0, yaw = 0;
    let used = false;

    // --- teclado ---
    const A = P.axes;
    const ax = (a) => (this.isDown(a.up ?? a.fwd ?? a.right) ? 1 : 0)
                   - (this.isDown(a.down ?? a.back ?? a.left) ? 1 : 0);
    const kThrottle = ax(A.throttle);
    const kYaw = ax(A.yaw);
    const kPitch = ax(A.pitch);
    const kRoll = ax(A.roll);
    if (kThrottle || kYaw || kPitch || kRoll) used = true;
    throttle += kThrottle; yaw += kYaw; pitch += kPitch; roll += kRoll;

    // --- gamepad ---
    const pad = this._pollGamepad();
    if (pad) {
      if (Math.abs(pad.throttle) + Math.abs(pad.yaw) + Math.abs(pad.roll) + Math.abs(pad.pitch) > 0.01) used = true;
      throttle += pad.throttle; yaw += pad.yaw; pitch += pad.pitch; roll += pad.roll;
      const act = (i, a) => { if (pad.buttons[i] && !this._padPrev?.[i]) this.onAction(a); };
      act(0, 'takeoff'); act(1, 'photo'); act(2, 'lights'); act(3, 'view');
      act(4, 'winch-down'); act(5, 'winch-up');
      if (pad.buttons[9]) this.onAction('pause');
      this._padPrev = pad.buttons;
    }

    // --- joysticks tactiles ---
    if (this.joystickL && this.joystickL.active) {
      used = true;
      this.touchMode = true;
      throttle += this.joystickL.vector.y;
      yaw += this.joystickL.vector.x;
    }
    if (this.joystickR && this.joystickR.active) {
      used = true;
      this.touchMode = true;
      roll += this.joystickR.vector.x;
      pitch += this.joystickR.vector.y;
    }

    // --- giroscopio ---
    if (this.settings.gyro && this.mr?.orientation) {
      used = true;
      // apuntas con el telefono: la direccion a la que mira el movil es la
      // direccion a la que se inclina el dron.
      const look = applyQuat(this.mr.orientation, { x: 0, y: 0, z: -1 });
      roll += clamp(look.x * 1.6, -1, 1);
      pitch += clamp(-look.y * 1.6, -1, 1);
    }

    // --- vuelo con raton ---
    if (this.settings.mouseFlight) {
      roll += clamp(this._mouseLook.x * 1.2, -1, 1);
      pitch += clamp(-this._mouseLook.y * 1.2, -1, 1);
      if (Math.abs(this._mouseLook.x) + Math.abs(this._mouseLook.y) > 0.05) used = true;
    }

    // --- voz (mantener) ---
    if (this._voiceHold.cmd) {
      this._voiceHold.t -= dt;
      used = true;
      const s = 1;
      if (this._voiceHold.cmd === 'up') throttle += s;
      if (this._voiceHold.cmd === 'down') throttle -= s;
      if (this._voiceHold.cmd === 'left') roll -= s;
      if (this._voiceHold.cmd === 'right') roll += s;
      if (this._voiceHold.cmd === 'fwd') pitch += s;
      if (this._voiceHold.cmd === 'back') pitch -= s;
      if (this._voiceHold.cmd === 'yaw') yaw += s;
      if (this._voiceHold.t <= 0) this._voiceHold = { cmd: null, t: 0 };
    }

    // --- gesto por camara (saludo = el dron saluda y se estabiliza) ---
    this._gestureCooldown -= dt;
    if (this.mr?.gesture === 'wave' && this._gestureCooldown <= 0) {
      this._gestureCooldown = 2.5;
      this.mr.gesture = null;
      this.onAction('wave');
    }

    this.state.throttle = clamp(throttle, -1, 1);
    this.state.roll = clamp(roll, -1, 1);
    this.state.pitch = clamp(pitch, -1, 1);
    this.state.yaw = clamp(yaw, -1, 1);
    this.state.used = used;
    this.state.lookX = this._mouseLook.x;
    this.state.lookY = this._mouseLook.y;
    this.state.lookDX = this._mouseLook.dx;
    this.state.lookDY = this._mouseLook.dy;
    this._mouseLook.dx = 0;
    this._mouseLook.dy = 0;
    return this.state;
  }

  setPreset(name) { if (PRESETS[name]) this.preset = name; }
  get presets() { return PRESETS; }
}

/** Aplica un quaternion {x,y,z,w} a un vector. */
function applyQuat(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}
