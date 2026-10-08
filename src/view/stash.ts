/** Hideout storage: a 10×6 grid plus research points, persisted in localStorage. Items here do not age. */
import { Grid, type Placed } from "../game/inventory";
import { ITEMS, reserveUids, type Item, type ItemKind } from "../game/items";
import { isWeaponKind, modSlots } from "../game/weapons";
import { FACILITIES, KNOWLEDGE, newProgress, type FacilityId, type KnowledgeId, type Progress } from "../game/knowledge";

export const STASH_SIZE = { w: 10, h: 6 };
const GRID_KEY = "stash.grid";
const POINTS_KEY = "research.points";

/** Is this a well-formed saved item? Strips malformed mods in place; also reserves its uids. */
export function validItem(it: unknown): it is Item {
  const x = it as Item | null;
  if (!x || typeof x !== "object" || typeof x.kind !== "string" || !(x.kind in ITEMS) || !Number.isFinite(x.uid)) return false;
  if (x.charge !== undefined && !Number.isFinite(x.charge)) delete x.charge;
  if (x.mods) {
    if (typeof x.mods !== "object" || !modSlots(x.kind).length) delete x.mods;
    else {
      const m = x.mods;
      if (m.stock && !(validItem(m.stock) && m.stock.kind === "stock" && modSlots(x.kind).includes("stock"))) delete m.stock;
      if (m.sight && !(validItem(m.sight) && m.sight.kind === "scope")) delete m.sight;
    }
  }
  reserveUids([x]);
  return true;
}

/** Load a saved grid of the given size; anything malformed yields an empty grid. */
export function loadGrid(key: string, size: { w: number; h: number }): Grid {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const d = JSON.parse(raw) as { w: number; h: number; placed: Placed[] };
      if (d && d.w === size.w && d.h === size.h && Array.isArray(d.placed)) {
        d.placed = d.placed.filter((p) => p && validItem(p.item) && Number.isFinite(p.x) && Number.isFinite(p.y));
        return Grid.fromJSON(d);
      }
    }
  } catch { /* corrupt or unavailable: start empty */ }
  return new Grid(size.w, size.h);
}

export function loadStash(): Grid { return loadGrid(GRID_KEY, STASH_SIZE); }

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

// ---- loadout: the equipped weapon and the pre-raid pack ------------------------------------------
export const PACK_SIZE = { w: 5, h: 3 };
const WEAPON_KEY = "loadout.weapon";
const PACK_KEY = "loadout.pack";

export function loadWeapon(): Item | null {
  try {
    const raw = localStorage.getItem(WEAPON_KEY);
    if (raw) {
      const it = JSON.parse(raw);
      if (validItem(it) && isWeaponKind(it.kind)) return it;
    }
  } catch { /* corrupt or unavailable: no weapon */ }
  return null;
}
export function saveWeapon(it: Item | null) {
  try { if (it) localStorage.setItem(WEAPON_KEY, JSON.stringify(it)); else localStorage.removeItem(WEAPON_KEY); } catch { /* storage unavailable */ }
}
export function loadPack(): Grid { return loadGrid(PACK_KEY, PACK_SIZE); }
export function savePack(g: Grid) {
  try { localStorage.setItem(PACK_KEY, JSON.stringify(g)); } catch { /* storage unavailable */ }
}
