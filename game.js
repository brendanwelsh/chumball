// ~sharkthewaters — 3D SPACE ROCKET BALL SHARK
// Fly the chumthewaters ASCII shark through a 3D space arena (full volumetric flight,
// not a flat plane) and rocket-boost a giant ball into the cyan goal. Shark soccer vs a bot.
//
// The shark is the chumthewaters ASCII art drawn to a canvas-texture billboard; the world,
// ball, goals and bot are real Three.js. three.js is vendored (./vendor/three.module.js).

import * as THREE from "three";

const SHARK = window.SHARK_DATA;

/* ============================================================ CONFIG */
const CFG = {
  AX: 175, AY: 100, AZ: 260,      // arena half-extents (long along Z; goals at ±Z)
  goalR: 50,                      // goal opening radius
  sharkLen: 20, sharkHitR: 11,
  cruise: 80, boost: 158, accel: 5.5, turn: 2.5,   // flight (units/s, rad/s)
  boostDrain: 1 / 2.8, boostRegen: 1 / 4.2,
  camBack: 48, camUp: 16, lookAhead: 80,
  ballR: 14, ballDrag: 0.4, restit: 0.84, ballMax: 250,
  hitBase: 130, hitTransfer: 0.95,
  botSpeed: 100,
  tailBeat: 11,
  matchTime: 120, goalPause: 2.2,
};
const ANGLES = SHARK.angles, NA = ANGLES.length;

/* ============================================================ DOM + early wiring */
const $ = (id) => document.getElementById(id);
const elScene = $("scene"), elHud = $("hud"), elStart = $("start"), elOver = $("over");
const elYou = $("youScore"), elBot = $("botScore"), elClock = $("clock"), elBoost = $("boostFill");
const elBanner = $("goalBanner"), elBannerTxt = $("goalText");

let booted = false;
$("startBtn").addEventListener("click", () => booted && startMatch());
$("againBtn").addEventListener("click", () => booted && startMatch());

/* ============================================================ BOOT (guarded) */
let renderer, scene, camera, ball, ballLight, you, bot;
const clock = new THREE.Clock();

try {
  boot();
  booted = true;
  renderer.setAnimationLoop(frame);
} catch (err) {
  if (window.__sharkErr) window.__sharkErr(err.message || String(err));
  throw err;
}

function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  elScene.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030c);
  scene.fog = new THREE.FogExp2(0x05071a, 0.0011);

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 5000);
  camera.position.set(0, 80, -CFG.AZ - 200);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x5a78ff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(120, 260, 140); scene.add(key);
  const rim = new THREE.DirectionalLight(0x55ffe0, 0.5); rim.position.set(-180, -80, -160); scene.add(rim);

  buildStars();
  buildArena();
  buildDust();

  // the ball
  ball = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(CFG.ballR, 28, 20),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffb31f, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.1 })
    ),
  };
  scene.add(ball.mesh);
  ballLight = new THREE.PointLight(0xffd36b, 1.4, 600, 2); scene.add(ballLight);

  // sharks (player cyan, bot red)
  you = makeShark(0x9bf6ff);
  bot = makeShark(0xff7a88);
  scene.add(you.sprite, bot.sprite);

  // input
  addEventListener("resize", onResize);
  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("pointerdown", (e) => { if (e.button === 0) input.boost = true; });
  addEventListener("pointerup", () => { input.boost = false; });
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === " " || k === "shift") { input.boost = true; if (k === " ") e.preventDefault(); }
    if (k === "c") input.ballCam = !input.ballCam;
  });
  addEventListener("keyup", (e) => { const k = e.key.toLowerCase(); if (k === " " || k === "shift") input.boost = false; });

  resetEntities();
}

/* ============================================================ WORLD BUILDERS */
function buildStars() {
  const N = 2600, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    // shell of stars well outside the arena
    const r = 1500 + Math.random() * 1800;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 6, sizeAttenuation: true, transparent: true, opacity: 0.9, fog: false })));
}

function buildDust() {
  // faint floating motes INSIDE the arena so motion is legible in empty space
  const N = 900, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * CFG.AX;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * CFG.AY;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * CFG.AZ;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x4ad6e0, size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0.5 })));
}

function buildArena() {
  const { AX, AY, AZ, goalR } = CFG;
  // wireframe box for spatial reference
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(AX * 2, AY * 2, AZ * 2)),
    new THREE.LineBasicMaterial({ color: 0x1f6f8f, transparent: true, opacity: 0.55 })
  );
  scene.add(box);

  // a faint grid wall on each end behind the goals
  for (const z of [-AZ, AZ]) {
    const grid = new THREE.GridHelper(AY * 2.4, 16, 0x274b63, 0x16323f);
    grid.rotation.x = Math.PI / 2; grid.position.set(0, 0, z);
    grid.material.transparent = true; grid.material.opacity = 0.35;
    scene.add(grid);
  }

  // goal rings: cyan at +Z (attack), red at -Z (defend)
  addGoal(AZ, 0x6ff0ff);
  addGoal(-AZ, 0xff5a6e);

  function addGoal(z, color) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(goalR, 4.2, 16, 48),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.4 })
    );
    ring.position.set(0, 0, z);            // torus lies in XY plane -> opening faces ±Z
    scene.add(ring);
    const glow = new THREE.PointLight(color, 1.0, 480, 2); glow.position.set(0, 0, z * 0.92); scene.add(glow);
  }
}

/* ============================================================ ASCII SHARK BILLBOARD */
function makeShark(color) {
  const cw = SHARK.box.w, ch = SHARK.box.h;
  const fs = 22, lh = 23, charW = fs * 0.6;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cw * charW);
  canvas.height = Math.ceil(ch * lh);
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(CFG.sharkLen, CFG.sharkLen * ch / cw, 1);
  const hex = "#" + color.toString(16).padStart(6, "0");
  return {
    sprite, ctx, tex, canvas, color: hex, fs, lh,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1),
    yaw: 0, pitch: 0, speed: CFG.cruise, boostE: 1, hitCD: 0, lastIdx: Math.floor(NA / 2), lastKey: "",
  };
}

function drawShark(s, text) {
  const ctx = s.ctx;
  ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
  ctx.font = `${s.fs}px ${CFG_FONT}`;
  ctx.textBaseline = "top";
  ctx.shadowColor = s.color; ctx.shadowBlur = 7; ctx.fillStyle = s.color;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 0, i * s.lh);
  s.tex.needsUpdate = true;
}
const CFG_FONT = '"Cascadia Mono","Consolas",monospace';

const _R = new THREE.Vector3(), _U = new THREE.Vector3();
function screenHeadingDeg(forward) {
  _R.setFromMatrixColumn(camera.matrixWorld, 0);   // camera right
  _U.setFromMatrixColumn(camera.matrixWorld, 1);   // camera up
  const a = forward.dot(_R), b = forward.dot(_U);
  if (Math.hypot(a, b) < 0.13) return null;        // flying near-straight at/away from cam: keep last frame
  return Math.atan2(-b, -a) * 180 / Math.PI;       // match the original chumthewaters heading convention
}
function angleIdx(deg) { return Math.round((((deg % 360) + 360) % 360) / (360 / NA)) % NA; }

function updateSharkVisual(s, swim) {
  const deg = screenHeadingDeg(s.forward);
  const idx = deg == null ? s.lastIdx : angleIdx(deg);
  s.lastIdx = idx;
  const key = idx + "_" + (swim % 16);
  if (key !== s.lastKey) { drawShark(s, SHARK.frames[ANGLES[idx]][swim % 16]); s.lastKey = key; }
  s.sprite.position.copy(s.pos);
}

/* ============================================================ STATE */
let state = "menu";          // menu | playing | goal | over
let scores = { you: 0, bot: 0 };
let timeLeft = CFG.matchTime, suddenDeath = false, goalTimer = 0, menuT = 0, swimPhase = 0;
const input = { mx: 0, my: 0, boost: false, ballCam: false };
const _f = new THREE.Vector3(), _d = new THREE.Vector3(), _tmp = new THREE.Vector3();
const camLook = new THREE.Vector3();

function fwdFrom(yaw, pitch, out) {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

function resetEntities() {
  you.pos.set(0, 0, -CFG.AZ * 0.5); you.yaw = 0; you.pitch = 0; you.vel.set(0, 0, 0); you.speed = CFG.cruise; you.boostE = 1; you.hitCD = 0;
  fwdFrom(you.yaw, you.pitch, you.forward);
  bot.pos.set(0, 0, CFG.AZ * 0.5); bot.vel.set(0, 0, 0); bot.forward.set(0, 0, -1); bot.hitCD = 0;
  ball.pos.set(0, 0, 0); ball.vel.set(0, 0, 0);
}

function startMatch() {
  scores.you = 0; scores.bot = 0; timeLeft = CFG.matchTime; suddenDeath = false;
  resetEntities();
  state = "playing"; input.ballCam = false;
  // snap camera behind player
  fwdFrom(you.yaw, you.pitch, _f);
  camera.position.copy(you.pos).addScaledVector(_f, -CFG.camBack); camera.position.y += CFG.camUp;
  camLook.copy(you.pos).addScaledVector(_f, CFG.lookAhead);
  elStart.classList.add("hidden"); elOver.classList.add("hidden"); elHud.classList.remove("hidden");
  updateHud();
}

function kickoff() { resetEntities(); }

function scoreGoal(who) {
  scores[who]++;
  updateHud();
  banner(who === "you" ? "GOAL!" : "BOT SCORES", who === "you" ? "var(--cyan)" : "var(--red)");
  if (suddenDeath) { goalTimer = 1.6; state = "goal"; pendingEnd = true; return; }
  goalTimer = CFG.goalPause; state = "goal"; pendingEnd = false;
}
let pendingEnd = false;

function endMatch() {
  state = "over";
  elHud.classList.add("hidden");
  $("finalYou").textContent = scores.you;
  $("finalBot").textContent = scores.bot;
  const win = scores.you > scores.bot;
  $("overTitle").textContent = win ? "YOU WIN" : (scores.you < scores.bot ? "YOU LOSE" : "DRAW");
  $("overTitle").style.color = win ? "var(--cyan)" : "var(--red)";
  $("overMsg").textContent = win ? "The waters have been chummed. 🦈" : "You're gonna need a bigger boat.";
  elOver.classList.remove("hidden");
}

function banner(text, color) {
  elBannerTxt.textContent = text; elBannerTxt.style.color = color;
  elBanner.classList.remove("hidden");
  // retrigger pop animation
  elBannerTxt.style.animation = "none"; void elBannerTxt.offsetWidth; elBannerTxt.style.animation = "";
}
function hideBanner() { elBanner.classList.add("hidden"); }

function updateHud() {
  elYou.textContent = scores.you; elBot.textContent = scores.bot;
  elClock.textContent = suddenDeath ? "OT" : fmtTime(Math.max(0, timeLeft));
  elBoost.style.width = (you.boostE * 100).toFixed(0) + "%";
}
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + String(s).padStart(2, "0"); }

/* ============================================================ MAIN LOOP */
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  swimPhase += dt * CFG.tailBeat;
  const swim = Math.floor(swimPhase);

  if (state === "playing") { stepPlayer(dt); stepBot(dt); stepBall(dt); checkGoals(); stepClock(dt); }
  else if (state === "goal") { stepBall(dt); goalTimer -= dt; if (goalTimer <= 0) { hideBanner(); if (pendingEnd) endMatch(); else { kickoff(); state = "playing"; } } }

  // ball visuals
  ball.mesh.position.copy(ball.pos); ballLight.position.copy(ball.pos);
  ball.mesh.rotation.y += dt * 0.6; ball.mesh.rotation.x += dt * 0.4;

  updateCamera(dt);
  camera.updateMatrixWorld();

  if (state === "menu") menuT += dt;
  updateSharkVisual(you, swim);
  updateSharkVisual(bot, swim + 5);
  bot.sprite.visible = state !== "menu";

  if (state === "playing") { updateHud(); }

  renderer.render(scene, camera);
}

function stepPlayer(dt) {
  // steer from mouse offset (deadzone), full 3D
  const mx = Math.abs(input.mx) < 0.06 ? 0 : input.mx;
  const my = Math.abs(input.my) < 0.06 ? 0 : input.my;
  you.yaw += mx * CFG.turn * dt;
  you.pitch = THREE.MathUtils.clamp(you.pitch - my * CFG.turn * dt, -1.35, 1.35);
  fwdFrom(you.yaw, you.pitch, you.forward);

  const boosting = input.boost && you.boostE > 0;
  const target = boosting ? CFG.boost : CFG.cruise;
  you.speed += (target - you.speed) * Math.min(1, CFG.accel * dt);
  you.boostE = THREE.MathUtils.clamp(you.boostE + (boosting ? -CFG.boostDrain : CFG.boostRegen) * dt, 0, 1);

  you.vel.copy(you.forward).multiplyScalar(you.speed);
  you.pos.addScaledVector(you.vel, dt);
  clampToArena(you);
}

function stepBot(dt) {
  // get behind the ball relative to the PLAYER goal (-Z) so a ram pushes it that way
  _d.set(0, 0, -CFG.AZ).sub(ball.pos);                 // ball -> player goal
  if (_d.lengthSq() < 1) _d.set(0, 0, -1);
  _d.normalize();
  _tmp.copy(ball.pos).addScaledVector(_d, -(CFG.ballR + 22));   // approach point behind ball
  _f.copy(_tmp).sub(bot.pos);
  const dist = _f.length() || 1; _f.multiplyScalar(1 / dist);
  // desired velocity toward approach point
  _f.multiplyScalar(CFG.botSpeed);
  bot.vel.lerp(_f, 1 - Math.exp(-3 * dt));
  bot.pos.addScaledVector(bot.vel, dt);
  clampToArena(bot);
  if (bot.vel.lengthSq() > 0.5) bot.forward.copy(bot.vel).normalize();
  collideShark(bot);
  // player collision handled here too for symmetry
  collideShark(you);
}

function collideShark(s) {
  if (s.hitCD > 0) s.hitCD -= 1 / 60;
  _d.copy(ball.pos).sub(s.pos);
  const dist = _d.length(), min = CFG.ballR + CFG.sharkHitR;
  if (dist < min && s.hitCD <= 0) {
    _d.multiplyScalar(1 / (dist || 1));               // normal, ball-ward
    const power = CFG.hitBase + Math.max(0, s.vel.length()) * CFG.hitTransfer;
    ball.vel.addScaledVector(_d, power).addScaledVector(s.vel, 0.25);
    if (ball.vel.length() > CFG.ballMax) ball.vel.setLength(CFG.ballMax);
    ball.pos.copy(s.pos).addScaledVector(_d, min + 0.5);  // unstick
    s.hitCD = 0.12;
    s.vel.addScaledVector(_d, -power * 0.03);          // tiny recoil
  }
}

function stepBall(dt) {
  ball.vel.multiplyScalar(Math.max(0, 1 - CFG.ballDrag * dt));
  ball.pos.addScaledVector(ball.vel, dt);
  const { AX, AY, ballR, restit } = CFG;
  if (ball.pos.x > AX - ballR) { ball.pos.x = AX - ballR; ball.vel.x *= -restit; }
  if (ball.pos.x < -AX + ballR) { ball.pos.x = -AX + ballR; ball.vel.x *= -restit; }
  if (ball.pos.y > AY - ballR) { ball.pos.y = AY - ballR; ball.vel.y *= -restit; }
  if (ball.pos.y < -AY + ballR) { ball.pos.y = -AY + ballR; ball.vel.y *= -restit; }
  // Z walls handled in checkGoals (goal opening vs solid wall)
}

function checkGoals() {
  const { AZ, ballR, goalR, restit } = CFG;
  const inRing = Math.hypot(ball.pos.x, ball.pos.y) < goalR - ballR * 0.4;
  if (ball.pos.z > AZ - ballR) {
    if (inRing) { scoreGoal("you"); return; }
    ball.pos.z = AZ - ballR; ball.vel.z *= -restit;
  } else if (ball.pos.z < -AZ + ballR) {
    if (inRing) { scoreGoal("bot"); return; }
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
  if (s.pos.x > AX - r) { s.pos.x = AX - r; }
  if (s.pos.x < -AX + r) { s.pos.x = -AX + r; }
  if (s.pos.y > AY - r) { s.pos.y = AY - r; }
  if (s.pos.y < -AY + r) { s.pos.y = -AY + r; }
  if (s.pos.z > AZ - r) { s.pos.z = AZ - r; }
  if (s.pos.z < -AZ + r) { s.pos.z = -AZ + r; }
}

function updateCamera(dt) {
  if (state === "menu") {
    const r = CFG.AZ + 260, a = menuT * 0.18;
    camera.position.set(Math.sin(a) * r, 90 + Math.sin(menuT * 0.5) * 30, Math.cos(a) * r);
    camLook.lerp(_tmp.set(0, 0, 0), 1 - Math.exp(-3 * dt));
    camera.lookAt(0, 0, 0);
    return;
  }
  fwdFrom(you.yaw, you.pitch, _f);
  _tmp.copy(you.pos).addScaledVector(_f, -CFG.camBack); _tmp.y += CFG.camUp;
  camera.position.lerp(_tmp, 1 - Math.exp(-7 * dt));
  const lookTgt = input.ballCam ? ball.pos : _d.copy(you.pos).addScaledVector(_f, CFG.lookAhead);
  camLook.lerp(lookTgt, 1 - Math.exp(-9 * dt));
  camera.lookAt(camLook);
}

/* ============================================================ INPUT HANDLERS */
function onMove(e) {
  input.mx = (e.clientX / window.innerWidth) * 2 - 1;
  input.my = (e.clientY / window.innerHeight) * 2 - 1;
}
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
