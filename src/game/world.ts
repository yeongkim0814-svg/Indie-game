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
  const river = 70 + 140 * Math.sin(z * 0.004) + 40 * Math.sin(z * 0.011);
  const carve = 5 * (1 - smooth(10, 30, Math.abs(x - river)));
  const valley = VALLEY_FLOOR + 3 * Math.sin(x * 0.02) * Math.cos(z * 0.017) - carve;
  return plateau + (valley - plateau) * t;
}

/** Plateau the player starts on; keep in sync with GLSL_TERRAIN. */
export const PLATEAU = { rx: 95, rz: 115, cz: -20 };
export const VALLEY_FLOOR = -72;
export const WATER_LEVEL = -74.5;

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export const SPAWN = { x: 0, z: 0 };

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
  { x: 8, z: -8 },
  { x: -9, z: -12 },
  { x: 12, z: -18 },
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
  { x: -95, z: -170, hx: 22, hz: 34, top: 260 },
  { x: 120, z: -240, hx: 30, hz: 20, top: 330 },
  { x: 20, z: -420, hx: 26, hz: 26, top: 380 },
  { x: -230, z: 60, hx: 18, hz: 40, top: 240 },
];

/** Slab spanning the top of two monoliths (visual only, out of reach). */
export const SPANS: { a: number; b: number; y: number; thick: number; width: number }[] = [
  { a: 0, b: 1, y: 230, thick: 22, width: 30 },
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
