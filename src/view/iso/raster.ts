/**
 * Tiny software framebuffer: crisp (non-antialiased) convex polygons, rects and lines with alpha,
 * so the whole scene is real pixel art and adjacent faces share edges without seams.
 * Pixels are straight-alpha RGBA, so the result can be composited over the painted background by the canvas.
 * Colours are packed 0xRRGGBB integers.
 */
export const hexN = (s: string) => parseInt(s.slice(1), 16);

export function mixC(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export interface Hatch { col: number; ox: number; oy: number; width?: number }

export class Fb {
  readonly img: ImageData;
  readonly u32: Uint32Array;
  constructor(readonly w: number, readonly h: number) {
    this.img = new ImageData(w, h);
    this.u32 = new Uint32Array(this.img.data.buffer);
  }
  clear() { this.u32.fill(0); }

  private plot(i: number, col: number, a: number) {
    const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255, u = this.u32;
    if (a >= 0.999) { u[i] = 0xff000000 | (b << 16) | (g << 8) | r; return; }
    const d = u[i], da = (d >>> 24) / 255, wd = da * (1 - a), oa = a + wd;
    const mixc = (s: number, dv: number) => Math.round((s * a + dv * wd) / oa);
    u[i] = ((Math.round(oa * 255) << 24) | (mixc(b, (d >> 16) & 255) << 16) | (mixc(g, (d >> 8) & 255) << 8) | mixc(r, d & 255)) >>> 0;
  }

  px(x: number, y: number, col: number, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.plot(y * this.w + x, col, a);
  }

  rect(x: number, y: number, w: number, h: number, col: number, a = 1) {
    x = Math.round(x); y = Math.round(y);
    const x0 = Math.max(0, x), x1 = Math.min(this.w, x + w), y0 = Math.max(0, y), y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.plot(yy * this.w + xx, col, a);
  }

  /** Convex polygon, pixel-centre sampling (top-left rule), optional diagonal hatch lines. pts = [x0,y0,x1,y1,...] */
  poly(pts: number[], col: number, a = 1, hatch?: Hatch, dither = false) {
    const n = pts.length / 2;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { const y = pts[i * 2 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const y0 = Math.max(0, Math.ceil(minY - 0.5)), y1 = Math.min(this.h - 1, Math.ceil(maxY - 0.5) - 1);
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      let xl = Infinity, xr = -Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const xa = pts[i * 2], ya = pts[i * 2 + 1], xb = pts[j * 2], yb = pts[j * 2 + 1];
        if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) {
          const x = xa + ((yc - ya) * (xb - xa)) / (yb - ya);
          if (x < xl) xl = x;
          if (x > xr) xr = x;
        }
      }
      if (xl > xr) continue;
      const xs = Math.max(0, Math.ceil(xl - 0.5)), xe = Math.min(this.w - 1, Math.ceil(xr - 0.5) - 1);
      for (let x = xs; x <= xe; x++) {
        if (dither && ((x + y) & 1)) continue; // checkerboard: every other pixel
        const c = hatch && ((((x - hatch.ox) + (y - hatch.oy)) & 3) < (hatch.width ?? 1)) ? hatch.col : col;
        this.plot(y * this.w + x, c, a);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, col: number, a = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, col, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}
