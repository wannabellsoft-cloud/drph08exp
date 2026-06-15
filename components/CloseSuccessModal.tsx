"use client";
import { useEffect, useRef, useState } from "react";
import type { Transfer } from "@/lib/types";
import { CoverSheet } from "./CoverSheet";
import { CheckIcon, PrintIcon, ShareIcon, PlusIcon } from "./Icons";
import { useUI } from "./UI";
import { elementToPdfBlob, shareOrDownloadBlob } from "@/lib/pdf";

export function CloseSuccessModal({
  t,
  onClose,
  onNewCarton,
}: {
  t: Transfer;
  onClose: () => void;
  onNewCarton: () => void;
}) {
  const ui = useUI();
  const [isMobile, setIsMobile] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const ua = navigator.userAgent || "";
      const m =
        /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
        (typeof window.matchMedia === "function" &&
          window.matchMedia("(pointer: coarse)").matches);
      setIsMobile(m);
      setCanShare(typeof (navigator as any).share === "function");
    } catch {}
  }, []);

  function doPrint() {
    setBusy("print");
    // Give the browser one tick to repaint with the cover sheet in DOM,
    // then trigger print. afterprint resets busy.
    const after = () => {
      setBusy(null);
      window.removeEventListener("afterprint", after);
    };
    window.addEventListener("afterprint", after);
    setTimeout(() => window.print(), 60);
  }

  async function doShare() {
    if (!coverRef.current) return;
    setBusy("share");
    try {
      const blob = await elementToPdfBlob(coverRef.current);
      const filename = `${t.externalDocNo || t.id}.pdf`;
      const { shared, cancelled } = await shareOrDownloadBlob(
        blob,
        filename,
        `Carton ${t.externalDocNo}`,
      );
      if (!shared && !cancelled) {
        ui.ok("ดาวน์โหลด PDF แล้ว", "เปิดไฟล์เพื่อแชร์ต่อใน Line / อื่นๆ");
      }
    } catch (e: any) {
      ui.err("แชร์ไม่สำเร็จ", e?.message ?? String(e));
    }
    setBusy(null);
  }

  const moveQty = t.lines.filter((l) => !l.alreadyExp).reduce((a, l) => a + l.quantity, 0);
  const refQty = t.lines.filter((l) => l.alreadyExp).reduce((a, l) => a + l.quantity, 0);
  const journalCount = t.lines.filter((l) => l.journalEntryId).length;

  return (
    <>
      <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-backdrop-in no-print">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-modal-in">
          {/* Gradient success header */}
          <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white px-5 py-5 text-center relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/15 blur-2xl" />
            <div className="absolute -left-8 -bottom-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="w-14 h-14 mx-auto rounded-full bg-white/20 grid place-items-center mb-2 shadow-inner">
                <CheckIcon className="w-7 h-7" />
              </div>
              <h2 className="font-extrabold text-xl">ปิดลังสำเร็จ</h2>
              <p className="text-xs opacity-90 mt-0.5">
                บันทึก Transfer Order เรียบร้อยแล้ว
              </p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                External Doc No.
              </div>
              <div className="font-mono font-extrabold text-3xl text-slate-900 mt-1 tracking-wide select-all">
                {t.externalDocNo}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-amber-50 border border-amber-200 rounded-xl py-2">
                <div className="text-[10px] uppercase font-semibold text-amber-700">
                  ต้องโอน
                </div>
                <div className="text-2xl font-extrabold text-amber-900 leading-tight">
                  {moveQty}
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl py-2">
                <div className="text-[10px] uppercase font-semibold text-emerald-700">
                  Ref
                </div>
                <div className="text-2xl font-extrabold text-emerald-900 leading-tight">
                  {refQty}
                </div>
              </div>
            </div>

            {journalCount > 0 && (
              <div className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-2">
                <span className="font-semibold">หมายเหตุ:</span> มี{" "}
                <span className="font-bold">{journalCount}</span> รายการที่แก้ LOT/EXP —
                ต้อง import Item Journal แยกใน D365 หลัง Transfer Order
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={doPrint}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-br from-slate-800 to-slate-900 text-white text-sm font-semibold rounded-xl active:scale-95 shadow-md transition disabled:opacity-50"
              >
                <PrintIcon className="w-4 h-4" />
                {busy === "print" ? "กำลังพิมพ์..." : "พิมพ์ใบปะหน้าลัง"}
              </button>

              {isMobile && canShare && (
                <button
                  onClick={doShare}
                  disabled={busy !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-br from-[#06c755] to-[#048a3c] text-white text-sm font-semibold rounded-xl active:scale-95 shadow-md transition disabled:opacity-50"
                >
                  <ShareIcon className="w-4 h-4" />
                  {busy === "share" ? "กำลังสร้าง PDF..." : "ส่งต่อ Line / อื่นๆ (PDF)"}
                </button>
              )}

              <button
                onClick={onNewCarton}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 active:scale-95 shadow-md transition disabled:opacity-50"
              >
                <PlusIcon className="w-4 h-4" /> ทำลังใหม่ต่อ
              </button>

              <button
                onClick={onClose}
                disabled={busy !== null}
                className="w-full text-xs text-slate-500 hover:text-slate-700 py-1.5 disabled:opacity-50"
              >
                ปิดหน้าต่างนี้
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden cover sheet — present in DOM so window.print() (via the
          #print-area rule) and html2canvas can both find it. */}
      <div
        ref={coverRef}
        id="print-area"
        className="fixed left-[-10000px] top-0 bg-white"
        style={{ width: "210mm" }}
        aria-hidden="true"
      >
        <CoverSheet t={t} />
      </div>
    </>
  );
}
