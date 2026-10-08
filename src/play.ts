import { Grid } from "./game/inventory";
import { ITEMS, itemValue, makeItem, type GearKind, type Item } from "./game/items";
import { FACILITIES, build, research, type Progress } from "./game/knowledge";
import { RECIPES, attachMod, craft, craftBlocker, detachMod, modSlots } from "./game/weapons";
import { RAID, Raid, type RaidState } from "./game/raid";
import { FIRST_MAP } from "./game/raidMap";
import { BagPanel } from "./view/bag";
import { Hud } from "./view/hud";
import { Input } from "./view/input";
import { Renderer } from "./view/render";
import { controls } from "./view/iso/controls";
import { PACK_SIZE, depositAll, loadPack, loadProgress, loadStash, loadWeapon, saveWeapon, savePack, saveProgress, saveStash, stockOf, takeMaterials } from "./view/stash";

type Screen = "hideout" | "raid" | "results";
const STEP = 1 / 120;

declare global {
  interface Window {
    __game?: {
      readonly raid: Raid; input: Input; startRaid(): void; readonly screen: Screen; readonly shots: number;
      readonly stashGrid: Grid; readonly points: number; readonly progress: Progress; refreshResearch(): void; readonly bagOpen: boolean; openBag(open?: boolean): void;
      readonly equipped: Item | null; readonly packGrid: Grid; craft(out: GearKind): string | null; saveAll(): void;
      /** ledge pull-back ease 0..1, render zoom (1..~1.67) and the knowledge reveals shown so far in this raid */
      readonly lookout: number; readonly zoom: number; readonly revealed: string[];
      /** camera state (degrees), zone, see-through rock count, render timing; `paused` freezes sim + camera time for screenshots */
      readonly cam: { yaw: number; pitch: number; mode: string; u: number; background: number };
      readonly zone: "path" | "arena"; readonly seeThrough: number;
      readonly perf: { drawMs: number; sceneMs: number; terrainBuilds: number; terrainBuildMs: number; usedCache: boolean };
      /** camera clamp / band / label checks: view rect and map bounds (projection px), ground rows drawn, label rects vs the player's sprite (native px) */
      readonly view: { x0: number; y0: number; x1: number; y1: number; minX: number; minY: number; maxX: number; maxY: number; rows: { min: number; max: number } | null; lane: number | null };
      readonly labels: { rects: { x0: number; y0: number; x1: number; y1: number }[]; player: { x0: number; y0: number; x1: number; y1: number } };
      /** spawn a falling crawler at a world point (screenshots / tests) */
      spawnFaller(x: number, y: number, vx: number, vy: number): void;
      readonly fallerPixels: { hidden: number; shown: number };
      readonly vistaClamps: number;
      paused: boolean;
      /** snap the camera to the player's zone (after a teleport) */
      snapCamera(): void;
    };
    __ready?: boolean; __frame?: number; __fps?: number;
  }
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const renderer = new Renderer(canvas);
const hud = new Hud(ui, renderer);
const input = new Input(ui);
const bag = new BagPanel(ui, input);

let screen: Screen = "hideout";
let raid = new Raid(FIRST_MAP, 1); // hideout shows a frozen preview of the map
let stash = loadStash();
let progress = loadProgress();
let equipped: Item | null = loadWeapon(); // the weapon in the loadout slot
let pack = loadPack(); // items to carry into the next raid
let lastEmptyToast = -1e9;
let acc = 0, shots = 0, last = performance.now(), fps = 60, paused = false;
renderer.snapCamera(raid);
renderer.onReveal = (_id, text) => hud.toast(text);
hud.getResearchData = () => ({ progress, stock: stockOf(stash) });
hud.canStore = (kind) => !!stash.findSpot(makeItem(kind));
hud.setStash(stash, progress.points);
hud.setLoadout(equipped, pack);
const saveAll = () => { saveStash(stash); savePack(pack); saveWeapon(equipped); saveProgress(progress); };
hud.stashCtl.onChange = () => { saveStash(stash); savePack(pack); hud.refreshSelection(); };

function startRaid() {
  // the equipped weapon and the pack travel with the player; they only come back on extraction
  const weapon = equipped ?? undefined;
  raid = new Raid(undefined, (Date.now() & 0xffff) || 1, progress.knowledge, { weapon, pack: pack.items });
  equipped = null;
  // anything that did not fit the raid backpack goes back to the stash instead of vanishing
  for (const it of pack.items) if (!raid.backpack.items.includes(it)) stash.autoPlace(it);
  pack = new Grid(PACK_SIZE.w, PACK_SIZE.h);
  saveAll();
  input.setDashAvailable(raid.canDash);
  input.setDashCooldown(0);
  renderer.snapCamera(raid);
  acc = 0; shots = 0;
  screen = "raid";
  input.setEnabled(true);
  bag.setRaid(raid);
  bag.setVisible(true);
  hud.show("raid");
}

function finishRaid() {
  input.setEnabled(false);
  bag.setVisible(false);
  const res = raid.result();
  // the equipped weapon returns to its slot (extraction only); everything else goes to the stash
  const weapon = raid.weapon && res.items.includes(raid.weapon) ? raid.weapon : null;
  if (weapon) equipped = weapon;
  const rest = res.items.filter((it) => it !== weapon);
  // value is frozen at extraction: stash items are never aged
  const lost = depositAll(stash, rest);
  saveAll();
  screen = "results";
  hud.showResults(res.state as RaidState, res.items.filter((it) => !lost.includes(it)), lost);
}

hud.startBtn.addEventListener("click", startRaid);
hud.hideoutBtn.addEventListener("click", () => {
  raid = new Raid(FIRST_MAP, 1);
  renderer.snapCamera(raid);
  screen = "hideout";
  hud.setStash(stash, progress.points);
  hud.setLoadout(equipped, pack);
  hud.show("hideout");
});
hud.analyzeBtn.addEventListener("click", () => {
  const it = hud.stashCtl.selectedItem;
  if (!it || ITEMS[it.kind].gear || !stash.remove(it)) return;
  progress.points += Math.round(itemValue(it));
  saveProgress(progress);
  saveStash(stash);
  hud.stashCtl.clear();
  hud.setPoints(progress.points);
});
hud.onBuild = (id) => {
  if (!build(progress, id, stockOf(stash))) return;
  for (const [k, n] of Object.entries(FACILITIES[id].materials) as [keyof typeof ITEMS, number][]) takeMaterials(stash, k, n, itemValue);
  saveProgress(progress); saveStash(stash);
  hud.setStash(stash, progress.points);
};
hud.onResearch = (id) => {
  if (!research(progress, id)) return;
  saveProgress(progress);
  hud.refreshResearch();
};

// ---- crafting ------------------------------------------------------------------------------------
/** Craft one item. Returns null on success, otherwise the reason it was refused (nothing is spent on a refusal). */
function craftItem(out: GearKind): string | null {
  const r = RECIPES.find((q) => q.out === out);
  if (!r) return "알 수 없는 설계";
  const stock = stockOf(stash);
  const why = craftBlocker(progress, r, stock);
  if (why) return why;
  if (!hud.canStore(out)) return "창고 공간 부족"; // checked BEFORE spending anything
  const item = craft(progress, r, stock);
  if (!item) return "제작 실패";
  for (const [k, n] of Object.entries(r.materials) as [keyof typeof ITEMS, number][]) takeMaterials(stash, k, n, itemValue);
  stash.autoPlace(item);
  saveAll();
  return null;
}
hud.onCraft = (out) => {
  const why = craftItem(out);
  hud.toast(why ?? `${ITEMS[out].name} 제작`);
  hud.setPoints(progress.points);
  hud.refreshResearch();
};

// ---- mods ----------------------------------------------------------------------------------------
function findIn(g: Grid, it: Item) { return g.placed.find((q) => q.item === it); }

hud.onAttach = () => {
  const mod = hud.stashCtl.selectedItem;
  const wpn = hud.modTargetItem;
  if (!mod || !wpn || hud.stashCtl.selected?.view !== hud.stashView) return;
  const slot = mod.kind === "stock" ? "stock" : "sight";
  const wp = findIn(stash, wpn), mp = findIn(stash, mod);
  if (!wp || !mp || !modSlots(wpn.kind).includes(slot)) return;
  const wOld = { ...wp }, mOld = { ...mp };
  stash.remove(mod); stash.remove(wpn);
  if (!attachMod(wpn, mod)) { stash.placed.push(wOld, mOld); return; }
  // a stock lengthens the weapon: try its old spot, else anywhere
  let ok = stash.place(wpn, wOld.x, wOld.y, wOld.rot);
  if (!ok) ok = stash.autoPlace(wpn);
  if (!ok) {
    detachMod(wpn, slot);
    stash.place(wpn, wOld.x, wOld.y, wOld.rot); stash.place(mod, mOld.x, mOld.y, mOld.rot);
    hud.toast("창고에 길어진 무기가 들어갈 자리가 없습니다");
  } else hud.toast(`${ITEMS[mod.kind].name} 부착`);
  saveStash(stash);
  hud.stashCtl.clear();
  hud.refreshSelection();
};
hud.onDetach = (slot) => {
  const wpn = hud.stashCtl.selectedItem;
  if (!wpn || !wpn.mods?.[slot] || !findIn(stash, wpn)) return;
  const mod = detachMod(wpn, slot)!;
  if (!stash.autoPlace(mod)) { attachMod(wpn, mod); hud.toast("창고 공간 부족"); return; }
  hud.toast(`${ITEMS[mod.kind].name} 분리`);
  saveStash(stash);
  hud.refreshSelection();
};

// ---- loadout -------------------------------------------------------------------------------------
hud.onEquip = () => {
  const wpn = hud.stashCtl.selectedItem;
  const pl = wpn && findIn(stash, wpn);
  if (!wpn || !pl || !modSlots(wpn.kind).length) return;
  stash.remove(wpn);
  if (equipped && !stash.autoPlace(equipped)) { stash.placed.push(pl); hud.toast("창고 공간 부족"); return; }
  equipped = wpn;
  saveAll();
  hud.setLoadout(equipped, pack);
  hud.stashCtl.clear();
};
hud.onUnequip = () => {
  if (!equipped) return;
  if (!stash.autoPlace(equipped)) { hud.toast("창고 공간 부족"); return; }
  equipped = null;
  saveAll();
  hud.setLoadout(equipped, pack);
};
hud.onPack = () => {
  const it = hud.stashCtl.selectedItem;
  if (!it || !findIn(stash, it)) return;
  const pl = findIn(stash, it)!;
  stash.remove(it);
  if (!pack.autoPlace(it)) { stash.placed.push(pl); hud.toast("배낭 공간 부족"); return; }
  saveAll();
  hud.stashCtl.clear();
};
hud.onUnpack = () => {
  const it = hud.stashCtl.selectedItem;
  if (!it || !findIn(pack, it)) return;
  const pl = findIn(pack, it)!;
  pack.remove(it);
  if (!stash.autoPlace(it)) { pack.placed.push(pl); hud.toast("창고 공간 부족"); return; }
  saveAll();
  hud.stashCtl.clear();
};
addEventListener("resize", () => { renderer.resize(); if (screen === "hideout") hud.setStash(stash, progress.points); });

function frame(now: number) {
  const rawDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  const dt = paused ? 0 : rawDt;
  last = now;
  if (rawDt > 0) fps += (1 / rawDt - fps) * 0.1;
  const portrait = innerHeight > innerWidth;
  hud.setPortrait(portrait);

  if (screen === "raid" && !portrait) {
    acc += dt;
    while (acc >= STEP && raid.state === "running") { raid.step(STEP, controls(raid, input.state, renderer.yaw)); input.consumeDash(); acc -= STEP; }
    for (const e of raid.events) {
      if (e.kind === "shot") shots++;
      else if (e.kind === "pickup") {
        const s = raid.samples.find((q) => q.taken && q.pos.x === e.x && q.pos.y === e.y);
        hud.toast(s ? `${ITEMS[s.item.kind].name} 획득` : "획득");
      } else if (e.kind === "full") hud.toast("가방이 가득 찼습니다");
      else if (e.kind === "empty") {
        if (now - lastEmptyToast > 1500) { lastEmptyToast = now; hud.toast("전지가 비었습니다"); }
      } else if (e.kind === "fall") {
        const s = renderer.worldToScreen(e.x, e.y, 0.8);
        hud.floatLabel("추락", s.x, s.y);
      }
    }
    if (raid.state !== "running") finishRaid();
    // ledge paths are movement-only: no fire button there (nor while the bag is open)
    const lock = bag.open || raid.onPath;
    if (input.isFireLocked !== lock) input.setFireLocked(lock);
  }
  const mv = input.state.move;
  const busy = input.state.fire || Math.hypot(mv.x, mv.y) > 0.05 || bag.open;
  renderer.draw(raid, dt, busy, screen === "raid" && !portrait);
  hud.setDim(screen === "raid" ? renderer.lookout : 0);
  if (screen === "raid") { hud.update(raid); bag.update(); input.setDashCooldown(raid.player.dashCooldown / RAID.dash.cooldown); }
  else if (screen === "hideout") hud.updateStash();

  window.__frame = (window.__frame ?? 0) + 1;
  window.__fps = Math.round(fps);
  requestAnimationFrame(frame);
}

window.__game = {
  get raid() { return raid; },
  input,
  startRaid,
  get screen() { return screen; },
  get shots() { return shots; },
  get stashGrid() { return stash; },
  get points() { return progress.points; },
  get progress() { return progress; },
  refreshResearch() { hud.setStash(stash, progress.points); hud.setLoadout(equipped, pack); },
  get bagOpen() { return bag.open; },
  openBag(open = true) { bag.setOpen(open); },
  get equipped() { return equipped; },
  get packGrid() { return pack; },
  craft(out: GearKind) { const why = craftItem(out); hud.setPoints(progress.points); hud.refreshResearch(); return why; },
  saveAll,
  get lookout() { return renderer.lookout; },
  get zoom() { return renderer.zoom; },
  get revealed() { return [...renderer.revealed]; },
  get cam() {
    const r = renderer.rig;
    return { yaw: (r.yaw * 180) / Math.PI, pitch: (r.pitch * 180) / Math.PI, mode: r.mode as string, u: r.u, background: r.background };
  },
  get zone() { return raid.zoneAt(raid.player.pos.x, raid.player.pos.y); },
  get seeThrough() { return renderer.scene.seeThrough; },
  get perf() {
    const s = renderer.scene;
    return { drawMs: renderer.drawMs, sceneMs: s.lastMs, terrainBuilds: s.terrainBuilds, terrainBuildMs: s.terrainBuildMs, usedCache: s.usedCache };
  },
  get view() { const s = renderer.scene; return { ...s.viewRect, rows: s.terrainRows, lane: s.bandLane }; },
  get labels() { return { rects: renderer.labelRects, player: renderer.playerRect }; },
  get fallerPixels() { return { hidden: renderer.scene.fallerHidden, shown: renderer.scene.fallerShown }; },
  get vistaClamps() { return renderer.vista.edgeClamps; },
  spawnFaller(x, y, vx, vy) { renderer.fx.fallers.push({ x, y, vx, vy, t: 0, seed: 1 }); },
  get paused() { return paused; },
  set paused(v: boolean) { paused = v; },
  snapCamera() { renderer.snapCamera(raid); },
};
window.__frame = 0;
window.__ready = true;
requestAnimationFrame(frame);
