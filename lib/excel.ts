"use client";
import * as XLSX from "xlsx";
import type { Item, LedgerEntry, Transfer, ItemJournalEntry } from "./types";

// DD/MM/YYYY for BC Item Journal imports. Parse ISO strings literally so
// we never round-trip through `new Date(...)` and risk a timezone shift.
function fmtDDMMYYYY(s?: string): string {
  if (!s) return "";
  const isoM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoM) {
    const y = isoM[1];
    const m = String(parseInt(isoM[2], 10)).padStart(2, "0");
    const d = String(parseInt(isoM[3], 10)).padStart(2, "0");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return (
    String(d.getDate()).padStart(2, "0") +
    "/" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "/" +
    d.getFullYear()
  );
}

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
// Convert a Date object to YYYY-MM-DD using LOCAL components. SheetJS with
// cellDates:true returns dates in local time (it builds them via
// `new Date(year, month-1, day)`), so `.toISOString()` would shift the
// timestamp into UTC and, in any east-of-UTC zone like Thailand (+7),
// rewrite "31 May" as "30 May". This off-by-one was the source of the
// Ledger upload date drift.
function dateToYMD(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function toDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return undefined;
    return dateToYMD(v);
  }
  const s = String(v).trim();
  if (!s) return undefined;
  // Already ISO YYYY-MM-DD (with or without a time portion)
  const isoM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoM) {
    const y = isoM[1];
    const mo = String(parseInt(isoM[2], 10)).padStart(2, "0");
    const d = String(parseInt(isoM[3], 10)).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  // DD/MM/YYYY or D/M/YYYY (also accepts - or . as separator)
  const ddmmM = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (ddmmM) {
    const d = parseInt(ddmmM[1], 10);
    const m = parseInt(ddmmM[2], 10);
    const y = parseInt(ddmmM[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  // Last-resort fallback
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return s;
  return dateToYMD(dt);
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
        unitPrice: toNum(r["Unit Price Including VAT"] ?? r["Unit Price"]),
        itemCategoryDes: toStr(r["Item Category Des"]),
        productGroupDes: toStr(r["Product Group Des"]),
        divisionCode: toStr(r["Division Code"]),
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

// ---------- Item Journal (BC import) ----------
// Each entry → 2 rows: Negative Adjmt. (old lot) + Positive Adjmt. (new lot)
export function exportJournalToBC(
  entries: ItemJournalEntry[],
  postingDateISO?: string,
): { blob: Blob; included: number; skipped: number } {
  const postingDate = fmtDDMMYYYY(postingDateISO ?? new Date().toISOString());
  const rows: any[] = [];
  let included = 0;
  let skipped = 0;
  for (const e of entries) {
    if (!e.documentNo || !e.newLotNo || !e.oldLotNo || !e.quantity) {
      skipped++;
      continue;
    }
    rows.push({
      "Posting Date": postingDate,
      "Entry Type": "Negative Adjmt.",
      "Document No.": e.documentNo,
      "Group Document No.": "",
      "Item No.": e.itemNo,
      Location: e.locationCode,
      "QTY.": e.quantity,
      "Unit of Measure Code": e.uom ?? "",
      LOT: e.oldLotNo,
      EXP: fmtDDMMYYYY(e.oldExpirationDate),
    });
    rows.push({
      "Posting Date": postingDate,
      "Entry Type": "Positive Adjmt.",
      "Document No.": e.documentNo,
      "Group Document No.": "",
      "Item No.": e.itemNo,
      Location: e.locationCode,
      "QTY.": e.quantity,
      "Unit of Measure Code": e.uom ?? "",
      LOT: e.newLotNo,
      EXP: fmtDDMMYYYY(e.newExpirationDate),
    });
    included++;
  }
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [
      "Posting Date",
      "Entry Type",
      "Document No.",
      "Group Document No.",
      "Item No.",
      "Location",
      "QTY.",
      "Unit of Measure Code",
      "LOT",
      "EXP",
    ],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Import to BC");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return {
    blob: new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    included,
    skipped,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
