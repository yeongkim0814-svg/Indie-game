import * as THREE from "three";
import { MONOLITHS, PILLARS, SPANS, WATER_LEVEL, terrainHeight } from "../game/world";

function noise2(x: number, z: number) {
  return Math.sin(x * 0.013 + Math.sin(z * 0.021) * 2) * 0.5 + Math.sin(z * 0.017 + x * 0.006) * 0.5;
}

/** Ground: green near, fading into the aerial haze by the scene fog. */
export function buildTerrain(segments = 300): THREE.Object3D {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1800, 1800, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color("#1f4214"), light = new THREE.Color("#5f8a26"), pale = new THREE.Color("#8fae4a");
  const valleyLo = new THREE.Color("#2c5a2a"), valleyHi = new THREE.Color("#6b9a4a");
  const rockDark = new THREE.Color("#2b3240"), rockLight = new THREE.Color("#55606f");
  const c = new THREE.Color(), r = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise2(x, z) * 0.5 + 0.5;
    if (y > -20) { c.copy(dark).lerp(light, n); if (n > 0.8) c.lerp(pale, (n - 0.8) * 3); }
    else c.copy(valleyLo).lerp(valleyHi, n);
    // steep faces become rock: the cliff rim reads as stone, not stretched grass
    const steep = 1 - THREE.MathUtils.smoothstep(nrm.getY(i), 0.55, 0.85);
    r.copy(rockDark).lerp(rockLight, noise2(x * 3.1, y * 2.3) * 0.5 + 0.5);
    c.lerp(r, steep);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: "#8fc0e8", metalness: 0.6, roughness: 0.15 }),
  );
  water.position.y = WATER_LEVEL;
  group.add(water);

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
      [860, -75, base], [1000, ridge * 0.55, rock], [1080, ridge, ridge > 170 ? snow : rock], [1250, -75, rock],
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
  const mat = new THREE.MeshStandardMaterial({ color: "#c9d6e4", metalness: 0.55, roughness: 0.22, envMap, envMapIntensity: 0.8 });
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
