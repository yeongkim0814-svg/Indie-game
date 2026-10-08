import { Grid } from "../game/inventory";
import { RAID, type Raid } from "../game/raid";
import { GridView, ItemController } from "./gridui";
import type { Input } from "./input";
import { carriedValueText, valueKnown } from "./know";

const CELL = 44;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "", parent?: HTMLElement) {
  const e = document.createElement(tag);
  e.className = cls; e.textContent = text;
  parent?.append(e);
  return e;
}

/** In-raid bag: backpack + field notebook grids. The game keeps running while it is open. */
export class BagPanel {
  readonly btn = el("button", "bag-btn", "가방");
  readonly panel = el("div", "bag-panel");
  readonly ctl = new ItemController();
  private pack: GridView;
  private note: GridView;
  private stats: HTMLElement;
  private trash: HTMLElement;
  private raid: Raid | null = null;
  private visible = false;
  private isOpen = false;
  private lastStats = "";

  constructor(root: HTMLElement, private input: Input) {
    this.btn.id = "btn-bag"; this.panel.id = "bag-panel";
    const cols = el("div", "bag-cols", "", this.panel);
    const left = el("div", "bag-col", "", cols), right = el("div", "bag-col note", "", cols);
    el("div", "bag-lbl", "배낭", left);
    const empty = { p: new Grid(RAID.backpack.w, RAID.backpack.h), n: new Grid(RAID.notebook.w, RAID.notebook.h) };
    this.pack = new GridView(empty.p, CELL, this.ctl, "grid-backpack");
    left.append(this.pack.el);
    this.stats = el("div", "bag-stats", "", left);
    el("div", "bag-lbl", "현장 수첩 — 죽어도 남음", right);
    this.note = new GridView(empty.n, CELL, this.ctl, "grid-notebook");
    right.append(this.note.el);
    const rot = el("button", "bag-act", "회전", right);
    rot.id = "btn-rotate"; rot.dataset.rotate = "1";
    rot.addEventListener("pointerdown", (e) => { e.preventDefault(); this.ctl.rotate(); });
    this.trash = el("div", "bag-trash", "버리기", right);
    this.trash.id = "bag-trash";
    this.ctl.trash = this.trash;
    this.trash.addEventListener("click", () => this.ctl.tapTrash());
    this.ctl.onTrash = (item) => !!this.raid?.dropItem(item);

    this.btn.addEventListener("click", () => this.setOpen(!this.isOpen));
    addEventListener("keydown", (e) => {
      if (!this.visible) return;
      if (e.key.toLowerCase() === "r" && this.isOpen) this.ctl.rotate();
      else if (e.key.toLowerCase() === "b") this.setOpen(!this.isOpen);
    });
    root.append(this.btn, this.panel);
    this.refreshVisibility();
  }

  get open() { return this.isOpen; }

  /** Attach to a (new) raid; the panel closes. */
  setRaid(raid: Raid) {
    this.raid = raid;
    this.ctl.reveal = (it) => valueKnown(raid.knowledge, it);
    this.pack.setGrid(raid.backpack); this.note.setGrid(raid.notebook);
    this.ctl.clear();
    this.setOpen(false);
  }

  /** Show the toggle button only during a raid. */
  setVisible(v: boolean) { this.visible = v; if (!v) this.setOpen(false); this.refreshVisibility(); }

  setOpen(o: boolean) {
    if (o && !this.visible) return;
    this.isOpen = o;
    if (!o) this.ctl.clear();
    this.input.setFireLocked(o);
    this.refreshVisibility();
    if (o) this.update();
  }

  private refreshVisibility() {
    this.btn.style.display = this.visible ? "block" : "none";
    this.btn.classList.toggle("on", this.isOpen);
    this.panel.style.display = this.visible && this.isOpen ? "block" : "none";
  }

  update() {
    if (!this.isOpen || !this.raid) return;
    this.ctl.validate();
    this.pack.sync(); this.note.sync();
    const r = this.raid;
    const s = `${(r.backpack.mass + r.notebook.mass).toFixed(1)}kg · 가치 ${carriedValueText(r.knowledge, r.carriedItems)}`;
    if (s !== this.lastStats) { this.lastStats = s; this.stats.textContent = `무게 ${s}`; }
  }
}
