/** What the player's knowledge lets them see: item values are hidden ("?") until the matching law is learned. */
import { itemValue, type Item } from "../game/items";
import type { KnowledgeId } from "../game/knowledge";

export function valueKnown(k: ReadonlySet<KnowledgeId>, it: Item): boolean {
  if (it.kind === "ore") return k.has("radiochem");
  if (it.kind === "bio") return k.has("physiology");
  return true;
}

/** Sum of the known values, with "+?" when something carried is unknown. */
export function carriedValueText(k: ReadonlySet<KnowledgeId>, items: Item[]): string {
  let sum = 0, unknown = false;
  for (const it of items) { if (valueKnown(k, it)) sum += itemValue(it); else unknown = true; }
  if (!unknown) return String(Math.round(sum));
  return sum > 0 ? `${Math.round(sum)}+?` : "?";
}
