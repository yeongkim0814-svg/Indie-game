import { RAID, type Raid } from "../game/raid";
import { FLOWER, GRASS, ROCK, hash2 } from "../view/palette";
import { Fb, hexN, mixC } from "./raster";
import { PITCH_ISO, PITCH_SIDE, depthOf, faceVisible, project, screenRight, type View } from "./project";
import { ROCK_H, SLAB_D, TILES } from "./world";

const G = GRASS.map(hexN);
const R = ROCK.map(hexN);
const SLAB_SIDE = mixC(R[3], R[4], 0.45); // lit cliff stone
const SLAB_HATCH = mixC(R[2], R[0], 0.4); // dark diagonal strokes
const GEM: Record<string, number> = { quartz: 0x6fe0d0, ore: 0xc8e05a, bio: 0xc06090 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface SceneFrame { raid: Raid; view: View; focus: { x: number; y: number }; t: number }
interface Item { key: number; draw: () => void }
const SIDES: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]]; // outward normals S N E W

function cross(o: number[], a: number[], b: number[]) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
function hull(pts: number[][]): number[][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function inside(poly: number[][], x: number, y: number) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

/**
 * Builds the frame as faces (top + camera-facing sides of every slab / rock box) and billboards, sorts by depth
 * (painter's algorithm) and rasterises them into a low-res framebuffer. Boxes are sorted per tile by the depth of
 * their base centre; ground slabs first (they never cover anything standing on them), then rocks + entities together.
 */
export class Scene {
  fb = new Fb(320, 180);
  private cv = document.createElement("canvas");
  /** rocks currently drawn see-through (for tests / debugging) */
  seeThrough = 0;

  resize(w: number, h: number) {
    this.fb = new Fb(w, h);
    this.cv.width = w; this.cv.height = h;
  }

  render(g: CanvasRenderingContext2D, f: SceneFrame) {
    const { raid, view: v } = f, fb = this.fb, W = fb.w, H = fb.h;
    fb.clear();
    const pr = { sx: 0, sy: 0, depth: 0 };
    const f0 = project(v, f.focus.x, f.focus.y, 0, pr);
    const offX = Math.round(f0.sx - W / 2), offY = Math.round(f0.sy - H * 0.6);
    const scr = (x: number, y: number, z: number): [number, number] => { project(v, x, y, z, pr); return [pr.sx - offX, pr.sy - offY]; };
    const pitchK = clamp((v.pitch - PITCH_SIDE) / (PITCH_ISO - PITCH_SIDE), 0, 1);

    const face = (p: number[], col: number, a = 1, hatch?: number, lip?: number, width = 1, dither = false) => {
      const sp: number[] = [];
      for (let k = 0; k < 4; k++) { const q = scr(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]); sp.push(Math.round(q[0]), Math.round(q[1])); }
      fb.poly(sp, col, a, hatch === undefined ? undefined : { col: hatch, ox: sp[0], oy: sp[1], width }, dither);
      if (lip !== undefined) { fb.line(sp[0], sp[1], sp[2], sp[3], lip, a); fb.line(sp[0], sp[1] + 1, sp[2], sp[3] + 1, mixC(lip, G[2], 0.5), a); } // grassy lit lip
    };
    const sideCol = (base: number, nx: number, ny: number) => mixC(base, R[0], clamp(0.28 + 0.14 * screenRight(v, nx, ny), 0.1, 0.5));
    /** vertical quad on a box side; n is the outward normal */
    const side = (tx: number, ty: number, n: [number, number, number], z0: number, z1: number, col: number, a: number, hatch?: number, lip?: number, width = 1, dither = false) => {
      const [nx, ny] = n;
      const x0 = tx + (nx > 0 ? 1 : 0), y0 = ty + (ny > 0 ? 1 : 0);
      const dx = ny !== 0 ? 1 : 0, dy = nx !== 0 ? 1 : 0;
      face([x0, y0, z1, x0 + dx, y0 + dy, z1, x0 + dx, y0 + dy, z0, x0, y0, z0], sideCol(col, nx, ny), a, hatch === undefined ? undefined : sideCol(hatch, nx, ny), lip, width, dither);
    };
    const top = (tx: number, ty: number, z: number, col: number, dither = false) => face([tx, ty, z, tx + 1, ty, z, tx + 1, ty + 1, z, tx, ty + 1, z], col, 1, undefined, undefined, 1, dither);
    const tileCh = (x: number, y: number) => TILES[y]?.[x] ?? "~";

    // ---- tiles in view
    const slabs: { tx: number; ty: number; ch: string; d: number }[] = [];
    const rocks: { tx: number; ty: number; d: number; sx: number; sy: number }[] = [];
    for (let ty = 0; ty < TILES.length; ty++) for (let tx = 0; tx < TILES[ty].length; tx++) {
      const ch = TILES[ty][tx];
      if (ch === "~") continue;
      const [sx, sy] = scr(tx + 0.5, ty + 0.5, 0);
      if (sx < -50 || sx > W + 50 || sy < -60 || sy > H + 70) continue;
      const d = depthOf(v, tx + 0.5, ty + 0.5, 0);
      slabs.push({ tx, ty, ch, d });
      if (ch === "#") rocks.push({ tx, ty, d, sx, sy });
    }
    slabs.sort((a, b) => a.d - b.d);

    // ---- layer 1: ground slabs (cliff faces + tops)
    for (const { tx, ty, ch } of slabs) {
      for (const n of SIDES) {
        if (!faceVisible(v, n[0], n[1], 0) || tileCh(tx + n[0], ty + n[1]) !== "~") continue;
        side(tx, ty, n, -SLAB_D, 0, SLAB_SIDE, 1, SLAB_HATCH, G[4], 2);
      }
      if (!faceVisible(v, 0, 0, 1)) continue;
      const h = hash2(tx, ty, 1);
      if (ch === "=") top(tx, ty, 0, [R[3], mixC(R[3], R[4], 0.45), mixC(R[2], R[3], 0.55)][Math.floor(h * 3)]);
      else top(tx, ty, 0, [G[2], mixC(G[2], G[3], 0.5), G[3], mixC(G[3], G[4], 0.3)][Math.floor(h * 4)]);
      if (ch === "." && pitchK > 0.3) { // tufts and the odd flower, so the grass is not flat
        for (let k = 0; k < 3; k++) {
          const [sx, sy] = scr(tx + 0.12 + 0.76 * hash2(tx, ty, 10 + k), ty + 0.12 + 0.76 * hash2(tx, ty, 20 + k), 0);
          fb.px(sx, sy, k === 0 ? G[4] : G[1]);
          if (k === 0) fb.px(sx, sy - 1, G[3]);
        }
        if (hash2(tx, ty, 99) > 0.93) fb.px(...scr(tx + 0.5, ty + 0.5, 0), hexN(FLOWER));
      }
    }

    // ---- extraction ring on the ground
    const ex = raid.map.extraction;
    if (ex.r > 0) this.ring(scr, ex, raid.extractProgress, f.t);

    // ---- see-through test: rocks in front of the player or a nearby crawler that cover it on screen
    const p = raid.player.pos;
    const targets = [{ x: p.x, y: p.y }, ...raid.crawlers.filter((c) => c.alive && Math.hypot(c.pos.x - p.x, c.pos.y - p.y) < 10).map((c) => c.pos)];
    const tdata = targets.map((t) => {
      const [sx, sy] = scr(t.x, t.y, 0);
      const pts: number[][] = [];
      for (const dx of [-6, 0, 6]) for (const dy of [0, -11, -22]) pts.push([sx + dx, sy + dy]);
      return { d: depthOf(v, t.x, t.y, 0), pts };
    });
    const see = new Map<string, number[][]>();
    for (const r of rocks) {
      if (pitchK < 0.05) break;
      const corners: number[][] = [];
      for (const z of [0, ROCK_H]) for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) corners.push(scr(r.tx + dx, r.ty + dy, z));
      const hl = hull(corners);
      if (tdata.some((t) => r.d > t.d + 0.01 && t.pts.some(([x, y]) => inside(hl, x, y)))) see.set(r.tx + "," + r.ty, hl);
    }
    this.seeThrough = see.size;

    // ---- layer 2: rocks and billboards, one painter's sort
    const items: Item[] = [];
    for (const r of rocks) {
      const outline = see.get(r.tx + "," + r.ty), a = 1, dither = !!outline;
      items.push({ key: r.d, draw: () => {
        const { tx, ty } = r;
        const h = hash2(tx, ty, 5);
        const base = R[3], tcol = [R[4], mixC(R[3], R[4], 0.6), mixC(R[4], hexN("#a3cfe3"), 0.15)][Math.floor(h * 3)];
        for (const n of SIDES) {
          if (!faceVisible(v, n[0], n[1], 0) || tileCh(tx + n[0], ty + n[1]) === "#") continue;
          side(tx, ty, n, 0, ROCK_H, base, a, mixC(base, R[1], 0.5), undefined, 1, dither);
        }
        if (faceVisible(v, 0, 0, 1)) top(tx, ty, ROCK_H, tcol, dither);
        if (outline) for (let i = 0; i < outline.length; i++) { const p0 = outline[i], p1 = outline[(i + 1) % outline.length]; fb.line(p0[0], p0[1], p1[0], p1[1], 0xcfe6ee); }
      } });
    }
    const feet = (x: number, y: number, z = 0): [number, number] => { const [sx, sy] = scr(x, y, z); return [Math.round(sx), Math.round(sy)]; };
    const shadow = (sx: number, sy: number, rx: number) => {
      const ry = Math.max(1, Math.round(rx * 0.5 * Math.max(0.35, v.sp * 2)));
      for (let dy = -ry; dy <= ry; dy++) { const hw = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2)); fb.rect(sx - hw, sy + dy, hw * 2, 1, R[0], 0.45); }
    };
    raid.samples.forEach((s, i) => {
      if (s.taken) return;
      const [sx, sy] = feet(s.pos.x, s.pos.y);
      if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 30) return;
      items.push({ key: depthOf(v, s.pos.x, s.pos.y, 0), draw: () => {
        shadow(sx, sy, 4);
        const bob = Math.round(Math.sin(f.t * 3 + i) * 1.5), c = GEM[s.item.kind] ?? 0xffffff, y = sy - 7 + bob;
        fb.rect(sx - 1, y - 3, 3, 1, mixC(c, 0xffffff, 0.5)); fb.rect(sx - 2, y - 2, 5, 1, c); fb.rect(sx - 3, y - 1, 7, 2, c);
        fb.rect(sx - 2, y + 1, 5, 1, mixC(c, R[0], 0.35)); fb.rect(sx - 1, y + 2, 3, 1, mixC(c, R[0], 0.5));
      } });
    });
    for (const c of raid.crawlers) {
      if (!c.alive) continue;
      const [sx, sy0] = feet(c.pos.x, c.pos.y);
      if (sx < -10 || sx > W + 10 || sy0 < -10 || sy0 > H + 30) continue;
      items.push({ key: depthOf(v, c.pos.x, c.pos.y, 0), draw: () => {
        shadow(sx, sy0, 6);
        const lift = c.airborne > 0 ? Math.round(5 * Math.sin(Math.PI * Math.min(1, 1 - c.airborne / RAID.crawler.knockAir))) : 0;
        const sy = sy0 - lift, step = Math.floor(f.t * 8 + c.pos.x * 3) & 1;
        for (let i = 0; i < 3; i++) { const ly = sy - 6 + i * 2 + (step && i === 1 ? 1 : 0); fb.rect(sx - 6, ly, 2, 1, 0x2b1514); fb.rect(sx + 4, ly, 2, 1, 0x2b1514); }
        fb.rect(sx - 5, sy - 6, 10, 5, 0x5a2d2a); fb.rect(sx - 3, sy - 8, 6, 1, 0x5a2d2a); fb.rect(sx - 4, sy - 2, 8, 1, 0x5a2d2a);
        fb.rect(sx - 4, sy - 7, 8, 2, 0x8a4a3a); fb.rect(sx, sy - 5, 1, 4, 0x8a4a3a);
        fb.px(sx - 2, sy - 6, 0xf2c14e); fb.px(sx + 1, sy - 6, 0xf2c14e);
      } });
    }
    for (const b of raid.bullets) {
      const [sx, sy] = feet(b.pos.x, b.pos.y, 0.8);
      items.push({ key: depthOf(v, b.pos.x, b.pos.y, 0), draw: () => { fb.rect(sx - 1, sy - 1, 3, 3, 0xfff4c0); fb.px(sx, sy, 0xffffff); } });
    }
    {
      const pl = raid.player, [sx, sy] = feet(pl.pos.x, pl.pos.y);
      items.push({ key: depthOf(v, pl.pos.x, pl.pos.y, 0), draw: () => {
        const dir = screenRight(v, pl.facing.x, pl.facing.y) >= 0 ? 1 : -1;
        const moving = Math.hypot(pl.vel.x, pl.vel.y) > 0.4, step = moving ? Math.floor(f.t * 9) & 1 : 0;
        const dark = 0x142633, mid = 0x24405a;
        shadow(sx, sy, 7);
        fb.rect(sx - 4, sy - 5 - step, 3, 5 + step, dark); fb.rect(sx + 1, sy - 5 - (1 - step) * (moving ? 1 : 0), 3, 5, dark);
        fb.rect(sx - dir * 7 - (dir > 0 ? 0 : 3), sy - 14, 4, 8, R[3]); fb.rect(sx - dir * 7 - (dir > 0 ? 0 : 3), sy - 8, 4, 2, R[1]);
        fb.rect(sx - 5, sy - 15, 10, 10, dark); fb.rect(sx - 5, sy - 15, 10, 2, mid); fb.rect(sx + (dir > 0 ? 3 : -5), sy - 13, 2, 7, mid);
        fb.rect(sx - 4, sy - 22, 8, 7, dark); fb.rect(sx - 4, sy - 22, 8, 1, mid); fb.rect(sx - 3, sy - 23, 6, 1, mid);
        fb.rect(sx + (dir > 0 ? 1 : -4), sy - 19, 3, 1, 0x6fe0d0);
        // gun toward facing, projected onto the screen
        const fx = pl.facing.x, fy = pl.facing.y, gx = screenRight(v, fx, fy), gy = (-fx * v.s + fy * v.c) * v.sp;
        for (let i = 4; i <= 11; i++) fb.rect(sx + gx * i, sy - 10 + gy * i, 2, 2, R[4]);
      } });
    }
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw();


    this.cv.getContext("2d")!.putImageData(fb.img, 0, 0);
    g.drawImage(this.cv, 0, 0);
  }

  private ring(scr: (x: number, y: number, z: number) => [number, number], ex: { x: number; y: number; r: number }, prog: number, t: number) {
    const fb = this.fb, n = 40, pts: number[] = [], edge: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, q = scr(ex.x + Math.cos(a) * ex.r, ex.y + Math.sin(a) * ex.r, 0);
      pts.push(q[0], q[1]); edge.push(q);
    }
    fb.poly(pts, 0x8fe08a, 0.16 + 0.07 * Math.sin(t * 3));
    for (let i = 0; i < n; i++) {
      const [a, b] = [edge[i], edge[(i + 1) % n]], lit = i / n < prog;
      fb.line(a[0], a[1], b[0], b[1], lit ? 0xffffff : 0x8fe08a, lit ? 1 : 0.85);
    }
  }
}
