/**
 * Static terrain: ground slabs (grass / ledge tops, hatched cliff faces with a grassy lip, tufts). Rocks are NOT part of it:
 * they are drawn live with the entities so they can be dithered see-through when they hide something.
 *
 * Rasterising every face each frame is what the phone cannot afford, so while the camera is settled the whole map is
 * rasterised once per camera (I / II) into an offscreen buffer ("terrain cache") and blitted with the camera offset. The same
 * `drawTerrain` code paints both the cache and, during the swing, only the tiles in view straight into the frame, so the
 * frame the camera settles on is pixel-identical to the cached one.
 */
import { FLOWER, GRASS, ROCK, hash2 } from "../palette";
import type { ParsedMap } from "../../game/raidMap";
import { Fb, hexN, mixC } from "./raster";
import { PITCH_ISO, PITCH_SIDE, depthOf, faceVisible, project, type View } from "./project";

export const ROCK_H = 1.6; // m
export const SLAB_D = 3; // m, depth of the cliff under every ground tile

export const G = GRASS.map(hexN);
export const R = ROCK.map(hexN);
export const SLAB_SIDE = mixC(R[3], R[4], 0.45); // lit cliff stone
export const SLAB_HATCH = mixC(R[2], R[0], 0.4); // dark diagonal strokes
export const SIDES: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]]; // outward normals S N E W
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const pitchK = (v: View) => clamp((v.pitch - PITCH_SIDE) / (PITCH_ISO - PITCH_SIDE), 0, 1);

export interface Tile { tx: number; ty: number; ch: string }

/**
 * Camera I (side view at 12 degrees) sees every grass row edge-on, so the arenas at the ends of a ledge read as stacked stripes.
 * There only a band of rows around the ledge lane is drawn: it fades out toward the back (north) so the vista shows behind the
 * ledge, and stops short in front (south) so no ground covers the player. `b` is the camera I weight (1 = settled in camera I,
 * 0 = camera II): during the swing the band blends with the full map.
 */
export interface Band { lane: number; b: number }
/** rows with lane - BAND_N <= row centre <= lane + BAND_S are drawn */
export const BAND_N = 3.5, BAND_S = 2.5;
/** Rows nearer than this (south of the lane) never get rocks or entities: they would cover the player. */
export const BAND_FRONT_CLEAR = 1;
/** Opacity of a ground row in the band (1 in the core, fading to 0.2 at the north edge, 0 outside). */
export function bandRowAlpha(ty: number, lane: number): number {
  const d = ty + 0.5 - lane;
  if (d > BAND_S || d < -BAND_N) return 0;
  return d >= -1.5 ? 1 : 1 - (-d - 1.5) * 0.4;
}
/** Weight of a row with the swing blend applied (no band = 1). */
export function rowWeight(band: Band | null, ty: number): number {
  return band ? 1 + (bandRowAlpha(ty, band.lane) - 1) * band.b : 1;
}
/** Weight for rocks and entities: like a ground row, but nothing in front of the lane. */
export function bodyWeight(band: Band | null, ty: number): number {
  if (!band) return 1;
  const a = ty + 0.5 - band.lane > BAND_FRONT_CLEAR ? 0 : bandRowAlpha(ty, band.lane);
  return 1 + (a - 1) * band.b;
}
export const MIN_WEIGHT = 0.04;
/**
 * How a weight w is painted: solid, a checkerboard dither (crisp, pixel-art, and much cheaper than an alpha blend, which matters in
 * the swing), or not at all. Without a band every weight is 1.
 */
export function fade(w: number, band: Band | null): { a: number; dither: boolean } | null {
  if (w < MIN_WEIGHT) return null;
  if (!band || w >= 0.99) return { a: 1, dither: false };
  return w >= 0.35 ? { a: 1, dither: true } : null;
}

/** Per-map tile lists, built once. */
export class MapGeo {
  readonly tiles: Tile[] = []; // every tile that is not void
  readonly rocks: Tile[] = [];
  constructor(readonly map: ParsedMap) {
    map.rows.forEach((row, ty) => [...row].forEach((ch, tx) => {
      if (ch === "~") return;
      const t = { tx, ty, ch };
      this.tiles.push(t);
      if (ch === "#") this.rocks.push(t);
    }));
  }
  /** Tile character; everything outside the map is void. */
  ch(x: number, y: number): string { return this.map.rows[y]?.[x] ?? "~"; }
}

/** Screen-space projector with an integer camera offset (so vertices snap identically in the cache and in the frame). */
export type Scr = (x: number, y: number, z: number) => [number, number];
export function makeScr(v: View, offX: number, offY: number): Scr {
  const pr = { sx: 0, sy: 0, depth: 0 };
  return (x, y, z) => { project(v, x, y, z, pr); return [pr.sx - offX, pr.sy - offY]; };
}

/** A quad from 4 world points (12 numbers), snapped to integer pixels, with optional hatch strokes and a grassy lip on the first edge. */
export function worldFace(fb: Fb, scr: Scr, p: number[], col: number, a = 1, hatch?: number, lip?: number, width = 1, dither = false) {
  const sp: number[] = [];
  for (let k = 0; k < 4; k++) { const q = scr(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]); sp.push(Math.round(q[0]), Math.round(q[1])); }
  fb.poly(sp, col, a, hatch === undefined ? undefined : { col: hatch, ox: sp[0], oy: sp[1], width }, dither);
  if (lip !== undefined) { fb.line(sp[0], sp[1], sp[2], sp[3], lip, a); fb.line(sp[0], sp[1] + 1, sp[2], sp[3] + 1, mixC(lip, G[2], 0.5), a); }
}

/** Shade a side colour by its facing so lit and shadow sides differ. */
export function sideCol(v: View, base: number, nx: number, ny: number) {
  return mixC(base, R[0], clamp(0.28 + 0.14 * (nx * v.c + ny * v.s), 0.1, 0.5));
}

/** Vertical quad on a tile side; n is the outward normal. */
export function sideFace(fb: Fb, v: View, scr: Scr, tx: number, ty: number, n: [number, number, number], z0: number, z1: number, col: number, a: number, hatch?: number, lip?: number, width = 1, dither = false) {
  const [nx, ny] = n;
  const x0 = tx + (nx > 0 ? 1 : 0), y0 = ty + (ny > 0 ? 1 : 0);
  const dx = ny !== 0 ? 1 : 0, dy = nx !== 0 ? 1 : 0;
  worldFace(fb, scr, [x0, y0, z1, x0 + dx, y0 + dy, z1, x0 + dx, y0 + dy, z0, x0, y0, z0], sideCol(v, col, nx, ny), a, hatch === undefined ? undefined : sideCol(v, hatch, nx, ny), lip, width, dither);
}

export function topFace(fb: Fb, scr: Scr, tx: number, ty: number, z: number, col: number, dither = false, a = 1) {
  worldFace(fb, scr, [tx, ty, z, tx + 1, ty, z, tx + 1, ty + 1, z, tx, ty + 1, z], col, a, undefined, undefined, 1, dither);
}

/** Paint ground slabs for `tiles` (any order; sorted far to near here). With a band, rows outside it are skipped and faded rows get alpha. */
export function drawTerrain(fb: Fb, v: View, scr: Scr, geo: MapGeo, tiles: Tile[], band: Band | null = null, detail = true) {
  const k = pitchK(v);
  const list: { t: Tile; d: number; w: number }[] = [];
  for (const t of tiles) {
    const w = rowWeight(band, t.ty);
    if (w >= MIN_WEIGHT) list.push({ t, d: depthOf(v, t.tx + 0.5, t.ty + 0.5, 0), w });
  }
  list.sort((a, b) => a.d - b.d);
  for (const { t: { tx, ty, ch }, w } of list) {
    for (const n of SIDES) {
      if (!faceVisible(v, n[0], n[1], 0)) continue;
      const nch = geo.ch(tx + n[0], ty + n[1]);
      // a face is exposed where the neighbour is void, or (in a band) where the neighbour row is faded out: it becomes the slab edge
      const fd = fade(nch === "~" ? w : Math.max(0, w - rowWeight(band, ty + n[1])), band);
      if (!fd) continue;
      sideFace(fb, v, scr, tx, ty, n, -SLAB_D, 0, SLAB_SIDE, fd.a, SLAB_HATCH, G[4], 2, fd.dither);
    }
    if (!faceVisible(v, 0, 0, 1)) continue;
    const h = hash2(tx, ty, 1), tf = fade(w, band);
    if (!tf) continue;
    if (ch === "=") topFace(fb, scr, tx, ty, 0, [R[3], mixC(R[3], R[4], 0.45), mixC(R[2], R[3], 0.55)][Math.floor(h * 3)], tf.dither, tf.a);
    else topFace(fb, scr, tx, ty, 0, [G[2], mixC(G[2], G[3], 0.5), G[3], mixC(G[3], G[4], 0.3)][Math.floor(h * 4)], tf.dither, tf.a);
    if (detail && ch === "." && k > 0.3 && !tf.dither) { // tufts and the odd flower, so the grass is not flat
      for (let i = 0; i < 3; i++) {
        const [sx, sy] = scr(tx + 0.12 + 0.76 * hash2(tx, ty, 10 + i), ty + 0.12 + 0.76 * hash2(tx, ty, 20 + i), 0);
        fb.px(sx, sy, i === 0 ? G[4] : G[1], tf.a);
        if (i === 0) fb.px(sx, sy - 1, G[3], tf.a);
      }
      if (hash2(tx, ty, 99) > 0.93) fb.px(...scr(tx + 0.5, ty + 0.5, 0), hexN(FLOWER), tf.a);
    }
  }
}

interface Cached { fb: Fb; minX: number; minY: number }

/** Whole-map terrain rasterised once per settled camera, for one map. */
export class TerrainCache {
  private slots = new Map<string, Cached>();
  /** how many times a cache was built (tests / perf readout) and the last build time in ms */
  builds = 0;
  lastBuildMs = 0;

  constructor(readonly geo: MapGeo) {}

  private key(v: View, band: Band | null) { return `${v.yaw.toFixed(5)}/${v.pitch.toFixed(5)}` + (band ? `/L${band.lane}` : ""); }
  has(v: View, band: Band | null = null) { return this.slots.has(this.key(v, band)); }

  /** `band` (camera I settled, b = 1) caches only the rows of that lane's band. */
  build(v: View, band: Band | null = null): Cached {
    const key = this.key(v, band), hit = this.slots.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pr = { sx: 0, sy: 0, depth: 0 };
    const tiles = band ? this.geo.tiles.filter((t) => rowWeight(band, t.ty) >= MIN_WEIGHT) : this.geo.tiles;
    if (!tiles.length) tiles.push({ tx: 0, ty: 0, ch: "~" });
    for (const { tx, ty } of tiles) for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) for (const z of [0, -SLAB_D]) {
      project(v, tx + dx, ty + dy, z, pr);
      minX = Math.min(minX, pr.sx); maxX = Math.max(maxX, pr.sx); minY = Math.min(minY, pr.sy); maxY = Math.max(maxY, pr.sy);
    }
    minX = Math.floor(minX) - 2; minY = Math.floor(minY) - 2;
    const fb = new Fb(Math.ceil(maxX) + 3 - minX, Math.ceil(maxY) + 3 - minY);
    drawTerrain(fb, v, makeScr(v, minX, minY), this.geo, tiles, band);
    const c = { fb, minX, minY };
    this.slots.set(key, c);
    this.builds++;
    this.lastBuildMs = performance.now() - t0;
    return c;
  }

  /** Copy the cached terrain into `dst`; frame pixel = project(...) - (offX, offY). */
  blit(dst: Fb, v: View, offX: number, offY: number, band: Band | null = null) {
    const c = this.build(v, band), dx = c.minX - offX, dy = c.minY - offY;
    const x0 = Math.max(0, dx), x1 = Math.min(dst.w, dx + c.fb.w);
    if (x1 <= x0) return;
    for (let y = Math.max(0, dy); y < Math.min(dst.h, dy + c.fb.h); y++) {
      const s = (y - dy) * c.fb.w + (x0 - dx);
      dst.u32.set(c.fb.u32.subarray(s, s + (x1 - x0)), y * dst.w + x0);
    }
  }
}
