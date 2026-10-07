import { describe, expect, it } from "vitest";
import { G, JUMP_CHARGE_TIME, JUMP_SPEED, LAUNCH_JUMP_CHARGE_MIN, LAUNCH_JUMP_SLUG, SHOOTER_MASS, SLUGS } from "./config";
import { GameSim, idleInput, type SimInput } from "./sim";
import { PILLARS, SUMMIT, heightAt, terrainHeight } from "./world";
import { PlayerBody } from "./player";

const DT = 1 / 120;
const DOWN = { x: 0, y: -1, z: 0 };

function simulate(sim: GameSim, seconds: number, each?: (i: number) => void) {
  const inp = idleInput();
  for (let i = 0; i < seconds / DT; i++) {
    each?.(i);
    sim.step(DT, inp);
  }
}

describe("movement", () => {
  it("a plain jump gains only ~1.5 m (cannot reach pillar A)", () => {
    const sim = new GameSim();
    const y0 = sim.player.pos.y;
    const inp = idleInput();
    inp.jump = true;
    sim.step(DT, inp);
    simulate(sim, 2);
    expect(sim.maxHeight - y0).toBeLessThan(2);
    expect(PILLARS[0].top - terrainHeight(PILLARS[0].x, PILLARS[0].z)).toBeGreaterThan(4);
  });

  it("pillar walls block walking", () => {
    const p = new PlayerBody(0, -14, heightAt);
    const inp = { ...idleInput(), moveY: 1, run: true };
    for (let i = 0; i < 600; i++) p.step(DT, inp, heightAt);
    expect(p.pos.z).toBeGreaterThan(PILLARS[0].z + PILLARS[0].r - 0.5); // stopped at the wall
    expect(p.pos.y).toBeLessThan(PILLARS[0].top);
  });
});

describe("launcher", () => {
  it("firing straight down adds exactly the predicted Δv upward", () => {
    const sim = new GameSim();
    sim.slugId = "heavy";
    const predicted = sim.predictedDeltaV(1);
    expect(sim.fire(DOWN, 1)).toBe(true);
    expect(sim.player.vel.y).toBeCloseTo(predicted, 6);
    expect(predicted).toBeCloseTo((SLUGS.heavy.mass * SLUGS.heavy.maxSpeed) / SHOOTER_MASS, 6);
  });

  it("momentum is conserved between shooter and slug at launch", () => {
    const sim = new GameSim();
    sim.fire(DOWN, 0.8);
    const s = sim.slugs[0];
    const m = SLUGS[s.type].mass;
    expect(SHOOTER_MASS * sim.player.vel.y + m * s.vel.y).toBeCloseTo(0, 6);
  });

  it("cannot fire without energy; the energy cost is the slug's kinetic energy", () => {
    const sim = new GameSim();
    const before = sim.energy.value;
    const speed = sim.muzzleSpeed(1);
    sim.fire(DOWN, 1);
    expect(before - sim.energy.value).toBeCloseTo(0.5 * SLUGS.heavy.mass * speed * speed, 6);
    sim.energy.value = 0;
    sim.cooldown = 0;
    expect(sim.fire(DOWN, 1)).toBe(false);
  });

  it("energy refills on the ground but not in the air", () => {
    const sim = new GameSim();
    sim.energy.value = 1000;
    simulate(sim, 0.5);
    expect(sim.energy.value).toBeGreaterThan(1500);
    sim.fire(DOWN, 0.3);
    const afterShot = sim.energy.value;
    simulate(sim, 0.2); // still airborne
    expect(sim.player.grounded).toBe(false);
    expect(sim.energy.value).toBeCloseTo(afterShot, 6);
  });

  it("heavy slugs are more energy-efficient for the same recoil", () => {
    const heavy = new GameSim(); heavy.slugId = "heavy";
    const light = new GameSim(); light.slugId = "light";
    // choose speeds giving the same momentum p = 60
    const p = 60;
    const eHeavy = 0.5 * SLUGS.heavy.mass * (p / SLUGS.heavy.mass) ** 2;
    const eLight = 0.5 * SLUGS.light.mass * (p / SLUGS.light.mass) ** 2;
    expect(eHeavy).toBeLessThan(eLight);
  });

  it("a slug hitting a crate transfers momentum (perfectly inelastic)", () => {
    const sim = new GameSim();
    const c = sim.crates[0];
    c.pos = { x: 0, y: heightAt(0, -6), z: -6 };
    sim.player.pos = { x: 0, y: heightAt(0, 0), z: 0 };
    sim.slugId = "heavy";
    const m = SLUGS.heavy.mass;
    // aim at the crate centre, compensating for the slug's gravity drop
    const dist = 5;
    const t = dist / SLUGS.heavy.maxSpeed;
    const dy = (c.pos.y + 0.55 - (sim.player.pos.y + 1.3)) / dist + (0.5 * G * t * t) / dist;
    const n = Math.hypot(dy, 1);
    sim.fire({ x: 0, y: dy / n, z: -1 / n }, 1);
    let peak = 0;
    const inp = idleInput();
    for (let i = 0; i < 0.5 / DT; i++) {
      sim.step(DT, inp);
      peak = Math.max(peak, Math.abs(c.vel.z));
    }
    // v' = m·u_z / (M + m) at impact (u_z a bit below launch speed due to drag-free gravity arc)
    const upper = (m * SLUGS.heavy.maxSpeed) / (c.mass + m);
    expect(peak).toBeGreaterThan(0.9 * upper);
    expect(peak).toBeLessThanOrEqual(upper + 1e-6);
    expect(c.vel.z).toBeLessThanOrEqual(0);
  });
});

describe("reachability (bot)", () => {
  it("chained heavy shots lift the player past the summit height, within the energy budget", () => {
    const sim = new GameSim();
    sim.slugId = "heavy";
    const y0 = sim.player.pos.y;
    const inp = idleInput();
    inp.jump = true;
    let last = -9;
    for (let i = 0; i < 6 / DT; i++) {
      const t = i * DT;
      sim.step(DT, inp);
      inp.jump = false;
      if (!sim.player.grounded && sim.player.vel.y < 1 && t - last > 0.12 && sim.fire(DOWN, 1)) last = t;
    }
    const rise = SUMMIT.top - terrainHeight(SUMMIT.x, SUMMIT.z);
    expect(sim.maxHeight - y0).toBeGreaterThan(rise);
    expect(sim.energy.value).toBeGreaterThanOrEqual(0);
  });
});

describe("three jump methods", () => {
  const heavy = SLUGS[LAUNCH_JUMP_SLUG];
  /** Δv of a launcher jump at a given strength (slug charge). */
  const dvAt = (charge: number) => (heavy.mass * (heavy.minSpeed + (heavy.maxSpeed - heavy.minSpeed) * charge)) / SHOOTER_MASS;
  const dvTap = dvAt(LAUNCH_JUMP_CHARGE_MIN);
  const dvFull = dvAt(1);

  /** Hold a button field for `seconds`, then release it for one step (that step performs the jump). */
  function holdThenRelease(sim: GameSim, inp: SimInput, field: "launchJumpHeld" | "jumpHeld", seconds: number) {
    inp[field] = true;
    const steps = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < steps; i++) sim.step(DT, inp);
    inp[field] = false;
    sim.step(DT, inp);
  }
  /** Jump elevation, read from the fired slug (recoil is opposite to it). Walking on the ground would blur the player's own velocity. */
  const elevation = (sim: GameSim) => {
    const v = sim.slugs[0].vel;
    return (Math.atan2(-v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI;
  };

  it("1. leg jump: no energy used, no shot", () => {
    const sim = new GameSim();
    const inp = idleInput();
    inp.jump = true;
    inp.jumpHeld = true;
    sim.step(DT, inp);
    expect(sim.shots).toBe(0);
    expect(sim.energy.value).toBe(sim.energy.max);
    expect(sim.player.vel.y).toBeGreaterThan(JUMP_SPEED - 0.5);
  });

  it("2. launcher jump with the stick forward launches forward and up (yaw 0 = -z), conserving momentum", () => {
    const sim = new GameSim();
    const inp = idleInput();
    inp.moveY = 1;
    holdThenRelease(sim, inp, "launchJumpHeld", 0);
    expect(sim.shots).toBe(1);
    expect(sim.player.vel.z).toBeLessThan(-2);
    expect(sim.player.vel.y).toBeGreaterThan(2);
  });

  it("2. launcher jump with an idle stick conserves momentum (straight up)", () => {
    const sim = new GameSim();
    holdThenRelease(sim, idleInput(), "launchJumpHeld", 0);
    const s = sim.slugs[0];
    expect(Math.abs(sim.player.vel.x)).toBeLessThan(1e-6);
    // gravity/drag act for two steps, so allow a small slack
    expect(Math.abs(SHOOTER_MASS * sim.player.vel.y + SLUGS.heavy.mass * s.vel.y)).toBeLessThan(5);
    expect(Math.abs(sim.player.vel.y - dvTap)).toBeLessThan(0.5);
  });

  it("2. strength: a tap is weak, a full hold is strong, and the cost follows", () => {
    const tap = new GameSim();
    holdThenRelease(tap, idleInput(), "launchJumpHeld", 0);
    const full = new GameSim();
    holdThenRelease(full, idleInput(), "launchJumpHeld", JUMP_CHARGE_TIME + 0.1);
    const half = new GameSim();
    holdThenRelease(half, idleInput(), "launchJumpHeld", JUMP_CHARGE_TIME / 2);
    expect(Math.abs(tap.player.vel.y - dvTap)).toBeLessThan(0.5);
    expect(Math.abs(full.player.vel.y - dvFull)).toBeLessThan(0.5);
    expect(half.player.vel.y).toBeGreaterThan(tap.player.vel.y + 0.3);
    expect(half.player.vel.y).toBeLessThan(full.player.vel.y - 0.3);
    const cost = (sim: GameSim) => sim.energy.max - sim.energy.value;
    expect(cost(tap)).toBeLessThan(cost(half));
    expect(cost(half)).toBeLessThan(cost(full));
  });

  it("2. launcher jump angle follows how far the stick is pushed (idle 90°, half 67.5°, full/sprint 45°)", () => {
    const elevationFor = (push: number) => {
      const sim = new GameSim();
      const inp = idleInput();
      inp.moveY = push;
      holdThenRelease(sim, inp, "launchJumpHeld", 0);
      return elevation(sim);
    };
    // A couple of sim steps of gravity/drag have acted on the velocity, hence the tolerance.
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1);
    near(elevationFor(0), 90);
    near(elevationFor(0.15), 90); // below the dead zone
    near(elevationFor(0.6), 67.5);
    near(elevationFor(1), 45);
    expect(elevationFor(0.8)).toBeLessThan(elevationFor(0.4)); // monotonic: harder push = flatter
  });

  it("2. launcher jump follows camera yaw", () => {
    const sim = new GameSim();
    const inp = idleInput();
    inp.moveY = 1;
    inp.yaw = Math.PI / 2; // forward is now -x
    holdThenRelease(sim, inp, "launchJumpHeld", 0);
    expect(sim.player.vel.x).toBeLessThan(-2);
    expect(Math.abs(sim.player.vel.z)).toBeLessThan(0.2);
  });

  it("3. looking at the floor: holding Jump charges a launcher jump along the view (no leg jump on top)", () => {
    const tap = new GameSim();
    const a = idleInput();
    a.aim = { x: 0, y: -1, z: 0 };
    a.jump = true;
    holdThenRelease(tap, a, "jumpHeld", 0);
    expect(tap.shots).toBe(1);
    expect(tap.lookingDown).toBe(true);
    expect(Math.abs(tap.player.vel.y - dvTap)).toBeLessThan(0.7); // launcher only

    const full = new GameSim();
    const b = idleInput();
    b.aim = { x: 0, y: -1, z: 0 };
    b.jump = true;
    holdThenRelease(full, b, "jumpHeld", JUMP_CHARGE_TIME + 0.1);
    expect(full.player.vel.y).toBeGreaterThan(tap.player.vel.y + 2);
  });

  it("looking ahead, the Jump button stays a leg jump (no shot)", () => {
    const sim = new GameSim();
    const inp = idleInput();
    inp.aim = { x: 0, y: -0.2, z: -1 };
    inp.jump = true;
    inp.jumpHeld = true;
    sim.step(DT, inp);
    expect(sim.lookingDown).toBe(false);
    expect(sim.shots).toBe(0);
  });

  it("looking at the floor without enough energy falls back to a leg jump", () => {
    const sim = new GameSim();
    sim.energy.value = 0;
    const inp = idleInput();
    inp.aim = { x: 0, y: -1, z: 0 };
    inp.jump = true;
    inp.jumpHeld = true;
    sim.step(DT, inp);
    expect(sim.shots).toBe(0);
    expect(sim.player.vel.y).toBeGreaterThan(JUMP_SPEED - 0.5);
  });
});

describe("fire and launcher jump never run together", () => {
  it("pressing fire while the jump is charging does nothing, and vice versa", () => {
    const sim = new GameSim();
    const inp = idleInput();
    inp.aim = { x: 0, y: 0, z: -1 };
    inp.launchJumpHeld = true;
    sim.step(DT, inp);
    inp.fireHeld = true; // pressed while the jump owns the charge
    for (let i = 0; i < 20; i++) sim.step(DT, inp);
    expect(sim.charging).toBe(false);
    expect(sim.charge).toBe(0);
    expect(sim.jumpCharging).toBe(true);
    inp.launchJumpHeld = false; // release → the jump happens, exactly one shot
    sim.step(DT, inp);
    expect(sim.shots).toBe(1);
    expect(sim.slugs[0].vel.y).toBeLessThan(0); // it is the jump's downward-ish slug, not a forward shot
    // fire is still held, but it needs a fresh press to start charging
    for (let i = 0; i < 10; i++) sim.step(DT, inp);
    expect(sim.charging).toBe(false);

    const sim2 = new GameSim();
    const b = idleInput();
    b.aim = { x: 0, y: 0, z: -1 };
    b.fireHeld = true;
    sim2.step(DT, b);
    b.launchJumpHeld = true; // pressed while fire owns the charge
    for (let i = 0; i < 20; i++) sim2.step(DT, b);
    expect(sim2.charging).toBe(true);
    expect(sim2.jumpCharging).toBe(false);
    b.fireHeld = false;
    sim2.step(DT, b);
    expect(sim2.shots).toBe(1);
    expect(sim2.slugs[0].vel.z).toBeLessThan(0); // a forward shot, not a jump
  });
});
