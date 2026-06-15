"use client";
import { useEffect, useState } from "react";
import { readWorkbook, sheetRows, parseItemMaster, parseLedger } from "@/lib/excel";
import { upsertItems, replaceLedger, appendLedger, clearAll, db } from "@/lib/db";
import { UploadIcon, DatabaseIcon, CheckIcon, TrashIcon } from "./Icons";

type Mode = "items" | "ledger-replace" | "ledger-append";

export function Upload() {
  const [busy, setBusy] = useState<Mode | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [counts, setCounts] = useState<{ items: number; ledger: number; transfers: number }>({
    items: 0,
    ledger: 0,
    transfers: 0,
  });

  async function refreshCounts() {
    const [items, ledger, transfers] = await Promise.all([
      db().items.count(),
      db().ledger.count(),
      db().transfers.count(),
    ]);
    setCounts({ items, ledger, transfers });
  }

  useEffect(() => {
    refreshCounts();
  }, []);

  async function handleItems(f: File) {
    setBusy("items");
    setMsg(null);
    try {
      const wb = await readWorkbook(f);
      const rows = sheetRows(wb);
      const items = parseItemMaster(rows);
      const n = await upsertItems(items);
      setMsg({ kind: "ok", text: `อัพเดต Item Master สำเร็จ: ${n.toLocaleString()} รายการ` });
      await refreshCounts();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "Error" });
    }
    setBusy(null);
  }

  async function handleLedger(f: File, replace: boolean) {
    setBusy(replace ? "ledger-replace" : "ledger-append");
    setMsg(null);
    try {
      const wb = await readWorkbook(f);
      const rows = sheetRows(wb);
      const entries = parseLedger(rows);
      const n = replace ? await replaceLedger(entries) : await appendLedger(entries);
      setMsg({
        kind: "ok",
        text: `${replace ? "แทนที่" : "เพิ่ม"} Ledger สำเร็จ: ${n.toLocaleString()} รายการ`,
      });
      await refreshCounts();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "Error" });
    }
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      {/* Status row */}
      <div className="grid grid-cols-3 gap-3">
        <CountCard label="Item Master" value={counts.items} />
        <CountCard label="Ledger Entries" value={counts.ledger} />
        <CountCard label="Transfers (TO)" value={counts.transfers} />
      </div>

      {/* Upload cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <UploadCard
          step="1"
          title="Item Master"
          description="map Barcode → Item No. + Description (รูปแบบเดียวกับ itemmasterdb.xlsx)"
          accept=".xlsx,.xls,.csv"
          busy={busy === "items"}
          buttons={[
            {
              label: "เลือกไฟล์ (Upsert)",
              primary: true,
              onFile: handleItems,
            },
          ]}
        />
        <UploadCard
          step="2"
          title="Item Ledger Entry"
          description="lot, exp date, location, remaining quantity (รูปแบบเดียวกับ Database_exp08.xlsx)"
          accept=".xlsx,.xls,.csv"
          busy={busy?.startsWith("ledger") ?? false}
          buttons={[
            {
              label: "แทนที่ทั้งหมด (Replace)",
              primary: true,
              onFile: (f) => handleLedger(f, true),
            },
            {
              label: "เพิ่มต่อ (Append)",
              onFile: (f) => handleLedger(f, false),
            },
          ]}
        />
      </div>

      {/* Message */}
      {msg && (
        <div
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border ${
            msg.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-700 border-rose-200"
          }`}
        >
          <CheckIcon className="w-4 h-4" />
          {msg.text}
        </div>
      )}

      {/* Danger zone */}
      <div className="bg-rose-50/40 border border-rose-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 grid place-items-center shrink-0">
            <TrashIcon className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-rose-900">ล้างข้อมูลทั้งหมด</div>
            <div className="text-xs text-rose-700 mt-0.5">
              เคลียร์ทั้ง Item Master, Ledger และ Transfer ที่สร้างไว้
            </div>
          </div>
          <button
            className="px-3 py-1.5 bg-rose-600 text-white text-sm font-medium rounded-lg hover:bg-rose-700 transition"
            onClick={async () => {
              if (!confirm("ยืนยันลบข้อมูลทั้งหมด?")) return;
              await clearAll();
              await refreshCounts();
              setMsg({ kind: "ok", text: "ล้างข้อมูลแล้ว" });
            }}
          >
            ล้างทั้งหมด
          </button>
        </div>
      </div>
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wide font-semibold">
        <DatabaseIcon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-extrabold text-slate-900 mt-1">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function UploadCard({
  step,
  title,
  description,
  accept,
  busy,
  buttons,
}: {
  step: string;
  title: string;
  description: string;
  accept: string;
  busy: boolean;
  buttons: Array<{
    label: string;
    primary?: boolean;
    onFile: (f: File) => void;
  }>;
}) {
  return (
    <div className="bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 grid place-items-center font-bold text-sm">
          {step}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-500">{description}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {buttons.map((b, i) => (
          <label
            key={i}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer transition ${
              b.primary
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            } ${busy ? "opacity-50 pointer-events-none" : ""}`}
          >
            <UploadIcon className="w-3.5 h-3.5" />
            {b.label}
            <input
              type="file"
              accept={accept}
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) b.onFile(f);
                e.target.value = "";
              }}
            />
          </label>
        ))}
        {busy && <span className="text-xs text-slate-500 self-center">กำลังโหลด...</span>}
      </div>
    </div>
  );
}
