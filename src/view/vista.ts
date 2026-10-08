/**
 * The landscape beyond the cliff ('~' tiles): four parallax layers sky -> far -> mid -> near.
 * Each layer uses its painted image when present, else a procedural drawing (pre-rendered once to an offscreen canvas).
 * Knowledge adds to the same view: moons with orbits (celestial), rock strata with radiometric ages (radiochem),
 * a migrating herd (physiology), aurora + field lines at dusk (electrochem). Text goes out as VistaLabel[] so the
 * renderer can draw it at native resolution; everything here is drawn in a fixed 180 px tall "vista space".
 */
import type { KnowledgeId } from "../game/knowledge";
import type { VistaArt } from "./art";
import { CLOUD, CLOUD_SHADE, HAZE, ROCK, SKY, mix } from "./palette";

export const VISTA_H = 180;
const LW = 960; // period of the procedural layers (they wrap horizontally)
const PAD = 64; // extra rows below a layer so vertical parallax never exposes a gap
const TAU = Math.PI * 2;

/** A text label in vista space (x, y in 180 px-tall logical pixels). */
export interface VistaLabel { text: string; x: number; y: number; align: "left" | "center"; tick?: boolean }

export interface VistaState {
  /** parallax reference: camera centre in world pixels, minus the vista's own half size */
  cx: number; cy: number;
  t: number;
  daylight: number;
  known: ReadonlySet<KnowledgeId>;
  /** 0..1 lookout ease; labels get a little stronger while looking out */
  look: number;
  /** is this vista-space point visible through the cliff (not covered by ground)? labels are only placed there */
  isVoid: (x: number, y: number) => boolean;
}

interface Ridge { key: "far" | "mid" | "near"; par: number; base: number; amp: number; n1: number; n2: number; col: string; seed: number; strata?: { d: number[]; tint: string[] } }

const RIDGES: Ridge[] = [
  { key: "far", par: 0.15, base: 0.58, amp: 14, n1: 3, n2: 9, col: hex(mix(HAZE, ROCK[4], 0.35)), seed: 1.3,
    strata: { d: [0, 8, 17, 28], tint: ["#c9b690", "#b58f68", "#8a6a58", "#5f4b47"] } },
  { key: "mid", par: 0.3, base: 0.7, amp: 16, n1: 3, n2: 8, col: hex(mix(HAZE, ROCK[4], 0.7)), seed: 4.1,
    strata: { d: [0, 9, 19, 31], tint: ["#a99a86", "#8f7461", "#6a5650", "#46393d"] } },
  { key: "near", par: 0.5, base: 0.82, amp: 12, n1: 4, n2: 11, col: ROCK[3], seed: 7.7 },
];

/** "rgb(r,g,b)" -> "#rrggbb" (palette.mix returns rgb strings; blending needs hex). */
function hex(c: string): string {
  if (c[0] === "#") return c;
  const m = c.match(/\d+/g)!.map(Number);
  return "#" + m.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
}

function ridgeY(r: Ridge, wx: number): number {
  const x = ((wx % LW) + LW) % LW;
  return Math.round(VISTA_H * r.base + Math.sin((TAU * r.n1 * x) / LW + r.seed) * r.amp + Math.sin((TAU * r.n2 * x) / LW + r.seed * 2) * (r.amp * 0.4));
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

/** Strata fold: each boundary wobbles a little, with whole cycles per period so the layer still wraps. */
function fold(i: number, x: number): number { return Math.round(Math.sin((TAU * (2 + i) * x) / LW + i * 1.7) * 1.5); }

export class Vista {
  art: VistaArt = {};
  private sky: HTMLCanvasElement | null = null;
  private plain = new Map<string, HTMLCanvasElement>();
  private fieldLines: HTMLCanvasElement | null = null;

  private buildSky() {
    const c = makeCanvas(1, VISTA_H), g = c.getContext("2d")!;
    const bands = 14;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = mix(SKY, HAZE, Math.min(1, (i / (bands - 1)) * 1.15));
      const y0 = Math.floor((i * VISTA_H) / bands), y1 = Math.floor(((i + 1) * VISTA_H) / bands);
      g.fillRect(0, y0, 1, y1 - y0);
    }
    return c;
  }

  /** Pre-rendered ridge silhouette; with strata, the rock below the crest is banded by age. */
  private ridge(r: Ridge, strata: boolean): HTMLCanvasElement {
    const key = r.key + (strata ? "+s" : "");
    let c = this.plain.get(key);
    if (c) return c;
    c = makeCanvas(LW, VISTA_H + PAD);
    const g = c.getContext("2d")!;
    for (let x = 0; x < LW; x++) {
      const y = ridgeY(r, x);
      g.fillStyle = r.col;
      g.fillRect(x, y, 1, VISTA_H + PAD - y);
      if (strata && r.strata) {
        const S = r.strata;
        for (let i = 0; i < S.d.length; i++) {
          const y0 = y + S.d[i] + (i ? fold(i, x) : 0), y1 = i + 1 < S.d.length ? y + S.d[i + 1] + fold(i + 1, x) : VISTA_H + PAD;
          g.fillStyle = S.tint[i];
          g.fillRect(x, y0, 1, Math.max(0, y1 - y0));
          if (i) { g.fillStyle = "rgba(255,244,214,0.35)"; g.fillRect(x, y0, 1, 1); }
        }
      }
    }
    this.plain.set(key, c);
    return c;
  }

  /** Painted layers are not tileable: scroll them with the parallax factor and clamp at both ends. */
  private drawArt(g: CanvasRenderingContext2D, img: HTMLImageElement, par: number, st: VistaState, W: number) {
    const ox = Math.max(0, Math.min(Math.round(st.cx * par), Math.max(0, img.width - W)));
    g.drawImage(img, -ox, 0);
    if (img.width - ox < W) g.drawImage(img, img.width - ox, 0); // image narrower than the view: repeat
  }

  private drawRidge(g: CanvasRenderingContext2D, r: Ridge, st: VistaState, W: number, strata: boolean) {
    const art = this.art[r.key];
    if (art) { this.drawArt(g, art, r.par, st, W); return; }
    const c = this.ridge(r, strata);
    const ox = Math.round(st.cx * r.par), oy = Math.round(st.cy * r.par * 0.5);
    const x0 = -(((ox % LW) + LW) % LW);
    for (let x = x0; x < W; x += LW) g.drawImage(c, x, -oy);
  }

  /** Screen-space x (vista space) of a layer coordinate. */
  private lx(r: Ridge, wx: number, st: VistaState) { return Math.round(wx - st.cx * r.par); }
  private ly(r: Ridge, wx: number, st: VistaState, dy: number) { return ridgeY(r, wx) + dy - Math.round(st.cy * r.par * 0.5); }

  /** Draws the whole vista into g (a W x 180 canvas) and returns its labels. */
  draw(g: CanvasRenderingContext2D, W: number, st: VistaState): VistaLabel[] {
    const labels: VistaLabel[] = [];
    const { known, t } = st;
    g.imageSmoothingEnabled = false;

    // ---- sky
    if (this.art.sky) this.drawArt(g, this.art.sky, 0.05, st, W);
    else {
      this.sky ??= this.buildSky();
      g.drawImage(this.sky, 0, 0, 1, VISTA_H, 0, 0, W, VISTA_H);
      for (let i = 0; i < 5; i++) { // clouds drift slowly and barely follow the camera
        const span = W + 160;
        const x = Math.round((((i * 137 + t * (2 + i * 0.6) - st.cx * 0.05) % span) + span) % span) - 80;
        const y = Math.round(18 + ((i * 41) % 60) - st.cy * 0.03);
        g.fillStyle = CLOUD_SHADE; g.fillRect(x + 2, y + 4, 26, 2);
        g.fillStyle = CLOUD;
        g.fillRect(x + 4, y, 16, 4); g.fillRect(x, y + 2, 28, 3); g.fillRect(x + 10, y - 2, 9, 3);
      }
    }
    this.drawMoons(g, W, st, labels);
    if (known.has("electrochem")) this.drawAurora(g, W, st, labels);

    // ---- far / mid / near
    const strata = known.has("radiochem");
    const [far, mid, near] = RIDGES;
    this.drawRidge(g, far, st, W, strata);
    this.drawRidge(g, mid, st, W, strata);
    if (strata) this.strataLabels(far, mid, st, W, labels);
    if (known.has("physiology")) this.drawHerd(g, mid, st, W);
    this.drawRidge(g, near, st, W, false);
    return labels;
  }

  // ---------------------------------------------------------------- celestial
  private drawMoons(g: CanvasRenderingContext2D, W: number, st: VistaState, labels: VistaLabel[]) {
    const celestial = st.known.has("celestial");
    const ox = -st.cx * 0.05, oy = -st.cy * 0.03;
    const orbits = [
      { cx: W * 0.5, cy: 126, rx: 150, ry: 92, period: 1.3, phase: 0.6, r: 5, col: "#eef3f6", shade: "#aebfcc", label: "주기 1.3일" },
      { cx: W * 0.5 + 12, cy: 138, rx: 235, ry: 112, period: 9.7, phase: 2.2, r: 3, col: "#e3d3b0", shade: "#a99a7c", label: "주기 9.7일" },
    ];
    orbits.forEach((o, i) => {
      // position along the upper half of the ellipse; slow sweep back and forth (not literal orbital speed)
      const u = 0.5 + 0.36 * Math.sin(o.phase + (st.t * 0.5) / o.period);
      const a = Math.PI + Math.PI * u;
      const cx = o.cx + ox, cy = o.cy + oy;
      const mx = Math.round(cx + Math.cos(a) * o.rx), my = Math.round(cy + Math.sin(a) * o.ry);
      if (celestial) {
        g.fillStyle = "rgba(240,248,255,0.5)"; // faint dotted elliptical arc
        const n = Math.round(o.rx * 3);
        for (let k = 0; k <= n; k++) {
          if (k % 5 > 1) continue;
          const b = Math.PI + (Math.PI * k) / n;
          g.fillRect(Math.round(cx + Math.cos(b) * o.rx), Math.round(cy + Math.sin(b) * o.ry), 1, 1);
        }
        g.fillStyle = o.col;
        for (let dy = -o.r; dy <= o.r; dy++) { const w = Math.floor(Math.sqrt(o.r * o.r + 0.5 - dy * dy)); g.fillRect(mx - w, my + dy, w * 2 + 1, 1); }
        g.fillStyle = o.shade; // night side: a crescent shadow
        for (let dy = -o.r; dy <= o.r; dy++) { const w = Math.floor(Math.sqrt(o.r * o.r + 0.5 - dy * dy)); g.fillRect(mx + Math.max(0, w - 1), my + dy, Math.min(2, w + 1), 1); }
        if (st.isVoid(mx, my + o.r + 3) && st.isVoid(mx - 18, my + o.r + 3) && st.isVoid(mx + 18, my + o.r + 3)) labels.push({ text: o.label, x: mx, y: my + o.r + 3, align: "center" });
      } else {
        g.fillStyle = "#eaf2f6";
        g.fillRect(mx - 1, my - 1, i ? 2 : 3, i ? 2 : 3);
      }
    });
  }

  // ---------------------------------------------------------------- electrochem
  private drawAurora(g: CanvasRenderingContext2D, W: number, st: VistaState, labels: VistaLabel[]) {
    const a = Math.max(0, Math.min(1, (0.6 - st.daylight) / 0.25));
    if (a <= 0) return;
    const t = st.t, ox = st.cx * 0.05;
    const N = 12, SEG = 3;
    const cols: string[] = [];
    for (let j = 0; j < N; j++) cols.push(mix("#a070ff", "#58ffa8", j / (N - 1)));
    for (let x = 0; x < W; x += 3) {
      const wx = x + ox;
      const top = 14 + 12 * Math.sin(wx * 0.03 + t * 0.35) + 7 * Math.sin(wx * 0.071 - t * 0.5);
      const len = 40 + 14 * Math.sin(wx * 0.05 + t * 0.25);
      const ray = 0.7 + 0.3 * Math.sin(wx * 0.45 + t * 1.7);
      const n = Math.max(3, Math.floor(len / SEG));
      for (let j = 0; j < n; j++) {
        const f = j / (n - 1);
        g.globalAlpha = a * ray * (0.08 + 0.42 * f * f);
        g.fillStyle = cols[Math.min(N - 1, Math.round(f * (N - 1)))];
        g.fillRect(x, Math.round(top + j * SEG), 3, SEG);
      }
    }
    g.globalAlpha = 1;
    // dipole field lines: faint dotted nested arcs over the horizon
    this.fieldLines ??= this.buildFieldLines();
    g.globalAlpha = a * 0.75;
    g.drawImage(this.fieldLines, Math.round(W / 2 - this.fieldLines.width / 2 - ox), 0);
    g.globalAlpha = 1;
    const spot = (text: string, ys: number[]) => {
      for (const y of ys) for (let f = 0.76; f > 0.3; f -= 0.04) {
        const x = Math.round(W * f);
        if (st.isVoid(x - 22, y) && st.isVoid(x + 22, y)) { labels.push({ text, x, y, align: "center" }); return; }
      }
    };
    spot("오로라", [26, 34]);
    spot("자기장", [150 - 62 - 11, 150 - 88 - 8]);
  }

  private buildFieldLines() {
    const w = 700, c = makeCanvas(w, VISTA_H), g = c.getContext("2d")!;
    g.fillStyle = "rgba(170,255,225,0.6)";
    // nested dotted arcs over the horizon (the shape of a dipole's field lines)
    for (const [L, h] of [[330, 112], [250, 88], [170, 62]] as const) {
      const n = L * 3;
      for (let k = 0; k <= n; k++) {
        if (k % 6 > 1) continue;
        const th = Math.PI + (Math.PI * k) / n;
        g.fillRect(Math.round(w / 2 + Math.cos(th) * L), Math.round(150 + Math.sin(th) * h), 1, 1);
      }
    }
    return c;
  }

  // ---------------------------------------------------------------- radiochem
  private strataLabels(far: Ridge, mid: Ridge, st: VistaState, W: number, labels: VistaLabel[]) {
    const spots: { r: Ridge; d: number; text: string }[] = [
      { r: far, d: 12, text: "1.2억 년" },
      { r: mid, d: 22, text: "2.6억 년" },
      { r: mid, d: 38, text: "4.1억 년" },
    ];
    let lastY = -99;
    for (const s of spots) {
      // the right-most spot where the band is visible through the cliff, pinned to the screen
      for (let f = 0.78; f > 0.4; f -= 0.03) {
        const x = Math.round(W * f), y = this.ly(s.r, x + Math.round(st.cx * s.r.par), st, s.d);
        if (y - lastY < 9 || y > VISTA_H - 4 || !st.isVoid(x, y) || !st.isVoid(x + 44, y)) continue;
        labels.push({ text: s.text, x, y, align: "left", tick: true });
        lastY = y;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- physiology
  private drawHerd(g: CanvasRenderingContext2D, mid: Ridge, st: VistaState, W: number) {
    const t = st.t;
    // dotted migration path along the crest, a few pixels above it
    g.fillStyle = "rgba(252,251,246,0.85)";
    const wxA = Math.round(st.cx * mid.par) - 8;
    for (let wx = wxA - (wxA % 6); wx < wxA + W + 16; wx += 6) {
      g.fillRect(wx - Math.round(st.cx * mid.par), this.ly(mid, wx, st, -7), 2, 1);
    }
    // the herd ambles back and forth along it
    // (pinned to the screen's right side: that is where the cliff opens onto the vista)
    const hc = Math.round(W * 0.72 + 40 * Math.sin(t * 0.035) + st.cx * mid.par), dir = Math.cos(t * 0.035) >= 0 ? 1 : -1;
    const dark = ROCK[1], light = ROCK[2];
    for (let i = 0; i < 7; i++) {
      const wx = Math.round(hc + (i - 3) * 8 + (i % 2) * 3);
      const x = this.lx(mid, wx, st), y = this.ly(mid, wx, st, -1);
      if (x < -6 || x > W + 6) continue;
      const step = Math.floor(t * 2 + i) & 1;
      const tall = i === 2 || i === 5;
      g.fillStyle = dark;
      g.fillRect(x, y - 3, 4, 2); // body
      g.fillRect(x + (step ? 0 : 1), y - 1, 1, 1); g.fillRect(x + 3 - (step ? 0 : 1), y - 1, 1, 1); // legs
      g.fillRect(x + (dir > 0 ? 4 : -1), y - (tall ? 6 : 4), 1, tall ? 4 : 2); // neck
      g.fillStyle = light;
      g.fillRect(x + (dir > 0 ? 4 : -2), y - (tall ? 7 : 5), 2, 1); // head
    }
  }
}
