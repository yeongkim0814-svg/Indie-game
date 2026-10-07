import * as THREE from "three";
import { recoilDeltaV } from "./physics/recoil";

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const hud = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * 0.85);

const scene = new THREE.Scene();
const skyTop = new THREE.Color("#7fb6ff");
const fog = new THREE.Color("#cfe6ff");
scene.background = fog;
scene.fog = new THREE.Fog(fog, 30, 160);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
camera.position.set(0, 6, 14);
camera.lookAt(0, 1, 0);

scene.add(new THREE.HemisphereLight(skyTop, 0x3a5a40, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.position.set(30, 50, 20);
scene.add(sun);

// Low-poly rolling ground (flat-shaded, vertex-colored)
const geo = new THREE.PlaneGeometry(300, 300, 60, 60).toNonIndexed();
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
const colors = new Float32Array(pos.count * 3);
const lo = new THREE.Color("#5e9b5a"), hi = new THREE.Color("#c9d98a");
const h = (x: number, z: number) => Math.sin(x * 0.05) * 3 + Math.cos(z * 0.04) * 3 + Math.sin((x + z) * 0.11) * 1.2;
for (let i = 0; i < pos.count; i++) {
  const y = h(pos.getX(i), pos.getZ(i));
  pos.setY(i, y);
  const c = lo.clone().lerp(hi, THREE.MathUtils.clamp((y + 6) / 12, 0, 1));
  colors.set([c.r, c.g, c.b], i * 3);
}
geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
geo.computeVertexNormals();
scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

// Placeholder character: body + oversized launcher
const player = new THREE.Group();
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1, 4, 8), new THREE.MeshLambertMaterial({ color: "#f2f5ff", flatShading: true }));
body.position.y = 1;
const launcher = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 1.8), new THREE.MeshLambertMaterial({ color: "#3b4a6b", flatShading: true }));
launcher.position.set(0.5, 1.3, 0);
player.add(body, launcher);
player.position.y = h(0, 0);
scene.add(player);

function resize() {
  const w = window.innerWidth, hgt = window.innerHeight;
  renderer.setSize(w, hgt, false);
  camera.aspect = w / hgt;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// Smoke test that physics module is wired in: firing down gives +y recoil.
const dv = recoilDeltaV(70, 2, 30, { x: 0, y: -1, z: 0 });

let frames = 0, last = performance.now(), fps = 0;
function loop(now: number) {
  player.rotation.y += 0.004;
  renderer.render(scene, camera);
  frames++;
  if (now - last > 500) {
    fps = Math.round((frames * 1000) / (now - last));
    frames = 0; last = now;
    hud.textContent = `M0 · ${fps} fps · Δv(down shot) = +${dv.y.toFixed(2)} m/s`;
    (window as unknown as { __fps: number; __ready: boolean }).__fps = fps;
  }
  (window as unknown as { __ready: boolean }).__ready = true;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
