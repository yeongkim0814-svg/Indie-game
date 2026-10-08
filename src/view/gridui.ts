/** DOM grid inventory widgets shared by the in-raid bag and the hideout stash. */
import { footprint, moveItem, type Grid } from "../game/inventory";
import { ITEMS, itemValue, type Item, type ItemKind } from "../game/items";
import { BATTERY_CAPACITY, WEAPONS } from "../game/weapons";

export const SHORT: Record<ItemKind, string> = {
  quartz: "석영", ore: "광물", bio: "생물", launcher: "발사기", lens: "렌즈", coilgun: "코일건", battery: "전지", stock: "개머리판", scope: "조준경",
};

/** Coilgun shots left in a battery. */
export function shotsLeft(it: Item) { return Math.floor((it.charge ?? 0) / WEAPONS.coilgun.energy); }

/** Second line of a block: research value for samples (or "?"), shots left for batteries, nothing for other gear. */
function subText(it: Item, known: boolean): string {
  if (it.kind === "battery") return `${shotsLeft(it)}발`;
  if (ITEMS[it.kind].gear) return "";
  return known ? String(Math.round(itemValue(it))) : "?";
}

/** Fill-bar fraction: freshness of a sample, charge of a battery. */
function barFrac(it: Item, known: boolean): number {
  if (it.kind === "battery") return Math.max(0, Math.min(1, (it.charge ?? 0) / BATTERY_CAPACITY));
  if (ITEMS[it.kind].gear || !known) return 0;
  return itemValue(it) / ITEMS[it.kind].value;
}

function modKey(it: Item) { return `${it.mods?.stock ? "s" : ""}${it.mods?.sight ? "c" : ""}`; }
const DRAG_PX = 6;

/** One grid on screen: cell backdrop plus an absolutely positioned block per placed item. */
export class GridView {
  readonly el = document.createElement("div");
  private blocks = new Map<Item, { el: HTMLElement; key: string; val: HTMLElement; vtxt: string; bar: HTMLElement; btxt: string; badges: HTMLElement; mkey: string }>();
  private preview = document.createElement("div");

  constructor(public grid: Grid, public cell: number, readonly ctl: ItemController, id?: string) {
    this.el.className = "gv";
    if (id) this.el.id = id;
    this.preview.className = "gv-preview";
    this.preview.style.display = "none";
    this.el.append(this.preview);
    this.el.addEventListener("pointerdown", (e) => { if (e.target === this.el) this.ctl.tapGrid(this, e); });
    this.ctl.views.push(this);
    this.layoutSize();
  }

  setGrid(g: Grid) { this.grid = g; this.layoutSize(); this.sync(); }
  setCell(px: number) { this.cell = px; this.layoutSize(); this.sync(true); }

  private layoutSize() {
    this.el.style.width = `${this.grid.w * this.cell}px`;
    this.el.style.height = `${this.grid.h * this.cell}px`;
    this.el.style.setProperty("--cell", `${this.cell}px`);
  }

  showPreview(x: number, y: number, w: number, h: number, ok: boolean) {
    const s = this.preview.style, c = this.cell;
    s.display = "block"; s.left = `${x * c}px`; s.top = `${y * c}px`; s.width = `${w * c}px`; s.height = `${h * c}px`;
    this.preview.className = `gv-preview ${ok ? "ok" : "bad"}`;
  }
  hidePreview() { this.preview.style.display = "none"; }

  flashBad(item: Item) {
    const b = this.blocks.get(item);
    if (!b) return;
    b.el.classList.add("bad");
    setTimeout(() => b.el.classList.remove("bad"), 350);
  }

  /** Reconcile DOM with grid state; cheap enough to call every frame. */
  sync(force = false) {
    const live = new Set<Item>();
    const c = this.cell, sel = this.ctl.selected?.item, dragging = this.ctl.draggingItem;
    for (const p of this.grid.placed) {
      live.add(p.item);
      const f = footprint(p.item, p.rot);
      let b = this.blocks.get(p.item);
      if (!b) {
        const el = document.createElement("div");
        el.className = "blk";
        el.dataset.kind = p.item.kind; el.dataset.uid = String(p.item.uid);
        const nm = document.createElement("span"); nm.className = "n"; nm.textContent = SHORT[p.item.kind];
        const val = document.createElement("span"); val.className = "v";
        const bar = document.createElement("i"); bar.className = "bar";
        const badges = document.createElement("span"); badges.className = "mods";
        el.append(nm, badges, val, bar);
        const item = p.item;
        el.addEventListener("pointerdown", (e) => { e.stopPropagation(); this.ctl.press(this, item, e); });
        this.el.append(el);
        b = { el, key: "", val, vtxt: "", bar, btxt: "", badges, mkey: "" };
        this.blocks.set(p.item, b);
      }
      const key = `${p.x},${p.y},${f.w},${f.h},${c}`;
      if (force || key !== b.key) {
        b.key = key;
        const s = b.el.style;
        s.left = `${p.x * c + 1}px`; s.top = `${p.y * c + 1}px`; s.width = `${f.w * c - 2}px`; s.height = `${f.h * c - 2}px`;
      }
      const known = this.ctl.reveal(p.item);
      const vt = subText(p.item, known);
      if (vt !== b.vtxt) { b.vtxt = vt; b.val.textContent = vt; }
      const bt = `${Math.round(barFrac(p.item, known) * 100)}%`;
      if (bt !== b.btxt) { b.btxt = bt; b.bar.style.width = bt; b.bar.style.display = bt === "0%" && ITEMS[p.item.kind].gear && p.item.kind !== "battery" ? "none" : ""; }
      const mk = modKey(p.item);
      if (mk !== b.mkey) {
        b.mkey = mk;
        b.badges.replaceChildren();
        for (const [on, label, cls] of [[p.item.mods?.stock, "개머리판", "stock"], [p.item.mods?.sight, "조준경", "sight"]] as const) {
          if (!on) continue;
          const t = document.createElement("i"); t.className = `badge ${cls}`; t.textContent = label;
          b.badges.append(t);
        }
      }
      b.el.classList.toggle("sel", p.item === sel);
      b.el.classList.toggle("dragging", p.item === dragging);
    }
    for (const [item, b] of this.blocks) if (!live.has(item)) { b.el.remove(); this.blocks.delete(item); }
  }
}

interface Press { view: GridView; item: Item; pointerId: number; sx: number; sy: number; wasSel: boolean; dragging: boolean; touch: boolean }

/** Pointer-drag + tap-select interaction across any number of GridViews (and an optional trash target). */
export class ItemController {
  readonly views: GridView[] = [];
  selected: { view: GridView; item: Item } | null = null;
  trash: HTMLElement | null = null;
  onChange: () => void = () => {};
  onSelect: () => void = () => {};
  /** Is this item's current value known to the player? (radiochem / physiology) */
  reveal: (item: Item) => boolean = () => true;
  /** Return true if the item was thrown away. */
  onTrash: ((item: Item) => boolean) | null = null;
  private rot = false;
  private press0: Press | null = null;
  private ghost: HTMLElement | null = null;
  private lastPt = { x: 0, y: 0 };

  get draggingItem(): Item | null { return this.press0?.dragging ? this.press0.item : null; }
  get selectedItem(): Item | null { return this.selected?.item ?? null; }

  /** Drop a selection whose item has left its grid. */
  validate() {
    if (this.selected && !this.selected.view.grid.placed.some((p) => p.item === this.selected!.item)) {
      this.selected = null; this.onSelect();
    }
    if (this.press0 && !this.press0.view.grid.placed.some((p) => p.item === this.press0!.item)) this.endPress(true);
  }

  clear() { this.endPress(true); this.selected = null; this.onSelect(); }

  private select(view: GridView, item: Item | null) {
    this.selected = item ? { view, item } : null;
    this.onSelect();
  }

  press(view: GridView, item: Item, e: PointerEvent) {
    e.preventDefault();
    if (this.press0) return;
    const wasSel = this.selected?.item === item;
    const pl = view.grid.placed.find((p) => p.item === item);
    this.rot = pl?.rot ?? false;
    this.press0 = { view, item, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, wasSel, dragging: false, touch: e.pointerType === "touch" };
    this.lastPt = { x: e.clientX, y: e.clientY };
    this.select(view, item);
    addEventListener("pointermove", this.onMove);
    addEventListener("pointerup", this.onUp);
    addEventListener("pointercancel", this.onCancel);
    addEventListener("pointerdown", this.onOther, true);
  }

  private onOther = (e: PointerEvent) => {
    // a second finger tapping anywhere while dragging rotates the item
    const p = this.press0;
    if (!p || !p.dragging || e.pointerId === p.pointerId) return;
    if ((e.target as HTMLElement | null)?.closest?.("[data-rotate]")) return;
    this.rotate();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.press0;
    if (!p || e.pointerId !== p.pointerId) return;
    this.lastPt = { x: e.clientX, y: e.clientY };
    if (!p.dragging && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > DRAG_PX) {
      p.dragging = true;
      this.ghost = document.createElement("div");
      this.ghost.className = "blk ghost";
      this.ghost.dataset.kind = p.item.kind;
      this.ghost.innerHTML = `<span class="n">${SHORT[p.item.kind]}</span><span class="v">${subText(p.item, this.reveal(p.item))}</span>`;
      document.body.append(this.ghost);
    }
    if (p.dragging) this.updateDrag();
  };

  private onUp = (e: PointerEvent) => {
    const p = this.press0;
    if (!p || e.pointerId !== p.pointerId) return;
    this.lastPt = { x: e.clientX, y: e.clientY };
    if (p.dragging) {
      const aim = this.aim();
      if (aim?.trash) {
        if (this.onTrash?.(p.item)) { this.select(p.view, null); this.onChange(); }
      } else if (aim && aim.ok && moveItem(p.view.grid, aim.view.grid, p.item, aim.x, aim.y, this.rot)) {
        this.select(aim.view, p.item);
        this.onChange();
      } else p.view.flashBad(p.item);
    } else if (p.wasSel) this.select(p.view, null);
    this.endPress(false);
  };

  private onCancel = (e: PointerEvent) => { if (this.press0 && e.pointerId === this.press0.pointerId) this.endPress(true); };

  private endPress(_cancelled: boolean) {
    removeEventListener("pointermove", this.onMove);
    removeEventListener("pointerup", this.onUp);
    removeEventListener("pointercancel", this.onCancel);
    removeEventListener("pointerdown", this.onOther, true);
    this.ghost?.remove(); this.ghost = null;
    this.press0 = null;
    for (const v of this.views) v.hidePreview();
    this.trash?.classList.remove("hot");
  }

  /** What is under the pointer: a grid cell anchor (footprint centred on the pointer) or the trash zone. */
  private aim(): { view: GridView; x: number; y: number; ok: boolean; trash?: false } | { trash: true } | null {
    const p = this.press0;
    if (!p) return null;
    const lift = p.touch ? -36 : 0;
    const px = this.lastPt.x, py = this.lastPt.y + lift;
    if (this.trash) {
      const r = this.trash.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return { trash: true };
    }
    const f = footprint(p.item, this.rot);
    for (const v of this.views) {
      if (!v.el.isConnected || v.el.offsetParent === null && getComputedStyle(v.el).position !== "fixed") continue;
      const r = v.el.getBoundingClientRect(), c = v.cell, m = c / 2;
      if (px < r.left - m || px > r.right + m || py < r.top - m || py > r.bottom + m) continue;
      let x = Math.round((px - r.left) / c - f.w / 2), y = Math.round((py - r.top) / c - f.h / 2);
      x = Math.max(0, Math.min(v.grid.w - f.w, x)); y = Math.max(0, Math.min(v.grid.h - f.h, y));
      return { view: v, x, y, ok: v.grid.canPlace(p.item, x, y, this.rot, p.item) };
    }
    return null;
  }

  private updateDrag() {
    const p = this.press0;
    if (!p || !this.ghost) return;
    const f = footprint(p.item, this.rot), c = p.view.cell, lift = p.touch ? -36 : 0;
    const g = this.ghost.style;
    g.width = `${f.w * c - 2}px`; g.height = `${f.h * c - 2}px`;
    g.left = `${this.lastPt.x - (f.w * c) / 2}px`; g.top = `${this.lastPt.y + lift - (f.h * c) / 2}px`;
    for (const v of this.views) v.hidePreview();
    const a = this.aim();
    this.trash?.classList.toggle("hot", !!a && "trash" in a && a.trash === true);
    if (a && !("trash" in a && a.trash)) {
      const t = a as { view: GridView; x: number; y: number; ok: boolean };
      t.view.showPreview(t.x, t.y, f.w, f.h, t.ok);
    }
  }

  /** Toggle rotation of the dragged item, or rotate the selected item in place (nudging to the nearest spot that fits). */
  rotate() {
    const p = this.press0;
    if (p?.dragging) { this.rot = !this.rot; this.updateDrag(); return; }
    const s = this.selected;
    if (!s) return;
    const pl = s.view.grid.placed.find((q) => q.item === s.item);
    if (!pl) return;
    const rot = !pl.rot, f = footprint(s.item, rot);
    let best: { x: number; y: number } | null = null, bd = 1e9;
    for (let y = 0; y <= s.view.grid.h - f.h; y++) for (let x = 0; x <= s.view.grid.w - f.w; x++) {
      const d = Math.abs(x - pl.x) + Math.abs(y - pl.y);
      if (d < bd && s.view.grid.canPlace(s.item, x, y, rot, s.item)) { bd = d; best = { x, y }; }
    }
    if (best && moveItem(s.view.grid, s.view.grid, s.item, best.x, best.y, rot)) this.onChange();
    else s.view.flashBad(s.item);
  }

  /** Fallback: with an item selected, tap a cell to move it there. */
  tapGrid(view: GridView, e: PointerEvent) {
    const s = this.selected;
    if (!s) return;
    e.preventDefault();
    const pl = s.view.grid.placed.find((q) => q.item === s.item);
    if (!pl) return;
    const r = view.el.getBoundingClientRect();
    const f = footprint(s.item, pl.rot);
    const x = Math.max(0, Math.min(view.grid.w - f.w, Math.floor((e.clientX - r.left) / view.cell)));
    const y = Math.max(0, Math.min(view.grid.h - f.h, Math.floor((e.clientY - r.top) / view.cell)));
    if (moveItem(s.view.grid, view.grid, s.item, x, y, pl.rot)) { this.selected = { view, item: s.item }; this.onChange(); }
    else s.view.flashBad(s.item);
  }

  /** Fallback: with an item selected, tap the trash zone to discard it. */
  tapTrash() {
    const s = this.selected;
    if (s && this.onTrash?.(s.item)) { this.select(s.view, null); this.onChange(); }
  }
}
