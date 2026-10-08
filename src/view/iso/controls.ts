import type { Raid, RaidInput } from "../../game/raid";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Centre line (world y) of the contiguous '=' rows at the player's column; null when the column has no ledge near the player. */
export function laneCentre(raid: Raid, x: number, y: number): number | null {
  const rows = raid.map.rows, tx = Math.floor(x);
  const at = (ty: number) => rows[ty]?.[tx] === "=";
  let ty = Math.floor(y);
  if (!at(ty)) return null;
  let r0 = ty, r1 = ty;
  while (at(r0 - 1)) r0--;
  while (at(r1 + 1)) r1++;
  return (r0 + r1 + 1) / 2;
}

/**
 * Stick -> sim input. On ledge paths (camera I) the stick is locked to left/right along the ledge and y steers to the
 * lane centre; fire is off. In arenas (camera II) the stick is screen-relative: rotated by the current camera yaw.
 */
export function controls(raid: Raid, s: RaidInput, yaw: number): RaidInput {
  const p = raid.player.pos;
  if (raid.onPath) {
    const lane = laneCentre(raid, p.x, p.y);
    return { move: { x: s.move.x, y: lane === null ? 0 : clamp((lane - p.y) * 2, -1, 1) * 0.6 }, fire: false, dash: s.dash };
  }
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return { move: { x: s.move.x * c - s.move.y * sn, y: s.move.x * sn + s.move.y * c }, fire: s.fire, dash: s.dash };
}
