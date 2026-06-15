"use client";
import { useRef, useState } from "react";
import { readWorkbook, sheetRows, parseItemMaster, parseLedger } from "@/lib/excel";
import { upsertItems, replaceLedger, appendLedger, clearAll, db } from "@/lib/db";

type Mode = "items" | "ledger-replace" | "ledger-append";

export function Upload() {
  const itemsRef = useRef<HTMLInputElement>(null);
  const ledgerRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [counts, setCounts] = useState<{ items: number; ledger: number; transfers: number } | null>(
    null
  );

  async function refreshCounts() {
    const [items, ledger, transfers] = await Promise.all([
      db().items.count(),
      db().ledger.count(),
      db().transfers.count(),
    ]);
    setCounts({ items, ledger, transfers });
  }

  async function handleItems(f: File) {
    setBusy("items");
    setMsg("กำลังอ่านไฟล์...");
    const wb = await readWorkbook(f);
    const rows = sheetRows(wb);
    const items = parseItemMaster(rows);
    const n = await upsertItems(items);
    setMsg(`อัพเดต Item Master สำเร็จ: ${n.toLocaleString()} รายการ`);
    await refreshCounts();
    setBusy(null);
  }

  async function handleLedger(f: File, replace: boolean) {
    setBusy(replace ? "ledger-replace" : "ledger-append");
    setMsg("กำลังอ่านไฟล์...");
    const wb = await readWorkbook(f);
    const rows = sheetRows(wb);
    const entries = parseLedger(rows);
    const n = replace ? await replaceLedger(entries) : await appendLedger(entries);
    setMsg(
      `${replace ? "แทนที่" : "เพิ่ม"} Ledger สำเร็จ: ${n.toLocaleString()} รายการ`
    );
    await refreshCounts();
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-4 border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-2">1. Item Master</h3>
        <p className="text-sm text-slate-500 mb-3">
          ใช้ map Barcode → Item No. และ Description (รูปแบบเดียวกับ itemmasterdb.xlsx)
        </p>
        <div className="flex gap-2 items-center">
          <input
            ref={itemsRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="text-sm"
            disabled={busy !== null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleItems(f);
              e.target.value = "";
            }}
          />
          {busy === "items" && <span className="text-sm text-slate-500">กำลังโหลด...</span>}
        </div>
      </div>

      <div className="bg-white rounded-lg p-4 border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-2">2. Item Ledger Entry</h3>
        <p className="text-sm text-slate-500 mb-3">
          รูปแบบเดียวกับ Database_exp08.xlsx — เก็บ Lot, Exp Date, Location, Remaining Quantity
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="px-3 py-1.5 bg-slate-800 text-white text-sm rounded cursor-pointer hover:bg-slate-700">
            แทนที่ทั้งหมด (Replace)
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLedger(f, true);
                e.target.value = "";
              }}
            />
          </label>
          <label className="px-3 py-1.5 border border-slate-300 text-sm rounded cursor-pointer hover:bg-slate-100">
            เพิ่มต่อ (Append)
            <input
              ref={ledgerRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLedger(f, false);
                e.target.value = "";
              }}
            />
          </label>
          {busy?.startsWith("ledger") && (
            <span className="text-sm text-slate-500">กำลังโหลด...</span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg p-4 border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-2">สถานะข้อมูล</h3>
        <button
          className="text-sm underline text-slate-600"
          onClick={refreshCounts}
        >
          ตรวจสอบจำนวนข้อมูล
        </button>
        {counts && (
          <ul className="mt-2 text-sm text-slate-700 space-y-1">
            <li>Items: {counts.items.toLocaleString()}</li>
            <li>Ledger entries: {counts.ledger.toLocaleString()}</li>
            <li>Transfers (TO): {counts.transfers.toLocaleString()}</li>
          </ul>
        )}
      </div>

      <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
        <h3 className="font-semibold text-rose-800 mb-1">ล้างข้อมูลทั้งหมด</h3>
        <p className="text-xs text-rose-700 mb-2">
          เคลียร์ทั้ง Item Master, Ledger และ Transfer ที่สร้างไว้
        </p>
        <button
          className="px-3 py-1.5 bg-rose-600 text-white text-sm rounded hover:bg-rose-700"
          onClick={async () => {
            if (!confirm("ยืนยันลบข้อมูลทั้งหมด?")) return;
            await clearAll();
            await refreshCounts();
            setMsg("ล้างข้อมูลแล้ว");
          }}
        >
          ล้างทั้งหมด
        </button>
      </div>

      {msg && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          {msg}
        </div>
      )}
    </div>
  );
}
