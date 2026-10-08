import { Grid } from "../game/inventory";
import { ITEMS, itemValue, type Item, type ItemKind } from "../game/items";
import { RAID, type Raid, type RaidState } from "../game/raid";
import { FACILITIES, KNOWLEDGE, buildBlocker, hasFacility, knows, researchBlocker, type FacilityId, type KnowledgeId, type Progress } from "../game/knowledge";
import { GridView, ItemController, SHORT } from "./gridui";
import { carriedValueText } from "./know";
import type { Renderer } from "./render";

const FIELD_COLOR = { physics: "#5aa0e6", chemistry: "#e6a05a", biology: "#6fcf7a", earth: "#b58ae6" } as const;
const FIELD_NAME = { physics: "물리", chemistry: "화학", biology: "생물", earth: "지구" } as const;

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
  // hideout tabs + research view
  private tabStash!: HTMLButtonElement;
  private tabResearch!: HTMLButtonElement;
  private stashPane!: HTMLElement;
  private researchPane!: HTMLElement;
  private subText!: HTMLElement;
  private tab: "stash" | "research" = "stash";
  onBuild: (id: FacilityId) => void = () => {};
  onResearch: (id: KnowledgeId) => void = () => {};
  /** Supplies current progress + stash counts when the research view renders. */
  getResearchData: () => { progress: Progress; stock: Partial<Record<ItemKind, number>> } = () => ({ progress: { points: 0, facilities: [], knowledge: [] }, stock: {} });
  // in-raid knowledge UI
  private dial!: HTMLElement;
  private sun!: SVGCircleElement;
  private activity!: HTMLElement;
  private oreArrows: HTMLElement[] = [];
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
    this.stashPane = el("div", "stash-pane", "", left);
    el("div", "bag-lbl", "창고", this.stashPane);
    this.stashView = new GridView(emptyGrid(), 40, this.stashCtl, "grid-stash");
    this.stashPane.append(this.stashView.el);
    this.researchPane = el("div", "research-pane", "", left);
    this.researchPane.id = "research-pane";
    el("div", "title", "아지트", right);
    this.subText = el("div", "sub", "해가 지기 전에 표본을 모아 탈출하세요", right);
    const tabs = el("div", "tabs", "", right);
    this.tabStash = el("button", "tab on", "창고", tabs); this.tabStash.id = "tab-stash";
    this.tabResearch = el("button", "tab", "연구", tabs); this.tabResearch.id = "tab-research";
    this.tabStash.addEventListener("click", () => this.setTab("stash"));
    this.tabResearch.addEventListener("click", () => this.setTab("research"));
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
    this.timer.id = "raid-timer";
    this.dial = el("div", "sun-dial", "", this.hud);
    this.dial.id = "sun-dial";
    this.dial.innerHTML = `<svg viewBox="0 0 60 34" width="60" height="34"><path d="M6 28 A24 24 0 0 1 54 28" fill="rgba(55,124,199,.35)" stroke="#a3cfe3" stroke-width="1.5" stroke-dasharray="2 2"/><line x1="2" y1="28" x2="58" y2="28" stroke="#e8edec" stroke-width="2"/><circle id="sun-dot" r="4.5" fill="#ffd36b" stroke="#fff4c0" stroke-width="1"/></svg>`;
    this.sun = this.dial.querySelector("#sun-dot") as unknown as SVGCircleElement;
    this.activity = el("div", "activity", "", this.hud);
    this.activity.id = "crawler-activity";
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
    if (screen !== "raid") { this.arrow.style.display = "none"; for (const a of this.oreArrows) a.style.display = "none"; }
    if (screen === "hideout") this.setTab(this.tab);
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
    this.refreshResearch();
  }

  setPoints(n: number) { this.pointsText.textContent = `연구 점수  ${n}`; }

  setTab(t: "stash" | "research") {
    this.tab = t;
    const r = t === "research";
    this.stashPane.style.display = r ? "none" : "flex";
    this.researchPane.style.display = r ? "flex" : "none";
    this.tabStash.classList.toggle("on", !r); this.tabResearch.classList.toggle("on", r);
    this.analyzeBtn.style.display = r ? "none" : "";
    this.selText.style.display = r ? "none" : "";
    this.subText.style.display = r ? "none" : "";
    if (r) this.stashCtl.clear();
    this.refreshResearch();
  }

  /** Rebuild the research cards from current progress + stash (keeps scroll position). */
  refreshResearch() {
    const { progress: p, stock } = this.getResearchData();
    this.setPoints(p.points);
    if (this.tab !== "research") return;
    const keep = this.researchPane.scrollTop;
    this.researchPane.replaceChildren();
    for (const fid of Object.keys(FACILITIES) as FacilityId[]) {
      const f = FACILITIES[fid], built = hasFacility(p, fid);
      const sec = el("div", "fac" + (built ? " built" : ""), "", this.researchPane);
      sec.dataset.facility = fid;
      const head = el("div", "fac-head", "", sec);
      el("div", "fac-name", f.name, head);
      el("div", "fac-blurb", f.blurb, head);
      if (f.builtIn) el("div", "fac-state", "기본 시설", head);
      else if (built) el("div", "fac-state", "건설됨", head);
      else {
        const mats = (Object.entries(f.materials) as [ItemKind, number][]).map(([k, n]) => `${SHORT[k]} ${stock[k] ?? 0}/${n}`);
        el("div", "fac-cost", `점수 ${f.points}${mats.length ? " · " + mats.join(" · ") : ""}`, head);
        const why = buildBlocker(p, fid, stock);
        const b = el("button", "btn small act", why ?? "건설", head);
        b.id = `btn-build-${fid}`; b.disabled = !!why;
        b.addEventListener("click", () => this.onBuild(fid));
      }
      const nodes = el("div", "fac-nodes", "", sec);
      for (const k of Object.values(KNOWLEDGE).filter((q) => q.facility === fid)) {
        const learned = knows(p, k.id), col = FIELD_COLOR[k.field];
        const c = el("div", "node" + (learned ? " learned" : ""), "", nodes);
        c.dataset.knowledge = k.id; c.style.setProperty("--fc", col);
        const top = el("div", "node-top", "", c);
        el("span", "node-field", FIELD_NAME[k.field], top);
        el("b", "node-name", k.name, top);
        if (learned) el("span", "node-ok", "습득", top);
        el("div", "node-effect", k.effect, c);
        el("div", "node-law", k.law, c);
        el("div", "node-limit", `법칙이 깨지는 곳: ${k.limit}`, c);
        const why = researchBlocker(p, k.id);
        const b = el("button", "btn small act", learned ? "습득함" : why ?? `연구 (점수 ${k.points})`, c);
        b.id = `btn-research-${k.id}`; b.disabled = !!why;
        b.addEventListener("click", () => this.onResearch(k.id));
      }
    }
    this.researchPane.scrollTop = keep;
  }

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
    const exact = raid.knowledge.has("celestial");
    this.timer.style.display = exact ? "block" : "none";
    this.dial.style.display = exact ? "none" : "block";
    if (!exact) {
      // sun slides from the top of the arc (noon) down to the right horizon (sunset); no numbers
      const a = (Math.PI / 2) * (1 - Math.min(1, raid.time / RAID.duration));
      this.sun.setAttribute("cx", (30 + Math.cos(a) * 24).toFixed(1));
      this.sun.setAttribute("cy", (28 - Math.sin(a) * 24).toFixed(1));
    }
    const t = Math.ceil(raid.timeLeft);
    if (exact && t !== this.last.t) {
      this.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      this.timer.classList.toggle("low", raid.timeLeft < 30);
      this.last.t = t;
    }
    const st = `${(raid.backpack.mass + raid.notebook.mass).toFixed(1)}kg · 가치 ${carriedValueText(raid.knowledge, raid.carriedItems)} · ${Math.round(raid.temperature)}°C`;
    if (st !== this.last.n) { this.stats.textContent = st; this.last.n = st; }
    const prog = raid.extractProgress;
    this.bar.style.display = prog > 0 ? "block" : "none";
    if (prog > 0) this.barFill.style.width = `${Math.min(100, prog * 100).toFixed(1)}%`;

    // physiology: Q10 metabolism readout
    const phys = raid.knowledge.has("physiology");
    this.activity.style.display = phys ? "block" : "none";
    if (phys) this.activity.textContent = `생물 활동성 ${Math.round(raid.crawlerActivity * 100)}%`;

    // arrow to the extraction zone when it is off-screen
    const e = raid.map.extraction;
    const off = this.edgeArrow(this.arrow, e.x, e.y);
    this.arrow.style.display = off && e.r > 0 && this.hud.style.display === "block" ? "block" : "none";

    // radiochem: yellow-green arrows toward untaken ore within 20 m (only when the ore is off-screen)
    const ores = raid.knowledge.has("radiochem")
      ? raid.samples.filter((q) => !q.taken && q.item.kind === "ore")
          .map((q) => ({ q, d: Math.hypot(q.pos.x - raid.player.pos.x, q.pos.y - raid.player.pos.y) }))
          .filter((o) => o.d <= 20).sort((a, b) => a.d - b.d).slice(0, 4)
      : [];
    while (this.oreArrows.length < ores.length) {
      const a = el("div", "arrow ore-arrow", "▶", this.hud);
      this.oreArrows.push(a);
    }
    this.oreArrows.forEach((a, i) => {
      const o = ores[i];
      a.style.display = o && this.edgeArrow(a, o.q.pos.x, o.q.pos.y) ? "block" : "none";
    });
  }

  /** Place an arrow on the screen edge pointing at a world point. Returns true when the point is off-screen. */
  private edgeArrow(a: HTMLElement, wx: number, wy: number): boolean {
    const s = this.renderer.worldToScreen(wx, wy), m = 28;
    const off = s.x < 0 || s.x > innerWidth || s.y < 0 || s.y > innerHeight;
    if (off) {
      const cx = innerWidth / 2, cy = innerHeight / 2, dx = s.x - cx, dy = s.y - cy;
      const k = Math.min((cx - m) / Math.max(1e-6, Math.abs(dx)), (cy - m) / Math.max(1e-6, Math.abs(dy)));
      a.style.left = `${cx + dx * k}px`; a.style.top = `${cy + dy * k}px`;
      a.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(dy, dx)}rad)`;
    }
    return off;
  }
}

function emptyGrid(): Grid { return new Grid(10, 6); }
