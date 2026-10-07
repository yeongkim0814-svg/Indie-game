/** Static world description shared by the simulation and the renderer. */

export interface Pillar {
  x: number;
  z: number;
  r: number;
  top: number;
  name: string;
}

/** Rolling hills (same function used to build the visual mesh). */
export function terrainHeight(x: number, z: number): number {
  const plateau = Math.sin(x * 0.05) * 3 + Math.cos(z * 0.04) * 3 + Math.sin((x + z) * 0.11) * 1.2;
  // Plateau = irregular ellipse; beyond its rim a cliff drops into the valley.
  const ex = x / PLATEAU.rx, ez = (z - PLATEAU.cz) / PLATEAU.rz;
  const a = Math.atan2(ez, ex);
  const k = Math.hypot(ex, ez) + 0.07 * Math.sin(a * 5 + 1.3) + 0.04 * Math.sin(a * 13);
  const t = smooth(1, 1.16, k);
  if (t <= 0) return plateau;
  // river crosses the rim view (+x) as a band at mid distance
  const river = 300 + 70 * Math.sin(z * 0.006) + 30 * Math.sin(z * 0.017);
  const carve = 6 * (1 - smooth(14, 34, Math.abs(x - river)));
  // rolling ridges inside the valley give layered silhouettes at mid distance
  const ridge = Math.max(0, Math.sin(x * 0.012 + Math.cos(z * 0.009) * 2) * Math.sin(z * 0.01 + 0.7));
  const hills = Math.pow(ridge, 1.5) * 55 * smooth(130, 220, Math.hypot(x, z + 20));
  const valley = VALLEY_FLOOR + 3 * Math.sin(x * 0.02) * Math.cos(z * 0.017) + hills - carve;
  return plateau + (valley - plateau) * t;
}

/** Plateau the player starts on; keep in sync with GLSL_TERRAIN. */
export const PLATEAU = { rx: 95, rz: 115, cz: -20 };
export const VALLEY_FLOOR = -38;
export const WATER_LEVEL = -40.5;

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Start at the plateau rim (cliff drops at x≈91), facing out over the valley (+x). */
export const SPAWN = { x: 85, z: -20, yaw: -Math.PI / 2 };

function pillarAt(x: number, z: number, r: number, rise: number, name: string): Pillar {
  return { x, z, r, top: terrainHeight(x, z) + rise, name };
}

// Isolated pillars: a short tutorial one and the summit that needs chained shots.
export const PILLARS: Pillar[] = [
  pillarAt(0, -22, 4, 6, "A"),
  pillarAt(-18, -42, 4.5, 13, "B"),
  pillarAt(14, -62, 5, 22, "SUMMIT"),
];
export const SUMMIT = PILLARS[2];

export const CRATE_SPAWNS = [
  { x: 70, z: -12 },
  { x: 64, z: -30 },
  { x: 58, z: -16 },
];

/** Colossal monoliths: axis-aligned boxes. `top` is world height of the roof. */
export interface Monolith {
  x: number;
  z: number;
  /** half extents of the footprint */
  hx: number;
  hz: number;
  top: number;
}

export const MONOLITHS: Monolith[] = [
  { x: 820, z: -620, hx: 45, hz: 45, top: 520 },
  { x: -420, z: -320, hx: 40, hz: 26, top: 380 },
  { x: -230, z: 60, hx: 18, hz: 40, top: 240 },
  { x: 120, z: -470, hx: 26, hz: 26, top: 360 },
];

/** Colossal tilted slabs hanging in the sky (visual only, out of reach). */
export const SLABS: { x: number; y: number; z: number; w: number; h: number; len: number; yaw: number; pitch: number }[] = [
  { x: 230, y: 330, z: 170, w: 120, h: 40, len: 900, yaw: 0.35, pitch: -0.32 },
];

export function heightAt(x: number, z: number): number {
  let h = terrainHeight(x, z);
  for (const m of MONOLITHS) {
    if (Math.abs(x - m.x) <= m.hx && Math.abs(z - m.z) <= m.hz && m.top > h) h = m.top;
  }
  for (const p of PILLARS) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz <= p.r * p.r && p.top > h) h = p.top;
  }
  return h;
}
