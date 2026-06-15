"use client";
import * as XLSX from "xlsx";
import type { Item, LedgerEntry, Transfer } from "./types";

// ---------- helpers ----------
function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : 0;
}
function toDate(v: unknown): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // Excel might serialize dates as serial numbers via cellDates:false; we use cellDates:true
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { cellDates: true });
}

export function sheetRows(wb: XLSX.WorkBook, name?: string): Record<string, unknown>[] {
  const sn = name && wb.SheetNames.includes(name) ? name : wb.SheetNames[0];
  const ws = wb.Sheets[sn];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

// ---------- Item Master ----------
export function parseItemMaster(rows: Record<string, unknown>[]): Item[] {
  return rows
    .map((r) => {
      const itemNo = toStr(r["No."] ?? r["Item No."] ?? r["No"]);
      const barcode = toStr(r["Barcode No."] ?? r["Barcode"]);
      if (!itemNo) return null;
      return {
        itemNo,
        description: toStr(r["Description"]),
        description2: toStr(r["Description 2"]),
        barcode,
        baseUom: toStr(r["Base Unit of Measure"]),
        stock: toNum(r["Stock"]),
      } as Item;
    })
    .filter((x): x is Item => !!x);
}

// ---------- Ledger ----------
export function parseLedger(rows: Record<string, unknown>[]): LedgerEntry[] {
  return rows
    .map((r) => {
      const entryNo = toNum(r["Entry No."] ?? r["EntryNo"]);
      const itemNo = toStr(r["Item No."]);
      if (!itemNo) return null;
      return {
        entryNo: entryNo || Math.floor(Math.random() * 1e12),
        postingDate: toDate(r["Posting Date"]),
        entryType: toStr(r["Entry Type"]),
        documentType: toStr(r["Document Type"]),
        documentNo: toStr(r["Document No."]),
        externalDocNo: toStr(r["External Document No."]),
        itemNo,
        description: toStr(r["Description"]),
        lotNo: toStr(r["Lot No."]),
        expirationDate: toDate(r["Expiration Date"]),
        locationCode: toStr(r["Location Code"]),
        quantity: toNum(r["Quantity"]),
        remainingQuantity: toNum(r["Remaining Quantity"]),
        uom: toStr(r["Unit of Measure Code"]),
      } as LedgerEntry;
    })
    .filter((x): x is LedgerEntry => !!x);
}

// ---------- Export TO Excel (BC import format) ----------
// Build H + L rows for one Transfer, skipping already-EXP (reference) lines.
function transferToRows(t: Transfer): any[] {
  const out: any[] = [];
  const movingLines = t.lines.filter((l) => !l.alreadyExp);
  if (movingLines.length === 0) return out;
  out.push({
    "Header And Line": "H",
    "Store-from": t.storeFrom,
    "Location-from Code": t.locationFrom,
    "Store-to": t.storeTo,
    "Location-to Code": t.locationTo,
    "Item No.": "",
    Quantity: "",
    "Lot No.": "",
    "External Document No.": t.externalDocNo ?? "",
  });
  for (const l of movingLines) {
    out.push({
      "Header And Line": "L",
      "Store-from": t.storeFrom,
      "Location-from Code": t.locationFrom,
      "Store-to": t.storeTo,
      "Location-to Code": t.locationTo,
      "Item No.": l.itemNo,
      Quantity: l.quantity,
      "Lot No.": l.lotNo,
      "External Document No.": t.externalDocNo ?? "",
    });
  }
  return out;
}

function rowsToWorkbook(rows: any[]): Blob {
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [
      "Header And Line",
      "Store-from",
      "Location-from Code",
      "Store-to",
      "Location-to Code",
      "Item No.",
      "Quantity",
      "Lot No.",
      "External Document No.",
    ],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Import to BC");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Export multiple transfers into one BC import file.
// Skips transfers that don't have an External Doc No. (still open) or have
// no movable lines (only reference rows). Returns the file plus counts.
export function exportTransfersToBC(transfers: Transfer[]): {
  blob: Blob;
  included: number;
  skipped: number;
} {
  const rows: any[] = [];
  let included = 0;
  let skipped = 0;
  for (const t of transfers) {
    if (!t.externalDocNo) {
      skipped++;
      continue;
    }
    const sub = transferToRows(t);
    if (sub.length === 0) {
      skipped++;
      continue;
    }
    rows.push(...sub);
    included++;
  }
  return { blob: rowsToWorkbook(rows), included, skipped };
}

export function exportTransferToBC(t: Transfer): Blob {
  const rows = transferToRows(t);
  if (rows.length === 0) {
    // Produce an empty stub with just the header row so the file is valid
    rows.push({
      "Header And Line": "H",
      "Store-from": t.storeFrom,
      "Location-from Code": t.locationFrom,
      "Store-to": t.storeTo,
      "Location-to Code": t.locationTo,
      "Item No.": "",
      Quantity: "",
      "Lot No.": "",
      "External Document No.": t.externalDocNo ?? "",
    });
  }
  return rowsToWorkbook(rows);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
