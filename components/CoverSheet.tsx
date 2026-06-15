"use client";
import type { Transfer } from "@/lib/types";

// Pure, reusable cover sheet markup. Both the Transfers print flow and the
// "ปิดลังสำเร็จ" modal hand this element to window.print() / html2canvas.
export function CoverSheet({ t, id }: { t: Transfer; id?: string }) {
  const toMove = t.lines.filter((l) => !l.alreadyExp);
  const already = t.lines.filter((l) => l.alreadyExp);
  return (
    <div id={id ?? "print-area"} className="bg-white p-6 border border-slate-200 rounded-2xl">
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
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            External Doc No.
          </div>
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
        title="รายการที่ต้องโอน (60008 → 60008-EXP)"
        count={toMove.length}
        rows={toMove}
        emptyText="ไม่มี"
        tone="amber"
      />
      <div className="h-4" />
      <Section
        title="รายการในลังที่อยู่ที่ 60008-EXP แล้ว (อ้างอิง)"
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
                hasJournal && (l.expirationDate || "") !== (l.newExpirationDate || "");
              return (
                <tr
                  key={i}
                  className={`border-b border-slate-200 ${hasJournal ? "bg-indigo-50/40" : ""}`}
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
                  <td className="p-1.5 text-right font-semibold align-top">{l.quantity}</td>
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
