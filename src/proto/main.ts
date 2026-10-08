/** Two-camera prototype, opened with `?proto`. Reuses Raid (src/game) and Input/Vista (src/view); the main game is untouched. */
import { Raid, type RaidInput } from "../game/raid";
import { Input } from "../view/input";
import { loadVistaArt } from "../view/art";
import { Vista, VISTA_H } from "../view/vista";
import { CameraRig, type CamMode } from "./camera";
import { Scene } from "./scene";
import { PROTO_MAP, LANE_Y, zoneAt, type Zone } from "./world";
import { project } from "./project";
import { hexN } from "./raster";
import { ROCK } from "../view/palette";

declare global {
  interface Window {
    __proto?: {
      readonly raid: Raid;
      readonly cam: { yaw: number; pitch: number; mode: CamMode; u: number; background: number };
      readonly zone: Zone;
      readonly seeThrough: number;
      /** freeze simulation + camera time (rendering continues), for screenshots */
      paused: boolean;
      snap(): void;
    };
  }
}

const STEP = 1 / 120;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const g = canvas.getContext("2d", { alpha: false })!;
const input = new Input(ui);
const scene = new Scene();
const rig = new CameraRig();
const vista = new Vista();
const vistaCv = document.createElement("canvas");
void loadVistaArt().then((a) => { vista.art = a; });

let raid = new Raid(PROTO_MAP, 7);
let zone: Zone = zoneAt(raid.player.pos.x, raid.player.pos.y);
rig.focus = { ...raid.player.pos };
rig.mode = zone === "path" ? "I" : "II";
rig.u = zone === "path" ? 0 : 1;
let W = 320;
const H = 180;

function layout() {
  W = Math.max(160, Math.round((H * innerWidth) / Math.max(1, innerHeight)));
  canvas.width = W; canvas.height = H;
  vistaCv.width = W; vistaCv.height = VISTA_H;
  scene.resize(W, H);
  g.imageSmoothingEnabled = false;
}
layout();
addEventListener("resize", layout);

// ---- HUD (DOM overlay)
const hudEl = document.createElement("div");
hudEl.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#e8edec;font:700 13px system-ui,'Noto Sans KR',sans-serif;text-shadow:0 1px 2px #122027;z-index:5";
const pips = document.createElement("div");
pips.style.cssText = "position:absolute;left:14px;top:12px;display:flex;gap:4px";
const camLabel = document.createElement("div");
camLabel.style.cssText = "position:absolute;left:50%;top:10px;transform:translateX(-50%);background:rgba(18,32,39,.6);padding:4px 12px;border-radius:6px;font-size:14px";
const resultEl = document.createElement("div");
resultEl.style.cssText = "position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(8,14,20,.62);pointer-events:auto;font-size:28px";
const resultText = document.createElement("div");
const again = document.createElement("button");
again.textContent = "다시";
again.style.cssText = "font:700 20px system-ui,sans-serif;padding:10px 32px;border-radius:10px;border:2px solid #8fe08a;background:#273e2b;color:#e8edec;cursor:pointer";
again.addEventListener("click", () => { location.href = location.pathname + "?proto"; });
resultEl.append(resultText, again);
hudEl.append(pips, camLabel, resultEl);
ui.append(hudEl);
let pipN = -1, labelShown = "";
function updateHud() {
  const hp = Math.max(0, raid.player.hp);
  if (hp !== pipN) {
    pipN = hp;
    pips.replaceChildren(...Array.from({ length: 6 }, (_, i) => {
      const d = document.createElement("div");
      d.style.cssText = `width:16px;height:16px;box-sizing:border-box;border:2px solid #122027;border-radius:3px;background:${i < hp ? "#e0524a" : "#263c47"}`;
      return d;
    }));
  }
  const txt = rig.mode === "I" ? "카메라 I" : "카메라 II";
  if (txt !== labelShown) { labelShown = txt; camLabel.textContent = txt; }
  if (raid.state !== "running" && resultEl.style.display === "none") {
    resultText.textContent = raid.state === "extracted" ? "탈출 성공" : raid.state === "dead" ? "사망" : "시간 초과";
    resultText.style.color = raid.state === "extracted" ? "#8fe08a" : "#ff8a7a";
    resultEl.style.display = "flex";
    input.setEnabled(false);
  }
}

input.setEnabled(true);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const BG = hexN(ROCK[0]);

/** Camera II: the stick is screen-relative (rotated by the yaw). Camera I: lane axis only, y steers to the centre line, no fire. */
function controls(): RaidInput {
  const s = input.state, p = raid.player.pos;
  if (zone === "path") {
    input.setFireLocked(true);
    return { move: { x: s.move.x, y: clamp((LANE_Y - p.y) * 2, -1, 1) * 0.6 }, fire: false };
  }
  input.setFireLocked(false);
  const c = Math.cos(rig.yaw), sn = Math.sin(rig.yaw);
  return { move: { x: s.move.x * c - s.move.y * sn, y: s.move.x * sn + s.move.y * c }, fire: s.fire };
}

let last = performance.now(), acc = 0, t = 0, paused = false;
function frame(now: number) {
  const dt = paused ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now; t += dt;
  zone = zoneAt(raid.player.pos.x, raid.player.pos.y);
  rig.update(dt, zone === "path" ? "I" : "II");
  acc += dt;
  while (acc >= STEP) { if (raid.state === "running") raid.step(STEP, controls()); acc -= STEP; }
  raid.events.length = 0;
  const k = 1 - Math.exp(-dt * 8);
  rig.focus.x += (raid.player.pos.x - rig.focus.x) * k;
  rig.focus.y += (raid.player.pos.y - rig.focus.y) * k;

  const view = rig.view();
  // painted background: only in camera I, fading in with 1 - pitch/pitch_iso
  g.globalAlpha = 1;
  g.fillStyle = "#" + BG.toString(16).padStart(6, "0");
  g.fillRect(0, 0, W, H);
  const bg = rig.background;
  if (bg > 0.001) {
    const fp = project(view, rig.focus.x, rig.focus.y, 0);
    vista.draw(vistaCv.getContext("2d")!, W, { cx: Math.round(fp.sx - W / 2), cy: 60, t, daylight: 1, known: new Set(), look: 0, isVoid: () => true });
    g.globalAlpha = bg;
    g.drawImage(vistaCv, 0, 0);
    g.globalAlpha = 1;
  }
  scene.render(g, { raid, view, focus: rig.focus, t });
  updateHud();

  window.__frame = (window.__frame ?? 0) + 1;
  requestAnimationFrame(frame);
}

const cam = { yaw: 0, pitch: 0, mode: rig.mode as CamMode, u: rig.u, background: 0 };
window.__proto = {
  get raid() { return raid; },
  get cam() {
    cam.yaw = (rig.yaw * 180) / Math.PI; cam.pitch = (rig.pitch * 180) / Math.PI; cam.mode = rig.mode; cam.u = rig.u; cam.background = rig.background;
    return cam;
  },
  get zone() { return zone; },
  get seeThrough() { return scene.seeThrough; },
  get paused() { return paused; },
  set paused(v: boolean) { paused = v; },
  snap() {
    zone = zoneAt(raid.player.pos.x, raid.player.pos.y);
    rig.focus = { ...raid.player.pos };
    rig.u = zone === "path" ? 0 : 1; rig.mode = zone === "path" ? "I" : "II";
  },
};
requestAnimationFrame((n) => { last = n; requestAnimationFrame(frame); });
window.__frame = 0;
window.__ready = true;
