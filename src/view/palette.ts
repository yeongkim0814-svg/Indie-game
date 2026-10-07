/** Colors measured from the reference art. */
export const GRASS = ["#192925", "#273e2b", "#395330", "#537039", "#8a9f48"] as const;
export const ROCK = ["#122027", "#1b2e39", "#263c47", "#3b4d56", "#567886"] as const;
export const SKY = "#377cc7";
export const HAZE = "#a3cfe3";
export const CLOUD = "#fcfbf6";
export const CLOUD_SHADE = "#4b82bd";
export const FLOWER = "#e8edec";
export const SHADOW = "rgba(18,32,39,0.4)"; // blue-ish dark, never pure black

export function hash2(x: number, y: number, salt = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
