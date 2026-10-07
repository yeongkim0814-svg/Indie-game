import * as THREE from "three";
import { SKY, SUN_DIR } from "./atmosphere";

export function buildSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: SKY.zenith },
      uHorizon: { value: SKY.horizon },
      uSun: { value: SKY.sun },
      uSunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSun, uSunDir;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += noise(p) * a; p *= 2.07; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        // pale band only near the horizon; most of the sky is saturated blue (references: ~65% of frame)
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.5, h), 0.5));
        col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.25, d.y));
        // cirrus: streaks on a high plane, stretched along one wind direction
        if (d.y > 0.04) {
          vec2 q = d.xz / d.y * 1.6;
          q = mat2(0.86, -0.5, 0.5, 0.86) * q;
          float n = fbm(vec2(q.x * 0.35, q.y * 2.6));
          float wisp = smoothstep(0.55, 0.78, n) * smoothstep(0.04, 0.25, d.y) * (1.0 - smoothstep(0.6, 0.95, d.y));
          col = mix(col, vec3(1.15, 1.18, 1.2), wisp * 0.75);
        }
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 900.0) * 18.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
