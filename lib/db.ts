"use client";
import { sb, isConfigured } from "./supabase";
import type { Item, LedgerEntry, Transfer, StockSummary } from "./types";

export { isConfigured };
export const EXTERNAL_DOC_PREFIX = "TO08EXP-";
export const EXTERNAL_DOC_PAD = 4;

const T_ITEMS = "items";
const T_LEDGER = "ledger";
const T_TRANSFERS = "transfers";

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

export async function upsertItems(items: Item[]): Promise<number> {
  if (!items.length) return 0;
  const CHUNK = 1000;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const { error } = await sb().from(T_ITEMS).upsert(slice, { onConflict: "itemNo" });
    if (error) throw error;
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
  // truncate via RPC (fast). If RPC missing, fall back to filtered delete.
  const rpc = await sb().rpc("truncate_ledger");
  if (rpc.error) {
    const del = await sb().from(T_LEDGER).delete().gte("entryNo", -9e18);
    if (del.error) throw del.error;
  }
  return appendLedger(entries, onProgress);
}

export async function appendLedger(
  entries: LedgerEntry[],
  onProgress?: (n: number, total: number) => void,
): Promise<number> {
  if (!entries.length) return 0;
  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const { error } = await sb().from(T_LEDGER).upsert(slice, { onConflict: "entryNo" });
    if (error) throw error;
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
  const { data, error } = await sb()
    .from(T_TRANSFERS)
    .select("*")
    .order("createdAt", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Transfer[];
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
  const { error } = await sb().from(T_TRANSFERS).delete().eq("id", id);
  if (error) throw error;
}

// ============ APPLIED RECONCILE ============
export async function markAppliedFromLedger(): Promise<{
  newlyApplied: number;
  appliedDocs: string[];
}> {
  // Get distinct externalDocNo seen in Ledger via RPC (fast).
  let docs = new Set<string>();
  const r = await sb().rpc("distinct_external_docs");
  if (!r.error && Array.isArray(r.data)) {
    for (const v of r.data as string[]) {
      const d = (v ?? "").toString().trim();
      if (d) docs.add(d);
    }
  } else {
    // Fallback: pull externalDocNo column and dedupe client-side
    const { data, error } = await sb()
      .from(T_LEDGER)
      .select("externalDocNo")
      .not("externalDocNo", "is", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const d = ((row as any).externalDocNo ?? "").toString().trim();
      if (d) docs.add(d);
    }
  }

  // Find candidate transfers
  const { data: candidates, error: e2 } = await sb()
    .from(T_TRANSFERS)
    .select("id, externalDocNo, closed, applied")
    .eq("closed", true)
    .or("applied.is.null,applied.eq.false");
  if (e2) throw e2;

  const ids: string[] = [];
  const doneDocs: string[] = [];
  for (const t of (candidates ?? []) as Pick<
    Transfer,
    "id" | "externalDocNo" | "closed" | "applied"
  >[]) {
    const d = (t.externalDocNo ?? "").trim();
    if (d && docs.has(d)) {
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

// ============ CLEAR ALL ============
export async function clearAll() {
  const r1 = await sb().rpc("truncate_items");
  if (r1.error) await sb().from(T_ITEMS).delete().gte("itemNo", "");
  const r2 = await sb().rpc("truncate_ledger");
  if (r2.error) await sb().from(T_LEDGER).delete().gte("entryNo", -9e18);
  const r3 = await sb().rpc("truncate_transfers");
  if (r3.error) await sb().from(T_TRANSFERS).delete().gte("id", "");
}
