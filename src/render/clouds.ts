import * as THREE from "three";
import { CLOUD_FOG_DENSITY, GLSL_FOG, SKY, SUN_DIR } from "./atmosphere";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

interface Puff { x: number; y: number; z: number; r: number; shade: number }

/** Towering cumulus: wide base, cauliflower puffs shrinking with height. */
function cumulus(out: Puff[], cx: number, cz: number, base: number, width: number, height: number, rand: () => number) {
  const n = Math.round(30 + (width * height) / 400);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(rand(), 0.8);
    const spread = width * (1 - t * 0.55);
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * spread * 0.5;
    const r = (width * 0.22) * (1 - t * 0.45) * (0.7 + rand() * 0.6);
    out.push({ x: cx + Math.cos(a) * d, y: base + t * height, z: cz + Math.sin(a) * d * 0.7, r, shade: t });
  }
  // small cauliflower lumps on the upper surface: the reference's dense pixel clusters
  const big = out.slice(-n);
  for (const p of big) {
    if (p.shade < 0.35) continue;
    const k = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < k; i++) {
      const th = rand() * Math.PI * 2, ph = rand() * 1.2;
      const rr = p.r * (0.28 + rand() * 0.22);
      out.push({
        x: p.x + Math.cos(th) * Math.sin(ph) * p.r * 0.9, y: p.y + Math.cos(ph) * p.r * 0.85,
        z: p.z + Math.sin(th) * Math.sin(ph) * p.r * 0.9, r: rr, shade: Math.min(1, p.shade + 0.15),
      });
    }
  }
}

/** Flat sea of cloud near the horizon. */
function stratus(out: Puff[], cx: number, cz: number, base: number, width: number, rand: () => number) {
  const n = Math.round(width / 9);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * width * 0.5;
    const r = 18 + rand() * 26;
    out.push({ x: cx + Math.cos(a) * d, y: base + rand() * 12, z: cz + Math.sin(a) * d * 0.5, r, shade: 0.35 + rand() * 0.3 });
  }
}

export function buildClouds(): THREE.Mesh {
  const rand = rng(7);
  const puffs: Puff[] = [];
  // Cloud walls framing the monolith valley ahead, plus some all around for 360° openness.
  // Towers framing the view from the rim (+x), plus a ring for 360° openness.
  const towers: [number, number, number, number][] = [
    [900, 120, 360, 420], [520, -420, 180, 300], [760, -360, 220, 320], [420, 470, 200, 280],
    [720, 300, 200, 280], [-420, -260, 160, 220], [-480, 200, 150, 200], [60, 520, 170, 220],
    [80, -620, 200, 260], [-150, 700, 220, 260],
  ];
  for (const [x, z, w, h] of towers) cumulus(puffs, x, z, -30 + rand() * 25, w, h, rand);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand() * 0.2, d = 820 + rand() * 200;
    stratus(puffs, Math.cos(a) * d, Math.sin(a) * d, -34 + rand() * 14, 260, rand);
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
      uLit: { value: new THREE.Color("#ffffff").multiplyScalar(1.8) },
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
        float bumps = noise(p * 2.6 + vSeed * 17.0) * 0.55 + noise(p * 6.0 - vSeed * 9.0) * 0.25;
        float d = length(p) + (bumps - 0.4) * 0.35;
        if (d > 1.0) discard;
        float z = sqrt(max(1.0 - d * d, 0.0));
        // lumpy normal: breaks smooth sphere shading into cauliflower clusters
        vec2 lump = vec2(noise(p * 4.0 + vSeed * 31.0), noise(p * 4.0 - vSeed * 23.0)) - 0.5;
        vec3 n = normalize(vec3(p + lump * 0.55, z));
        vec3 sunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        // mostly white; blue shadow gathers on the underside and the side away from the sun
        float wrap = clamp(dot(n, sunView) * 0.5 + 0.62, 0.0, 1.0);
        float under = smoothstep(0.35, -0.6, n.y + (vShade - 0.4));
        float lit = wrap * (1.0 - 0.55 * under);
        vec3 col = mix(uShadow, uLit, smoothstep(0.15, 0.95, lit));
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
