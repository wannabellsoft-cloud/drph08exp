"use client";
import Dexie, { Table } from "dexie";
import type { Item, LedgerEntry, Transfer, StockSummary } from "./types";

export class AppDB extends Dexie {
  items!: Table<Item, string>;
  ledger!: Table<LedgerEntry, number>;
  transfers!: Table<Transfer, string>;

  constructor() {
    super("exp_manager");
    this.version(1).stores({
      items: "itemNo, barcode, description",
      ledger:
        "entryNo, itemNo, locationCode, lotNo, [itemNo+locationCode], [itemNo+lotNo+locationCode]",
      transfers: "id, externalDocNo, closed, createdAt",
    });
    this.version(2).stores({
      items: "itemNo, barcode, description",
      ledger:
        "entryNo, itemNo, locationCode, lotNo, sourceTransferId, [itemNo+locationCode], [itemNo+lotNo+locationCode]",
      transfers: "id, externalDocNo, closed, createdAt",
    });
    // v3 cleans up any synthetic ledger entries created by an earlier
    // version of the app — we no longer mutate the ledger when a transfer
    // is closed; "available" is computed by subtracting reservations.
    this.version(3).upgrade(async (tx) => {
      await tx
        .table("ledger")
        .filter((e: LedgerEntry) => !!e.sourceTransferId)
        .delete();
    });
    // v4 adds an index on Ledger.externalDocNo so we can quickly detect
    // when D365 has applied a TO; and an applied index on Transfers.
    this.version(4).stores({
      items: "itemNo, barcode, description",
      ledger:
        "entryNo, itemNo, locationCode, lotNo, externalDocNo, sourceTransferId, [itemNo+locationCode], [itemNo+lotNo+locationCode]",
      transfers: "id, externalDocNo, closed, applied, createdAt",
    });
  }
}

let _db: AppDB | null = null;
export function db(): AppDB {
  if (typeof window === "undefined") {
    // SSR safety — Dexie needs IndexedDB
    throw new Error("DB only available in browser");
  }
  if (!_db) _db = new AppDB();
  return _db;
}

export async function findItemByBarcode(barcode: string): Promise<Item | undefined> {
  const norm = barcode.trim();
  if (!norm) return undefined;
  // Try exact barcode match first
  const byBarcode = await db().items.where("barcode").equals(norm).first();
  if (byBarcode) return byBarcode;
  // Fallback: maybe scanner sent the item No. directly
  return await db().items.get(norm);
}

export async function stockForItem(itemNo: string): Promise<StockSummary> {
  const item = await db().items.get(itemNo);
  const entries = await db().ledger.where("itemNo").equals(itemNo).toArray();
  const map = new Map<string, StockSummary["lots"][number]>();
  for (const e of entries) {
    if (e.sourceTransferId) continue; // defensive: ignore any app-generated entries
    if (!e.remainingQuantity || e.remainingQuantity <= 0) continue;
    const key = `${e.lotNo}|${e.locationCode}`;
    const cur = map.get(key);
    if (cur) {
      cur.remaining += Number(e.remainingQuantity) || 0;
    } else {
      map.set(key, {
        lotNo: e.lotNo,
        expirationDate: e.expirationDate,
        locationCode: e.locationCode,
        remaining: Number(e.remainingQuantity) || 0,
        reserved: 0,
        available: Number(e.remainingQuantity) || 0,
        uom: e.uom,
      });
    }
  }

  // Subtract reservations from every Transfer that is NOT yet applied.
  // Applied transfers have already been processed by D365 — the new Ledger
  // upload reflects the move, so reserving again would double-count.
  const transfers = await db().transfers.toArray();
  for (const t of transfers) {
    if (t.applied) continue;
    for (const l of t.lines) {
      if (l.itemNo !== itemNo) continue;
      const loc = l.alreadyExp ? "60008-EXP" : "60008";
      const key = `${l.lotNo}|${loc}`;
      const cur = map.get(key);
      if (cur) {
        cur.reserved += Number(l.quantity) || 0;
      } else {
        // reservation for a lot we don't currently see in the ledger —
        // still surface it so users notice the inconsistency
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
  }
  for (const v of map.values()) v.available = v.remaining - v.reserved;

  const lots = Array.from(map.values()).sort((a, b) => {
    const da = a.expirationDate || "";
    const db = b.expirationDate || "";
    return da.localeCompare(db);
  });
  return {
    itemNo,
    description: item?.description,
    barcode: item?.barcode,
    lots,
  };
}

export async function upsertItems(items: Item[]) {
  if (!items.length) return 0;
  await db().items.bulkPut(items);
  return items.length;
}

export async function replaceLedger(entries: LedgerEntry[]) {
  await db().ledger.clear();
  // Chunk insert to avoid huge transactions
  const CHUNK = 5000;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await db().ledger.bulkPut(entries.slice(i, i + CHUNK));
  }
  return entries.length;
}

export async function appendLedger(entries: LedgerEntry[]) {
  const CHUNK = 5000;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await db().ledger.bulkPut(entries.slice(i, i + CHUNK));
  }
  return entries.length;
}

// Scan the current Ledger for External Document Numbers that match any
// closed-not-yet-applied transfer and flip those transfers to applied.
// Run this after every Ledger upload — it's idempotent.
export async function markAppliedFromLedger(): Promise<{
  newlyApplied: number;
  appliedDocs: string[];
}> {
  const docs = new Set<string>();
  await db().ledger.each((e) => {
    if (e.sourceTransferId) return; // defensive: ignore any legacy synthetic
    const d = (e.externalDocNo ?? "").trim();
    if (d) docs.add(d);
  });

  const transfers = await db().transfers.toArray();
  const toUpdate: Transfer[] = [];
  for (const t of transfers) {
    if (t.applied) continue;
    if (!t.closed) continue;
    const d = (t.externalDocNo ?? "").trim();
    if (!d) continue;
    if (docs.has(d)) {
      toUpdate.push({ ...t, applied: true, appliedAt: new Date().toISOString() });
    }
  }
  if (toUpdate.length) await db().transfers.bulkPut(toUpdate);
  return {
    newlyApplied: toUpdate.length,
    appliedDocs: toUpdate.map((t) => t.externalDocNo!).filter(Boolean),
  };
}

export async function saveTransfer(t: Transfer) {
  await db().transfers.put(t);
}

// Closing a transfer never mutates the Ledger — the reservation is what
// makes the qty unavailable. Ledger only changes when the exported Excel
// is imported into Dynamics 365 and the user re-uploads the new Ledger.
export const EXTERNAL_DOC_PREFIX = "TO08EXP-";
export const EXTERNAL_DOC_PAD = 4;

export async function nextExternalDocNo(): Promise<string> {
  const all = await db().transfers.toArray();
  let max = 0;
  for (const t of all) {
    const v = (t.externalDocNo ?? "").trim();
    if (!v.startsWith(EXTERNAL_DOC_PREFIX)) continue;
    const n = parseInt(v.slice(EXTERNAL_DOC_PREFIX.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${EXTERNAL_DOC_PREFIX}${String(max + 1).padStart(EXTERNAL_DOC_PAD, "0")}`;
}

export async function closeTransfer(t: Transfer, externalDocNo?: string) {
  const docNo = (externalDocNo ?? t.externalDocNo ?? "").trim() || (await nextExternalDocNo());
  const next: Transfer = {
    ...t,
    externalDocNo: docNo,
    closed: true,
    closedAt: new Date().toISOString(),
  };
  await db().transfers.put(next);
  return next;
}

export async function reopenTransfer(t: Transfer) {
  // "Cancel document" — unlocks the carton for editing. Reservations stay
  // because the lines still exist; user can adjust qty or delete lines.
  const next: Transfer = { ...t, closed: false, closedAt: undefined };
  await db().transfers.put(next);
  return next;
}

export async function deleteTransferAndRevert(id: string) {
  // Deleting a transfer releases all its reservations (handled implicitly
  // because stockForItem only sums over surviving transfers).
  await db().transfers.delete(id);
}

export async function listTransfers(): Promise<Transfer[]> {
  return await db().transfers.orderBy("createdAt").reverse().toArray();
}

export async function getTransfer(id: string): Promise<Transfer | undefined> {
  return await db().transfers.get(id);
}

export async function clearAll() {
  await db().items.clear();
  await db().ledger.clear();
  await db().transfers.clear();
}
