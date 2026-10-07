import { describe, expect, it } from "vitest";
import { recoilDeltaV, slugEnergy, slugMomentum, springMuzzleSpeed } from "./recoil";

describe("recoil", () => {
  it("conserves momentum: shooter and slug momenta cancel", () => {
    const M = 70, m = 2, u = 30;
    const dir = { x: 0, y: -1, z: 0 };
    const dv = recoilDeltaV(M, m, u, dir);
    const slugP = { x: dir.x * m * u, y: dir.y * m * u, z: dir.z * m * u };
    expect(M * dv.y + slugP.y).toBeCloseTo(0, 10);
    expect(dv.y).toBeGreaterThan(0); // firing down pushes up
  });

  it("recoil direction is opposite to the shot", () => {
    const dv = recoilDeltaV(50, 1, 10, { x: 1, y: 0, z: 0 });
    expect(dv.x).toBeLessThan(0);
  });

  it("same momentum: heavier slug costs less energy (E = p²/2m)", () => {
    const p = 60;
    const heavy = slugEnergy(6, p / 6);
    const light = slugEnergy(1, p / 1);
    expect(slugMomentum(6, p / 6)).toBeCloseTo(slugMomentum(1, p), 10);
    expect(heavy).toBeLessThan(light);
    expect(light / heavy).toBeCloseTo(6, 10);
  });

  it("spring energy equals slug kinetic energy", () => {
    const k = 400, x = 0.3, m = 2;
    const u = springMuzzleSpeed(k, x, m);
    expect(slugEnergy(m, u)).toBeCloseTo(0.5 * k * x * x, 10);
  });
});
