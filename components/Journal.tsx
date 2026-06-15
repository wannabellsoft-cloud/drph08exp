"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  findItemByBarcode,
  stockForItem,
  nextJournalDocNo,
  saveJournalEntry,
  listJournalEntries,
  deleteJournalEntry,
  markJournalExported,
  unexportJournal,
  JOURNAL_LOCATION,
} from "@/lib/db";
import { exportJournalToBC, downloadBlob } from "@/lib/excel";
import type { ItemJournalEntry, StockSummary } from "@/lib/types";
import {
  ScanIcon,
  DownloadIcon,
  TrashIcon,
  LockIcon,
  UnlockIcon,
  EditIcon,
  CheckIcon,
  AlertIcon,
  PlusIcon,
} from "./Icons";

function uid() {
  return "JE-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

type Draft = {
  id: string;                 // for edit mode
  isNew: boolean;
  documentNo: string;
  itemNo: string;
  description?: string;
  locationCode: string;
  uom?: string;
  oldLotNo: string;
  oldExpirationDate?: string;
  newLotNo: string;
  newExpirationDate: string;
  quantity: number;
  maxQty: number;
};

export function Journal() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [notFound, setNotFound] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [entries, setEntries] = useState<ItemJournalEntry[]>([]);
  const [filter, setFilter] = useState<"pending" | "exported" | "applied" | "all">("pending");
  const [q, setQ] = useState("");

  async function refresh() {
    setEntries(await listJournalEntries());
  }

  useEffect(() => {
    inputRef.current?.focus();
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
    return { total: entries.length, pending, exported, applied };
  }, [entries]);

  async function lookup(code: string) {
    const c = code.trim();
    if (!c) return;
    setNotFound("");
    setStock(null);
    const item = await findItemByBarcode(c);
    if (!item) {
      setNotFound(`ไม่พบสินค้าสำหรับ "${c}"`);
      return;
    }
    const s = await stockForItem(item.itemNo);
    setStock(s);
  }

  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      lookup(barcode);
      setBarcode("");
    }
  }

  async function startEditLot(lot: StockSummary["lots"][number]) {
    if (!stock) return;
    const docNo = await nextJournalDocNo();
    setDraft({
      id: uid(),
      isNew: true,
      documentNo: docNo,
      itemNo: stock.itemNo,
      description: stock.description,
      locationCode: JOURNAL_LOCATION,
      uom: lot.uom,
      oldLotNo: lot.lotNo,
      oldExpirationDate: lot.expirationDate,
      newLotNo: lot.lotNo,
      newExpirationDate: lot.expirationDate ?? "",
      quantity: lot.available > 0 ? lot.available : lot.remaining,
      maxQty: lot.remaining,
    });
  }

  function startEditEntry(e: ItemJournalEntry) {
    if (e.exported || e.applied) return;
    setDraft({
      id: e.id,
      isNew: false,
      documentNo: e.documentNo,
      itemNo: e.itemNo,
      description: e.description,
      locationCode: e.locationCode,
      uom: e.uom,
      oldLotNo: e.oldLotNo,
      oldExpirationDate: e.oldExpirationDate,
      newLotNo: e.newLotNo,
      newExpirationDate: e.newExpirationDate ?? "",
      quantity: e.quantity,
      maxQty: e.quantity,
    });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.newLotNo.trim()) {
      alert("กรุณาระบุ New LOT");
      return;
    }
    if (draft.quantity <= 0) {
      alert("Quantity ต้องมากกว่า 0");
      return;
    }
    const entry: ItemJournalEntry = {
      id: draft.id,
      documentNo: draft.documentNo.trim(),
      itemNo: draft.itemNo,
      description: draft.description,
      locationCode: draft.locationCode,
      quantity: draft.quantity,
      uom: draft.uom,
      oldLotNo: draft.oldLotNo,
      oldExpirationDate: draft.oldExpirationDate,
      newLotNo: draft.newLotNo.trim(),
      newExpirationDate: draft.newExpirationDate || undefined,
      createdAt: new Date().toISOString(),
      exported: false,
    };
    // For edit mode, preserve original createdAt
    if (!draft.isNew) {
      const existing = entries.find((x) => x.id === draft.id);
      if (existing) entry.createdAt = existing.createdAt;
    }
    await saveJournalEntry(entry);
    setDraft(null);
    await refresh();
  }

  async function removeEntry(e: ItemJournalEntry) {
    const msg = e.applied
      ? "ลบประวัติ Journal นี้?\nรายการนี้ Applied แล้ว — D365 มี record อยู่"
      : e.exported
      ? "ลบรายการนี้?\nรายการถูก export แล้ว — ถ้ายังไม่ import เข้า D365 ก็ลบได้"
      : "ลบรายการนี้?";
    if (!confirm(msg)) return;
    await deleteJournalEntry(e.id);
    await refresh();
  }

  async function unexport(e: ItemJournalEntry) {
    if (e.applied) {
      alert("Applied แล้ว ไม่สามารถยกเลิก export ได้");
      return;
    }
    if (!confirm("ยกเลิก export รายการนี้กลับมาแก้?")) return;
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
      alert("ไม่มีรายการที่ export ได้ — ตรวจสอบ Doc No. / New LOT / Quantity");
      return;
    }
    downloadBlob(blob, `ItemJournal-LOT60008-${today}.xlsx`);
    // Mark only the pending ones as exported (skip already-exported to preserve postingDate)
    const idsToMark = exportable.filter((e) => !e.exported).map((e) => e.id);
    if (idsToMark.length) {
      await markJournalExported(idsToMark);
      await refresh();
    }
    if (skipped > 0) {
      setTimeout(
        () =>
          alert(
            `Export สำเร็จ\n• รวมในไฟล์: ${included} รายการ\n• ข้าม: ${skipped} รายการ (ขาด Doc No./LOT/Qty)`,
          ),
        100,
      );
    }
  }

  const expLots = stock?.lots.filter((l) => l.locationCode === JOURNAL_LOCATION) ?? [];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 no-print">
        <StatCard label="ทั้งหมด" value={stats.total} tone="slate" />
        <StatCard label="รอ Export" value={stats.pending} tone="amber" />
        <StatCard label="Exported (รอ D365)" value={stats.exported} tone="indigo" />
        <StatCard label="Applied" value={stats.applied} tone="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: scan + lots */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center">
                <ScanIcon className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Scan สินค้าใน 60008-EXP ที่ต้องแก้ LOT/EXP
                </div>
                <div className="text-xs text-slate-500">
                  ยิงบาร์โค้ดหรือพิมพ์ Item No. แล้วกด Enter
                </div>
              </div>
            </div>
            <input
              ref={inputRef}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={onScanKey}
              placeholder="เช่น 8852796203248 หรือ D21320006"
              className="w-full px-4 py-3 text-lg font-medium border-2 border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 transition"
            />
            {notFound && (
              <div className="mt-3 px-3 py-2 bg-rose-50 text-rose-700 text-sm rounded-lg border border-rose-200">
                {notFound}
              </div>
            )}
          </div>

          {stock && (
            <div className="bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="mb-3 pb-3 border-b border-slate-100">
                <div className="text-[11px] text-slate-400 font-mono">{stock.barcode}</div>
                <div className="text-xs text-slate-500 font-mono">{stock.itemNo}</div>
                <div className="font-semibold text-slate-900 text-base truncate">
                  {stock.description}
                </div>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-emerald-700">
                  Lots ใน 60008-EXP
                </span>
              </div>

              {expLots.length === 0 ? (
                <div className="text-xs text-slate-400 italic px-2 py-6 border border-dashed border-slate-200 rounded-lg text-center">
                  ไม่มีสต๊อกใน 60008-EXP สำหรับสินค้านี้
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500">
                        <th className="text-left font-medium px-2 py-1.5">Lot</th>
                        <th className="text-left font-medium px-2 py-1.5">Exp</th>
                        <th className="text-right font-medium px-2 py-1.5">คงเหลือ</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {expLots.map((l) => (
                        <tr
                          key={`${l.lotNo}|${l.locationCode}`}
                          className="border-t border-slate-100 hover:bg-slate-50/60"
                        >
                          <td className="px-2 py-1.5 font-mono text-slate-800">{l.lotNo}</td>
                          <td className="px-2 py-1.5 text-slate-600">
                            {l.expirationDate || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-bold">{l.remaining}</td>
                          <td className="px-2 py-1.5">
                            <button
                              onClick={() => startEditLot(l)}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                            >
                              <EditIcon className="w-3 h-3" /> แก้ LOT/EXP
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!stock && !notFound && (
            <div className="bg-white border border-slate-200/70 rounded-2xl p-12 text-center">
              <ScanIcon className="w-10 h-10 mx-auto text-slate-300" />
              <div className="text-sm text-slate-400 mt-2">
                ยังไม่มีการสแกน — ยิงบาร์โค้ดเพื่อค้นหาสินค้า
              </div>
            </div>
          )}
        </div>

        {/* Right: pending list */}
        <div className="lg:col-span-5">
          <div className="sticky top-20 bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-semibold text-slate-900">รอ Export</div>
              <button
                onClick={exportAll}
                disabled={stats.pending === 0}
                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
              >
                <DownloadIcon /> Export Excel
              </button>
            </div>
            {(() => {
              const pending = entries.filter((e) => !e.exported && !e.applied);
              if (pending.length === 0) {
                return (
                  <div className="text-xs text-slate-400 italic px-2 py-8 border border-dashed border-slate-200 rounded-lg text-center">
                    ยังไม่มีรายการรอ export
                  </div>
                );
              }
              return (
                <div className="space-y-1.5 max-h-[55vh] overflow-y-auto scroll-thin -mx-1 px-1">
                  {pending.map((e) => (
                    <div
                      key={e.id}
                      className="text-xs rounded-lg p-2.5 border border-amber-200 bg-amber-50/60"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[10px] font-bold text-indigo-700">
                            {e.documentNo}
                          </div>
                          <div className="font-mono text-xs font-semibold text-slate-800 mt-0.5">
                            {e.itemNo}{" "}
                            <span className="font-sans text-slate-500 font-normal">
                              · qty {e.quantity}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 truncate">
                            {e.description}
                          </div>
                          <div className="text-[11px] text-slate-700 mt-1 grid grid-cols-2 gap-x-2">
                            <span>
                              Old:{" "}
                              <span className="font-mono">{e.oldLotNo}</span>
                              {e.oldExpirationDate && (
                                <span className="text-slate-400"> · {e.oldExpirationDate}</span>
                              )}
                            </span>
                            <span>
                              New:{" "}
                              <span className="font-mono font-semibold">{e.newLotNo}</span>
                              {e.newExpirationDate && (
                                <span className="text-slate-400"> · {e.newExpirationDate}</span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <button
                            onClick={() => startEditEntry(e)}
                            className="text-[11px] text-slate-600 hover:text-indigo-600 flex items-center gap-0.5"
                          >
                            <EditIcon className="w-3 h-3" /> แก้
                          </button>
                          <button
                            onClick={() => removeEntry(e)}
                            className="text-[11px] text-rose-500 hover:text-rose-700 flex items-center gap-0.5"
                          >
                            <TrashIcon className="w-3 h-3" /> ลบ
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* All entries (filterable history) */}
      <div className="bg-white border border-slate-200/70 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">ทุกรายการ</div>
          <div className="flex bg-slate-100 p-1 rounded-lg ml-2">
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
                    on
                      ? "bg-white shadow-sm text-slate-900"
                      : "text-slate-500 hover:text-slate-700"
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
            className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">ไม่มีรายการที่ตรงกับเงื่อนไข</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="text-left px-3 py-2 font-medium">วันที่</th>
                <th className="text-left px-3 py-2 font-medium">Document No.</th>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-left px-3 py-2 font-medium">Old → New</th>
                <th className="text-right px-3 py-2 font-medium">QTY</th>
                <th className="text-center px-3 py-2 font-medium">สถานะ</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    <div>{new Date(e.createdAt).toLocaleDateString("th-TH")}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-indigo-700 font-semibold">
                    {e.documentNo}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{e.itemNo}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                      {e.description}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-mono">
                      <span className="text-rose-500">−{e.oldLotNo}</span>{" "}
                      <span className="text-slate-400">→</span>{" "}
                      <span className="text-emerald-600 font-semibold">+{e.newLotNo}</span>
                    </div>
                    {(e.oldExpirationDate || e.newExpirationDate) && (
                      <div className="text-[10px] text-slate-500">
                        {e.oldExpirationDate || "—"} → {e.newExpirationDate || "—"}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{e.quantity}</td>
                  <td className="px-3 py-2 text-center">
                    <JournalStatusBadge e={e} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      {!e.exported && !e.applied && (
                        <button
                          onClick={() => startEditEntry(e)}
                          title="แก้ไข"
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                        >
                          <EditIcon />
                        </button>
                      )}
                      {e.exported && !e.applied && (
                        <button
                          onClick={() => unexport(e)}
                          title="ยกเลิก export"
                          className="p-1.5 rounded-md text-amber-600 hover:bg-amber-50"
                        >
                          <UnlockIcon />
                        </button>
                      )}
                      <button
                        onClick={() => removeEntry(e)}
                        title="ลบ"
                        className="p-1.5 rounded-md text-rose-500 hover:bg-rose-50"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {draft && (
        <DraftModal
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}
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

function DraftModal({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm no-print">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full mx-4">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Item Journal</div>
          <h2 className="font-bold text-slate-900 text-lg">
            {draft.isNew ? "แก้ไข LOT / EXP" : "แก้ Journal Entry"}
          </h2>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <Field label="Document No.">
            <input
              value={draft.documentNo}
              onChange={(e) => onChange({ ...draft, documentNo: e.target.value })}
              className="w-full px-3 py-1.5 font-mono text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Item No.">
              <div className="px-3 py-1.5 bg-slate-100 rounded-lg font-mono text-slate-700">
                {draft.itemNo}
              </div>
            </Field>
            <Field label="Location">
              <div className="px-3 py-1.5 bg-slate-100 rounded-lg font-mono text-slate-700">
                {draft.locationCode}
              </div>
            </Field>
          </div>

          {draft.description && (
            <div className="text-xs text-slate-500 truncate">{draft.description}</div>
          )}

          <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-3">
            <div className="text-[10px] uppercase font-semibold text-rose-700 mb-2">
              Negative Adjmt. (LOT เดิม)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Old LOT">
                <div className="px-3 py-1.5 bg-white rounded-lg font-mono">{draft.oldLotNo}</div>
              </Field>
              <Field label="Old EXP">
                <div className="px-3 py-1.5 bg-white rounded-lg text-slate-700">
                  {draft.oldExpirationDate || "—"}
                </div>
              </Field>
            </div>
          </div>

          <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3">
            <div className="text-[10px] uppercase font-semibold text-emerald-700 mb-2">
              Positive Adjmt. (LOT ใหม่ที่ต้องการ)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="New LOT">
                <input
                  value={draft.newLotNo}
                  onChange={(e) => onChange({ ...draft, newLotNo: e.target.value })}
                  placeholder="ระบุ LOT ใหม่"
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
              <Field label="New EXP">
                <input
                  type="date"
                  value={draft.newExpirationDate}
                  onChange={(e) => onChange({ ...draft, newExpirationDate: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
            </div>
          </div>

          <Field label={`Quantity (สูงสุด ${draft.maxQty})`}>
            <input
              type="number"
              min={1}
              max={draft.maxQty}
              value={draft.quantity}
              onChange={(e) =>
                onChange({ ...draft, quantity: parseInt(e.target.value || "0", 10) })
              }
              className="w-32 px-3 py-1.5 text-right font-semibold border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </Field>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 rounded-b-2xl flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            ยกเลิก
          </button>
          <button
            onClick={onSave}
            className="flex items-center gap-1 px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 shadow-sm"
          >
            <PlusIcon /> {draft.isNew ? "เพิ่ม" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-0.5">
        {label}
      </div>
      {children}
    </label>
  );
}
