/** Tetris-style grid inventory (Tarkov): items occupy w×h cells and may be rotated 90°. */
import { ITEMS, itemMass, itemSize, type Item } from "./items";

export interface Placed {
  item: Item;
  x: number;
  y: number;
  rot: boolean;
}

export function footprint(item: Item, rot: boolean) {
  const d = itemSize(item);
  return rot ? { w: d.h, h: d.w } : d;
}

export class Grid {
  placed: Placed[] = [];
  constructor(readonly w: number, readonly h: number) {}

  /** Can `item` sit at (x,y)? `ignore` lets an item test a move onto its own old cells. */
  canPlace(item: Item, x: number, y: number, rot: boolean, ignore?: Item): boolean {
    if (rot && !ITEMS[item.kind].rotatable) return false;
    const f = footprint(item, rot);
    if (x < 0 || y < 0 || x + f.w > this.w || y + f.h > this.h) return false;
    for (const p of this.placed) {
      if (p.item === ignore || p.item === item) continue;
      const g = footprint(p.item, p.rot);
      if (x < p.x + g.w && p.x < x + f.w && y < p.y + g.h && p.y < y + f.h) return false;
    }
    return true;
  }

  place(item: Item, x: number, y: number, rot: boolean): boolean {
    if (!this.canPlace(item, x, y, rot)) return false;
    this.remove(item);
    this.placed.push({ item, x, y, rot });
    return true;
  }

  /** First free spot scanning rows top-left first, unrotated before rotated. */
  findSpot(item: Item): { x: number; y: number; rot: boolean } | null {
    for (const rot of [false, true]) {
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.canPlace(item, x, y, rot)) return { x, y, rot };
    }
    return null;
  }

  autoPlace(item: Item): boolean {
    const s = this.findSpot(item);
    return !!s && this.place(item, s.x, s.y, s.rot);
  }

  remove(item: Item): boolean {
    const i = this.placed.findIndex((p) => p.item === item);
    if (i < 0) return false;
    this.placed.splice(i, 1);
    return true;
  }

  at(cx: number, cy: number): Placed | undefined {
    return this.placed.find((p) => {
      const f = footprint(p.item, p.rot);
      return cx >= p.x && cx < p.x + f.w && cy >= p.y && cy < p.y + f.h;
    });
  }

  get items(): Item[] {
    return this.placed.map((p) => p.item);
  }

  get mass(): number {
    return this.placed.reduce((m, p) => m + itemMass(p.item), 0);
  }

  toJSON() {
    return { w: this.w, h: this.h, placed: this.placed };
  }

  static fromJSON(data: { w: number; h: number; placed: Placed[] }): Grid {
    const g = new Grid(data.w, data.h);
    for (const p of data.placed ?? []) if (g.canPlace(p.item, p.x, p.y, p.rot)) g.placed.push(p);
    return g;
  }
}

/** Move an item between (or within) grids. Returns false and leaves everything unchanged if it doesn't fit. */
export function moveItem(from: Grid, to: Grid, item: Item, x: number, y: number, rot: boolean): boolean {
  if (!to.canPlace(item, x, y, rot, item)) return false;
  from.remove(item);
  to.remove(item);
  to.placed.push({ item, x, y, rot });
  return true;
}
