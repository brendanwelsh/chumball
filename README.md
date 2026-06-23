# CHUMBALL

> **Shark soccer in 3D space — Rocket-League-style.** Fly a low-poly shark through a volumetric space
> arena (full 6-axis flight: yaw / pitch / roll) and rocket-boost a bloody soccer ball — the
> **CHUMBALL** — into the opponent's goal, versus an AI bot shark. Full controller support.

![CHUMBALL — bot-vs-bot demo](chumball.gif)

## Controls

Plug in a **DualSense / standard gamepad** (it's first-class), or play with **mouse + keyboard**.

### 🎮 Controller (Rocket-League layout)

| Input | Action |
|---|---|
| **R2 / L2** | Throttle / brake-reverse |
| **R1** | Boost (supersonic) |
| **Cross (✕)** | Jump → press again for double-jump, or **+ stick = directional dodge-flip** |
| **L1** | Powerslide (drift — loosens grip) |
| **Square / Circle** | Air roll left / right |
| **Triangle** | Ball-cam toggle |
| **Left stick** | Steer (pitch + yaw) |
| **Right stick** | Air roll / free look |

### ⌨️ Mouse + keyboard

| Input | Action |
|---|---|
| **Mouse** | Steer (pitch + yaw) — up = climb |
| **W / S** | Throttle / reverse (auto-cruise otherwise) |
| **Shift / Click** | Boost |
| **Space** | Jump → again for double-jump / dodge |
| **Q / E** | Air roll left / right · **Ctrl** drift |
| **C** | Ball-cam |

You're **blue**. Smash the **CHUMBALL** into the **orange goal**; defend your **blue goal** from the
orange bot. Two-minute match, sudden-death overtime if tied, rematch on the end screen. **WATCH DEMO**
on the start screen runs an attract mode: two AI sharks play each other (blue vs orange).

## Run it

Three.js is vendored as an ES module (no CDN, no build step), so it **must be served over http** —
ES modules are blocked on `file://`. From this folder:

```sh
python -m http.server 8000
# then open http://localhost:8000/   (this game's fixed port; dualstick-rhythm uses 8001)
```

The start screen surfaces any boot/load error (with a "serve over http" tip) instead of a blank canvas.

## How it works

- **Player = a sculpted 3D shark** — a revolved torpedo body with countershading, dorsal/pectoral/pelvic
  fins, gills, eyes and a swaying crescent tail. It banks, pitches and rolls with your controls.
- **Flight feel** — quaternion orientation; momentum you redirect with grip (and lose with the L1 drift);
  an RL-style throttle curve; finite boost; a two-stage jump → dodge-flip; directional air roll.
- **Ball physics** — impulses from shark impacts, wall bounces, drag, zero-g float; rectangular goals at
  ±Z (orange = enemy net you attack, blue = your net you defend).
- **Bot AI** — leads the ball, drops back to intercept/defend its goal, circles behind, then charges
  through the ball into the net with boost. **Demo mode** drives *both* sharks with this AI.
- All feel knobs live in `CFG` at the top of `game.js` — the single place to tune.

URL hooks for QA: `#play` auto-launches a match, `#demo` auto-launches bot-v-bot, `#capture` does a
deterministic-seeded demo (used to record the GIF).

## Files

- `index.html` — shell, HUD, start/over screens, boot-error surfacing
- `game.js` — the whole game (flight, ball physics, bot AI, demo mode, match logic)
- `style.css` — HUD + overlay styling
- `vendor/three.module.js` — vendored Three.js (WebGL)
- `chumball.gif` — recorded bot-v-bot demo

## Credits

The shark mascot's lineage is the **chumthewaters** ASCII shark, adapted from **"Ascii Shark"** by
**Kitty (`meowinglion`)** — [Wallpaper Engine Workshop #3606705311](https://steamcommunity.com/sharedfiles/filedetails/?id=3606705311).
The credit is shown on the start screen.
