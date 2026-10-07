import { describe, expect, it } from "vitest";
import { G, SHOOTER_MASS, SLUGS } from "./config";
import { GameSim, idleInput } from "./sim";
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
