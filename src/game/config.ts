/** Gameplay constants. Masses are intentionally exaggerated (see GAME_PLAN §3 "게임화와 현실 차이"). */
export const G = 18;
/** Effective shooter mass (suit + launcher). Real m/M would make recoil imperceptible. */
export const SHOOTER_MASS = 20;

export const WALK_SPEED = 5;
export const RUN_SPEED = 8.5;
export const JUMP_SPEED = 7.5;
export const GROUND_ACCEL = 45;
export const AIR_ACCEL = 7;
/** Deceleration when above run speed on the ground (recoil dashes slide for a moment). */
export const OVERSPEED_FRICTION = 9;
export const STEP_HEIGHT = 0.6;
/** Quadratic air drag coefficient × air density. */
export const DRAG = 0.004;

export const CHARGE_TIME = 0.7;
export const MIN_CHARGE = 0.3;
export const FIRE_COOLDOWN = 0.12;
export const SLUG_LIFETIME = 4;

export type SlugId = "heavy" | "light";

export interface SlugType {
  id: SlugId;
  name: string;
  mass: number;
  minSpeed: number;
  maxSpeed: number;
  radius: number;
  color: string;
}

export const SLUGS: Record<SlugId, SlugType> = {
  heavy: { id: "heavy", name: "중량탄", mass: 6, minSpeed: 8, maxSpeed: 30, radius: 0.28, color: "#2c3350" },
  light: { id: "light", name: "경량탄", mass: 1, minSpeed: 20, maxSpeed: 70, radius: 0.13, color: "#ffd25e" },
};
export const SLUG_ORDER: SlugId[] = ["heavy", "light"];

export const ENERGY_MAX = 7000;
export const ENERGY_REGEN_GROUND = 2200;
export const ENERGY_REGEN_AIR = 0;

export const CRATE_MASS = 40;
export const CRATE_FRICTION = 7;

/** Launcher jump: always a heavy slug at this charge, so it is a reliable, energy-hungry jump. */
export const LAUNCH_JUMP_SLUG: SlugId = "heavy";
/** Hold the launcher-jump button to charge: strength (= slug charge) goes from MIN (tap) to 1 (full hold) over JUMP_CHARGE_TIME. */
export const LAUNCH_JUMP_CHARGE_MIN = 0.5;
export const JUMP_CHARGE_TIME = 0.5;
/**
 * Launcher-jump elevation (above horizontal) depends on how far the stick is pushed:
 * idle (< STICK_MIN) = straight up, full push / sprint = MIN elevation, linear in between.
 */
export const LAUNCH_JUMP_ELEVATION_MAX = Math.PI / 2;
export const LAUNCH_JUMP_ELEVATION_MIN = (45 * Math.PI) / 180;
/** Stick magnitude below this counts as "no direction" → straight-up launcher jump. */
export const LAUNCH_JUMP_STICK_MIN = 0.2;
/** Camera pitch below this (radians, ≈ -52°) means "looking at the floor": the Jump button fires the launcher along the view. */
export const LOOK_DOWN_PITCH = -0.9;
