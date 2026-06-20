// ~sharkthewaters — pilot the chumthewaters ASCII shark through a 3D deep.
// Eat fish smaller than you to grow + score; anything bigger eats you; dodge hooks.
//
// The 3D ocean is real Three.js (fog, receding floor/surface, god rays, caustics,
// bubbles, drifting fish). The shark itself is the chumthewaters ASCII art rendered
// to a canvas texture on a camera-facing billboard, with its swim/steer/inertia and
// heading->frame logic adapted from ../chumthewaters/index.html.

import * as THREE from "three";

const SHARK = window.SHARK_DATA;
let _bubbleTex = null;   // cached bubble sprite (declared up top — used during init, before its factory)

/* ============================================================================
   CONFIG — gameplay & look knobs live up top so they're easy to tune.
   ========================================================================== */
const CFG = {
  fov: 50,
  camZ: 70,                 // camera distance from the z=0 play plane
  fog: { color: 0x05384f, near: 60, far: 190 },
  bg:  { top: 0x1b6e8c, bottom: 0x010a14 },  // water column gradient

  shark: {
    startLen: 11,           // world-units tall at the start
    maxLen:   30,
    inertia:  0.9,          // high = lazy, graceful turns (per 60fps frame)
    capCruise: 26,          // soft top speed (units/sec) while steering
    capDash:   52,
    accel:     5.2,         // how hard it pulls toward the target
    growPerEat: 0.55,       // base growth, scaled down as you fatten
  },

  spawn: {
    preyTarget: 11,         // keep roughly this many prey alive
    predatorTarget: 3,
    preyEvery: 0.6,         // seconds between prey spawn attempts
    predEvery: 2.6,
    hookEvery: 9.0,         // seconds between hook drops (min)
  },
};

/* ============================================================================
   BOOT
   ========================================================================== */
const sceneEl = document.getElementById("scene");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(CFG.fog.color, CFG.fog.near, CFG.fog.far);
scene.background = makeGradientTexture(CFG.bg.top, CFG.bg.bottom);

const camera = new THREE.PerspectiveCamera(CFG.fov, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 0, CFG.camZ);
camera.lookAt(0, 0, 0);

// world bounds at the z=0 plane (recomputed on resize)
let bounds = { halfW: 50, halfH: 30 };
function computeBounds() {
  const halfH = Math.tan((CFG.fov * Math.PI) / 180 / 2) * CFG.camZ;
  bounds = { halfH, halfW: halfH * camera.aspect };
}
computeBounds();

/* ---------- lights ---------- */
scene.add(new THREE.AmbientLight(0x88d6ff, 0.85));
const sun = new THREE.DirectionalLight(0xbff4ff, 1.1);
sun.position.set(-0.3, 1, 0.6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x1d5a78, 0.5);
fill.position.set(0.4, -1, 0.2);
scene.add(fill);

/* ============================================================================
   SCENERY — receding floor & surface, god rays, caustics, bubbles, deep fish.
   ========================================================================== */
const causticTex = makeCausticTexture(256);

// --- seafloor: a horizontal plane below the camera that recedes into the fog ---
const floorDepth = 240;
const sand = new THREE.Mesh(
  new THREE.PlaneGeometry(900, floorDepth, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x0d4a5a, roughness: 1, metalness: 0 })
);
sand.rotation.x = -Math.PI / 2;
sand.position.set(0, -bounds.halfH - 1, -floorDepth / 2 + 8);
scene.add(sand);

// caustic light dancing on the sand (additive, scrolls)
const floorCaustic = new THREE.Mesh(
  new THREE.PlaneGeometry(900, floorDepth, 1, 1),
  new THREE.MeshBasicMaterial({ map: causticTex.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, color: 0x4fe6ff })
);
floorCaustic.material.map.repeat.set(10, 10);
floorCaustic.rotation.x = -Math.PI / 2;
floorCaustic.position.set(0, -bounds.halfH - 0.9, -floorDepth / 2 + 8);
scene.add(floorCaustic);

// --- surface: a horizontal translucent ceiling that recedes upward ---
const surface = new THREE.Mesh(
  new THREE.PlaneGeometry(900, floorDepth, 1, 1),
  new THREE.MeshBasicMaterial({ map: causticTex.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32, color: 0x9af6ff })
);
surface.material.map.repeat.set(8, 8);
surface.rotation.x = Math.PI / 2;
surface.position.set(0, bounds.halfH + 2, -floorDepth / 2 + 8);
scene.add(surface);

function placeScenery() {
  sand.position.y = -bounds.halfH - 1;
  floorCaustic.position.y = -bounds.halfH - 0.9;
  surface.position.y = bounds.halfH + 2;
}

// --- god rays: tall additive shafts sinking from the surface ---
const rayTex = makeRayTexture();
const rays = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 150),
    new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.0, color: 0xbdf3ff })
  );
  m.position.set((Math.random() - 0.5) * 160, 30, -30 - Math.random() * 60);
  m.rotation.z = (Math.random() - 0.5) * 0.5;
  m.userData = { baseX: m.position.x, baseRot: m.rotation.z, phase: Math.random() * 6.28, amp: 0.1 + Math.random() * 0.18, op: 0.10 + Math.random() * 0.14 };
  rays.push(m);
  scene.add(m);
}

// --- bubbles: rising point cloud ---
const BUBBLES = 220;
const bubbleGeo = new THREE.BufferGeometry();
const bubblePos = new Float32Array(BUBBLES * 3);
const bubbleSeed = new Float32Array(BUBBLES);
for (let i = 0; i < BUBBLES; i++) {
  bubblePos[i * 3 + 0] = (Math.random() - 0.5) * 180;
  bubblePos[i * 3 + 1] = (Math.random() - 0.5) * 90;
  bubblePos[i * 3 + 2] = -40 + Math.random() * 60;
  bubbleSeed[i] = Math.random() * 100;
}
bubbleGeo.setAttribute("position", new THREE.BufferAttribute(bubblePos, 3));
const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
  map: makeBubbleTexture(), size: 1.5, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, opacity: 0.6, sizeAttenuation: true, color: 0xcdf4ff,
}));
scene.add(bubbles);

// --- distant drifting fish (silhouettes, parallax, fogged into the deep) ---
const deepFish = [];
for (let i = 0; i < 26; i++) {
  const f = makeFishMesh(0x06303f, 2 + Math.random() * 3, true);
  f.position.set((Math.random() - 0.5) * 220, (Math.random() - 0.5) * 70, -55 - Math.random() * 90);
  f.userData.vx = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4);
  f.scale.x *= Math.sign(f.userData.vx);
  deepFish.push(f);
  scene.add(f);
}

/* ============================================================================
   THE SHARK — ASCII billboard.  Adapted heading/swim/inertia from chumthewaters.
   ========================================================================== */
const ANGLES = SHARK.angles;          // [0,30,...,330]
const STEP = 360 / ANGLES.length;     // 30
const BOX = SHARK.box;                 // {w:76,h:38}

// one reusable canvas; redraw only when the (heading,swim) frame changes
const cellW = 9, cellH = 17, pad = 6;
const shCanvas = document.createElement("canvas");
shCanvas.width = BOX.w * cellW + pad * 2;
shCanvas.height = BOX.h * cellH + pad * 2;
const shCtx = shCanvas.getContext("2d");
const shTex = new THREE.CanvasTexture(shCanvas);
shTex.colorSpace = THREE.SRGBColorSpace;
shTex.minFilter = THREE.LinearFilter;
shTex.magFilter = THREE.LinearFilter;

const sharkSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: shTex, transparent: true, depthWrite: false, depthTest: true, fog: false,
}));
sharkSprite.renderOrder = 5;
scene.add(sharkSprite);
const SPRITE_ASPECT = shCanvas.width / shCanvas.height;

let lastFrameKey = "";
function drawSharkFrame(heading, swim) {
  const idx = Math.round((((heading % 360) + 360) % 360) / STEP) % ANGLES.length;
  const arr = SHARK.frames[ANGLES[idx]];
  const frame = arr[((swim % arr.length) + arr.length) % arr.length];
  const key = idx + "|" + (swim % arr.length);
  if (key === lastFrameKey) return;
  lastFrameKey = key;

  shCtx.clearRect(0, 0, shCanvas.width, shCanvas.height);
  shCtx.font = `${cellH}px "Cascadia Mono", Consolas, ui-monospace, monospace`;
  shCtx.textBaseline = "top";
  const lines = frame.split("\n");
  // soft outer glow then the bright body, for a lit-from-above ASCII look
  for (let pass = 0; pass < 2; pass++) {
    shCtx.fillStyle = pass === 0 ? "rgba(20,120,140,0.5)" : "#a9f6ef";
    shCtx.shadowColor = pass === 0 ? "rgba(40,200,210,0.7)" : "transparent";
    shCtx.shadowBlur = pass === 0 ? 6 : 0;
    const ox = pass === 0 ? 1 : 0, oy = pass === 0 ? 1 : 0;
    for (let r = 0; r < lines.length; r++) {
      shCtx.fillText(lines[r], pad + ox, pad + r * cellH + oy);
    }
  }
  shTex.needsUpdate = true;
}

// shark state
const shark = {
  pos: new THREE.Vector2(0, 0),
  vel: new THREE.Vector2(-6, 0),
  heading: 0,           // displayed art heading (deg)
  len: CFG.shark.startLen,
  swim: 0, swimAcc: 0,
  dash: 0,              // dash timer (s)
  alive: true,
};

function sharkRadius() { return shark.len * 0.42; }

function syncSharkSprite() {
  const h = shark.len;
  sharkSprite.scale.set(h * SPRITE_ASPECT, h, 1);
  sharkSprite.position.set(shark.pos.x, shark.pos.y, 1);   // a hair in front of the fish plane
}

/* ============================================================================
   FISH ENTITIES — prey (eat to grow) and predators (eat YOU until you outgrow).
   ========================================================================== */
const PREY_COLORS = [0xffd24d, 0xff944d, 0x4dd2ff, 0xff6bce, 0x9bff6b, 0xfff27a];
const fishes = [];   // active gameplay fish

function spawnFish(kind) {
  // prey are small & bright; predators are large, dark & toothy
  let size, color, speed, predator;
  if (kind === "predator") {
    predator = true;
    size = shark.len * (1.15 + Math.random() * 0.9);          // meaningfully bigger than you, for now
    size = Math.min(size, CFG.shark.maxLen * 1.25);
    color = Math.random() < 0.5 ? 0x9a2738 : 0x37323f;
    speed = 6 + Math.random() * 5;
  } else {
    predator = false;
    size = 3 + Math.random() * Math.max(4, shark.len * 0.55);  // a spread of edible sizes
    color = PREY_COLORS[(Math.random() * PREY_COLORS.length) | 0];
    speed = 5 + Math.random() * 7;
  }

  const mesh = makeFishMesh(color, size, false, predator);
  const fromLeft = Math.random() < 0.5;
  const x = (fromLeft ? -1 : 1) * (bounds.halfW + size + 4);
  const y = (Math.random() - 0.5) * (bounds.halfH * 1.7);
  mesh.position.set(x, y, 0);

  const f = {
    mesh, size, predator,
    vel: new THREE.Vector2((fromLeft ? 1 : -1) * speed, (Math.random() - 0.5) * 2),
    baseSpeed: speed,
    bobPhase: Math.random() * 6.28,
    wiggle: Math.random() * 6.28,
    flee: false,
  };
  faceFish(f);
  fishes.push(f);
  scene.add(mesh);
}

function faceFish(f) {
  // fish art points along +x; flip to face travel direction
  const dir = Math.sign(f.vel.x) || 1;
  f.mesh.scale.x = Math.abs(f.mesh.scale.x) * dir;
}

function despawn(f) {
  scene.remove(f.mesh);
  disposeMesh(f.mesh);
  const i = fishes.indexOf(f);
  if (i >= 0) fishes.splice(i, 1);
}

/* ============================================================================
   HOOKS — a fishing line drops from a surface boat; touching the hook = caught.
   ========================================================================== */
const hooks = [];
function spawnHook() {
  const group = new THREE.Group();
  const x = (Math.random() - 0.5) * bounds.halfW * 1.6;
  const topY = bounds.halfH + 6;
  const dropTo = -bounds.halfH * (0.2 + Math.random() * 0.7);

  // line: a unit segment going UP from the hook; we scale.y to reach the boat
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xcfe6f0, transparent: true, opacity: 0.6 }));
  group.add(line);

  // hook + bait
  const hookMesh = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.28, 8, 14, Math.PI * 1.4),
    new THREE.MeshStandardMaterial({ color: 0xcfd6da, metalness: 0.9, roughness: 0.3, emissive: 0x222a2e }));
  hookMesh.rotation.z = Math.PI * 0.15;
  const bait = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xff5a6e, emissive: 0x55121a, roughness: 0.6 }));
  bait.position.y = -1.1;
  group.add(hookMesh); group.add(bait);

  group.position.set(x, topY, 0.5);
  scene.add(group);

  const boat = makeBoat();
  boat.position.set(x, bounds.halfH + 5.5, -2);
  scene.add(boat);

  hooks.push({ group, line, boat, x, topY, dropTo, depth: 0, state: "drop", t: 0, hookY: topY });
}

function despawnHook(h) {
  scene.remove(h.group); scene.remove(h.boat);
  disposeMesh(h.group); disposeMesh(h.boat);
  const i = hooks.indexOf(h);
  if (i >= 0) hooks.splice(i, 1);
}

/* ============================================================================
   INPUT — mouse steers (cursor-chase), WASD/arrows nudge, click/space dashes.
   ========================================================================== */
const target = new THREE.Vector2(0, 0);
const mouseNDC = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let mouseActive = false, lastMouseT = -10;
const keys = new Set();
let clock = 0;

function screenToWorld(clientX, clientY) {
  mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = new THREE.Vector3();
  raycaster.ray.intersectPlane(planeZ0, hit);
  return hit;
}

window.addEventListener("pointermove", (e) => {
  const w = screenToWorld(e.clientX, e.clientY);
  if (!w) return;
  target.set(w.x, w.y);
  mouseActive = true; lastMouseT = clock;
}, { passive: true });

window.addEventListener("pointerdown", () => { if (state === "playing") shark.dash = 0.45; });
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === " ") { if (state === "playing") shark.dash = 0.45; e.preventDefault(); }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function keyboardSteer(dt) {
  let kx = 0, ky = 0;
  if (keys.has("a") || keys.has("arrowleft")) kx -= 1;
  if (keys.has("d") || keys.has("arrowright")) kx += 1;
  if (keys.has("w") || keys.has("arrowup")) ky += 1;
  if (keys.has("s") || keys.has("arrowdown")) ky -= 1;
  if (kx || ky) {
    // keyboard takes over: aim a target ahead of the shark in the pressed dir
    const len = Math.hypot(kx, ky) || 1;
    target.set(shark.pos.x + (kx / len) * 30, shark.pos.y + (ky / len) * 30);
    mouseActive = false;
  }
}

/* ============================================================================
   GAME STATE
   ========================================================================== */
let state = "start";   // start | playing | gameover
let score = 0;
let best = +(localStorage.getItem("sharkthewaters.best") || 0) || 0;
let spawnTimers = { prey: 0, pred: 0, hook: 5 };

const elScore = document.getElementById("score");
const elBest = document.getElementById("best");
const elSizeFill = document.getElementById("sizefill");
const elFlash = document.getElementById("flash");
const elHud = document.getElementById("hud");
const elStart = document.getElementById("start");
const elOver = document.getElementById("over");

document.getElementById("startBest").textContent = best;
elBest.textContent = best;

function startGame() {
  // clear board
  [...fishes].forEach(despawn);
  [...hooks].forEach(despawnHook);
  score = 0;
  shark.pos.set(0, 0); shark.vel.set(-6, 0);
  shark.len = CFG.shark.startLen; shark.heading = 0; shark.dash = 0; shark.alive = true;
  target.set(0, 0); mouseActive = false;
  spawnTimers = { prey: 0, pred: 1.5, hook: 6 };
  syncSharkSprite();
  updateHud();
  state = "playing";
  elStart.classList.add("hidden");
  elOver.classList.add("hidden");
  elHud.classList.remove("hidden");
}

function gameOver(reason) {
  if (state !== "playing") return;
  state = "gameover";
  shark.alive = false;
  flash("danger");
  shake(0.9);
  elHud.classList.add("hidden");

  const isBest = score > best;
  if (isBest) { best = score; localStorage.setItem("sharkthewaters.best", String(best)); }
  document.getElementById("finalScore").textContent = score;
  document.getElementById("finalBest").textContent = best;
  document.getElementById("startBest").textContent = best;
  elBest.textContent = best;
  document.getElementById("newbest").classList.toggle("hidden", !isBest);
  document.getElementById("overReason").textContent = reason;
  document.getElementById("overTitle").textContent = reason.includes("hook") ? "HOOKED." : "CHOMPED.";
  setTimeout(() => elOver.classList.remove("hidden"), 650);
}

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("againBtn").addEventListener("click", startGame);

function updateHud() {
  elScore.textContent = score;
  elBest.textContent = best;
  const frac = (shark.len - CFG.shark.startLen) / (CFG.shark.maxLen - CFG.shark.startLen);
  elSizeFill.style.width = Math.max(6, Math.min(100, 6 + frac * 94)) + "%";
}

/* ---------- juice ---------- */
let shakeAmt = 0;
function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
let flashTimer = 0;
function flash(kind) {
  elFlash.classList.toggle("eat", kind === "eat");
  elFlash.style.opacity = kind === "eat" ? "0.5" : "0.85";
  flashTimer = kind === "eat" ? 0.12 : 0.35;
}

/* ============================================================================
   UPDATE
   ========================================================================== */
function updatePlaying(dt) {
  keyboardSteer(dt);

  const following = mouseActive && (clock - lastMouseT < 3.0);
  if (!following && !keys.size) {
    // idle: ease toward a gentle forward cruise so the shark never stalls dead
    target.set(shark.pos.x + shark.vel.x * 0.6, shark.pos.y + shark.vel.y * 0.6);
  }

  // steer toward target with heavy inertia (chumthewaters cruise feel)
  const dx = target.x - shark.pos.x, dy = target.y - shark.pos.y;
  const dist = Math.hypot(dx, dy) || 1;
  const standoff = following ? 4 : 0;
  const pull = Math.max(dist - standoff, 0);
  const accel = CFG.shark.accel * (shark.dash > 0 ? 2.4 : 1);
  const ax = (dx / dist) * Math.min(pull, 30) * accel;
  const ay = (dy / dist) * Math.min(pull, 30) * accel;

  const inertia = Math.pow(CFG.shark.inertia, dt * 60);
  shark.vel.x = shark.vel.x * inertia + ax * (1 - inertia);
  shark.vel.y = shark.vel.y * inertia + ay * (1 - inertia);

  // speed cap
  const cap = shark.dash > 0 ? CFG.shark.capDash : CFG.shark.capCruise;
  const sp = shark.vel.length();
  if (sp > cap) shark.vel.multiplyScalar(cap / sp);
  if (shark.dash > 0) shark.dash -= dt;

  shark.pos.x += shark.vel.x * dt;
  shark.pos.y += shark.vel.y * dt;

  // soft walls
  const m = sharkRadius();
  if (shark.pos.x < -bounds.halfW + m) { shark.pos.x = -bounds.halfW + m; shark.vel.x *= -0.4; }
  if (shark.pos.x > bounds.halfW - m) { shark.pos.x = bounds.halfW - m; shark.vel.x *= -0.4; }
  if (shark.pos.y < -bounds.halfH + m) { shark.pos.y = -bounds.halfH + m; shark.vel.y *= -0.4; }
  if (shark.pos.y > bounds.halfH - m) { shark.pos.y = bounds.halfH - m; shark.vel.y *= -0.4; }

  // heading from travel direction (y-up): 0=left,90=down,180=right,270=up — matches the art
  if (sp > 1.2) {
    let h = Math.atan2(-shark.vel.y, -shark.vel.x) * 180 / Math.PI;
    if (h < 0) h += 360;
    shark.heading = h;
  }

  // tail beat speeds up with velocity
  shark.swimAcc += dt * (4 + sp * 0.25);
  if (shark.swimAcc >= 1) { shark.swim += Math.floor(shark.swimAcc); shark.swimAcc %= 1; }

  syncSharkSprite();

  // ----- fish behaviour + collisions -----
  for (let i = fishes.length - 1; i >= 0; i--) {
    const f = fishes[i];
    const edible = shark.len >= f.size * 0.96;
    f.flee = edible && f.predator;          // outgrown predators flee

    const toShark = new THREE.Vector2(shark.pos.x - f.mesh.position.x, shark.pos.y - f.mesh.position.y);
    const d = toShark.length() || 1;

    if (f.predator && !edible && d < 60) {
      // hunt the shark, but slower than top speed so it's escapable
      f.vel.x += (toShark.x / d) * 22 * dt;
      f.vel.y += (toShark.y / d) * 22 * dt;
      const fc = f.baseSpeed * 1.25;
      const fs = f.vel.length(); if (fs > fc) f.vel.multiplyScalar(fc / fs);
    } else if (f.flee && d < 45) {
      f.vel.x -= (toShark.x / d) * 26 * dt;
      f.vel.y -= (toShark.y / d) * 26 * dt;
    }

    f.bobPhase += dt * 2;
    f.mesh.position.x += f.vel.x * dt;
    f.mesh.position.y += f.vel.y * dt + Math.sin(f.bobPhase) * dt * 2;
    faceFish(f);

    // tail wiggle
    f.wiggle += dt * 10;
    if (f.mesh.userData.tail) f.mesh.userData.tail.rotation.y = Math.sin(f.wiggle) * 0.5;

    // off-screen cull (only once it has crossed and kept going)
    if (f.mesh.position.x < -bounds.halfW - f.size - 12 || f.mesh.position.x > bounds.halfW + f.size + 12 ||
        Math.abs(f.mesh.position.y) > bounds.halfH + 30) {
      despawn(f); continue;
    }

    // collision with shark
    const hitDist = sharkRadius() + f.size * 0.4;
    if (d < hitDist) {
      if (edible) { eatFish(f); }
      else { gameOver("A bigger fish got you."); return; }
    }
  }

  // ----- hooks -----
  for (let i = hooks.length - 1; i >= 0; i--) {
    const h = hooks[i];
    h.t += dt;
    if (h.state === "drop") {
      h.depth += dt * 18;
      h.hookY = h.topY - h.depth;
      if (h.hookY <= h.dropTo) { h.hookY = h.dropTo; h.state = "wait"; h.t = 0; }
    } else if (h.state === "wait") {
      if (h.t > 2.2) { h.state = "reel"; }
    } else if (h.state === "reel") {
      h.hookY += dt * 26;
      if (h.hookY >= h.topY) { despawnHook(h); continue; }
    }
    // position group at the hook tip; stretch the line up to the boat
    h.group.position.y = h.hookY;
    h.line.scale.y = (h.topY - h.hookY) + 6;
    h.line.position.y = 0;

    // bob the boat
    h.boat.position.y = bounds.halfH + 5.5 + Math.sin(clock * 1.5 + h.x) * 0.5;
    h.boat.rotation.z = Math.sin(clock * 1.2 + h.x) * 0.05;

    // collision: hook tip vs shark
    const hx = h.x - shark.pos.x, hy = h.hookY - 1 - shark.pos.y;
    if (Math.hypot(hx, hy) < sharkRadius() + 1.4) { gameOver("The hook reeled you in."); return; }
  }

  // ----- spawning -----
  spawnTimers.prey -= dt; spawnTimers.pred -= dt; spawnTimers.hook -= dt;
  const preyCount = fishes.filter((f) => !f.predator).length;
  const predCount = fishes.filter((f) => f.predator).length;
  if (spawnTimers.prey <= 0 && preyCount < CFG.spawn.preyTarget) { spawnFish("prey"); spawnTimers.prey = CFG.spawn.preyEvery; }
  if (spawnTimers.pred <= 0 && predCount < CFG.spawn.predatorTarget) { spawnFish("predator"); spawnTimers.pred = CFG.spawn.predEvery; }
  if (spawnTimers.hook <= 0) { spawnHook(); spawnTimers.hook = CFG.spawn.hookEvery + Math.random() * 6; }

  updateHud();
}

function eatFish(f) {
  const gained = Math.round(8 + f.size * f.size * 0.35 * (f.predator ? 2.2 : 1));
  score += gained;
  // growth tapers as you fatten so the late game stays survivable
  const room = (CFG.shark.maxLen - shark.len) / (CFG.shark.maxLen - CFG.shark.startLen);
  shark.len = Math.min(CFG.shark.maxLen, shark.len + CFG.shark.growPerEat * (0.4 + f.size / shark.len) * Math.max(0.15, room));
  flash("eat");
  shake(0.18 + f.size * 0.01);
  spawnChomp(f.mesh.position.clone());
  despawn(f);
  updateHud();
}

// little additive burst when something gets eaten
const chomps = [];
function spawnChomp(p) {
  const g = new THREE.BufferGeometry();
  const n = 12, arr = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    const a = Math.random() * 6.28, s = 6 + Math.random() * 10;
    vel.push(new THREE.Vector2(Math.cos(a) * s, Math.sin(a) * s));
  }
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: makeBubbleTexture(), size: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xbff7ff }));
  scene.add(pts);
  chomps.push({ pts, vel, life: 0.5 });
}
function updateChomps(dt) {
  for (let i = chomps.length - 1; i >= 0; i--) {
    const c = chomps[i];
    c.life -= dt;
    const a = c.pts.geometry.attributes.position.array;
    for (let j = 0; j < c.vel.length; j++) {
      a[j * 3] += c.vel[j].x * dt; a[j * 3 + 1] += c.vel[j].y * dt;
      c.vel[j].multiplyScalar(0.92);
    }
    c.pts.geometry.attributes.position.needsUpdate = true;
    c.pts.material.opacity = Math.max(0, c.life / 0.5);
    if (c.life <= 0) { scene.remove(c.pts); disposeMesh(c.pts); chomps.splice(i, 1); }
  }
}

/* idle ambiance for start/gameover: shark lazily cruises and wanders */
let wanderTarget = new THREE.Vector2(0, 0), wanderT = 0;
function updateIdle(dt) {
  wanderT -= dt;
  if (wanderT <= 0) { wanderTarget.set((Math.random() - 0.5) * bounds.halfW * 1.4, (Math.random() - 0.5) * bounds.halfH * 1.2); wanderT = 3 + Math.random() * 3; }
  const dx = wanderTarget.x - shark.pos.x, dy = wanderTarget.y - shark.pos.y;
  const dist = Math.hypot(dx, dy) || 1;
  const inertia = Math.pow(0.94, dt * 60);
  shark.vel.x = shark.vel.x * inertia + (dx / dist) * 14 * (1 - inertia);
  shark.vel.y = shark.vel.y * inertia + (dy / dist) * 14 * (1 - inertia);
  const sp = shark.vel.length(); if (sp > 13) shark.vel.multiplyScalar(13 / sp);
  shark.pos.x += shark.vel.x * dt; shark.pos.y += shark.vel.y * dt;
  if (sp > 1) { let h = Math.atan2(-shark.vel.y, -shark.vel.x) * 180 / Math.PI; if (h < 0) h += 360; shark.heading = h; }
  shark.swimAcc += dt * (4 + sp * 0.25);
  if (shark.swimAcc >= 1) { shark.swim += Math.floor(shark.swimAcc); shark.swimAcc %= 1; }
  syncSharkSprite();
}

/* ============================================================================
   SCENERY ANIMATION (always running)
   ========================================================================== */
function updateScenery(dt) {
  // caustics scroll
  floorCaustic.material.map.offset.x += dt * 0.015;
  floorCaustic.material.map.offset.y += dt * 0.01;
  surface.material.map.offset.x -= dt * 0.012;
  surface.material.map.offset.y += dt * 0.008;

  // god rays sway + breathe
  for (const m of rays) {
    const u = m.userData;
    u.phase += dt;
    m.position.x = u.baseX + Math.sin(u.phase * 0.5) * 6;
    m.rotation.z = u.baseRot + Math.sin(u.phase * 0.7) * u.amp;
    m.material.opacity = u.op * (0.6 + 0.4 * Math.sin(u.phase * 0.9));
  }

  // bubbles rise & wobble
  const bp = bubbleGeo.attributes.position.array;
  for (let i = 0; i < BUBBLES; i++) {
    bp[i * 3 + 1] += dt * (4 + (bubbleSeed[i] % 3));
    bp[i * 3] += Math.sin(clock * 1.5 + bubbleSeed[i]) * dt * 1.2;
    if (bp[i * 3 + 1] > bounds.halfH + 20) {
      bp[i * 3 + 1] = -bounds.halfH - 10;
      bp[i * 3] = (Math.random() - 0.5) * 180;
    }
  }
  bubbleGeo.attributes.position.needsUpdate = true;

  // deep parallax fish drift
  for (const f of deepFish) {
    f.position.x += f.userData.vx * dt;
    f.position.y += Math.sin(clock * 0.5 + f.position.z) * dt * 1.5;
    if (f.userData.tail) f.userData.tail.rotation.y = Math.sin(clock * 6 + f.position.z) * 0.4;
    if (f.position.x > 130) { f.position.x = -130; }
    if (f.position.x < -130) { f.position.x = 130; }
  }
}

/* ============================================================================
   MAIN LOOP
   ========================================================================== */
let lastT = performance.now();
function loop(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.05) dt = 0.05;     // clamp after tab-out / jank
  clock += dt;

  drawSharkFrame(shark.heading, shark.swim);
  updateScenery(dt);
  updateChomps(dt);

  if (state === "playing") updatePlaying(dt);
  else updateIdle(dt);

  // flash + shake decay
  if (flashTimer > 0) { flashTimer -= dt; if (flashTimer <= 0) elFlash.style.opacity = "0"; }
  if (shakeAmt > 0.001) {
    camera.position.x = Math.sin(now * 0.05) * shakeAmt;
    camera.position.y = Math.cos(now * 0.07) * shakeAmt;
    shakeAmt *= Math.pow(0.001, dt);   // fast decay
  } else { camera.position.x = 0; camera.position.y = 0; }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ============================================================================
   RESIZE
   ========================================================================== */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  computeBounds();
  placeScenery();
});

// keep the loop sane across tab switches
document.addEventListener("visibilitychange", () => { if (!document.hidden) lastT = performance.now(); });

/* ============================================================================
   FACTORIES — small procedural meshes & textures
   ========================================================================== */
function makeFishMesh(color, len, silhouette, predator) {
  const g = new THREE.Group();
  const mat = silhouette
    ? new THREE.MeshBasicMaterial({ color, fog: true })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, emissive: new THREE.Color(color).multiplyScalar(0.12) });

  // body: stretched ellipsoid
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, predator ? 12 : 9, predator ? 10 : 7), mat);
  body.scale.set(len * 1.0, len * 0.42, len * 0.36);
  g.add(body);

  // tail
  const tail = new THREE.Group();
  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(len * 0.3, len * 0.5, 4), mat);
  tailFin.rotation.z = Math.PI / 2;
  tailFin.position.x = -len * 0.62;
  tail.add(tailFin);
  g.add(tail);
  g.userData.tail = tail;

  // dorsal + toothy mouth flair for predators
  if (predator) {
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(len * 0.18, len * 0.5, 4), mat);
    dorsal.position.set(0, len * 0.34, 0);
    g.add(dorsal);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(len * 0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    eye.position.set(len * 0.34, len * 0.08, len * 0.16);
    g.add(eye);
    const eye2 = eye.clone(); eye2.position.z = -len * 0.16; g.add(eye2);
  } else {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(len * 0.07, 7, 7),
      new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
    eye.position.set(len * 0.34, len * 0.06, len * 0.15);
    g.add(eye);
  }
  return g;
}

function makeBoat() {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x10242e, roughness: 0.8, emissive: 0x05161c });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(10, 2.4, 4), hullMat);
  g.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2, 3), new THREE.MeshStandardMaterial({ color: 0x16323d, emissive: 0x07181e }));
  cabin.position.set(1.5, 2, 0);
  g.add(cabin);
  return g;
}

/* ---------- textures ---------- */
function makeGradientTexture(top, bottom) {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const ctx = c.getContext("2d");
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#" + top.toString(16).padStart(6, "0"));
  grd.addColorStop(1, "#" + bottom.toString(16).padStart(6, "0"));
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCausticTexture(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  // sum a few integer-harmonic sine waves so the pattern tiles seamlessly
  const waves = [
    { kx: 2, ky: 1, p: 0.0 }, { kx: 1, ky: 3, p: 1.7 },
    { kx: 3, ky: 2, p: 4.1 }, { kx: 4, ky: 4, p: 2.3 },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) {
        v += Math.sin((2 * Math.PI * (w.kx * x + w.ky * y)) / size + w.p);
      }
      v = v / waves.length;                 // -1..1
      let b = Math.pow(Math.max(0, v), 3.2); // sharp bright ridges
      const i = (y * size + x) * 4;
      const c8 = Math.min(255, b * 255);
      img.data[i] = c8; img.data[i + 1] = c8; img.data[i + 2] = c8; img.data[i + 3] = c8;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeRayTexture() {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 256;
  const ctx = c.getContext("2d");
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.5, "rgba(200,245,255,0.25)");
  grd.addColorStop(1, "rgba(200,245,255,0)");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 32, 256);
  // soft horizontal falloff
  const grd2 = ctx.createLinearGradient(0, 0, 32, 0);
  grd2.addColorStop(0, "rgba(0,0,0,1)");
  grd2.addColorStop(0.5, "rgba(0,0,0,0)");
  grd2.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = grd2; ctx.fillRect(0, 0, 32, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBubbleTexture() {
  if (_bubbleTex) return _bubbleTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.4, "rgba(200,245,255,0.5)");
  grd.addColorStop(0.8, "rgba(150,230,255,0.15)");
  grd.addColorStop(1, "rgba(150,230,255,0)");
  ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(16, 16, 15, 0, 6.28); ctx.fill();
  // bright rim for a bubble feel
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(16, 16, 11, 0, 6.28); ctx.stroke();
  _bubbleTex = new THREE.CanvasTexture(c);
  _bubbleTex.colorSpace = THREE.SRGBColorSpace;
  return _bubbleTex;
}

function disposeMesh(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m.map && m.map !== causticTex) m.map.dispose?.(); m.dispose(); });
    }
  });
}

// first frame so the start screen isn't blank
drawSharkFrame(shark.heading, shark.swim);
syncSharkSprite();

// small debug handle (used by automated smoke tests; harmless in normal play)
window.__shark = {
  get state() { return state; },
  get score() { return score; },
  get len() { return shark.len; },
  shark, fishes, hooks,
  start: startGame,
  spawnFish,
};
