"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  findItemByBarcode,
  saveTransfer,
  getTransfer,
  listPreCountSessions,
  deleteTransferRaw,
  stockForItem,
  listItemsByCategoryRough,
  fetchRemainTotals,
  listConfirmations,
  setItemConfirmation,
  clearItemConfirmation,
  clearAllConfirmations,
} from "@/lib/db";
import type { ConfirmationEntry, ConfirmationStatus } from "@/lib/db";
import type {
  Item,
  Transfer,
  TransferLine,
  PreCountCategory,
} from "@/lib/types";
import { classifyItem, CATEGORY_META } from "@/lib/itemClassify";
import { useUI } from "./UI";
import { PreCountCoverSheet } from "./PreCountCoverSheet";
import { elementToPdfBlob, shareOrDownloadBlob } from "@/lib/pdf";
import {
  ScanIcon,
  PlusIcon,
  LockIcon,
  TrashIcon,
  CheckIcon,
  GiftIcon,
  PrintIcon,
  ShareIcon,
} from "./Icons";

const CameraScanner = dynamic(
  () => import("./CameraScanner").then((m) => m.CameraScanner),
  { ssr: false },
);

const STORE = "60008";
const PRECOUNT_SESSION_KEY = "precount_session_id";

function uid(prefix = "PC") {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

type SubTab = "demo" | "gift" | "count";

export function PreCount() {
  const [subTab, setSubTab] = useState<SubTab>("demo");

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="bg-white border border-slate-200/70 rounded-2xl p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-3 gap-1">
          {([
            { key: "demo", label: "Demo", desc: "รายการ Demo (D7) ทั้งหมด", tone: "indigo" },
            { key: "gift", label: "Gift", desc: "ของแถม (D001) ทั้งหมด", tone: "rose" },
            { key: "count", label: "นับ Stock", desc: "สแกน + นับ Gift เท่านั้น", tone: "emerald" },
          ] as const).map((t) => {
            const on = subTab === t.key;
            const tones = {
              indigo: on ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50",
              rose: on ? "bg-rose-500 text-white" : "text-slate-600 hover:bg-slate-50",
              emerald: on ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50",
            } as const;
            return (
              <button
                key={t.key}
                onClick={() => setSubTab(t.key)}
                className={`flex flex-col items-center gap-0.5 px-3 py-3 rounded-xl text-sm font-semibold transition active:scale-95 ${tones[t.tone]}`}
              >
                <span>{t.label}</span>
                <span className={`text-[10px] font-normal ${on ? "opacity-90" : "text-slate-400"}`}>
                  {t.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {subTab === "demo" && <ItemsBrowser category="demo" />}
      {subTab === "gift" && <ItemsBrowser category="gift" />}
      {subTab === "count" && <CountSection />}
    </div>
  );
}

// ============================================================
// Items Browser — Demo / Gift catalogue with Ledger Remain
// ============================================================

type BrowseRow = {
  item: Item;
  category: PreCountCategory;
  remain: number;
};

function ItemsBrowser({ category }: { category: "demo" | "gift" }) {
  const ui = useUI();
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [hideDone, setHideDone] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmMap, setConfirmMap] = useState<Map<string, ConfirmationEntry>>(new Map());

  const [diag, setDiag] = useState<{ mapSize: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [items, remainMap, confirmations] = await Promise.all([
          listItemsByCategoryRough(category),
          fetchRemainTotals(),
          listConfirmations(),
        ]);
        if (cancelled) return;
        setDiag({ mapSize: remainMap.size });
        setConfirmMap(confirmations);
        const want: PreCountCategory[] =
          category === "demo" ? ["demo"] : ["gift", "gift-paid"];
        const out: BrowseRow[] = [];
        for (const it of items) {
          const cat = classifyItem(it);
          if (!want.includes(cat)) continue;
          const key = String(it.itemNo).trim();
          out.push({
            item: it,
            category: cat,
            remain: remainMap.get(key) ?? 0,
          });
        }
        // Sort: by Remain desc, then by Item No
        out.sort((a, b) => {
          if (b.remain !== a.remain) return b.remain - a.remain;
          return a.item.itemNo.localeCompare(b.item.itemNo);
        });
        setRows(out);
      } catch (e: any) {
        ui.err("โหลดข้อมูลไม่สำเร็จ", e?.message ?? String(e));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [category, refreshKey, ui]);

  async function toggleConfirm(itemNo: string, target: ConfirmationStatus) {
    const key = String(itemNo).trim();
    const prev = confirmMap;
    const current = prev.get(key);
    const next = new Map(prev);
    const willClear = current?.status === target;
    if (willClear) {
      next.delete(key);
    } else {
      next.set(key, { status: target, confirmedAt: new Date().toISOString() });
    }
    setConfirmMap(next); // optimistic
    try {
      if (willClear) {
        await clearItemConfirmation(key);
      } else {
        await setItemConfirmation(key, target);
      }
    } catch (e: any) {
      setConfirmMap(prev); // revert
      ui.err("บันทึกไม่สำเร็จ", e?.message ?? String(e));
    }
  }

  async function clearAllCF() {
    const yes = await ui.confirm({
      title: `Reset ทุกรายการ?`,
      message: `รายการที่ Confirm หรือ "ไม่พบ" ทั้งหมด (${confirmMap.size} รายการ) จะถูกล้าง — เริ่มใหม่ตั้งแต่ต้น`,
      danger: true,
      confirmText: "Reset ทั้งหมด",
    });
    if (!yes) return;
    try {
      await clearAllConfirmations();
      setConfirmMap(new Map());
      ui.ok("Reset แล้ว");
    } catch (e: any) {
      ui.err("Reset ไม่สำเร็จ", e?.message ?? String(e));
    }
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const key = String(r.item.itemNo).trim();
      if (onlyInStock && r.remain <= 0) return false;
      if (hideDone && confirmMap.has(key)) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = `${r.item.itemNo} ${r.item.barcode ?? ""} ${r.item.description ?? ""} ${r.item.description2 ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, onlyInStock, hideDone, q, confirmMap]);

  const stats = useMemo(() => {
    const inStock = rows.filter((r) => r.remain > 0);
    const totalRemain = rows.reduce((a, r) => a + r.remain, 0);
    const giftPaid = rows.filter((r) => r.category === "gift-paid").length;
    let confirmed = 0;
    let notFound = 0;
    for (const r of rows) {
      const e = confirmMap.get(String(r.item.itemNo).trim());
      if (e?.status === "found") confirmed++;
      else if (e?.status === "not-found") notFound++;
    }
    return {
      total: rows.length,
      inStock: inStock.length,
      totalRemain,
      giftPaid,
      confirmed,
      notFound,
      done: confirmed + notFound,
    };
  }, [rows, confirmMap]);

  const titleMeta =
    category === "demo"
      ? { title: "Demo (D7)", tone: "indigo" as const, icon: "🔵" }
      : { title: "Premium Gift", tone: "rose" as const, icon: "🌸" };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="รายการทั้งหมด" value={stats.total} tone="slate" />
        <StatCard label="มี Stock" value={stats.inStock} tone="emerald" />
        <StatCard label="Remain รวม" value={stats.totalRemain} tone={titleMeta.tone} />
        {category === "gift" ? (
          <StatCard label="ของแถมมีมูลค่า" value={stats.giftPaid} tone="amber" />
        ) : (
          <StatCard label="ไม่มี Stock" value={stats.total - stats.inStock} tone="slate" />
        )}
        <StatCard label="Confirm" value={stats.confirmed} tone="emerald" />
        <StatCard label="ไม่พบ" value={stats.notFound} tone="rose" />
      </div>

      {/* Diagnostic when nothing has Remain */}
      {!loading && rows.length > 0 && stats.totalRemain === 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-sm text-amber-900">
          <div className="font-semibold mb-1">Remain ทุกรายการเป็น 0 — เช็ค 3 อย่างนี้</div>
          <ol className="list-decimal list-inside text-xs text-amber-800 space-y-0.5">
            <li>
              ยอด Ledger ที่ Remain map รวมได้:{" "}
              <span className="font-mono font-bold">{diag?.mapSize ?? 0}</span> items —
              ถ้าเป็น 0 แปลว่ายังไม่ได้อัพ Ledger หรือ Ledger ไม่มี Remaining Quantity &gt; 0
            </li>
            <li>
              <b>RPC <code className="bg-amber-100 px-1 rounded">item_remain_total()</code></b>{" "}
              อาจยังไม่ถูกสร้างใน Supabase — รัน{" "}
              <a
                className="underline font-semibold"
                href="https://github.com/wannabellsoft-cloud/drph08exp/blob/main/supabase-schema.sql"
                target="_blank"
                rel="noreferrer"
              >
                supabase-schema.sql ทั้งไฟล์
              </a>{" "}
              อีกครั้ง (idempotent ปลอดภัย)
            </li>
            <li>
              Item No. ใน Item Master ตรงกับใน Ledger หรือไม่ (case + whitespace) — ระบบ trim ให้แล้ว
              ปกติไม่ใช่ปัญหา
            </li>
          </ol>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`ค้นหา ${titleMeta.title} — Item No. / Barcode / Description`}
          className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1.5 bg-white border border-slate-200 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={onlyInStock}
            onChange={(e) => setOnlyInStock(e.target.checked)}
            className="accent-indigo-600"
          />
          เฉพาะที่มี Remain
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 px-2 py-1.5 bg-white border border-slate-200 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
            className="accent-emerald-600"
          />
          ซ่อนที่ทำแล้ว ({stats.done})
        </label>
        <button
          onClick={clearAllCF}
          disabled={confirmMap.size === 0}
          title="ล้างการตรวจสอบทั้งหมดทุกหมวด"
          className="flex items-center gap-1 px-3 py-1.5 bg-white border border-rose-300 text-rose-700 text-xs font-medium rounded-lg hover:bg-rose-50 disabled:opacity-30 shadow-sm transition"
        >
          Reset
        </button>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-30 shadow-sm transition"
        >
          {loading ? "กำลังโหลด..." : "รีเฟรช"}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {loading && rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            กำลังโหลดรายการ {titleMeta.title}...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <GiftIcon className="w-10 h-10 mx-auto text-slate-300" />
            <div className="text-sm text-slate-400 mt-2">
              {rows.length === 0
                ? `ยังไม่พบรายการ ${titleMeta.title} ใน Item Master`
                : "ไม่มีรายการที่ตรงกับเงื่อนไข"}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs">
                  <th className="text-left px-3 py-2.5 font-medium w-10">#</th>
                  <th className="text-left px-3 py-2.5 font-medium">Item No.</th>
                  <th className="text-left px-3 py-2.5 font-medium">Description</th>
                  <th className="text-left px-3 py-2.5 font-medium">UoM</th>
                  {category === "gift" && (
                    <th className="text-right px-3 py-2.5 font-medium">ราคา</th>
                  )}
                  <th className="text-center px-3 py-2.5 font-medium">หมวด</th>
                  <th className="text-right px-3 py-2.5 font-medium">Remain</th>
                  <th className="text-center px-3 py-2.5 font-medium">ตรวจสอบ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const meta = CATEGORY_META[r.category];
                  const tones = {
                    indigo: "bg-indigo-100 text-indigo-700",
                    rose: "bg-rose-100 text-rose-700",
                    amber: "bg-amber-100 text-amber-700",
                    slate: "bg-slate-100 text-slate-700",
                  };
                  const key = String(r.item.itemNo).trim();
                  const conf = confirmMap.get(key);
                  const rowBg =
                    conf?.status === "found"
                      ? "bg-emerald-50/40"
                      : conf?.status === "not-found"
                      ? "bg-rose-50/40"
                      : r.remain <= 0
                      ? "opacity-50"
                      : "";
                  return (
                    <tr
                      key={r.item.itemNo}
                      className={`border-t border-slate-100 hover:bg-slate-50/50 ${rowBg}`}
                    >
                      <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold">
                        {r.item.itemNo}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-sm text-slate-800 truncate max-w-md">
                          {r.item.description}
                        </div>
                        {r.item.description2 && (
                          <div className="text-[10px] text-slate-500 truncate max-w-md">
                            {r.item.description2}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.item.baseUom || "—"}
                      </td>
                      {category === "gift" && (
                        <td className="px-3 py-2 text-right text-xs">
                          {r.item.unitPrice ? (
                            <span className="font-mono">
                              {Number(r.item.unitPrice).toLocaleString()}฿
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${tones[meta.tone]}`}
                        >
                          {meta.short}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-extrabold ${
                          r.remain > 0 ? "text-slate-900" : "text-slate-400"
                        }`}
                      >
                        {r.remain}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <ConfirmButtons
                          entry={conf}
                          onConfirm={() => toggleConfirm(r.item.itemNo, "found")}
                          onNotFound={() => toggleConfirm(r.item.itemNo, "not-found")}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={category === "gift" ? 6 : 5} className="px-3 py-2 text-xs text-slate-500">
                    รวม {filtered.length} รายการ
                  </td>
                  <td className="px-3 py-2 text-right font-extrabold text-slate-900">
                    {filtered.reduce((a, r) => a + r.remain, 0)}
                  </td>
                  <td className="px-3 py-2 text-center text-[10px] text-slate-500">
                    <span className="text-emerald-700">{stats.confirmed}</span>
                    <span className="text-slate-400 mx-0.5">·</span>
                    <span className="text-rose-700">{stats.notFound}</span>
                    <span className="text-slate-400"> / {stats.total}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Count Section — scan + record (same as original PreCount flow)
// ============================================================

type Toast = { id: number; kind: "ok" | "warn" | "err"; text: string };
type ScannedItem = {
  item: Item;
  category: PreCountCategory;
  remaining: number;
};

function CountSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  const ui = useUI();
  const [barcode, setBarcode] = useState("");
  const [scanned, setScanned] = useState<ScannedItem | null>(null);
  const [notFound, setNotFound] = useState("");
  const [qty, setQty] = useState(1);
  const [session, setSession] = useState<Transfer | null>(null);
  const [sessions, setSessions] = useState<Transfer[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [printing, setPrinting] = useState<Transfer | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(kind: Toast["kind"], text: string) {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, kind, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3000);
  }

  async function refreshSessions() {
    setSessions(await listPreCountSessions());
  }

  useEffect(() => {
    let mobile = false;
    try {
      const ua = navigator.userAgent || "";
      mobile =
        /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
        (typeof window.matchMedia === "function" &&
          window.matchMedia("(pointer: coarse)").matches);
    } catch {}
    setIsMobile(mobile);
    if (!mobile) inputRef.current?.focus();
    (async () => {
      const sid = localStorage.getItem(PRECOUNT_SESSION_KEY);
      if (sid) {
        const t = await getTransfer(sid);
        if (t && t.type === "precount" && !t.closed) setSession(t);
      }
      await refreshSessions();
    })();
  }, []);

  async function ensureSession(): Promise<Transfer> {
    if (session && !session.closed) return session;
    const t: Transfer = {
      id: uid("PC"),
      storeFrom: STORE,
      locationFrom: STORE,
      storeTo: STORE,
      locationTo: STORE,
      createdAt: new Date().toISOString(),
      closed: false,
      lines: [],
      type: "precount",
    };
    await saveTransfer(t);
    localStorage.setItem(PRECOUNT_SESSION_KEY, t.id);
    setSession(t);
    return t;
  }

  async function newSession() {
    await ensureSession();
  }

  async function lookup(code: string) {
    const c = code.trim();
    if (!c) return;
    setNotFound("");
    setScanned(null);
    const item = await findItemByBarcode(c);
    if (!item) {
      setNotFound(`ไม่พบสินค้าสำหรับ "${c}"`);
      return;
    }
    const category = classifyItem(item);
    // Use Ledger Remaining Quantity sum across all lots/locations.
    const stock = await stockForItem(item.itemNo);
    const remaining = stock.lots.reduce((a, l) => a + (l.remaining ?? 0), 0);
    setScanned({ item, category, remaining });
    setQty(remaining > 0 ? 1 : 0);
  }

  function inSessionFor(itemNo: string): number {
    if (!session) return 0;
    return session.lines
      .filter((l) => l.itemNo === itemNo)
      .reduce((a, l) => a + (l.quantity ?? 0), 0);
  }

  const maxCanAdd = scanned
    ? Math.max(0, scanned.remaining - inSessionFor(scanned.item.itemNo))
    : 0;

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      lookup(barcode);
      setBarcode("");
    }
  }

  async function onCameraResult(code: string) {
    setCameraOpen(false);
    await lookup(code);
  }

  async function addToSession() {
    if (!scanned) return;
    if (scanned.category !== "gift" && scanned.category !== "gift-paid") {
      pushToast(
        "err",
        scanned.category === "demo"
          ? "Demo ไม่นับในแท็บนี้ — ดูที่แท็บ Demo"
          : "นับลังนี้รับเฉพาะของแถม (Premium Gift / D001) เท่านั้น",
      );
      return;
    }
    if (qty <= 0) {
      pushToast("err", "จำนวนต้องมากกว่า 0");
      return;
    }
    if (qty > maxCanAdd) {
      pushToast("err", `เกิน Remain — เพิ่มได้ไม่เกิน ${maxCanAdd}`);
      return;
    }
    const s = await ensureSession();
    if (s.closed) {
      pushToast("err", "Session นี้ปิดแล้ว");
      return;
    }
    const item = scanned.item;
    const existing = s.lines.findIndex((l) => l.itemNo === item.itemNo && !l.lotNo);
    const newLine: TransferLine = {
      itemNo: item.itemNo,
      description: item.description,
      quantity: qty,
      lotNo: "",
      uom: item.baseUom,
      alreadyExp: false,
      precountCategory: scanned.category,
      unitPrice: item.unitPrice,
    };
    const lines = [...s.lines];
    if (existing >= 0) {
      lines[existing] = { ...lines[existing], quantity: lines[existing].quantity + qty };
    } else {
      lines.push(newLine);
    }
    const next = { ...s, lines };
    await saveTransfer(next);
    setSession(next);
    setScanned(null);
    setBarcode("");
    pushToast("ok", `เพิ่ม ${qty} ${item.baseUom ?? ""}`);
    if (!isMobile) inputRef.current?.focus();
  }

  async function updateLineQty(idx: number, q: number) {
    if (!session || session.closed) return;
    const target = session.lines[idx];
    if (!target) return;
    const stock = await stockForItem(target.itemNo);
    const remaining = stock.lots.reduce((a, l) => a + (l.remaining ?? 0), 0);
    const inSessionExcludingThis = session.lines
      .filter((_, i) => i !== idx)
      .filter((l) => l.itemNo === target.itemNo)
      .reduce((a, l) => a + (l.quantity ?? 0), 0);
    const maxForThis = Math.max(0, remaining - inSessionExcludingThis);
    const clamped = Math.max(0, Math.min(q, maxForThis));
    if (q > maxForThis) pushToast("warn", `เกิน Remain — สูงสุด ${maxForThis}`);
    const lines = session.lines.map((l, i) =>
      i === idx ? { ...l, quantity: clamped } : l,
    );
    const next = { ...session, lines };
    await saveTransfer(next);
    setSession(next);
  }

  async function removeLine(idx: number) {
    if (!session || session.closed) return;
    const lines = session.lines.filter((_, i) => i !== idx);
    const next = { ...session, lines };
    await saveTransfer(next);
    setSession(next);
  }

  async function closeSession() {
    if (!session) return;
    if (session.lines.length === 0) {
      pushToast("warn", "Session ยังไม่มีรายการ");
      return;
    }
    const next: Transfer = {
      ...session,
      closed: true,
      closedAt: new Date().toISOString(),
    };
    await saveTransfer(next);
    localStorage.removeItem(PRECOUNT_SESSION_KEY);
    setSession(null);
    await refreshSessions();
    setPrinting(next);
  }

  async function removeSession(t: Transfer) {
    const yes = await ui.confirm({
      title: "ลบ Session นี้?",
      message: "Session การ Pre-count นี้จะถูกลบถาวร",
      danger: true,
      confirmText: "ลบ",
    });
    if (!yes) return;
    await deleteTransferRaw(t.id);
    await refreshSessions();
  }

  const sessionStats = session
    ? {
        demo: session.lines.filter((l) => l.precountCategory === "demo").reduce((a, l) => a + l.quantity, 0),
        gift: session.lines.filter((l) => l.precountCategory === "gift").reduce((a, l) => a + l.quantity, 0),
        giftPaid: session.lines.filter((l) => l.precountCategory === "gift-paid").reduce((a, l) => a + l.quantity, 0),
        totalLines: session.lines.length,
      }
    : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: scan */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {isMobile ? (
              <>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="w-full flex flex-col items-center justify-center gap-2 px-6 py-7 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-2xl active:scale-[0.98] shadow-lg transition font-bold"
                >
                  <ScanIcon className="w-10 h-10" />
                  <span className="text-lg">เปิดกล้องสแกน</span>
                  <span className="text-[11px] font-normal opacity-90">
                    Demo / Premium Gift
                  </span>
                </button>
                {!manualMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setManualMode(true);
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                    className="w-full mt-2 text-xs text-slate-500 hover:text-slate-700 py-1"
                  >
                    หรือ พิมพ์ Barcode / Item No. เอง
                  </button>
                ) : (
                  <input
                    ref={inputRef}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={onKey}
                    placeholder="พิมพ์ Barcode หรือ Item No. แล้ว Enter"
                    className="w-full mt-2 px-4 py-2.5 text-base border-2 border-slate-200 rounded-xl focus:outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 transition"
                  />
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 grid place-items-center">
                    <ScanIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Scan Barcode / Item No.
                    </div>
                    <div className="text-xs text-slate-500">
                      ยิงบาร์โค้ดหรือพิมพ์รหัสแล้วกด Enter
                    </div>
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
              </>
            )}
            {notFound && (
              <div className="mt-3 px-3 py-2 bg-rose-50 text-rose-700 text-sm rounded-lg border border-rose-200">
                {notFound}
              </div>
            )}
          </div>

          {scanned && (
            <div className="bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-slate-100">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-400 font-mono">{scanned.item.barcode}</div>
                  <div className="text-xs text-slate-500 font-mono">{scanned.item.itemNo}</div>
                  <div className="font-semibold text-slate-900 text-base mt-0.5">
                    {scanned.item.description}
                  </div>
                </div>
                <CategoryBadge category={scanned.category} unitPrice={scanned.item.unitPrice} />
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wide font-semibold text-slate-500">
                    Remain (Ledger)
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 leading-tight">
                    {scanned.remaining}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wide font-semibold text-amber-700">
                    ใน Session
                  </div>
                  <div className="text-lg font-extrabold text-amber-900 leading-tight">
                    {inSessionFor(scanned.item.itemNo)}
                  </div>
                </div>
                <div
                  className={`rounded-lg border px-2 py-1.5 ${
                    maxCanAdd <= 0
                      ? "border-rose-200 bg-rose-50"
                      : "border-emerald-200 bg-emerald-50"
                  }`}
                >
                  <div
                    className={`text-[9px] uppercase tracking-wide font-semibold ${
                      maxCanAdd <= 0 ? "text-rose-700" : "text-emerald-700"
                    }`}
                  >
                    เพิ่มได้อีก
                  </div>
                  <div
                    className={`text-lg font-extrabold leading-tight ${
                      maxCanAdd <= 0 ? "text-rose-900" : "text-emerald-900"
                    }`}
                  >
                    {maxCanAdd}
                  </div>
                </div>
              </div>

              {scanned.category === "demo" && (
                <div className="mb-3 text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                  สินค้านี้คือ <b>Demo (D7)</b> — แท็บนี้รับเฉพาะ <b>Premium Gift (D001)</b>{" "}
                  · ดูรายการ Demo ที่แท็บ <b>"Demo"</b> ด้านบน
                </div>
              )}

              {scanned.category === "normal" && (
                <div className="mb-3 text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2">
                  สินค้านี้ไม่ใช่ของแถม (Division Code ≠ <b>D001</b>) — เพิ่มลงลังนี้ไม่ได้
                </div>
              )}

              {scanned.remaining === 0 &&
                (scanned.category === "gift" || scanned.category === "gift-paid") && (
                  <div className="mb-3 text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2">
                    สินค้านี้ไม่มี Remain ใน Ledger — เพิ่มไม่ได้
                  </div>
                )}

              {(() => {
                const isGift =
                  scanned.category === "gift" || scanned.category === "gift-paid";
                const fullyBlocked = !isGift || maxCanAdd <= 0;
                return (
                  <div className="flex items-end gap-3">
                    <div>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                          จำนวน
                        </span>
                        <span className="text-[10px] text-slate-400 ml-2">
                          max <span className="font-bold text-slate-600">{maxCanAdd}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setQty(Math.max(1, qty - 1))}
                          disabled={fullyBlocked || qty <= 1}
                          className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 text-lg font-bold text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={maxCanAdd}
                          value={qty}
                          onChange={(e) => {
                            const v = parseInt(e.target.value || "0", 10);
                            if (Number.isNaN(v)) return;
                            setQty(Math.max(0, Math.min(v, maxCanAdd)));
                          }}
                          disabled={fullyBlocked}
                          className="w-20 text-center text-2xl font-extrabold border-2 border-slate-200 rounded-xl py-1.5 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                        />
                        <button
                          type="button"
                          onClick={() => setQty(Math.min(maxCanAdd, qty + 1))}
                          disabled={fullyBlocked || qty >= maxCanAdd}
                          className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 text-lg font-bold text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          +
                        </button>
                      </div>
                      <div className="flex gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() => setQty(maxCanAdd)}
                          disabled={fullyBlocked}
                          className="px-1.5 py-0.5 text-[10px] font-semibold bg-white border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          max ({maxCanAdd})
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={addToSession}
                      disabled={fullyBlocked || qty <= 0}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white text-sm font-semibold rounded-xl active:scale-95 shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-500"
                    >
                      <PlusIcon /> ลงในลัง
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {!scanned && !notFound && (
            <div className="bg-white border border-slate-200/70 rounded-2xl p-12 text-center">
              <ScanIcon className="w-10 h-10 mx-auto text-slate-300" />
              <div className="text-sm text-slate-400 mt-2">
                ยังไม่มีการสแกน — ยิงบาร์โค้ดเพื่อค้นหาสินค้า
              </div>
            </div>
          )}
        </div>

        {/* Right: active session */}
        <div className="lg:col-span-5">
          <div className="sticky top-20 bg-white border border-slate-200/70 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Session ที่กำลังนับ</div>
                {session && (
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">{session.id}</div>
                )}
              </div>
              {!session ? (
                <button
                  onClick={newSession}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 shadow-sm transition"
                >
                  <PlusIcon /> Session ใหม่
                </button>
              ) : (
                <button
                  onClick={closeSession}
                  disabled={session.lines.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-800 disabled:opacity-30 shadow-sm transition"
                >
                  <LockIcon className="w-3.5 h-3.5" /> ปิด + พิมพ์
                </button>
              )}
            </div>

            {session && sessionStats && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label="Demo" value={sessionStats.demo} tone="indigo" />
                <Stat label="Gift" value={sessionStats.gift} tone="rose" />
                <Stat label="Gift $" value={sessionStats.giftPaid} tone="amber" />
              </div>
            )}

            {session ? (
              session.lines.length === 0 ? (
                <div className="text-sm text-slate-400 italic text-center py-8 border border-dashed border-slate-200 rounded-lg">
                  ยังไม่มีรายการ
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[55vh] overflow-y-auto scroll-thin -mx-1 px-1">
                  {session.lines.map((l, i) => (
                    <SessionLineRow
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
                <div className="text-sm text-slate-500">ยังไม่มี Session กำลังนับ</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  กด "Session ใหม่" เพื่อเริ่ม
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Past sessions */}
      {sessions.length > 0 && (
        <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Sessions ที่บันทึกไว้</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="text-left px-4 py-2 font-medium">วันที่</th>
                <th className="text-left px-4 py-2 font-medium">Session ID</th>
                <th className="text-right px-4 py-2 font-medium">รายการ</th>
                <th className="text-right px-4 py-2 font-medium">qty</th>
                <th className="text-center px-4 py-2 font-medium">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const total = s.lines.reduce((a, l) => a + l.quantity, 0);
                return (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                      <div>{new Date(s.createdAt).toLocaleDateString("th-TH")}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(s.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{s.id}</td>
                    <td className="px-4 py-2 text-right font-semibold">{s.lines.length}</td>
                    <td className="px-4 py-2 text-right font-semibold">{total}</td>
                    <td className="px-4 py-2 text-center">
                      {s.closed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-700 text-white text-[10px] font-semibold rounded-full">
                          <LockIcon className="w-3 h-3" /> ปิดแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded-full">
                          กำลังนับ
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => setPrinting(s)}
                          title="พิมพ์ใบปะหน้า"
                          className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50"
                        >
                          <PrintIcon />
                        </button>
                        <button
                          onClick={() => removeSession(s)}
                          title="ลบ"
                          className="p-1.5 rounded-md text-rose-500 hover:bg-rose-50"
                        >
                          <TrashIcon />
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

      {cameraOpen && (
        <CameraScanner onResult={onCameraResult} onClose={() => setCameraOpen(false)} />
      )}
      {printing && (
        <PreCountPrintModal
          t={printing}
          isMobile={isMobile}
          onClose={() => setPrinting(null)}
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

// ============================================================
// Shared small components
// ============================================================

function ConfirmButtons({
  entry,
  onConfirm,
  onNotFound,
}: {
  entry?: ConfirmationEntry;
  onConfirm: () => void;
  onNotFound: () => void;
}) {
  const found = entry?.status === "found";
  const notFound = entry?.status === "not-found";

  let stamp = "";
  if (entry?.confirmedAt) {
    const t = new Date(entry.confirmedAt);
    const day = String(t.getDate()).padStart(2, "0");
    const mon = String(t.getMonth() + 1).padStart(2, "0");
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    stamp = `${day}/${mon} ${hh}:${mm}`;
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={onConfirm}
        title={
          found
            ? `Confirm เมื่อ ${stamp} — คลิกเพื่อยกเลิก`
            : "ยืนยันว่ามีสินค้านี้ในร้าน"
        }
        className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-lg active:scale-95 transition ${
          found
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-white border-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
        }`}
      >
        {found && <CheckIcon className="w-3 h-3" />}
        <span>Confirm</span>
        {found && stamp && (
          <span className="opacity-80 font-normal text-[9px]">{stamp}</span>
        )}
      </button>
      <button
        onClick={onNotFound}
        title={
          notFound
            ? `บันทึก "ไม่พบ" เมื่อ ${stamp} — คลิกเพื่อยกเลิก`
            : "บันทึกว่าหาสินค้าไม่พบในร้าน"
        }
        className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-lg active:scale-95 transition ${
          notFound
            ? "bg-rose-600 text-white hover:bg-rose-700"
            : "bg-white border-2 border-rose-400 text-rose-700 hover:bg-rose-50"
        }`}
      >
        <span>ไม่พบ</span>
        {notFound && stamp && (
          <span className="opacity-80 font-normal text-[9px]">{stamp}</span>
        )}
      </button>
    </div>
  );
}

function CategoryBadge({
  category,
  unitPrice,
}: {
  category: PreCountCategory;
  unitPrice?: number;
}) {
  const meta = CATEGORY_META[category];
  const tones = {
    indigo: "bg-indigo-600 text-white",
    rose: "bg-rose-500 text-white",
    amber: "bg-amber-500 text-white",
    slate: "bg-slate-300 text-slate-700",
  };
  return (
    <div className="text-right shrink-0">
      <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-widest ${tones[meta.tone]}`}>
        {meta.short}
      </span>
      <div className="text-[10px] text-slate-500 mt-0.5">{meta.label}</div>
      {category === "gift-paid" && unitPrice ? (
        <div className="text-[10px] text-amber-700 font-semibold mt-0.5">
          ราคา {unitPrice.toLocaleString()}฿
        </div>
      ) : null}
    </div>
  );
}

function SessionLineRow({
  line,
  onChangeQty,
  onRemove,
}: {
  line: TransferLine;
  onChangeQty: (q: number) => void;
  onRemove: () => void;
}) {
  const cat = (line.precountCategory ?? "normal") as PreCountCategory;
  const meta = CATEGORY_META[cat];
  const tones = {
    indigo: "border-indigo-200 bg-indigo-50/40",
    rose: "border-rose-200 bg-rose-50/40",
    amber: "border-amber-200 bg-amber-50/40",
    slate: "border-slate-200 bg-slate-50/40",
  };
  const badgeTones = {
    indigo: "bg-indigo-600 text-white",
    rose: "bg-rose-500 text-white",
    amber: "bg-amber-500 text-white",
    slate: "bg-slate-400 text-white",
  };
  return (
    <div className={`text-sm rounded-lg p-2.5 border ${tones[meta.tone]}`}>
      <div className="flex justify-between gap-2 items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${badgeTones[meta.tone]}`}>
              {meta.short}
            </span>
            <span className="font-mono text-xs font-semibold text-slate-800">{line.itemNo}</span>
          </div>
          <div className="text-[11px] text-slate-700 truncate mt-0.5">{line.description}</div>
          {line.unitPrice ? (
            <div className="text-[10px] text-slate-500">
              ราคา {Number(line.unitPrice).toLocaleString()}฿
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <input
            type="number"
            min={0}
            value={line.quantity}
            onChange={(e) => onChangeQty(parseInt(e.target.value || "0", 10))}
            className="w-16 text-right border border-slate-300 rounded-md px-1.5 py-0.5 text-sm font-semibold bg-white"
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

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "emerald" | "indigo" | "rose";
}) {
  const tones = {
    slate: "from-slate-50 to-white border-slate-200 text-slate-700",
    amber: "from-amber-50 to-white border-amber-200 text-amber-700",
    emerald: "from-emerald-50 to-white border-emerald-200 text-emerald-700",
    indigo: "from-indigo-50 to-white border-indigo-200 text-indigo-700",
    rose: "from-rose-50 to-white border-rose-200 text-rose-700",
  };
  return (
    <div className={`bg-gradient-to-br ${tones[tone]} border rounded-2xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]`}>
      <div className="text-[11px] uppercase tracking-wide font-semibold opacity-70">{label}</div>
      <div className="text-2xl font-extrabold mt-0.5">{value.toLocaleString()}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "indigo" | "rose" | "amber";
}) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
  };
  return (
    <div className={`rounded-xl border px-2.5 py-1.5 ${tones[tone]}`}>
      <div className="text-[9px] uppercase tracking-wide font-semibold opacity-70">{label}</div>
      <div className="text-lg font-extrabold leading-tight">{value}</div>
    </div>
  );
}

function PreCountPrintModal({
  t,
  isMobile,
  onClose,
}: {
  t: Transfer;
  isMobile: boolean;
  onClose: () => void;
}) {
  const ui = useUI();
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const [canShare, setCanShare] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanShare(typeof (navigator as any).share === "function");
  }, []);

  function doPrint() {
    setBusy("print");
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
      const filename = `PreCount-${t.id}.pdf`;
      const { shared, cancelled } = await shareOrDownloadBlob(blob, filename, `Pre-count ${t.id}`);
      if (!shared && !cancelled) {
        ui.ok("ดาวน์โหลด PDF แล้ว", "เปิดไฟล์เพื่อแชร์ต่อใน Line / อื่นๆ");
      }
    } catch (e: any) {
      ui.err("แชร์ไม่สำเร็จ", e?.message ?? String(e));
    }
    setBusy(null);
  }

  return (
    <>
      <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-backdrop-in no-print">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-modal-in">
          <div className="bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-white px-5 py-5 text-center relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/15 blur-2xl" />
            <div className="relative">
              <div className="w-14 h-14 mx-auto rounded-full bg-white/20 grid place-items-center mb-2">
                <GiftIcon className="w-7 h-7" />
              </div>
              <h2 className="font-extrabold text-xl">บันทึก Session แล้ว</h2>
              <p className="text-xs opacity-90 mt-0.5">ใบปะหน้า Pre-count Demo / Gift</p>
            </div>
          </div>
          <div className="p-5 space-y-3">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                Session ID
              </div>
              <div className="font-mono font-extrabold text-lg text-slate-900 mt-1 select-all">
                {t.id}
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <button
                onClick={doPrint}
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-br from-slate-800 to-slate-900 text-white text-sm font-semibold rounded-xl active:scale-95 shadow-md transition disabled:opacity-50"
              >
                <PrintIcon className="w-4 h-4" />
                {busy === "print" ? "กำลังพิมพ์..." : "พิมพ์ใบปะหน้า"}
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
                onClick={onClose}
                disabled={busy !== null}
                className="w-full text-xs text-slate-500 hover:text-slate-700 py-1.5"
              >
                ปิดหน้าต่างนี้
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        ref={coverRef}
        id="print-area"
        className="fixed left-[-10000px] top-0 bg-white"
        style={{ width: "210mm" }}
        aria-hidden="true"
      >
        <PreCountCoverSheet t={t} />
      </div>
    </>
  );
}
