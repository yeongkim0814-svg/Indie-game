import { CLOUD, CLOUD_SHADE, HAZE, ROCK, SKY, mix } from "./palette";

/**
 * Placeholder landscape seen through the cliff ('~') tiles. Isolated on purpose:
 * a painted vista image will replace this function later. Screen space, behind everything.
 */
export function drawVista(ctx: CanvasRenderingContext2D, W: number, H: number, camX: number, camY: number, t: number) {
  // banded sky -> haze gradient (bands keep it pixel-art)
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = mix(SKY, HAZE, Math.min(1, (i / (bands - 1)) * 1.15));
    const y0 = Math.floor((i * H) / bands), y1 = Math.floor(((i + 1) * H) / bands);
    ctx.fillRect(0, y0, W, y1 - y0);
  }
  // clouds drift slowly and barely follow the camera
  for (let i = 0; i < 5; i++) {
    const span = W + 160;
    const x = Math.round((((i * 137 + t * (2 + i * 0.6) - camX * 0.08) % span) + span) % span) - 80;
    const y = Math.round(18 + ((i * 41) % 60) - camY * 0.05);
    ctx.fillStyle = CLOUD_SHADE; ctx.fillRect(x + 2, y + 4, 26, 2);
    ctx.fillStyle = CLOUD;
    ctx.fillRect(x + 4, y, 16, 4); ctx.fillRect(x, y + 2, 28, 3); ctx.fillRect(x + 10, y - 2, 9, 3);
  }
  // ridge silhouettes with parallax ~0.3x camera
  const layers = [
    { par: 0.2, base: 0.58, amp: 14, f1: 0.021, f2: 0.057, col: mix(HAZE, ROCK[4], 0.35), seed: 1.3 },
    { par: 0.3, base: 0.7, amp: 16, f1: 0.017, f2: 0.049, col: mix(HAZE, ROCK[4], 0.7), seed: 4.1 },
    { par: 0.4, base: 0.82, amp: 12, f1: 0.026, f2: 0.071, col: ROCK[3], seed: 7.7 },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.col;
    const ox = camX * L.par, oy = camY * L.par * 0.5;
    for (let x = 0; x < W; x++) {
      const wx = x + ox;
      const y = Math.round(H * L.base - oy + Math.sin(wx * L.f1 + L.seed) * L.amp + Math.sin(wx * L.f2 + L.seed * 2) * (L.amp * 0.4));
      ctx.fillRect(x, y, 1, H - y);
    }
  }
}
