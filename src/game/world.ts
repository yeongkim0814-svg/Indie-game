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
  return Math.sin(x * 0.05) * 3 + Math.cos(z * 0.04) * 3 + Math.sin((x + z) * 0.11) * 1.2;
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

export function heightAt(x: number, z: number): number {
  let h = terrainHeight(x, z);
  for (const p of PILLARS) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz <= p.r * p.r && p.top > h) h = p.top;
  }
  return h;
}
