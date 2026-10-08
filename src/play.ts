import type { Grid } from "./game/inventory";
import { ITEMS, itemValue } from "./game/items";
import { FACILITIES, build, research, type Progress } from "./game/knowledge";
import { RAID, Raid, type RaidState } from "./game/raid";
import { FIRST_MAP } from "./game/raidMap";
import { BagPanel } from "./view/bag";
import { Hud } from "./view/hud";
import { Input } from "./view/input";
import { Renderer } from "./view/render";
import { depositAll, loadProgress, loadStash, saveProgress, saveStash, stockOf, takeMaterials } from "./view/stash";

type Screen = "hideout" | "raid" | "results";
const STEP = 1 / 120;

declare global {
  interface Window {
    __game?: {
      readonly raid: Raid; input: Input; startRaid(): void; readonly screen: Screen; readonly shots: number;
      readonly stashGrid: Grid; readonly points: number; readonly progress: Progress; refreshResearch(): void; readonly bagOpen: boolean; openBag(open?: boolean): void;
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
let acc = 0, shots = 0, last = performance.now(), fps = 60;
renderer.snapCamera(raid);
hud.getResearchData = () => ({ progress, stock: stockOf(stash) });
hud.setStash(stash, progress.points);
hud.stashCtl.onChange = () => saveStash(stash);

function startRaid() {
  raid = new Raid(undefined, (Date.now() & 0xffff) || 1, progress.knowledge);
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
  // value is frozen at extraction: stash items are never aged
  const lost = depositAll(stash, res.items);
  saveStash(stash);
  screen = "results";
  hud.showResults(res.state as RaidState, res.items.filter((it) => !lost.includes(it)), lost);
}

hud.startBtn.addEventListener("click", startRaid);
hud.hideoutBtn.addEventListener("click", () => {
  raid = new Raid(FIRST_MAP, 1);
  renderer.snapCamera(raid);
  screen = "hideout";
  hud.setStash(stash, progress.points);
  hud.show("hideout");
});
hud.analyzeBtn.addEventListener("click", () => {
  const it = hud.stashCtl.selectedItem;
  if (!it || !stash.remove(it)) return;
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
addEventListener("resize", () => { renderer.resize(); if (screen === "hideout") hud.setStash(stash, progress.points); });

function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.1;
  const portrait = innerHeight > innerWidth;
  hud.setPortrait(portrait);

  if (screen === "raid" && !portrait) {
    acc += dt;
    while (acc >= STEP && raid.state === "running") { raid.step(STEP, input.state); input.consumeDash(); acc -= STEP; }
    for (const e of raid.events) {
      if (e.kind === "shot") shots++;
      else if (e.kind === "pickup") {
        const s = raid.samples.find((q) => q.taken && q.pos.x === e.x && q.pos.y === e.y);
        hud.toast(s ? `${ITEMS[s.item.kind].name} 획득` : "획득");
      } else if (e.kind === "full") hud.toast("가방이 가득 찼습니다");
    }
    if (raid.state !== "running") finishRaid();
  }
  renderer.draw(raid, dt);
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
  refreshResearch() { hud.setStash(stash, progress.points); },
  get bagOpen() { return bag.open; },
  openBag(open = true) { bag.setOpen(open); },
};
window.__frame = 0;
window.__ready = true;
requestAnimationFrame(frame);
