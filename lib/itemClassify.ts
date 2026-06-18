import type { Item, PreCountCategory } from "./types";

// Classify an item into a Pre-count category.
// - "demo": the description carries the "D7" code anywhere as a whole word.
// - "gift": Item Category / Product Group / description mentions a gift
//   keyword (Premium, Gift, ของแถม, แถม), AND the item has no list price.
// - "gift-paid": same as gift, but Unit Price > 0 — these are gifts that
//   still carry a value in BC, useful for the receipt to highlight.
// - "normal": none of the above.
export function classifyItem(
  item: Pick<
    Item,
    "description" | "description2" | "itemCategoryDes" | "productGroupDes" | "unitPrice"
  >,
): PreCountCategory {
  const desc = `${item.description ?? ""} ${item.description2 ?? ""}`.toUpperCase();
  if (/\bD7\b/.test(desc)) return "demo";

  const cat = `${item.itemCategoryDes ?? ""} ${item.productGroupDes ?? ""}`;
  const giftHay = `${cat} ${desc}`;
  const looksLikeGift = /premium|gift|ของแถม|แถม/i.test(giftHay);
  if (looksLikeGift) {
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
  gift: { label: "Premium Gift", short: "GIFT", tone: "rose" },
  "gift-paid": { label: "ของแถมมีมูลค่า", short: "GIFT $", tone: "amber" },
  normal: { label: "ปกติ (ไม่ใช่ Demo/Gift)", short: "—", tone: "slate" },
};
