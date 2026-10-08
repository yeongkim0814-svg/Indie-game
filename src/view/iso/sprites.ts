/** Billboard sprites (the old top-down art, unchanged in pixels) drawn into the frame buffer at a projected foot point. */
import { ITEMS, itemValue, type Item } from "../../game/items";
import type { Raid } from "../../game/raid";
import { Fb, mixC } from "./raster";
import { screenRight, type View } from "./project";
import { R } from "./terrain";

const SHADOW_COL = R[0];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Soft elliptical ground shadow; flatter when the camera is low. */
export function shadow(fb: Fb, v: View, sx: number, sy: number, rx: number, a = 0.45) {
  const ry = Math.max(1, Math.round(rx * 0.5 * Math.max(0.35, v.sp * 2)));
  for (let dy = -ry; dy <= ry; dy++) { const hw = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2)); fb.rect(sx - hw, sy + dy, hw * 2, 1, SHADOW_COL, a); }
}

export function drawCrawler(fb: Fb, sx: number, sy: number, t: number, seed: number, flash: boolean, a = 1) {
  const r = (x: number, y: number, w: number, h: number, c: number) => fb.rect(x, y, w, h, flash ? 0xffffff : c, a);
  const step = Math.floor(t * 8 + seed * 3) & 1;
  for (let i = 0; i < 3; i++) { const ly = sy - 6 + i * 2 + (step && i === 1 ? 1 : 0); r(sx - 6, ly, 2, 1, 0x2b1514); r(sx + 4, ly, 2, 1, 0x2b1514); }
  r(sx - 5, sy - 6, 10, 5, 0x5a2d2a); r(sx - 3, sy - 8, 6, 1, 0x5a2d2a); r(sx - 4, sy - 2, 8, 1, 0x5a2d2a);
  r(sx - 4, sy - 7, 8, 2, 0x8a4a3a); r(sx, sy - 5, 1, 4, 0x8a4a3a);
  fb.px(sx - 2, sy - 6, flash ? 0xffffff : 0xf2c14e, a); fb.px(sx + 1, sy - 6, flash ? 0xffffff : 0xf2c14e, a);
}

const GUN_COL: Record<string, number> = { rifle: R[4], launcher: 0xe69a55, lens: 0xffe08a, coilgun: 0x6fe8ff };

/** The 23-px hooded explorer; the gun line follows the facing, projected onto the screen. */
export function drawPlayer(fb: Fb, v: View, raid: Raid, sx: number, sy: number, t: number) {
  const pl = raid.player;
  const dir = screenRight(v, pl.facing.x, pl.facing.y) >= 0 ? 1 : -1;
  const moving = Math.hypot(pl.vel.x, pl.vel.y) > 0.4, step = moving ? Math.floor(t * 9) & 1 : 0;
  const dark = 0x142633, mid = 0x24405a;
  shadow(fb, v, sx, sy, 7);
  fb.rect(sx - 4, sy - 5 - step, 3, 5 + step, dark); fb.rect(sx + 1, sy - 5 - (1 - step) * (moving ? 1 : 0), 3, 5, dark);
  fb.rect(sx - dir * 7 - (dir > 0 ? 0 : 3), sy - 14, 4, 8, 0x3b4d56); fb.rect(sx - dir * 7 - (dir > 0 ? 0 : 3), sy - 8, 4, 2, 0x1b2e39);
  fb.rect(sx - 5, sy - 15, 10, 10, dark); fb.rect(sx - 5, sy - 15, 10, 2, mid); fb.rect(sx + (dir > 0 ? 3 : -5), sy - 13, 2, 7, mid);
  fb.rect(sx - 4, sy - 22, 8, 7, dark); fb.rect(sx - 4, sy - 22, 8, 1, mid); fb.rect(sx - 3, sy - 23, 6, 1, mid);
  fb.rect(sx + (dir > 0 ? 1 : -4), sy - 19, 3, 1, 0x6fe0d0);
  const fx = pl.facing.x, fy = pl.facing.y, gx = screenRight(v, fx, fy), gy = (-fx * v.s + fy * v.c) * v.sp;
  const col = GUN_COL[raid.weaponKind] ?? R[4], gs = raid.weaponKind === "launcher" ? 3 : 2;
  for (let i = 4; i <= 11; i++) fb.rect(Math.round(sx + gx * i), Math.round(sy - 10 + gy * i), gs, gs, col);
}

/** Ground samples: quartz gem, radioactive ore (glow fades with decay), biological pod (browns as it rots), gear cache. */
export function drawSample(fb: Fb, v: View, sx: number, sy: number, k: number, it: Item, t: number) {
  if (it.kind === "ore") return drawOre(fb, v, sx, sy, k, it, t);
  if (it.kind === "bio") return drawBio(fb, v, sx, sy, k, it, t);
  if (ITEMS[it.kind].gear) return drawCache(fb, v, sx, sy, it);
  const bob = Math.round(Math.sin(t * 3 + k * 1.7) * 1.5), y = sy - 7 + bob;
  shadow(fb, v, sx, sy, 3);
  fb.rect(sx - 1, y, 2, 1, 0x6fe0d0); fb.rect(sx - 2, y + 1, 4, 1, 0x6fe0d0); fb.rect(sx - 3, y + 2, 6, 2, 0x6fe0d0); fb.rect(sx - 2, y + 4, 4, 1, 0x6fe0d0); fb.rect(sx - 1, y + 5, 2, 1, 0x6fe0d0);
  fb.rect(sx - 1, y + 1, 1, 2, 0xc9fff4);
  fb.rect(sx + 1, y + 3, 2, 1, 0x2f8f88); fb.rect(sx, y + 4, 2, 1, 0x2f8f88);
}

function drawOre(fb: Fb, v: View, fx: number, fy: number, k: number, it: Item, t: number) {
  const q = clamp01(itemValue(it) / ITEMS.ore.value);
  shadow(fb, v, fx, fy, 4);
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + k), glow = q * (0.12 + 0.2 * pulse);
  fb.rect(fx - 6, fy - 14, 12, 14, 0xc8e05a, glow); fb.rect(fx - 5, fy - 16, 10, 2, 0xc8e05a, glow);
  const base = 0xc8e05a, lit = mixC(base, 0xf4ffc0, 0.4 + 0.3 * pulse * q), dim = mixC(base, R[2], Math.min(1, 1 - q * 0.8 + 0.1)), dark = mixC(base, R[1], 0.55 + (1 - q) * 0.3);
  fb.rect(fx - 3, fy - 12, 6, 11, dim); fb.rect(fx - 2, fy - 13, 4, 1, dim); fb.rect(fx - 4, fy - 9, 8, 7, dim);
  fb.rect(fx + 1, fy - 10, 3, 9, dark); fb.rect(fx - 4, fy - 3, 8, 2, dark);
  fb.rect(fx - 2, fy - 12, 2, 5, lit); fb.rect(fx - 3, fy - 8, 1, 3, lit);
  fb.rect(fx - 1, fy - 11, 1, 2, 0xf4ffc0);
}

function drawBio(fb: Fb, v: View, fx: number, fy: number, k: number, it: Item, t: number) {
  const f = clamp01(it.fresh), bob = Math.round(Math.sin(t * 2 + k) * 0.8), rot = 1 - f, y = fy - 9 + bob;
  shadow(fb, v, fx, fy, 5);
  const body = mixC(0xc06090, 0x7a5a3a, rot), lit = mixC(0xe890b8, 0xa08460, rot), dark = mixC(0x80305f, 0x4a3624, rot);
  fb.rect(fx - 4, y + 3, 8, 5, dark); fb.rect(fx - 3, y + 8, 6, 1, dark);
  fb.rect(fx - 3, y, 6, 8, body); fb.rect(fx - 4, y + 2, 8, 5, body); fb.rect(fx - 2, y - 1, 4, 1, body);
  fb.rect(fx - 2, y + 1, 2, 3, lit); fb.rect(fx - 3, y + 2, 1, 2, lit);
  const stem = mixC(0x6fe0a0, 0x6a5a30, rot);
  fb.rect(fx, y - 3, 1, 3, stem); fb.rect(fx + 1, y - 3, 2, 1, stem);
  if (f > 0.5) fb.rect(fx + 1, y + 4, 1, 1, 0xffd0e4);
}

/** Dropped / found gear: a small case with a coloured latch. (The old renderer drew gear as a quartz gem.) */
function drawCache(fb: Fb, v: View, fx: number, fy: number, it: Item) {
  const acc = ({ launcher: 0xe69a55, lens: 0xffe08a, coilgun: 0x6fe8ff, battery: 0x6fe0d0, stock: 0x8a9f48, scope: 0xc8e05a } as Record<string, number>)[it.kind] ?? 0xffffff;
  shadow(fb, v, fx, fy, 5);
  fb.rect(fx - 4, fy - 6, 8, 6, R[1]); fb.rect(fx - 4, fy - 7, 8, 1, R[4]); fb.rect(fx - 4, fy - 4, 8, 1, R[3]);
  fb.rect(fx - 1, fy - 5, 2, 3, acc); fb.px(fx - 1, fy - 5, mixC(acc, 0xffffff, 0.5));
}

/** Bullets: rifle = bright pellet; launcher = chunky dark slug with a ground shadow; coilgun = cyan streak along the flight line. */
export function drawBullet(fb: Fb, kind: string, sx: number, sy: number, gx: number, gy: number, streak: [number, number][]) {
  if (kind === "launcher") {
    fb.rect(gx - 1, gy, 4, 1, SHADOW_COL, 0.4);
    fb.rect(sx - 2, sy - 2, 4, 4, 0x1a1412);
    fb.rect(sx - 2, sy - 2, 4, 1, 0x5a4636); fb.rect(sx - 2, sy - 2, 1, 4, 0x5a4636);
    return;
  }
  fb.rect(gx - 1, gy, 2, 1, SHADOW_COL, 0.4);
  if (kind === "coilgun") {
    streak.forEach(([x, y], i) => fb.px(x, y, i === 0 ? 0xffffff : i < 4 ? 0x7ff0ff : 0x2aa8c8));
    return;
  }
  fb.rect(sx - 1, sy - 1, 3, 3, 0xfff4c0); fb.px(sx, sy, 0xffffff);
}

/** Focused sunlight: warm white line from the lens to its target; width and alpha follow the sun. */
export function drawBeam(fb: Fb, x0: number, y0: number, x1: number, y1: number, intensity: number, t: number) {
  const I = clamp01(intensity);
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const w = I > 0.66 ? 3 : I > 0.33 ? 2 : 1, a = 0.3 + 0.7 * I, flick = 0.85 + 0.15 * Math.sin(t * 40);
  for (let pass = 0; pass < 2; pass++) {
    const col = pass === 0 ? 0xffd68c : 0xfff8e0, al = pass === 0 ? a * 0.45 * flick : a * flick;
    const ww = pass === 0 ? w + 2 : w, off = Math.floor(ww / 2);
    for (let i = 0; i <= n; i++) fb.rect(Math.round(x0 + ((x1 - x0) * i) / n) - off, Math.round(y0 + ((y1 - y0) * i) / n) - off, ww, ww, col, al);
  }
  fb.rect(Math.round(x1) - 1, Math.round(y1) - 1, 3, 3, 0xffffff, a); // burn spot on the target
}
