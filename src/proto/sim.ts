import type { Crawler, Raid, RaidInput } from "../game/raid";
import { zoneAt } from "./world";

/**
 * Raid.step plus the prototype rule that crawlers never walk onto the ledge ('=' tiles): a crawler whose centre lands on a
 * path tile is put back at its last valid position with zero velocity, so it gives up at the ledge mouth.
 */
export function stepProto(raid: Raid, dt: number, input: RaidInput, last: WeakMap<Crawler, { x: number; y: number }>) {
  raid.step(dt, input);
  for (const c of raid.crawlers) {
    const prev = last.get(c);
    if (zoneAt(c.pos.x, c.pos.y) === "path") {
      if (prev) { c.pos.x = prev.x; c.pos.y = prev.y; }
      c.vel.x = c.vel.y = 0;
    } else last.set(c, { x: c.pos.x, y: c.pos.y });
  }
}
