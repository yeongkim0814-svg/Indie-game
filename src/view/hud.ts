import { Grid } from "../game/inventory";
import { ITEMS, itemValue, type Item } from "../game/items";
import { RAID, type Raid, type RaidState } from "../game/raid";
import { GridView, ItemController } from "./gridui";
import type { Renderer } from "./render";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "", parent?: HTMLElement) {
  const e = document.createElement(tag);
  e.className = cls; e.textContent = text;
  parent?.append(e);
  return e;
}

/** Native-resolution DOM: rotate notice, hideout, in-raid HUD, results. */
export class Hud {
  private rotate = el("div", "overlay", "가로로 돌려 주세요");
  private hideout = el("div", "overlay screen");
  private pointsText: HTMLElement;
  private selText: HTMLElement;
  readonly stashCtl = new ItemController();
  readonly stashView: GridView;
  readonly analyzeBtn: HTMLButtonElement;
  readonly startBtn: HTMLButtonElement;
  private results = el("div", "overlay screen");
  private resultTitle: HTMLElement;
  private resultList: HTMLElement;
  private toasts = el("div", "toasts");
  readonly hideoutBtn: HTMLButtonElement;
  private hud = el("div", "hud");
  private pips: HTMLElement[] = [];
  private timer: HTMLElement;
  private stats: HTMLElement;
  private bar = el("div", "extract-bar");
  private barFill: HTMLElement;
  private arrow = el("div", "arrow", "▶");
  private last = { hp: -1, t: -1, n: "" };

  constructor(root: HTMLElement, private renderer: Renderer) {
    this.rotate.id = "rotate";
    this.hideout.id = "screen-hideout"; this.results.id = "screen-results";

    const row = el("div", "hide-row", "", this.hideout);
    const left = el("div", "hide-left", "", row), right = el("div", "hide-right", "", row);
    el("div", "bag-lbl", "창고", left);
    this.stashView = new GridView(emptyGrid(), 40, this.stashCtl, "grid-stash");
    left.append(this.stashView.el);
    el("div", "title", "아지트", right);
    el("div", "sub", "해가 지기 전에 표본을 모아 탈출하세요", right);
    this.pointsText = el("div", "stash", "", right);
    this.pointsText.id = "research-points";
    this.selText = el("div", "sub sel-info", "", right);
    this.analyzeBtn = el("button", "btn small", "분석", right);
    this.analyzeBtn.id = "btn-analyze";
    this.startBtn = el("button", "btn", "원정 출발", right);
    this.startBtn.id = "btn-start";
    this.stashCtl.onSelect = () => this.refreshSelection();
    this.refreshSelection();

    this.resultTitle = el("div", "title", "", this.results);
    this.resultList = el("div", "result-list", "", this.results);
    this.hideoutBtn = el("button", "btn", "아지트로", this.results);
    this.hideoutBtn.id = "btn-hideout";

    const hp = el("div", "hp", "", this.hud);
    for (let i = 0; i < RAID.player.hp; i++) this.pips.push(el("div", "pip", "", hp));
    this.timer = el("div", "timer", "", this.hud);
    this.stats = el("div", "samples", "", this.hud);
    this.barFill = el("div", "extract-fill", "", this.bar);
    el("div", "extract-label", "탈출 중", this.bar);
    this.hud.append(this.bar);
    this.hud.id = "hud";

    root.append(this.hud, this.arrow, this.toasts, this.hideout, this.results, this.rotate);
    this.show("hideout");
    this.setPortrait(false);
  }

  setPortrait(p: boolean) { this.rotate.style.display = p ? "flex" : "none"; }

  show(screen: "hideout" | "raid" | "results") {
    this.hideout.style.display = screen === "hideout" ? "flex" : "none";
    this.results.style.display = screen === "results" ? "flex" : "none";
    this.hud.style.display = screen === "raid" ? "block" : "none";
    if (screen !== "raid") this.arrow.style.display = "none";
    this.last = { hp: -1, t: -1, n: "" };
    if (screen !== "hideout") this.stashCtl.clear();
    if (screen !== "raid") this.toasts.replaceChildren();
  }

  /** Bind the hideout screen to the persisted stash. */
  setStash(grid: Grid, points: number) {
    const cell = Math.max(28, Math.min(44, Math.floor(Math.min((innerWidth - 330) / grid.w, (innerHeight - 70) / grid.h))));
    this.stashView.setCell(cell);
    this.stashView.setGrid(grid);
    this.stashCtl.clear();
    this.setPoints(points);
  }

  setPoints(n: number) { this.pointsText.textContent = `연구 점수  ${n}`; }

  /** Per-frame while on the hideout screen. */
  updateStash() { this.stashCtl.validate(); this.stashView.sync(); }

  private refreshSelection() {
    const it = this.stashCtl.selectedItem;
    this.analyzeBtn.disabled = !it;
    this.selText.textContent = it ? `${ITEMS[it.kind].name} — 분석하면 연구 점수 +${Math.round(itemValue(it))}` : "물건을 눌러 선택하세요";
  }

  toast(text: string) {
    const t = el("div", "toast", text, this.toasts);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), 1800);
  }

  showResults(state: RaidState, items: Item[], lost: Item[]) {
    const total = Math.round(items.reduce((v, it) => v + itemValue(it), 0));
    this.resultTitle.textContent = state === "extracted" ? "탈출 성공" : state === "dead" ? "사망 — 현장 수첩만 돌아왔습니다" : "일몰 — 현장 수첩만 돌아왔습니다";
    this.resultTitle.dataset.state = state;
    this.resultList.replaceChildren();
    el("div", "sub", state === "extracted" ? "가져온 물건" : "수첩에서 회수한 물건", this.resultList);
    if (!items.length) el("div", "result-row", "가져온 것이 없습니다", this.resultList);
    for (const it of items) {
      const r = el("div", "result-row", "", this.resultList);
      el("i", "chip", "", r).dataset.kind = it.kind;
      el("span", "", ITEMS[it.kind].name, r);
      el("b", "", String(Math.round(itemValue(it))), r);
    }
    el("div", "result-total", `총 가치  ${total}`, this.resultList);
    if (lost.length) el("div", "result-lost", `창고 공간 부족으로 버려짐 ${lost.length}개`, this.resultList);
    this.show("results");
  }

  update(raid: Raid) {
    const hp = Math.max(0, raid.player.hp);
    if (hp !== this.last.hp) { this.pips.forEach((p, i) => p.classList.toggle("off", i >= hp)); this.last.hp = hp; }
    const t = Math.ceil(raid.timeLeft);
    if (t !== this.last.t) {
      this.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      this.timer.classList.toggle("low", raid.timeLeft < 30);
      this.last.t = t;
    }
    const st = `${(raid.backpack.mass + raid.notebook.mass).toFixed(1)}kg · 가치 ${Math.round(raid.carriedValue)} · ${Math.round(raid.temperature)}°C`;
    if (st !== this.last.n) { this.stats.textContent = st; this.last.n = st; }
    const prog = raid.extractProgress;
    this.bar.style.display = prog > 0 ? "block" : "none";
    if (prog > 0) this.barFill.style.width = `${Math.min(100, prog * 100).toFixed(1)}%`;

    // arrow to the extraction zone when it is off-screen
    const e = raid.map.extraction, s = this.renderer.worldToScreen(e.x, e.y);
    const m = 28;
    const off = s.x < 0 || s.x > innerWidth || s.y < 0 || s.y > innerHeight;
    this.arrow.style.display = off && e.r > 0 && this.hud.style.display === "block" ? "block" : "none";
    if (off) {
      const cx = innerWidth / 2, cy = innerHeight / 2, dx = s.x - cx, dy = s.y - cy;
      const k = Math.min((cx - m) / Math.max(1e-6, Math.abs(dx)), (cy - m) / Math.max(1e-6, Math.abs(dy)));
      this.arrow.style.left = `${cx + dx * k}px`; this.arrow.style.top = `${cy + dy * k}px`;
      this.arrow.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }
}

function emptyGrid(): Grid { return new Grid(10, 6); }
