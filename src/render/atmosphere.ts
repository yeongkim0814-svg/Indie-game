import * as THREE from "three";

/** Direction toward the sun: high, behind-left of the default view so clouds face us lit. */
export const SUN_DIR = new THREE.Vector3(-0.45, 0.72, 0.52).normalize();

export const SKY = {
  zenith: new THREE.Color("#2f63b8"),
  horizon: new THREE.Color("#b9d3ee"),
  sun: new THREE.Color("#fff4dc"),
};

/** Aerial perspective: color = obj·e^(−βd) + horizon·(1−e^(−βd)). */
export const FOG_DENSITY = 0.0014;
/** Clouds are much larger and farther; they get a lighter β so they keep their shape. */
export const CLOUD_FOG_DENSITY = 0.0009;

/** GLSL twin of world.ts terrainHeight — keep both in sync. */
export const GLSL_TERRAIN = /* glsl */ `
float terrainHeight(vec2 p) {
  float plateau = sin(p.x * 0.05) * 3.0 + cos(p.y * 0.04) * 3.0 + sin((p.x + p.y) * 0.11) * 1.2;
  vec2 e = vec2(p.x / 95.0, (p.y + 20.0) / 115.0);
  float a = atan(e.y, e.x);
  float k = length(e) + 0.07 * sin(a * 5.0 + 1.3) + 0.04 * sin(a * 13.0);
  float t = smoothstep(1.0, 1.16, k);
  if (t <= 0.0) return plateau;
  float river = 70.0 + 140.0 * sin(p.y * 0.004) + 40.0 * sin(p.y * 0.011);
  float carve = 5.0 * (1.0 - smoothstep(10.0, 30.0, abs(p.x - river)));
  float valley = -72.0 + 3.0 * sin(p.x * 0.02) * cos(p.y * 0.017) - carve;
  return mix(plateau, valley, t);
}`;

export const GLSL_FOG = /* glsl */ `
vec3 applyAerial(vec3 col, float dist, float density, vec3 horizon) {
  float t = 1.0 - exp(-density * dist);
  return mix(col, horizon, t);
}`;
