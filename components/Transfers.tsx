"use client";
import { useEffect, useMemo, useState } from "react";
import {
  listTransfers,
  saveTransfer,
  closeTransfer,
  reopenTransfer,
  deleteTransferAndRevert,
  markAppliedFromLedger,
} from "@/lib/db";

// A closed transfer with no lines that actually move (every line is just a
// 60008-EXP reference) doesn't need to be imported into D365 — there is
// nothing to ship. We surface it as "ไม่ต้องโอน" instead of the usual
// "รอ D365" so users don't keep watching it for a status flip that will
// never come.
function isRefOnly(t: Transfer): boolean {
  if (t.lines.length === 0) return false;
  return t.lines.every((l) => l.alreadyExp);
}
import { exportTransferToBC, exportTransfersToBC, downloadBlob } from "@/lib/excel";
import type { Transfer } from "@/lib/types";
import { useUI } from "./UI";
import { CoverSheet } from "./CoverSheet";
import {
  PrintIcon,
  DownloadIcon,
  TrashIcon,
  LockIcon,
  UnlockIcon,
  BoxIcon,
  CheckIcon,
  AlertIcon,
} from "./Icons";

export function Transfers() {
  const ui = useUI();
  const [items, setItems] = useState<Transfer[]>([]);
  const [printing, setPrinting] = useState<Transfer | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed" | "ref" | "applied">("all");
  const [q, setQ] = useState("");
  const [rechecking, setRechecking] = useState(false);

  async function recheckApplied() {
    setRechecking(true);
    try {
      const tr = await markAppliedFromLedger();
      await refresh();
      if (tr.newlyApplied > 0) {
        ui.ok(
          "ตรวจสอบสถานะแล้ว",
          `TO applied ${tr.newlyApplied} ลัง (${tr.appliedDocs.slice(0, 3).join(", ")}${
            tr.appliedDocs.length > 3 ? "…" : ""
          })`,
        );
      } else {
        ui.info("ตรวจสอบสถานะแล้ว", "ไม่มี TO ใหม่ที่ Applied");
      }
    } catch (e: any) {
      ui.err("ตรวจสอบไม่สำเร็จ", e?.message ?? String(e));
    }
    setRechecking(false);
  }

  async function refresh() {
    setItems(await listTransfers());
  }
  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    return items.filter((t) => {
      const refOnly = isRefOnly(t);
      if (filter === "open" && t.closed) return false;
      if (filter === "closed" && (!t.closed || t.applied || refOnly)) return false;
      if (filter === "ref" && (!t.closed || t.applied || !refOnly)) return false;
      if (filter === "applied" && !t.applied) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${t.externalDocNo ?? ""} ${t.id}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [items, filter, q]);

  const stats = useMemo(() => {
    const open = items.filter((t) => !t.closed).length;
    const closed = items.filter((t) => t.closed && !t.applied && !isRefOnly(t)).length;
    const refOnly = items.filter((t) => t.closed && !t.applied && isRefOnly(t)).length;
    const applied = items.filter((t) => t.applied).length;
    const pendingMoveQty = items
      .filter((t) => !t.applied && !isRefOnly(t))
      .reduce(
        (a, t) =>
          a + t.lines.filter((l) => !l.alreadyExp).reduce((s, l) => s + l.quantity, 0),
        0,
      );
    return { total: items.length, open, closed, refOnly, applied, pendingMoveQty };
  }, [items]);

  async function editDocNo(t: Transfer) {
    if (t.closed) {
      ui.warn("ลังนี้ปิดแล้ว", "กดยกเลิกเอกสารก่อนแก้ไข");
      return;
    }
    const v = await ui.prompt({
      title: "External Document No.",
      defaultValue: t.externalDocNo ?? "",
      placeholder: "TO08EXP-0001",
      mono: true,
    });
    if (v === null) return;
    await saveTransfer({ ...t, externalDocNo: v.trim() });
    await refresh();
  }

  async function reopen(t: Transfer) {
    if (t.applied) {
      await ui.showInfo({
        title: "ลังนี้ถูก Apply แล้ว",
        message:
          "D365 ยืนยันการโอนผ่าน Ledger ใหม่แล้ว\nหากจะแก้กลับ ต้องไปยกเลิก TO ใน D365 และอัพโหลด Ledger ที่ไม่มี External Doc นี้ก่อน",
        tone: "warn",
      });
      return;
    }
    const yes = await ui.confirm({
      title: "ยกเลิกเอกสารเพื่อกลับมาแก้ไข?",
      message: "ลังจะถูกปลดล็อกเพื่อเพิ่ม/ลด/ลบ line ได้ใหม่",
      confirmText: "ยกเลิกเอกสาร",
    });
    if (!yes) return;
    await reopenTransfer(t);
    await refresh();
  }

  async function close(t: Transfer) {
    if (t.lines.length === 0) {
      ui.warn("ลังยังไม่มีรายการ");
      return;
    }
    const next = await closeTransfer(t);
    await refresh();
    ui.ok("ปิดลังเรียบร้อย", next.externalDocNo);
  }

  async function remove(t: Transfer) {
    if (t.applied) {
      ui.warn(
        "ลบไม่ได้",
        "ลังที่ Applied แล้ว — ต้องไปยกเลิกใน D365 ก่อน (ลบ Ledger ที่มี External Doc นี้)",
      );
      return;
    }
    const yes = await ui.confirm({
      title: "ลบลังนี้?",
      message: "ยอดที่จองไว้จะถูกคืนกลับเป็น available ใน lot นั้น",
      danger: true,
      confirmText: "ลบ",
    });
    if (!yes) return;
    await deleteTransferAndRevert(t.id);
    await refresh();
  }

  function printCover(t: Transfer) {
    setPrinting(t);
    setTimeout(() => window.print(), 100);
  }

  function exportBC(t: Transfer) {
    if (!t.externalDocNo) {
      ui.warn("ยังไม่มี External Document No.", "กดปิดลังก่อน export");
      return;
    }
    const blob = exportTransferToBC(t);
    downloadBlob(blob, `${t.externalDocNo || t.id}.xlsx`);
    ui.ok("Export Excel สำเร็จ", t.externalDocNo);
  }

  async function exportAll() {
    if (filtered.length === 0) {
      ui.warn("ไม่มีลังให้ export");
      return;
    }
    const { blob, included, skipped } = exportTransfersToBC(filtered);
    if (included === 0) {
      await ui.showInfo({
        title: "ไม่มีลังที่ export ได้",
        message:
          "ในรายการที่กรองอยู่ ลังต้องมี External Doc No. และมี line ที่ต้องโอน (ไม่ใช่ Ref ล้วน)",
        tone: "warn",
      });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `TO08EXP-batch-${today}.xlsx`);
    if (skipped > 0) {
      ui.info(
        "Export Excel สำเร็จ",
        `รวมในไฟล์ ${included} ลัง • ข้าม ${skipped} ลัง (ไม่มี External Doc No. หรือไม่มีรายการต้องโอน)`,
      );
    } else {
      ui.ok("Export Excel สำเร็จ", `รวมในไฟล์ ${included} ลัง`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 no-print">
        <StatCard label="ทั้งหมด" value={stats.total} tone="slate" />
        <StatCard label="เปิดอยู่" value={stats.open} tone="amber" />
        <StatCard label="รอ D365" value={stats.closed} tone="indigo" />
        <StatCard label="ไม่ต้องโอน" value={stats.refOnly} tone="slate" />
        <StatCard label="Applied" value={stats.applied} tone="emerald" />
        <StatCard label="qty ที่ยังจอง" value={stats.pendingMoveQty} tone="slate" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="flex bg-slate-100 p-1 rounded-lg flex-wrap">
          {(["all", "open", "closed", "ref", "applied"] as const).map((k) => {
            const labels = {
              all: "ทั้งหมด",
              open: "เปิดอยู่",
              closed: "รอ D365",
              ref: "ไม่ต้องโอน",
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
          placeholder="ค้นหา External Doc No. หรือ Carton ID"
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        />
        <button
          onClick={recheckApplied}
          disabled={rechecking}
          title="ตรวจสอบสถานะ Applied ใหม่จาก Ledger ปัจจุบัน"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition"
        >
          <CheckIcon className="w-4 h-4" />
          {rechecking ? "กำลังตรวจ..." : "ตรวจสอบสถานะ"}
        </button>
        <button
          onClick={exportAll}
          disabled={filtered.length === 0}
          title="รวมทุกลังที่กรองอยู่เป็นไฟล์ Excel เดียว"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition"
        >
          <DownloadIcon /> Export Excel ทุกใบ ({filtered.length})
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)] no-print">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <BoxIcon className="w-10 h-10 mx-auto text-slate-300" />
            <div className="text-sm text-slate-400 mt-2">
              {items.length === 0 ? "ยังไม่มีลังที่สร้างไว้" : "ไม่มีลังที่ตรงกับเงื่อนไข"}
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="text-left px-4 py-2.5 font-medium">วันที่</th>
                <th className="text-left px-4 py-2.5 font-medium">External Doc</th>
                <th className="text-left px-4 py-2.5 font-medium">เส้นทาง</th>
                <th className="text-right px-4 py-2.5 font-medium">โอน</th>
                <th className="text-right px-4 py-2.5 font-medium">Ref</th>
                <th className="text-center px-4 py-2.5 font-medium">สถานะ</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const toMove = t.lines.filter((l) => !l.alreadyExp).length;
                const already = t.lines.filter((l) => l.alreadyExp).length;
                return (
                  <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                      <div>{new Date(t.createdAt).toLocaleDateString("th-TH")}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(t.createdAt).toLocaleTimeString("th-TH", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => editDocNo(t)}
                        className="font-mono text-sm font-semibold text-slate-800 hover:text-emerald-600 disabled:cursor-default"
                        disabled={t.closed}
                        title={t.closed ? "ยกเลิกเอกสารก่อนแก้" : "คลิกเพื่อแก้"}
                      >
                        {t.externalDocNo || (
                          <span className="text-slate-400 italic font-sans">(ยังไม่มี)</span>
                        )}
                      </button>
                      <div className="text-[10px] text-slate-400 font-mono">{t.id}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                      <span className="font-mono">{t.locationFrom}</span>
                      <span className="text-slate-400 mx-1">→</span>
                      <span className="font-mono">{t.locationTo}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                      {toMove}
                    </td>
                    <td className="px-4 py-2.5 text-right text-emerald-600">{already}</td>
                    <td className="px-4 py-2.5 text-center">
                      <StatusBadge t={t} />
                      {t.applied && t.appliedAt && (
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {new Date(t.appliedAt).toLocaleDateString("th-TH")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1 justify-end">
                        <IconBtn
                          onClick={() => printCover(t)}
                          title="พิมพ์ใบปะหน้า"
                          tone="primary"
                        >
                          <PrintIcon />
                        </IconBtn>
                        <IconBtn
                          onClick={() => exportBC(t)}
                          title="Export Excel (BC)"
                        >
                          <DownloadIcon />
                        </IconBtn>
                        {t.applied ? null : t.closed ? (
                          <IconBtn
                            onClick={() => reopen(t)}
                            title="ยกเลิกเอกสาร (Reopen)"
                            tone="warn"
                          >
                            <UnlockIcon />
                          </IconBtn>
                        ) : (
                          <IconBtn onClick={() => close(t)} title="ปิดลัง">
                            <LockIcon />
                          </IconBtn>
                        )}
                        {!t.applied && (
                          <IconBtn onClick={() => remove(t)} title="ลบ" tone="danger">
                            <TrashIcon />
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {printing && <PrintCover t={printing} onDone={() => setPrinting(null)} />}
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

function StatusBadge({ t }: { t: Transfer }) {
  if (t.applied) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-semibold rounded-full">
        <CheckIcon className="w-3 h-3" /> Applied
      </span>
    );
  }
  if (t.closed) {
    if (isRefOnly(t)) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-500 text-white text-[10px] font-semibold rounded-full">
          <CheckIcon className="w-3 h-3" /> ไม่ต้องโอน
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-semibold rounded-full">
        <LockIcon className="w-3 h-3" /> รอ D365
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded-full">
      <AlertIcon className="w-3 h-3" /> เปิดอยู่
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  tone?: "default" | "primary" | "warn" | "danger";
}) {
  const tones = {
    default: "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
    primary: "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50",
    warn: "text-amber-600 hover:text-amber-700 hover:bg-amber-50",
    danger: "text-rose-500 hover:text-rose-700 hover:bg-rose-50",
  };
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function PrintCover({ t, onDone }: { t: Transfer; onDone: () => void }) {
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, [onDone]);

  return (
    <div className="mt-6">
      <CoverSheet t={t} />
      <div className="mt-4 no-print flex justify-end gap-2">
        <button
          onClick={onDone}
          className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          ปิด
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1 px-4 py-1.5 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-800"
        >
          <PrintIcon /> พิมพ์
        </button>
      </div>
    </div>
  );
}
