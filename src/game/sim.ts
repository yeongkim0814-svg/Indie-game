import {
  CHARGE_TIME, CRATE_FRICTION, CRATE_MASS, FIRE_COOLDOWN, G, MIN_CHARGE, SHOOTER_MASS, SLUGS, SLUG_LIFETIME,
  SLUG_ORDER, type SlugId,
} from "./config";
import { EnergyGauge } from "./energy";
import { PlayerBody, type MoveInput } from "./player";
import { CRATE_SPAWNS, SPAWN, SUMMIT, heightAt, terrainHeight } from "./world";
import { recoilDeltaV, slugEnergy, type Vec3 } from "../physics/recoil";

export interface Slug {
  pos: Vec3;
  vel: Vec3;
  type: SlugId;
  age: number;
}

export interface Crate {
  pos: Vec3;
  vel: Vec3;
  mass: number;
  radius: number;
}

export interface ImpactEvent {
  kind: "ground" | "crate" | "wall" | "muzzle";
  pos: Vec3;
}

export interface SimInput extends MoveInput {
  fireHeld: boolean;
  switchSlug: boolean;
  /** Aim direction (unit) for firing; derived from camera by the caller. */
  aim: Vec3;
}

export const idleInput = (): SimInput => ({
  moveX: 0, moveY: 0, run: false, jump: false, yaw: 0, fireHeld: false, switchSlug: false, aim: { x: 0, y: 0, z: -1 },
});

export class GameSim {
  player = new PlayerBody(SPAWN.x, SPAWN.z, heightAt);
  energy = new EnergyGauge();
  slugs: Slug[] = [];
  crates: Crate[] = CRATE_SPAWNS.map((c) => ({
    pos: { x: c.x, y: heightAt(c.x, c.z), z: c.z }, vel: { x: 0, y: 0, z: 0 }, mass: CRATE_MASS, radius: 0.55,
  }));
  slugId: SlugId = "heavy";
  charge = 0;
  charging = false;
  cooldown = 0;
  shots = 0;
  summitReached = false;
  maxHeight = 0;
  events: ImpactEvent[] = [];
  private wasFiring = false;
  private wasSwitch = false;

  /** Speed a shot would leave with at `charge`, limited by remaining energy. */
  muzzleSpeed(charge: number, slugId: SlugId = this.slugId): number {
    const t = SLUGS[slugId];
    const want = t.minSpeed + (t.maxSpeed - t.minSpeed) * charge;
    const afford = Math.sqrt((2 * this.energy.value) / t.mass);
    return Math.min(want, afford);
  }

  /** Predicted recoil Δv magnitude for the HUD arrow. */
  predictedDeltaV(charge: number): number {
    const t = SLUGS[this.slugId];
    return (t.mass * this.muzzleSpeed(charge)) / SHOOTER_MASS;
  }

  predictedCost(charge: number): number {
    const t = SLUGS[this.slugId];
    return slugEnergy(t.mass, this.muzzleSpeed(charge));
  }

  fire(dir: Vec3, charge: number): boolean {
    if (this.cooldown > 0) return false;
    const t = SLUGS[this.slugId];
    const speed = this.muzzleSpeed(charge);
    if (speed < t.minSpeed * 0.6) return false; // out of energy
    this.energy.spend(slugEnergy(t.mass, speed));
    this.player.addVelocity(recoilDeltaV(SHOOTER_MASS, t.mass, speed, dir));
    const muzzle = { x: this.player.pos.x + dir.x, y: this.player.pos.y + 1.3 + dir.y, z: this.player.pos.z + dir.z };
    this.slugs.push({
      pos: muzzle, vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, type: this.slugId, age: 0,
    });
    this.events.push({ kind: "muzzle", pos: { ...muzzle } });
    this.cooldown = FIRE_COOLDOWN;
    this.shots++;
    return true;
  }

  cycleSlug(): void {
    this.slugId = SLUG_ORDER[(SLUG_ORDER.indexOf(this.slugId) + 1) % SLUG_ORDER.length];
  }

  step(dt: number, input: SimInput): void {
    if (input.switchSlug && !this.wasSwitch) this.cycleSlug();
    this.wasSwitch = input.switchSlug;

    this.cooldown = Math.max(0, this.cooldown - dt);
    if (input.fireHeld) {
      this.charging = true;
      this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
    } else if (this.wasFiring) {
      this.fire(input.aim, Math.max(MIN_CHARGE, this.charge));
      this.charge = 0;
      this.charging = false;
    }
    this.wasFiring = input.fireHeld;

    this.player.step(dt, input, heightAt);
    this.energy.step(dt, this.player.grounded);
    this.stepSlugs(dt);
    this.stepCrates(dt);

    this.maxHeight = Math.max(this.maxHeight, this.player.pos.y);
    const dx = this.player.pos.x - SUMMIT.x, dz = this.player.pos.z - SUMMIT.z;
    if (this.player.grounded && dx * dx + dz * dz <= SUMMIT.r * SUMMIT.r && this.player.pos.y >= SUMMIT.top - 0.05) {
      this.summitReached = true;
    }
  }

  private stepSlugs(dt: number): void {
    const sub = 2, h = dt / sub;
    for (const s of this.slugs) {
      for (let i = 0; i < sub && s.age >= 0; i++) {
        s.vel.y -= G * h;
        s.pos.x += s.vel.x * h; s.pos.y += s.vel.y * h; s.pos.z += s.vel.z * h;
        s.age += h;
        const t = SLUGS[s.type];
        const crate = this.crates.find((c) => dist(c.pos, { ...s.pos, y: s.pos.y - 0.55 }) < c.radius + t.radius);
        if (crate) {
          // Perfectly inelastic: slug embeds. (Mc + m)·v' = m·v + Mc·v  (momentum conserved)
          const m = t.mass, M = crate.mass;
          crate.vel.x = (M * crate.vel.x + m * s.vel.x) / (M + m);
          crate.vel.y = (M * crate.vel.y + m * s.vel.y) / (M + m);
          crate.vel.z = (M * crate.vel.z + m * s.vel.z) / (M + m);
          this.events.push({ kind: "crate", pos: { ...s.pos } });
          s.age = -1;
        } else if (s.pos.y <= heightAt(s.pos.x, s.pos.z)) {
          const ground = Math.abs(s.pos.y - terrainHeight(s.pos.x, s.pos.z)) < 0.6;
          this.events.push({ kind: ground ? "ground" : "wall", pos: { ...s.pos } });
          s.age = -1;
        }
      }
      if (s.age > SLUG_LIFETIME) s.age = -1;
    }
    this.slugs = this.slugs.filter((s) => s.age >= 0);
  }

  private stepCrates(dt: number): void {
    for (const c of this.crates) {
      c.vel.y -= G * dt;
      const sp = Math.hypot(c.vel.x, c.vel.z);
      if (sp > 0 && c.pos.y <= heightAt(c.pos.x, c.pos.z) + 0.02) {
        const k = Math.max(0, sp - CRATE_FRICTION * dt) / sp;
        c.vel.x *= k; c.vel.z *= k;
      }
      const nx = c.pos.x + c.vel.x * dt;
      if (heightAt(nx, c.pos.z) <= c.pos.y + 0.6) c.pos.x = nx; else c.vel.x = 0;
      const nz = c.pos.z + c.vel.z * dt;
      if (heightAt(c.pos.x, nz) <= c.pos.y + 0.6) c.pos.z = nz; else c.vel.z = 0;
      c.pos.y += c.vel.y * dt;
      const h = heightAt(c.pos.x, c.pos.z);
      if (c.pos.y < h) { c.pos.y = h; c.vel.y = 0; }
    }
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
