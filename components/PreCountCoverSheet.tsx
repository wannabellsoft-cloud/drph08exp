"use client";
import type { Transfer, TransferLine, PreCountCategory } from "@/lib/types";
import { CATEGORY_META } from "@/lib/itemClassify";

export function PreCountCoverSheet({ t, id }: { t: Transfer; id?: string }) {
  const groups: Record<PreCountCategory, TransferLine[]> = {
    demo: [],
    gift: [],
    "gift-paid": [],
    normal: [],
  };
  for (const l of t.lines) {
    const cat = (l.precountCategory ?? "normal") as PreCountCategory;
    groups[cat].push(l);
  }

  const totalQty = t.lines.reduce((a, l) => a + l.quantity, 0);

  return (
    <div id={id ?? "print-area"} className="bg-white p-6 border border-slate-200 rounded-2xl">
      <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            Pre-count Cover Sheet
          </div>
          <h1 className="text-2xl font-extrabold mt-0.5">
            ใบปะหน้าลัง Pre-count (Demo / Premium Gift)
          </h1>
          <div className="text-sm text-slate-600 mt-1">
            สถานที่: <span className="font-semibold">{t.storeFrom}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Session</div>
          <div className="font-mono font-extrabold text-lg">{t.id}</div>
          <div className="text-xs text-slate-500 mt-2">
            วันที่: {new Date(t.createdAt).toLocaleString("th-TH")}
          </div>
          <div className="text-xs text-slate-500">รวม: {totalQty} ชิ้น</div>
        </div>
      </div>

      <Section title="Demo (D7)" rows={groups.demo} tone="indigo" />
      <div className="h-3" />
      <Section title="Premium Gift" rows={groups.gift} tone="rose" />
      <div className="h-3" />
      <Section title="ของแถมมีมูลค่า (Unit Price > 0)" rows={groups["gift-paid"]} tone="amber" />
      {groups.normal.length > 0 && (
        <>
          <div className="h-3" />
          <Section title="สินค้าทั่วไป (ไม่จัดเข้ากลุ่ม)" rows={groups.normal} tone="slate" />
        </>
      )}

      <div className="mt-3 text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded p-2">
        <span className="font-bold">หมายเหตุ:</span> ใบปะหน้านี้ใช้สำหรับการ Pre-count Stock
        ของแถม/Demo ก่อนนับจริง — <span className="font-semibold">ไม่ลง Transfer Order
        และไม่ลง Item Journal</span> ใน D365
      </div>

      <div className="grid grid-cols-3 gap-8 mt-12 text-sm">
        <Sig label="ผู้นับ" />
        <Sig label="ผู้ตรวจสอบ" />
        <Sig label="ผู้รับ" />
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: TransferLine[];
  tone: "indigo" | "rose" | "amber" | "slate";
}) {
  const totalQty = rows.reduce((a, l) => a + l.quantity, 0);
  const tones = {
    indigo: "bg-indigo-100 text-indigo-800",
    rose: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-800",
    slate: "bg-slate-100 text-slate-800",
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tones[tone]}`}>
          {rows.length} รายการ · {totalQty} ชิ้น
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400 italic">ไม่มี</div>
      ) : (
        <table className="w-full text-sm border-collapse border border-slate-300">
          <thead>
            <tr className="bg-slate-100 border-b-2 border-slate-300">
              <th className="text-left p-1.5 w-8">#</th>
              <th className="text-left p-1.5">Item No.</th>
              <th className="text-left p-1.5">Description</th>
              <th className="text-right p-1.5">Qty</th>
              <th className="text-left p-1.5">UoM</th>
              <th className="text-right p-1.5">ราคา</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i} className="border-b border-slate-200">
                <td className="p-1.5">{i + 1}</td>
                <td className="p-1.5 font-mono">{l.itemNo}</td>
                <td className="p-1.5">{l.description}</td>
                <td className="p-1.5 text-right font-semibold">{l.quantity}</td>
                <td className="p-1.5">{l.uom || ""}</td>
                <td className="p-1.5 text-right">
                  {l.unitPrice ? Number(l.unitPrice).toLocaleString() : "—"}
                </td>
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
      <div className="border-b-2 border-slate-400 h-12" />
      <div className="mt-1 text-xs text-slate-600">({label})</div>
    </div>
  );
}
