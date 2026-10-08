/**
 * Orthographic two-camera projection (prototype). World: x east, y south, z up, 1 tile = 1 m.
 *   a = x·cosθ + y·sinθ            (screen right)
 *   b = −x·sinθ + y·cosθ           (horizontal axis toward the camera)
 *   screenX = a·S,  screenY = (b·sinφ − z·cosφ)·S,  depth = b·cosφ + z·sinφ (larger = nearer, drawn later)
 * θ = 0, φ = 0 is a pure side view looking north (−y). θ = 45°, φ = 30° is the 2:1 isometric diamond.
 */
export const S = 16;
export const YAW_ISO = Math.PI / 4;
export const PITCH_ISO = Math.PI / 6;

export interface View { yaw: number; pitch: number; c: number; s: number; cp: number; sp: number }

export function makeView(yaw: number, pitch: number): View {
  return { yaw, pitch, c: Math.cos(yaw), s: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch) };
}

export interface Projected { sx: number; sy: number; depth: number }

/** Project a world point; writes into `out` (allocated once by the caller) and returns it. */
export function project(v: View, x: number, y: number, z: number, out: Projected = { sx: 0, sy: 0, depth: 0 }): Projected {
  const a = x * v.c + y * v.s;
  const b = -x * v.s + y * v.c;
  out.sx = a * S;
  out.sy = (b * v.sp - z * v.cp) * S;
  out.depth = b * v.cp + z * v.sp;
  return out;
}

export function depthOf(v: View, x: number, y: number, z: number): number {
  return (-x * v.s + y * v.c) * v.cp + z * v.sp;
}

/** Unit vector from the scene toward the camera (the gradient of depth). */
export function toCamera(v: View): [number, number, number] {
  return [-v.s * v.cp, v.c * v.cp, v.sp];
}

/** Does a face with outward normal (nx, ny, nz) face the camera? */
export function faceVisible(v: View, nx: number, ny: number, nz: number): boolean {
  const [cx, cy, cz] = toCamera(v);
  return nx * cx + ny * cy + nz * cz > 0.02;
}

/** Screen-right component of a world direction (for left/right face shading and for input rotation). */
export function screenRight(v: View, nx: number, ny: number): number {
  return nx * v.c + ny * v.s;
}
