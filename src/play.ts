import { Raid, type RaidState } from "./game/raid";
import { FIRST_MAP } from "./game/raidMap";
import { Hud } from "./view/hud";
import { Input } from "./view/input";
import { Renderer } from "./view/render";
import { addStash, readStash } from "./view/stash";

type Screen = "hideout" | "raid" | "results";
const STEP = 1 / 120;

declare global {
  interface Window {
    __game?: { readonly raid: Raid; input: Input; startRaid(): void; readonly screen: Screen; readonly shots: number; readonly stash: number };
    __ready?: boolean; __frame?: number; __fps?: number;
  }
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const renderer = new Renderer(canvas);
const hud = new Hud(ui, renderer);
const input = new Input(ui);

let screen: Screen = "hideout";
let raid = new Raid(FIRST_MAP, 1); // hideout shows a frozen preview of the map
let acc = 0, shots = 0, last = performance.now(), fps = 60;
renderer.snapCamera(raid);
hud.setStash(readStash());

function startRaid() {
  raid = new Raid(FIRST_MAP, (Date.now() & 0xffff) || 1);
  renderer.snapCamera(raid);
  acc = 0; shots = 0;
  screen = "raid";
  input.setEnabled(true);
  hud.show("raid");
}

function finishRaid() {
  input.setEnabled(false);
  const state: RaidState = raid.state;
  const got = raid.result().samples;
  const total = got > 0 ? addStash(got) : readStash();
  screen = "results";
  hud.showResults(state, got, total);
}

hud.startBtn.addEventListener("click", startRaid);
hud.hideoutBtn.addEventListener("click", () => {
  raid = new Raid(FIRST_MAP, 1);
  renderer.snapCamera(raid);
  screen = "hideout";
  hud.setStash(readStash());
  hud.show("hideout");
});
addEventListener("resize", () => renderer.resize());

function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.1;
  const portrait = innerHeight > innerWidth;
  hud.setPortrait(portrait);

  if (screen === "raid" && !portrait) {
    acc += dt;
    while (acc >= STEP && raid.state === "running") { raid.step(STEP, input.state); acc -= STEP; }
    for (const e of raid.events) if (e.kind === "shot") shots++;
    if (raid.state !== "running") finishRaid();
  }
  renderer.draw(raid, dt);
  if (screen === "raid") hud.update(raid);

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
  get stash() { return readStash(); },
};
window.__frame = 0;
window.__ready = true;
requestAnimationFrame(frame);
