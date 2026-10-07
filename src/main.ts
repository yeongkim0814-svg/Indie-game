import * as THREE from "three";
import { SLUGS } from "./game/config";
import { GameSim, idleInput, type SimInput } from "./game/sim";
import { SPAWN, heightAt } from "./game/world";
import { createHud } from "./ui/hud";
import { createInput } from "./ui/input";
import { buildMonoliths, buildTerrain } from "./render/terrain";
import { buildSky } from "./render/sky";
import { buildClouds } from "./render/clouds";
import { buildWanderer } from "./render/wanderer";
import { createPixelPipeline } from "./render/pixel";
import { FOG_DENSITY, SKY, SUN_DIR, capSceneFog } from "./render/atmosphere";

capSceneFog();

// ?lite: cheap scene for headless checks (software GL runs at ~1 fps otherwise)
const LITE = new URLSearchParams(location.search).has("lite");
const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
const pixel = createPixelPipeline(renderer);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(SKY.horizon, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 3200);
scene.add(new THREE.HemisphereLight(new THREE.Color("#bcd4f5"), new THREE.Color("#3f5530"), 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);

const sky = buildSky();
const clouds = buildClouds();
scene.add(sky, clouds, buildTerrain(LITE ? 90 : 300));

scene.add(buildMonoliths());


const sim = new GameSim();
const input = createInput(document.body);
input.yaw = SPAWN.yaw;
input.pitch = 0.12; // slightly up: sky fills ~60% of the frame, as in the references
const updateHud = createHud(document.body);

const player = new THREE.Group();
const wanderer = buildWanderer();
player.add(wanderer.root);
scene.add(player);

// ---- crates, slug pool ----
const crateMeshes = sim.crates.map(() => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshLambertMaterial({ color: "#8c8577" }));
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

// pixel-size toggle (comparison): x6 → x4 → x8 → smooth
const PX_STEPS = [6, 4, 8, 1];
const pxBtn = document.createElement("button");
pxBtn.id = "btn-px";
pxBtn.style.cssText = "position:fixed;right:max(12px,env(safe-area-inset-right));top:max(40px,env(safe-area-inset-top));z-index:5;" +
  "padding:6px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.6);background:rgba(10,16,34,.45);color:#fff;font:600 12px system-ui;";
const pxLabel = () => (pxBtn.textContent = pixel.scale === 1 ? "도트 끔" : `도트 x${pixel.scale}`);
pxBtn.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  pixel.setScale(PX_STEPS[(PX_STEPS.indexOf(pixel.scale) + 1) % PX_STEPS.length]);
  pxLabel();
});
document.body.appendChild(pxBtn);
pxLabel();

function resize() {
  pixel.resize();
  camera.aspect = window.innerWidth / window.innerHeight;
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
  while (acc >= FIXED) {
    simInput.jump = jumpQueued || (input.jumpHeld && sim.player.grounded && !sim.lookingDown);
    jumpQueued = false;
    simInput.launchJumpHeld = input.launchJumpHeld;
    simInput.jumpHeld = input.jumpHeld;
    sim.step(FIXED, simInput);
    acc -= FIXED;
  }

  // ---- sync visuals ----
  const p = sim.player.pos;
  player.position.set(p.x, p.y, p.z);
  const hv = Math.hypot(sim.player.vel.x, sim.player.vel.z);
  if (hv > 0.5) player.rotation.y = Math.atan2(-sim.player.vel.x, -sim.player.vel.z);
  tilt += ((sim.player.grounded ? 0 : THREE.MathUtils.clamp(sim.player.vel.y * 0.04, -0.5, 0.5)) - tilt) * 0.2;
  wanderer.root.rotation.x = -tilt * 0.5;
  wanderer.animate(dt, hv, sim.player.grounded);
  wanderer.glow.setRGB(0.5, 2.4, 1.9).multiplyScalar(0.3 + 0.7 * sim.energy.fraction);

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

  // third-person camera, far back so the wanderer stays small against the world
  const eye = new THREE.Vector3(p.x, p.y + 1.3, p.z);
  const right = new THREE.Vector3(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
  // Camera rides ~3 m above the wanderer regardless of pitch, so it clears the rim and sees
  // into the valley while still looking level or up (big sky, low horizon).
  const horiz = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
  const lift = 3 - Math.sin(input.pitch) * 6.6;
  const cam = eye.clone().addScaledVector(horiz, -11 * Math.cos(input.pitch)).addScaledVector(right, 0.9);
  cam.y += lift;
  cam.y = Math.max(cam.y, sim.player.pos.y - 0.6, heightAt(cam.x, cam.z) + 1.1);
  camera.position.copy(cam);
  camera.lookAt(eye.clone().addScaledVector(aimDir, 14).addScaledVector(right, 0.9).add(new THREE.Vector3(0, 3, 0)));
  sky.position.copy(camera.position);


  pixel.render(scene, camera);

  frames++;
  if (now - fpsClock > 500) {
    fps = Math.round((frames * 1000) / (now - fpsClock));
    frames = 0; fpsClock = now;
  }
  updateHud(sim, fps);
  const w = window as unknown as Record<string, unknown>;
  w.__fps = fps; w.__ready = true; w.__frame = ((w.__frame as number) ?? 0) + 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test/debug hook (used by headless checks).
(window as unknown as Record<string, unknown>).__game = { sim, input, pixel };
