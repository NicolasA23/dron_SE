/**
 * Menus y pantallas (portada, misiones, controles, ajustes, pausa, resultado).
 */
import { MISSIONS } from '../game/Missions.js';
import { Settings } from '../core/Settings.js';
import { VIEWS } from '../core/Engine.js';
import { PRESETS, axisLabels, keyName } from '../core/Input.js';

const $ = (id) => document.getElementById(id);

export class Menu {
  constructor(handlers = {}) {
    this.h = handlers;
    this.settings = handlers.settings;
    this.screens = {};
    document.querySelectorAll('.screen').forEach((s) => { this.screens[s.id] = s; });
    this._bind();
  }

  show(id) {
    Object.values(this.screens).forEach((s) => s.classList.remove('active'));
    if (id && this.screens['screen-' + id]) this.screens['screen-' + id].classList.add('active');
  }

  hide() { Object.values(this.screens).forEach((s) => s.classList.remove('active')); }

  get current() {
    const k = Object.keys(this.screens).find((k) => this.screens[k].classList.contains('active'));
    return k ? k.replace('screen-', '') : null;
  }

  _bind() {
    $('btn-play').onclick = () => this.h.onPlay?.('tutorial');
    $('btn-missions').onclick = () => { this.buildMissions(); this.show('missions'); };
    $('btn-help').onclick = () => { this.buildHelp(); this.show('help'); };
    $('btn-settings').onclick = () => { this.buildSettings(); this.show('settings'); };
    $('btn-ar').onclick = () => this.h.onStartAR?.();

    document.querySelectorAll('[data-back]').forEach((b) => { b.onclick = () => this.show('start'); });

    $('btn-resume').onclick = () => this.h.onResume?.();
    $('btn-restart').onclick = () => this.h.onRestart?.();
    $('btn-abort').onclick = () => this.h.onAbort?.();
    $('btn-again').onclick = () => this.h.onResultAgain?.();
    $('btn-next').onclick = () => this.h.onResultNext?.();
    $('btn-tomenu').onclick = () => this.h.onResultMenu?.();

    $('btn-nocam-ok').onclick = () => this.h.onNoCamOk?.();
    $('btn-nocam-retry').onclick = () => this.h.onNoCamRetry?.();
  }

  /* ------------------------------ misiones ------------------------------ */
  buildMissions() {
    const wrap = $('mission-list');
    wrap.innerHTML = '';
    for (const m of MISSIONS) {
      const card = document.createElement('button');
      card.className = 'card';
      const h3 = document.createElement('h3');
      h3.textContent = `${m.icon}  ${m.name}`;
      const p = document.createElement('p');
      p.textContent = m.desc;
      const tags = document.createElement('div');
      tags.className = 'tags';
      for (const t of m.tags) {
        const s = document.createElement('span');
        s.className = 'tag ' + (m.tagClass || '');
        s.textContent = t;
        tags.appendChild(s);
      }
      card.append(h3, p, tags);
      const best = this.h.getBest?.(m.id);
      if (best != null) {
        const b = document.createElement('div');
        b.className = 'best';
        b.textContent = `RECORD ${best}`;
        card.appendChild(b);
      }
      card.onclick = () => this.h.onPlay?.(m.id);
      wrap.appendChild(card);
    }
  }

  /* ------------------------------ controles ------------------------------ */
  buildHelp() {
    const wrap = $('help-grid');
    wrap.innerHTML = '';
    const P = PRESETS[this.settings.get('controlPreset')] || PRESETS.rc2;
    const L = axisLabels(P);
    // axisLabels devuelve [positivo, negativo]
    const pair = (a) => `${keyName(a[0])} / ${keyName(a[1])}`;

    const blocks = [
      {
        t: 'VUELO \u00b7 ' + P.name,
        items: [
          ['Acelerador (subir / bajar)', pair(L.throttle)],
          ['Giro (derecha / izquierda)', pair(L.yaw)],
          ['Cabeceo (adelante / atras)', pair(L.pitch)],
          ['Alabeo (derecha / izquierda)', pair(L.roll)],
        ],
      },
      {
        t: 'ACCIONES',
        items: [
          ['Despegar / aterrizar', 'T o Espacio'],
          ['Foto', 'F'],
          ['Luces', 'L'],
          ['Cambiar camara', 'C o 1-4'],
          ['Volver a casa', 'H'],
          ['Giratorio (bajar / subir)', 'G'],
          ['Pausa', 'Esc'],
          ['Reiniciar mision', 'R'],
        ],
      },
      {
        t: 'MANDO / TACTIL',
        items: [
          ['Stick izquierdo', 'acelerador + giro'],
          ['Stick derecho', 'cabeceo + alabeo'],
          ['Gamepad', 'sticks + A/B/X/Y'],
          ['Raton (arrastrar)', 'mirar alrededor'],
        ],
      },
      {
        t: 'VOZ Y GESTOS',
        items: [
          ['"despegar" / "aterrizar"', 'voz'],
          ['"subir" / "bajar"', 'voz'],
          ['"foto" / "luces" / "casa"', 'voz'],
          ['Saludar a la camara', 'gesto'],
        ],
      },
      {
        t: 'REALIDAD MIXTA',
        items: [
          ['Camara trasera', 'mundo real'],
          ['Giroscopio', 'anclar el mundo'],
          ['WebXR AR', 'modo inmersivo'],
        ],
      },
    ];

    for (const b of blocks) {
      const box = document.createElement('div');
      box.className = 'help-box';
      const h4 = document.createElement('h4');
      h4.textContent = b.t;
      box.appendChild(h4);
      const ul = document.createElement('ul');
      for (const [k, v] of b.items) {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = k;
        const kbd = document.createElement('kbd');
        kbd.textContent = v;
        li.append(span, kbd);
        ul.appendChild(li);
      }
      box.appendChild(ul);
      wrap.appendChild(box);
    }
  }

  /* ------------------------------ ajustes ------------------------------ */
  buildSettings() {
    const wrap = $('settings-grid');
    wrap.innerHTML = '';
    for (const def of Settings.schema()) {
      const row = document.createElement('div');
      row.className = 'setrow';
      const lab = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = def.label;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = def.desc;
      lab.append(name, desc);

      let ctrl;
      if (def.type === 'bool') {
        ctrl = document.createElement('span');
        ctrl.className = 'switch';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!this.settings.get(def.key);
        cb.onchange = () => {
          this.settings.set(def.key, cb.checked);
          this.h.onSetting?.(def.key, cb.checked);
        };
        const i = document.createElement('i');
        ctrl.append(cb, i);
      } else if (def.type === 'select') {
        ctrl = document.createElement('select');
        for (const [v, t] of def.options) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          if (this.settings.get(def.key) === v) o.selected = true;
          ctrl.appendChild(o);
        }
        ctrl.onchange = () => {
          this.settings.set(def.key, ctrl.value);
          this.h.onSetting?.(def.key, ctrl.value);
        };
      }
      row.append(lab, ctrl);
      wrap.appendChild(row);
    }

    // restablecer
    const row = document.createElement('div');
    row.className = 'setrow';
    const lab = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = 'Restablecer ajustes';
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = 'Vuelve a los valores por defecto.';
    lab.append(name, desc);
    const btn = document.createElement('button');
    btn.className = 'btn ghost';
    btn.textContent = 'RESET';
    btn.onclick = () => {
      this.settings.reset();
      this.buildSettings();
      this.h.onSetting?.('reset', null);
    };
    row.append(lab, btn);
    wrap.appendChild(row);
  }

  /* ------------------------------ resultado ------------------------------ */
  showResult({ success, title, detail, grade, score, hasNext }) {
    $('result-title').textContent = title || (success ? 'MISION COMPLETADA' : 'MISION FALLIDA');
    $('result-detail').textContent = detail || '';
    const g = $('result-grade');
    g.textContent = grade;
    g.style.color = success ? 'var(--acc)' : 'var(--bad)';
    $('btn-next').style.display = hasNext ? '' : 'none';
    this.show('result');
  }

  showARButton(on) { $('btn-ar').classList.toggle('hidden', !on); }

  setBoot(pct, msg) {
    $('boot-bar').style.width = pct + '%';
    if (msg) $('boot-msg').textContent = msg;
  }
}

export { VIEWS };
