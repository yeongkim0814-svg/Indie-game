import { Grid } from "../game/inventory";
import { ITEMS, itemSize, itemValue, type GearKind, type Item, type ItemKind } from "../game/items";
import { RAID, type Raid, type RaidState } from "../game/raid";
import { FACILITIES, KNOWLEDGE, buildBlocker, hasFacility, knows, researchBlocker, type FacilityId, type KnowledgeId, type Progress } from "../game/knowledge";
import { BATTERY_CAPACITY, MODS, RECIPES, WEAPONS, craftBlocker, isWeaponKind, modSlots, type Recipe, type WeaponKind } from "../game/weapons";
import { GridView, ItemController, SHORT } from "./gridui";
import { carriedValueText } from "./know";
import type { Renderer } from "./render";

const FIELD_COLOR = { physics: "#5aa0e6", chemistry: "#e6a05a", biology: "#6fcf7a", earth: "#b58ae6" } as const;
const FACILITY_COLOR: Record<FacilityId, string> = { workbench: FIELD_COLOR.physics, lab: FIELD_COLOR.chemistry, observatory: FIELD_COLOR.earth };
const FIELD_NAME = { physics: "물리", chemistry: "화학", biology: "생물", earth: "지구" } as const;

type Tab = "stash" | "research" | "craft";
const PACK_CELL = 28;

/** Law and weakness one-liners for the craft cards: weapons come from WEAPONS, mods and batteries from the constants. */
export function recipeInfo(out: GearKind): { kind: string; law: string; weakness: string } {
  if (isWeaponKind(out)) { const w = WEAPONS[out]; return { kind: "무기", law: w.law, weakness: w.weakness }; }
  if (out === "stock") return {
    kind: "부착물", law: `반동 Δv = J/(M + ${MODS.stockBracing} kg) — 총을 몸에 붙들어 덜 밀린다`,
    weakness: `무기가 1칸 길어지고 ${ITEMS.stock.mass} kg 무겁다. 렌즈에는 달 수 없다`,
  };
  if (out === "scope") return {
    kind: "부착물", law: `자동 조준 거리 +${MODS.scopeRange} m`,
    weakness: `${ITEMS.scope.mass} kg이 더해진다. 멀리 볼 뿐 화력은 그대로다`,
  };
  return {
    kind: "소모품", law: `${BATTERY_CAPACITY} J 저장 → 코일건 ${Math.floor(BATTERY_CAPACITY / WEAPONS.coilgun.energy)}발 (발당 ${WEAPONS.coilgun.energy} J)`,
    weakness: "쓸수록 줄어든다. 원정에 가져가려면 먼저 배낭에 넣어 두어야 한다",
  };
}

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
  private tabCraft!: HTMLButtonElement;
  private stashPane!: HTMLElement;
  private researchPane!: HTMLElement;
  private craftPane!: HTMLElement;
  private subText!: HTMLElement;
  private acts!: HTMLElement;
  private tab: Tab = "stash";
  // loadout: equipped weapon + pre-raid pack
  readonly packView: GridView;
  private equipCard!: HTMLElement;
  private equipped: Item | null = null;
  private modTarget: Item | null = null;
  readonly btn: Record<"attach" | "detachStock" | "detachSight" | "equip" | "unequip" | "pack" | "unpack", HTMLButtonElement>;
  onCraft: (out: GearKind) => void = () => {};
  onAttach: () => void = () => {};
  onDetach: (slot: "stock" | "sight") => void = () => {};
  onEquip: () => void = () => {};
  onUnequip: () => void = () => {};
  onPack: () => void = () => {};
  onUnpack: () => void = () => {};
  /** Is there a free stash spot for a new item of this kind? */
  canStore: (kind: ItemKind) => boolean = () => true;
  private weaponHud!: HTMLElement;
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
  private last = { hp: -1, t: -1, n: "", w: "" };

  constructor(root: HTMLElement, private renderer: Renderer) {
    this.rotate.id = "rotate";
    this.hideout.id = "screen-hideout"; this.results.id = "screen-results";

    const row = el("div", "hide-row", "", this.hideout);
    const left = el("div", "hide-left", "", row), right = el("div", "hide-right", "", row);
    this.stashPane = el("div", "stash-pane", "", left);
    el("div", "bag-lbl", "창고", this.stashPane);
    this.stashView = new GridView(emptyGrid(), 40, this.stashCtl, "grid-stash");
    this.stashPane.append(this.stashView.el);
    const loadout = el("div", "loadout", "", this.stashPane);
    const eq = el("div", "loadout-col", "", loadout);
    el("div", "bag-lbl", "장비", eq);
    this.equipCard = el("div", "equip", "", eq);
    this.equipCard.id = "equip-slot";
    const pk = el("div", "loadout-col", "", loadout);
    el("div", "bag-lbl", "원정 배낭 — 전지는 여기 담아 가져가세요", pk);
    this.packView = new GridView(new Grid(5, 3), PACK_CELL, this.stashCtl, "grid-pack");
    pk.append(this.packView.el);
    this.researchPane = el("div", "research-pane", "", left);
    this.researchPane.id = "research-pane";
    this.craftPane = el("div", "research-pane", "", left);
    this.craftPane.id = "craft-pane";
    el("div", "title", "아지트", right);
    this.subText = el("div", "sub", "해가 지기 전에 표본을 모아 탈출하세요", right);
    const tabs = el("div", "tabs", "", right);
    this.tabStash = el("button", "tab on", "창고", tabs); this.tabStash.id = "tab-stash";
    this.tabResearch = el("button", "tab", "연구", tabs); this.tabResearch.id = "tab-research";
    this.tabCraft = el("button", "tab", "제작", tabs); this.tabCraft.id = "tab-craft";
    this.tabStash.addEventListener("click", () => this.setTab("stash"));
    this.tabResearch.addEventListener("click", () => this.setTab("research"));
    this.tabCraft.addEventListener("click", () => this.setTab("craft"));
    this.pointsText = el("div", "stash", "", right);
    this.pointsText.id = "research-points";
    this.selText = el("div", "sub sel-info", "", right);
    this.acts = el("div", "acts", "", right);
    const act = (id: string, text: string, fn: () => void) => {
      const b = el("button", "btn small", text, this.acts); b.id = id;
      b.addEventListener("click", () => fn());
      return b;
    };
    this.analyzeBtn = act("btn-analyze", "분석", () => {});
    this.btn = {
      attach: act("btn-attach", "부착", () => this.onAttach()),
      detachStock: act("btn-detach-stock", "개머리판 분리", () => this.onDetach("stock")),
      detachSight: act("btn-detach-sight", "조준경 분리", () => this.onDetach("sight")),
      equip: act("btn-equip", "장착", () => this.onEquip()),
      unequip: act("btn-unequip", "장비 해제", () => this.onUnequip()),
      pack: act("btn-pack", "배낭에 담기", () => this.onPack()),
      unpack: act("btn-unpack", "창고로", () => this.onUnpack()),
    };
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
    this.weaponHud = el("div", "weapon-hud", "", this.hud);
    this.weaponHud.id = "weapon-hud";
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
    this.last = { hp: -1, t: -1, n: "", w: "" };
    if (screen !== "hideout") this.stashCtl.clear();
    if (screen !== "raid") this.toasts.replaceChildren();
  }

  /** Bind the hideout screen to the persisted stash. */
  setStash(grid: Grid, points: number) {
    const cell = Math.max(26, Math.min(44, Math.floor(Math.min((innerWidth - 330) / grid.w, (innerHeight - 200) / grid.h))));
    this.stashView.setCell(cell);
    this.stashView.setGrid(grid);
    this.stashCtl.clear();
    this.setPoints(points);
    this.refreshResearch();
  }

  setPoints(n: number) { this.pointsText.textContent = `연구 점수  ${n}`; }

  setTab(t: Tab) {
    this.tab = t;
    const st = t === "stash";
    this.stashPane.style.display = st ? "flex" : "none";
    this.researchPane.style.display = t === "research" ? "flex" : "none";
    this.craftPane.style.display = t === "craft" ? "flex" : "none";
    this.tabStash.classList.toggle("on", st); this.tabResearch.classList.toggle("on", t === "research"); this.tabCraft.classList.toggle("on", t === "craft");
    this.acts.style.display = st ? "" : "none";
    this.selText.style.display = st ? "" : "none";
    this.subText.style.display = "none";
    if (!st) this.stashCtl.clear();
    this.refreshResearch();
  }

  /** Bind the equipped-weapon slot and the pre-raid pack to the hideout. */
  setLoadout(weapon: Item | null, pack: Grid) {
    this.equipped = weapon;
    this.packView.setCell(PACK_CELL);
    this.packView.setGrid(pack);
    this.renderEquip();
    this.refreshSelection();
  }

  private renderEquip() {
    const w = this.equipped, c = this.equipCard;
    c.replaceChildren();
    c.dataset.kind = w?.kind ?? "rifle";
    el("div", "equip-name", w ? ITEMS[w.kind].name : WEAPONS.rifle.name, c);
    if (!w) { el("div", "equip-sub", "기본 보급품 (기본 장착)", c); return; }
    const st = WEAPONS[w.kind as WeaponKind];
    const mods = el("div", "mods", "", c);
    if (w.mods?.stock) el("i", "badge stock", "개머리판", mods);
    if (w.mods?.sight) el("i", "badge sight", "조준경", mods);
    const size = itemSize(w);
    el("div", "equip-sub", `${size.w}×${size.h}칸 · 사거리 ${st.range + (w.mods?.sight ? MODS.scopeRange : 0)} m`, c);
  }

  /** Rebuild the research cards from current progress + stash (keeps scroll position). */
  refreshResearch() {
    const { progress: p, stock } = this.getResearchData();
    this.setPoints(p.points);
    if (this.tab === "craft") return this.refreshCraft(p, stock);
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

  /** Craft view: recipes grouped by facility, each a card with law, weakness, cost and a craft button. */
  private refreshCraft(p: Progress, stock: Partial<Record<ItemKind, number>>) {
    const keep = this.craftPane.scrollTop;
    this.craftPane.replaceChildren();
    for (const fid of Object.keys(FACILITIES) as FacilityId[]) {
      const recipes = RECIPES.filter((r) => r.facility === fid);
      if (!recipes.length) continue;
      const f = FACILITIES[fid], built = hasFacility(p, fid);
      const sec = el("div", "fac" + (built ? " built" : ""), "", this.craftPane);
      sec.dataset.facility = fid;
      const head = el("div", "fac-head", "", sec);
      el("div", "fac-name", f.name, head);
      el("div", "fac-state", built ? "사용 가능" : "시설 필요", head);
      const nodes = el("div", "fac-nodes", "", sec);
      for (const r of recipes) this.craftCard(nodes, p, stock, r, FACILITY_COLOR[fid]);
    }
    this.craftPane.scrollTop = keep;
  }

  private craftCard(parent: HTMLElement, p: Progress, stock: Partial<Record<ItemKind, number>>, r: Recipe, color: string) {
    const info = recipeInfo(r.out);
    const c = el("div", "node craft", "", parent);
    c.dataset.recipe = r.out; c.style.setProperty("--fc", color);
    const top = el("div", "node-top", "", c);
    el("span", "node-field", info.kind, top);
    el("b", "node-name", ITEMS[r.out].name, top);
    el("div", "node-law", info.law, c);
    el("div", "node-limit", `약점: ${info.weakness}`, c);
    const cost = el("div", "node-cost", "", c);
    el("span", p.points < r.points ? "lack" : "", `점수 ${r.points}`, cost);
    for (const [k, n] of Object.entries(r.materials) as [ItemKind, number][]) {
      el("span", (stock[k] ?? 0) < n ? "lack" : "", ` · ${SHORT[k]} ${stock[k] ?? 0}/${n}`, cost);
    }
    const why = craftBlocker(p, r, stock) ?? (this.canStore(r.out) ? null : "창고 공간 부족");
    const b = el("button", "btn small act", why ?? "제작", c);
    b.id = `btn-craft-${r.out}`; b.disabled = !!why;
    b.addEventListener("click", () => this.onCraft(r.out));
  }

  /** Per-frame while on the hideout screen. */
  updateStash() { this.stashCtl.validate(); this.stashView.sync(); if (this.tab === "stash") this.packView.sync(); }

  /** Enable/disable the stash action buttons and describe the selection. Call after any change to the stash, pack or slot. */
  refreshSelection() {
    const sel = this.stashCtl.selected, it = sel?.item ?? null;
    const inStash = !!sel && sel.view === this.stashView, inPack = !!sel && sel.view === this.packView;
    const gear = !!it && !!ITEMS[it.kind].gear, weapon = !!it && isWeaponKind(it.kind);
    if (it && weapon && inStash) this.modTarget = it;
    if (this.modTarget && !this.stashView.grid.placed.some((q) => q.item === this.modTarget)) this.modTarget = null;
    const modSlot = it && inStash ? (it.kind === "stock" ? "stock" : it.kind === "scope" ? "sight" : null) : null;
    const tgt = this.modTarget;
    let attachWhy: string | null = "무기와 부착물을 차례로 고르세요";
    if (modSlot && !tgt) attachWhy = "먼저 무기를 고르세요";
    else if (modSlot && tgt) {
      attachWhy = !modSlots(tgt.kind).includes(modSlot) ? `${ITEMS[tgt.kind].name}에는 달 수 없음` : tgt.mods?.[modSlot] ? "이미 달려 있음" : null;
    }
    this.analyzeBtn.disabled = !it || gear || !inStash;
    this.btn.attach.disabled = !!attachWhy;
    this.btn.detachStock.disabled = !(it && weapon && inStash && it.mods?.stock);
    this.btn.detachSight.disabled = !(it && weapon && inStash && it.mods?.sight);
    this.btn.equip.disabled = !(it && weapon && inStash);
    this.btn.unequip.disabled = !this.equipped;
    this.btn.pack.disabled = !(it && inStash);
    this.btn.unpack.disabled = !(it && inPack);
    let text = "물건을 눌러 선택하세요";
    if (it) {
      const name = ITEMS[it.kind].name;
      if (modSlot && tgt && !attachWhy) text = `${name} → ${ITEMS[tgt.kind].name}에 부착`;
      else if (modSlot) text = `${name} — ${attachWhy}`;
      else if (gear) text = `${name} — 장비는 분석할 수 없습니다`;
      else text = `${name} — 분석하면 연구 점수 +${Math.round(itemValue(it))}`;
    }
    this.selText.textContent = text;
  }

  /** A short label that floats up from a screen point and fades (e.g. "추락"). */
  floatLabel(text: string, x: number, y: number) {
    const t = el("div", "float-label", text, document.body);
    t.style.left = `${x}px`; t.style.top = `${y}px`;
    setTimeout(() => t.remove(), 1000);
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
      el("b", "", ITEMS[it.kind].gear ? "장비" : String(Math.round(itemValue(it))), r);
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
    const wk = raid.weaponKind;
    const wt = wk === "coilgun" ? `${raid.weaponStats.name} · 전지 ${Math.floor(raid.batteryCharge / WEAPONS.coilgun.energy)}발`
      : wk === "lens" ? `${raid.weaponStats.name} · 햇빛 ${Math.round(raid.sunlight * 100)}%` : raid.weaponStats.name;
    if (wt !== this.last.w) { this.last.w = wt; this.weaponHud.textContent = wt; this.weaponHud.dataset.kind = wk; }
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
