import { describe, expect, it } from "vitest";
import { FACILITIES, KNOWLEDGE, build, buildBlocker, hasFacility, knows, newProgress, research, researchBlocker } from "./knowledge";

describe("hideout facilities", () => {
  it("the workbench exists from the start", () => {
    expect(hasFacility(newProgress(), "workbench")).toBe(true);
    expect(hasFacility(newProgress(), "lab")).toBe(false);
  });

  it("building needs points and materials, and spends the points", () => {
    const p = newProgress();
    p.points = 100;
    expect(buildBlocker(p, "observatory", { quartz: 2 })).toBe("재료 부족");
    expect(build(p, "observatory", { quartz: 2 })).toBe(false);
    expect(build(p, "observatory", { quartz: 3 })).toBe(true);
    expect(p.points).toBe(100 - FACILITIES.observatory.points);
    expect(build(p, "observatory", { quartz: 3 })).toBe(false); // already built
  });

  it("not enough points blocks building", () => {
    const p = newProgress();
    p.points = 10;
    expect(buildBlocker(p, "lab", { ore: 1, bio: 1 })).toMatch(/연구 점수/);
  });
});

describe("knowledge", () => {
  it("research needs its facility, then spends points", () => {
    const p = newProgress();
    p.points = 200;
    expect(researchBlocker(p, "radiochem")).toMatch(/실험실/);
    expect(research(p, "mechanics")).toBe(true); // workbench is built in
    expect(knows(p, "mechanics")).toBe(true);
    expect(p.points).toBe(200 - KNOWLEDGE.mechanics.points);
    expect(research(p, "mechanics")).toBe(false);
  });

  it("every node says what it changes, its law, and where the law stops holding", () => {
    for (const k of Object.values(KNOWLEDGE)) {
      expect(k.effect.length).toBeGreaterThan(5);
      expect(k.law.length).toBeGreaterThan(3);
      expect(k.limit.length).toBeGreaterThan(5);
    }
  });
});
