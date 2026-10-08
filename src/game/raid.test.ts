import { describe, expect, it } from "vitest";
import { RAID, Raid, idleRaidInput, type RaidInput } from "./raid";
import { makeItem } from "./items";

const DT = 1 / 120;
const run = (r: Raid, secs: number, input: RaidInput = idleRaidInput()) => {
  for (let t = 0; t < secs; t += DT) r.step(DT, input);
};
const move = (x: number, y: number): RaidInput => ({ move: { x, y }, fire: false });

// open 12×7 room, player at (2.5,3.5)
const ROOM = [
  "############",
  "#..........#",
  "#..........#",
  "#.P........#",
  "#..........#",
  "#..........#",
  "############",
];

describe("movement (F = M·a)", () => {
  it("reaches top speed drive/drag", () => {
    const r = new Raid(ROOM);
    run(r, 0.6, move(1, 0));
    expect(r.player.vel.x).toBeCloseTo(RAID.player.drive / RAID.player.drag, 1);
  });

  it("a heavier pack accelerates more slowly", () => {
    const light = new Raid(ROOM), heavy = new Raid(ROOM);
    for (let i = 0; i < 4; i++) heavy.backpack.autoPlace(makeItem("ore"));
    const N = 6;
    for (let i = 0; i < N; i++) { light.step(DT, move(1, 0)); heavy.step(DT, move(1, 0)); }
    // Euler form of a = (F − c·v)/M: v_n = v_max·(1 − (1 − c·dt/M)^n). Same top speed, slower approach.
    const { drive, drag } = RAID.player;
    const v = (M: number) => (drive / drag) * (1 - Math.pow(1 - (drag * DT) / M, N));
    expect(heavy.playerMass).toBe(RAID.player.bodyMass + 12);
    expect(light.player.vel.x).toBeCloseTo(v(light.playerMass), 6);
    expect(heavy.player.vel.x).toBeCloseTo(v(heavy.playerMass), 6);
    expect(heavy.player.vel.x).toBeLessThan(light.player.vel.x);
  });

  it("rock walls block the player", () => {
    const r = new Raid(ROOM);
    run(r, 3, move(-1, 0));
    expect(r.player.pos.x).toBeGreaterThan(1 + RAID.player.radius - 0.01);
  });

  it("the cliff edge blocks walking", () => {
    const r = new Raid(["#####", "#P.~~", "#####"]);
    run(r, 2, move(1, 0));
    expect(r.player.pos.x).toBeLessThan(3);
  });
});

describe("shooting (momentum transfer)", () => {
  const ARENA = ["##########", "#P...c...#", "##########"];

  it("auto-aims the nearest crawler and kills it", () => {
    const r = new Raid(ARENA);
    run(r, 2, { move: { x: 0, y: 0 }, fire: true });
    expect(r.crawlers[0].alive).toBe(false);
  });

  it("recoil Δv = J/M pushes the shooter opposite the shot", () => {
    const r = new Raid(ARENA);
    r.step(DT, { move: { x: 0, y: 0 }, fire: true });
    const J = RAID.bullet.mass * RAID.bullet.speed;
    expect(r.player.vel.x).toBeCloseTo(-J / RAID.player.bodyMass, 3);
  });

  it("a hit knocks the crawler back by J/m", () => {
    const r = new Raid(["##############", "#P..........c#", "##############"]);
    r.crawlers[0].pos.x = 4;
    r.step(DT, { move: { x: 0, y: 0 }, fire: true });
    let before = 0;
    for (let i = 0; i < 20 && r.crawlers[0].hp === RAID.crawler.hp; i++) {
      before = r.crawlers[0].vel.x;
      r.step(DT, idleRaidInput());
    }
    expect(r.crawlers[0].hp).toBe(RAID.crawler.hp - 1);
    // bullets resolve before the crawler's own drive, so the jump is J/m minus one drive step
    const J = RAID.bullet.mass * RAID.bullet.speed;
    expect(r.crawlers[0].vel.x - before).toBeGreaterThan((J / RAID.crawler.mass) * 0.6);
  });

  it("rock stops bullets", () => {
    const r = new Raid(["##########", "#P..#.c..#", "##########"]);
    run(r, 2, { move: { x: 0, y: 0 }, fire: true });
    expect(r.crawlers[0].hp).toBe(RAID.crawler.hp);
  });
});

describe("raid outcome", () => {
  it("picks up samples into the backpack grid", () => {
    const r = new Raid(["########", "#P..o..#", "########"]);
    run(r, 2, move(1, 0));
    expect(r.backpack.items.map((i) => i.kind)).toEqual(["ore"]);
    expect(r.playerMass).toBe(RAID.player.bodyMass + 3);
  });

  it("a full backpack leaves the sample on the ground", () => {
    const r = new Raid(["########", "#P..b..#", "########"]);
    for (let i = 0; i < 15; i++) r.backpack.autoPlace(makeItem("quartz"));
    run(r, 2, move(1, 0));
    expect(r.samples[0].taken).toBe(false);
    expect(r.events.some((e) => e.kind === "full")).toBe(true);
  });

  it("dropping an item puts it back on the ground and lightens the pack", () => {
    const r = new Raid(ROOM);
    const ore = makeItem("ore");
    r.backpack.autoPlace(ore);
    expect(r.dropItem(ore)).toBe(true);
    expect(r.playerMass).toBe(RAID.player.bodyMass);
    expect(r.samples.at(-1)?.item).toBe(ore);
    run(r, 0.5);
    expect(r.backpack.items).toHaveLength(0); // standing on it does not re-grab it
  });

  it("extracts after holding the zone, keeping carried samples", () => {
    const r = new Raid(["#########", "#P.sEEE.#", "#...EEE.#", "#########"]);
    run(r, 0.6, move(1, 0));
    run(r, 0.25, idleRaidInput());
    run(r, RAID.extractHold + 1, move(0, 0));
    expect(r.state).toBe("extracted");
    const res = r.result();
    expect(res.state).toBe("extracted");
    expect(res.items.map((i) => i.kind)).toEqual(["quartz"]);
    expect(res.value).toBe(10);
  });

  it("leaving the zone resets the extraction timer", () => {
    const r = new Raid(["##########", "#EEE.....#", "#EPE.....#", "#EEE.....#", "##########"]);
    run(r, 1, idleRaidInput());
    run(r, 1, move(1, 0));
    expect(r.extractTimer).toBe(0);
    expect(r.state).toBe("running");
  });

  it("staying out past sunset loses the backpack but keeps the notebook", () => {
    const r = new Raid(ROOM);
    r.backpack.autoPlace(makeItem("ore"));
    const kept = makeItem("quartz");
    r.notebook.autoPlace(kept);
    run(r, RAID.duration + 0.1);
    const res = r.result();
    expect(res.state).toBe("lost");
    expect(res.items).toEqual([kept]);
  });

  it("crawler bites can kill the player", () => {
    const r = new Raid(["#######", "#P.c..#", "#######"]);
    run(r, 20);
    expect(r.state).toBe("dead");
  });
});

describe("M3 knowledge in the raid", () => {
  const OPEN = ["####################", "#P.................#", "####################"];
  const dash: RaidInput = { move: { x: 1, y: 0 }, fire: false, dash: true };

  it("the recoil dash needs the mechanics knowledge", () => {
    const r = new Raid(OPEN);
    r.step(DT, dash);
    expect(r.player.airborne).toBe(0);
  });

  it("dash Δv = J/M, so a loaded pack dashes less far", () => {
    const light = new Raid(OPEN, 1, ["mechanics"]), heavy = new Raid(OPEN, 1, ["mechanics"]);
    for (let i = 0; i < 4; i++) heavy.backpack.autoPlace(makeItem("ore"));
    light.step(DT, dash);
    heavy.step(DT, dash);
    expect(light.player.vel.x).toBeCloseTo(RAID.dash.impulse / RAID.player.bodyMass, 6);
    expect(heavy.player.vel.x).toBeCloseTo(RAID.dash.impulse / (RAID.player.bodyMass + 12), 6);
    const x0 = light.player.pos.x;
    run(light, 0.6, idleRaidInput());
    run(heavy, 0.6, idleRaidInput());
    expect(light.player.pos.x - x0).toBeGreaterThan(2);
    expect(heavy.player.pos.x).toBeLessThan(light.player.pos.x);
  });

  it("the dash has a cooldown", () => {
    const r = new Raid(OPEN, 1, ["mechanics"]);
    r.step(DT, dash);
    const v = r.player.vel.x;
    r.step(DT, dash);
    expect(r.player.vel.x).toBeCloseTo(v, 6);
  });

  it("crawlers slow down as the air cools (Q10)", () => {
    const r = new Raid(OPEN);
    expect(r.crawlerActivity).toBeCloseTo(1, 6); // noon, 30 °C
    r.time = RAID.duration; // sunset, 10 °C: two Q10 steps down
    expect(r.crawlerActivity).toBeCloseTo(1 / (RAID.metabolism.q10 * RAID.metabolism.q10), 6);
  });
});

