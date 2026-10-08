import { RAID, type Raid } from "../../game/raid";
import { hash2 } from "../palette";
import { Effects, FALL_TIME } from "./effects";
import { Fb, hexN, mixC } from "./raster";
import { PITCH_ISO, YAW_ISO, depthOf, faceVisible, makeView, project, type View } from "./project";
import { drawBeam, drawBullet, drawCrawler, drawPlayer, drawSample, shadow } from "./sprites";
import { MIN_WEIGHT, MapGeo, R, ROCK_H, SIDES, SLAB_D, TerrainCache, bodyWeight, clamp, drawTerrain, fade, makeScr, pitchK, rowWeight, sideFace, topFace, type Band, type Scr, type Tile } from "./terrain";

export interface SceneFrame {
  raid: Raid;
  view: View;
  focus: { x: number; y: number };
  /** renderer clock, seconds (animation phase) */
  t: number;
  /** camera not swinging: the cached terrain may be used */
  settled: boolean;
  fx: Effects;
  /** camera I weight (rig.background) and the lane the side-view band is centred on (null = no ledge seen yet) */
  b: number;
  lane: number | null;
}

/** Keep the view span [off, off + size] inside [min, max]; a map smaller than the view is centred. */
export function clampAxis(off: number, min: number, max: number, size: number): number {
  return max - min <= size ? (min + max) / 2 - size / 2 : clamp(off, min, max - size);
}

/** Screen bounding box of the projected map rectangle (ground plane down to the slab bottom), in projection pixels. */
export function mapBounds(v: View, w: number, h: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pr = { sx: 0, sy: 0, depth: 0 };
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) for (const z of [0, -SLAB_D]) {
    project(v, x, y, z, pr);
    minX = Math.min(minX, pr.sx); maxX = Math.max(maxX, pr.sx); minY = Math.min(minY, pr.sy); maxY = Math.max(maxY, pr.sy);
  }
  return { minX, minY, maxX, maxY };
}

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

const VIEW_II = makeView(YAW_ISO, PITCH_ISO);
interface Item { key: number; draw: () => void }

/**
 * One frame of the raid world, rasterised into a low-res framebuffer. Per frame:
 *   terrain (cached blit while the camera is settled, live-culled during the swing) -> extraction ring / aggro rings ->
 *   rocks + entities in one painter's sort (rocks dither when they hide the player or a crawler) -> beam, particles.
 * Pixels stay straight-alpha RGBA, so the canvas composites them over the painted vista.
 */
export class Scene {
  fb = new Fb(320, 180);
  private cv = document.createElement("canvas");
  private geo: MapGeo | null = null;
  private cache: TerrainCache | null = null;
  /** rocks drawn see-through this frame (tests / debugging) */
  seeThrough = 0;
  offX = 0;
  offY = 0;
  view: View = VIEW_II;
  /** frame time (ms) spent rasterising the last frame, and whether it blitted the cache */
  lastMs = 0;
  usedCache = false;
  private settledFrames = 0;
  private spriteFb = new Fb(1, 1);
  private halfFb = new Fb(1, 1);
  private maskFb = new Fb(1, 1);
  /** ground rows drawn this frame (min / max row index, or null) and fallers drawn this frame; camera I band checks */
  terrainRows: { min: number; max: number } | null = null;
  bandLane: number | null = null;
  /** faller sprite pixels hidden / drawn behind nearer ground since the start (tests: far-edge falls hide, near-edge falls do not) */
  fallerHidden = 0;
  fallerShown = 0;
  /** the view rectangle and the map bounds of the last frame, in projection pixels */
  viewRect = { x0: 0, y0: 0, x1: 0, y1: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };

  resize(w: number, h: number) {
    this.fb = new Fb(w, h);
    this.spriteFb = new Fb(w, h);
    this.maskFb = new Fb(w, h);
    this.cv.width = w; this.cv.height = h;
  }

  get terrainBuilds() { return this.cache?.builds ?? 0; }
  get terrainBuildMs() { return this.cache?.lastBuildMs ?? 0; }

  /** Frame pixel of a world point in the last rendered frame. */
  screenOf(x: number, y: number, z = 0): [number, number] {
    const p = project(this.view, x, y, z);
    return [p.sx - this.offX, p.sy - this.offY];
  }
  /** Is there any terrain / sprite pixel at a frame position? (the painted vista only shows where there is none) */
  opaqueAt(x: number, y: number): boolean {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.fb.w || y >= this.fb.h) return false;
    return (this.fb.u32[y * this.fb.w + x] >>> 24) !== 0;
  }

  present(g: CanvasRenderingContext2D) {
    this.cv.getContext("2d")!.putImageData(this.fb.img, 0, 0);
    g.drawImage(this.cv, 0, 0);
  }

  render(f: SceneFrame) {
    const t0 = performance.now();
    const { raid, view: v, fx } = f, fb = this.fb, W = fb.w, H = fb.h;
    if (!this.geo || this.geo.map !== raid.map) { this.geo = new MapGeo(raid.map); this.cache = new TerrainCache(this.geo); }
    const geo = this.geo, cache = this.cache!;
    fb.clear();
    const f0 = project(v, f.focus.x, f.focus.y, 0);
    // camera clamp: the view stays inside the projected map (a map smaller than the view is centred). Vertically the side view
    // keeps the ledge at a fixed height instead (the vista above and below is the intended backdrop), so that clamp fades in with the swing.
    const bd = mapBounds(v, geo.map.rows[0]?.length ?? 0, geo.map.rows.length);
    const rawX = Math.round(f0.sx - W / 2), rawY = Math.round(f0.sy - H * 0.6);
    const offX = Math.round(clampAxis(rawX, bd.minX, bd.maxX, W));
    const cy = clampAxis(rawY, bd.minY, bd.maxY, H), offY = Math.round(rawY + (cy - rawY) * (1 - f.b));
    this.view = v; this.offX = offX; this.offY = offY;
    this.viewRect = { x0: offX, y0: offY, x1: offX + W, y1: offY + H, ...bd };
    const scr = makeScr(v, offX, offY);
    const k = pitchK(v);
    const band: Band | null = f.lane !== null && f.b > 0.001 ? { lane: f.lane, b: f.b } : null;
    this.bandLane = band ? band.lane : null;

    // ---- terrain
    const cached = f.settled && (!band || band.b >= 0.999);
    this.usedCache = cached;
    if (cached) cache.blit(fb, v, offX, offY, band);
    const rocks: { tile: Tile; d: number; w: number }[] = [];
    const live: Tile[] = [];
    let rowMin = Infinity, rowMax = -Infinity;
    for (const tile of geo.tiles) {
      const rw = rowWeight(band, tile.ty);
      if (rw < MIN_WEIGHT) continue;
      rowMin = Math.min(rowMin, tile.ty); rowMax = Math.max(rowMax, tile.ty);
      const [sx, sy] = scr(tile.tx + 0.5, tile.ty + 0.5, 0);
      if (sx < -50 || sx > W + 50 || sy < -60 || sy > H + 70) continue;
      if (!cached) live.push(tile);
      const bw = bodyWeight(band, tile.ty);
      if (tile.ch === "#" && bw >= MIN_WEIGHT) rocks.push({ tile, d: depthOf(v, tile.tx + 0.5, tile.ty + 0.5, 0), w: bw });
    }
    this.terrainRows = rowMin <= rowMax ? { min: rowMin, max: rowMax } : null;
    if (!cached) this.swingTerrain(v, scr, geo, live, band);

    // ---- ground markings: extraction ring, physiology aggro rings
    const ex = raid.map.extraction;
    if (ex.r > 0) this.ring(scr, ex, raid.extractProgress, f.t);
    const p = raid.player.pos;
    if (raid.knowledge.has("physiology")) this.aggro(scr, raid, f.t);

    // ---- see-through test: rocks in front of the player or a nearby crawler that cover it on screen
    const targets = [{ x: p.x, y: p.y }, ...raid.crawlers.filter((c) => c.alive && Math.hypot(c.pos.x - p.x, c.pos.y - p.y) < 10).map((c) => c.pos)];
    const tdata = targets.map((tg) => {
      const [sx, sy] = scr(tg.x, tg.y, 0);
      const pts: number[][] = [];
      for (const dx of [-6, 0, 6]) for (const dy of [0, -11, -22]) pts.push([sx + dx, sy + dy]);
      return { d: depthOf(v, tg.x, tg.y, 0), pts };
    });
    const see = new Map<number, number[][]>();
    if (k >= 0.05) for (const r of rocks) {
      const { tx, ty } = r.tile, corners: number[][] = [];
      for (const z of [0, ROCK_H]) for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) corners.push(scr(tx + dx, ty + dy, z));
      const hl = hull(corners);
      if (tdata.some((td) => r.d > td.d + 0.01 && td.pts.some(([x, y]) => inside(hl, x, y)))) see.set(ty * 4096 + tx, hl);
    }
    this.seeThrough = see.size;

    // ---- rocks and billboards, one painter's sort
    const items: Item[] = [];
    for (const r of rocks) {
      const { tx, ty } = r.tile, outline = see.get(ty * 4096 + tx), rf = fade(r.w, band);
      if (!rf) continue;
      const dither = !!outline || rf.dither, rw = rf.a;
      items.push({ key: r.d, draw: () => {
        const h = hash2(tx, ty, 5);
        const base = R[3], tcol = [R[4], mixC(R[3], R[4], 0.6), mixC(R[4], hexN("#a3cfe3"), 0.15)][Math.floor(h * 3)];
        for (const n of SIDES) {
          if (!faceVisible(v, n[0], n[1], 0) || geo.ch(tx + n[0], ty + n[1]) === "#") continue;
          sideFace(fb, v, scr, tx, ty, n, 0, ROCK_H, base, rw, mixC(base, R[1], 0.5), undefined, 1, dither);
        }
        if (faceVisible(v, 0, 0, 1)) topFace(fb, scr, tx, ty, ROCK_H, tcol, dither, rw);
        if (outline) for (let i = 0; i < outline.length; i++) { const p0 = outline[i], p1 = outline[(i + 1) % outline.length]; fb.line(p0[0], p0[1], p1[0], p1[1], 0xcfe6ee); }
      } });
    }
    const feet = (x: number, y: number, z = 0): [number, number] => { const q = scr(x, y, z); return [Math.round(q[0]), Math.round(q[1])]; };
    const onScreen = (sx: number, sy: number) => sx >= -12 && sx <= W + 12 && sy >= -12 && sy <= H + 30;
    raid.samples.forEach((s, i) => {
      if (s.taken || bodyWeight(band, Math.floor(s.pos.y)) < 0.5) return;
      const [sx, sy] = feet(s.pos.x, s.pos.y);
      if (!onScreen(sx, sy)) return;
      items.push({ key: depthOf(v, s.pos.x, s.pos.y, 0), draw: () => drawSample(fb, v, sx, sy, i, s.item, f.t) });
    });
    for (const c of raid.crawlers) {
      if (!c.alive || bodyWeight(band, Math.floor(c.pos.y)) < 0.5) continue;
      const [sx, sy0] = feet(c.pos.x, c.pos.y);
      if (!onScreen(sx, sy0)) continue;
      items.push({ key: depthOf(v, c.pos.x, c.pos.y, 0), draw: () => {
        shadow(fb, v, sx, sy0, 6);
        const lift = c.airborne > 0 ? Math.round(5 * Math.sin(Math.PI * Math.min(1, 1 - c.airborne / RAID.crawler.knockAir))) : 0;
        drawCrawler(fb, sx, sy0 - lift, f.t, c.pos.x, fx.hitFlash(c, f.t));
      } });
    }
    for (const fl of fx.fallers) {
      if (bodyWeight(band, Math.floor(fl.y)) < 0.5) continue;
      const [sx, sy0] = feet(fl.x, fl.y);
      if (!onScreen(sx, sy0 + 40)) continue;
      items.push({ key: depthOf(v, fl.x, fl.y, 0), draw: () => {
        const kk = fl.t / FALL_TIME, [, sy] = feet(fl.x, fl.y, Effects.fallZ(fl.t));
        this.drawFaller(v, scr, geo, band, fl.x, fl.y, sx, sy, f.t * 2, fl.seed, Math.max(0, 1 - kk * kk));
      } });
    }
    const wk = raid.weaponKind;
    for (const b of raid.bullets) {
      const [sx, sy] = feet(b.pos.x, b.pos.y, 0.7), [gx, gy] = feet(b.pos.x, b.pos.y);
      if (!onScreen(sx, sy)) continue;
      const streak: [number, number][] = [];
      if (wk === "coilgun") {
        const l = Math.hypot(b.vel.x, b.vel.y) || 1;
        for (let i = 0; i < 12; i++) streak.push(feet(b.pos.x - (b.vel.x / l) * (i / 16), b.pos.y - (b.vel.y / l) * (i / 16), 0.7));
      }
      items.push({ key: depthOf(v, b.pos.x, b.pos.y, 0) + 0.02, draw: () => drawBullet(fb, wk, sx, sy, gx, gy, streak) });
    }
    {
      const [sx, sy] = feet(p.x, p.y);
      items.push({ key: depthOf(v, p.x, p.y, 0), draw: () => drawPlayer(fb, v, raid, sx, sy, f.t) });
    }
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw();

    // ---- lens beam at about 1 m, burn spot on the target; particles on top
    if (raid.beam) {
      const a = scr(raid.beam.from.x, raid.beam.from.y, 1.0), b = scr(raid.beam.to.x, raid.beam.to.y, 0.3);
      drawBeam(fb, a[0], a[1], b[0], b[1], raid.beam.intensity, f.t);
    }
    for (const q of fx.particles) {
      const [sx, sy] = scr(q.x, q.y, q.z);
      fb.rect(Math.round(sx), Math.round(sy), q.size, q.size, q.color);
    }

    this.lastMs = performance.now() - t0;
    // warm the other camera's cache on a later frame so the first ledge entry does not hitch
    this.settledFrames = f.settled ? this.settledFrames + 1 : 0;
    if (this.settledFrames === 6 && !band) { // camera I caches are per lane band (small); only camera II is warmed
      if (!cache.has(VIEW_II)) cache.build(VIEW_II);
    }
  }

  /**
   * The swing re-rasterises the whole map every frame, which is what a phone cannot afford. The picture is in motion anyway, so
   * the terrain is painted at half the horizontal resolution (x halved, then every column doubled); sprites stay full resolution.
   */
  private swingTerrain(v: View, scr: Scr, geo: MapGeo, tiles: Tile[], band: Band | null) {
    const fb = this.fb, hw = (fb.w + 1) >> 1;
    if (this.halfFb.w !== hw || this.halfFb.h !== fb.h) this.halfFb = new Fb(hw, fb.h);
    const half = this.halfFb;
    half.clear();
    drawTerrain(half, v, (x, y, z) => { const q = scr(x, y, z); return [q[0] / 2, q[1]]; }, geo, tiles, band, false);
    const src = half.u32, dst = fb.u32, W = fb.w;
    for (let y = 0; y < fb.h; y++) {
      const o = y * W, h = y * hw;
      for (let x = 0; x < W; x++) dst[o + x] = src[h + (x >> 1)];
    }
  }

  /**
   * A crawler dropping off a cliff is below the slab top, so ground nearer to the camera than its column hides it (it fell off the
   * far side), while the cliff face behind it does not (it fell off the near side). It is painted into a scratch buffer and copied
   * over only where none of those nearer tiles has a pixel.
   */
  private drawFaller(v: View, scr: Scr, geo: MapGeo, band: Band | null, x: number, y: number, sx: number, sy: number, t: number, seed: number, a: number) {
    const fb = this.fb, sp = this.spriteFb, mk = this.maskFb, d = depthOf(v, x, y, 0);
    const x0 = Math.max(0, sx - 12), x1 = Math.min(fb.w, sx + 13), y0 = Math.max(0, sy - 30), y1 = Math.min(fb.h, sy + 10);
    if (x1 <= x0 || y1 <= y0) return;
    const near: Tile[] = [];
    for (const tl of geo.tiles) {
      if (depthOf(v, tl.tx + 0.5, tl.ty + 0.5, 0) <= d + 0.01 || rowWeight(band, tl.ty) < MIN_WEIGHT) continue;
      const [tx, ty] = scr(tl.tx + 0.5, tl.ty + 0.5, 0);
      if (tx > x0 - 28 && tx < x1 + 28 && ty > y0 - 14 - SLAB_D * 16 && ty < y1 + 24) near.push(tl);
    }
    for (let yy = y0; yy < y1; yy++) { sp.u32.fill(0, yy * sp.w + x0, yy * sp.w + x1); mk.u32.fill(0, yy * mk.w + x0, yy * mk.w + x1); }
    drawCrawler(sp, sx, sy, t, seed, false, a);
    if (near.length) drawTerrain(mk, v, scr, geo, near, band);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = yy * fb.w + xx, p = sp.u32[i];
      if ((p >>> 24) === 0) continue;
      if ((mk.u32[i] >>> 24) !== 0) { this.fallerHidden++; continue; }
      this.fallerShown++;
      fb.px(xx, yy, ((p & 255) << 16) | (((p >> 8) & 255) << 8) | ((p >> 16) & 255), (p >>> 24) / 255);
    }
  }

  private ring(scr: Scr, ex: { x: number; y: number; r: number }, prog: number, t: number) {
    const fb = this.fb, n = 40, pts: number[] = [], edge: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, q = scr(ex.x + Math.cos(a) * ex.r, ex.y + Math.sin(a) * ex.r, 0);
      pts.push(q[0], q[1]); edge.push(q);
    }
    fb.poly(pts, 0x8fe08a, 0.1 + 0.25 * prog + 0.06 * Math.sin(t * 3));
    for (let i = 0; i < n; i++) {
      const [a, b] = [edge[i], edge[(i + 1) % n]], lit = i / n < prog;
      fb.line(a[0], a[1], b[0], b[1], lit ? 0xffffff : 0x8fe08a, lit ? 1 : 0.5 + 0.3 * Math.sin(t * 3));
    }
  }

  /** physiology: faint dotted ring of the aggro radius (a projected ellipse) painted on the ground around nearby crawlers. */
  private aggro(scr: Scr, raid: Raid, t: number) {
    const fb = this.fb, geo = this.geo!, p = raid.player.pos, R_ = RAID.crawler.aggro, n = 480, rot = t * 0.15;
    for (const c of raid.crawlers) {
      if (!c.alive || Math.hypot(c.pos.x - p.x, c.pos.y - p.y) > 12) continue;
      for (let i = 0; i < n; i++) {
        if (i % 12 > 3) continue;
        const a = (i / n) * Math.PI * 2 + rot, wx = c.pos.x + Math.cos(a) * R_, wy = c.pos.y + Math.sin(a) * R_;
        if (geo.ch(Math.floor(wx), Math.floor(wy)) === "~") continue; // only where there is ground to paint on
        const [x, y] = scr(wx, wy, 0);
        if (x >= -2 && x < fb.w && y >= -2 && y < fb.h) fb.rect(Math.round(x), Math.round(y), 2, 1, 0xffe196, 0.6);
      }
    }
  }
}
