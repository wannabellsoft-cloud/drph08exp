"use client";
import { useEffect, useRef, useState } from "react";
import {
  findItemByBarcode,
  stockForItem,
  saveTransfer,
  getTransfer,
  closeTransfer,
} from "@/lib/db";
import type { StockSummary, Transfer, TransferLine } from "@/lib/types";

const LOC_ON_HAND = "60008";
const LOC_EXP = "60008-EXP";
const STORE = "60008";
const CURRENT_CARTON_KEY = "current_carton_id";

function uid() {
  return "TO-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export function Scan() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [notFound, setNotFound] = useState<string>("");
  const [carton, setCarton] = useState<Transfer | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      const cid = localStorage.getItem(CURRENT_CARTON_KEY);
      if (cid) {
        const t = await getTransfer(cid);
        if (t && !t.closed) setCarton(t);
      }
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

  async function addLot(lotKey: string, lot: StockSummary["lots"][number], wantQty?: number) {
    if (!carton) {
      alert("กรุณาสร้างลังใหม่ (New Carton) ก่อน");
      return;
    }
    if (carton.closed) {
      alert("ลังนี้ปิดแล้ว สร้างลังใหม่");
      return;
    }
    const qty = Math.max(1, Math.min(lot.remaining, wantQty ?? qtyDraft[lotKey] ?? lot.remaining));
    const line: TransferLine = {
      itemNo: stock!.itemNo,
      description: stock!.description,
      quantity: qty,
      lotNo: lot.lotNo,
      expirationDate: lot.expirationDate,
      uom: lot.uom,
      alreadyExp: lot.locationCode === LOC_EXP,
    };
    // Merge if same item + lot + alreadyExp
    const existing = carton.lines.findIndex(
      (l) => l.itemNo === line.itemNo && l.lotNo === line.lotNo && l.alreadyExp === line.alreadyExp
    );
    let lines = [...carton.lines];
    if (existing >= 0) {
      lines[existing] = { ...lines[existing], quantity: lines[existing].quantity + qty };
    } else {
      lines.push(line);
    }
    const next = { ...carton, lines };
    await saveTransfer(next);
    setCarton(next);
  }

  async function removeLine(idx: number) {
    if (!carton) return;
    const lines = carton.lines.filter((_, i) => i !== idx);
    const next = { ...carton, lines };
    await saveTransfer(next);
    setCarton(next);
  }

  async function updateLineQty(idx: number, q: number) {
    if (!carton) return;
    const lines = carton.lines.map((l, i) => (i === idx ? { ...l, quantity: Math.max(0, q) } : l));
    const next = { ...carton, lines };
    await saveTransfer(next);
    setCarton(next);
  }

  async function closeCarton() {
    if (!carton) return;
    const docNo = prompt(
      "ระบุ External Document No. สำหรับลังนี้:",
      carton.externalDocNo ?? ""
    );
    if (docNo === null) return;
    const next = await closeTransfer(carton, docNo);
    localStorage.removeItem(CURRENT_CARTON_KEY);
    setCarton(null);
    alert(
      `ปิดลังเรียบร้อย: ${next.externalDocNo || next.id}\nยอดคงเหลือใน Ledger ถูกปรับ (60008 ↓, 60008-EXP ↑)\nไปที่แท็บ "Transfers" เพื่อพิมพ์ใบปะหน้า/Export Excel`
    );
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left: scan + stock */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <label className="text-sm font-medium text-slate-700">Scan Barcode / Item No.</label>
          <input
            ref={inputRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={onKey}
            placeholder="ยิงบาร์โค้ดหรือพิมพ์รหัสแล้วกด Enter"
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          {notFound && <div className="text-rose-600 text-sm mt-2">{notFound}</div>}
        </div>

        {stock && (
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex justify-between items-baseline mb-3">
              <div>
                <div className="text-xs text-slate-500">{stock.barcode}</div>
                <div className="font-semibold text-slate-800">
                  {stock.itemNo} — {stock.description}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LotTable
                title="Location 60008 (วางขาย — ต้องโอน)"
                accent="text-amber-700"
                lots={onHandLots}
                qtyDraft={qtyDraft}
                setQtyDraft={setQtyDraft}
                onAdd={(k, lot, q) => addLot(k, lot, q)}
                actionLabel="โอน → 60008-EXP"
                disabled={!carton}
              />
              <LotTable
                title="Location 60008-EXP (โอนแล้ว)"
                accent="text-emerald-700"
                lots={expLots}
                qtyDraft={qtyDraft}
                setQtyDraft={setQtyDraft}
                onAdd={(k, lot, q) => addLot(k, lot, q)}
                actionLabel="ใส่ลง (Ref)"
                disabled={!carton}
              />
            </div>
            {onHandLots.length === 0 && expLots.length === 0 && (
              <div className="text-sm text-slate-500 mt-3">
                ไม่มีสต๊อกคงเหลือใน Ledger สำหรับสินค้านี้
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: current carton */}
      <div className="space-y-4">
        <div className="bg-white rounded-lg border border-slate-200 p-4 sticky top-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-slate-800">ลังที่กำลังเปิด</h3>
            {!carton ? (
              <button
                onClick={newCarton}
                className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700"
              >
                + ลังใหม่
              </button>
            ) : (
              <button
                onClick={closeCarton}
                disabled={carton.lines.length === 0}
                className="px-3 py-1.5 bg-slate-800 text-white text-sm rounded hover:bg-slate-700 disabled:opacity-50"
              >
                ปิดลัง (Close)
              </button>
            )}
          </div>

          {carton ? (
            <>
              <div className="text-xs text-slate-500 mb-2">
                ID: <span className="font-mono">{carton.id}</span>
                <br />
                {carton.locationFrom} → {carton.locationTo}
              </div>

              {carton.lines.length === 0 ? (
                <div className="text-sm text-slate-500 italic">ยังไม่มีรายการในลังนี้</div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {carton.lines.map((l, i) => (
                    <div
                      key={i}
                      className={`text-sm border rounded p-2 ${
                        l.alreadyExp
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {l.itemNo}
                          </div>
                          <div className="truncate text-slate-600 text-xs">
                            {l.description}
                          </div>
                          <div className="text-xs text-slate-500">
                            Lot: {l.lotNo} | Exp: {l.expirationDate || "-"}
                            {l.alreadyExp ? " | (60008-EXP)" : " | (60008)"}
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
                            className="w-16 text-right border border-slate-300 rounded px-1 text-sm"
                          />
                          <button
                            onClick={() => removeLine(i)}
                            className="text-xs text-rose-600 hover:underline"
                          >
                            ลบ
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-slate-200 mt-3 pt-2 text-xs text-slate-600">
                รายการที่ต้องโอน: {carton.lines.filter((l) => !l.alreadyExp).length} | โอนแล้ว:{" "}
                {carton.lines.filter((l) => l.alreadyExp).length}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">
              ยังไม่มีลังเปิดอยู่ — กด "+ ลังใหม่" เพื่อเริ่มสร้าง TO
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LotTable(props: {
  title: string;
  accent: string;
  lots: StockSummary["lots"];
  qtyDraft: Record<string, number>;
  setQtyDraft: (m: Record<string, number>) => void;
  onAdd: (key: string, lot: StockSummary["lots"][number], q?: number) => void;
  actionLabel: string;
  disabled: boolean;
}) {
  return (
    <div>
      <div className={`text-xs font-semibold mb-1 ${props.accent}`}>{props.title}</div>
      {props.lots.length === 0 ? (
        <div className="text-xs text-slate-400 italic">ไม่มีสต๊อก</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-normal">Lot</th>
              <th className="text-left font-normal">Exp</th>
              <th className="text-right font-normal">คงเหลือ</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {props.lots.map((l) => {
              const k = `${l.lotNo}|${l.locationCode}`;
              return (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{l.lotNo}</td>
                  <td className="py-1">{l.expirationDate || "-"}</td>
                  <td className="py-1 text-right font-semibold">{l.remaining}</td>
                  <td className="py-1">
                    <input
                      type="number"
                      min={1}
                      max={l.remaining}
                      defaultValue={l.remaining}
                      onChange={(e) =>
                        props.setQtyDraft({
                          ...props.qtyDraft,
                          [k]: parseInt(e.target.value || "0", 10),
                        })
                      }
                      className="w-14 text-right border border-slate-300 rounded px-1"
                    />
                  </td>
                  <td className="py-1">
                    <button
                      onClick={() => props.onAdd(k, l)}
                      disabled={props.disabled}
                      className="px-2 py-0.5 text-xs bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-40"
                    >
                      {props.actionLabel}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
