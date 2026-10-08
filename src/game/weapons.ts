/**
 * Weapons, attachments and crafting. Each weapon turns one law into a tool, and its weakness
 * comes from the same law (GAME_PLAN §8).
 */
import { ITEMS, makeItem, type GearKind, type Item, type ItemKind } from "./items";
import { hasFacility, knows, type FacilityId, type KnowledgeId, type Progress } from "./knowledge";

export type WeaponKind = "rifle" | "launcher" | "lens" | "coilgun";

export interface ProjectileWeapon {
  type: "projectile";
  name: string;
  mass: number; // kg (exaggerated for feel)
  speed: number; // m/s
  interval: number; // s between shots
  damage: number;
  /** crawlers one slug can pass through */
  pierce: number;
  range: number; // auto-aim range, m
  /** J drawn from a carried battery per shot (0 = none) */
  energy: number;
  law: string;
  weakness: string;
}

export interface BeamWeapon {
  type: "beam";
  name: string;
  /** damage per second in full sun; scales with sunlight */
  dps: number;
  range: number;
  law: string;
  weakness: string;
}

export type WeaponStats = ProjectileWeapon | BeamWeapon;

export const WEAPONS: Record<WeaponKind, WeaponStats> = {
  rifle: {
    type: "projectile", name: "채집총", mass: 0.5, speed: 20, interval: 1 / 6, damage: 1, pierce: 1, range: 9, energy: 0,
    law: "J = m·u", weakness: "가볍고 약하다. 기본 보급품",
  },
  launcher: {
    type: "projectile", name: "운동량 발사기", mass: 8, speed: 15, interval: 0.8, damage: 2, pierce: 1, range: 8, energy: 0,
    law: "넉백 Δv = J/m_적 (J = 120 N·s) — 달려드는 생물의 운동량을 이기고 절벽 밖으로 밀어낸다",
    weakness: "반동 Δv = J/M으로 나도 크게 밀린다",
  },
  lens: {
    type: "beam", name: "집광 렌즈", dps: 6, range: 7,
    law: "모은 빛의 세기 ∝ 햇빛",
    weakness: "해가 지면 약해진다. 빛의 운동량 p = E/c는 거의 0이라 넉백이 없다",
  },
  coilgun: {
    type: "projectile", name: "코일건", mass: 0.02, speed: 150, interval: 0.35, damage: 3, pierce: 3, range: 11, energy: 225,
    law: "전지 에너지 → E = ½mu² = 225 J/발, 관통",
    weakness: "전지가 비면 쏠 수 없다. 탄이 가벼워 넉백은 약하다 (J = 3 N·s)",
  },
};

export const MODS = {
  /** the stock braces recoil into the body: Δv = J/(M + bracing) */
  stockBracing: 40, // kg of effective extra mass
  scopeRange: 5, // m of extra auto-aim reach
};

export const BATTERY_CAPACITY = 3000; // J → 13 coilgun shots

export function isWeaponKind(k: ItemKind): k is Exclude<WeaponKind, "rifle"> {
  return k === "launcher" || k === "lens" || k === "coilgun";
}

/** Which slots a weapon accepts. A lens has no recoil, so a stock is pointless. */
export function modSlots(k: ItemKind): ("stock" | "sight")[] {
  if (k === "lens") return ["sight"];
  if (isWeaponKind(k)) return ["stock", "sight"];
  return [];
}

export function attachMod(weapon: Item, mod: Item): boolean {
  const slot = mod.kind === "stock" ? "stock" : mod.kind === "scope" ? "sight" : null;
  if (!slot || !modSlots(weapon.kind).includes(slot)) return false;
  weapon.mods ??= {};
  if (weapon.mods[slot]) return false;
  weapon.mods[slot] = mod;
  return true;
}

export function detachMod(weapon: Item, slot: "stock" | "sight"): Item | null {
  const m = weapon.mods?.[slot];
  if (!m) return null;
  delete weapon.mods![slot];
  return m;
}

export interface Recipe {
  out: GearKind;
  facility: FacilityId;
  knowledge: KnowledgeId;
  points: number;
  materials: Partial<Record<ItemKind, number>>;
}

export const RECIPES: Recipe[] = [
  { out: "launcher", facility: "workbench", knowledge: "mechanics", points: 20, materials: { ore: 2 } },
  { out: "stock", facility: "workbench", knowledge: "mechanics", points: 10, materials: { bio: 1 } },
  { out: "lens", facility: "observatory", knowledge: "celestial", points: 25, materials: { quartz: 3 } },
  { out: "scope", facility: "observatory", knowledge: "celestial", points: 15, materials: { quartz: 2 } },
  { out: "coilgun", facility: "lab", knowledge: "electrochem", points: 40, materials: { ore: 2, quartz: 1 } },
  { out: "battery", facility: "lab", knowledge: "electrochem", points: 10, materials: { ore: 1 } },
];

export function craftBlocker(p: Progress, r: Recipe, stock: Partial<Record<ItemKind, number>>): string | null {
  if (!hasFacility(p, r.facility)) return "시설 필요";
  if (!knows(p, r.knowledge)) return "지식 필요";
  if (p.points < r.points) return `연구 점수 ${r.points} 필요`;
  for (const [k, n] of Object.entries(r.materials) as [ItemKind, number][]) if ((stock[k] ?? 0) < n) return "재료 부족";
  return null;
}

/** Spend points and return the new item. The caller removes the materials from the stash. */
export function craft(p: Progress, r: Recipe, stock: Partial<Record<ItemKind, number>>): Item | null {
  if (craftBlocker(p, r, stock)) return null;
  p.points -= r.points;
  const it = makeItem(r.out);
  if (r.out === "battery") it.charge = BATTERY_CAPACITY;
  return it;
}

export function gearName(k: ItemKind) {
  return ITEMS[k].name;
}
