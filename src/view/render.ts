/**
 * Raid renderer on the two-camera isometric engine (src/view/iso). Draws into a low-res canvas (180 px tall) that CSS scales up.
 * Back to front:
 *   1. painted vista (sky + ridges), only where the camera is the side view (camera I) -- fades in during the swing
 *   2. the iso scene: terrain, rings, rocks + entities, beam, particles (a RGBA framebuffer composited over the vista)
 *   3. daylight tint, damage flash
 * Camera II (yaw 45 / pitch 30) in arenas, camera I (yaw 0 / pitch 12) on ledge paths, eased swing between them.
 */
import type { KnowledgeId } from "../game/knowledge";
import type { Raid } from "../game/raid";
import { loadVistaArt } from "./art";
import { CameraRig } from "./iso/camera";
import { Effects } from "./iso/effects";
import { laneCentre } from "./iso/controls";
import { Scene } from "./iso/scene";
import { ROCK } from "./palette";
import { VISTA_H, Vista, type VistaLabel } from "./vista";

export const TILE = 16;
export const VIEW_H = 180;
/** Ledge pull-back: the logical height grows from VIEW_H to VIEW_H * LOOK_ZOOM while the player stands still on a ledge. */
export const LOOK_ZOOM = 300 / 180;
const LOOK_STILL = 1; // s of stillness before the camera pulls back
const LOOK_IN = 1.5, LOOK_OUT = 0.3; // s to pull back / to return
const LABEL_FONT = '600 10px "Noto Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif';
const BG_VISIBLE = 0.95; // vista counts as shown (reveals, labels) from this much background

const REVEAL_TOAST: Record<string, string> = {
  celestial: "관측: 두 달의 궤도와 주기가 보인다 (천문학)",
  radiochem: "관측: 지층의 나이가 보인다 (방사화학)",
  physiology: "관측: 먼 무리의 이동 경로가 보인다 (생리학)",
  electrochem: "관측: 오로라와 자기장 선이 보인다 (전기화학)",
};

export interface Rect { x0: number; y0: number; x1: number; y1: number }
/** Labels keep this far (native px) from the player's sprite box. */
export const LABEL_PLAYER_GAP = 28;
const HUD_SELECTOR = "#btn-fire,#btn-dash,#btn-bag,#raid-timer,#sun-dial,#weapon-hud,#crawler-activity,.hp,.toast";
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  W = 320;
  H = VIEW_H;
  readonly rig = new CameraRig();
  readonly scene = new Scene();
  readonly fx = new Effects();
  /** ledge pull-back progress, eased 0..1 (1 = fully pulled back) */
  lookout = 0;
  /** knowledge reveals the player has been shown in this raid */
  readonly revealed = new Set<KnowledgeId>();
  onReveal: ((id: KnowledgeId, text: string) => void) | null = null;
  /** smoothed whole-draw time in ms (perf readout) */
  drawMs = 0;
  private lookRaw = 0;
  private still = 0;
  readonly vista = new Vista();
  private vistaCv = document.createElement("canvas");
  private labelCv = document.createElement("canvas");
  private labelsShown = false;
  private t = 0;
  /** ledge lane (world y) the camera I band is centred on; kept after leaving the ledge so the swing back can fade it */
  private lane: number | null = null;
  private hudRects: Rect[] = [];
  private hudAge = 99;
  /** native-pixel rects of the labels drawn last frame, and of the player's sprite (tests: they must never overlap) */
  labelRects: Rect[] = [];
  playerRect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.labelCv.id = "vista-labels";
    this.labelCv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none";
    canvas.after(this.labelCv);
    this.resize();
    void loadVistaArt().then((a) => { this.vista.art = a; });
  }

  /** Logical size follows the window aspect and the current pull-back height. */
  private layout(h: number) {
    const w = Math.max(160, Math.round((h * innerWidth) / Math.max(1, innerHeight)));
    if (w === this.W && h === this.H && this.canvas.width === w && this.canvas.height === h) return;
    this.W = w; this.H = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scene.resize(w, h);
    this.ctx.imageSmoothingEnabled = false;
  }

  resize() {
    this.layout(this.H);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.labelCv.width = Math.round(innerWidth * dpr);
    this.labelCv.height = Math.round(innerHeight * dpr);
    this.labelsShown = true;
  }

  /** Zoom factor of the current frame: 1 normally, up to LOOK_ZOOM at full pull-back. */
  get zoom() { return this.H / VIEW_H; }
  get yaw() { return this.rig.yaw; }

  /** World point (metres, z up) -> CSS pixels on the window (for DOM overlays), projected through the current camera. */
  worldToScreen(wx: number, wy: number, wz = 0) {
    const [sx, sy] = this.scene.screenOf(wx, wy, wz);
    return { x: (sx * innerWidth) / this.W, y: (sy * innerHeight) / this.H };
  }

  /** Jump to the camera of the zone the player stands in (new raid / hideout preview). */
  snapCamera(raid: Raid) {
    this.lookRaw = this.lookout = this.still = 0;
    this.layout(VIEW_H);
    this.revealed.clear();
    const path = raid.onPath;
    this.rig.mode = path ? "I" : "II";
    this.rig.u = path ? 0 : 1;
    this.rig.focus = { ...raid.player.pos };
    this.lane = path ? laneCentre(raid, raid.player.pos.x, raid.player.pos.y) : null;
    this.fx.clear();
  }

  private updateLookout(raid: Raid, dt: number, busy: boolean, on: boolean) {
    const v = Math.hypot(raid.player.vel.x, raid.player.vel.y);
    const ledge = on && raid.state === "running" && raid.onPath && this.rig.u === 0;
    this.still = ledge && !busy && v < 0.3 ? this.still + dt : 0;
    const want = ledge && this.still >= LOOK_STILL;
    this.lookRaw = want ? Math.min(1, this.lookRaw + dt / LOOK_IN) : Math.max(0, this.lookRaw - dt / LOOK_OUT);
    const k = this.lookRaw;
    this.lookout = k * k * (3 - 2 * k); // smoothstep
  }

  private checkReveals(raid: Raid) {
    if (this.revealed.size >= raid.knowledge.size) return;
    for (const id of raid.knowledge) {
      if (this.revealed.has(id) || !REVEAL_TOAST[id]) continue;
      if (id === "electrochem" && raid.daylight >= 0.6) continue; // the aurora needs dusk
      this.revealed.add(id);
      this.onReveal?.(id, REVEAL_TOAST[id]);
    }
  }

  /** Native-pixel rects (CSS px) that labels must stay off: HUD controls and the player's sprite with its margin. */
  private avoidRects(raid: Raid, dt: number): Rect[] {
    this.hudAge += dt;
    if (this.hudAge > 0.2) {
      this.hudAge = 0;
      this.hudRects = [];
      for (const e of document.querySelectorAll(HUD_SELECTOR)) {
        const b = e.getBoundingClientRect();
        if (b.width > 0 && b.height > 0 && getComputedStyle(e).display !== "none") this.hudRects.push({ x0: b.left - 4, y0: b.top - 4, x1: b.right + 4, y1: b.bottom + 4 });
      }
    }
    const [px, py] = this.scene.screenOf(raid.player.pos.x, raid.player.pos.y), kx = innerWidth / this.W, ky = innerHeight / this.H;
    this.playerRect = { x0: (px - 11) * kx, y0: (py - 24) * ky, x1: (px + 11) * kx, y1: (py + 2) * ky };
    return [...this.hudRects, grow(this.playerRect, LABEL_PLAYER_GAP)];
  }

  /** Vista labels on a native-resolution overlay, so text stays crisp while the pixel art is scaled up. Labels that would touch the player or the HUD are skipped. */
  private drawLabels(labels: VistaLabel[], avoid: Rect[]) {
    const cv = this.labelCv, g = cv.getContext("2d")!;
    this.labelRects = [];
    if (!labels.length && !this.labelsShown) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    this.labelsShown = labels.length > 0;
    if (!labels.length) return;
    const dpr = cv.width / Math.max(1, innerWidth);
    g.scale(dpr, dpr);
    g.font = LABEL_FONT;
    g.textBaseline = "middle";
    const sx = (this.H / VISTA_H) * (innerWidth / this.W), sy = innerHeight / VISTA_H;
    const a = 0.82 + 0.18 * this.lookout;
    for (const L of labels) {
      const x = L.x * sx, y = L.y * sy, tx = L.tick ? x + 9 : x, w = g.measureText(L.text).width;
      const x0 = L.align === "center" ? tx - w / 2 : tx;
      const r = { x0: L.tick ? x : x0, y0: y - 7, x1: x0 + w, y1: y + 7 };
      if (avoid.some((q) => hit(r, q))) continue;
      this.labelRects.push(r);
      g.textAlign = L.align;
      g.shadowColor = "transparent";
      g.lineJoin = "round"; g.lineWidth = 3; g.strokeStyle = "rgba(12,24,34,0.78)"; // dark outline: the text sits on busy painted art
      g.strokeText(L.text, tx, y);
      g.fillStyle = `rgba(246,250,252,${a.toFixed(3)})`;
      g.fillText(L.text, tx, y);
      if (L.tick) { g.shadowColor = "transparent"; g.fillRect(Math.round(x), Math.round(y), 6, 1); }
    }
    g.shadowColor = "transparent";
  }

  private tint(d: number) {
    if (d >= 1) return;
    const g = this.ctx;
    const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
    let c: number[];
    if (d > 0.5) c = lerp([255, 150, 60, 0], [255, 150, 60, 0.15], (1 - d) / 0.5);
    else c = lerp([255, 150, 60, 0.15], [10, 20, 70, 0.45], (0.5 - d) / 0.5);
    g.fillStyle = `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3].toFixed(3)})`;
    g.fillRect(0, 0, this.W, this.H);
  }

  // ---------------------------------------------------------------- frame
  /** busy: the player is giving move/fire input (or a panel is open), which cancels the ledge pull-back. */
  draw(raid: Raid, dt: number, busy = false, lookoutOn = false) {
    const t0 = performance.now();
    this.t += dt;
    const rig = this.rig;
    rig.update(dt, raid.onPath ? "I" : "II");
    this.updateLookout(raid, dt, busy, lookoutOn);
    this.layout(Math.round(VIEW_H * (1 + (LOOK_ZOOM - 1) * this.lookout)));
    const g = this.ctx, W = this.W, H = this.H;
    const k = 1 - Math.exp(-dt * 8);
    rig.focus.x += (raid.player.pos.x - rig.focus.x) * k;
    rig.focus.y += (raid.player.pos.y - rig.focus.y) * k;
    const view = rig.view();

    if (raid.onPath) this.lane = laneCentre(raid, raid.player.pos.x, raid.player.pos.y) ?? this.lane;
    this.fx.consume(raid, this.t);
    this.scene.render({ raid, view, focus: rig.focus, t: this.t, settled: !rig.transitioning, fx: this.fx, b: rig.background, lane: this.lane });
    this.fx.tick(dt);

    // painted vista behind everything, only in camera I (fading in with the swing)
    g.globalAlpha = 1;
    g.fillStyle = ROCK[0];
    g.fillRect(0, 0, W, H);
    const bg = rig.background;
    let labels: VistaLabel[] = [];
    const avoid = this.avoidRects(raid, dt);
    if (bg > 0.001) {
      const Wv = Math.ceil((W * VISTA_H) / H), vc = this.vistaCv;
      if (vc.width !== Wv || vc.height !== VISTA_H) { vc.width = Wv; vc.height = VISTA_H; }
      const vg = vc.getContext("2d")!, sc = H / VISTA_H, kx = sc * (innerWidth / W), ky = innerHeight / VISTA_H;
      vg.font = LABEL_FONT;
      const vr = this.scene.viewRect;
      labels = this.vista.draw(vg, Wv, {
        cx: vr.x0 - vr.minX, cy: 60, t: this.t, daylight: raid.daylight, known: raid.knowledge, look: this.lookout,
        isVoid: (x, y) => !this.scene.opaqueAt(x * sc, y * sc),
        // vista-space label box -> native px, against the player / HUD rects (the final filter in drawLabels uses the real text width)
        textW: (text) => vg.measureText(text).width / kx,
        free: (x0, y0, x1, y1) => { const r = { x0: x0 * kx, y0: y0 * ky - 7, x1: x1 * kx, y1: y1 * ky + 7 }; return !avoid.some((q) => hit(r, q)); },
      });
      g.globalAlpha = bg;
      g.drawImage(vc, 0, 0, Wv, VISTA_H, 0, 0, Math.round(Wv * sc), H);
      g.globalAlpha = 1;
    }
    this.scene.present(g);
    const shown = bg >= BG_VISIBLE;
    if (shown) this.checkReveals(raid);
    this.drawLabels(shown ? labels : [], avoid);

    this.tint(raid.daylight);
    if (this.fx.flash > 0) {
      g.fillStyle = `rgba(230,40,40,${(Math.min(1, this.fx.flash / 0.3) * 0.4).toFixed(3)})`;
      g.fillRect(0, 0, W, H);
    }
    this.drawMs += (performance.now() - t0 - this.drawMs) * 0.1;
  }
}
