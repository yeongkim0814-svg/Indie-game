
/**
 * Prototype map. '#' rock box  '.' arena ground  '=' ledge path (camera I)  '~' void  plus P E c s o b markers.
 * West arena 18x14, a 2 m wide ledge 30 m long with void on both sides, a small east arena with the extraction.
 */
function build(): string[] {
  const W = 60, H = 20;
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill("~"));
  const rect = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = ch;
  };
  const put = (pts: [number, number][], ch: string) => pts.forEach(([x, y]) => (g[y][x] = ch));
  rect(1, 3, 18, 16, "."); // west arena 18 x 14
  rect(19, 9, 48, 10, "="); // ledge, 30 m
  rect(49, 5, 57, 14, "."); // east arena
  put([[6, 5], [7, 5], [6, 6], [11, 10], [12, 10], [14, 4], [14, 5], [9, 14], [10, 14], [15, 13], [16, 13], [4, 11]], "#");
  put([[3, 8]], "P");
  put([[12, 5], [13, 12], [8, 12]], "c");
  put([[5, 13], [16, 7], [10, 7]], "s");
  put([[15, 15], [9, 4]], "o");
  put([[4, 15]], "b");
  put([[52, 7], [53, 7], [52, 12], [51, 13], [56, 12]], "#");
  rect(54, 8, 56, 10, "E");
  put([[50, 6]], "s");
  put([[57, 6]], "b");
  return g.map((r) => r.join(""));
}

export const PROTO_MAP = build();
/** The lane centre line of the ledge (rows 9 and 10 meet at y = 10). */
export const LANE_Y = 10;
export const ROCK_H = 1.6;
export const SLAB_D = 3;

/** Tile layer with the ledge kept as '=' (Raid's own map folds it into '.'); markers become '.'. */
export const TILES: string[] = PROTO_MAP.map((r) => r.replace(/[PEcsobkg]/g, "."));

export function tileAt(x: number, y: number): string {
  const tx = Math.floor(x), ty = Math.floor(y);
  return TILES[ty]?.[tx] ?? "~";
}
export type Zone = "arena" | "path";
export function zoneAt(x: number, y: number): Zone {
  return tileAt(x, y) === "=" ? "path" : "arena";
}
