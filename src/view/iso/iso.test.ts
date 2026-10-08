import { describe, expect, it } from "vitest";
import { FIRST_MAP } from "../../game/raidMap";
import { Raid, idleRaidInput } from "../../game/raid";
import { PITCH_ISO, PITCH_SIDE, YAW_ISO, depthOf, faceVisible, makeView, project } from "./project";
import { CameraRig, TRANSITION } from "./camera";
import { controls, laneCentre } from "./controls";
import { bandRowAlpha, bodyWeight, fade, rowWeight } from "./terrain";
import { clampAxis, mapBounds } from "./scene";

describe("projection", () => {
  it("side view: screenY = -z*S, depth = y, no top face", () => {
    const v = makeView(0, 0), p = project(v, 3, 5, 2);
    expect(p.sx).toBeCloseTo(48); expect(p.sy).toBeCloseTo(-32); expect(p.depth).toBeCloseTo(5);
    expect(faceVisible(v, 0, 0, 1)).toBe(false);
    expect(faceVisible(v, 0, 1, 0)).toBe(true); // south faces point at the camera
    expect(faceVisible(v, 0, -1, 0)).toBe(false);
  });
  it("isometric: one tile east is 2:1 on screen, nearer = larger depth", () => {
    const v = makeView(YAW_ISO, PITCH_ISO), o = project(v, 0, 0, 0), e = project(v, 1, 0, 0);
    expect(Math.abs(e.sx - o.sx) / Math.abs(e.sy - o.sy)).toBeCloseTo(2);
    expect(depthOf(v, 0, 1, 0)).toBeGreaterThan(depthOf(v, 0, 0, 0));
    expect(depthOf(v, -1, 0, 0)).toBeGreaterThan(depthOf(v, 0, 0, 0));
    expect(faceVisible(v, 0, 1, 0) && faceVisible(v, -1, 0, 0) && faceVisible(v, 0, 0, 1)).toBe(true);
    expect(faceVisible(v, 1, 0, 0) || faceVisible(v, 0, -1, 0)).toBe(false);
  });
});

describe("camera rig", () => {
  it("swings yaw and pitch together and settles after TRANSITION", () => {
    const r = new CameraRig();
    for (let t = 0; t < TRANSITION / 2; t += 0.01) r.update(0.01, "I");
    expect(r.yaw).toBeGreaterThan(0); expect(r.yaw).toBeLessThan(YAW_ISO);
    expect(r.yaw / YAW_ISO).toBeCloseTo((r.pitch - PITCH_SIDE) / (PITCH_ISO - PITCH_SIDE));
    for (let t = 0; t < 1; t += 0.01) r.update(0.01, "I");
    expect(r.yaw).toBe(0); expect(r.pitch).toBeCloseTo((12 * Math.PI) / 180); expect(r.background).toBe(1);
    const r2 = new CameraRig();
    expect(r2.background).toBe(0);
  });
});

describe("zone-driven controls", () => {
  it("finds the lane centre of the contiguous '=' rows at a column", () => {
    const raid = new Raid(FIRST_MAP, 1);
    expect(laneCentre(raid, 25.5, 8.4)).toBe(9); // first ledge: rows 8 and 9
    expect(laneCentre(raid, 25.5, 9.9)).toBe(9);
    expect(laneCentre(raid, 55.5, 17.2)).toBe(18); // second ledge: rows 17 and 18
    expect(laneCentre(raid, 10.5, 12)).toBeNull(); // arena
  });
  it("on a ledge the stick is left/right only, y steers to the lane, fire is off; in an arena it rotates by yaw", () => {
    const raid = new Raid(FIRST_MAP, 1);
    raid.player.pos = { x: 26, y: 8.3 };
    expect(raid.onPath).toBe(true);
    const c = controls(raid, { move: { x: 0.5, y: -1 }, fire: true }, 0);
    expect(c.move.x).toBe(0.5); expect(c.move.y).toBeGreaterThan(0); expect(c.fire).toBe(false);
    raid.player.pos = { x: 6, y: 13 };
    const a = controls(raid, { move: { x: 1, y: 0 }, fire: true }, YAW_ISO);
    expect(a.move.x).toBeCloseTo(Math.SQRT1_2); expect(a.move.y).toBeCloseTo(Math.SQRT1_2); expect(a.fire).toBe(true);
  });
  it("holding right along the first ledge keeps the player on the lane and walks into the loot arena", () => {
    const raid = new Raid(FIRST_MAP, 1);
    raid.crawlers = [];
    raid.player.pos = { x: 21, y: 8.6 };
    let maxDev = 0;
    for (let n = 0; n < 120 * 6; n++) {
      const inp = controls(raid, { ...idleRaidInput(), move: { x: 1, y: 0 } }, 0);
      raid.step(1 / 120, inp);
      if (raid.onPath && n > 120) maxDev = Math.max(maxDev, Math.abs(raid.player.pos.y - 9));
    }
    expect(raid.player.pos.x).toBeGreaterThan(34);
    expect(maxDev).toBeLessThan(0.5);
  });
});

describe("camera I band and camera clamp", () => {
  it("band: solid around the lane, fading to the back, cut in front and beyond lane-4 / lane+4", () => {
    const lane = 9;
    expect(bandRowAlpha(8, lane)).toBe(1); expect(bandRowAlpha(9, lane)).toBe(1); expect(bandRowAlpha(10, lane)).toBe(1);
    expect(bandRowAlpha(6, lane)).toBeLessThan(1); expect(bandRowAlpha(6, lane)).toBeGreaterThan(0);
    expect(bandRowAlpha(4, lane)).toBe(0); expect(bandRowAlpha(12, lane)).toBe(0);
    for (let ty = 0; ty < 30; ty++) if (bandRowAlpha(ty, lane) > 0) expect(Math.abs(ty + 0.5 - lane)).toBeLessThanOrEqual(4);
  });
  it("swing blends the band with the full map; rocks never stand in front of the lane", () => {
    expect(rowWeight(null, 20)).toBe(1);
    expect(rowWeight({ lane: 9, b: 0 }, 20)).toBe(1);
    expect(rowWeight({ lane: 9, b: 1 }, 20)).toBe(0);
    expect(rowWeight({ lane: 9, b: 0.5 }, 20)).toBeCloseTo(0.5);
    expect(bodyWeight({ lane: 9, b: 1 }, 11)).toBe(0);
    expect(fade(0.5, { lane: 9, b: 1 })).toEqual({ a: 1, dither: true });
    expect(fade(0.1, { lane: 9, b: 1 })).toBeNull();
  });
  it("clampAxis keeps the view inside the bounds and centres a map smaller than the view", () => {
    expect(clampAxis(-50, 0, 1000, 400)).toBe(0);
    expect(clampAxis(900, 0, 1000, 400)).toBe(600);
    expect(clampAxis(300, 0, 1000, 400)).toBe(300);
    expect(clampAxis(10, 0, 100, 400)).toBe(-150);
    const b = mapBounds(makeView(0, PITCH_SIDE), 72, 26);
    expect(b.minX).toBe(0); expect(b.maxX).toBeCloseTo(72 * 16);
  });
});
