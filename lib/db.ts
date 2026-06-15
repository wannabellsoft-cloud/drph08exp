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
        uom: e.uom,
      });
    }
  }
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

export async function saveTransfer(t: Transfer) {
  await db().transfers.put(t);
}

export async function listTransfers(): Promise<Transfer[]> {
  return await db().transfers.orderBy("createdAt").reverse().toArray();
}

export async function getTransfer(id: string): Promise<Transfer | undefined> {
  return await db().transfers.get(id);
}

export async function deleteTransfer(id: string) {
  await db().transfers.delete(id);
}

export async function clearAll() {
  await db().items.clear();
  await db().ledger.clear();
  await db().transfers.clear();
}
