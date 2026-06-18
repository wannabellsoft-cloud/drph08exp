import type { Item, PreCountCategory } from "./types";

// Classify an item into a Pre-count category.
// - "demo": the description carries the "D7" code anywhere as a whole word.
// - "gift" / "gift-paid": Division Code is "D001" (Premium Gift). Items
//   with Unit Price > 0 become "gift-paid" so the receipt can flag them.
// - "normal": none of the above.
export function classifyItem(
  item: Pick<Item, "description" | "description2" | "divisionCode" | "unitPrice">,
): PreCountCategory {
  const desc = `${item.description ?? ""} ${item.description2 ?? ""}`.toUpperCase();
  if (/\bD7\b/.test(desc)) return "demo";

  const div = (item.divisionCode ?? "").trim().toUpperCase();
  if (div === "D001") {
    const price = Number(item.unitPrice ?? 0);
    return price > 0 ? "gift-paid" : "gift";
  }
  return "normal";
}

export const CATEGORY_META: Record<
  PreCountCategory,
  { label: string; short: string; tone: "indigo" | "rose" | "amber" | "slate" }
> = {
  demo: { label: "Demo (D7)", short: "DEMO", tone: "indigo" },
  gift: { label: "Premium Gift (D001)", short: "GIFT", tone: "rose" },
  "gift-paid": { label: "ของแถมมีมูลค่า (D001 + ราคา)", short: "GIFT $", tone: "amber" },
  normal: { label: "ปกติ (ไม่ใช่ Demo/Gift)", short: "—", tone: "slate" },
};
