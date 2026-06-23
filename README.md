# CHUMBALL

> **Shark soccer in 3D space — Rocket-League-style.** Fly a low-poly **3D shark** through a volumetric
> space arena (full 6-axis flight — yaw / pitch / roll, not a flat plane) and rocket-boost a bloody
> soccer ball — the **CHUMBALL** — into the opponent's goal, versus an AI bot shark. Runs in any
> browser, **full controller support**, no install, no build step.

<p align="center">
  <a href="https://brendanwelsh.github.io/chumball/"><b>▶&nbsp; Play it live</b></a>
  &nbsp;·&nbsp; gamepad or mouse&nbsp;+&nbsp;keyboard &nbsp;·&nbsp; click to start
</p>

<p align="center">
  <img src="chumball.gif" width="860" alt="Bot-vs-bot demo — two sharks boost-tussle the CHUMBALL into the goal in a neon space arena">
</p>

<p align="center"><sub>Attract mode: two AI sharks (<b>blue</b> vs <b>orange</b>) scrap over the CHUMBALL at the goal mouth. Hit <b>WATCH&nbsp;DEMO</b> on the start screen — or just <a href="https://brendanwelsh.github.io/chumball/">play it</a>.</sub></p>

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/images/duel.png" alt="Both sharks boosting into the ball right at the goal mouth"><br><b>50/50 at the mouth</b> — both sharks boost the ball at the net, flames lit</td>
    <td width="50%" align="center"><img src="docs/images/boost.png" alt="The blue shark banking in on the ball with boost while orange drops back to defend"><br><b>Supersonic approach</b> — bank in on the ball; the bot drops back to defend</td>
  </tr>
</table>

---

## What it is

A browser game that plays **Rocket League with sharks, in space**. You pilot a sculpted 3D shark with
real momentum and a two-stage jump → dodge-flip; the **CHUMBALL** is a giant, bloody, gravity-bound
soccer ball. Drive on the floor like a car, then **jump, boost and air-roll** for full 3D aerials, and
smash the ball into the orange net while defending your blue one. There's a 2-minute clock,
sudden-death overtime, a competent AI opponent, and a bot-vs-bot attract mode. It's one file of game
code on vendored **Three.js** — no framework, no bundler, served as plain static files.

---

## How it plays

- **You are a sculpted 3D shark.** A revolved torpedo body with **countershading** (pale belly → dark
  team-tinted back), dorsal / pectoral / pelvic fins, five gill slits a side, eyes, a swaying crescent
  **caudal tail**, and a boost jet out the back. It banks, pitches and rolls with your inputs via a
  quaternion — no gimbal lock, full 6-axis.

- **Ground vs air — like Rocket League.** On the floor you're **on the wheels**: the stick **steers**
  (yaw about world-up), grip pulls your velocity onto your nose, and **powerslide** loosens it so you
  drift. Jump and you're **airborne**: full local-axis **pitch / yaw / roll**, momentum + gravity +
  boost, **free air-roll** (hold powerslide → stick X becomes roll) and **directional air-roll**
  (Square / Circle). Land and the shark re-levels onto its wheels. The HUD shows **GROUND / AIR** so
  you always know which control set you're in.

- **Flight feel.** An RL-style throttle accel curve, a **finite boost** tank (~3s, slow passive regen
  so you're never bone-dry), a supersonic top-speed cap, and a two-stage **jump → double-jump /
  directional dodge-flip** with a real dodge window. Every feel knob lives in one `CFG` block at the
  top of `game.js`.

- **Ball & goals.** The CHUMBALL has gravity, drag and zero-g float; it **bounces** off the walls, roof
  and floor, settles and rolls, and takes an impulse from every shark impact scaled by your speed.
  Rectangular goals sit on the floor at **±Z** — **orange** is the enemy net you attack, **blue** is
  the net you defend. Score, run the clock, win — or go to **sudden-death OT** if it's tied.

- **The bot.** It leads the ball, drops back to **intercept and defend** its net, **circles behind**
  to line up a shot, then **charges through** the ball into the goal with boost. **Demo mode** drives
  *both* sharks with the same AI for the attract-mode reel above.

---

## Controls

Plug in a **DualSense / standard gamepad** (first-class), or play with **mouse + keyboard**. Because
controls change between **GROUND** and **AIR** (shown on the HUD), each input below lists both.

### 🎮 Controller (Rocket-League layout)

| Input | Action |
|---|---|
| **R2 / L2** | Throttle / brake-reverse |
| **R1** | Boost (supersonic) |
| **Cross (✕)** | Jump → press again for double-jump, or **+ stick = directional dodge-flip** |
| **Left stick** | **Ground:** steer · **Air:** pitch + yaw (air-steer) |
| **L1** | **Ground:** powerslide (drift — loosens grip) · **Air:** free air-roll (hold → stick X = roll) |
| **Square / Circle** | Directional air-roll left / right (constant roll; stick still pitches/yaws) |
| **Triangle** | Ball-cam toggle |

### ⌨️ Mouse + keyboard

| Input | Action |
|---|---|
| **Mouse** | **Ground:** steer · **Air:** pitch + yaw — up = nose up · **A / D** also steer |
| **W / S** | Throttle / reverse (auto-cruise otherwise) |
| **Shift / Click** | Boost |
| **Space** | Jump → again for double-jump / dodge |
| **Ctrl** | **Ground:** powerslide · **Air:** free air-roll (hold → mouse X = roll) |
| **Q / E** | Directional air-roll left / right |
| **C** | Ball-cam |

You're **blue**. Smash the **CHUMBALL** into the **orange goal**; defend your **blue goal** from the
orange bot. Two-minute match, sudden-death overtime if tied, rematch on the end screen.

---

## Play it

**Easiest:** open **[brendanwelsh.github.io/chumball](https://brendanwelsh.github.io/chumball/)** — it's
deployed on GitHub Pages, nothing to install.

**Locally** (for hacking on it): Three.js is vendored as an ES module (no CDN, no build step), so it
**must be served over http** — ES modules are blocked on `file://`. From this folder:

```sh
python -m http.server 8009
# then open http://localhost:8009/   (this game's fixed port; chumstick-rhythm holds 8000 on this PC)
```

The start screen surfaces any boot/load error (with a "serve over http" tip) instead of a blank canvas.
URL hooks for QA: `#play` auto-launches a match, `#demo` runs bot-vs-bot, `#capture` does a
deterministic-seeded demo (used to record the GIF above).

---

## Layout

One file of game code; everything tunable lives in `CFG` at the top of it.

```
index.html              shell, HUD, start / game-over screens, boot-error surfacing
game.js                 the whole game — shark model, flight, ball physics, bot AI, demo, match logic
style.css               HUD + overlay styling (neon-on-space-black)
vendor/three.module.js  vendored Three.js (WebGL) — loaded via an importmap, no CDN
chumball.gif            the recorded bot-vs-bot demo above
docs/images/            still captures for this README
```

---

## More from the author

Other browser toys & shark things by [@brendanwelsh](https://github.com/brendanwelsh):

- **[chumthesizer](https://github.com/brendanwelsh/chumthesizer)** — an OP-1-inspired **groovebox** you
  play with a Magic Trackpad, a dial and a foot pedal; a faint ASCII shark cruises the surface.
- **[chumstick-rhythm](https://github.com/brendanwelsh/chumstick-rhythm)** — a **dual-analog-stick
  rhythm game** for the DualSense; same "plays great with a controller in the browser" DNA.
- **[chumthewaters](https://github.com/brendanwelsh/chumthewaters)** — the original **ASCII shark**
  page this whole mascot universe swims out of.
- **[ballshark](https://github.com/brendanwelsh/ballshark)** — a self-hosted **Rocket League stats
  tracker** (the other half of the shark-meets-Rocket-League idea).

---

## Credits

The shark mascot's lineage is the **chumthewaters** ASCII shark, adapted from **"Ascii Shark"** by
**Kitty (`meowinglion`)** — [Wallpaper Engine Workshop #3606705311](https://steamcommunity.com/sharedfiles/filedetails/?id=3606705311).
The credit is shown on the start screen. Built on **[Three.js](https://threejs.org)** (vendored).
