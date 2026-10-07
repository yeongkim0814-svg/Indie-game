const KEY = "stash.samples";

export function readStash(): number {
  try {
    const n = parseInt(localStorage.getItem(KEY) ?? "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

export function addStash(n: number): number {
  const total = readStash() + n;
  try { localStorage.setItem(KEY, String(total)); } catch { /* storage unavailable */ }
  return total;
}
