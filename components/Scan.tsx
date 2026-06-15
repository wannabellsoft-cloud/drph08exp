"use client";
import { useEffect, useRef, useState } from "react";
import {
  findItemByBarcode,
  stockForItem,
  saveTransfer,
  getTransfer,
  closeTransfer,
  nextExternalDocNo,
} from "@/lib/db";
import type { StockSummary, Transfer, TransferLine } from "@/lib/types";
import {
  ScanIcon,
  PlusIcon,
  LockIcon,
  TrashIcon,
  ArrowRightIcon,
  CheckIcon,
} from "./Icons";

const LOC_ON_HAND = "60008";
const LOC_EXP = "60008-EXP";
const STORE = "60008";
const CURRENT_CARTON_KEY = "current_carton_id";

function uid() {
  return "C-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

type Toast = { id: number; kind: "ok" | "warn" | "err"; text: string };

export function Scan() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [notFound, setNotFound] = useState<string>("");
  const [carton, setCarton] = useState<Transfer | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [nextDoc, setNextDoc] = useState<string>("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(kind: Toast["kind"], text: string) {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, kind, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3000);
  }

  async function refreshNextDoc() {
    setNextDoc(await nextExternalDocNo());
  }

  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      const cid = localStorage.getItem(CURRENT_CARTON_KEY);
      if (cid) {
        const t = await getTransfer(cid);
        if (t && !t.closed) setCarton(t);
      }
      await refreshNextDoc();
    })();
  }, []);

  async function newCarton() {
    const t: Transfer = {
      id: uid(),
      storeFrom: STORE,
      locationFrom: LOC_ON_HAND,
      storeTo: STORE,
      locationTo: LOC_EXP,
      createdAt: new Date().toISOString(),
      closed: false,
      lines: [],
    };
    await saveTransfer(t);
    localStorage.setItem(CURRENT_CARTON_KEY, t.id);
    setCarton(t);
  }

  async function lookup(code: string) {
    const c = code.trim();
    if (!c) return;
    setNotFound("");
    setStock(null);
    const item = await findItemByBarcode(c);
    if (!item) {
      setNotFound(`ไม่พบสินค้าสำหรับ "${c}" — ตรวจสอบ Barcode หรือ Item No.`);
      return;
    }
    const s = await stockForItem(item.itemNo);
    setStock(s);
    setQtyDraft({});
  }

  async function refreshStockOf(itemNo: string) {
    setStock(await stockForItem(itemNo));
  }

  async function addLot(lotKey: string, lot: StockSummary["lots"][number], wantQty?: number) {
    if (!carton) {
      pushToast("warn", "กรุณาสร้างลังใหม่ก่อน");
      return;
    }
    if (carton.closed) {
      pushToast("err", "ลังนี้ปิดแล้ว — กดยกเลิกเอกสารใน Transfers ก่อนแก้");
      return;
    }
    if (lot.available <= 0) {
      pushToast("err", "ยอดที่ใช้ได้ของ lot นี้เป็น 0");
      return;
    }
    const want = wantQty ?? qtyDraft[lotKey] ?? lot.available;
    const qty = Math.max(1, Math.min(lot.available, want));
    const line: TransferLine = {
      itemNo: stock!.itemNo,
      description: stock!.description,
      quantity: qty,
      lotNo: lot.lotNo,
      expirationDate: lot.expirationDate,
      uom: lot.uom,
      alreadyExp: lot.locationCode === LOC_EXP,
    };
    const existing = carton.lines.findIndex(
      (l) =>
        l.itemNo === line.itemNo &&
        l.lotNo === line.lotNo &&
        l.alreadyExp === line.alreadyExp,
    );
    const lines = [...carton.lines];
    if (existing >= 0) {
      lines[existing] = { ...lines[existing], quantity: lines[existing].quantity + qty };
    } else {
      lines.push(line);
    }
    const next = { ...carton, lines };
    await saveTransfer(next);
    setCarton(next);
    await refreshStockOf(stock!.itemNo);
    pushToast("ok", `${line.alreadyExp ? "เพิ่มอ้างอิง" : "เพิ่มลงโอน"} ${qty} ชิ้น`);
  }

  async function removeLine(idx: number) {
    if (!carton || carton.closed) return;
    const lines = carton.lines.filter((_, i) => i !== idx);
    const next = { ...carton, lines };
    await saveTransfer(next);
    setCarton(next);
    if (stock) await refreshStockOf(stock.itemNo);
  }

  async function updateLineQty(idx: number, q: number) {
    if (!carton || carton.closed) return;
    const lines = carton.lines.map((l, i) =>
      i === idx ? { ...l, quantity: Math.max(0, q) } : l,
    );
    const next = { ...carton, lines };
    await saveTransfer(next);
    setCarton(next);
    if (stock) await refreshStockOf(stock.itemNo);
  }

  async function closeCarton() {
    if (!carton) return;
    if (carton.lines.length === 0) {
      pushToast("warn", "ลังยังไม่มีรายการ");
      return;
    }
    const next = await closeTransfer(carton); // auto-assigns next TO08EXP-####
    localStorage.removeItem(CURRENT_CARTON_KEY);
    setCarton(null);
    await refreshNextDoc();
    pushToast("ok", `ปิดลังเรียบร้อย — ${next.externalDocNo}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      lookup(barcode);
      setBarcode("");
    }
  }

  const onHandLots = stock?.lots.filter((l) => l.locationCode === LOC_ON_HAND) ?? [];
  const expLots = stock?.lots.filter((l) => l.locationCode === LOC_EXP) ?? [];

  const cartonStats = carton
    ? {
        toMove: carton.lines.filter((l) => !l.alreadyExp).reduce((a, l) => a + l.quantity, 0),
        toMoveLines: carton.lines.filter((l) => !l.alreadyExp).length,
        already: carton.lines.filter((l) => l.alreadyExp).reduce((a, l) => a + l.quantity, 0),
        alreadyLines: carton.lines.filter((l) => l.alreadyExp).length,
      }
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: scan + stock */}
      <div className="lg:col-span-8 space-y-5">
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 grid place-items-center">
              <ScanIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Scan Barcode / Item No.</div>
              <div className="text-xs text-slate-500">ยิงบาร์โค้ดหรือพิมพ์รหัสแล้วกด Enter</div>
            </div>
          </div>
          <input
            ref={inputRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={onKey}
            placeholder="เช่น 8852796203248 หรือ D21320006"
            className="w-full px-4 py-3 text-lg font-medium border-2 border-slate-200 rounded-xl focus:outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 transition"
          />
          {notFound && (
            <div className="mt-3 px-3 py-2 bg-rose-50 text-rose-700 text-sm rounded-lg border border-rose-200">
              {notFound}
            </div>
          )}
        </Card>

        {stock && (
          <Card>
            <div className="flex justify-between items-start mb-4 pb-3 border-b border-slate-100">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400 font-mono">{stock.barcode}</div>
                <div className="text-xs text-slate-500 font-mono">{stock.itemNo}</div>
                <div className="font-semibold text-slate-900 text-base mt-0.5 truncate">
                  {stock.description}
                </div>
              </div>
              <button
                onClick={() => stock && refreshStockOf(stock.itemNo)}
                className="text-xs text-slate-500 hover:text-emerald-600"
              >
                รีเฟรช
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <LotTable
                title="Location 60008"
                subtitle="วางขาย — ต้องโอน"
                accent="amber"
                lots={onHandLots}
                qtyDraft={qtyDraft}
                setQtyDraft={setQtyDraft}
                onAdd={(k, lot) => addLot(k, lot)}
                actionLabel="โอน"
                disabled={!carton}
              />
              <LotTable
                title="Location 60008-EXP"
                subtitle="โอนแล้ว — ใส่เป็นอ้างอิง"
                accent="emerald"
                lots={expLots}
                qtyDraft={qtyDraft}
                setQtyDraft={setQtyDraft}
                onAdd={(k, lot) => addLot(k, lot)}
                actionLabel="Ref"
                disabled={!carton}
              />
            </div>

            {onHandLots.length === 0 && expLots.length === 0 && (
              <div className="text-sm text-slate-400 mt-3 italic text-center py-6">
                ไม่มีสต๊อกคงเหลือใน Ledger สำหรับสินค้านี้
              </div>
            )}
          </Card>
        )}

        {!stock && !notFound && (
          <Card className="text-center py-12">
            <ScanIcon className="w-10 h-10 mx-auto text-slate-300" />
            <div className="text-sm text-slate-400 mt-2">
              ยังไม่มีการสแกน — ยิงบาร์โค้ดเพื่อเริ่ม
            </div>
          </Card>
        )}
      </div>

      {/* Right: carton */}
      <div className="lg:col-span-4">
        <div className="sticky top-20 space-y-3">
          <Card>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">ลังที่กำลังเปิด</div>
                {carton ? (
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">{carton.id}</div>
                ) : (
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    เลขถัดไป: <span className="font-mono">{nextDoc || "—"}</span>
                  </div>
                )}
              </div>
              {!carton ? (
                <button
                  onClick={newCarton}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 shadow-sm transition"
                >
                  <PlusIcon /> ลังใหม่
                </button>
              ) : (
                <button
                  onClick={closeCarton}
                  disabled={carton.lines.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition"
                >
                  <LockIcon className="w-3.5 h-3.5" /> ปิดลัง
                </button>
              )}
            </div>

            {carton && cartonStats && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <Stat label="ต้องโอน" value={cartonStats.toMove} sub={`${cartonStats.toMoveLines} lot`} tone="amber" />
                <Stat label="อ้างอิง" value={cartonStats.already} sub={`${cartonStats.alreadyLines} lot`} tone="emerald" />
              </div>
            )}

            {carton ? (
              carton.lines.length === 0 ? (
                <div className="text-sm text-slate-400 italic text-center py-8 border border-dashed border-slate-200 rounded-lg">
                  ยังไม่มีรายการ — ยิงบาร์โค้ดแล้วกดปุ่ม "โอน" หรือ "Ref"
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[55vh] overflow-y-auto scroll-thin -mx-1 px-1">
                  {carton.lines.map((l, i) => (
                    <div
                      key={i}
                      className={`text-sm rounded-lg p-2.5 border transition ${
                        l.alreadyExp
                          ? "border-emerald-200 bg-emerald-50/60"
                          : "border-amber-200 bg-amber-50/60"
                      }`}
                    >
                      <div className="flex justify-between gap-2 items-start">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                l.alreadyExp
                                  ? "bg-emerald-600 text-white"
                                  : "bg-amber-500 text-white"
                              }`}
                            >
                              {l.alreadyExp ? "REF" : "MOVE"}
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-800">
                              {l.itemNo}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 truncate mt-0.5">
                            {l.description}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Lot <span className="font-mono">{l.lotNo}</span> · Exp{" "}
                            {l.expirationDate || "-"}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number"
                            min={0}
                            value={l.quantity}
                            onChange={(e) =>
                              updateLineQty(i, parseInt(e.target.value || "0", 10))
                            }
                            className="w-16 text-right border border-slate-300 rounded-md px-1.5 py-0.5 text-sm font-semibold"
                          />
                          <button
                            onClick={() => removeLine(i)}
                            className="flex items-center gap-0.5 text-[11px] text-rose-500 hover:text-rose-700"
                          >
                            <TrashIcon className="w-3 h-3" /> ลบ
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 grid place-items-center mb-2">
                  <PlusIcon className="w-5 h-5 text-slate-400" />
                </div>
                <div className="text-sm text-slate-500">
                  ยังไม่มีลังเปิดอยู่
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  กด "ลังใหม่" เพื่อเริ่มสร้าง TO
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-fadeUp flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${
              t.kind === "ok"
                ? "bg-emerald-600 text-white"
                : t.kind === "warn"
                ? "bg-amber-500 text-white"
                : "bg-rose-600 text-white"
            }`}
          >
            {t.kind === "ok" && <CheckIcon className="w-4 h-4" />}
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone: "amber" | "emerald";
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-70">{label}</div>
      <div className="text-xl font-extrabold leading-tight">{value}</div>
      {sub && <div className="text-[10px] opacity-60">{sub}</div>}
    </div>
  );
}

function LotTable(props: {
  title: string;
  subtitle: string;
  accent: "amber" | "emerald";
  lots: StockSummary["lots"];
  qtyDraft: Record<string, number>;
  setQtyDraft: (m: Record<string, number>) => void;
  onAdd: (key: string, lot: StockSummary["lots"][number], q?: number) => void;
  actionLabel: string;
  disabled: boolean;
}) {
  const tones = {
    amber: {
      header: "text-amber-700",
      dot: "bg-amber-500",
      btn: "bg-amber-500 hover:bg-amber-600",
    },
    emerald: {
      header: "text-emerald-700",
      dot: "bg-emerald-500",
      btn: "bg-emerald-600 hover:bg-emerald-700",
    },
  }[props.accent];

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${tones.dot}`} />
        <span className={`text-xs font-bold ${tones.header}`}>{props.title}</span>
        <span className="text-[10px] text-slate-400">{props.subtitle}</span>
      </div>
      {props.lots.length === 0 ? (
        <div className="text-xs text-slate-400 italic px-2 py-3 border border-dashed border-slate-200 rounded-lg text-center">
          ไม่มีสต๊อก
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="text-left font-medium px-2 py-1.5">Lot / Exp</th>
                <th className="text-right font-medium px-2 py-1.5">ใช้ได้</th>
                <th className="px-1 py-1.5 w-16"></th>
                <th className="px-1 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {props.lots.map((l) => {
                const k = `${l.lotNo}|${l.locationCode}`;
                const noAvail = l.available <= 0;
                return (
                  <tr key={k} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-2 py-1.5">
                      <div className="font-mono text-slate-800">{l.lotNo}</div>
                      <div className="text-[10px] text-slate-400">{l.expirationDate || "—"}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div
                        className={`font-bold ${noAvail ? "text-rose-500" : "text-slate-900"}`}
                      >
                        {l.available}
                      </div>
                      {l.reserved > 0 && (
                        <div className="text-[10px] text-slate-400">
                          {l.remaining} − {l.reserved}
                        </div>
                      )}
                    </td>
                    <td className="px-1 py-1.5">
                      <input
                        type="number"
                        min={1}
                        max={l.available}
                        defaultValue={l.available > 0 ? l.available : 0}
                        disabled={noAvail || props.disabled}
                        onChange={(e) =>
                          props.setQtyDraft({
                            ...props.qtyDraft,
                            [k]: parseInt(e.target.value || "0", 10),
                          })
                        }
                        className="w-14 text-right border border-slate-300 rounded-md px-1 py-0.5 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <button
                        onClick={() => props.onAdd(k, l)}
                        disabled={props.disabled || noAvail}
                        className={`flex items-center gap-0.5 px-2 py-1 text-[11px] font-semibold text-white rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition ${tones.btn}`}
                      >
                        {props.actionLabel}
                        <ArrowRightIcon className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
