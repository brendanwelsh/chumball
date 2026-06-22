# sharkthewaters

> **Shark soccer in 3D space.** Fly the chumthewaters **ASCII shark** through a volumetric space arena
> and rocket-boost a giant ball into the goal, versus an AI bot shark. Full 3D flight — no flat plane.

## Controls

| Input | Action |
|---|---|
| **Move the mouse** | Fly — full 3D: bank left/right, climb/dive |
| **Hold click / Space / Shift** | Rocket **boost** (drains, then regenerates) |
| **C** | Toggle ball-cam |

Smash the **ball** into the **cyan goal**; defend your **red goal** from the bot shark. Two-minute
match, sudden-death overtime if tied, rematch on the end screen.

## Run it

Three.js is vendored as an ES module (no CDN, no build step), so it **must be served over http** —
ES modules are blocked on `file://`. From this folder:

```sh
python -m http.server
# then open http://localhost:8000/
```

The start screen surfaces any boot/load error (with a "serve over http" tip) instead of a blank canvas.

## How it works

- **Player = the ASCII shark** — drawn to a canvas-texture billboard; the swim frame is chosen from
  `shark-frames.js` by the shark's screen-space heading.
- **Full 3D flight** — mouse offset from center steers yaw + pitch; cruise speed with a drain/regen
  boost. Chase camera with a ball-cam toggle.
- **Ball physics** — impulses from shark impacts, wall bounces, drag, zero-g float; goals are rings at
  ±Z (cyan = attack, red = defend).
- **Bot** — seeks the spot behind the ball relative to your goal and rams it.
- Tuning knobs live in `CFG` at the top of `game.js`.

## Files

- `index.html` — shell, HUD, start/over screens, boot-error surfacing
- `game.js` — the whole game (flight, ball physics, bot, match logic)
- `shark-frames.js` — ASCII shark frame data (shared with the `chumthewaters` mascot page)
- `style.css` — HUD + overlay styling
- `vendor/three.module.js` — vendored Three.js (WebGL)

## Related

- **[chumthewaters](https://github.com/brendanwelsh/chumthewaters)** — the static ASCII-shark mascot
  page these frames come from.

## Credits

ASCII frames adapted from **"Ascii Shark"** by **Kitty (`meowinglion`)** — [Wallpaper Engine Workshop
#3606705311](https://steamcommunity.com/sharedfiles/filedetails/?id=3606705311). The credit is shown on
the start screen.
