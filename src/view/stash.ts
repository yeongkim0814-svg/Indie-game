/** Hideout storage: a 10×6 grid plus research points, persisted in localStorage. Items here do not age. */
import { Grid, type Placed } from "../game/inventory";
import { ITEMS, reserveUids, type Item, type ItemKind } from "../game/items";
import { FACILITIES, KNOWLEDGE, newProgress, type FacilityId, type KnowledgeId, type Progress } from "../game/knowledge";

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

const PROGRESS_KEY = "progress";

/** Load saved Progress; validates every field. Migrates the old "research.points" value when no progress exists. */
export function loadProgress(): Progress {
  const p = newProgress();
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === "object") {
        if (Number.isFinite(d.points) && d.points > 0) p.points = Math.round(d.points);
        if (Array.isArray(d.facilities)) p.facilities = [...new Set(d.facilities)].filter((f): f is FacilityId => typeof f === "string" && f in FACILITIES);
        if (Array.isArray(d.knowledge)) p.knowledge = [...new Set(d.knowledge)].filter((k): k is KnowledgeId => typeof k === "string" && k in KNOWLEDGE);
        return p;
      }
    }
    p.points = readPoints();
    saveProgress(p);
  } catch { /* corrupt or unavailable: defaults */ }
  return p;
}

export function saveProgress(p: Progress) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

/** Count stash items by kind. */
export function stockOf(g: Grid): Partial<Record<ItemKind, number>> {
  const s: Partial<Record<ItemKind, number>> = {};
  for (const it of g.items) s[it.kind] = (s[it.kind] ?? 0) + 1;
  return s;
}

/** Remove `n` items of `kind` from the stash, lowest value first. */
export function takeMaterials(g: Grid, kind: ItemKind, n: number, value: (it: Item) => number) {
  const picks = g.items.filter((i) => i.kind === kind).sort((a, b) => value(a) - value(b)).slice(0, n);
  for (const it of picks) g.remove(it);
}

/** Auto-place raid loot into the stash. Returns the items that did not fit. */
export function depositAll(stash: Grid, items: Item[]): Item[] {
  const lost: Item[] = [];
  for (const it of items) if (!stash.autoPlace(it)) lost.push(it);
  return lost;
}
