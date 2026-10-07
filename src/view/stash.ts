/** Hideout storage: a 10×6 grid plus research points, persisted in localStorage. Items here do not age. */
import { Grid, type Placed } from "../game/inventory";
import { ITEMS, reserveUids, type Item } from "../game/items";

export const STASH_SIZE = { w: 10, h: 6 };
const GRID_KEY = "stash.grid";
const POINTS_KEY = "research.points";

export function loadStash(): Grid {
  try {
    const raw = localStorage.getItem(GRID_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { w: number; h: number; placed: Placed[] };
      if (d && d.w === STASH_SIZE.w && d.h === STASH_SIZE.h && Array.isArray(d.placed)) {
        d.placed = d.placed.filter((p) => p && p.item && p.item.kind in ITEMS && Number.isFinite(p.x) && Number.isFinite(p.y));
        const g = Grid.fromJSON(d);
        reserveUids(g.items);
        return g;
      }
    }
  } catch { /* corrupt or unavailable: start empty */ }
  return new Grid(STASH_SIZE.w, STASH_SIZE.h);
}

export function saveStash(g: Grid) {
  try { localStorage.setItem(GRID_KEY, JSON.stringify(g)); } catch { /* storage unavailable */ }
}

export function readPoints(): number {
  try {
    const n = parseInt(localStorage.getItem(POINTS_KEY) ?? "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

export function savePoints(n: number) {
  try { localStorage.setItem(POINTS_KEY, String(Math.max(0, Math.round(n)))); } catch { /* storage unavailable */ }
}

/** Auto-place raid loot into the stash. Returns the items that did not fit. */
export function depositAll(stash: Grid, items: Item[]): Item[] {
  const lost: Item[] = [];
  for (const it of items) if (!stash.autoPlace(it)) lost.push(it);
  return lost;
}
