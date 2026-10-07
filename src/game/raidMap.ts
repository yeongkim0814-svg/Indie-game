import type { ItemKind } from "./items";

/**
 * Raid map as ASCII rows. 1 tile = 1 m.
 *   '#' rock (blocks walkers and bullets)   '.' ground
 *   '~' cliff edge / void (blocks walkers, bullets fly over; the vista lives beyond it)
 *   'P' player start   'E' extraction zone   'c' crawler
 *   samples: 's' quartz, 'o' radioactive ore, 'b' biological specimen
 */
export const FIRST_MAP = [
  "########################################~~~~~~~~",
  "#......#..............#.................~~~~~~~~",
  "#..P...#.....s........#.......c.........~~~~~~~~",
  "#......#..............#.................~~~~~~~~",
  "#................o.................o....~~~~~~~~",
  "#......#......###.......................~~~~~~~~",
  "#......#......###..........c.............~~~~~~~",
  "####.###..................................~~~~~~",
  "#..........c........#####.................~~~~~~",
  "#...................#####....b..........o.~~~~~~",
  "#.....o.............................c......~~~~~",
  "#.........###..............................~~~~~",
  "#.........###.........c..........###.......~~~~~",
  "#.............................b..###.......~~~~~",
  "#.....c.............s......................~~~~~",
  "#..........................#####............~~~~",
  "#....###...................#####......b.....~~~~",
  "#....###.s.......c..........................~~~~",
  "#.................................c..........~~~",
  "#..o.......#####..............................~~",
  "#..........#####.......s.............EEE......~~",
  "#....................................EEE......~~",
  "#.............c......................EEE.......~",
  "################################################",
];

const SAMPLE_MARKS: Record<string, ItemKind> = { s: "quartz", o: "ore", b: "bio" };

export interface ParsedMap {
  w: number;
  h: number;
  rows: string[];
  start: { x: number; y: number };
  extraction: { x: number; y: number; r: number };
  samples: { x: number; y: number; kind: ItemKind }[];
  crawlers: { x: number; y: number }[];
}

/** Parse markers into entity spawns (tile centers) and replace them with ground. */
export function parseMap(src: string[]): ParsedMap {
  const rows: string[] = [];
  const samples: { x: number; y: number; kind: ItemKind }[] = [];
  const crawlers: { x: number; y: number }[] = [];
  let start = { x: 1.5, y: 1.5 };
  let ex = 0, ey = 0, en = 0;
  src.forEach((line, y) => {
    let out = "";
    [...line].forEach((ch, x) => {
      const c = { x: x + 0.5, y: y + 0.5 };
      if (ch === "P") start = c;
      else if (ch in SAMPLE_MARKS) samples.push({ ...c, kind: SAMPLE_MARKS[ch] });
      else if (ch === "c") crawlers.push(c);
      else if (ch === "E") { ex += c.x; ey += c.y; en++; }
      out += ch === "#" || ch === "~" ? ch : ".";
    });
    rows.push(out);
  });
  const extraction = en ? { x: ex / en, y: ey / en, r: Math.sqrt(en / Math.PI) + 0.3 } : { x: -99, y: -99, r: 0 };
  return { w: Math.max(...rows.map((r) => r.length)), h: rows.length, rows, start, extraction, samples, crawlers };
}
