import { PITCH_ISO, PITCH_SIDE, YAW_ISO, makeView, type View } from "./project";

export type CamMode = "I" | "II";
export const TRANSITION = 0.9; // s

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Camera I (side, θ=0 φ=12°) <-> Camera II (isometric, θ=45° φ=30°). `u` runs 0..1 linearly at 1/TRANSITION per second
 * toward the target mode; yaw and pitch both follow ease(u), so the swing and the drop happen together.
 */
export class CameraRig {
  u = 1;
  mode: CamMode = "II";
  /** the world point the camera is centred on (follows the player smoothly) */
  focus = { x: 0, y: 0 };

  update(dt: number, mode: CamMode) {
    this.mode = mode;
    const target = mode === "II" ? 1 : 0;
    const step = dt / TRANSITION;
    this.u = this.u < target ? Math.min(target, this.u + step) : Math.max(target, this.u - step);
  }
  get yaw() { return YAW_ISO * ease(this.u); }
  get pitch() { return PITCH_SIDE + (PITCH_ISO - PITCH_SIDE) * ease(this.u); }
  get transitioning() { return this.u > 0 && this.u < 1; }
  /** 1 in camera I, 0 in camera II; the painted background fades with this */
  get background() { return Math.min(1, Math.max(0, 1 - (this.pitch - PITCH_SIDE) / (PITCH_ISO - PITCH_SIDE))); }
  view(): View { return makeView(this.yaw, this.pitch); }
}
