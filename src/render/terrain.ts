import * as THREE from "three";
import { MONOLITHS, PILLARS, SLABS, VALLEY_FLOOR, WATER_LEVEL, terrainHeight } from "../game/world";

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, y * f) * amp; f *= 2.03; amp *= 0.5; }
  return v;
}
/** Ridged noise: sharp crests, like eroded mountain spines. */
function ridged(x: number, y: number) {
  let v = 0, amp = 0.55, f = 1;
  for (let i = 0; i < 5; i++) { v += (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)) ** 2 * amp; f *= 2.1; amp *= 0.5; }
  return v;
}

/**
 * Ground colors follow the reference: dark, muted foreground greens; steep faces
 * become deep blue-gray rock. Distance and haze are left to the fog.
 */
export function buildTerrain(segments = 300): THREE.Object3D {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1800, 1800, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const g0 = new THREE.Color("#1b3317"), g1 = new THREE.Color("#33522a"), g2 = new THREE.Color("#5e7d3c");
  const v0 = new THREE.Color("#5f9460"), v1 = new THREE.Color("#b2d488");
  const r0 = new THREE.Color("#162430"), r1 = new THREE.Color("#2f4352");
  const c = new THREE.Color(), r = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm(x * 0.02, z * 0.02);
    if (y > -12) {
      c.copy(g0).lerp(g1, THREE.MathUtils.smoothstep(n, 0.3, 0.6));
      c.lerp(g2, THREE.MathUtils.smoothstep(n, 0.62, 0.8) * 0.8);
    } else c.copy(v0).lerp(v1, n);
    const steep = 1 - THREE.MathUtils.smoothstep(nrm.getY(i), 0.55, 0.85);
    r.copy(r0).lerp(r1, fbm(x * 0.08, y * 0.12));
    c.lerp(r, steep);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800).rotateX(-Math.PI / 2),
    // unlit: the river reads as a bright band of reflected sky
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#d6ecf7").multiplyScalar(1.15) }),
  );
  water.position.y = WATER_LEVEL;
  group.add(water);

  group.add(buildMountains(560, 860, 0.0042, 0.75, 7), buildMountains(950, 1500, 0.0028, 1.35, 3));

  const rock = new THREE.MeshLambertMaterial({ color: "#3a4c5c" });
  for (const p of PILLARS) {
    const base = terrainHeight(p.x, p.z) - 8;
    const h = p.top - base;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.12, h, 7), rock);
    body.position.set(p.x, base + h / 2, p.z);
    group.add(body);
  }
  return group;
}

/** A ring of ridged mountains between radius r0 and r1, lit by the sun so ridges get a light and a shadow side. */
function buildMountains(r0: number, r1: number, freq: number, heightScale: number, seed: number): THREE.Mesh {
  const segA = 280, segR = 14;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const grass = new THREE.Color("#3f6a45"), rock = new THREE.Color("#5c6f86"), snow = new THREE.Color("#eef3f8");
  const c = new THREE.Color();
  for (let i = 0; i <= segA; i++) {
    const a = (i / segA) * Math.PI * 2;
    for (let j = 0; j <= segR; j++) {
      const t = j / segR, rr = r0 + (r1 - r0) * t;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const profile = Math.sin(Math.PI * t) ** 0.7;
      const h = profile * (60 + 330 * ridged(x * freq + seed, z * freq - seed)) * heightScale;
      const y = VALLEY_FLOOR - 4 + h;
      pos.push(x, y, z);
      c.copy(grass).lerp(rock, THREE.MathUtils.smoothstep(h, 30, 120));
      if (h > 260 * heightScale) c.lerp(snow, THREE.MathUtils.smoothstep(h, 260 * heightScale, 320 * heightScale));
      col.push(c.r, c.g, c.b);
    }
  }
  const row = segR + 1;
  for (let i = 0; i < segA; i++) {
    for (let j = 0; j < segR; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

/**
 * Monoliths: sky-colored, featureless, defined only by clean edges and the
 * value step between the sunlit face and the shaded face.
 */
export function buildMonoliths(): THREE.Object3D {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: "#3d74bd" });
  for (const m of MONOLITHS) {
    const base = terrainHeight(m.x, m.z) - 10;
    const h = m.top - base;
    const box = new THREE.Mesh(new THREE.BoxGeometry(m.hx * 2, h, m.hz * 2), mat);
    box.position.set(m.x, base + h / 2, m.z);
    group.add(box);
  }
  const slabMat = new THREE.MeshLambertMaterial({ color: "#4a80c6" });
  for (const s of SLABS) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.len), slabMat);
    slab.position.set(s.x, s.y, s.z);
    slab.rotation.set(s.pitch, s.yaw, 0, "YXZ");
    group.add(slab);
  }
  return group;
}
