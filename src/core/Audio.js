/**
 * Audio 100% procedural (WebAudio): no necesita ficheros de sonido.
 *   · rotor: ruido filtrado + tono cuya frecuencia sigue las RPM
 *   · viento: ruido de banda ancha cuya ganancia sigue la velocidad aire
 *   · avisos: pitidos, impacto, bateria baja, motor arrancando
 */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.master = null;
    this.rotorGain = null;
    this.windGain = null;
    this.rotorOscGain = null;
    this._windFilter = null;
    this._lastBeep = 0;
  }

  /** Debe llamarse desde un gesto del usuario. */
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const c = new AC();
    this.ctx = c;

    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(c.destination);

    // --- rotor: ruido de banda + tono ---
    const noise = this._noiseSource(2.5);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.8;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.rotorGain = c.createGain(); this.rotorGain.gain.value = 0;
    noise.connect(bp); bp.connect(lp); lp.connect(this.rotorGain); this.rotorGain.connect(this.master);

    this.rotorOsc = c.createOscillator();
    this.rotorOsc.type = 'sawtooth';
    this.rotorOsc.frequency.value = 90;
    this.rotorOscGain = c.createGain(); this.rotorOscGain.gain.value = 0;
    this.rotorOsc.connect(this.rotorOscGain);
    this.rotorOscGain.connect(this.master);
    this.rotorOsc.start();

    // --- viento ---
    const wnoise = this._noiseSource(2.5);
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass'; wf.frequency.value = 700; wf.Q.value = 0.4;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    wnoise.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.master);
    this._windFilter = wf;

    this.ready = true;
    return true;
  }

  _noiseSource(seconds) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.start();
    return src;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.value = v ? 0.9 : 0;
  }

  /** Actualiza el sonido continuo segun el estado del dron. */
  update(dt, s) {
    if (!this.ready || !this.enabled) return;
    const r = clamp01((s.rpmAvg || 0) / 11000);
    const t = this.ctx.currentTime;
    const target = s.flying && !s.crashed
      ? 0.10 + r * 0.34 + Math.abs(s.throttle) * 0.10
      : (s.crashed ? 0 : 0.02);
    this.rotorGain.gain.setTargetAtTime(target, t, 0.12);
    this.rotorOsc.frequency.setTargetAtTime(70 + r * 230, t, 0.10);
    this.rotorOscGain.gain.setTargetAtTime(s.flying ? 0.05 + r * 0.13 : 0, t, 0.15);

    const w = clamp01((s.airspeed || 0) / 22) * (s.flying ? 1 : 0.35);
    this.windGain.gain.setTargetAtTime(w * 0.30, t, 0.25);
    this._windFilter.frequency.setTargetAtTime(500 + w * 1600, t, 0.3);

    if (s.battery < 18 && !s.crashed && t - this._lastBeep > 1.1) {
      this._lastBeep = t;
      this.beep(880, 0.09, 0.10);
    }
  }

  /** Pitido corto. */
  beep(freq = 660, dur = 0.1, vol = 0.14, type = 'square') {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Secuencia de pitidos (exito / fallo). */
  melody(notes = [660, 880, 1180], step = 0.11, vol = 0.13) {
    notes.forEach((f, i) => setTimeout(() => this.beep(f, 0.13, vol, 'triangle'), i * step * 1000));
  }

  /** Ruido de impacto. */
  crash(intensity = 1) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const len = Math.floor(c.sampleRate * 0.55);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const k = 1 - i / len;
      d[i] = (Math.random() * 2 - 1) * k * k;
    }
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = c.createGain(); g.gain.value = clamp01(intensity) * 0.6;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    this.beep(120, 0.35, 0.20, 'sawtooth');
  }

  /** Sonido de obturador. */
  shutter() {
    this.beep(1600, 0.04, 0.10, 'square');
    setTimeout(() => this.beep(1100, 0.05, 0.08, 'square'), 70);
  }

  /** Sonido de motor arrancando. */
  spinUp() {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.8);
  }
}
