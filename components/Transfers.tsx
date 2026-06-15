"use client";
import { useEffect, useState } from "react";
import {
  listTransfers,
  saveTransfer,
  closeTransfer,
  reopenTransfer,
  deleteTransferAndRevert,
} from "@/lib/db";
import { exportTransferToBC, downloadBlob } from "@/lib/excel";
import type { Transfer } from "@/lib/types";

export function Transfers() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [printing, setPrinting] = useState<Transfer | null>(null);

  async function refresh() {
    setItems(await listTransfers());
  }
  useEffect(() => {
    refresh();
  }, []);

  async function editDocNo(t: Transfer) {
    const v = prompt("External Document No.", t.externalDocNo ?? "");
    if (v === null) return;
    await saveTransfer({ ...t, externalDocNo: v.trim() });
    await refresh();
  }

  async function reopen(t: Transfer) {
    if (!confirm("เปิดลังนี้กลับมาแก้ไข?\nระบบจะคืนยอด Ledger ที่หักไว้กลับมาเหมือนเดิม")) return;
    await reopenTransfer(t);
    await refresh();
  }
  async function close(t: Transfer) {
    const docNo = prompt(
      "ระบุ External Document No. ก่อนปิดลัง:",
      t.externalDocNo ?? ""
    );
    if (docNo === null) return;
    await closeTransfer(t, docNo);
    await refresh();
  }
  async function remove(t: Transfer) {
    const msg = t.closed
      ? "ลบลังนี้?\nยอด Ledger ที่หักไว้จะถูกคืนกลับ"
      : "ลบลังนี้?";
    if (!confirm(msg)) return;
    await deleteTransferAndRevert(t.id);
    await refresh();
  }

  function printCover(t: Transfer) {
    setPrinting(t);
    setTimeout(() => window.print(), 100);
  }

  function exportBC(t: Transfer) {
    if (!t.externalDocNo) {
      alert("กรุณาระบุ External Document No. ก่อน Export");
      return;
    }
    const blob = exportTransferToBC(t);
    downloadBlob(blob, `${t.externalDocNo || t.id}.xlsx`);
  }

  return (
    <div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden no-print">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-2">วันที่</th>
              <th className="text-left p-2">External Doc</th>
              <th className="text-left p-2">เส้นทาง</th>
              <th className="text-right p-2">โอน</th>
              <th className="text-right p-2">โอนแล้ว (ref)</th>
              <th className="text-center p-2">สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-400">
                  ยังไม่มีลังที่สร้างไว้
                </td>
              </tr>
            ) : (
              items.map((t) => {
                const toMove = t.lines.filter((l) => !l.alreadyExp).length;
                const already = t.lines.filter((l) => l.alreadyExp).length;
                return (
                  <tr key={t.id} className="border-t border-slate-200">
                    <td className="p-2 text-slate-600 text-xs whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleString("th-TH")}
                    </td>
                    <td className="p-2 font-mono">
                      <button onClick={() => editDocNo(t)} className="hover:underline">
                        {t.externalDocNo || <span className="text-slate-400">(คลิกเพื่อระบุ)</span>}
                      </button>
                    </td>
                    <td className="p-2 text-xs">
                      {t.locationFrom} → {t.locationTo}
                    </td>
                    <td className="p-2 text-right">{toMove}</td>
                    <td className="p-2 text-right text-emerald-700">{already}</td>
                    <td className="p-2 text-center">
                      {t.closed ? (
                        <span className="px-2 py-0.5 bg-slate-800 text-white text-xs rounded">
                          ปิดแล้ว
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                          เปิดอยู่
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-1 flex-wrap justify-end">
                        <button
                          onClick={() => printCover(t)}
                          className="px-2 py-1 text-xs bg-slate-800 text-white rounded hover:bg-slate-700"
                        >
                          พิมพ์ใบปะหน้า
                        </button>
                        <button
                          onClick={() => exportBC(t)}
                          className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-100"
                        >
                          Export BC
                        </button>
                        {t.closed ? (
                          <button
                            onClick={() => reopen(t)}
                            className="px-2 py-1 text-xs text-amber-700 hover:underline"
                          >
                            เปิดแก้
                          </button>
                        ) : (
                          <button
                            onClick={() => close(t)}
                            className="px-2 py-1 text-xs text-slate-700 hover:underline"
                          >
                            ปิด
                          </button>
                        )}
                        <button
                          onClick={() => remove(t)}
                          className="px-2 py-1 text-xs text-rose-600 hover:underline"
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {printing && <PrintCover t={printing} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function PrintCover({ t, onDone }: { t: Transfer; onDone: () => void }) {
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, [onDone]);

  const toMove = t.lines.filter((l) => !l.alreadyExp);
  const already = t.lines.filter((l) => l.alreadyExp);

  return (
    <div id="print-area" className="bg-white p-6 mt-6 border border-slate-200 rounded">
      <div className="flex justify-between items-start border-b pb-3 mb-3">
        <div>
          <h1 className="text-xl font-bold">ใบปะหน้าลัง Short EXP</h1>
          <div className="text-sm text-slate-600 mt-1">
            From: <b>{t.storeFrom}</b> ({t.locationFrom}) → To: <b>{t.storeTo}</b> ({t.locationTo})
          </div>
        </div>
        <div className="text-right text-sm">
          <div>
            External Doc No.: <span className="font-mono font-semibold">{t.externalDocNo || "-"}</span>
          </div>
          <div>
            Carton ID: <span className="font-mono">{t.id}</span>
          </div>
          <div>วันที่: {new Date(t.createdAt).toLocaleString("th-TH")}</div>
        </div>
      </div>

      <Section
        title={`รายการที่ต้องโอน (60008 → 60008-EXP) — ${toMove.length} รายการ`}
        rows={toMove}
        emptyText="ไม่มี"
      />
      <div className="h-4" />
      <Section
        title={`รายการในลังที่อยู่ที่ 60008-EXP แล้ว (อ้างอิง) — ${already.length} รายการ`}
        rows={already}
        emptyText="ไม่มี"
      />

      <div className="grid grid-cols-3 gap-8 mt-12 text-sm">
        <Sig label="ผู้จัดลัง" />
        <Sig label="ผู้ตรวจสอบ" />
        <Sig label="ผู้รับ" />
      </div>

      <div className="mt-6 no-print text-right">
        <button
          onClick={() => window.print()}
          className="px-3 py-1.5 bg-slate-800 text-white text-sm rounded"
        >
          พิมพ์
        </button>
        <button onClick={onDone} className="px-3 py-1.5 ml-2 text-sm">
          ปิด
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: Transfer["lines"];
  emptyText: string;
}) {
  return (
    <div>
      <h2 className="font-semibold mb-1">{title}</h2>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500 italic">{emptyText}</div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300">
              <th className="text-left p-1 w-8">#</th>
              <th className="text-left p-1">Item No.</th>
              <th className="text-left p-1">Description</th>
              <th className="text-left p-1">Lot No.</th>
              <th className="text-left p-1">Exp</th>
              <th className="text-right p-1">Qty</th>
              <th className="text-left p-1">UoM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i} className="border-b border-slate-200">
                <td className="p-1">{i + 1}</td>
                <td className="p-1 font-mono">{l.itemNo}</td>
                <td className="p-1">{l.description}</td>
                <td className="p-1 font-mono">{l.lotNo}</td>
                <td className="p-1">{l.expirationDate || "-"}</td>
                <td className="p-1 text-right">{l.quantity}</td>
                <td className="p-1">{l.uom || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Sig({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="border-b border-slate-400 h-10" />
      <div className="mt-1">{label}</div>
    </div>
  );
}
