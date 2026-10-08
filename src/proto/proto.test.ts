import { describe, expect, it } from "vitest";
import { Raid, idleRaidInput } from "../game/raid";
import { PROTO_MAP, TILES, LANE_Y, zoneAt } from "./world";
import { PITCH_ISO, YAW_ISO, depthOf, faceVisible, makeView, project } from "./project";
import { CameraRig, TRANSITION } from "./camera";

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
    expect(r.yaw / YAW_ISO).toBeCloseTo(r.pitch / PITCH_ISO);
    for (let t = 0; t < 1; t += 0.01) r.update(0.01, "I");
    expect(r.yaw).toBe(0); expect(r.pitch).toBe(0); expect(r.background).toBe(1);
  });
});

describe("proto map", () => {
  it("is reachable from start to extraction on foot, through the ledge", () => {
    const raid = new Raid(PROTO_MAP, 7);
    raid.crawlers = [];
    const ex = raid.map.extraction;
    expect(ex.r).toBeGreaterThan(0);
    // BFS over tiles
    const key = (x: number, y: number) => y * 100 + x;
    const sx = Math.floor(raid.player.pos.x), sy = Math.floor(raid.player.pos.y);
    const prev = new Map<number, number>([[key(sx, sy), -1]]);
    const q: [number, number][] = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (prev.has(key(nx, ny)) || raid.blocksWalker(nx + 0.5, ny + 0.5)) continue;
        prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
      }
    }
    const goal = key(Math.floor(ex.x), Math.floor(ex.y));
    expect(prev.has(goal)).toBe(true);
    const path: [number, number][] = [];
    for (let k = goal; k !== -1; k = prev.get(k)!) path.unshift([(k % 100) + 0.5, Math.floor(k / 100) + 0.5]);
    expect(path.some(([x, y]) => zoneAt(x, y) === "path")).toBe(true);
    // and the physics agrees: steer along the tile path
    let i = 1;
    for (let n = 0; n < 120 * 120 && raid.state === "running"; n++) {
      const p = raid.player.pos, [tx, ty] = path[Math.min(i, path.length - 1)];
      const d = Math.hypot(tx - p.x, ty - p.y);
      if (d < 0.35 && i < path.length - 1) i++;
      const inp = idleRaidInput();
      inp.move = { x: (tx - p.x) / Math.max(d, 1e-6), y: (ty - p.y) / Math.max(d, 1e-6) };
      raid.step(1 / 120, inp);
    }
    expect(raid.state).toBe("extracted");
  });
  it("has a 2 m wide, 30 m long ledge with void on both sides", () => {
    let len = 0;
    for (let x = 0; x < TILES[0].length; x++) {
      const col = TILES.map((r) => r[x]).join("");
      if (col.includes("=")) { len++; expect(col.match(/=/g)!.length).toBe(2); }
    }
    expect(len).toBe(30);
    expect(TILES[LANE_Y - 2][30]).toBe("~"); expect(TILES[LANE_Y + 1][30]).toBe("~");
  });
});
