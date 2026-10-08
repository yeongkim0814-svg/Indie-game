/**
 * Canvas2D quarter-view renderer. Draws into a low-res canvas (180 px tall) that CSS scales up.
 * Layering, back to front:
 *   1. drawVista()            sky + ridges (visible through '~' tiles)
 *   2. ground layer           pre-rendered per map: grass, flowers, cliff lips, rock-cast shadows
 *   3. extraction ring
 *   4. rows ty = top..bottom  rock blocks of row ty, then every entity whose feet are in row ty
 *      (so a rock in a later row, drawn afterwards, hides entities standing behind it)
 *   5. particles, daylight tint, damage flash
 */
import { ITEMS, itemValue, type Item } from "../game/items";
import { RAID, type Crawler, type Raid } from "../game/raid";
import type { ParsedMap } from "../game/raidMap";
import { FLOWER, GRASS, ROCK, SHADOW, hash2, mix } from "./palette";
import type { KnowledgeId } from "../game/knowledge";
import { loadVistaArt } from "./art";
import { VISTA_H, Vista, type VistaLabel } from "./vista";

export const TILE = 16;
export const VIEW_H = 180;
/** Lookout (전망 지점): the logical height grows from VIEW_H to VIEW_H * LOOK_ZOOM while the player stands still at the cliff. */
export const LOOK_ZOOM = 300 / 180;
const LOOK_RANGE = 2.5; // m from a '~' tile
const LOOK_STILL = 1; // s of stillness before the camera pulls back
const LOOK_IN = 1.5, LOOK_OUT = 0.3; // s to pull back / to return
const LOOK_PAN = 150; // px of camera pan toward the void at full lookout

const REVEAL_TOAST: Record<string, string> = {
  celestial: "관측: 두 달의 궤도와 주기가 보인다 (천문학)",
  radiochem: "관측: 지층의 나이가 보인다 (방사화학)",
  physiology: "관측: 먼 무리의 이동 경로가 보인다 (생리학)",
  electrochem: "관측: 오로라와 자기장 선이 보인다 (전기화학)",
};
const BLOCK = 8; // rock height in px (top face is raised by this much)

interface Particle { x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; color: string; size: number }
interface Faller { x: number; y: number; t: number; seed: number }
interface Drawable { y: number; draw: () => void }

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  W = 320;
  H = VIEW_H;
  camX = 0;
  camY = 0;
  /** lookout progress, eased 0..1 (1 = fully pulled back) */
  lookout = 0;
  /** knowledge reveals the player has been shown in this raid */
  readonly revealed = new Set<KnowledgeId>();
  onReveal: ((id: KnowledgeId, text: string) => void) | null = null;
  private lookRaw = 0;
  private still = 0;
  private lookDir = { x: 0, y: 0 };
  private vista = new Vista();
  private vistaCv = document.createElement("canvas");
  private labelCv = document.createElement("canvas");
  private labelsShown = false;
  private t = 0;
  private ground: HTMLCanvasElement | null = null;
  private groundFor: ParsedMap | null = null;
  private particles: Particle[] = [];
  private flash = 0;
  private fallers: Faller[] = [];
  private hitUntil = new WeakMap<Crawler, number>();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.labelCv.id = "vista-labels";
    this.labelCv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none";
    canvas.after(this.labelCv);
    this.resize();
    void loadVistaArt().then((a) => { this.vista.art = a; });
  }

  /** Logical size follows the window aspect and the current lookout height. */
  private layout(h: number) {
    const w = Math.max(160, Math.round((h * innerWidth) / Math.max(1, innerHeight)));
    if (w === this.W && h === this.H && this.canvas.width === w && this.canvas.height === h) return;
    // keep the view centred while its size changes
    this.camX -= (w - this.W) / 2; this.camY -= (h - this.H) / 2;
    this.W = w; this.H = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
  }

  resize() {
    this.layout(this.H);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.labelCv.width = Math.round(innerWidth * dpr);
    this.labelCv.height = Math.round(innerHeight * dpr);
    this.labelsShown = true;
  }

  /** Zoom factor of the current frame: 1 normally, up to LOOK_ZOOM at full lookout. */
  get zoom() { return this.H / VIEW_H; }

  /** World metres -> CSS pixels on the window (for DOM overlays). */
  worldToScreen(wx: number, wy: number) {
    return { x: ((wx * TILE - this.camX) * innerWidth) / this.W, y: ((wy * TILE - this.camY) * innerHeight) / this.H };
  }

  private camTarget(raid: Raid) {
    const mw = raid.map.w * TILE, mh = raid.map.h * TILE;
    const px = raid.player.pos.x * TILE - this.W / 2, py = raid.player.pos.y * TILE - 4 - this.H / 2;
    return {
      x: mw <= this.W ? (mw - this.W) / 2 : Math.min(mw - this.W, Math.max(0, px)),
      y: mh <= this.H ? (mh - this.H) / 2 : Math.min(mh - this.H, Math.max(-BLOCK, py)),
    };
  }
  snapCamera(raid: Raid) {
    this.lookRaw = this.lookout = this.still = 0;
    this.layout(VIEW_H);
    this.revealed.clear();
    const c = this.camTarget(raid); this.camX = c.x; this.camY = c.y; this.particles.length = 0; this.fallers.length = 0; this.flash = 0;
  }

  /** Nearest '~' tile within LOOK_RANGE metres of the player: unit direction toward it, or null. */
  private voidNear(raid: Raid) {
    const m = raid.map, p = raid.player.pos;
    let best = LOOK_RANGE, dx = 0, dy = 0, found = false;
    for (let ty = Math.max(0, Math.floor(p.y - LOOK_RANGE)); ty <= Math.min(m.h - 1, Math.floor(p.y + LOOK_RANGE)); ty++) {
      for (let tx = Math.max(0, Math.floor(p.x - LOOK_RANGE)); tx <= Math.min(m.w - 1, Math.floor(p.x + LOOK_RANGE)); tx++) {
        if (m.rows[ty][tx] !== "~") continue;
        const nx = Math.min(tx + 1, Math.max(tx, p.x)), ny = Math.min(ty + 1, Math.max(ty, p.y)); // closest point of the tile
        const d = Math.hypot(nx - p.x, ny - p.y);
        if (d < best) { best = d; dx = tx + 0.5 - p.x; dy = ty + 0.5 - p.y; found = true; }
      }
    }
    if (!found) return null;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }

  private updateLookout(raid: Raid, dt: number, busy: boolean) {
    const v = Math.hypot(raid.player.vel.x, raid.player.vel.y);
    const near = raid.state === "running" ? this.voidNear(raid) : null;
    this.still = near && !busy && v < 0.3 ? this.still + dt : 0;
    if (near) this.lookDir = near;
    const want = !!near && this.still >= LOOK_STILL;
    this.lookRaw = want ? Math.min(1, this.lookRaw + dt / LOOK_IN) : Math.max(0, this.lookRaw - dt / LOOK_OUT);
    const k = this.lookRaw;
    this.lookout = k * k * (3 - 2 * k); // smoothstep
  }

  /** World pixel is not covered by ground: a cliff tile, or outside the map. */
  private isVoidAt(raid: Raid, wx: number, wy: number) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE), m = raid.map;
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return tx >= m.w; // east of the map is open sky
    return m.rows[ty][tx] === "~";
  }

  /** Is any '~' tile inside the current view? */
  private voidInView(raid: Raid) {
    const m = raid.map;
    const r0 = Math.max(0, Math.floor(this.camY / TILE)), r1 = Math.min(m.h - 1, Math.floor((this.camY + this.H) / TILE));
    const c0 = Math.max(0, Math.floor(this.camX / TILE)), c1 = Math.min(m.w - 1, Math.floor((this.camX + this.W) / TILE));
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (m.rows[y][x] === "~") return true;
    return false;
  }

  private checkReveals(raid: Raid) {
    if (this.revealed.size >= raid.knowledge.size || !this.voidInView(raid)) return;
    for (const id of raid.knowledge) {
      if (this.revealed.has(id) || !REVEAL_TOAST[id]) continue;
      if (id === "electrochem" && raid.daylight >= 0.6) continue; // the aurora needs dusk
      this.revealed.add(id);
      this.onReveal?.(id, REVEAL_TOAST[id]);
    }
  }

  /** Vista labels on a native-resolution overlay, so text stays crisp while the pixel art is scaled up. */
  private drawLabels(labels: VistaLabel[]) {
    const cv = this.labelCv, g = cv.getContext("2d")!;
    if (!labels.length && !this.labelsShown) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    this.labelsShown = labels.length > 0;
    if (!labels.length) return;
    const dpr = cv.width / Math.max(1, innerWidth);
    g.scale(dpr, dpr);
    g.font = '600 10px "Noto Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif';
    g.textBaseline = "middle";
    const sx = (this.H / VISTA_H) * (innerWidth / this.W), sy = innerHeight / VISTA_H;
    const a = 0.5 + 0.4 * this.lookout;
    for (const L of labels) {
      const x = L.x * sx, y = L.y * sy;
      g.textAlign = L.align;
      g.shadowColor = "rgba(14,26,34,0.85)"; g.shadowBlur = 2; g.shadowOffsetY = 1;
      g.fillStyle = `rgba(246,250,252,${a.toFixed(3)})`;
      const tx = L.tick ? x + 9 : x;
      g.fillText(L.text, tx, y);
      if (L.tick) { g.shadowColor = "transparent"; g.fillRect(Math.round(x), Math.round(y), 6, 1); }
    }
    g.shadowColor = "transparent";
  }

  // ---------------------------------------------------------------- ground layer
  private buildGround(map: ParsedMap) {
    const cv = document.createElement("canvas");
    cv.width = map.w * TILE; cv.height = map.h * TILE;
    const g = cv.getContext("2d")!;
    const at = (x: number, y: number) => (y < 0 || y >= map.h || x < 0 ? "#" : map.rows[y][x] ?? "#");
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const c = at(tx, ty), x = tx * TILE, y = ty * TILE;
        if (c === "~") continue;
        if (c === "#") { g.fillStyle = ROCK[0]; g.fillRect(x, y, TILE, TILE); continue; }
        // base + clumps
        g.fillStyle = GRASS[2]; g.fillRect(x, y, TILE, TILE);
        for (let i = 0; i < 5; i++) {
          const r = hash2(tx, ty, 10 + i);
          const w = 3 + Math.floor(hash2(tx, ty, 20 + i) * 4), h = 2 + Math.floor(hash2(tx, ty, 30 + i) * 2);
          const px = Math.floor(hash2(tx, ty, 40 + i) * (TILE - w)), py = Math.floor(hash2(tx, ty, 50 + i) * (TILE - h));
          g.fillStyle = r < 0.5 ? GRASS[1] : GRASS[3];
          g.fillRect(x + px, y + py, w, h);
        }
        for (let i = 0; i < 4; i++) { // grass blades
          if (hash2(tx, ty, 60 + i) < 0.7) continue;
          g.fillStyle = GRASS[4];
          g.fillRect(x + Math.floor(hash2(tx, ty, 70 + i) * 15), y + Math.floor(hash2(tx, ty, 80 + i) * 14), 1, 2);
        }
        if (hash2(tx, ty, 90) < 0.22) {
          g.fillStyle = FLOWER;
          g.fillRect(x + 1 + Math.floor(hash2(tx, ty, 91) * 14), y + 1 + Math.floor(hash2(tx, ty, 92) * 14), 1, 1);
        }
        // shadow cast by the rock block to the north
        if (at(tx, ty - 1) === "#") { g.fillStyle = SHADOW; g.fillRect(x, y, TILE, 5); g.fillRect(x, y, TILE, 2); }
        if (at(tx - 1, ty) === "#") { g.fillStyle = "rgba(18,32,39,0.2)"; g.fillRect(x, y, 3, TILE); }
        // cliff lips: grass edge + dark rock face dropping into the void
        if (at(tx, ty - 1) === "~") { g.fillStyle = GRASS[4]; g.fillRect(x, y, TILE, 1); }
        if (at(tx - 1, ty) === "~") { g.fillStyle = GRASS[4]; g.fillRect(x, y, 1, TILE); }
        if (at(tx, ty + 1) === "~") {
          g.fillStyle = GRASS[3]; g.fillRect(x, y + 13, TILE, 3);
          g.fillStyle = GRASS[4]; g.fillRect(x, y + 13, TILE, 1);
          this.cliffFace(g, x, y + TILE, TILE, 12, tx, ty);
        }
        if (at(tx + 1, ty) === "~") {
          g.fillStyle = GRASS[3]; g.fillRect(x + 13, y, 3, TILE);
          g.fillStyle = GRASS[4]; g.fillRect(x + 15, y, 1, TILE);
          g.fillStyle = ROCK[2]; g.fillRect(x + TILE, y, 4, TILE);
          g.fillStyle = ROCK[1]; g.fillRect(x + TILE + 2, y, 2, TILE);
          g.fillStyle = ROCK[0]; g.fillRect(x + TILE + 3, y, 1, TILE);
        }
      }
    }
    this.ground = cv; this.groundFor = map;
  }

  private cliffFace(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tx: number, ty: number) {
    g.fillStyle = ROCK[2]; g.fillRect(x, y, w, h);
    g.fillStyle = ROCK[1]; g.fillRect(x, y + Math.floor(h * 0.45), w, h);
    g.fillStyle = ROCK[0]; g.fillRect(x, y + Math.floor(h * 0.8), w, h);
    for (let i = 0; i < 3; i++) { // vertical strata streaks
      g.fillStyle = ROCK[3];
      g.fillRect(x + Math.floor(hash2(tx, ty, 200 + i) * (w - 1)), y, 1, 2 + Math.floor(hash2(tx, ty, 210 + i) * 5));
    }
  }

  // ---------------------------------------------------------------- rocks
  private drawRock(raid: Raid, tx: number, ty: number, ox: number, oy: number) {
    const g = this.ctx, m = raid.map;
    const at = (x: number, y: number) => (y < 0 || y >= m.h || x < 0 ? "#" : m.rows[y][x] ?? "#");
    const x = tx * TILE - ox, y = ty * TILE - oy;
    // top face, raised by BLOCK
    g.fillStyle = ROCK[3]; g.fillRect(x, y - BLOCK, TILE, TILE);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = hash2(tx, ty, i) < 0.6 ? ROCK[4] : ROCK[2];
      g.fillRect(x + Math.floor(hash2(tx, ty, 5 + i) * 13), y - BLOCK + Math.floor(hash2(tx, ty, 9 + i) * 14), 2 + (i & 1), 1);
    }
    g.fillStyle = ROCK[4];
    if (at(tx, ty - 1) !== "#") g.fillRect(x, y - BLOCK, TILE, 1);
    if (at(tx - 1, ty) !== "#") g.fillRect(x, y - BLOCK, 1, TILE);
    g.fillStyle = ROCK[2];
    if (at(tx + 1, ty) !== "#") g.fillRect(x + TILE - 1, y - BLOCK, 1, TILE);
    // front face (only where it is not hidden by the rock in front)
    if (at(tx, ty + 1) !== "#") {
      g.fillStyle = ROCK[2]; g.fillRect(x, y + BLOCK, TILE, BLOCK);
      g.fillStyle = ROCK[1]; g.fillRect(x, y + BLOCK + 4, TILE, 4);
      g.fillStyle = ROCK[0]; g.fillRect(x, y + TILE - 1, TILE, 1);
      g.fillStyle = ROCK[3]; g.fillRect(x, y + BLOCK, TILE, 1);
      g.fillStyle = ROCK[1];
      const bx = 3 + Math.floor(hash2(tx, ty, 77) * 9);
      g.fillRect(x + bx, y + BLOCK + 1, 1, 4);
      if (at(tx - 1, ty) !== "#") { g.fillStyle = ROCK[1]; g.fillRect(x, y + BLOCK, 1, BLOCK); }
      if (at(tx + 1, ty) !== "#") { g.fillStyle = ROCK[1]; g.fillRect(x + TILE - 1, y + BLOCK, 1, BLOCK); }
    }
  }

  // ---------------------------------------------------------------- sprites
  private shadow(cx: number, cy: number, hw: number) {
    const g = this.ctx;
    g.fillStyle = SHADOW;
    g.fillRect(cx - hw + 1, cy - 1, hw * 2 - 2, 1);
    g.fillRect(cx - hw, cy, hw * 2, 1);
    g.fillRect(cx - hw + 1, cy + 1, hw * 2 - 2, 1);
  }

  private drawPlayer(raid: Raid, fx: number, fy: number) {
    const g = this.ctx, p = raid.player;
    const dir = p.facing.x >= 0 ? 1 : -1;
    const moving = Math.hypot(p.vel.x, p.vel.y) > 0.4;
    const step = moving ? Math.floor(this.t * 9) & 1 : 0;
    this.shadow(fx, fy, 7);
    const dark = "#142633", mid = "#24405a", lit = ({ rifle: ROCK[4], launcher: "#e69a55", lens: "#ffe08a", coilgun: "#6fe8ff" } as Record<string, string>)[raid.weaponKind];
    // legs (alternate while walking)
    g.fillStyle = dark;
    g.fillRect(fx - 4, fy - 5 - step, 3, 5 + step); g.fillRect(fx + 1, fy - 5 - (1 - step) * (moving ? 1 : 0), 3, 5);
    // backpack on the side away from facing
    g.fillStyle = "#3b4d56"; g.fillRect(fx - dir * 7 - (dir > 0 ? 0 : 3), fy - 14, 4, 8);
    g.fillStyle = "#1b2e39"; g.fillRect(fx - dir * 7 - (dir > 0 ? 0 : 3), fy - 8, 4, 2);
    // coat
    g.fillStyle = dark; g.fillRect(fx - 5, fy - 15, 10, 10);
    g.fillStyle = mid; g.fillRect(fx - 5, fy - 15, 10, 2); g.fillRect(fx + (dir > 0 ? 3 : -5), fy - 13, 2, 7);
    // hooded head
    g.fillStyle = dark; g.fillRect(fx - 4, fy - 22, 8, 7);
    g.fillStyle = mid; g.fillRect(fx - 4, fy - 22, 8, 1); g.fillRect(fx - 3, fy - 23, 6, 1);
    g.fillStyle = "#6fe0d0"; g.fillRect(fx + (dir > 0 ? 1 : -4), fy - 19, 3, 1); // visor glint
    // gun line toward facing
    const gx = fx, gy = fy - 10;
    g.fillStyle = lit;
    const gs = raid.weaponKind === "launcher" ? 3 : 2; // the launcher is a fat tube
    for (let i = 4; i <= 11; i++) g.fillRect(Math.round(gx + p.facing.x * i), Math.round(gy + p.facing.y * i), gs, gs);
  }

  private drawCrawler(c: Crawler, gx: number, gy: number, flash: boolean) {
    const g = this.ctx;
    this.shadow(gx, gy, 6);
    // knocked off its feet: lifted along a short arc over its shadow
    const lift = c.airborne > 0 ? Math.round(5 * Math.sin(Math.PI * Math.min(1, 1 - c.airborne / RAID.crawler.knockAir))) : 0;
    const fx = gx, fy = gy - lift;
    const body = flash ? "#ffffff" : "#5a2d2a", shell = flash ? "#ffffff" : "#8a4a3a", leg = flash ? "#ffffff" : "#2b1514";
    const step = Math.floor(this.t * 8 + c.pos.x * 3) & 1;
    g.fillStyle = leg;
    for (let i = 0; i < 3; i++) {
      const ly = fy - 6 + i * 2 + (step && i === 1 ? 1 : 0);
      g.fillRect(fx - 6, ly, 2, 1); g.fillRect(fx + 4, ly, 2, 1);
    }
    g.fillStyle = body; g.fillRect(fx - 5, fy - 6, 10, 5); g.fillRect(fx - 3, fy - 8, 6, 1); g.fillRect(fx - 4, fy - 2, 8, 1);
    g.fillStyle = shell; g.fillRect(fx - 4, fy - 7, 8, 2); g.fillRect(fx, fy - 5, 1, 4);
    g.fillStyle = flash ? "#ffffff" : "#f2c14e"; g.fillRect(fx - 2, fy - 6, 1, 1); g.fillRect(fx + 1, fy - 6, 1, 1);
  }

  /** rifle: small bright pellet; launcher: chunky dark 4×4 slug; coilgun: thin cyan streak along the flight line. */
  private drawBullet(kind: string, b: Raid["bullets"][number], x: number, y: number) {
    const g = this.ctx;
    g.fillStyle = SHADOW; g.fillRect(x - 1, y + 3, kind === "launcher" ? 4 : 2, 1);
    if (kind === "launcher") {
      g.fillStyle = "#1a1412"; g.fillRect(x - 2, y - 7, 4, 4);
      g.fillStyle = "#5a4636"; g.fillRect(x - 2, y - 7, 4, 1); g.fillRect(x - 2, y - 7, 1, 4);
      return;
    }
    if (kind === "coilgun") {
      const l = Math.hypot(b.vel.x, b.vel.y) || 1, dx = b.vel.x / l, dy = b.vel.y / l;
      for (let i = 0; i < 12; i++) {
        g.fillStyle = i === 0 ? "#ffffff" : i < 4 ? "#7ff0ff" : "#2aa8c8";
        g.fillRect(Math.round(x - dx * i), Math.round(y - 4 - dy * i), 1, 1);
      }
      return;
    }
    g.fillStyle = "#fff4c0"; g.fillRect(x - 1, y - 5, 2, 2);
  }

  /** A crawler knocked over the cliff edge: shrinks, fades and drops away with a spin of its legs. */
  private drawFaller(f: Faller, x: number, y: number) {
    const g = this.ctx, k = Math.min(1, f.t / 0.7), s = 1 - 0.7 * k;
    g.save();
    g.globalAlpha = 1 - k;
    g.translate(x, y + k * 14); g.scale(s, s);
    this.drawCrawler({ pos: { x: f.seed, y: 0 }, vel: { x: 0, y: 0 }, hp: 0, alive: false, touchCooldown: 0, airborne: 0 }, 0, 0, false);
    g.restore();
  }

  /** Focused sunlight: a warm white line from the lens to its target; width and alpha follow the sun. */
  private drawBeam(raid: Raid, ox: number, oy: number) {
    const b = raid.beam;
    if (!b) return;
    const g = this.ctx, I = Math.max(0, Math.min(1, b.intensity));
    const x0 = b.from.x * TILE - ox, y0 = b.from.y * TILE - oy - 10, x1 = b.to.x * TILE - ox, y1 = b.to.y * TILE - oy - 4;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const w = I > 0.66 ? 3 : I > 0.33 ? 2 : 1, a = 0.3 + 0.7 * I, flick = 0.85 + 0.15 * Math.sin(this.t * 40);
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass === 0 ? `rgba(255,214,140,${(a * 0.45 * flick).toFixed(3)})` : `rgba(255,248,224,${(a * flick).toFixed(3)})`;
      const ww = pass === 0 ? w + 2 : w, off = Math.floor(ww / 2);
      for (let i = 0; i <= n; i++) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n) - off, Math.round(y0 + ((y1 - y0) * i) / n) - off, ww, ww);
    }
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; // burn spot on the target
    g.fillRect(Math.round(x1) - 1, Math.round(y1) - 1, 3, 3);
  }

  private drawSample(fx: number, fy: number, k: number, it: Item) {
    if (it.kind === "ore") return this.drawOre(fx, fy, k, it);
    if (it.kind === "bio") return this.drawBio(fx, fy, k, it);
    const g = this.ctx, bob = Math.round(Math.sin(this.t * 3 + k * 1.7) * 1.5);
    this.shadow(fx, fy, 3);
    const y = fy - 7 + bob;
    g.fillStyle = "#6fe0d0";
    g.fillRect(fx - 1, y, 2, 1); g.fillRect(fx - 2, y + 1, 4, 1); g.fillRect(fx - 3, y + 2, 6, 2); g.fillRect(fx - 2, y + 4, 4, 1); g.fillRect(fx - 1, y + 5, 2, 1);
    g.fillStyle = "#c9fff4"; g.fillRect(fx - 1, y + 1, 1, 2);
    g.fillStyle = "#2f8f88"; g.fillRect(fx + 1, y + 3, 2, 1); g.fillRect(fx, y + 4, 2, 1);
  }

  /** Radioactive ore: tall yellow-green rock whose glow fades as it decays. */
  private drawOre(fx: number, fy: number, k: number, it: Item) {
    const g = this.ctx, q = Math.max(0, Math.min(1, itemValue(it) / ITEMS.ore.value));
    this.shadow(fx, fy, 4);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4 + k), glow = q * (0.12 + 0.2 * pulse);
    g.fillStyle = `rgba(200,224,90,${glow.toFixed(3)})`;
    g.fillRect(fx - 6, fy - 14, 12, 14); g.fillRect(fx - 5, fy - 16, 10, 2);
    const base = "#c8e05a", lit = mix(base, "#f4ffc0", 0.4 + 0.3 * pulse * q), dim = mix(base, ROCK[2], Math.min(1, 1 - q * 0.8 + 0.1)), dark = mix(base, ROCK[1], 0.55 + (1 - q) * 0.3);
    g.fillStyle = dim; g.fillRect(fx - 3, fy - 12, 6, 11); g.fillRect(fx - 2, fy - 13, 4, 1); g.fillRect(fx - 4, fy - 9, 8, 7);
    g.fillStyle = dark; g.fillRect(fx + 1, fy - 10, 3, 9); g.fillRect(fx - 4, fy - 3, 8, 2);
    g.fillStyle = lit; g.fillRect(fx - 2, fy - 12, 2, 5); g.fillRect(fx - 3, fy - 8, 1, 3);
    g.fillStyle = "#f4ffc0"; g.fillRect(fx - 1, fy - 11, 1, 2);
  }

  /** Biological specimen: pink-purple pod that browns as it rots. */
  private drawBio(fx: number, fy: number, k: number, it: Item) {
    const g = this.ctx, f = Math.max(0, Math.min(1, it.fresh)), bob = Math.round(Math.sin(this.t * 2 + k) * 0.8);
    this.shadow(fx, fy, 5);
    const rot = 1 - f, y = fy - 9 + bob;
    const body = mix("#c06090", "#7a5a3a", rot), lit = mix("#e890b8", "#a08460", rot), dark = mix("#80305f", "#4a3624", rot);
    g.fillStyle = dark; g.fillRect(fx - 4, y + 3, 8, 5); g.fillRect(fx - 3, y + 8, 6, 1);
    g.fillStyle = body; g.fillRect(fx - 3, y, 6, 8); g.fillRect(fx - 4, y + 2, 8, 5); g.fillRect(fx - 2, y - 1, 4, 1);
    g.fillStyle = lit; g.fillRect(fx - 2, y + 1, 2, 3); g.fillRect(fx - 3, y + 2, 1, 2);
    g.fillStyle = mix("#6fe0a0", "#6a5a30", rot); g.fillRect(fx, y - 3, 1, 3); g.fillRect(fx + 1, y - 3, 2, 1); // stem
    if (f > 0.5) { g.fillStyle = "#ffd0e4"; g.fillRect(fx + 1, y + 4, 1, 1); } // fresh sheen
  }

  private drawExtraction(raid: Raid, ox: number, oy: number) {
    const g = this.ctx, e = raid.map.extraction;
    if (e.r <= 0) return;
    const cx = Math.round(e.x * TILE - ox), cy = Math.round(e.y * TILE - oy), R = Math.round(e.r * TILE);
    const pulse = 0.5 + 0.3 * Math.sin(this.t * 3), prog = raid.extractProgress;
    g.fillStyle = `rgba(143,224,138,${(0.08 + 0.25 * prog).toFixed(3)})`;
    for (let dy = -R; dy <= R; dy++) { const w = Math.floor(Math.sqrt(R * R - dy * dy)); g.fillRect(cx - w, cy + dy, w * 2, 1); }
    g.fillStyle = `rgba(143,224,138,${pulse.toFixed(3)})`;
    const n = Math.ceil(R * 6.3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 2, 1);
      g.fillRect(Math.round(cx + Math.cos(a) * (R - 3)), Math.round(cy + Math.sin(a) * (R - 3)), 1, 1);
    }
  }

  /** physiology: faint dotted ring of the aggro radius around nearby crawlers. */
  private drawAggro(raid: Raid, ox: number, oy: number) {
    const g = this.ctx, p = raid.player.pos, R = RAID.crawler.aggro * TILE;
    g.fillStyle = "rgba(255,225,150,0.6)";
    for (const c of raid.crawlers) {
      if (!c.alive || Math.hypot(c.pos.x - p.x, c.pos.y - p.y) > 12) continue;
      const cx = c.pos.x * TILE - ox, cy = c.pos.y * TILE - oy + 3;
      if (cx + R < 0 || cx - R > this.W || cy + R < 0 || cy - R > this.H) continue;
      const n = 360, rot = this.t * 0.15;
      for (let i = 0; i < n; i++) {
        if (i % 8 > 2) continue;
        const a = (i / n) * Math.PI * 2 + rot, x = Math.round(cx + Math.cos(a) * R), y = Math.round(cy + Math.sin(a) * R);
        if (x >= 0 && x < this.W && y >= 0 && y < this.H) g.fillRect(x, y, 2, 2);
      }
    }
  }

  // ---------------------------------------------------------------- effects
  private spawn(x: number, y: number, n: number, colors: string[], speed: number, life: number, opt: { g?: number; size?: number; up?: number } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (opt.up ?? 0), g: opt.g ?? 0,
        life: life * (0.6 + Math.random() * 0.6), max: life, color: colors[i % colors.length], size: opt.size ?? 1,
      });
    }
  }

  private consumeEvents(raid: Raid) {
    for (const e of raid.events) {
      const x = e.x * TILE, y = e.y * TILE;
      switch (e.kind) {
        case "shot": {
          const f = raid.player.facing;
          this.spawn(x + f.x * 9, y - 6 + f.y * 9, 4, ["#fff4c0", "#ffd36b"], 40, 0.07, { size: 2 });
          break;
        }
        case "hit": {
          let best: Crawler | null = null, bd = 0.8;
          for (const c of raid.crawlers) { const d = Math.hypot(c.pos.x - e.x, c.pos.y - e.y); if (d < bd) { bd = d; best = c; } }
          if (best) this.hitUntil.set(best, this.t + 0.1);
          this.spawn(x, y - 4, 6, ["#fff4c0", "#ffb36b", "#ffffff"], 55, 0.25, { g: 120 });
          break;
        }
        case "kill": this.spawn(x, y - 4, 16, ["#8a4a3a", "#5a2d2a", "#ffb36b", "#fff4c0"], 70, 0.5, { g: 140, size: 2 }); break;
        case "pickup": this.spawn(x, y - 4, 10, ["#6fe0d0", "#c9fff4"], 30, 0.6, { g: -40, up: 10 }); break;
        case "hurt": this.flash = 0.3; break;
        case "dash": {
          // puff + streak trailing behind the direction of travel
          const v = raid.player.vel, l = Math.hypot(v.x, v.y) || 1, bx = -v.x / l, by = -v.y / l;
          for (let i = 0; i < 7; i++) {
            const d = 4 + i * 3;
            this.particles.push({ x: x + bx * d, y: y - 3 + by * d, vx: bx * 12, vy: by * 12 - 4, g: 0, life: 0.28 + i * 0.03, max: 0.5, color: i < 3 ? "#ffffff" : "#c9e6f0", size: i < 4 ? 2 : 1 });
          }
          break;
        }
        case "fall": this.fallers.push({ x, y, t: 0, seed: this.fallers.length }); break;
        case "wall": this.spawn(x, y, 4, [ROCK[4], ROCK[3]], 22, 0.3, { size: 2 }); break;
      }
    }
    raid.events.length = 0;
  }

  private tickParticles(dt: number, ox: number, oy: number) {
    const g = this.ctx;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const f of this.fallers) f.t += dt;
    this.fallers = this.fallers.filter((f) => f.t < 0.7);
    for (const p of this.particles) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x - ox), Math.round(p.y - oy), p.size, p.size);
    }
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
  /** busy: the player is giving move/fire input (or a panel is open), which cancels the lookout. */
  draw(raid: Raid, dt: number, busy = false, lookoutOn = false) {
    this.t += dt;
    if (lookoutOn) this.updateLookout(raid, dt, busy); else { this.lookRaw = this.lookout = this.still = 0; }
    this.layout(Math.round(VIEW_H * (1 + (LOOK_ZOOM - 1) * this.lookout)));
    const g = this.ctx, W = this.W, H = this.H;
    if (this.groundFor !== raid.map || !this.ground) this.buildGround(raid.map);
    const tgt = this.camTarget(raid), k = 1 - Math.exp(-dt * 8);
    tgt.x += this.lookDir.x * LOOK_PAN * this.lookout; tgt.y += this.lookDir.y * LOOK_PAN * this.lookout;
    this.camX += (tgt.x - this.camX) * k; this.camY += (tgt.y - this.camY) * k;
    const ox = Math.round(this.camX), oy = Math.round(this.camY);

    // vista: drawn in a fixed 180 px tall space, then scaled to the (zoomed) view without smoothing
    const Wv = Math.ceil((W * VISTA_H) / H), vc = this.vistaCv;
    if (vc.width !== Wv || vc.height !== VISTA_H) { vc.width = Wv; vc.height = VISTA_H; }
    const labels = this.vista.draw(vc.getContext("2d")!, Wv, {
      cx: Math.round(ox + W / 2 - Wv / 2), cy: Math.round(oy + H / 2 - VISTA_H / 2), t: this.t, daylight: raid.daylight, known: raid.knowledge, look: this.lookout,
      isVoid: (x, y) => this.isVoidAt(raid, (x * H) / VISTA_H + ox, (y * H) / VISTA_H + oy),
    });
    g.drawImage(vc, 0, 0, Wv, VISTA_H, 0, 0, Math.round((Wv * H) / VISTA_H), H);
    this.checkReveals(raid);
    this.drawLabels(this.voidInView(raid) ? labels : []);
    g.drawImage(this.ground!, -ox, -oy);
    this.drawExtraction(raid, ox, oy);
    this.consumeEvents(raid);

    // entities, sorted by feet y
    const items: Drawable[] = [];
    const vis = (x: number, y: number) => x - ox > -20 && x - ox < W + 20 && y - oy > -20 && y - oy < H + 30;
    raid.samples.forEach((s, i) => {
      if (s.taken) return;
      const fx = Math.round(s.pos.x * TILE), fy = Math.round(s.pos.y * TILE) + 3;
      if (vis(fx, fy)) items.push({ y: fy, draw: () => this.drawSample(fx - ox, fy - oy, i, s.item) });
    });
    for (const c of raid.crawlers) {
      if (!c.alive) continue;
      const fx = Math.round(c.pos.x * TILE), fy = Math.round(c.pos.y * TILE) + 3;
      if (vis(fx, fy)) items.push({ y: fy, draw: () => this.drawCrawler(c, fx - ox, fy - oy, (this.hitUntil.get(c) ?? 0) > this.t) });
    }
    for (const b of raid.bullets) {
      const bx = Math.round(b.pos.x * TILE), by = Math.round(b.pos.y * TILE);
      if (vis(bx, by)) items.push({ y: by, draw: () => this.drawBullet(raid.weaponKind, b, bx - ox, by - oy) });
    }
    for (const f of this.fallers) {
      const fx = Math.round(f.x), fy = Math.round(f.y) + 3;
      items.push({ y: fy, draw: () => this.drawFaller(f, fx - ox, fy - oy) });
    }
    {
      const fx = Math.round(raid.player.pos.x * TILE), fy = Math.round(raid.player.pos.y * TILE) + 5;
      items.push({ y: fy, draw: () => this.drawPlayer(raid, fx - ox, fy - oy) });
    }
    items.sort((a, b) => a.y - b.y);

    const m = raid.map;
    const r0 = Math.max(0, Math.floor(oy / TILE) - 1), r1 = Math.min(m.h - 1, Math.floor((oy + H) / TILE) + 1);
    const c0 = Math.max(0, Math.floor(ox / TILE) - 1), c1 = Math.min(m.w - 1, Math.floor((ox + W) / TILE) + 1);
    let idx = 0;
    for (let ty = r0; ty <= r1; ty++) {
      const row = m.rows[ty];
      for (let tx = c0; tx <= c1; tx++) if (row[tx] === "#") this.drawRock(raid, tx, ty, ox, oy);
      while (idx < items.length && Math.floor(items[idx].y / TILE) <= ty) items[idx++].draw();
    }
    while (idx < items.length) items[idx++].draw();

    this.drawBeam(raid, ox, oy);
    if (raid.knowledge.has("physiology")) this.drawAggro(raid, ox, oy);
    this.tickParticles(dt, ox, oy);
    this.tint(raid.daylight);
    if (this.flash > 0) {
      g.fillStyle = `rgba(230,40,40,${(Math.min(1, this.flash / 0.3) * 0.4).toFixed(3)})`;
      g.fillRect(0, 0, W, H);
      this.flash -= dt;
    }
  }
}
