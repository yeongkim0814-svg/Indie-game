/**
 * Hideout facilities and the knowledge tree. Pure rules over a saved Progress record.
 * Every node must change what the player can DO or what they can SEE — never a flat stat bonus.
 */
import type { ItemKind } from "./items";

export type FacilityId = "workbench" | "lab" | "observatory";
export type KnowledgeId = "mechanics" | "radiochem" | "physiology" | "celestial" | "electrochem";
export type Field = "physics" | "chemistry" | "biology" | "earth";

export interface FacilityDef {
  id: FacilityId;
  name: string;
  points: number;
  /** materials consumed from the stash */
  materials: Partial<Record<ItemKind, number>>;
  /** true = present from the start */
  builtIn?: boolean;
  blurb: string;
}

export interface KnowledgeDef {
  id: KnowledgeId;
  name: string;
  field: Field;
  facility: FacilityId;
  points: number;
  /** what changes in play */
  effect: string;
  /** cross-field nodes need their parents first */
  requires?: KnowledgeId[];
  /** the law, and where it stops holding */
  law: string;
  limit: string;
}

export const FACILITIES: Record<FacilityId, FacilityDef> = {
  workbench: { id: "workbench", name: "작업대", points: 0, materials: {}, builtIn: true, blurb: "장비를 다루는 기본 작업대" },
  lab: { id: "lab", name: "실험실", points: 40, materials: { ore: 1, bio: 1 }, blurb: "시료를 분해하고 측정한다" },
  observatory: { id: "observatory", name: "관측소", points: 60, materials: { quartz: 3 }, blurb: "석영을 갈아 렌즈를 만든다" },
};

export const KNOWLEDGE: Record<KnowledgeId, KnowledgeDef> = {
  mechanics: {
    id: "mechanics", name: "운동량 보존", field: "physics", facility: "workbench", points: 30,
    effect: "반동 대시: 무거운 탄을 뒤로 쏴서 앞으로 튀어 나간다",
    law: "M·Δv = −J  →  Δv = J/M",
    limit: "짐이 무거울수록 M이 커져 덜 밀려난다",
  },
  radiochem: {
    id: "radiochem", name: "방사화학", field: "chemistry", facility: "lab", points: 40,
    effect: "방사선 검출기: 근처 광물의 방향과 현재 가치가 보인다",
    law: "N = N₀·2^(−t/T½)",
    limit: "반감기는 온도·압력과 무관하다. 기다려서 되돌릴 방법은 없다",
  },
  physiology: {
    id: "physiology", name: "생리학", field: "biology", facility: "lab", points: 40,
    effect: "생물의 감지 범위와 활동성, 생물 표본의 신선도가 보인다",
    law: "Q10 법칙: 10 °C 오를 때마다 대사 속도가 Q10배",
    limit: "변온 동물에만 해당한다. 체온을 스스로 유지하는 생물에는 맞지 않는다",
  },
  celestial: {
    id: "celestial", name: "천체 운동", field: "earth", facility: "observatory", points: 50,
    effect: "해의 경로를 계산해 정확한 일몰 시각이 보인다",
    law: "자전 각속도 ω = 2π / 하루",
    limit: "대기 굴절 때문에 실제 해는 계산보다 조금 늦게 진다",
  },
  electrochem: {
    id: "electrochem", name: "전기화학", field: "chemistry", facility: "lab", points: 60, requires: ["mechanics", "radiochem"],
    effect: "광물로 전지를 만들고, 전지로 탄을 가속하는 코일건을 만들 수 있다",
    law: "전지 에너지 → 탄의 운동 에너지 E = ½mu²",
    limit: "실제 코일은 열로 에너지를 많이 잃는다(효율 수십 %). 게임에서는 손실을 무시한다",
  },
};

export interface Progress {
  points: number;
  facilities: FacilityId[];
  knowledge: KnowledgeId[];
}

export function newProgress(): Progress {
  return { points: 0, facilities: [], knowledge: [] };
}

export function hasFacility(p: Progress, id: FacilityId) {
  return !!FACILITIES[id].builtIn || p.facilities.includes(id);
}

export function knows(p: Progress, id: KnowledgeId) {
  return p.knowledge.includes(id);
}

/** Why a facility can't be built yet (null = it can). `stock` counts stash items by kind. */
export function buildBlocker(p: Progress, id: FacilityId, stock: Partial<Record<ItemKind, number>>): string | null {
  const f = FACILITIES[id];
  if (hasFacility(p, id)) return "이미 있음";
  if (p.points < f.points) return `연구 점수 ${f.points} 필요`;
  for (const [k, n] of Object.entries(f.materials) as [ItemKind, number][]) if ((stock[k] ?? 0) < n) return "재료 부족";
  return null;
}

export function researchBlocker(p: Progress, id: KnowledgeId): string | null {
  const k = KNOWLEDGE[id];
  if (knows(p, id)) return "이미 앎";
  for (const r of k.requires ?? []) if (!knows(p, r)) return `${KNOWLEDGE[r].name} 먼저`;
  if (!hasFacility(p, k.facility)) return `${FACILITIES[k.facility].name} 필요`;
  if (p.points < k.points) return `연구 점수 ${k.points} 필요`;
  return null;
}

/** Spend points for a facility. The caller removes the materials from the stash. */
export function build(p: Progress, id: FacilityId, stock: Partial<Record<ItemKind, number>>): boolean {
  if (buildBlocker(p, id, stock)) return false;
  p.points -= FACILITIES[id].points;
  p.facilities.push(id);
  return true;
}

export function research(p: Progress, id: KnowledgeId): boolean {
  if (researchBlocker(p, id)) return false;
  p.points -= KNOWLEDGE[id].points;
  p.knowledge.push(id);
  return true;
}
