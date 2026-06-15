"use client";
import { useEffect, useRef, useState } from "react";
import {
  findItemByBarcode,
  stockForItem,
  saveTransfer,
  getTransfer,
  closeTransfer,
  nextExternalDocNo,
  nextJournalDocNo,
  saveJournalEntry,
  updateJournalQty,
  deleteJournalIfPending,
  JOURNAL_LOCATION,
} from "@/lib/db";
import type { StockSummary, Transfer, TransferLine, ItemJournalEntry } from "@/lib/types";
import {
  ScanIcon,
  PlusIcon,
  LockIcon,
  TrashIcon,
  ArrowRightIcon,
  CheckIcon,
  EditIcon,
} from "./Icons";

const LOC_ON_HAND = "60008";
const LOC_EXP = "60008-EXP";
const STORE = "60008";
const CURRENT_CARTON_KEY = "current_carton_id";

function uid(prefix = "C") {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

type Toast = { id: number; kind: "ok" | "warn" | "err"; text: string };

type EditDraft = {
  documentNo: string;
  newLotNo: string;
  newExpirationDate: string;
  quantity: number;
  // context from the clicked lot row
  itemNo: string;
  description?: string;
  uom?: string;
  oldLotNo: string;
  oldExpirationDate?: string;
  sourceLocation: string; // 60008 or 60008-EXP
  maxQty: number;
};

export function Scan() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [notFound, setNotFound] = useState<string>("");
  const [carton, setCarton] = useState<Transfer | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [nextDoc, setNextDoc] = useState<string>("");
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
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

  async function ensureCarton(): Promise<Transfer> {
    if (carton && !carton.closed) return carton;
    const t: Transfer = {
      id: uid("C"),
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
    return t;
  }

  async function newCarton() {
    await ensureCarton();
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
    const c = await ensureCarton();
    if (c.closed) {
      pushToast("err", "ลังนี้ปิดแล้ว");
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
    const existing = c.lines.findIndex(
      (l) =>
        l.itemNo === line.itemNo &&
        l.lotNo === line.lotNo &&
        l.alreadyExp === line.alreadyExp &&
        !l.journalEntryId, // never merge into a LOT-edited line
    );
    const lines = [...c.lines];
    if (existing >= 0) {
      lines[existing] = { ...lines[existing], quantity: lines[existing].quantity + qty };
    } else {
      lines.push(line);
    }
    const next = { ...c, lines };
    await saveTransfer(next);
    setCarton(next);
    await refreshStockOf(stock!.itemNo);
    pushToast("ok", `${line.alreadyExp ? "เพิ่มอ้างอิง" : "เพิ่มลงโอน"} ${qty} ชิ้น`);
  }

  // Open "แก้ LOT" modal for a given lot row.
  async function openEditModal(lot: StockSummary["lots"][number]) {
    if (!stock) return;
    if (lot.available <= 0) {
      pushToast("err", "ยอดที่ใช้ได้เป็น 0 — แก้ไม่ได้");
      return;
    }
    const docNo = await nextJournalDocNo();
    setEditDraft({
      documentNo: docNo,
      newLotNo: lot.lotNo,
      newExpirationDate: lot.expirationDate ?? "",
      quantity: lot.available,
      itemNo: stock.itemNo,
      description: stock.description,
      uom: lot.uom,
      oldLotNo: lot.lotNo,
      oldExpirationDate: lot.expirationDate,
      sourceLocation: lot.locationCode,
      maxQty: lot.available,
    });
  }

  async function saveEditModal() {
    if (!editDraft) return;
    const d = editDraft;
    if (!d.newLotNo.trim()) {
      pushToast("err", "ระบุ New LOT");
      return;
    }
    if (d.quantity <= 0 || d.quantity > d.maxQty) {
      pushToast("err", `จำนวนต้องอยู่ระหว่าง 1 - ${d.maxQty}`);
      return;
    }
    const sameAsOld =
      d.newLotNo.trim() === d.oldLotNo &&
      (d.newExpirationDate || "") === (d.oldExpirationDate || "");
    if (sameAsOld) {
      pushToast(
        "warn",
        "LOT/EXP ใหม่ตรงกับของเดิม — ใช้ปุ่ม 'โอน' / 'Ref' แทน (ไม่ต้องลง Journal)",
      );
      return;
    }

    const c = await ensureCarton();
    if (c.closed) {
      pushToast("err", "ลังนี้ปิดแล้ว");
      return;
    }

    const journalId = uid("J");
    const journal: ItemJournalEntry = {
      id: journalId,
      documentNo: d.documentNo.trim(),
      itemNo: d.itemNo,
      description: d.description,
      locationCode: JOURNAL_LOCATION, // always 60008-EXP for the journal
      quantity: d.quantity,
      uom: d.uom,
      oldLotNo: d.oldLotNo,
      oldExpirationDate: d.oldExpirationDate,
      newLotNo: d.newLotNo.trim(),
      newExpirationDate: d.newExpirationDate || undefined,
      createdAt: new Date().toISOString(),
      exported: false,
      cartonId: c.id,
    };
    await saveJournalEntry(journal);

    const line: TransferLine = {
      itemNo: d.itemNo,
      description: d.description,
      quantity: d.quantity,
      lotNo: d.oldLotNo, // TO moves with the OLD lot — Journal renames it at destination
      expirationDate: d.oldExpirationDate,
      uom: d.uom,
      alreadyExp: d.sourceLocation === LOC_EXP,
      journalEntryId: journalId,
      newLotNo: d.newLotNo.trim(),
      newExpirationDate: d.newExpirationDate || undefined,
    };
    const lines = [...c.lines, line];
    const next = { ...c, lines };
    await saveTransfer(next);
    setCarton(next);
    setEditDraft(null);
    await refreshStockOf(d.itemNo);
    pushToast(
      "ok",
      `แก้ LOT ${d.oldLotNo} → ${d.newLotNo} ${d.quantity} ชิ้น • Journal ${d.documentNo}`,
    );
  }

  async function removeLine(idx: number) {
    if (!carton || carton.closed) return;
    const line = carton.lines[idx];
    if (line.journalEntryId) {
      await deleteJournalIfPending(line.journalEntryId);
    }
    const lines = carton.lines.filter((_, i) => i !== idx);
    const next = { ...carton, lines };
    await saveTransfer(next);
    setCarton(next);
    if (stock) await refreshStockOf(stock.itemNo);
  }

  async function updateLineQty(idx: number, q: number) {
    if (!carton || carton.closed) return;
    const line = carton.lines[idx];
    const safe = Math.max(0, q);
    if (line.journalEntryId) {
      if (safe === 0) await deleteJournalIfPending(line.journalEntryId);
      else await updateJournalQty(line.journalEntryId, safe);
    }
    const lines = carton.lines.map((l, i) => (i === idx ? { ...l, quantity: safe } : l));
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
    const next = await closeTransfer(carton);
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
        edits: carton.lines.filter((l) => l.journalEntryId).length,
      }
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
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
                onEdit={(lot) => openEditModal(lot)}
                actionLabel="โอน"
              />
              <LotTable
                title="Location 60008-EXP"
                subtitle="โอนแล้ว — ใส่เป็นอ้างอิง"
                accent="emerald"
                lots={expLots}
                qtyDraft={qtyDraft}
                setQtyDraft={setQtyDraft}
                onAdd={(k, lot) => addLot(k, lot)}
                onEdit={(lot) => openEditModal(lot)}
                actionLabel="Ref"
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
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label="ต้องโอน" value={cartonStats.toMove} sub={`${cartonStats.toMoveLines} lot`} tone="amber" />
                <Stat label="อ้างอิง" value={cartonStats.already} sub={`${cartonStats.alreadyLines} lot`} tone="emerald" />
                <Stat label="LOT แก้" value={cartonStats.edits} sub="Journal" tone="indigo" />
              </div>
            )}

            {carton ? (
              carton.lines.length === 0 ? (
                <div className="text-sm text-slate-400 italic text-center py-8 border border-dashed border-slate-200 rounded-lg">
                  ยังไม่มีรายการ
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[55vh] overflow-y-auto scroll-thin -mx-1 px-1">
                  {carton.lines.map((l, i) => (
                    <CartonLineRow
                      key={i}
                      line={l}
                      onChangeQty={(q) => updateLineQty(i, q)}
                      onRemove={() => removeLine(i)}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 grid place-items-center mb-2">
                  <PlusIcon className="w-5 h-5 text-slate-400" />
                </div>
                <div className="text-sm text-slate-500">ยังไม่มีลังเปิดอยู่</div>
                <div className="text-xs text-slate-400 mt-0.5">กด "ลังใหม่" เพื่อเริ่มสร้าง TO</div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Modal */}
      {editDraft && (
        <EditLotModal
          d={editDraft}
          onChange={setEditDraft}
          onCancel={() => setEditDraft(null)}
          onSave={saveEditModal}
        />
      )}

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
  tone: "amber" | "emerald" | "indigo";
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
  };
  return (
    <div className={`rounded-xl border px-2.5 py-1.5 ${tones[tone]}`}>
      <div className="text-[9px] uppercase tracking-wide font-semibold opacity-70">{label}</div>
      <div className="text-lg font-extrabold leading-tight">{value}</div>
      {sub && <div className="text-[9px] opacity-60">{sub}</div>}
    </div>
  );
}

function CartonLineRow({
  line,
  onChangeQty,
  onRemove,
}: {
  line: TransferLine;
  onChangeQty: (q: number) => void;
  onRemove: () => void;
}) {
  const isEdit = !!line.journalEntryId;
  return (
    <div
      className={`text-sm rounded-lg p-2.5 border transition ${
        isEdit
          ? "border-indigo-300 bg-indigo-50/60"
          : line.alreadyExp
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="flex justify-between gap-2 items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                line.alreadyExp ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
              }`}
            >
              {line.alreadyExp ? "REF" : "MOVE"}
            </span>
            {isEdit && (
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-600 text-white">
                JOURNAL
              </span>
            )}
            <span className="font-mono text-xs font-semibold text-slate-800">{line.itemNo}</span>
          </div>
          <div className="text-[11px] text-slate-600 truncate mt-0.5">{line.description}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Lot <span className="font-mono">{line.lotNo}</span> · Exp{" "}
            {line.expirationDate || "-"}
          </div>
          {isEdit && (
            <div className="text-[11px] text-indigo-700 mt-0.5 font-medium">
              → New Lot <span className="font-mono">{line.newLotNo}</span>
              {line.newExpirationDate && ` · ${line.newExpirationDate}`}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <input
            type="number"
            min={0}
            value={line.quantity}
            onChange={(e) => onChangeQty(parseInt(e.target.value || "0", 10))}
            className="w-16 text-right border border-slate-300 rounded-md px-1.5 py-0.5 text-sm font-semibold"
          />
          <button
            onClick={onRemove}
            className="flex items-center gap-0.5 text-[11px] text-rose-500 hover:text-rose-700"
          >
            <TrashIcon className="w-3 h-3" /> ลบ
          </button>
        </div>
      </div>
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
  onEdit: (lot: StockSummary["lots"][number]) => void;
  actionLabel: string;
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
                <th className="px-1 py-1.5 w-14"></th>
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
                      <div className={`font-bold ${noAvail ? "text-rose-500" : "text-slate-900"}`}>
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
                        disabled={noAvail}
                        onChange={(e) =>
                          props.setQtyDraft({
                            ...props.qtyDraft,
                            [k]: parseInt(e.target.value || "0", 10),
                          })
                        }
                        className="w-12 text-right border border-slate-300 rounded-md px-1 py-0.5 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => props.onAdd(k, l)}
                          disabled={noAvail}
                          className={`flex items-center gap-0.5 px-2 py-1 text-[11px] font-semibold text-white rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition ${tones.btn}`}
                        >
                          {props.actionLabel}
                          <ArrowRightIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => props.onEdit(l)}
                          disabled={noAvail}
                          title="แก้ LOT / EXP (สร้าง Journal Adjmt.)"
                          className="flex items-center gap-0.5 px-2 py-1 text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          <EditIcon className="w-3 h-3" />
                        </button>
                      </div>
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

function EditLotModal({
  d,
  onChange,
  onCancel,
  onSave,
}: {
  d: EditDraft;
  onChange: (d: EditDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm no-print">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full mx-4">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="text-[10px] uppercase tracking-widest text-indigo-600">Item Journal</div>
          <h2 className="font-bold text-slate-900 text-lg">แก้ LOT / EXP</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            สร้าง Journal Adjmt. + ใส่ลงลังพร้อมกัน (ยอด Remain จะถูกหักออกทันที)
          </p>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <Field label="Document No.">
            <input
              value={d.documentNo}
              onChange={(e) => onChange({ ...d, documentNo: e.target.value })}
              className="w-full px-3 py-1.5 font-mono text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Item No.">
              <div className="px-3 py-1.5 bg-slate-100 rounded-lg font-mono text-slate-700">
                {d.itemNo}
              </div>
            </Field>
            <Field label="Source / Journal Location">
              <div className="px-3 py-1.5 bg-slate-100 rounded-lg font-mono text-slate-700 text-xs">
                {d.sourceLocation}{" "}
                <span className="text-slate-400">→ Journal:</span>{" "}
                <span className="text-indigo-700 font-semibold">60008-EXP</span>
              </div>
            </Field>
          </div>

          {d.description && <div className="text-xs text-slate-500 truncate">{d.description}</div>}

          <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-3">
            <div className="text-[10px] uppercase font-semibold text-rose-700 mb-2">
              Negative Adjmt. (LOT เดิม)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Old LOT">
                <div className="px-3 py-1.5 bg-white rounded-lg font-mono">{d.oldLotNo}</div>
              </Field>
              <Field label="Old EXP">
                <div className="px-3 py-1.5 bg-white rounded-lg text-slate-700">
                  {d.oldExpirationDate || "—"}
                </div>
              </Field>
            </div>
          </div>

          <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3">
            <div className="text-[10px] uppercase font-semibold text-emerald-700 mb-2">
              Positive Adjmt. (LOT ใหม่)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="New LOT">
                <input
                  value={d.newLotNo}
                  onChange={(e) => onChange({ ...d, newLotNo: e.target.value })}
                  placeholder="LOT ใหม่"
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
              <Field label="New EXP">
                <input
                  type="date"
                  value={d.newExpirationDate}
                  onChange={(e) => onChange({ ...d, newExpirationDate: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
            </div>
          </div>

          <Field label={`Quantity (สูงสุด ${d.maxQty})`}>
            <input
              type="number"
              min={1}
              max={d.maxQty}
              value={d.quantity}
              onChange={(e) => onChange({ ...d, quantity: parseInt(e.target.value || "0", 10) })}
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
            <CheckIcon /> Confirm
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
