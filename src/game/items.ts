/**
 * Sample definitions. Each sample's value follows a real law, which is what makes
 * "extract now or keep looting" a decision:
 *   ore    — radioactive decay: V = V₀·2^(−t/T½)
 *   bio    — spoilage with Q10 temperature dependence: dF/dt = −k_ref·Q10^((T−T_ref)/10)
 *   quartz — stable, cheap filler
 */
export type ItemKind = "quartz" | "ore" | "bio";

export interface ItemDef {
  kind: ItemKind;
  name: string;
  w: number;
  h: number;
  mass: number; // kg
  value: number; // research value when fresh
  /** may be turned 90° in the grid */
  rotatable: boolean;
}

export const ITEMS: Record<ItemKind, ItemDef> = {
  quartz: { kind: "quartz", name: "석영 결정", w: 1, h: 1, mass: 0.5, value: 10, rotatable: true },
  ore: { kind: "ore", name: "방사성 광물", w: 1, h: 2, mass: 3, value: 60, rotatable: true },
  bio: { kind: "bio", name: "생물 표본", w: 2, h: 2, mass: 2, value: 50, rotatable: true },
};

export const DECAY = {
  oreHalfLife: 90, // s
  bioRefRate: 1 / 150, // freshness lost per s at the reference temperature
  bioRefTemp: 20, // °C
  bioQ10: 2, // rate doubles every +10 °C
};

export interface Item {
  uid: number;
  kind: ItemKind;
  /** ore: seconds of decay so far (decay runs on the ground too) */
  age: number;
  /** bio: 1 = fresh, 0 = rotten */
  fresh: number;
}

let nextUid = 1;
export function makeItem(kind: ItemKind): Item {
  return { uid: nextUid++, kind, age: 0, fresh: 1 };
}
/** Keep uids unique after loading saved items. */
export function reserveUids(items: Item[]) {
  for (const it of items) nextUid = Math.max(nextUid, it.uid + 1);
}

/** Air temperature from daylight: 30 °C at noon, cooling to 10 °C at sunset. */
export function temperature(daylight: number) {
  return 10 + 20 * daylight;
}

export function bioRate(tempC: number) {
  return DECAY.bioRefRate * Math.pow(DECAY.bioQ10, (tempC - DECAY.bioRefTemp) / 10);
}

/** Advance an item's state by dt seconds at the given temperature. */
export function ageItem(it: Item, dt: number, tempC: number) {
  if (it.kind === "ore") it.age += dt;
  else if (it.kind === "bio") it.fresh = Math.max(0, it.fresh - bioRate(tempC) * dt);
}

export function itemValue(it: Item): number {
  const v = ITEMS[it.kind].value;
  if (it.kind === "ore") return v * Math.pow(2, -it.age / DECAY.oreHalfLife);
  if (it.kind === "bio") return v * it.fresh;
  return v;
}
