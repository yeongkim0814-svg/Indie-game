import { describe, expect, it } from "vitest";
import { Grid } from "./inventory";
import { ITEMS, makeItem } from "./items";
import { newProgress, research, researchBlocker } from "./knowledge";
import { RAID, Raid, idleRaidInput, type RaidInput } from "./raid";
import { BATTERY_CAPACITY, MODS, RECIPES, WEAPONS, attachMod, craft, craftBlocker, type BeamWeapon, type ProjectileWeapon } from "./weapons";

const DT = 1 / 120;
const FIRE: RaidInput = { move: { x: 0, y: 0 }, fire: true };
const run = (r: Raid, secs: number, input: RaidInput = idleRaidInput()) => { for (let t = 0; t < secs; t += DT) r.step(DT, input); };
const gun = (kind: "launcher" | "lens" | "coilgun", mods: ("stock" | "scope")[] = []) => {
  const w = makeItem(kind);
  for (const m of mods) attachMod(w, makeItem(m));
  return w;
};
const LAUNCHER = WEAPONS.launcher as ProjectileWeapon, COIL = WEAPONS.coilgun as ProjectileWeapon, LENS = WEAPONS.lens as BeamWeapon;

describe("momentum launcher", () => {
  const ARENA = ["############", "#P...c.....#", "############"];

  it("recoil Δv = J/M_recoil is large, and a stock braces it", () => {
    const bare = new Raid(ARENA, 1, [], { weapon: gun("launcher") });
    const braced = new Raid(ARENA, 1, [], { weapon: gun("launcher", ["stock"]) });
    bare.step(DT, FIRE);
    braced.step(DT, FIRE);
    const J = LAUNCHER.mass * LAUNCHER.speed;
    expect(bare.player.vel.x).toBeCloseTo(-J / bare.recoilMass, 6);
    expect(braced.recoilMass).toBeCloseTo(braced.playerMass + MODS.stockBracing, 6);
    expect(Math.abs(braced.player.vel.x)).toBeLessThan(Math.abs(bare.player.vel.x) * 0.7);
  });

  it("knocks a crawler off the cliff edge", () => {
    const r = new Raid(["##########", "#....P.c~~", "##########"], 1, [], { weapon: gun("launcher") });
    run(r, 1.5, FIRE);
    expect(r.crawlers[0].alive).toBe(false);
    expect(r.events.some((e) => e.kind === "fall")).toBe(true);
  });

  it("a light rifle hit does not lift a crawler off its feet", () => {
    const r = new Raid(["##########", "#....P.c~~", "##########"]);
    run(r, 0.3, FIRE);
    expect(r.crawlers.every((c) => c.airborne === 0)).toBe(true);
    expect(r.events.some((e) => e.kind === "fall")).toBe(false);
  });

  it("crawlers never walk off the cliff on their own", () => {
    const r = new Raid(["##########", "#~~c....P#", "##########"]);
    r.time = RAID.duration * 0.9; // night: everything chases
    run(r, 3);
    expect(r.events.some((e) => e.kind === "fall")).toBe(false);
  });
});

describe("focused lens", () => {
  const ARENA = ["##########", "#P...c...#", "##########"];

  it("burns with sunlight and has no knockback", () => {
    const r = new Raid(ARENA, 1, [], { weapon: gun("lens") });
    r.step(DT, FIRE);
    expect(r.beam?.intensity).toBe(1);
    expect(r.crawlers[0].hp).toBeCloseTo(RAID.crawler.hp - LENS.dps * DT, 6);
    expect(r.player.vel.x).toBe(0); // photon momentum p = E/c ≈ 0: no recoil
  });

  it("is weak near sunset", () => {
    const noon = new Raid(ARENA, 1, [], { weapon: gun("lens") });
    const dusk = new Raid(ARENA, 1, [], { weapon: gun("lens") });
    dusk.time = RAID.duration * 0.95;
    run(noon, 0.5, FIRE);
    run(dusk, 0.5, FIRE);
    expect(RAID.crawler.hp - dusk.crawlers[0].hp).toBeLessThan((RAID.crawler.hp - noon.crawlers[0].hp) * 0.25);
  });
});

describe("coilgun", () => {
  it("draws E = ½mu² per shot from a battery and pierces", () => {
    expect(COIL.energy).toBeCloseTo(0.5 * COIL.mass * COIL.speed ** 2, 6);
    const cell = makeItem("battery");
    cell.charge = BATTERY_CAPACITY;
    const r = new Raid(["##############", "#P..c.c.c....#", "##############"], 1, [], { weapon: gun("coilgun"), pack: [cell] });
    r.step(DT, FIRE);
    expect(cell.charge).toBe(BATTERY_CAPACITY - COIL.energy);
    run(r, 0.2);
    expect(r.crawlers.filter((c) => c.hp < RAID.crawler.hp).length).toBe(3);
  });

  it("cannot fire without battery charge", () => {
    const r = new Raid(["##########", "#P...c...#", "##########"], 1, [], { weapon: gun("coilgun") });
    r.step(DT, FIRE);
    expect(r.bullets).toHaveLength(0);
    expect(r.events.some((e) => e.kind === "empty")).toBe(true);
  });
});

describe("mods and equipment", () => {
  it("a scope extends auto-aim reach", () => {
    expect(new Raid(undefined, 1, [], { weapon: gun("launcher", ["scope"]) }).aimRange).toBe(LAUNCHER.range + MODS.scopeRange);
  });

  it("a lens takes a sight but not a stock", () => {
    const lens = makeItem("lens");
    expect(attachMod(lens, makeItem("stock"))).toBe(false);
    expect(attachMod(lens, makeItem("scope"))).toBe(true);
  });

  it("a stock makes the weapon one cell longer and heavier", () => {
    const g = new Grid(3, 1);
    const w = gun("launcher", ["stock"]);
    expect(g.autoPlace(w)).toBe(false); // 4×1 now
    expect(new Grid(4, 1).autoPlace(w)).toBe(true);
    const r = new Raid(undefined, 1, [], { weapon: w });
    expect(r.playerMass).toBe(RAID.player.bodyMass + ITEMS.launcher.mass + ITEMS.stock.mass);
  });

  it("the equipped weapon comes home only on extraction", () => {
    const w = gun("launcher");
    const ok = new Raid(["#####", "#EPE#", "#####"], 1, [], { weapon: w });
    run(ok, RAID.extractHold + 0.5);
    expect(ok.result().items).toContain(w);
    const dead = new Raid(["#######", "#P.c..#", "#######"], 1, [], { weapon: gun("launcher") });
    run(dead, 30);
    expect(dead.result().items).toHaveLength(0);
  });
});

describe("crafting", () => {
  it("needs facility, knowledge, points and materials", () => {
    const p = newProgress();
    p.points = 500;
    const launcher = RECIPES.find((r) => r.out === "launcher")!;
    expect(craftBlocker(p, launcher, { ore: 2 })).toBe("지식 필요");
    research(p, "mechanics");
    expect(craftBlocker(p, launcher, { ore: 1 })).toBe("재료 부족");
    const before = p.points;
    const it = craft(p, launcher, { ore: 2 });
    expect(it?.kind).toBe("launcher");
    expect(p.points).toBe(before - launcher.points);
  });

  it("a crafted battery is fully charged", () => {
    const p = newProgress();
    p.points = 500;
    p.facilities.push("lab");
    research(p, "mechanics");
    research(p, "radiochem");
    research(p, "electrochem");
    expect(craft(p, RECIPES.find((r) => r.out === "battery")!, { ore: 1 })?.charge).toBe(BATTERY_CAPACITY);
  });

  it("electrochemistry is a cross node: it needs mechanics and radiochemistry first", () => {
    const p = newProgress();
    p.points = 500;
    p.facilities.push("lab");
    expect(researchBlocker(p, "electrochem")).toMatch(/먼저/);
  });
});
