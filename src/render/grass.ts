import * as THREE from "three";
import { FOG_DENSITY, GLSL_FOG, GLSL_TERRAIN, SKY, SUN_DIR } from "./atmosphere";

export const GRASS_TILE = 64;

/**
 * Instanced grass blades in a tile that wraps around the player, so a fixed
 * blade count always covers the area near the camera.
 */
export function buildGrass(count: number) {
  // one blade: 3 segments, tapering to a tip
  const seg = 3;
  const pos: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, w = 0.5 * (1 - t);
    if (i < seg) pos.push(-w, t, 0, w, t, 0); else pos.push(0, 1, 0);
  }
  const idx: number[] = [];
  for (let i = 0; i < seg - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const a = (seg - 1) * 2; idx.push(a, a + 1, a + 2);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const inst = new Float32Array(count * 4);
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) inst.set([r() * GRASS_TILE, r() * GRASS_TILE, r(), r()], i * 4);
  geo.setAttribute("aInst", new THREE.InstancedBufferAttribute(inst, 4));
  geo.instanceCount = count;

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uCam: { value: new THREE.Vector2() },
      uSunDir: { value: SUN_DIR },
      uHorizon: { value: SKY.horizon },
      uFog: { value: FOG_DENSITY },
      uTile: { value: GRASS_TILE },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uTile;
      uniform vec2 uCenter, uCam;
      attribute vec4 aInst;
      varying float vT, vRand, vFade;
      varying vec3 vView;
      varying vec2 vPatch;
      ${GLSL_TERRAIN}
      void main() {
        vec2 off = mod(aInst.xy - uCenter + uTile * 0.5, uTile) - uTile * 0.5;
        vec2 wp = uCenter + off;
        float dist = length(off);
        vFade = (1.0 - smoothstep(uTile * 0.32, uTile * 0.5, dist)) * smoothstep(1.5, 4.0, length(wp - uCam));
        float rand = aInst.z, rot = aInst.w * 6.2831;
        float slope = abs(terrainHeight(wp + vec2(0.7, 0.0)) - terrainHeight(wp - vec2(0.7, 0.0))) + abs(terrainHeight(wp + vec2(0.0, 0.7)) - terrainHeight(wp - vec2(0.0, 0.7)));
        vFade *= 1.0 - smoothstep(0.5, 1.0, slope);
        float flower = step(0.96, rand) * smoothstep(5.0, 8.0, length(wp - uCam));
        // short fringe: the meadow surface carries the look; blades only roughen edges and the rim
        float h = (0.08 + rand * 0.14) * vFade * mix(1.0, 0.75, flower);
        // wide blades: after the cluster filter they read as painted strokes, not single leaves
        float w = 0.1 + rand * 0.06;
        vec3 p = vec3(position.x * w * (1.0 + flower * step(0.6, position.y) * 1.5), position.y * h, 0.0);
        float c = cos(rot), s = sin(rot);
        p = vec3(p.x * c, p.y, p.x * s);
        float t = position.y;
        float gust = sin(uTime * 0.9 + wp.x * 0.05 + wp.y * 0.03) * 0.5 + 0.5;
        float sway = (sin(uTime * 2.3 + wp.x * 0.35 + wp.y * 0.25 + rand * 3.0) * 0.1 + 0.18 + gust * 0.3) * t * t;
        p.x += sway; p.z += sway * 0.6;
        vec3 world = vec3(wp.x, terrainHeight(wp), wp.y) + p;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        vT = t; vRand = rand; vView = mv.xyz; vPatch = wp / 2.5;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uHorizon;
      uniform float uFog;
      varying float vT, vRand, vFade;
      varying vec3 vView;
      varying vec2 vPatch;
      ${GLSL_FOG}
      void main() {
        if (vFade < 0.02) discard;
        vec3 root = vec3(0.04, 0.1, 0.02);
        vec3 tip = mix(vec3(0.12, 0.26, 0.04), vec3(0.24, 0.42, 0.06), vRand);
        // patches of sunlit tips (yellow-green), clustered by world position
        float sunlit = smoothstep(0.55, 0.8, fract(sin(dot(floor(vPatch), vec2(12.9898, 78.233))) * 43758.5453));
        tip = mix(tip, vec3(0.55, 0.69, 0.15), sunlit * vT * vT);
        vec3 col = mix(root, tip, vT);
        float sun = max(uSunDir.y, 0.0) * 1.25 + 0.35;
        col *= sun;
        if (vRand > 0.96 && vT > 0.6) col = vec3(1.6, 1.62, 1.6);
        col = applyAerial(col, length(vView), uFog, uHorizon);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms: mat.uniforms };
}
