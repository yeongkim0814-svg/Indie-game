import * as THREE from "three";
import { SLUGS } from "./game/config";
import { GameSim, idleInput, type SimInput } from "./game/sim";
import { createHud } from "./ui/hud";
import { createInput } from "./ui/input";
import { buildTerrain } from "./render/terrain";

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * 0.85);

const scene = new THREE.Scene();
const fog = new THREE.Color("#cfe6ff");
scene.background = fog;
scene.fog = new THREE.Fog(fog, 40, 190);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 320);
scene.add(new THREE.HemisphereLight(new THREE.Color("#7fb6ff"), 0x3a5a40, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.position.set(30, 50, 20);
scene.add(sun);
scene.add(buildTerrain());

const sim = new GameSim();
const input = createInput(document.body);
const updateHud = createHud(document.body);

// ---- character: capsule body + oversized launcher that points along the aim ----
const player = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.42, 0.9, 4, 8),
  new THREE.MeshLambertMaterial({ color: "#f2f5ff", flatShading: true }),
);
body.position.y = 0.95;
const cloak = new THREE.Mesh(
  new THREE.ConeGeometry(0.55, 1.1, 6),
  new THREE.MeshLambertMaterial({ color: "#e0654f", flatShading: true }),
);
cloak.position.set(0, 0.85, 0.2);
const launcherPivot = new THREE.Group();
launcherPivot.position.set(0, 1.3, 0);
const launcher = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.34, 1.7),
  new THREE.MeshLambertMaterial({ color: "#3b4a6b", flatShading: true }),
);
launcher.position.set(0.3, 0, 0.6);
const glow = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.06, 1.2),
  new THREE.MeshBasicMaterial({ color: "#69e3c0" }),
);
glow.position.set(0.3, 0.19, 0.6);
launcherPivot.add(launcher, glow);
player.add(body, cloak);
scene.add(player, launcherPivot);

// ---- crates, slug pool ----
const crateMeshes = sim.crates.map(() => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshLambertMaterial({ color: "#c98f4a", flatShading: true }));
  scene.add(m);
  return m;
});
const slugMesh = {
  heavy: new THREE.SphereGeometry(SLUGS.heavy.radius, 8, 6),
  light: new THREE.SphereGeometry(SLUGS.light.radius, 6, 5),
};
const slugMat = {
  heavy: new THREE.MeshLambertMaterial({ color: SLUGS.heavy.color }),
  light: new THREE.MeshBasicMaterial({ color: SLUGS.light.color }),
};
const slugPool: THREE.Mesh[] = [];

interface Puff { mesh: THREE.Mesh; life: number }
const puffs: Puff[] = [];
function puff(x: number, y: number, z: number, color: number, size: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  puffs.push({ mesh, life: 0.35 });
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const aimDir = new THREE.Vector3();
function aimFrom(yaw: number, pitch: number, out: THREE.Vector3) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

const simInput: SimInput = idleInput();
let jumpWasHeld = false;
let launchWasHeld = false;
let frames = 0, fpsClock = performance.now(), fps = 0;
let last = performance.now(), acc = 0, tilt = 0;
const FIXED = 1 / 120;

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt;

  aimFrom(input.yaw, input.pitch, aimDir);
  simInput.moveX = input.moveX; simInput.moveY = input.moveY; simInput.run = input.run;
  simInput.yaw = input.yaw; simInput.fireHeld = input.fireHeld; simInput.switchSlug = input.switchPressed;
  simInput.aim = { x: aimDir.x, y: aimDir.y, z: aimDir.z };
  const jumpEdge = input.jumpHeld && !jumpWasHeld;
  jumpWasHeld = input.jumpHeld;
  let jumpQueued = jumpEdge;
  let launchQueued = input.launchJumpHeld && !launchWasHeld;
  launchWasHeld = input.launchJumpHeld;
  while (acc >= FIXED) {
    simInput.jump = jumpQueued || (input.jumpHeld && sim.player.grounded && !sim.lookingDown);
    jumpQueued = false;
    simInput.launchJump = launchQueued;
    launchQueued = false;
    sim.step(FIXED, simInput);
    acc -= FIXED;
  }

  // ---- sync visuals ----
  const p = sim.player.pos;
  player.position.set(p.x, p.y, p.z);
  const hv = Math.hypot(sim.player.vel.x, sim.player.vel.z);
  if (hv > 0.5) player.rotation.y = Math.atan2(-sim.player.vel.x, -sim.player.vel.z);
  // lean into velocity change (cloth/recoil read)
  tilt += ((sim.player.grounded ? 0 : THREE.MathUtils.clamp(sim.player.vel.y * 0.04, -0.5, 0.5)) - tilt) * 0.2;
  body.rotation.x = -tilt;
  cloak.rotation.x = 0.25 + tilt * 0.8 + Math.min(0.9, hv * 0.05);
  launcherPivot.position.set(p.x, p.y + 1.3, p.z);
  launcherPivot.lookAt(p.x + aimDir.x * 10, p.y + 1.3 + aimDir.y * 10, p.z + aimDir.z * 10);
  (glow.material as THREE.MeshBasicMaterial).color.setHSL(0.45 - 0.45 * (1 - sim.energy.fraction) * 0.9, 0.7, 0.35 + 0.35 * sim.energy.fraction);
  const kick = sim.charging ? sim.charge * 0.12 : 0;
  launcher.position.z = 0.6 - kick;

  sim.crates.forEach((c, i) => crateMeshes[i].position.set(c.pos.x, c.pos.y + 0.55, c.pos.z));

  while (slugPool.length < sim.slugs.length) {
    const m = new THREE.Mesh(slugMesh.heavy, slugMat.heavy);
    scene.add(m);
    slugPool.push(m);
  }
  slugPool.forEach((m, i) => {
    const s = sim.slugs[i];
    m.visible = !!s;
    if (s) {
      m.position.set(s.pos.x, s.pos.y, s.pos.z);
      m.geometry = slugMesh[s.type];
      m.material = slugMat[s.type];
    }
  });

  for (const e of sim.events.splice(0)) {
    const col = e.kind === "muzzle" ? 0xfff2b0 : e.kind === "crate" ? 0xffc07a : 0xd9e8c4;
    puff(e.pos.x, e.pos.y, e.pos.z, col, e.kind === "muzzle" ? 0.35 : 0.5);
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const f = puffs[i];
    f.life -= dt;
    f.mesh.scale.multiplyScalar(1 + dt * 5);
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.life / 0.35) * 0.8;
    if (f.life <= 0) { scene.remove(f.mesh); f.mesh.geometry.dispose(); (f.mesh.material as THREE.Material).dispose(); puffs.splice(i, 1); }
  }

  // third-person camera, slightly over the shoulder
  const eye = new THREE.Vector3(p.x, p.y + 1.5, p.z);
  const right = new THREE.Vector3(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
  const cam = eye.clone().addScaledVector(aimDir, -7.5).addScaledVector(right, 0.7);
  cam.y = Math.max(cam.y, sim.player.pos.y - 1, 0.5);
  camera.position.copy(cam);
  camera.lookAt(eye.clone().addScaledVector(aimDir, 14).addScaledVector(right, 0.7));

  renderer.render(scene, camera);

  frames++;
  if (now - fpsClock > 500) {
    fps = Math.round((frames * 1000) / (now - fpsClock));
    frames = 0; fpsClock = now;
  }
  updateHud(sim, fps);
  const w = window as unknown as Record<string, unknown>;
  w.__fps = fps; w.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by headless checks).
(window as unknown as Record<string, unknown>).__game = { sim, input };
