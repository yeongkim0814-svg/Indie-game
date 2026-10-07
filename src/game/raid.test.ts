import { describe, expect, it } from "vitest";
import { RAID, Raid, idleRaidInput, type RaidInput } from "./raid";

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
    heavy.player.carried = 5;
    run(light, 0.05, move(1, 0));
    run(heavy, 0.05, move(1, 0));
    expect(heavy.player.vel.x).toBeLessThan(light.player.vel.x * 0.85);
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
  it("picks up samples by walking over them", () => {
    const r = new Raid(["########", "#P..s..#", "########"]);
    run(r, 2, move(1, 0));
    expect(r.player.carried).toBe(1);
  });

  it("extracts after holding the zone, keeping carried samples", () => {
    const r = new Raid(["#########", "#P.sEEE.#", "#...EEE.#", "#########"]);
    run(r, 0.6, move(1, 0));
    run(r, 0.25, idleRaidInput());
    run(r, RAID.extractHold + 1, move(0, 0));
    expect(r.state).toBe("extracted");
    expect(r.result()).toEqual({ state: "extracted", samples: 1 });
  });

  it("leaving the zone resets the extraction timer", () => {
    const r = new Raid(["##########", "#EEE.....#", "#EPE.....#", "#EEE.....#", "##########"]);
    run(r, 1, idleRaidInput());
    run(r, 1, move(1, 0));
    expect(r.extractTimer).toBe(0);
    expect(r.state).toBe("running");
  });

  it("staying out past sunset loses the raid and its samples", () => {
    const r = new Raid(ROOM);
    r.player.carried = 3;
    run(r, RAID.duration + 0.1);
    expect(r.result()).toEqual({ state: "lost", samples: 0 });
  });

  it("crawler bites can kill the player", () => {
    const r = new Raid(["#######", "#P.c..#", "#######"]);
    run(r, 20);
    expect(r.state).toBe("dead");
  });
});
