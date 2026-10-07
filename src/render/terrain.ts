import * as THREE from "three";
import { MONOLITHS, PILLARS, SPANS, terrainHeight } from "../game/world";

function noise2(x: number, z: number) {
  return Math.sin(x * 0.013 + Math.sin(z * 0.021) * 2) * 0.5 + Math.sin(z * 0.017 + x * 0.006) * 0.5;
}

/** Ground: green near, fading into the aerial haze by the scene fog. */
export function buildTerrain(): THREE.Object3D {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1800, 1800, 180, 180);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color("#1f4214"), light = new THREE.Color("#5f8a26"), pale = new THREE.Color("#8fae4a");
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const n = noise2(x, z) * 0.5 + 0.5;
    c.copy(dark).lerp(light, n);
    if (n > 0.8) c.lerp(pale, (n - 0.8) * 3);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

  group.add(buildMountains());

  const rock = new THREE.MeshLambertMaterial({ color: "#7f8590" });
  for (const p of PILLARS) {
    const base = terrainHeight(p.x, p.z) - 8;
    const h = p.top - base;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.12, h, 7), rock);
    body.position.set(p.x, base + h / 2, p.z);
    group.add(body);
  }
  return group;
}

/** A jagged ring of distant ridges; fog turns them into pale blue layers. */
function buildMountains(): THREE.Mesh {
  const seg = 160;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const base = new THREE.Color("#4d6b4a"), rock = new THREE.Color("#6f7f96"), snow = new THREE.Color("#e8eef8");
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ridge = 90 + 110 * Math.abs(Math.sin(a * 3.1) * Math.cos(a * 1.7)) + 40 * Math.abs(Math.sin(a * 11.3));
    const rows: [number, number, THREE.Color][] = [
      [860, -5, base], [1000, ridge * 0.55, rock], [1080, ridge, ridge > 170 ? snow : rock], [1250, -5, rock],
    ];
    for (const [r, y, cc] of rows) { pos.push(Math.cos(a) * r, y, Math.sin(a) * r); col.push(cc.r, cc.g, cc.b); }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < 3; j++) {
      const a = i * 4 + j, b = a + 4;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
}

/** Mirror-like monoliths. `envMap` should be a capture of sky + clouds. */
export function buildMonoliths(envMap: THREE.Texture): THREE.Object3D {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#d3dde9", metalness: 0.85, roughness: 0.14, envMap, envMapIntensity: 0.95 });
  for (const m of MONOLITHS) {
    const base = terrainHeight(m.x, m.z) - 10;
    const h = m.top - base;
    const box = new THREE.Mesh(new THREE.BoxGeometry(m.hx * 2, h, m.hz * 2), mat);
    box.position.set(m.x, base + h / 2, m.z);
    group.add(box);
  }
  for (const s of SPANS) {
    const a = MONOLITHS[s.a], b = MONOLITHS[s.b];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(s.width, s.thick, len + 40), mat);
    slab.position.set((a.x + b.x) / 2, s.y, (a.z + b.z) / 2);
    slab.rotation.y = Math.atan2(dx, dz);
    group.add(slab);
  }
  return group;
}
