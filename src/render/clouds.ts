import * as THREE from "three";
import { CLOUD_FOG_DENSITY, GLSL_FOG, SKY, SUN_DIR } from "./atmosphere";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

interface Puff { x: number; y: number; z: number; r: number; shade: number }

/** Flat sea of cloud near the horizon. */
function stratus(out: Puff[], cx: number, cz: number, base: number, width: number, rand: () => number) {
  const n = Math.round(width / 9);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * width * 0.5;
    const r = 18 + rand() * 26;
    out.push({ x: cx + Math.cos(a) * d, y: base + rand() * 12, z: cz + Math.sin(a) * d * 0.5, r, shade: 0.35 + rand() * 0.3 });
  }
}

/**
 * One slice of a continuous cloud bank: wide at the base, narrowing upward, and
 * wider than the spacing between slices so neighbours merge into one wall.
 */
function bankSlice(out: Puff[], cx: number, cz: number, tx: number, tz: number, base: number, width: number, height: number, rand: () => number) {
  const n = Math.round(30 + (width * height) / 380);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(rand(), 1.15);
    const spread = width * (1 - 0.45 * t);
    // spread mostly along the bank (tangent), only a little in depth
    const along = (rand() - 0.5) * spread, depth = (rand() - 0.5) * spread * 0.45;
    const r = width * 0.16 * (0.6 + rand() * 0.8) * (1 - t * 0.35);
    out.push({ x: cx + tx * along - tz * depth, y: base + t * height, z: cz + tz * along + tx * depth, r, shade: t });
    // crown lumps on the upper part
    if (t > 0.55 && rand() < 0.35) {
      for (let k = 0; k < 3; k++) {
        const th = rand() * Math.PI * 2, ph = rand() * 1.1;
        out.push({
          x: cx + tx * along - tz * depth + Math.cos(th) * Math.sin(ph) * r, y: base + t * height + Math.cos(ph) * r * 0.9,
          z: cz + tz * along + tx * depth + Math.sin(th) * Math.sin(ph) * r, r: r * (0.3 + rand() * 0.25), shade: Math.min(1, t + 0.1),
        });
      }
    }
  }
}

/** A cloud wall along an arc around (ox, oz); `profile(u)` gives the height at u ∈ [0, 1]. */
function bank(out: Puff[], ox: number, oz: number, radius: number, a0: number, a1: number, step: number, base: number, profile: (u: number) => number, rand: () => number) {
  const count = Math.max(2, Math.round((Math.abs(a1 - a0) * radius) / step));
  for (let i = 0; i <= count; i++) {
    const u = i / count, a = a0 + (a1 - a0) * u;
    const rr = radius * (1 + (rand() - 0.5) * 0.12);
    const cx = ox + Math.cos(a) * rr, cz = oz + Math.sin(a) * rr;
    const h = profile(u) * (0.85 + rand() * 0.3);
    bankSlice(out, cx, cz, -Math.sin(a), Math.cos(a), base + (rand() - 0.5) * 10, step * 2.6, h, rand);
  }
}

export function buildClouds(): THREE.Mesh {
  const rand = rng(7);
  const puffs: Puff[] = [];
  const ox = 85, oz = -20; // around the rim spawn
  const bump = (u: number, c: number, w: number) => Math.exp(-(((u - c) / w) ** 2));
  // Main wall across the valley (+x): one continuous range, tallest a little right of center.
  bank(puffs, ox, oz, 720, -1.25, 1.25, 55, -38,
    (u) => 25 + 420 * bump(u, 0.6, 0.11) + 210 * bump(u, 0.74, 0.07) + 150 * bump(u, 0.28, 0.08) + 60 * bump(u, 0.9, 0.06) + 25 * Math.sin(u * 23) ** 2, rand);
  // Lower, farther wall behind it for depth.
  bank(puffs, ox, oz, 1050, -1.0, 1.1, 80, -30, (u) => 50 + 180 * bump(u, 0.45, 0.2) + 40 * Math.sin(u * 13) ** 2, rand);
  // Walls on the remaining sides so every direction stays open but framed.
  bank(puffs, ox, oz, 800, 1.6, 4.7, 80, -36, (u) => 40 + 200 * bump(u, 0.35, 0.12) + 160 * bump(u, 0.7, 0.1) + 30 * Math.sin(u * 17) ** 2, rand);
  // Sea of cloud filling the valley, densest toward the right-front.
  for (let i = 0; i < 12; i++) {
    const a = -1.3 + rand() * 2.6, d = 260 + rand() * 520;
    const dense = Math.exp(-(((a - 0.5) / 0.6) ** 2));
    if (rand() > 0.35 + 0.65 * dense) continue;
    stratus(puffs, ox + Math.cos(a) * d, oz + Math.sin(a) * d, -34 + rand() * 8, 160 + rand() * 140, rand);
  }

  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const center = new Float32Array(puffs.length * 4);
  const shade = new Float32Array(puffs.length);
  puffs.forEach((p, i) => { center.set([p.x, p.y, p.z, p.r], i * 4); shade[i] = p.shade; });
  geo.setAttribute("aCenter", new THREE.InstancedBufferAttribute(center, 4));
  geo.setAttribute("aShade", new THREE.InstancedBufferAttribute(shade, 1));
  geo.instanceCount = puffs.length;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: SUN_DIR },
      uHorizon: { value: SKY.horizon },
      uLit: { value: new THREE.Color("#ffffff").multiplyScalar(1.2) },
      uShadow: { value: new THREE.Color("#5680b6") },
      uFog: { value: CLOUD_FOG_DENSITY },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aCenter;
      attribute float aShade;
      varying vec2 vUv;
      varying vec3 vView;
      varying float vR, vShade, vSeed;
      void main() {
        vec4 mv = viewMatrix * vec4(aCenter.xyz, 1.0);
        mv.xy += position.xy * aCenter.w;
        vUv = position.xy;
        vView = mv.xyz;
        vR = aCenter.w;
        vShade = aShade;
        vSeed = fract(sin(dot(aCenter.xz, vec2(12.9898, 78.233))) * 43758.5453);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform mat4 projectionMatrix;
      uniform vec3 uSunDir, uHorizon, uLit, uShadow;
      uniform float uFog;
      varying vec2 vUv;
      varying vec3 vView;
      varying float vR, vShade, vSeed;
      ${GLSL_FOG}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        vec2 p = vUv;
        float bumps = noise(p * 2.6 + vSeed * 17.0) * 0.5 + noise(p * 6.0 - vSeed * 9.0) * 0.3 + noise(p * 13.0 + vSeed * 5.0) * 0.2;
        float d = length(p) + (bumps - 0.45) * 0.45;
        // ragged fringe: the outer band dissolves into scattered specks instead of a hard round edge
        float fringe = smoothstep(0.82, 1.0, d);
        if (d > 1.0 || hash(floor(gl_FragCoord.xy) + vSeed * 91.0) < fringe * 0.7) discard;
        float z = sqrt(max(1.0 - d * d, 0.0));
        // lumpy normal: breaks smooth sphere shading into cauliflower clusters
        vec2 lump = vec2(noise(p * 4.0 + vSeed * 31.0), noise(p * 4.0 - vSeed * 23.0)) - 0.5;
        vec3 n = normalize(vec3(p + lump * 0.55, z));
        vec3 sunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        // mostly white; blue shadow gathers on the underside and the side away from the sun
        // shade by height in the whole cloud first, puff normal only a little:
        // per-puff rim darkening otherwise speckles the interior
        float wrap = clamp(dot(n, sunView) * 0.5 + 0.7, 0.0, 1.0);
        float height = smoothstep(0.0, 0.7, vShade);
        float under = smoothstep(0.2, -0.8, n.y) * (1.0 - height);
        // folds: shade pattern continuous across puffs (view-space noise), so the mass reads as one volume
        vec2 vp2 = vView.xy / max(-vView.z, 1.0) * 60.0;
        float fold = noise(vp2 * 0.45) * 0.65 + noise(vp2 * 1.2) * 0.35;
        float lit = mix(0.5, 1.0, height) * mix(1.0, wrap, 0.25) * (1.0 - 0.35 * under) * mix(0.72, 1.06, smoothstep(0.3, 0.7, fold));
        vec3 col = mix(uShadow, uLit, smoothstep(0.4, 1.0, lit));
        // silver lining where the sun sits behind the puff
        float back = max(-sunView.z, 0.0);
        col += uLit * 0.35 * back * smoothstep(0.82, 0.97, d);
        // spherical impostor depth so puffs intersect as volumes, not flat cards
        vec3 vp = vec3(vView.xy, vView.z + z * vR);
        vec4 clip = projectionMatrix * vec4(vp, 1.0);
        gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
        col = applyAerial(col, length(vp), uFog, uHorizon);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
