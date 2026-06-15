"use client";
import { useEffect, useMemo, useState } from "react";
import {
  listJournalEntries,
  markJournalExported,
  unexportJournal,
} from "@/lib/db";
import { exportJournalToBC, downloadBlob } from "@/lib/excel";
import type { ItemJournalEntry } from "@/lib/types";
import {
  DownloadIcon,
  LockIcon,
  UnlockIcon,
  CheckIcon,
  AlertIcon,
  JournalIcon,
} from "./Icons";

export function Journal() {
  const [entries, setEntries] = useState<ItemJournalEntry[]>([]);
  const [filter, setFilter] = useState<"pending" | "exported" | "applied" | "all">("pending");
  const [q, setQ] = useState("");

  async function refresh() {
    setEntries(await listJournalEntries());
  }
  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filter === "pending" && (e.exported || e.applied)) return false;
      if (filter === "exported" && (!e.exported || e.applied)) return false;
      if (filter === "applied" && !e.applied) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${e.documentNo} ${e.itemNo} ${e.oldLotNo} ${e.newLotNo} ${e.description ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [entries, filter, q]);

  const stats = useMemo(() => {
    const pending = entries.filter((e) => !e.exported && !e.applied).length;
    const exported = entries.filter((e) => e.exported && !e.applied).length;
    const applied = entries.filter((e) => e.applied).length;
    const pendingQty = entries
      .filter((e) => !e.exported && !e.applied)
      .reduce((s, e) => s + Number(e.quantity || 0), 0);
    return { total: entries.length, pending, exported, applied, pendingQty };
  }, [entries]);

  async function unexport(e: ItemJournalEntry) {
    if (e.applied) {
      alert("Applied แล้ว — ยกเลิกไม่ได้");
      return;
    }
    if (!confirm("ยกเลิก Export รายการนี้?")) return;
    await unexportJournal(e.id);
    await refresh();
  }

  async function exportAll() {
    if (filtered.length === 0) {
      alert("ไม่มีรายการให้ export");
      return;
    }
    const exportable = filtered.filter((e) => !e.applied);
    if (exportable.length === 0) {
      alert("รายการที่กรองเป็น Applied ทั้งหมด — D365 มีอยู่แล้ว");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const { blob, included, skipped } = exportJournalToBC(exportable, today);
    if (included === 0) {
      alert("ไม่มีรายการที่ export ได้");
      return;
    }
    downloadBlob(blob, `ItemJournal-LOT60008-${today}.xlsx`);
    const idsToMark = exportable.filter((e) => !e.exported).map((e) => e.id);
    if (idsToMark.length) {
      await markJournalExported(idsToMark);
      await refresh();
    }
    if (skipped > 0) {
      setTimeout(
        () =>
          alert(
            `Export สำเร็จ\n• รวมในไฟล์: ${included} รายการ\n• ข้าม: ${skipped} รายการ`,
          ),
        100,
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 no-print">
        <StatCard label="ทั้งหมด" value={stats.total} tone="slate" />
        <StatCard label="รอ Export" value={stats.pending} tone="amber" />
        <StatCard label="Exported (รอ D365)" value={stats.exported} tone="indigo" />
        <StatCard label="Applied" value={stats.applied} tone="emerald" />
        <StatCard label="qty รอ Export" value={stats.pendingQty} tone="slate" />
      </div>

      <div className="bg-indigo-50/40 border border-indigo-200 rounded-2xl p-4 text-sm text-indigo-900">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 grid place-items-center shrink-0">
            <JournalIcon className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">หน้า Export Item Journal</div>
            <div className="text-xs text-indigo-800 mt-0.5">
              รายการ Journal ทั้งหมดถูกสร้างจากแท็บ "สแกน & สร้างลัง" (ผ่านปุ่ม{" "}
              <span className="font-mono">แก้ LOT</span>) — แท็บนี้ใช้สำหรับดู / Export
              ทั้งหมดเป็น Excel เพื่อ import เข้า D365 อย่างเดียว
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="flex bg-slate-100 p-1 rounded-lg">
          {(["all", "pending", "exported", "applied"] as const).map((k) => {
            const labels = {
              all: "ทั้งหมด",
              pending: "รอ Export",
              exported: "Exported",
              applied: "Applied",
            };
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  on ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {labels[k]}
              </button>
            );
          })}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา Doc No. / Item / Lot"
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <button
          onClick={exportAll}
          disabled={filtered.length === 0}
          title="รวมรายการ Journal ที่กรองอยู่เป็นไฟล์ Excel เดียว"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition"
        >
          <DownloadIcon /> Export Excel ({filtered.length})
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <JournalIcon className="w-10 h-10 mx-auto text-slate-300" />
            <div className="text-sm text-slate-400 mt-2">
              {entries.length === 0 ? "ยังไม่มี Journal entry" : "ไม่มีรายการที่ตรงกับเงื่อนไข"}
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="text-left px-4 py-2.5 font-medium">วันที่</th>
                <th className="text-left px-4 py-2.5 font-medium">Document No.</th>
                <th className="text-left px-4 py-2.5 font-medium">Item</th>
                <th className="text-left px-4 py-2.5 font-medium">Old → New</th>
                <th className="text-right px-4 py-2.5 font-medium">QTY</th>
                <th className="text-left px-4 py-2.5 font-medium">Location</th>
                <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    <div>{new Date(e.createdAt).toLocaleDateString("th-TH")}</div>
                    <div className="text-[10px] text-slate-400">
                      {new Date(e.createdAt).toLocaleTimeString("th-TH", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs text-indigo-700 font-semibold">
                      {e.documentNo}
                    </div>
                    {e.cartonId && (
                      <div className="text-[10px] text-slate-400 font-mono">{e.cartonId}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs">{e.itemNo}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[240px]">
                      {e.description}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <div className="font-mono">
                      <span className="text-rose-500">−{e.oldLotNo}</span>{" "}
                      <span className="text-slate-400">→</span>{" "}
                      <span className="text-emerald-600 font-semibold">+{e.newLotNo}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {e.oldExpirationDate || "—"} → {e.newExpirationDate || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold">{e.quantity}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-600">
                    {e.locationCode}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <JournalStatusBadge e={e} />
                    {e.applied && e.appliedAt && (
                      <div className="text-[9px] text-slate-400 mt-0.5">
                        {new Date(e.appliedAt).toLocaleDateString("th-TH")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 justify-end">
                      {e.exported && !e.applied && (
                        <button
                          onClick={() => unexport(e)}
                          title="ยกเลิก Export"
                          className="p-1.5 rounded-md text-amber-600 hover:bg-amber-50"
                        >
                          <UnlockIcon />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "emerald" | "indigo";
}) {
  const tones = {
    slate: "from-slate-50 to-white border-slate-200 text-slate-700",
    amber: "from-amber-50 to-white border-amber-200 text-amber-700",
    emerald: "from-emerald-50 to-white border-emerald-200 text-emerald-700",
    indigo: "from-indigo-50 to-white border-indigo-200 text-indigo-700",
  };
  return (
    <div
      className={`bg-gradient-to-br ${tones[tone]} border rounded-2xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]`}
    >
      <div className="text-[11px] uppercase tracking-wide font-semibold opacity-70">
        {label}
      </div>
      <div className="text-2xl font-extrabold mt-0.5">{value}</div>
    </div>
  );
}

function JournalStatusBadge({ e }: { e: ItemJournalEntry }) {
  if (e.applied) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-semibold rounded-full">
        <CheckIcon className="w-3 h-3" /> Applied
      </span>
    );
  }
  if (e.exported) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-semibold rounded-full">
        <LockIcon className="w-3 h-3" /> Exported
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded-full">
      <AlertIcon className="w-3 h-3" /> รอ Export
    </span>
  );
}
