import {
  AIR_ACCEL, DRAG, G, GROUND_ACCEL, JUMP_SPEED, OVERSPEED_FRICTION, RUN_SPEED, STEP_HEIGHT, WALK_SPEED,
} from "./config";
import type { Vec3 } from "../physics/recoil";

export interface MoveInput {
  /** -1..1 right */
  moveX: number;
  /** -1..1 forward */
  moveY: number;
  run: boolean;
  jump: boolean;
  yaw: number;
}

export type HeightFn = (x: number, z: number) => number;

export class PlayerBody {
  pos: Vec3;
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  grounded = true;
  /** Region friction multiplier (ice ≈ 0). */
  friction = 1;
  /** Region air density multiplier. */
  airDensity = 1;
  gravity = G;

  constructor(x: number, z: number, heightAt: HeightFn) {
    this.pos = { x, y: heightAt(x, z), z };
  }

  addVelocity(dv: Vec3): void {
    this.vel.x += dv.x;
    this.vel.y += dv.y;
    this.vel.z += dv.z;
    if (dv.y > 0) this.grounded = false;
  }

  step(dt: number, input: MoveInput, heightAt: HeightFn): void {
    const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let dx = input.moveX * cy - input.moveY * sy;
    let dz = -input.moveX * sy - input.moveY * cy;
    const mag = Math.hypot(dx, dz);
    if (mag > 1) { dx /= mag; dz /= mag; }
    const maxSpeed = input.run ? RUN_SPEED : WALK_SPEED;

    if (this.grounded) {
      const tx = dx * maxSpeed, tz = dz * maxSpeed;
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > RUN_SPEED + 0.01) {
        // Over-speed (recoil): slide with friction instead of snapping back.
        const k = Math.max(0, speed - OVERSPEED_FRICTION * this.friction * dt) / speed;
        this.vel.x *= k; this.vel.z *= k;
      } else {
        const a = GROUND_ACCEL * this.friction * dt;
        this.vel.x = approach(this.vel.x, tx, a);
        this.vel.z = approach(this.vel.z, tz, a);
      }
      if (input.jump) { this.vel.y = JUMP_SPEED; this.grounded = false; }
    } else {
      // Air control only adds speed up to the walk limit; it never cancels momentum.
      const along = this.vel.x * dx + this.vel.z * dz;
      if (mag > 0 && along < maxSpeed) {
        this.vel.x += dx * AIR_ACCEL * dt;
        this.vel.z += dz * AIR_ACCEL * dt;
      }
    }

    this.vel.y -= this.gravity * dt;
    const sp = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    const drag = DRAG * this.airDensity * sp * dt;
    this.vel.x -= this.vel.x * drag;
    this.vel.y -= this.vel.y * drag;
    this.vel.z -= this.vel.z * drag;

    // Horizontal move with wall blocking (terrain/pillar taller than a step blocks).
    const nx = this.pos.x + this.vel.x * dt;
    if (heightAt(nx, this.pos.z) <= this.pos.y + STEP_HEIGHT) this.pos.x = nx; else this.vel.x = 0;
    const nz = this.pos.z + this.vel.z * dt;
    if (heightAt(this.pos.x, nz) <= this.pos.y + STEP_HEIGHT) this.pos.z = nz; else this.vel.z = 0;

    this.pos.y += this.vel.y * dt;
    const h = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= h && this.vel.y <= 0) {
      this.pos.y = h;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > h + 0.05) {
      this.grounded = false;
    }
  }
}

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}
