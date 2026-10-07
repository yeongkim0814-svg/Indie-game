import { describe, expect, it } from "vitest";
import { Grid, moveItem } from "./inventory";
import { DECAY, ITEMS, ageItem, bioRate, itemValue, makeItem, temperature } from "./items";

describe("grid inventory", () => {
  it("places items by footprint and rejects overlap and out-of-bounds", () => {
    const g = new Grid(3, 2);
    const bio = makeItem("bio"); // 2×2
    expect(g.place(bio, 0, 0, false)).toBe(true);
    expect(g.canPlace(makeItem("quartz"), 1, 1, false)).toBe(false);
    expect(g.canPlace(makeItem("quartz"), 2, 1, false)).toBe(true);
    expect(g.canPlace(makeItem("ore"), 2, 1, false)).toBe(false); // 1×2 would stick out
  });

  it("rotation swaps the footprint", () => {
    const g = new Grid(2, 1);
    const ore = makeItem("ore"); // 1×2
    expect(g.canPlace(ore, 0, 0, false)).toBe(false);
    expect(g.place(ore, 0, 0, true)).toBe(true);
    expect(g.at(1, 0)?.item).toBe(ore);
  });

  it("autoPlace rotates when needed and fails when full", () => {
    const g = new Grid(2, 1);
    expect(g.autoPlace(makeItem("ore"))).toBe(true);
    expect(g.autoPlace(makeItem("quartz"))).toBe(false);
  });

  it("moving between grids is all-or-nothing", () => {
    const a = new Grid(2, 2), b = new Grid(1, 1);
    const bio = makeItem("bio");
    a.autoPlace(bio);
    expect(moveItem(a, b, bio, 0, 0, false)).toBe(false);
    expect(a.items).toEqual([bio]);
    const q = makeItem("quartz");
    b.autoPlace(q);
    expect(moveItem(b, a, q, 0, 0, false)).toBe(false); // occupied by the bio
  });

  it("an item can be moved within its own grid onto its old cells", () => {
    const g = new Grid(3, 2);
    const bio = makeItem("bio");
    g.place(bio, 0, 0, false);
    expect(moveItem(g, g, bio, 1, 0, false)).toBe(true);
    expect(g.placed).toHaveLength(1);
    expect(g.placed[0].x).toBe(1);
  });

  it("mass sums the items and survives a JSON round trip", () => {
    const g = new Grid(4, 4);
    g.autoPlace(makeItem("ore"));
    g.autoPlace(makeItem("bio"));
    expect(g.mass).toBe(ITEMS.ore.mass + ITEMS.bio.mass);
    const back = Grid.fromJSON(JSON.parse(JSON.stringify(g)));
    expect(back.mass).toBe(g.mass);
    expect(back.placed).toHaveLength(2);
  });
});

describe("sample laws", () => {
  it("ore halves its value every half-life", () => {
    const ore = makeItem("ore");
    ageItem(ore, DECAY.oreHalfLife, 20);
    expect(itemValue(ore)).toBeCloseTo(ITEMS.ore.value / 2, 6);
    ageItem(ore, DECAY.oreHalfLife, 20);
    expect(itemValue(ore)).toBeCloseTo(ITEMS.ore.value / 4, 6);
  });

  it("bio spoils twice as fast for every +10 °C (Q10 = 2)", () => {
    expect(bioRate(30) / bioRate(20)).toBeCloseTo(2, 9);
    const warm = makeItem("bio"), cool = makeItem("bio");
    ageItem(warm, 30, temperature(1));
    ageItem(cool, 30, temperature(0));
    expect(1 - warm.fresh).toBeCloseTo((1 - cool.fresh) * 4, 6); // 30 °C vs 10 °C
  });

  it("quartz never changes", () => {
    const q = makeItem("quartz");
    ageItem(q, 1000, 30);
    expect(itemValue(q)).toBe(ITEMS.quartz.value);
  });
});
