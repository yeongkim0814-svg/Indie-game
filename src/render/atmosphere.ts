import * as THREE from "three";

/** Direction toward the sun: high and to the upper-left of the rim view (+x), as in the reference: clouds lit on their left side. */
export const SUN_DIR = new THREE.Vector3(0.3, 0.7, -0.65).normalize();

export const SKY = {
  zenith: new THREE.Color("#2c63a8"),
  /** cyan haze (~195°), not gray-white: distance reads as air */
  horizon: new THREE.Color("#a3cfe3"),
  sun: new THREE.Color("#fff4dc"),
};

/** Aerial perspective: color = obj·e^(−βd) + horizon·(1−e^(−βd)). */
export const FOG_DENSITY = 0.0015;
/** Clouds are much larger and farther; they get a lighter β so they keep their shape. */
export const CLOUD_FOG_DENSITY = 0.0005;

/** GLSL twin of world.ts terrainHeight — keep both in sync. */
export const GLSL_TERRAIN = /* glsl */ `
float terrainHeight(vec2 p) {
  float plateau = sin(p.x * 0.05) * 3.0 + cos(p.y * 0.04) * 3.0 + sin((p.x + p.y) * 0.11) * 1.2;
  vec2 e = vec2(p.x / 95.0, (p.y + 20.0) / 115.0);
  float a = atan(e.y, e.x);
  float k = length(e) + 0.07 * sin(a * 5.0 + 1.3) + 0.04 * sin(a * 13.0);
  float t = smoothstep(1.0, 1.16, k);
  if (t <= 0.0) return plateau;
  float mesa1 = smoothstep(180.0, 240.0, p.x) * (1.0 - smoothstep(260.0, 300.0, p.x)) * 8.0;
  float mesa2 = smoothstep(260.0, 310.0, p.x) * (1.0 - smoothstep(350.0, 380.0, p.x)) * 5.0;
  float promTheta = atan(p.y + 20.0, p.x - 85.0), promR = length(vec2(p.x - 85.0, p.y + 20.0));
  float promExpose = smoothstep(8.0, 12.0, promR) * (1.0 - smoothstep(0.5, 2.0, abs(promTheta + 1.5708)));
  float promDrop = promExpose > 0.5 ? -8.0 * (1.0 - promExpose) : 0.0;
  float river = 300.0 + 70.0 * sin(p.y * 0.006) + 30.0 * sin(p.y * 0.017);
  float carve = 6.0 * (1.0 - smoothstep(14.0, 34.0, abs(p.x - river)));
  float ridge = max(0.0, sin(p.x * 0.012 + cos(p.y * 0.009) * 2.0) * sin(p.y * 0.01 + 0.7));
  float hills = pow(ridge, 1.5) * 55.0 * smoothstep(130.0, 220.0, length(vec2(p.x, p.y + 20.0)));
  float valley = -38.0 + 3.0 * sin(p.x * 0.02) * cos(p.y * 0.017) + hills - carve;
  return mix(plateau, valley + promDrop, t);
}`;

export const GLSL_FOG = /* glsl */ `
const float FOG_MAX = 0.8;
vec3 applyAerial(vec3 col, float dist, float density, vec3 horizon) {
  float t = min(1.0 - exp(-density * dist), FOG_MAX);
  return mix(col, horizon, t);
}`;

/**
 * Match scene fog to the aerial formula and cap it so the farthest ridges keep a trace of their own shape
 * instead of dissolving completely into the horizon color.
 */
export function capSceneFog() {
  // Beer–Lambert exp(−βd) like the custom shaders, instead of three's exp(−(ρd)²).
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
    "exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )",
    "exp( - fogDensity * vFogDepth )",
  ).replace(
    "gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );",
    "gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( fogFactor, 0.8 ) );",
  );
}
