"use client";
import { useEffect, useMemo, useState } from "react";
import {
  listTransfers,
  saveTransfer,
  closeTransfer,
  reopenTransfer,
  deleteTransferAndRevert,
} from "@/lib/db";
import { exportTransferToBC, exportTransfersToBC, downloadBlob } from "@/lib/excel";
import type { Transfer } from "@/lib/types";
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
  const [items, setItems] = useState<Transfer[]>([]);
  const [printing, setPrinting] = useState<Transfer | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed" | "applied">("all");
  const [q, setQ] = useState("");

  async function refresh() {
    setItems(await listTransfers());
  }
  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    return items.filter((t) => {
      if (filter === "open" && t.closed) return false;
      if (filter === "closed" && (!t.closed || t.applied)) return false;
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
    const closed = items.filter((t) => t.closed && !t.applied).length;
    const applied = items.filter((t) => t.applied).length;
    const pendingMoveQty = items
      .filter((t) => !t.applied)
      .reduce(
        (a, t) =>
          a + t.lines.filter((l) => !l.alreadyExp).reduce((s, l) => s + l.quantity, 0),
        0,
      );
    return { total: items.length, open, closed, applied, pendingMoveQty };
  }, [items]);

  async function editDocNo(t: Transfer) {
    if (t.closed) {
      alert("ลังนี้ปิดแล้ว — กดยกเลิกเอกสารก่อนแก้ไข");
      return;
    }
    const v = prompt("External Document No.", t.externalDocNo ?? "");
    if (v === null) return;
    await saveTransfer({ ...t, externalDocNo: v.trim() });
    await refresh();
  }

  async function reopen(t: Transfer) {
    if (t.applied) {
      alert(
        "ลังนี้ถูก Apply โดย D365 แล้ว (Ledger ใหม่ยืนยันการโอน)\nหากจะแก้กลับ ต้องไปยกเลิก TO ใน D365 และอัพโหลด Ledger ที่ไม่มี External Doc นี้ก่อน",
      );
      return;
    }
    if (
      !confirm(
        "ยกเลิกเอกสารเพื่อกลับมาแก้ไข?\nลังจะถูกปลดล็อกเพื่อเพิ่ม/ลด/ลบ line ได้ใหม่",
      )
    )
      return;
    await reopenTransfer(t);
    await refresh();
  }

  async function close(t: Transfer) {
    if (t.lines.length === 0) {
      alert("ลังยังไม่มีรายการ");
      return;
    }
    const next = await closeTransfer(t);
    await refresh();
    alert(`ปิดลังเรียบร้อย — ${next.externalDocNo}`);
  }

  async function remove(t: Transfer) {
    const msg = t.applied
      ? "ลบประวัติลังนี้?\nลังนี้ถูก Apply โดย D365 แล้ว — การลบจะลบเฉพาะ record ในแอป (ไม่กระทบ Ledger)"
      : "ลบลังนี้?\nยอดที่จองไว้จะถูกคืนกลับเป็น available ใน lot นั้น";
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
      alert("ลังนี้ยังไม่มี External Document No. — กดปิดลังก่อน");
      return;
    }
    const blob = exportTransferToBC(t);
    downloadBlob(blob, `${t.externalDocNo || t.id}.xlsx`);
  }

  function exportAll() {
    if (filtered.length === 0) {
      alert("ไม่มีลังให้ export");
      return;
    }
    const { blob, included, skipped } = exportTransfersToBC(filtered);
    if (included === 0) {
      alert(
        "ไม่มีลังที่ export ได้ในรายการที่กรอง\n— ลังต้องมี External Doc No. และมี line ที่ต้องโอน (ไม่ใช่ Ref ล้วน)",
      );
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `TO08EXP-batch-${today}.xlsx`);
    if (skipped > 0) {
      setTimeout(
        () =>
          alert(
            `Export Excel สำเร็จ\n• รวมในไฟล์: ${included} ลัง\n• ข้าม: ${skipped} ลัง (ไม่มี External Doc No. หรือไม่มีรายการต้องโอน)`,
          ),
        100,
      );
    }
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 no-print">
        <StatCard label="ทั้งหมด" value={stats.total} tone="slate" />
        <StatCard label="เปิดอยู่" value={stats.open} tone="amber" />
        <StatCard label="ปิดแล้ว (รอ D365)" value={stats.closed} tone="indigo" />
        <StatCard label="Applied" value={stats.applied} tone="emerald" />
        <StatCard label="qty ที่ยังจอง" value={stats.pendingMoveQty} tone="slate" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="flex bg-slate-100 p-1 rounded-lg">
          {(["all", "open", "closed", "applied"] as const).map((k) => {
            const labels = { all: "ทั้งหมด", open: "เปิดอยู่", closed: "รอ D365", applied: "Applied" };
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
                      <StatusBadge closed={t.closed} applied={t.applied} />
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
                        <IconBtn onClick={() => remove(t)} title="ลบ" tone="danger">
                          <TrashIcon />
                        </IconBtn>
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

function StatusBadge({ closed, applied }: { closed: boolean; applied?: boolean }) {
  if (applied) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-semibold rounded-full">
        <CheckIcon className="w-3 h-3" /> Applied
      </span>
    );
  }
  if (closed) {
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

  const toMove = t.lines.filter((l) => !l.alreadyExp);
  const already = t.lines.filter((l) => l.alreadyExp);

  return (
    <div id="print-area" className="bg-white p-6 mt-6 border border-slate-200 rounded-2xl">
      <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            Carton Cover Sheet
          </div>
          <h1 className="text-2xl font-extrabold mt-0.5">ใบปะหน้าลัง Short EXP</h1>
          <div className="text-sm text-slate-600 mt-1">
            <span className="font-semibold">{t.storeFrom}</span> ({t.locationFrom})
            <span className="mx-2 text-slate-400">→</span>
            <span className="font-semibold">{t.storeTo}</span> ({t.locationTo})
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">External Doc No.</div>
          <div className="font-mono font-extrabold text-xl">{t.externalDocNo || "-"}</div>
          <div className="text-xs text-slate-500 mt-2">
            Carton: <span className="font-mono">{t.id}</span>
          </div>
          <div className="text-xs text-slate-500">
            วันที่: {new Date(t.createdAt).toLocaleString("th-TH")}
          </div>
        </div>
      </div>

      <Section
        title={`รายการที่ต้องโอน (60008 → 60008-EXP)`}
        count={toMove.length}
        rows={toMove}
        emptyText="ไม่มี"
        tone="amber"
      />
      <div className="h-4" />
      <Section
        title={`รายการในลังที่อยู่ที่ 60008-EXP แล้ว (อ้างอิง)`}
        count={already.length}
        rows={already}
        emptyText="ไม่มี"
        tone="emerald"
      />
      {t.lines.some((l) => l.journalEntryId) && (
        <div className="mt-3 text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-200 rounded p-2">
          <span className="font-bold">หมายเหตุ:</span> รายการที่มีป้าย{" "}
          <span className="font-mono font-bold">รอ Journal</span>{" "}
          ต้อง Import Item Journal แยกใน D365 หลัง Transfer Order เสร็จแล้ว
          เพื่อเปลี่ยน LOT/EXP เป็นค่าใหม่ที่ 60008-EXP
        </div>
      )}

      <div className="grid grid-cols-3 gap-8 mt-12 text-sm">
        <Sig label="ผู้จัดลัง" />
        <Sig label="ผู้ตรวจสอบ" />
        <Sig label="ผู้รับ" />
      </div>

      <div className="mt-6 no-print flex justify-end gap-2">
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

function Section({
  title,
  count,
  rows,
  emptyText,
  tone,
}: {
  title: string;
  count: number;
  rows: Transfer["lines"];
  emptyText: string;
  tone: "amber" | "emerald";
}) {
  const tones = {
    amber: "bg-amber-100 text-amber-800",
    emerald: "bg-emerald-100 text-emerald-800",
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tones[tone]}`}>
          {count} รายการ
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400 italic">{emptyText}</div>
      ) : (
        <table className="w-full text-sm border-collapse border border-slate-300">
          <thead>
            <tr className="bg-slate-100 border-b-2 border-slate-300">
              <th className="text-left p-1.5 w-8">#</th>
              <th className="text-left p-1.5">Item No.</th>
              <th className="text-left p-1.5">Description</th>
              <th className="text-left p-1.5">Lot No.</th>
              <th className="text-left p-1.5">Exp</th>
              <th className="text-right p-1.5">Qty</th>
              <th className="text-left p-1.5">UoM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const hasJournal = !!l.journalEntryId;
              const displayLot = hasJournal && l.newLotNo ? l.newLotNo : l.lotNo;
              const displayExp =
                hasJournal && l.newExpirationDate
                  ? l.newExpirationDate
                  : l.expirationDate || "-";
              const expChanged =
                hasJournal &&
                (l.expirationDate || "") !== (l.newExpirationDate || "");
              return (
                <tr
                  key={i}
                  className={`border-b border-slate-200 ${
                    hasJournal ? "bg-indigo-50/40" : ""
                  }`}
                >
                  <td className="p-1.5 align-top">{i + 1}</td>
                  <td className="p-1.5 font-mono align-top">{l.itemNo}</td>
                  <td className="p-1.5 align-top">{l.description}</td>
                  <td className="p-1.5 align-top">
                    <div className="font-mono font-semibold">{displayLot}</div>
                    {hasJournal && (
                      <>
                        <div className="text-[10px] mt-0.5">
                          <span className="inline-block px-1 py-0.5 bg-indigo-600 text-white font-semibold rounded">
                            รอ Journal @60008-EXP
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          เดิม:{" "}
                          <span className="font-mono line-through">{l.lotNo}</span>
                        </div>
                      </>
                    )}
                  </td>
                  <td className="p-1.5 align-top">
                    <div className={hasJournal ? "font-semibold" : ""}>{displayExp}</div>
                    {expChanged && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        เดิม:{" "}
                        <span className="line-through">{l.expirationDate || "-"}</span>
                      </div>
                    )}
                  </td>
                  <td className="p-1.5 text-right font-semibold align-top">
                    {l.quantity}
                  </td>
                  <td className="p-1.5 align-top">{l.uom || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Sig({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="border-b-2 border-slate-400 h-12" />
      <div className="mt-1 text-xs text-slate-600">({label})</div>
    </div>
  );
}
