import * as THREE from "three";
import { GLSL_TERRAIN } from "./atmosphere";
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
  group.add(new THREE.Mesh(geo, meadowMaterial()));

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800).rotateX(-Math.PI / 2),
    // unlit: the river reads as a bright band of reflected sky
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#8fc6ea") }),
  );
  water.position.y = WATER_LEVEL;
  group.add(water);

  group.add(buildMountains(560, 860, 0.0042, 0.32, 7), buildMountains(950, 1500, 0.0028, 0.9, 3));

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

/**
 * Ground material: on grassy (green) vertices, replace the flat color with a mottled
 * meadow — multi-scale patches from dark green to sunlit yellow-green — plus white
 * flower specks on a world grid. Perspective squashes the patches into horizontal
 * bands, which is how the reference grass reads.
 */
function meadowMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying float vSlope;\nvarying vec3 vWN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);\nvSlope = 1.0 - vWN.y;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;
varying float vSlope;
varying vec3 vWN;
${GLSL_TERRAIN}
float mh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mn(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mh(i), mh(i + vec2(1, 0)), u.x), mix(mh(i + vec2(0, 1)), mh(i + vec2(1, 1)), u.x), u.y);
}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec3 vc = vColor.rgb;
  float grassy = smoothstep(0.0, 0.04, vc.g - max(vc.r, vc.b) * 1.05) * step(-12.0, vWPos.y);
  vec2 q = vWPos.xz;
  // big patches + turf octaves at ~0.3-0.8 m so every low-res pixel gets its own tone
  float n = mn(q * 0.07) * 0.34 + mn(q * 0.23 + 7.1) * 0.22 + mn(q * 0.9 - 3.3) * 0.14 + mn(q * 1.9 + 1.7) * 0.15 + mn(q * 3.7 - 8.2) * 0.15;
  n = clamp((n - 0.5) * 1.5 + 0.42, 0.0, 1.0);
  // ramp (linear of #192925 #273e2b #395330 #537039 #8a9f48): teal shade -> olive highlight only in sun patches
  vec3 c0 = vec3(0.0097, 0.0222, 0.0185), c1 = vec3(0.0203, 0.0482, 0.0242), c2 = vec3(0.0409, 0.0865, 0.0296), c3 = vec3(0.0865, 0.162, 0.0409), c4 = vec3(0.254, 0.347, 0.0648);
  vec3 g = mix(c0, c1, smoothstep(0.1, 0.3, n));
  g = mix(g, c2, smoothstep(0.3, 0.5, n));
  g = mix(g, c3, smoothstep(0.5, 0.72, n));
  float sunP = smoothstep(0.55, 0.8, mn(q * 0.11 + 21.0));
  g = mix(g, c4, smoothstep(0.7, 0.95, n) * sunP);
  // rock is exposed by shape: steep faces are rock with a thin turf lip above them (narrow smoothstep)
  float cliff = smoothstep(0.2, 0.26, vSlope);
  // near a convex edge (big drop within ~4 m) a few small stones break through the turf
  float drop = 0.0;
  if (vWPos.y > -12.0) {
    float h0 = terrainHeight(q);
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7853982;
      drop = max(drop, h0 - terrainHeight(q + 4.0 * vec2(cos(ang), sin(ang))));
    }
  }
  float edge = smoothstep(3.0, 9.0, drop);
  vec2 sc = floor(q / 0.6);
  vec2 sf = fract(q / 0.6) - 0.5 - (vec2(mh(sc + 1.3), mh(sc + 5.9)) - 0.5) * 0.4;
  float stone = step(1.0 - 0.14 * edge, mh(sc + 17.0)) * step(length(sf), 0.14 + 0.1 * mh(sc + 2.2));
  float rock = max(cliff, stone);
  // strata: noise stretched along y gives vertical streaks, dark recesses to lit facets (#1c2833 .. #4f6070)
  float st = mn(vec2(q.x * 0.8 + q.y * 0.8, vWPos.y * 0.15)) * 0.65 + mn(vec2(q.x * 2.3 - q.y * 2.1, vWPos.y * 0.5)) * 0.35;
  vec3 rockC = mix(vec3(0.011, 0.021, 0.033), vec3(0.078, 0.117, 0.162), smoothstep(0.3, 0.75, st));
  g = mix(g, rockC, rock);
  // flowers in drifts: dense inside drift patches, sparse elsewhere; one speck per 0.45 m cell
  float drift = smoothstep(0.5, 0.78, mn(q * 0.045 + 11.0));
  vec2 cell = floor(q / 0.45);
  vec2 f = fract(q / 0.45) - 0.5 - (vec2(mh(cell + 3.7), mh(cell + 9.1)) - 0.5) * 0.5;
  float chance = mix(0.06, 0.45, drift);
  float flower = step(1.0 - chance, mh(cell)) * step(length(f), 0.2) * (1.0 - rock) * (1.0 - smoothstep(30.0, 45.0, length(vViewPosition)));
  g = mix(g, vec3(0.95), flower);
  grassy = max(grassy, rock * step(-12.0, vWPos.y));
  // valley: fields/terraces squeezed into horizontal bands: lit green tops, blue shaded flanks
  float vmask = 1.0 - step(-12.0, vWPos.y);
  {
    float fld = mn(vec2(q.x * 0.16, q.y * 0.012)) * 0.6 + mn(vec2(q.x * 0.5 + 3.0, q.y * 0.05)) * 0.25 + mn(vec2(q.x * 1.3, q.y * 0.2)) * 0.15;
    float lit = dot(normalize(vWN), vec3(0.3, 0.7, -0.65)) / 0.75;
    float s = lit * 1.2 + (fld - 0.5) * 1.1 - 0.35;
    vec3 vb = mix(vec3(0.012, 0.05, 0.15), vec3(0.05, 0.16, 0.31), smoothstep(0.1, 0.5, fld));
    vec3 vg = mix(vec3(0.07, 0.2, 0.09), vec3(0.4, 0.52, 0.2), smoothstep(0.45, 0.75, fld));
    vec3 vv = mix(vb, vg, smoothstep(0.35, 0.6, s));
    g = mix(g, vv, vmask * (1.0 - cliff));
    grassy = max(grassy, vmask * (1.0 - cliff));
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, g, grassy);
}`);
  };
  return mat;
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
