// CHUMBALL — 3D SPACE ROCKET BLOOD-BALL SHARK SOCCER  (Rocket-League-style)
// Fly a low-poly 3D shark through a volumetric space arena (full 6-axis flight: yaw/pitch/roll)
// and rocket-boost a giant ball into the opponent goal. Shark soccer vs an AI bot.
//
// Controls are modelled on Rocket League's aerial car control + a pro DualSense layout.
// Gamepad (DualSense/standard) is first-class; mouse+keyboard is a full fallback.
// three.js is vendored (./vendor/three.module.js); the player shark is a real Three.js mesh.
//
// ASCII-shark provenance (chumthewaters mascot): "Ascii Shark" by Kitty (meowinglion),
// Wallpaper Engine Workshop #3606705311 — credited on the start screen. (No longer rendered;
// the player is now a 3D model, but the lineage stays.)

import * as THREE from "three";

/* ============================================================ CONFIG (the one place to tune FEEL) */
const CFG = {
  /* arena (half-extents; long along Z, goals at ±Z) — roomy so play isn't cramped */
  AX: 235, AY: 120, AZ: 390,       // bigger, flatter, more RL-proportioned arena (half-extents)
  goalW: 66, goalH: 46,            // goal-mouth half width/height (rectangular, RL-style)

  /* shark */
  sharkLen: 22, sharkHitR: 13,

  /* ---- flight feel (Rocket-League-ish, units/s) — slower & more controllable ---- */
  maxSpeed: 92,                    // top speed on throttle alone
  boostSpeed: 168,                 // "supersonic" cap while/after boosting
  throttleAccel: 150,              // forward accel from R2 (tapers toward maxSpeed; see stepPlayer)
  reverseAccel: 75,                // accel from L2 (reverse)
  brakeDrag: 2.2,                  // extra drag while L2 held (braking)
  drag: 0.5,                       // passive space drag (coasting slowdown)
  grip: 6.5,                       // how hard velocity follows the nose (arcade steer)
  driftGrip: 1.3,                  // grip while powersliding (L1) — lets you drift/strafe

  /* ground driving — RL "on the wheels": the stick STEERS (yaw about world-up); powerslide loosens grip to drift */
  groundTurn: 2.7,                 // steer rate (rad/s) at speed
  slideTurnMul: 1.6,               // powerslide whips the nose around faster
  angResp: 9,                      // how fast steer-rate eases in
  maxBank: 0.6,                    // cosmetic lean into a turn (rad)

  /* air control — RL aerial: full LOCAL-axis pitch/yaw/roll. Hold powerslide = free air-roll (stick X -> roll);
     Square/Circle (Q/E) = directional air-roll (constant roll while the stick still pitches/yaws). */
  airPitchRate: 2.6, airYawRate: 2.4, airRollRate: 3.4,
  airResp: 7.5,                    // how fast air angular velocity eases in
  sharkGravity: 150,               // falls back to the floor (a touch < ball gravity = forgiving aerials)
  airDrag: 0.25,                   // mild air resistance
  invertPitch: false,              // false = stick/mouse up = nose UP

  /* boost (energy 0..1) */
  boostAccel: 250,
  boostDrain: 1 / 3.0,             // full tank lasts ~3s of boost
  boostRegen: 1 / 7.5,            // slow passive regen so you're never fully dry

  /* jump → double-jump / dodge-flip (Cross) — two-stage, like Rocket League */
  jumpImpulse: 74,                 // first jump: pop along +up
  jumpFwd: 12,                     // small forward nudge on the first jump
  doubleJumpImpulse: 100,          // second press + neutral stick -> double jump
  dodgeImpulse: 132, dodgeDur: 0.6,// second press + held stick -> directional flip (+ speed)
  dodgeWindow: 1.25,               // window after a jump to chain a dodge / double-jump
  dodgeDead: 0.25,                 // stick magnitude separating dodge (held) from double-jump (neutral)
  jumpCD: 0.45,                    // recharge before you can jump again
  dodgeCD: 0.9,                    // recharge after a committed dodge

  /* input shaping */
  deadzone: 0.08, expo: 1.35, sens: 1.15, mouseSens: 1.0,
  autoCruise: 0.6,                 // mouse/kb auto-throttle when no W/S held (keeps mouse players moving)

  /* camera */
  camBack: 66, camUp: 26, lookAhead: 80, camStiff: 9, fov: 74, fovBoost: 84,

  /* ball physics — Rocket-League-style: gravity, ground bounce + roll */
  ballR: 18, ballDrag: 0.30, restit: 0.72, ballMax: 210,
  gravity: 168,                    // downward accel (units/s^2) — ball falls/arcs/bounces
  ballGroundFriction: 0.55,        // rolling resistance while on the floor
  hitBase: 108, hitTransfer: 0.9,

  /* bot AI (leads the ball, defends + clears + charges) — paced to the slower game */
  botSpeed: 92, botBoostSpeed: 156, botAccel: 3.3,
  botLead: 0.42,                   // how far ahead it leads the ball
  botBoostDist: 120,               // boost when farther than this from target

  /* match */
  tailBeat: 9, matchTime: 120, goalPause: 2.2,
};

/* ============================================================ DOM + early wiring */
const $ = (id) => document.getElementById(id);
const elScene = $("scene"), elHud = $("hud"), elStart = $("start"), elOver = $("over");
const elYou = $("youScore"), elBot = $("botScore"), elClock = $("clock"), elBoost = $("boostFill");
const elBanner = $("goalBanner"), elBannerTxt = $("goalText"), elCam = $("camState"), elPad = $("padState");
const elSpeed = $("speedTag"), elBoostBar = $("boostBar"), elMove = $("moveState");

let booted = false;
$("startBtn").addEventListener("click", () => booted && startMatch());
$("againBtn").addEventListener("click", () => booted && startMatch());
const _demoBtn = $("demoBtn"); if (_demoBtn) _demoBtn.addEventListener("click", () => booted && startDemo());

/* ============================================================ BOOT (guarded) */
let renderer, scene, camera, ball, ballLight, you, bot;
const clock = new THREE.Clock();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const LX = new THREE.Vector3(1, 0, 0), LY = new THREE.Vector3(0, 1, 0), LZ = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();    // scratch for arcade orientation (declared early: boot() runs before the temps block)

// #capture: deterministic seed so the starfield/ball texture don't flicker across screenshot frames (GIF capture)
if (location.hash === "#capture") {
  let _s = 1337 >>> 0;
  Math.random = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
}

try {
  boot();
  booted = true;
  renderer.setAnimationLoop(frame);
} catch (err) {
  if (window.__sharkErr) window.__sharkErr(err.message || String(err));
  throw err;
}
// dev/QA: #play auto-launches a match, #demo auto-launches bot-v-bot (deferred past module eval to avoid TDZ)
if (booted && location.hash === "#play") setTimeout(startMatch, 0);
if (booted && (location.hash === "#demo" || location.hash === "#capture")) setTimeout(startDemo, 0);

function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // filmic tonemap: rolls off the neon highlights so colours read clean instead of blowing out to white
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  elScene.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030c);
  scene.fog = new THREE.FogExp2(0x05071a, 0.0010);

  camera = new THREE.PerspectiveCamera(CFG.fov, window.innerWidth / window.innerHeight, 0.5, 6000);
  camera.position.set(0, 80, -CFG.AZ - 220);
  camera.lookAt(0, 0, 0);

  // sky/ground fill (hemisphere) gives the sharks clean, even shading instead of a flat ambient wash
  scene.add(new THREE.HemisphereLight(0x7f9cff, 0x0a1426, 0.7));
  scene.add(new THREE.AmbientLight(0x5a78ff, 0.32));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(120, 260, 140); scene.add(key);
  const rim = new THREE.DirectionalLight(0x55ffe0, 0.6); rim.position.set(-180, -80, -160); scene.add(rim);

  buildStars();
  buildArena();
  buildDust();

  // CHUMBALL — a red, bloody soccer ball
  ball = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(CFG.ballR, 36, 26),
      new THREE.MeshStandardMaterial({ map: makeChumballTexture(), color: 0xff6a6a, emissive: 0x4a0008, emissiveIntensity: 0.7, roughness: 0.42, metalness: 0.05 })
    ),
  };
  // dark crimson panel seams so it reads as a ball + spins legibly (subtle — not a wireframe cage)
  ball.mesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(CFG.ballR * 1.012, 1)),
    new THREE.LineBasicMaterial({ color: 0x2a0004, transparent: true, opacity: 0.35 })
  ));
  scene.add(ball.mesh);
  ballLight = new THREE.PointLight(0xff3344, 1.6, 700, 2); scene.add(ballLight);

  // sharks
  you = makeShark(0x3aa0ff, 0x1f6fff);   // team BLUE (you)
  bot = makeShark(0xff9436, 0xff5e00);   // team ORANGE (bot)
  scene.add(you.mesh, bot.mesh);

  // input
  addEventListener("resize", onResize);
  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("pointerdown", (e) => { if (state === "demo") { exitDemo(); return; } if (e.button === 0) input.mouseDown = true; usingPad = false; });
  addEventListener("pointerup", () => { input.mouseDown = false; });
  addEventListener("keydown", onKeyDown);
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
  addEventListener("gamepadconnected", (e) => { usingPad = true; setPadState(e.gamepad); });
  addEventListener("gamepaddisconnected", () => { usingPad = false; setPadState(null); });

  resetEntities();
}

/* ============================================================ WORLD BUILDERS */
function buildStars() {
  // two layers: a dense fine field + a sparse layer of brighter "near" stars — reads cleaner than one chunky size
  const layer = (N, size, opacity, color) => {
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 1700 + Math.random() * 2000;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity, fog: false })));
  };
  layer(1500, 3.2, 0.8, 0xbfd4ff);   // fine dust of distant stars
  layer(220, 6.5, 0.95, 0xeaf2ff);   // a few brighter foreground stars
}

function buildDust() {
  const N = 240, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * CFG.AX;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * CFG.AY;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * CFG.AZ;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x4ad6e0, size: 2.0, sizeAttenuation: true, transparent: true, opacity: 0.3 })));
}

function buildArena() {
  const { AX, AY, AZ } = CFG;
  const r = Math.min(AX, AZ) * 0.30;            // big RL-style rounded corners

  // a rounded-rectangle FILL shape (arena footprint), in the X/Z plane
  const roundedShape = (hx, hz, rad) => {
    const sh = new THREE.Shape();
    sh.moveTo(-hx + rad, -hz);
    sh.lineTo(hx - rad, -hz);  sh.quadraticCurveTo(hx, -hz, hx, -hz + rad);
    sh.lineTo(hx, hz - rad);   sh.quadraticCurveTo(hx, hz, hx - rad, hz);
    sh.lineTo(-hx + rad, hz);  sh.quadraticCurveTo(-hx, hz, -hx, hz - rad);
    sh.lineTo(-hx, -hz + rad); sh.quadraticCurveTo(-hx, -hz, -hx + rad, -hz);
    return sh;
  };
  // a rounded-rectangle OUTLINE as (x,z) points for wireframe loops / struts
  const roundedOutline = (hx, hz, rad, seg = 6) => {
    const pts = [], corners = [
      [hx - rad, hz - rad, 0], [-hx + rad, hz - rad, Math.PI / 2],
      [-hx + rad, -hz + rad, Math.PI], [hx - rad, -hz + rad, -Math.PI / 2],
    ];
    for (const [cx, cz, a0] of corners)
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        pts.push(new THREE.Vector2(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad));
      }
    return pts;
  };
  const flatShape = (hx, hz, rad, y, mat) => {
    const g = new THREE.ShapeGeometry(roundedShape(hx, hz, rad)); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat); m.position.y = y; scene.add(m); return m;
  };

  // --- the GROUND: a solid rounded pitch the ball rests/rolls/bounces on (clearly reads as the floor) ---
  flatShape(AX, AZ, r, -AY, new THREE.MeshStandardMaterial({
    color: 0x0a1c33, emissive: 0x06162b, emissiveIntensity: 0.55, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
  }));
  const grid = new THREE.GridHelper(AZ * 2, 30, 0x3f86c0, 0x16384a);
  grid.scale.x = AX / AZ; grid.position.y = -AY + 0.4;
  grid.material.transparent = true; grid.material.opacity = 0.26; scene.add(grid);

  // --- the ROOF: matching rounded ceiling so the arena reads as an enclosed box (ball bounces off it) ---
  flatShape(AX, AZ, r, AY, new THREE.MeshStandardMaterial({
    color: 0x0a1626, emissive: 0x0a1830, emissiveIntensity: 0.22, roughness: 1.0,
    transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
  }));

  // --- rounded "cage": floor + roof outline loops joined by vertical struts (sells the rounded edges) ---
  const outline = roundedOutline(AX, AZ, r, 6);
  const loop = (y, mat) => scene.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(outline.map((p) => new THREE.Vector3(p.x, y, p.y))), mat));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x2f7fa8, transparent: true, opacity: 0.6 });
  loop(-AY, edgeMat); loop(AY, edgeMat);
  const strutMat = new THREE.LineBasicMaterial({ color: 0x2f7fa8, transparent: true, opacity: 0.3 });
  for (let i = 0; i < outline.length; i += 2) {
    const p = outline[i];
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(p.x, -AY, p.y), new THREE.Vector3(p.x, AY, p.y)]), strutMat));
  }

  // --- faint side walls so a ball bounce reads as hitting a surface (physics is still an AABB box) ---
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x1f6f8f, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(AZ * 2, AY * 2), wallMat);
    m.position.set(sx * AX, 0, 0); m.rotation.y = Math.PI / 2; scene.add(m);
  }

  // --- floor markings: centre circle + halfway line (spatial read / orientation) ---
  const fy = -AY + 0.6;
  const markMat = new THREE.LineBasicMaterial({ color: 0x6fb8e8, transparent: true, opacity: 0.5 });
  const circ = new THREE.EllipseCurve(0, 0, AX * 0.32, AX * 0.32, 0, Math.PI * 2);
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    circ.getPoints(72).map((p) => new THREE.Vector3(p.x, fy, p.y))), markMat));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(-AX + r * 0.4, fy, 0), new THREE.Vector3(AX - r * 0.4, fy, 0)]), markMat));

  // goals: ORANGE at +Z (enemy goal — you attack), BLUE at -Z (your goal — you defend); they sit ON the floor.
  // Each end gets a team-coloured tint + goal box so you always know which way you're facing.
  const GY = -AY + CFG.goalH;
  endZone(AZ, 0xff9436); endZone(-AZ, 0x3aa0ff);
  addGoal(AZ, 0xff9436); addGoal(-AZ, 0x3aa0ff);

  function endZone(z, color) {
    const sz = Math.sign(z);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(AX * 1.4, 160),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    patch.rotation.x = -Math.PI / 2; patch.position.set(0, fy - 0.1, z - sz * 80); scene.add(patch);
    const gw = CFG.goalW * 1.7, gd = 130;
    const box = [[-gw, z], [-gw, z - sz * gd], [gw, z - sz * gd], [gw, z]].map(([x, zz]) => new THREE.Vector3(x, fy, zz));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(box),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })));
  }

  function addGoal(z, color) {
    const { goalW, goalH } = CFG;
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(goalW * 2, goalH * 2),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
    );
    back.position.set(0, GY, z + Math.sign(z) * 6);
    scene.add(back);

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(goalW * 2, goalH * 2, 10)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    frame.position.set(0, GY, z + Math.sign(z) * 3);
    scene.add(frame);

    // glowing posts for a "goal mouth" read (mounted on the floor)
    const postMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, goalH * 2, 10), postMat);
      post.position.set(sx * goalW, GY, z); scene.add(post);
    }
    for (const sy of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, goalW * 2, 10), postMat);
      bar.rotation.z = Math.PI / 2; bar.position.set(0, GY + sy * goalH, z); scene.add(bar);
    }
    const glow = new THREE.PointLight(color, 1.1, 560, 2); glow.position.set(0, GY, z * 0.9); scene.add(glow);
  }
}

/* ============================================================ CHUMBALL TEXTURE
   Procedural "bloody soccer ball": crimson base + dark soccer-style pentagon spots + blood splatter. */
function makeChumballTexture() {
  const S = 512, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const c = cv.getContext("2d");

  // base radial crimson
  const g = c.createRadialGradient(S * 0.4, S * 0.35, 20, S * 0.5, S * 0.5, S * 0.7);
  g.addColorStop(0, "#d4233a"); g.addColorStop(0.55, "#9c0f22"); g.addColorStop(1, "#5e0512");
  c.fillStyle = g; c.fillRect(0, 0, S, S);

  // dark soccer-ball pentagon spots
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 24 + Math.random() * 30, rot = Math.random() * Math.PI;
    c.fillStyle = i % 4 === 0 ? "#11000a" : "#3a0410";
    c.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = rot + k * (Math.PI * 2 / 5);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      k ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.closePath(); c.fill();
  }

  // blood splatter: dark droplets + a few drip streaks
  for (let i = 0; i < 70; i++) {
    c.fillStyle = `rgba(${30 + Math.random() * 40},0,${6 + Math.random() * 10},${0.5 + Math.random() * 0.4})`;
    c.beginPath(); c.arc(Math.random() * S, Math.random() * S, 1.5 + Math.random() * 6, 0, Math.PI * 2); c.fill();
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    c.strokeStyle = "rgba(40,0,6,0.5)"; c.lineWidth = 1 + Math.random() * 3;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 40, y + 20 + Math.random() * 70); c.stroke();
  }

  // bright wet highlight
  const h = c.createRadialGradient(S * 0.36, S * 0.3, 4, S * 0.36, S * 0.3, 90);
  h.addColorStop(0, "rgba(255,170,170,0.6)"); h.addColorStop(1, "rgba(255,170,170,0)");
  c.fillStyle = h; c.beginPath(); c.arc(S * 0.36, S * 0.3, 90, 0, Math.PI * 2); c.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/* ============================================================ LOW-POLY 3D SHARK */
function tri(a, b, c, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
// A flat fin in the x=0 plane from an ordered [z,y] outline (triangle-fan). Lets fins have a clean
// curved trailing edge with a few verts instead of one crude triangle. Double-sided material handles winding.
function fin(outlineZY, mat) {
  const v = [];
  for (let i = 1; i < outlineZY.length - 1; i++) {
    v.push(0, outlineZY[0][1], outlineZY[0][0]);
    v.push(0, outlineZY[i][1], outlineZY[i][0]);
    v.push(0, outlineZY[i + 1][1], outlineZY[i + 1][0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// Builds a sculpted shark (smooth lathe body, countershaded, with fins/gills/tail/eyes). Nose = +Z.
function makeShark(teamHex, emissiveHex) {
  const g = new THREE.Group();
  const back = new THREE.Color(teamHex).lerp(new THREE.Color(0x46555f), 0.5);   // team-tinted dark topside
  const belly = new THREE.Color(0xeef3f5);                                       // pale underside
  const finCol = new THREE.Color(teamHex).lerp(new THREE.Color(0x3c4a54), 0.55);

  // --- body: revolve a tail→nose radius profile into a smooth torpedo ---
  const prof = [
    [-14, 0.0], [-13, 1.0], [-11, 1.5], [-8, 2.4], [-4, 3.7], [0, 4.6],
    [4, 4.4], [8, 3.5], [11, 2.5], [13, 1.5], [14.4, 0.7], [15, 0.16],
  ].map(([y, r]) => new THREE.Vector2(Math.max(r, 0.001), y));
  const bodyGeo = new THREE.LatheGeometry(prof, 48);   // more segments = smoother torpedo, no facets
  bodyGeo.rotateX(Math.PI / 2);          // long axis +Y -> +Z (nose forward)
  bodyGeo.scale(0.96, 1.06, 1);          // slight lateral compression
  // countershading: vertex colours from pale belly to dark back by height
  bodyGeo.computeBoundingBox();
  const yMin = bodyGeo.boundingBox.min.y, yr = (bodyGeo.boundingBox.max.y - yMin) || 1;
  const p = bodyGeo.attributes.position, cols = [], cc = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let t = THREE.MathUtils.clamp(((p.getY(i) - yMin) / yr - 0.32) / 0.5, 0, 1);
    t = t * t * (3 - 2 * t);             // smoothstep
    cc.copy(belly).lerp(back, t); cols.push(cc.r, cc.g, cc.b);
  }
  bodyGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  g.add(new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, emissive: emissiveHex, emissiveIntensity: 0.12 })));

  // --- fins (flat, double-sided) ---
  const finMat = new THREE.MeshStandardMaterial({ color: finCol, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, emissive: emissiveHex, emissiveIntensity: 0.18 });
  // dorsal (iconic): swept-back blade with a concave trailing edge — reads as a proper shark fin
  g.add(fin([[3.6, 4.0], [-1.6, 11.0], [-3.4, 7.6], [-4.7, 5.0], [-4.4, 4.0]], finMat));
  g.add(tri([0, 2.2, -8.6], [0, 2.2, -10.8], [0, 4.4, -10.2], finMat));          // small second dorsal
  for (const sx of [-1, 1]) {
    g.add(tri([sx * 2.8, -1.4, 4.2], [sx * 2.2, -2.2, 0.5], [sx * 11.5, -5.6, -1.5], finMat)); // pectorals
    g.add(tri([sx * 1.8, -2.6, -5.5], [sx * 1.4, -2.8, -8.0], [sx * 5.0, -4.6, -8.5], finMat)); // pelvic
  }

  // --- gills (5 dark slits per side) ---
  const gillMat = new THREE.MeshStandardMaterial({ color: 0x1a2730, roughness: 0.6 });
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.4, 0.45), gillMat);
    slit.position.set(sx * 3.8, 0.3, 7.6 - i * 0.85); slit.rotation.z = sx * 0.25; g.add(slit);
  }

  // --- eyes + mouth ---
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x05080b, roughness: 0.25, metalness: 0.3 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 10), eyeMat);
    eye.position.set(sx * 2.6, 1.3, 11.3); g.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.5, 1.6), new THREE.MeshStandardMaterial({ color: 0x12060a, roughness: 0.5 }));
  mouth.position.set(0, -1.9, 11.6); mouth.rotation.x = 0.5; g.add(mouth);

  // --- caudal (tail) fin on a pivot so it can sway: heterocercal, large upper lobe ---
  const tail = new THREE.Group(); tail.position.set(0, 0, -13.0);
  tail.add(fin([[0, 0.6], [-6.8, 9.6], [-8.4, 6.0], [-9.2, 2.0]], finMat));      // upper lobe (large crescent)
  tail.add(fin([[0, -0.6], [-5.6, -5.2], [-8.2, -0.6]], finMat));                // lower lobe (small)
  g.add(tail);

  // --- boost flame: a soft twin-cone jet (translucent outer + bright core) instead of one long streak ---
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(2.6, 8.5, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: emissiveHex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 5.4, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(emissiveHex).lerp(new THREE.Color(0xffffff), 0.6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  for (const m of [outer, core]) { m.rotation.x = -Math.PI / 2; flame.add(m); }
  flame.position.set(0, 0, -15.0); flame.visible = false; g.add(flame);

  g.scale.setScalar(CFG.sharkLen / 16);

  return {
    mesh: g, tail, flame,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    forward: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0),
    wp: 0, wy: 0, wr: 0,                  // eased angular rates (pitch/yaw/roll)
    yawA: 0, peA: 0, bank: 0,             // ground orientation: heading, (level) pitch, cosmetic bank
    grounded: true,                       // RL state: on the wheels (simple steering) vs airborne (full aerial)
    speed: 0, boostE: 1, hitCD: 0,
    dodging: false, dodgeT: 0, jumped: false, jumpTimer: 0, jumpCD: 0,
    flipAxis: new THREE.Vector3(), flipSign: 1,
    ballCam: false, camSide: 1,       // default = fixed chase cam locked behind the shark (Triangle/C toggles ball-cam)
  };
}

function deriveAxes(s) {
  s.forward.copy(LZ).applyQuaternion(s.quat);
  s.up.copy(LY).applyQuaternion(s.quat);
  s.right.copy(LX).applyQuaternion(s.quat);
}

// GROUND orientation from heading(yaw) + cosmetic bank (pitch is pinned level on the wheels).
// Order YXZ => yaw is about WORLD up, so steering always turns you horizontally. Air control mutates the quat directly.
function buildPlayerQuat(s) { _euler.set(s.peA, s.yawA, s.bank, "YXZ"); s.quat.setFromEuler(_euler); }
// Point a grounded shark's nose at a world point (level heading only). Self-contained: safe at boot.
function faceTarget(s, target) {
  const dir = new THREE.Vector3().copy(target).sub(s.pos);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  s.yawA = Math.atan2(dir.x, dir.z);
  s.peA = 0; s.bank = 0; s.wp = s.wy = s.wr = 0;
  buildPlayerQuat(s); deriveAxes(s);
}

/* ============================================================ STATE */
let state = "menu";          // menu | playing | goal | over
let scores = { you: 0, bot: 0 };
let timeLeft = CFG.matchTime, suddenDeath = false, goalTimer = 0, menuT = 0, swimPhase = 0;
let pendingEnd = false;

const _f = new THREE.Vector3(), _d = new THREE.Vector3(), _tmp = new THREE.Vector3(), _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const camLook = new THREE.Vector3();

function resetEntities() {
  // ball at the centre kickoff spot, on the ground
  ball.pos.set(0, -CFG.AY + CFG.ballR, 0); ball.vel.set(0, 0, 0);

  // RL-style kickoff: both sharks sit ON the floor, angled-off in opposite corners with the nose on the ball,
  // so neither can shove it straight in. YOU start on your half; the bot starts FURTHER back so it can't insta-tap.
  const groundY = -CFG.AY + CFG.sharkHitR;
  you.pos.set(-CFG.AX * 0.5, groundY, -CFG.AZ * 0.5); you.vel.set(0, 0, 0);
  you.grounded = true; you.speed = 0; you.boostE = 1; you.hitCD = 0;
  you.dodging = false; you.dodgeT = 0; you.jumped = false; you.jumpTimer = 0; you.jumpCD = 0;
  faceTarget(you, ball.pos);                                         // angled approach: nose on the ball

  bot.pos.set(CFG.AX * 0.5, groundY, CFG.AZ * 0.8); bot.vel.set(0, 0, 0);
  bot.quat.identity(); bot.forward.set(0, 0, -1); bot.hitCD = 0; bot.boostE = 1;
}

function startMatch() {
  scores.you = 0; scores.bot = 0; timeLeft = CFG.matchTime; suddenDeath = false;
  resetEntities();
  you.ballCam = false; you.camSide = 1;
  state = "playing";
  // snap camera behind player
  _tmp.copy(you.pos).addScaledVector(you.forward, -CFG.camBack).addScaledVector(WORLD_UP, CFG.camUp);
  camera.position.copy(_tmp);
  camLook.copy(you.pos).addScaledVector(you.forward, CFG.lookAhead);
  elStart.classList.add("hidden"); elOver.classList.add("hidden"); elHud.classList.remove("hidden");
  updateCamState(); updateHud();
}

function kickoff() { resetEntities(); }

/* ---- demo / attract mode: two AI sharks play each other (cyan attacks +Z, red attacks -Z) ---- */
let demoT = 0, demoGoalTimer = 0;
function demoKick() {            // pop the ball off the ground toward a goal so the demo stays lively
  const a = Math.random() * Math.PI * 2, zf = Math.random() < 0.5 ? 1 : -1;
  ball.vel.set(Math.cos(a) * 45, 70 + Math.random() * 45, zf * 115);
}
function startDemo() {
  scores.you = 0; scores.bot = 0; suddenDeath = false;
  resetEntities(); demoKick();
  state = "demo"; demoT = 0; demoGoalTimer = 0;
  // snap the cam behind the blue shark so it starts framed (don't wait for the lerp)
  _v.copy(you.pos).addScaledVector(you.forward, -CFG.camBack * 1.25).addScaledVector(WORLD_UP, CFG.camUp * 1.35);
  camera.position.copy(_v); camLook.copy(you.pos).addScaledVector(you.forward, CFG.lookAhead); camera.up.copy(WORLD_UP); camera.lookAt(camLook);
  elStart.classList.add("hidden"); elOver.classList.add("hidden"); elHud.classList.remove("hidden");
  if (elCam) elCam.textContent = "DEMO"; if (elPad) elPad.textContent = "BLUE vs ORANGE · click to exit";
  banner("DEMO — BLUE vs ORANGE", "var(--gold)"); setTimeout(hideBanner, 1500);
  updateHud();
}
function exitDemo() {
  state = "menu"; menuT = 0;
  elHud.classList.add("hidden"); elStart.classList.remove("hidden"); hideBanner();
}
function stepDemo(dt) {
  demoT += dt;
  if (demoGoalTimer > 0) { demoGoalTimer -= dt; stepBall(dt); if (demoGoalTimer <= 0) { hideBanner(); resetEntities(); demoKick(); } return; }
  stepAI(you, CFG.AZ, dt); stepAI(bot, -CFG.AZ, dt);
  collideShark(you); collideShark(bot); stepBall(dt);
  const who = demoGoalCheck();
  if (who) { scores[who]++; updateHud(); banner(who === "you" ? "BLUE SCORES" : "ORANGE SCORES", who === "you" ? "var(--blue)" : "var(--orange)"); demoGoalTimer = 1.6; }
}
function demoGoalCheck() {
  const { AZ, AY, ballR, goalW, goalH, restit } = CFG;
  const inGoal = Math.abs(ball.pos.x) < goalW - ballR * 0.25 && ball.pos.y < -AY + 2 * goalH - ballR * 0.25;
  if (ball.pos.z > AZ - ballR) { if (inGoal) return "you"; ball.pos.z = AZ - ballR; ball.vel.z *= -restit; }
  else if (ball.pos.z < -AZ + ballR) { if (inGoal) return "bot"; ball.pos.z = -AZ + ballR; ball.vel.z *= -restit; }
  return null;
}

function scoreGoal(who) {
  scores[who]++;
  updateHud();
  banner(who === "you" ? "GOAL!" : "ORANGE SCORES", who === "you" ? "var(--blue)" : "var(--orange)");
  if (suddenDeath) { goalTimer = 1.6; state = "goal"; pendingEnd = true; return; }
  goalTimer = CFG.goalPause; state = "goal"; pendingEnd = false;
}

function endMatch() {
  state = "over";
  elHud.classList.add("hidden");
  $("finalYou").textContent = scores.you;
  $("finalBot").textContent = scores.bot;
  const win = scores.you > scores.bot;
  $("overTitle").textContent = win ? "YOU WIN" : (scores.you < scores.bot ? "YOU LOSE" : "DRAW");
  $("overTitle").style.color = win ? "var(--blue)" : "var(--orange)";
  $("overMsg").textContent = win ? "The waters have been chummed. 🦈" : "You're gonna need a bigger boat.";
  elOver.classList.remove("hidden");
}

function banner(text, color) {
  elBannerTxt.textContent = text; elBannerTxt.style.color = color;
  elBanner.classList.remove("hidden");
  elBannerTxt.style.animation = "none"; void elBannerTxt.offsetWidth; elBannerTxt.style.animation = "";
}
function hideBanner() { elBanner.classList.add("hidden"); }

function updateHud() {
  elYou.textContent = scores.you; elBot.textContent = scores.bot;
  elClock.textContent = state === "demo" ? "DEMO" : (suddenDeath ? "OT" : fmtTime(Math.max(0, timeLeft)));
  elBoost.style.width = (you.boostE * 100).toFixed(0) + "%";
  if (elSpeed) elSpeed.classList.toggle("hidden", you.speed < CFG.maxSpeed * 0.99);
  if (elMove) elMove.textContent = you.grounded ? "GROUND" : "AIR";
  if (elBoostBar) { elBoostBar.classList.toggle("empty", you.boostE <= 0.02); elBoostBar.classList.toggle("boosting", you.flame.visible); }
}
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + String(s).padStart(2, "0"); }
function updateCamState() { if (elCam) elCam.textContent = you.ballCam ? "BALL-CAM" : "CHASE-CAM"; }
function setPadState(gp) { if (elPad) elPad.textContent = gp ? "🎮 " + (gp.id || "gamepad").slice(0, 18) : ""; }

/* ============================================================ INPUT */
const input = { mx: 0, my: 0, mouseDown: false };
const keys = Object.create(null);
let kbJump = false, kbCam = false;        // one-shot edges
let usingPad = false;
const padPrev = {};                        // for pad button edge detection
// live control snapshot, rebuilt every frame
const ctrl = { sx: 0, sy: 0, throttle: 0, boost: false, powerslide: false, airRollDir: 0, jumpEdge: false };

function onMove(e) {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = (e.clientY / window.innerHeight) * 2 - 1;
  if (Math.abs(nx - input.mx) > 0.002 || Math.abs(ny - input.my) > 0.002) usingPad = false;
  input.mx = nx; input.my = ny;
}
function onKeyDown(e) {
  const k = e.key.toLowerCase();
  if (state === "demo") { exitDemo(); return; }
  keys[k] = true; usingPad = false;
  if (k === " ") { kbJump = true; e.preventDefault(); }
  if (k === "c") kbCam = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
}

function shape(v) {                         // deadzone + expo + sensitivity
  const d = CFG.deadzone, a = Math.abs(v);
  if (a < d) return 0;
  const n = (a - d) / (1 - d);
  return Math.sign(v) * Math.pow(n, CFG.expo) * CFG.sens;
}
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let std = null, any = null;
  for (const p of pads) { if (!p || !p.connected) continue; any = any || p; if (p.mapping === "standard") { std = p; break; } }
  return std || any;
}
const bv = (p, i) => (p.buttons[i] ? p.buttons[i].value : 0);
const bp = (p, i) => !!(p.buttons[i] && p.buttons[i].pressed);
function padEdge(p, i) { const cur = bp(p, i), was = padPrev[i] || false; padPrev[i] = cur; return cur && !was; }

function pollInput() {
  const pad = readPad();
  // detect pad activity -> latch usingPad
  if (pad) {
    const act = Math.abs(pad.axes[0] || 0) > 0.15 || Math.abs(pad.axes[1] || 0) > 0.15 ||
      Math.abs(pad.axes[2] || 0) > 0.15 || bv(pad, 6) > 0.1 || bv(pad, 7) > 0.1 ||
      pad.buttons.some((b) => b && b.pressed);
    if (act) usingPad = true;
    if (!setPadState._set) { setPadState(pad); setPadState._set = true; }
  }

  let sx = 0, sy = 0, throttle = 0, boost = false, powerslide = false, airRollDir = 0, jumpEdge = false;

  if (usingPad && pad) {
    const lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
    sx = shape(lx); sy = -shape(ly);                  // left stick: X = steer/yaw/roll, Y = pitch (up = +)
    throttle = bv(pad, 7) - bv(pad, 6);               // R2 - L2 throttle/brake
    boost = bp(pad, 5);                               // R1 boost
    powerslide = bp(pad, 4);                          // L1: powerslide (ground) + free air-roll (air)
    airRollDir = (bp(pad, 1) ? 1 : 0) - (bp(pad, 2) ? 1 : 0); // Circle = air-roll right, Square = air-roll left
    jumpEdge = padEdge(pad, 0);                       // Cross jump
    if (padEdge(pad, 3)) toggleBallCam();             // Triangle ball-cam
  } else {
    // mouse + keyboard (mouse position acts as a virtual stick; mouseSens replaces stick sens)
    const m = CFG.mouseSens / CFG.sens;
    sx = shape(input.mx) * m; sy = -shape(input.my) * m;   // mouse: X = steer/yaw, Y = pitch (up = nose up)
    const kx = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0) + (keys["arrowright"] ? 1 : 0) - (keys["arrowleft"] ? 1 : 0);
    if (kx) sx = THREE.MathUtils.clamp(kx, -1, 1);        // A/D (or arrows) steer
    const ky = (keys["w"] || keys["arrowup"] ? 1 : 0) - (keys["s"] || keys["arrowdown"] ? 1 : 0);
    throttle = ky !== 0 ? ky : CFG.autoCruise;            // auto-cruise so mouse players always roll forward
    boost = !!keys["shift"] || input.mouseDown;
    powerslide = !!keys["control"] || !!keys["z"];        // Ctrl: powerslide / free air-roll
    airRollDir = (keys["e"] ? 1 : 0) - (keys["q"] ? 1 : 0); // E = air-roll right, Q = air-roll left
    jumpEdge = kbJump;
    if (kbCam) toggleBallCam();
  }
  kbJump = false; kbCam = false;

  ctrl.sx = sx; ctrl.sy = sy;
  ctrl.throttle = THREE.MathUtils.clamp(throttle, -1, 1);
  ctrl.boost = boost; ctrl.powerslide = powerslide; ctrl.airRollDir = airRollDir; ctrl.jumpEdge = jumpEdge;
}
function toggleBallCam() { you.ballCam = !you.ballCam; updateCamState(); }

/* ============================================================ MAIN LOOP */
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  swimPhase += dt * CFG.tailBeat;

  pollInput();

  if (state === "playing") { stepPlayer(dt); stepBot(dt); collideShark(you); collideShark(bot); stepBall(dt); checkGoals(); stepClock(dt); }
  else if (state === "goal") { stepBall(dt); goalTimer -= dt; if (goalTimer <= 0) { hideBanner(); if (pendingEnd) endMatch(); else { kickoff(); state = "playing"; } } }
  else if (state === "demo") stepDemo(dt);
  else if (state === "menu") menuT += dt;

  // ball visuals
  ball.mesh.position.copy(ball.pos); ballLight.position.copy(ball.pos);
  ball.mesh.rotation.y += dt * 0.6; ball.mesh.rotation.x += dt * 0.4;

  updateSharkVisual(you, dt);
  updateSharkVisual(bot, dt);
  bot.mesh.visible = state !== "menu";

  updateCamera(dt);
  camera.updateMatrixWorld();

  if (state === "playing") updateHud();
  renderer.render(scene, camera);
}

/* ============================================================ PLAYER FLIGHT (quaternion, RL-style) */
function stepPlayer(dt) {
  const s = you;
  const groundY = -CFG.AY + CFG.sharkHitR;
  s.jumpCD -= dt;
  if (s.jumpTimer > 0) s.jumpTimer -= dt;

  // --- jump → double-jump / dodge-flip. The FIRST jump must come off the floor (RL). ---
  if (ctrl.jumpEdge && !s.dodging && s.jumpCD <= 0) {
    if (s.grounded) {                                        // 1st jump: leave the ground, open the dodge window
      s.vel.y += CFG.jumpImpulse; s.vel.addScaledVector(s.forward, CFG.jumpFwd);
      s.grounded = false; s.jumped = true; s.jumpTimer = CFG.dodgeWindow;
    } else if (s.jumped && s.jumpTimer > 0) {                // 2nd press in the air
      if (Math.hypot(ctrl.sx, ctrl.sy) < CFG.dodgeDead) {    // neutral -> double jump
        s.vel.y += CFG.doubleJumpImpulse;
        s.jumped = false; s.jumpTimer = 0; s.jumpCD = CFG.jumpCD;
      } else { startDodge(s); s.jumped = false; s.jumpTimer = 0; }  // held -> directional dodge-flip
    }
  }
  if (s.jumped && s.jumpTimer <= 0) { s.jumped = false; s.jumpCD = CFG.jumpCD; }

  /* ===================== ORIENTATION (ground steers, air does full aerial) ===================== */
  if (s.dodging) {
    const spin = (Math.PI * 2) / CFG.dodgeDur;
    _q.setFromAxisAngle(s.flipAxis, s.flipSign * spin * dt); s.quat.premultiply(_q);
    s.dodgeT -= dt;
    if (s.dodgeT <= 0) { s.dodging = false; s.wp = s.wy = s.wr = 0; }   // keep the resulting air orientation
  } else if (s.grounded) {
    // GROUND ("on the wheels"): the stick only STEERS (yaw about world-up). Powerslide whips harder.
    const ke = 1 - Math.exp(-CFG.angResp * dt);
    const speedF = THREE.MathUtils.clamp(s.vel.length() / (CFG.maxSpeed * 0.6), 0.3, 1);  // turn more when moving
    const turn = -ctrl.sx * CFG.groundTurn * speedF * (ctrl.powerslide ? CFG.slideTurnMul : 1);
    s.wy += (turn - s.wy) * ke; s.yawA += s.wy * dt; s.peA = 0;
    const tBank = THREE.MathUtils.clamp(-ctrl.sx, -1, 1) * CFG.maxBank * 0.55;            // lean into the turn
    s.bank += (tBank - s.bank) * ke;
    buildPlayerQuat(s);
  } else {
    // AIR (RL aerial): full LOCAL-axis control. Free air-roll (powerslide held) swaps yaw->roll;
    // directional air-roll (Square/Circle, Q/E) rolls at a constant rate while the stick still pitches/yaws.
    const ke = 1 - Math.exp(-CFG.airResp * dt);
    const pitchIn = (CFG.invertPitch ? ctrl.sy : -ctrl.sy);
    let yawIn = 0, rollIn = ctrl.airRollDir;
    if (ctrl.powerslide) rollIn += ctrl.sx;                  // free air-roll: stick X -> roll (yaw disabled)
    else yawIn = -ctrl.sx;                                   // air-steer: stick X -> yaw
    s.wp += (pitchIn * CFG.airPitchRate - s.wp) * ke;
    s.wy += (yawIn   * CFG.airYawRate   - s.wy) * ke;
    s.wr += (rollIn  * CFG.airRollRate  - s.wr) * ke;
    _q.setFromAxisAngle(LX, s.wp * dt); s.quat.multiply(_q);  // local pitch
    _q.setFromAxisAngle(LY, s.wy * dt); s.quat.multiply(_q);  // local yaw
    _q.setFromAxisAngle(LZ, s.wr * dt); s.quat.multiply(_q);  // local roll
  }
  s.quat.normalize();
  deriveAxes(s);

  /* ===================== TRANSLATION ===================== */
  const boosting = ctrl.boost && s.boostE > 0;
  if (s.grounded) {
    // drive along the floor: throttle accel (RL curve), boost, brake/reverse, grip (powerslide = drift)
    s.vel.y = 0;
    const fwdSpeed = s.vel.dot(s.forward);
    let aF = 0;
    if (ctrl.throttle > 0) aF += ctrl.throttle * CFG.throttleAccel * THREE.MathUtils.clamp(1 - fwdSpeed / CFG.maxSpeed, 0, 1);
    if (boosting) aF += CFG.boostAccel;
    if (aF) s.vel.addScaledVector(s.forward, aF * dt);
    if (ctrl.throttle < 0) {                                 // brake / reverse (L2)
      s.vel.multiplyScalar(1 - CFG.brakeDrag * (-ctrl.throttle) * dt);
      s.vel.addScaledVector(s.forward, ctrl.throttle * CFG.reverseAccel * dt);
    }
    const sp = s.vel.length();                               // grip: velocity follows the nose; powerslide loosens it
    if (sp > 0.001) { _tmp.copy(s.forward).multiplyScalar(sp); s.vel.lerp(_tmp, 1 - Math.exp(-(ctrl.powerslide ? CFG.driftGrip : CFG.grip) * dt)); }
    s.vel.y = 0;
    s.vel.multiplyScalar(1 - CFG.drag * dt);
  } else {
    // airborne: momentum + gravity + boost-along-the-nose (no grip — orientation is everything)
    s.vel.y -= CFG.sharkGravity * dt;
    if (boosting) s.vel.addScaledVector(s.forward, CFG.boostAccel * dt);
    s.vel.multiplyScalar(1 - CFG.airDrag * dt);
  }
  if (s.vel.length() > CFG.boostSpeed) s.vel.setLength(CFG.boostSpeed);

  // boost energy + flame
  s.boostE = THREE.MathUtils.clamp(s.boostE + (boosting ? -CFG.boostDrain : CFG.boostRegen) * dt, 0, 1);
  s.flame.visible = boosting;
  if (boosting) s.flame.scale.setScalar(0.85 + 0.3 * Math.sin(swimPhase * 3));

  s.pos.addScaledVector(s.vel, dt);

  // --- ground contact / landing: snap to the floor and re-level onto the wheels (RL suspension) ---
  if (s.pos.y <= groundY && s.vel.y <= 0.001) {
    s.pos.y = groundY; s.vel.y = 0;
    if (!s.grounded) {                                       // just touched down
      s.grounded = true; s.dodging = false; s.jumped = false; s.jumpTimer = 0;
      deriveAxes(s);
      s.yawA = Math.atan2(s.forward.x, s.forward.z); s.peA = 0; s.bank = 0;
      s.wp = s.wy = s.wr = 0; buildPlayerQuat(s); deriveAxes(s);
    }
  } else if (s.pos.y > groundY + 0.5) {
    s.grounded = false;
  }
  clampToArena(s);
  s.speed = s.vel.length();
}

function startDodge(s) {
  let dvx = ctrl.sx, dvy = ctrl.sy;
  const mag = Math.hypot(dvx, dvy);
  if (mag < 0.25) {
    // neutral: a forward "jump" pop with a small front-flip
    _v.copy(s.forward).addScaledVector(s.up, 0.35).normalize();
    s.vel.addScaledVector(_v, CFG.jumpImpulse);
    s.flipAxis.copy(s.right); s.flipSign = -1;
  } else {
    dvx /= mag; dvy /= mag;
    _v.copy(s.right).multiplyScalar(dvx).addScaledVector(s.forward, dvy).normalize();
    s.vel.addScaledVector(_v, CFG.dodgeImpulse);
    if (Math.abs(dvy) >= Math.abs(dvx)) { s.flipAxis.copy(s.right); s.flipSign = dvy > 0 ? -1 : 1; }   // fwd/back -> pitch flip
    else { s.flipAxis.copy(s.forward); s.flipSign = dvx > 0 ? 1 : -1; }                                 // side -> barrel roll
  }
  if (s.vel.length() > CFG.boostSpeed) s.vel.setLength(CFG.boostSpeed);
  s.dodging = true; s.dodgeT = CFG.dodgeDur; s.jumpCD = CFG.dodgeCD;
}

/* ============================================================ SHARK AI (generic, drives bot + demo)
   atkZ = Z-plane of the goal this shark attacks; it defends -atkZ. Roles: intercept (race goal-side),
   clear (hit it away), line-up (circle behind the ball), charge (drive through into the goal). */
function stepAI(s, atkZ, dt) {
  const ownZ = -atkZ, od = Math.sign(ownZ) || 1;

  const pb = _v.copy(ball.pos).addScaledVector(ball.vel, CFG.botLead);     // predicted ball
  _d.set(0, 0, atkZ).sub(pb); if (_d.lengthSq() < 1) _d.set(0, 0, -od); _d.normalize(); // ball -> attack goal

  const toBall = _tmp.copy(pb).sub(s.pos);
  const distBall = toBall.length();
  const goalSide = (s.pos.z - pb.z) * od > 4;                     // between ball and own goal
  const threat = pb.z * od > CFG.AZ * 0.12 && ball.vel.z * od > -10; // ball on own half, not racing away

  let wantBoost = false;
  const target = _f;
  if (threat && !goalSide) {
    target.set(0, 0, ownZ).lerp(pb, 0.45); wantBoost = true;             // race to intercept
  } else if (threat && goalSide) {
    target.copy(pb); wantBoost = distBall > 36;                          // clear it
  } else {
    const behind = toBall.dot(_d) > 0;                                   // ball between us and attack goal
    if (behind && distBall < 95) { target.copy(pb).addScaledVector(_d, 55); wantBoost = true; }   // charge through
    else { target.copy(pb).addScaledVector(_d, -(CFG.ballR + CFG.sharkHitR + 12)); wantBoost = distBall > CFG.botBoostDist; } // circle behind
  }

  _tmp.copy(target).sub(s.pos);
  const dist = _tmp.length() || 1; _tmp.multiplyScalar(1 / dist);
  _tmp.multiplyScalar(wantBoost ? CFG.botBoostSpeed : CFG.botSpeed);
  s.vel.lerp(_tmp, 1 - Math.exp(-CFG.botAccel * dt));
  if (s.vel.length() > CFG.botBoostSpeed) s.vel.setLength(CFG.botBoostSpeed);
  s.pos.addScaledVector(s.vel, dt);
  clampToArena(s);

  if (s.vel.lengthSq() > 1) s.forward.copy(s.vel).normalize();
  s.speed = s.vel.length();
  s.flame.visible = wantBoost;
  if (wantBoost) s.flame.scale.setScalar(0.85 + 0.25 * Math.sin(swimPhase * 3 + s.pos.x));
}
function stepBot(dt) { stepAI(bot, -CFG.AZ, dt); }

/* ============================================================ COLLISIONS / BALL */
function collideShark(s) {
  if (s.hitCD > 0) s.hitCD -= 1 / 60;
  _d.copy(ball.pos).sub(s.pos);
  const dist = _d.length(), min = CFG.ballR + CFG.sharkHitR;
  if (dist < min && s.hitCD <= 0) {
    _d.multiplyScalar(1 / (dist || 1));
    const power = CFG.hitBase + Math.max(0, s.vel.length()) * CFG.hitTransfer;
    ball.vel.addScaledVector(_d, power).addScaledVector(s.vel, 0.28);
    if (ball.vel.length() > CFG.ballMax) ball.vel.setLength(CFG.ballMax);
    ball.pos.copy(s.pos).addScaledVector(_d, min + 0.5);
    s.hitCD = 0.1;
    s.vel.addScaledVector(_d, -power * 0.03);          // tiny recoil
  }
}

function stepBall(dt) {
  ball.vel.y -= CFG.gravity * dt;                                   // gravity
  ball.vel.multiplyScalar(Math.max(0, 1 - CFG.ballDrag * dt));      // air drag
  ball.pos.addScaledVector(ball.vel, dt);
  const { AX, AY, ballR, restit } = CFG;
  if (ball.pos.x > AX - ballR) { ball.pos.x = AX - ballR; ball.vel.x *= -restit; }
  if (ball.pos.x < -AX + ballR) { ball.pos.x = -AX + ballR; ball.vel.x *= -restit; }
  if (ball.pos.y > AY - ballR) { ball.pos.y = AY - ballR; ball.vel.y *= -restit; }   // ceiling
  const floorY = -AY + ballR;
  if (ball.pos.y < floorY) {                                        // ground: bounce, settle, roll
    ball.pos.y = floorY;
    if (ball.vel.y < 0) ball.vel.y *= -restit;
    if (Math.abs(ball.vel.y) < 14) ball.vel.y = 0;                  // settle so it rests
    const roll = Math.max(0, 1 - CFG.ballGroundFriction * dt);
    ball.vel.x *= roll; ball.vel.z *= roll;
  }
  // Z walls handled in checkGoals (goal opening vs solid wall)
}

function checkGoals() {
  const { AZ, AY, ballR, goalW, goalH, restit } = CFG;
  // goal mouth sits on the floor: from y = -AY up to y = -AY + 2*goalH
  const inGoal = Math.abs(ball.pos.x) < goalW - ballR * 0.25 && ball.pos.y < -AY + 2 * goalH - ballR * 0.25;
  if (ball.pos.z > AZ - ballR) {
    if (inGoal) { scoreGoal("you"); return; }
    ball.pos.z = AZ - ballR; ball.vel.z *= -restit;
  } else if (ball.pos.z < -AZ + ballR) {
    if (inGoal) { scoreGoal("bot"); return; }
    ball.pos.z = -AZ + ballR; ball.vel.z *= -restit;
  }
}

function stepClock(dt) {
  if (suddenDeath) return;
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    if (scores.you === scores.bot) { suddenDeath = true; banner("SUDDEN DEATH", "var(--gold)"); setTimeout(hideBanner, 1600); }
    else endMatch();
  }
}

function clampToArena(s) {
  const { AX, AY, AZ, sharkHitR: r } = CFG;
  s.pos.x = THREE.MathUtils.clamp(s.pos.x, -AX + r, AX - r);
  s.pos.y = THREE.MathUtils.clamp(s.pos.y, -AY + r, AY - r);
  s.pos.z = THREE.MathUtils.clamp(s.pos.z, -AZ + r, AZ - r);
}

/* ============================================================ VISUALS / CAMERA */
function updateSharkVisual(s, dt) {
  s.mesh.position.copy(s.pos);
  if (s === you && state !== "demo") {
    s.mesh.quaternion.copy(s.quat);                 // player: full 3D orientation from controls
  } else {
    // AI sharks (bot, or both in demo): face velocity (nose +Z) with world up
    _tmp.copy(s.pos).add(s.forward);
    s.mesh.up.copy(WORLD_UP); s.mesh.lookAt(_tmp);   // nose (+Z) faces travel; lookAt already orients +Z at the target (no flip)
  }
  // tail sway + speed-scaled beat
  const beat = Math.sin(swimPhase + (s === bot ? 1.7 : 0)) * (0.32 + Math.min(0.25, s.speed / CFG.boostSpeed * 0.4));
  s.tail.rotation.y = beat;
}

function updateCamera(dt) {
  if (state === "menu") {
    const r = CFG.AZ + 280, a = menuT * 0.18;
    camera.position.set(Math.sin(a) * r, 95 + Math.sin(menuT * 0.5) * 32, Math.cos(a) * r);
    camera.lookAt(0, 0, 0);
    return;
  }

  if (state === "demo") {
    // demo cam: a fixed chase cam locked BEHIND the blue shark, looking where its nose points
    _v.copy(you.pos).addScaledVector(you.forward, -CFG.camBack * 1.25).addScaledVector(WORLD_UP, CFG.camUp * 1.35);
    camera.position.lerp(_v, 1 - Math.exp(-3.2 * dt));
    camLook.lerp(_d.copy(you.pos).addScaledVector(you.forward, CFG.lookAhead), 1 - Math.exp(-3.6 * dt));
    camera.up.copy(WORLD_UP); camera.lookAt(camLook);
    if (Math.abs(camera.fov - CFG.fov) > 0.1) { camera.fov += (CFG.fov - camera.fov) * (1 - Math.exp(-4 * dt)); camera.updateProjectionMatrix(); }
    return;
  }

  // up reference stays near world-up for legibility, except when flying near-vertical
  const upRef = Math.abs(you.forward.y) > 0.96 ? you.up : WORLD_UP;

  let lookTgt;
  if (you.ballCam) {
    // Rocket-League ball cam: camera is anchored BEHIND THE CAR (along its own axis), and LOOKS AT THE BALL.
    // It flips to the front of the car when the ball crosses behind, so the ball stays in view.
    const f = _tmp.copy(ball.pos).sub(you.pos); const along = f.dot(you.forward) / (f.length() || 1);
    if (along > 0.12) you.camSide = 1; else if (along < -0.12) you.camSide = -1;   // hysteresis -> no jitter
    // sit a bit higher + further than chase cam (and LOOK AT THE BALL) so the toggle is unmistakable
    _v.copy(you.pos).addScaledVector(you.forward, -CFG.camBack * 1.12 * you.camSide).addScaledVector(upRef, CFG.camUp * 1.6);
    lookTgt = ball.pos;
  } else {
    // car cam: sit behind the car and look where the nose points
    _v.copy(you.pos).addScaledVector(you.forward, -CFG.camBack).addScaledVector(upRef, CFG.camUp);
    lookTgt = _d.copy(you.pos).addScaledVector(you.forward, CFG.lookAhead);
  }

  camera.position.lerp(_v, 1 - Math.exp(-CFG.camStiff * dt));
  camLook.lerp(lookTgt, 1 - Math.exp(-(CFG.camStiff + 2) * dt));
  camera.up.copy(upRef);
  camera.lookAt(camLook);

  // FOV kick on boost for speed feel
  const wantFov = (you.flame.visible) ? CFG.fovBoost : CFG.fov;
  if (Math.abs(camera.fov - wantFov) > 0.1) { camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-6 * dt)); camera.updateProjectionMatrix(); }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
