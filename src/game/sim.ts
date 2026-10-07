import {
  CHARGE_TIME, CRATE_FRICTION, CRATE_MASS, FIRE_COOLDOWN, G, JUMP_CHARGE_TIME, LAUNCH_JUMP_CHARGE_MIN, LAUNCH_JUMP_ELEVATION_MAX,
  LAUNCH_JUMP_ELEVATION_MIN, LAUNCH_JUMP_SLUG, LAUNCH_JUMP_STICK_MIN, LOOK_DOWN_PITCH, MIN_CHARGE, SHOOTER_MASS, SLUGS, SLUG_LIFETIME,
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
  /** Held: launcher-jump button (method 2). Hold to charge, release to jump toward the stick direction. */
  launchJumpHeld: boolean;
  /** Held: Jump button. While looking at the floor it charges a launcher jump along the view (method 3). */
  jumpHeld: boolean;
  fireHeld: boolean;
  switchSlug: boolean;
  /** Aim direction (unit) for firing; derived from camera by the caller. */
  aim: Vec3;
}

export const idleInput = (): SimInput => ({
  moveX: 0, moveY: 0, run: false, jump: false, yaw: 0, launchJumpHeld: false, jumpHeld: false, fireHeld: false, switchSlug: false, aim: { x: 0, y: 0, z: -1 },
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
  /** Launcher-jump charge state. Fire and launcher-jump never charge at the same time (see `active`). */
  jumpCharging = false;
  jumpCharge = 0;
  private active: "fire" | "jump" | null = null;
  private jumpMode: "stick" | "view" = "stick";
  private prev = { fire: false, stickJump: false, viewJump: false };
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

  fire(dir: Vec3, charge: number, slugId: SlugId = this.slugId): boolean {
    if (this.cooldown > 0) return false;
    const t = SLUGS[slugId];
    const speed = this.muzzleSpeed(charge, slugId);
    if (speed < t.minSpeed * 0.6) return false; // out of energy
    this.energy.spend(slugEnergy(t.mass, speed));
    this.player.addVelocity(recoilDeltaV(SHOOTER_MASS, t.mass, speed, dir));
    const muzzle = { x: this.player.pos.x + dir.x, y: this.player.pos.y + 1.3 + dir.y, z: this.player.pos.z + dir.z };
    this.slugs.push({
      pos: muzzle, vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, type: slugId, age: 0,
    });
    this.events.push({ kind: "muzzle", pos: { ...muzzle } });
    this.cooldown = FIRE_COOLDOWN;
    this.shots++;
    return true;
  }

  /** True while the camera looks at the floor steeply enough that Jump means "launcher jump along the view". */
  lookingDown = false;

  /**
   * Method 2: jump toward the stick direction by firing the opposite way.
   * The harder the stick is pushed, the flatter the jump: idle = straight up, full push (sprint) = 45°.
   */
  launchJumpToward(input: SimInput, strength: number): boolean {
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
    let jumpDir: Vec3 = { x: 0, y: 1, z: 0 };
    if (mag >= LAUNCH_JUMP_STICK_MIN) {
      const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw);
      let hx = input.moveX * cy - input.moveY * sy;
      let hz = -input.moveX * sy - input.moveY * cy;
      const hm = Math.hypot(hx, hz);
      hx /= hm; hz /= hm;
      const t = (mag - LAUNCH_JUMP_STICK_MIN) / (1 - LAUNCH_JUMP_STICK_MIN);
      const elevation = LAUNCH_JUMP_ELEVATION_MAX - t * (LAUNCH_JUMP_ELEVATION_MAX - LAUNCH_JUMP_ELEVATION_MIN);
      const c = Math.cos(elevation), sEl = Math.sin(elevation);
      jumpDir = { x: hx * c, y: sEl, z: hz * c };
    }
    return this.fire({ x: -jumpDir.x, y: -jumpDir.y, z: -jumpDir.z }, strength, LAUNCH_JUMP_SLUG);
  }

  /** Method 3: with the view on the floor, the Jump button fires the launcher along the view. */
  launchJumpAlongView(aim: Vec3, strength: number): boolean {
    return this.fire(aim, strength, LAUNCH_JUMP_SLUG);
  }

  /** Charge → launcher-jump strength (slug charge in [MIN, 1]). */
  jumpStrength(charge = this.jumpCharge): number {
    return LAUNCH_JUMP_CHARGE_MIN + (1 - LAUNCH_JUMP_CHARGE_MIN) * charge;
  }

  /** Whether a launcher jump (at minimum strength) can currently be paid for. */
  canLaunchJump(): boolean {
    const t = SLUGS[LAUNCH_JUMP_SLUG];
    return this.muzzleSpeed(LAUNCH_JUMP_CHARGE_MIN, LAUNCH_JUMP_SLUG) >= t.minSpeed * 0.6;
  }

  /** Energy cost and Δv of the launcher jump being charged (for the HUD). */
  jumpPreview(): { cost: number; dv: number } {
    const t = SLUGS[LAUNCH_JUMP_SLUG];
    const speed = this.muzzleSpeed(this.jumpStrength(), LAUNCH_JUMP_SLUG);
    return { cost: slugEnergy(t.mass, speed), dv: (t.mass * speed) / SHOOTER_MASS };
  }

  cycleSlug(): void {
    this.slugId = SLUG_ORDER[(SLUG_ORDER.indexOf(this.slugId) + 1) % SLUG_ORDER.length];
  }

  step(dt: number, input: SimInput): void {
    if (input.switchSlug && !this.wasSwitch) this.cycleSlug();
    this.wasSwitch = input.switchSlug;

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.lookingDown = input.aim.y <= Math.sin(LOOK_DOWN_PITCH);

    // Looking at the floor with energy to spare: the Jump button charges a launcher jump instead of a leg jump.
    const viewJumpCapable = this.lookingDown && this.canLaunchJump();
    const viewJumpHeld = input.jumpHeld && viewJumpCapable;
    let legJump = input.jump && !viewJumpCapable;

    // Only one charge at a time: whichever button is pressed first owns it until released.
    if (this.active === null) {
      if (input.fireHeld && !this.prev.fire) this.active = "fire";
      else if (input.launchJumpHeld && !this.prev.stickJump) { this.active = "jump"; this.jumpMode = "stick"; }
      else if (viewJumpHeld && !this.prev.viewJump) { this.active = "jump"; this.jumpMode = "view"; }
    }
    this.prev = { fire: input.fireHeld, stickJump: input.launchJumpHeld, viewJump: viewJumpHeld };

    if (this.active === "fire") {
      if (input.fireHeld) {
        this.charging = true;
        this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
      } else {
        this.fire(input.aim, Math.max(MIN_CHARGE, this.charge));
        this.charge = 0;
        this.charging = false;
        this.active = null;
      }
    } else if (this.active === "jump") {
      const held = this.jumpMode === "stick" ? input.launchJumpHeld : input.jumpHeld;
      if (held) {
        this.jumpCharging = true;
        this.jumpCharge = Math.min(1, this.jumpCharge + dt / JUMP_CHARGE_TIME);
      } else {
        const strength = this.jumpStrength();
        const ok = this.jumpMode === "stick"
          ? this.launchJumpToward(input, strength)
          : this.launchJumpAlongView(input.aim, strength);
        if (!ok && this.jumpMode === "view") legJump = true; // could not pay: fall back to a leg jump
        this.jumpCharge = 0;
        this.jumpCharging = false;
        this.active = null;
      }
    }

    this.player.step(dt, legJump === input.jump ? input : { ...input, jump: legJump }, heightAt);
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
