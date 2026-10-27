# 🛸 DRON SE · Juego de Realidad Mixta

Juego interactivo de **realidad mixta (MR)** del dron del plano adjunto
(`assets/vista_general_2.webp`). El dron se modela en 3D de forma procedural
replicando el plano técnico y se vuela **sobre la imagen real de tu cámara**,
dentro de un **entorno generado por ordenador** que reacciona al viento, al
clima, a la hora del día y a la presencia del jugador.

```
┌─────────────────────────── capas del juego ───────────────────────────┐
│  4 · MENUS Y HUD      (misiones, ajustes, telemetría, avisos)         │
│  3 · ESCENA 3D        (dron, mundo generado, cielo, partículas)       │
│  2 · VÍDEO REAL       (passthrough de la cámara = "mundo real")       │
│  1 · ADAPTACIÓN       (brillo/color/movimiento de la habitación)      │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Puesta en marcha

```bash
npm start              # sirve el juego en http://localhost:8080
```

o, si prefieres Python:

```bash
python3 -m http.server 8080
```

Abre la URL en el navegador. **Para el modo realidad mixta necesitas HTTPS o
`localhost`** (el navegador solo permite la cámara en contextos seguros). En un
móvil, abre la IP de tu equipo en la misma Wi-Fi y acepta el permiso de cámara.

| Script | Qué hace |
|---|---|
| `npm start` | Servidor estático (sin dependencias) |
| `npm test` | 56 pruebas de física/mundo + 52 de integración del juego |

No hay `npm install`: **three.js está vendorizado** en `vendor/three/`, todo lo
demás (texturas, sonidos, modelos) se genera en tiempo de ejecución.

---

## 🎮 Cómo se juega

1. **Portada → JUGAR** (o *MISIONes* para elegir).
2. Pulsa **T** (o el botón `DESPEGAR`) para armar los motores.
3. El acelerador está **centrado en el vuelo estacionario**: subir = stick
   arriba, bajar = stick abajo. Suelta y el dron se mantiene.
4. Inclínate para avanzar; aterriza en la plataforma azul (`BASE`) para
   completar la misión.

### Controles

| Acción | Teclado (RC Modo 2) | Mando / táctil |
|---|---|---|
| Acelerador (subir/bajar) | `W` / `S` | Stick izq. ↑↓ |
| Giro (yaw) | `A` / `D` | Stick izq. ←→ |
| Cabeceo (adelante/atrás) | `↑` / `↓` | Stick der. ↑↓ |
| Alabeo (izq/der) | `←` / `→` | Stick der. ←→ |
| Despegar / aterrizar | `T` o `Espacio` | Botón `DESPEGAR` |
| Foto | `F` | Botón `FOTO` |
| Luces | `L` | Botón `LUCES` |
| Cambiar cámara | `C` o `1`–`4` | Botón `VISTA` |
| Volver a casa (piloto auto) | `H` | Botón `BASE` |
| Giratorio (bajar/subir cable) | `G` | — |
| Pausa | `Esc` | Botón `PAUSA` |

Perfiles alternativos de teclado (`Gamer`, `Arcade`) en **Ajustes → Perfil de
control**. También funciona con **gamepad** (sticks + A/B/X/Y).

### Vistas

1. **FPV** — cámara de a bordo del dron.
2. **Persecución** — cámara que sigue al dron.
3. **Operador (MR)** — *tu* punto de vista dentro de la habitación; arrastra
   para mirar alrededor mientras el dron vuela.
4. **Cinemática** — órbita automática.

---

## 🧩 Misiones

| Misión | Entorno | Objetivo |
|---|---|---|
| **Primer vuelo** | Galpón | Despegar, 3 puertas, aterrizar en base |
| **Entrega de suministros** | Ciudad | Recoger y entregar 3 paquetes a baja altura |
| **Rescate con giratorio** | Valle | Bajar el gancho, subir 3 heridos y volver |
| **Reconocimiento** | Ciudad | Fotografiar 5 puntos a contrarreloj |
| **Vuelo libre** | Valle | Sandbox sin objetivos |

Cada misión **genera un mundo nuevo con semilla aleatoria**: distinta
distribución de estanterías, edificios, colinas, puertas y obstáculos. Se
guardan récords por misión en `localStorage`.

---

## 🔁 Cómo responde el juego

### A la interacción humana

* **Mando híbrido**: teclado, gamepad, joysticks táctiles, giroscopio del móvil
  y ratón; todos se combilan en un único vector de mando.
* **Voz** (Web Speech, `es-ES`): *"despegar"*, *"aterrizar"*, *"subir"*,
  *"bajar"*, *"izquierda"*, *"derecha"*, *"adelante"*, *"foto"*, *"luces"*,
  *"casa"*, *"para"*.
* **Gestos**: saluda a la cámara y el dron te devuelve el saludo parpadeando
  sus luces (detección de oscilación del centro de masa del movimiento).
* **Háptica**: vibración en impactos y al enganchar carga (móvil).
* **Piloto automoático**: `H` ordena al dron regresar y aterrizar solo; se
  activa por sí mismo si la batería baja del 6 %.

### Al entorno generado

* **Viento** procedural con rafagas periódicas, cizallamiento con la altura y
  turbulencia: empuja al dron, hace girar más rápido los aerogeneradores,
  agita banderas y árboles, y desplaza la lluvia y los globos.
* **Clima** (calma / nubes / lluvia / tormenta) que cambia la niebla, la
  intensidad del sol y la dificultad de vuelo.
* **Ciclo día/noche** real: el sol y la luna se mueven, el cielo cambia de
  color, aparecen estrellas y las farolas se encienden.
* **Obstáculos y puertas**: colisiones con rebote, daño estructural,
  desequilibrio de motores y sacudida de cámara; las puertas se iluminan al
  pasarlas.
* **Vida propia**: pájaros que huyen del dron, coches que se detienen si
  vuelas sobre ellos, paquetes que se enganchan bajo el dron.

### Al entorno real (la habitación)

* **Passthrough**: el vídeo de la cámara es el fondo; el suelo virtual se
  vuelve semi-transparente y el dron proyecta una **sombra de contacto** sobre
  el suelo real para anclarlo visualmente.
* **Adaptación de brillo**: se mide la luminancia media del vídeo y se ajusta
  la exposición del render; si la habitación está oscura, el dron enciende su
  faro.
* **Adaptación cromática**: la rejilla holográfica toma el tono de color
  (cálido/frío) de la imagen real.
* **Detección de presencia**: el movimiento en la sala activa avisos en el HUD.
* **Giroscopio**: en el móvil, el mundo virtual queda anclado a la orientación
  del teléfono (o se vuela inclinando el aparato).
* **WebXR**: si el navegador soporta `immersive-ar`, aparece el botón
  **MODO AR (WebXR)** para una sesión inmersiva con passthrough nativo.

---

## 🏗️ Arquitectura

```
index.html                 estructura + importmap de three.js
server.js                  servidor estático sin dependencias
src/
  main.js                  arranque, ajustes iniciales, eventos globales
  core/
    Engine.js              renderer three.js + rig de 4 cámaras
    MRCamera.js            passthrough, análisis del vídeo, giroscopio, WebXR
    Input.js               teclado, gamepad, joysticks, giro, ratón, voz
    Audio.js               rotor/viento/avisos 100% procedurales (WebAudio)
    Settings.js            ajustes persistentes + esquema de la UI
    Utils.js               matemáticas, ruido, texturas y sprites por canvas
  world/
    Drone.js               modelo 3D del plano + física de cuadricoptero
    World.js               biomas procedurales y objetos reactivos
    Sky.js                 sol, luna, estrellas, nubes, lluvia, niebla
    Wind.js                campo de viento con rafagas
  game/
    Game.js                orquestador, bucle, respuestas al entorno
    Missions.js            las 5 misiones y su puntuación
  ui/
    HUD.js                 telemetría, objetivos, minimapa, rosa de vientos
    Menu.js                portada, misiones, controles, ajustes, resultado
    styles.css             HUD y menús
test/                      pruebas sin navegador (Node + DOM simulado)
vendor/three/              three.js r166 (MIT)
assets/                    plano técnico original del dron
```

### El modelo del dron

Se construye por código a partir del plano adjunto, sin ficheros externos:

* cuerpo octogonal achaflanado con lomo, visor y franja naranja;
* 4 brazos en X con pods de motor cápsula y hélices de 2 palas;
* tren de aterrizaje de 4 patas y 2 patines con puntas levantadas;
* cámara estabilizada de 2 ejes con anillo naranja y lente física;
* luces de navegación (roja/verda/blanca intermitente) y faro orientable.

### La física

Cuadricoptero simplificado pero creíble: empuje a lo largo del *up* del cuerpo
con efecto suelo, control de actitud por **par PD sobre un quaternion
objetivo**, resistencia aerodinámica cuadrática, campo de viento, batería,
daño estructural, desequilibrio de motores y vibración. Se integra a pasos
fijos de 1/120 s.

---

## 🧪 Pruebas

```bash
npm test
```

* `test/smoke.mjs` — 56 comprobaciones de física (despegue, cabeceo, alabeo,
  guiñada, viento, colisiones, aterrizaje, batería), generación de los tres
  biomas, cielo, viento y las cinco misiones.
* `test/game-test.mjs` — 52 comprobaciones de integración: arranca el juego
  real (con `WebGLRenderer` sustituido por un doble), ejecuta el bucle de
  fotogramas, los menús, las acciones del HUD, las direcciones de cada tecla,
  el piloto automático, el ciclo completo de una misión y el modo MR con
  cámara simulada.

Para depurar desde la consola del navegador: `window.dronSE`.

---

## ⌨️ Notas

* La cámara solo funciona en **HTTPS o localhost**. Si la rechazas, el juego
  continúa en **modo virtual completo** (cielo, suelo y entorno generados).
* En iOS, el giroscopio y el reconocimiento de voz requieren un toque previo
  para conceder el permiso.
* Rendimiento: en *Ajustes → Calidad gráfica* puedes bajar sombras y
  resolución si va justo.

## 📄 Licencia

Código del juego: MIT. three.js: MIT (`vendor/three/LICENSE`).
