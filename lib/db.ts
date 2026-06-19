"use client";
import { sb, isConfigured } from "./supabase";
import type { Item, LedgerEntry, Transfer, ItemJournalEntry, StockSummary } from "./types";

export { isConfigured };
export const EXTERNAL_DOC_PREFIX = "TO08EXP-";
export const EXTERNAL_DOC_PAD = 4;
export const JOURNAL_DOC_PREFIX = "LOT60008-";
export const JOURNAL_DOC_PAD = 3;
export const JOURNAL_LOCATION = "60008-EXP";

const T_ITEMS = "items";
const T_LEDGER = "ledger";
const T_TRANSFERS = "transfers";
const T_JOURNAL = "journal";
const T_CONFIRMATIONS = "precount_confirmations";

// Wrap a network-bound call with retry + clearer error context.
// "TypeError: Failed to fetch" usually means: payload too big, network blip,
// CORS, or wrong project URL. Retrying small chunks fixes the first two.
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const transient =
        e?.name === "TypeError" ||
        /failed to fetch|network|timeout|fetch/i.test(String(e?.message ?? ""));
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, i))); // 600ms, 1.2s
    }
  }
  const msg = lastErr?.message ?? String(lastErr);
  throw new Error(`${label}: ${msg}`);
}

// ============ ITEMS ============
export async function findItemByBarcode(barcode: string): Promise<Item | undefined> {
  const code = barcode.trim();
  if (!code) return undefined;
  // Try barcode match first
  const r1 = await sb()
    .from(T_ITEMS)
    .select("*")
    .eq("barcode", code)
    .limit(1)
    .maybeSingle();
  if (r1.data) return r1.data as Item;
  // Fallback: maybe user typed Item No. directly
  const r2 = await sb()
    .from(T_ITEMS)
    .select("*")
    .eq("itemNo", code)
    .maybeSingle();
  return (r2.data ?? undefined) as Item | undefined;
}

export async function upsertItems(
  items: Item[],
  onProgress?: (n: number, total: number) => void,
): Promise<number> {
  if (!items.length) return 0;
  const CHUNK = 200;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    await withRetry(`upsert items chunk ${i}-${i + slice.length}`, async () => {
      const { error } = await sb().from(T_ITEMS).upsert(slice, { onConflict: "itemNo" });
      if (error) throw new Error(error.message);
    });
    onProgress?.(Math.min(i + CHUNK, items.length), items.length);
  }
  return items.length;
}

export async function countItems(): Promise<number> {
  const { count, error } = await sb().from(T_ITEMS).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

// ============ LEDGER ============
export async function replaceLedger(
  entries: LedgerEntry[],
  onProgress?: (n: number, total: number) => void,
): Promise<number> {
  await withRetry("truncate ledger", async () => {
    const rpc = await sb().rpc("truncate_ledger");
    if (rpc.error) {
      const del = await sb().from(T_LEDGER).delete().gte("entryNo", -9e18);
      if (del.error) throw new Error(del.error.message);
    }
  });
  return appendLedger(entries, onProgress);
}

export async function appendLedger(
  entries: LedgerEntry[],
  onProgress?: (n: number, total: number) => void,
): Promise<number> {
  if (!entries.length) return 0;
  const CHUNK = 200;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    await withRetry(`upsert ledger chunk ${i}-${i + slice.length}`, async () => {
      const { error } = await sb().from(T_LEDGER).upsert(slice, { onConflict: "entryNo" });
      if (error) throw new Error(error.message);
    });
    onProgress?.(Math.min(i + CHUNK, entries.length), entries.length);
  }
  return entries.length;
}

export async function countLedger(): Promise<number> {
  const { count, error } = await sb().from(T_LEDGER).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

// ============ STOCK ============
export async function stockForItem(itemNo: string): Promise<StockSummary> {
  const [itemR, ledgerR, transfersR] = await Promise.all([
    sb().from(T_ITEMS).select("*").eq("itemNo", itemNo).maybeSingle(),
    sb()
      .from(T_LEDGER)
      .select("lotNo, expirationDate, locationCode, remainingQuantity, uom")
      .eq("itemNo", itemNo)
      .gt("remainingQuantity", 0),
    sb().from(T_TRANSFERS).select("*"),
  ]);
  if (itemR.error) throw itemR.error;
  if (ledgerR.error) throw ledgerR.error;
  if (transfersR.error) throw transfersR.error;

  const item = (itemR.data ?? null) as Item | null;
  const entries = (ledgerR.data ?? []) as Array<{
    lotNo: string;
    expirationDate?: string;
    locationCode: string;
    remainingQuantity: number;
    uom?: string;
  }>;
  const transfers = (transfersR.data ?? []) as Transfer[];

  const map = new Map<string, StockSummary["lots"][number]>();
  for (const e of entries) {
    const key = `${e.lotNo}|${e.locationCode}`;
    const qty = Number(e.remainingQuantity) || 0;
    const cur = map.get(key);
    if (cur) cur.remaining += qty;
    else
      map.set(key, {
        lotNo: e.lotNo,
        expirationDate: e.expirationDate,
        locationCode: e.locationCode,
        remaining: qty,
        reserved: 0,
        available: qty,
        uom: e.uom,
      });
  }

  for (const t of transfers) {
    if (t.applied) continue;
    for (const l of t.lines ?? []) {
      if (l.itemNo !== itemNo) continue;
      const loc = l.alreadyExp ? "60008-EXP" : "60008";
      const key = `${l.lotNo}|${loc}`;
      const cur = map.get(key);
      if (cur) cur.reserved += Number(l.quantity) || 0;
      else
        map.set(key, {
          lotNo: l.lotNo,
          expirationDate: l.expirationDate,
          locationCode: loc,
          remaining: 0,
          reserved: Number(l.quantity) || 0,
          available: 0,
          uom: l.uom,
        });
    }
  }

  for (const v of map.values()) v.available = v.remaining - v.reserved;

  const lots = Array.from(map.values()).sort((a, b) =>
    (a.expirationDate || "").localeCompare(b.expirationDate || ""),
  );
  return {
    itemNo,
    description: item?.description,
    barcode: item?.barcode,
    lots,
  };
}

// ============ TRANSFERS ============
export async function saveTransfer(t: Transfer) {
  const { error } = await sb().from(T_TRANSFERS).upsert(t);
  if (error) throw error;
}

export async function listTransfers(): Promise<Transfer[]> {
  // Excludes precount sessions — those live in their own tab.
  const { data, error } = await sb()
    .from(T_TRANSFERS)
    .select("*")
    .or("type.is.null,type.eq.to")
    .order("createdAt", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Transfer[];
}

export async function listPreCountSessions(): Promise<Transfer[]> {
  const { data, error } = await sb()
    .from(T_TRANSFERS)
    .select("*")
    .eq("type", "precount")
    .order("createdAt", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Transfer[];
}

// Rough server-side filter for browsing the Pre-count catalogue. Returns
// items that might be Demo or Gift; the caller still runs classifyItem to
// confirm. Paginated through Supabase's 1000-row cap.
export async function listItemsByCategoryRough(
  category: "demo" | "gift",
): Promise<Item[]> {
  const all: Item[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    let q = sb().from(T_ITEMS).select("*");
    if (category === "demo") {
      q = q.or("description.ilike.%D7%,description2.ilike.%D7%");
    } else {
      // Premium Gift = Division Code "D001"
      q = q.eq("divisionCode", "D001");
    }
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as Item[];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// =========================================================
// Pre-count "CF" (confirmed-present-in-store) toggles
// =========================================================
export async function listConfirmations(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb()
      .from(T_CONFIRMATIONS)
      .select("itemNo, confirmedAt")
      .order("itemNo", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      // If table doesn't exist yet, treat as empty
      if (/relation .* does not exist/i.test(error.message)) return map;
      throw error;
    }
    const chunk = (data ?? []) as Array<{ itemNo: string; confirmedAt: string }>;
    for (const row of chunk) {
      if (row.itemNo) map.set(String(row.itemNo).trim(), row.confirmedAt);
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

export async function confirmItemPresent(itemNo: string) {
  const { error } = await sb()
    .from(T_CONFIRMATIONS)
    .upsert({ itemNo, confirmedAt: new Date().toISOString() });
  if (error) throw error;
}

export async function unconfirmItemPresent(itemNo: string) {
  const { error } = await sb().from(T_CONFIRMATIONS).delete().eq("itemNo", itemNo);
  if (error) throw error;
}

export async function clearAllConfirmations() {
  const { error } = await sb()
    .from(T_CONFIRMATIONS)
    .delete()
    .gte("itemNo", "");
  if (error) throw error;
}

// Item Master "Stock" column for one item — the canonical BC-reported
// on-hand quantity. Pre-count uses this directly so the screen matches
// what the user sees in BC, rather than re-deriving from Ledger sums
// (which can be 0 for Demo/Gift items that never moved).
export async function getItemMasterStock(itemNo: string): Promise<number> {
  const { data, error } = await sb()
    .from(T_ITEMS)
    .select("stock")
    .eq("itemNo", itemNo)
    .maybeSingle();
  if (error) return 0;
  return Number((data as any)?.stock ?? 0);
}

// Map of itemNo → total Remaining Quantity in Ledger.
//
// Strategy:
// 1) Try the RPC. The new signature returns a single JSONB object and is
//    not subject to PostgREST's row cap. The old TABLE-returning signature
//    silently truncated at 1000 rows, so if the response comes back as an
//    array of exactly the cap size we treat it as untrustworthy and fall
//    through.
// 2) Paginate the Ledger and sum client-side, in order of entryNo so the
//    page boundaries are stable.
export async function fetchRemainTotals(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  // 1) RPC
  try {
    const r = await sb().rpc("item_remain_total");
    if (!r.error && r.data) {
      if (typeof r.data === "object" && !Array.isArray(r.data)) {
        // New JSONB signature — single object, no row cap.
        for (const [k, v] of Object.entries(r.data as Record<string, number>)) {
          const key = String(k).trim();
          if (key) map.set(key, Number(v) || 0);
        }
        if (map.size > 0) return map;
      }
      // If it's an array (old TABLE signature), don't trust it — could be
      // truncated at 1000. Fall through to pagination.
    }
  } catch {
    // fall through to paginated query
  }

  // 2) Paginated fallback
  map.clear();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb()
      .from(T_LEDGER)
      .select("itemNo, remainingQuantity")
      .gt("remainingQuantity", 0)
      .order("entryNo", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as Array<{ itemNo: string; remainingQuantity: number }>;
    for (const row of chunk) {
      if (!row.itemNo) continue;
      const key = String(row.itemNo).trim();
      const cur = map.get(key) ?? 0;
      map.set(key, cur + (Number(row.remainingQuantity) || 0));
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

export async function deleteTransferRaw(id: string) {
  // For precount sessions — no journal cascade, no reservation revert
  const { error } = await sb().from(T_TRANSFERS).delete().eq("id", id);
  if (error) throw error;
}

export async function getTransfer(id: string): Promise<Transfer | undefined> {
  const { data, error } = await sb().from(T_TRANSFERS).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Transfer | undefined;
}

export async function countTransfers(): Promise<number> {
  const { count, error } = await sb().from(T_TRANSFERS).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function nextExternalDocNo(): Promise<string> {
  const { data, error } = await sb().from(T_TRANSFERS).select("externalDocNo");
  if (error) throw error;
  let max = 0;
  for (const r of data ?? []) {
    const v = ((r as any).externalDocNo ?? "").toString().trim();
    if (!v.startsWith(EXTERNAL_DOC_PREFIX)) continue;
    const n = parseInt(v.slice(EXTERNAL_DOC_PREFIX.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${EXTERNAL_DOC_PREFIX}${String(max + 1).padStart(EXTERNAL_DOC_PAD, "0")}`;
}

export async function closeTransfer(t: Transfer, externalDocNo?: string) {
  const docNo =
    (externalDocNo ?? t.externalDocNo ?? "").trim() || (await nextExternalDocNo());
  const next: Transfer = {
    ...t,
    externalDocNo: docNo,
    closed: true,
    closedAt: new Date().toISOString(),
  };
  await saveTransfer(next);
  return next;
}

export async function reopenTransfer(t: Transfer) {
  const next: Transfer = { ...t, closed: false, closedAt: undefined };
  await saveTransfer(next);
  return next;
}

export async function deleteTransferAndRevert(id: string) {
  // Cascade-delete pending Journal entries that were created alongside
  // this carton — they reference the carton via cartonId.
  await deletePendingJournalsForCarton(id);
  const { error } = await sb().from(T_TRANSFERS).delete().eq("id", id);
  if (error) throw error;
}

// ============ ITEM JOURNAL ============
export async function nextJournalDocNo(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `${JOURNAL_DOC_PREFIX}${yy}${mm}`;
  const { data, error } = await sb().from(T_JOURNAL).select("documentNo");
  if (error) throw error;
  let max = 0;
  for (const r of data ?? []) {
    const v = ((r as any).documentNo ?? "").toString();
    if (!v.startsWith(prefix)) continue;
    const n = parseInt(v.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(JOURNAL_DOC_PAD, "0")}`;
}

export async function saveJournalEntry(e: ItemJournalEntry) {
  const { error } = await sb().from(T_JOURNAL).upsert(e);
  if (error) {
    // Defensive: if the journal table was created by an older version of
    // the schema, cartonId may be missing. Drop the field and retry so
    // the user can keep working without re-running migrations.
    if (/cartonId/i.test(error.message) || error.code === "PGRST204") {
      const { cartonId, ...rest } = e;
      const r2 = await sb().from(T_JOURNAL).upsert(rest);
      if (r2.error) throw new Error(r2.error.message);
      return;
    }
    throw new Error(error.message);
  }
}

export async function listJournalEntries(): Promise<ItemJournalEntry[]> {
  const { data, error } = await sb()
    .from(T_JOURNAL)
    .select("*")
    .order("createdAt", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ItemJournalEntry[];
}

export async function getJournalEntry(id: string): Promise<ItemJournalEntry | undefined> {
  const { data, error } = await sb().from(T_JOURNAL).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ItemJournalEntry | undefined;
}

export async function deleteJournalEntry(id: string) {
  const { error } = await sb().from(T_JOURNAL).delete().eq("id", id);
  if (error) throw error;
}

export async function updateJournalQty(id: string, quantity: number) {
  // Only updates if still pending — exported entries are locked.
  const { error } = await sb()
    .from(T_JOURNAL)
    .update({ quantity })
    .eq("id", id)
    .eq("exported", false);
  if (error) throw error;
}

export async function deleteJournalIfPending(id: string) {
  const { error } = await sb()
    .from(T_JOURNAL)
    .delete()
    .eq("id", id)
    .eq("exported", false);
  if (error) throw error;
}

export async function deletePendingJournalsForCarton(cartonId: string) {
  const { error } = await sb()
    .from(T_JOURNAL)
    .delete()
    .eq("cartonId", cartonId)
    .eq("exported", false);
  // If the cartonId column doesn't exist (legacy schema), skip silently.
  if (error && !/cartonId/i.test(error.message) && error.code !== "PGRST204") {
    throw error;
  }
}

export async function countJournal(): Promise<number> {
  const { count, error } = await sb().from(T_JOURNAL).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function markJournalExported(ids: string[]) {
  if (!ids.length) return;
  const postingDate = new Date().toISOString().slice(0, 10);
  const { error } = await sb()
    .from(T_JOURNAL)
    .update({ exported: true, exportedAt: new Date().toISOString(), postingDate })
    .in("id", ids);
  if (error) throw error;
}

export async function unexportJournal(id: string) {
  const { error } = await sb()
    .from(T_JOURNAL)
    .update({
      exported: false,
      exportedAt: null,
      postingDate: null,
      applied: false,
      appliedAt: null,
    })
    .eq("id", id);
  if (error) throw error;
}

// ============ APPLIED RECONCILE ============
// Per-candidate exact-match probe. We avoid bulk-fetching all ledger
// externalDocNo values because the Supabase REST default of 1000 rows can
// silently truncate the set when the Ledger holds thousands of entries —
// which was making some Transfers stay "รอ D365" even though their
// External Doc No. was present in the new Ledger.
export async function markAppliedFromLedger(): Promise<{
  newlyApplied: number;
  appliedDocs: string[];
}> {
  const { data: candidates, error: e1 } = await sb()
    .from(T_TRANSFERS)
    .select("id, externalDocNo, closed, applied")
    .eq("closed", true);
  if (e1) throw e1;

  const pending = (candidates ?? []).filter(
    (t: any) => !t.applied && (t.externalDocNo ?? "").trim() !== "",
  );

  const ids: string[] = [];
  const doneDocs: string[] = [];
  for (const t of pending as Pick<Transfer, "id" | "externalDocNo">[]) {
    const d = (t.externalDocNo ?? "").trim();
    const { count, error } = await sb()
      .from(T_LEDGER)
      .select("entryNo", { count: "exact", head: true })
      .eq("externalDocNo", d);
    if (error) continue;
    if ((count ?? 0) > 0) {
      ids.push(t.id);
      doneDocs.push(d);
    }
  }
  if (ids.length) {
    const { error } = await sb()
      .from(T_TRANSFERS)
      .update({ applied: true, appliedAt: new Date().toISOString() })
      .in("id", ids);
    if (error) throw error;
  }
  return { newlyApplied: ids.length, appliedDocs: doneDocs };
}

// Detect Item Journal entries applied by D365 — match by Document No. in
// the Ledger (Journal lines carry Document No. directly, unlike TOs which
// get translated to TR####).
export async function markJournalAppliedFromLedger(): Promise<{
  newlyApplied: number;
  appliedDocs: string[];
}> {
  const { data: candidates, error: e1 } = await sb()
    .from(T_JOURNAL)
    .select("id, documentNo, exported, applied")
    .eq("exported", true);
  if (e1) throw e1;

  const pending = (candidates ?? []).filter(
    (j: any) => !j.applied && (j.documentNo ?? "").trim() !== "",
  );

  const ids: string[] = [];
  const doneDocs: string[] = [];
  for (const j of pending as Pick<ItemJournalEntry, "id" | "documentNo">[]) {
    const d = (j.documentNo ?? "").trim();
    const { count, error } = await sb()
      .from(T_LEDGER)
      .select("entryNo", { count: "exact", head: true })
      .eq("documentNo", d);
    if (error) continue;
    if ((count ?? 0) > 0) {
      ids.push(j.id);
      doneDocs.push(d);
    }
  }
  if (ids.length) {
    const { error } = await sb()
      .from(T_JOURNAL)
      .update({ applied: true, appliedAt: new Date().toISOString() })
      .in("id", ids);
    if (error) throw error;
  }
  return { newlyApplied: ids.length, appliedDocs: doneDocs };
}

// ============ CLEAR ALL ============
export async function clearAll() {
  const r1 = await sb().rpc("truncate_items");
  if (r1.error) await sb().from(T_ITEMS).delete().gte("itemNo", "");
  const r2 = await sb().rpc("truncate_ledger");
  if (r2.error) await sb().from(T_LEDGER).delete().gte("entryNo", -9e18);
  const r3 = await sb().rpc("truncate_transfers");
  if (r3.error) await sb().from(T_TRANSFERS).delete().gte("id", "");
  const r4 = await sb().rpc("truncate_journal");
  if (r4.error) await sb().from(T_JOURNAL).delete().gte("id", "");
}
