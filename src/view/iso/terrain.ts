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

export function topFace(fb: Fb, scr: Scr, tx: number, ty: number, z: number, col: number, dither = false) {
  worldFace(fb, scr, [tx, ty, z, tx + 1, ty, z, tx + 1, ty + 1, z, tx, ty + 1, z], col, 1, undefined, undefined, 1, dither);
}

/** Paint ground slabs for `tiles` (any order; sorted far to near here). */
export function drawTerrain(fb: Fb, v: View, scr: Scr, geo: MapGeo, tiles: Tile[]) {
  const k = pitchK(v);
  const list = tiles.map((t) => ({ t, d: depthOf(v, t.tx + 0.5, t.ty + 0.5, 0) }));
  list.sort((a, b) => a.d - b.d);
  for (const { t: { tx, ty, ch } } of list) {
    for (const n of SIDES) {
      if (!faceVisible(v, n[0], n[1], 0) || geo.ch(tx + n[0], ty + n[1]) !== "~") continue;
      sideFace(fb, v, scr, tx, ty, n, -SLAB_D, 0, SLAB_SIDE, 1, SLAB_HATCH, G[4], 2);
    }
    if (!faceVisible(v, 0, 0, 1)) continue;
    const h = hash2(tx, ty, 1);
    if (ch === "=") topFace(fb, scr, tx, ty, 0, [R[3], mixC(R[3], R[4], 0.45), mixC(R[2], R[3], 0.55)][Math.floor(h * 3)]);
    else topFace(fb, scr, tx, ty, 0, [G[2], mixC(G[2], G[3], 0.5), G[3], mixC(G[3], G[4], 0.3)][Math.floor(h * 4)]);
    if (ch === "." && k > 0.3) { // tufts and the odd flower, so the grass is not flat
      for (let i = 0; i < 3; i++) {
        const [sx, sy] = scr(tx + 0.12 + 0.76 * hash2(tx, ty, 10 + i), ty + 0.12 + 0.76 * hash2(tx, ty, 20 + i), 0);
        fb.px(sx, sy, i === 0 ? G[4] : G[1]);
        if (i === 0) fb.px(sx, sy - 1, G[3]);
      }
      if (hash2(tx, ty, 99) > 0.93) fb.px(...scr(tx + 0.5, ty + 0.5, 0), hexN(FLOWER));
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

  private key(v: View) { return `${v.yaw.toFixed(5)}/${v.pitch.toFixed(5)}`; }
  has(v: View) { return this.slots.has(this.key(v)); }

  build(v: View): Cached {
    const key = this.key(v), hit = this.slots.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pr = { sx: 0, sy: 0, depth: 0 };
    for (const { tx, ty } of this.geo.tiles) for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) for (const z of [0, -SLAB_D]) {
      project(v, tx + dx, ty + dy, z, pr);
      minX = Math.min(minX, pr.sx); maxX = Math.max(maxX, pr.sx); minY = Math.min(minY, pr.sy); maxY = Math.max(maxY, pr.sy);
    }
    minX = Math.floor(minX) - 2; minY = Math.floor(minY) - 2;
    const fb = new Fb(Math.ceil(maxX) + 3 - minX, Math.ceil(maxY) + 3 - minY);
    drawTerrain(fb, v, makeScr(v, minX, minY), this.geo, this.geo.tiles);
    const c = { fb, minX, minY };
    this.slots.set(key, c);
    this.builds++;
    this.lastBuildMs = performance.now() - t0;
    return c;
  }

  /** Copy the cached terrain into `dst`; frame pixel = project(...) - (offX, offY). */
  blit(dst: Fb, v: View, offX: number, offY: number) {
    const c = this.build(v), dx = c.minX - offX, dy = c.minY - offY;
    const x0 = Math.max(0, dx), x1 = Math.min(dst.w, dx + c.fb.w);
    if (x1 <= x0) return;
    for (let y = Math.max(0, dy); y < Math.min(dst.h, dy + c.fb.h); y++) {
      const s = (y - dy) * c.fb.w + (x0 - dx);
      dst.u32.set(c.fb.u32.subarray(s, s + (x1 - x0)), y * dst.w + x0);
    }
  }
}
